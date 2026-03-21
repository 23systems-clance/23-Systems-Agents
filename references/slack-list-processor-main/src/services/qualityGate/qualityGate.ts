/**
 * Quality gate orchestrator.
 *
 * Chains all quality filters in order and produces a QualityGateResult.
 * Filter order: personalEmail → missingCompany → suppression → duplicateEmail.
 */

import type { KnownBlock, Block } from '@slack/types';
import type { EffectiveQualityGateConfig } from './config.js';
import type {
  QualityGateResult,
  FilteredRow,
  FilterBreakdown,
} from './types.js';
import { filterPersonalEmails } from './filters/personalEmail.js';
import { filterMissingCompany } from './filters/missingCompany.js';
import { filterSuppressionDomains } from './filters/suppression.js';
import { filterDuplicateEmails } from './filters/duplicateEmail.js';
import { groupDuplicateDomains } from './filters/duplicateDomain.js';

// ---------------------------------------------------------------------------
// Orchestrator (T014)
// ---------------------------------------------------------------------------

/**
 * Runs the full quality gate pipeline on parsed rows.
 *
 * Chains filters in order: personalEmail → missingCompany → suppression →
 * duplicateEmail. Each filter operates on the `passed` output of the previous.
 *
 * @param rows - All parsed rows from the uploaded file.
 * @param config - Effective quality gate config (merged defaults + workspace).
 * @param columns - Detected column names from the parsed file.
 * @returns The gate result with passed rows, filtered rows, and breakdown.
 */
export function runQualityGate(
  rows: Record<string, string>[],
  config: EffectiveQualityGateConfig,
  columns: {
    emailColumn: string | null;
    domainColumn: string | null;
    companyNameColumn: string | null;
  },
): { result: QualityGateResult; passedRows: Record<string, string>[]; filteredRowDetails: FilteredRow[]; uniqueDomainsList: string[] } {
  const startTime = performance.now();
  const allFiltered: FilteredRow[] = [];
  let currentRows = rows;

  const breakdown: FilterBreakdown = {
    personalEmail: 0,
    missingCompany: 0,
    suppressionDomain: 0,
    duplicateEmail: 0,
  };

  // 1. Personal email filter
  if (config.rejectPersonalEmails) {
    const result = filterPersonalEmails(
      currentRows,
      columns.emailColumn,
      config.effectivePersonalDomains,
    );
    breakdown.personalEmail = result.filtered.length;
    allFiltered.push(...result.filtered);
    currentRows = result.passed;
  }

  // 2. Missing company filter
  if (config.rejectMissingCompany) {
    const result = filterMissingCompany(
      currentRows,
      columns.domainColumn,
      columns.companyNameColumn,
    );
    breakdown.missingCompany = result.filtered.length;
    allFiltered.push(...result.filtered);
    currentRows = result.passed;
  }

  // 3. Suppression domain filter
  {
    const result = filterSuppressionDomains(
      currentRows,
      columns.emailColumn,
      columns.domainColumn,
      config.suppressionDomains,
    );
    breakdown.suppressionDomain = result.filtered.length;
    allFiltered.push(...result.filtered);
    currentRows = result.passed;
  }

  // 4. Duplicate email filter
  if (config.rejectDuplicateEmails) {
    const result = filterDuplicateEmails(currentRows, columns.emailColumn);
    breakdown.duplicateEmail = result.filtered.length;
    allFiltered.push(...result.filtered);
    currentRows = result.passed;
  }

  // 5. Domain grouping (US3) — after all filters complete
  let uniqueDomainsList: string[] = [];
  let duplicateDomainRows = 0;
  if (config.deduplicateDomains) {
    const domainGroup = groupDuplicateDomains(currentRows, columns.domainColumn);
    uniqueDomainsList = domainGroup.uniqueDomains;
    duplicateDomainRows = domainGroup.duplicateRowCount;
  }

  const processingTimeMs = Math.round(performance.now() - startTime);

  const gateResult: QualityGateResult = {
    totalRows: rows.length,
    passedRows: currentRows.length,
    filteredRows: allFiltered.length,
    uniqueDomains: uniqueDomainsList.length,
    duplicateDomainRows,
    filterBreakdown: breakdown,
    filteredFileUrl: null, // Populated after CSV upload
    filteredFileKey: null,
    processingTimeMs,
  };

  return {
    result: gateResult,
    passedRows: currentRows,
    filteredRowDetails: allFiltered,
    uniqueDomainsList,
  };
}

// ---------------------------------------------------------------------------
// Slack Block Kit summary (T016)
// ---------------------------------------------------------------------------

/**
 * Builds Slack Block Kit blocks for the quality gate filtering summary.
 *
 * Returns null when filteredRows === 0 (FR-010: no noise for clean files).
 * Handles all-rows-filtered case with a distinct message.
 *
 * @param result - The quality gate result.
 * @param downloadUrl - Presigned URL for the filtered rows CSV, or null.
 * @returns Blocks array for Slack message, or null if nothing was filtered.
 */
export function buildFilteringSummaryBlocks(
  result: QualityGateResult,
  downloadUrl: string | null,
): (KnownBlock | Block)[] | null {
  // FR-010: No message when all rows pass
  if (result.filteredRows === 0) {
    return null;
  }

  const blocks: (KnownBlock | Block)[] = [];

  // Header
  if (result.passedRows === 0) {
    // All rows filtered
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Quality check:* All ${result.totalRows} rows were filtered out. No rows qualify for enrichment.`,
      },
    });
  } else {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Quality check:* ${result.passedRows} of ${result.totalRows} rows passed. ${result.filteredRows} filtered.`,
      },
    });
  }

  // Breakdown lines (only show non-zero counts)
  const breakdownLines: string[] = [];
  const { filterBreakdown: fb } = result;
  if (fb.personalEmail > 0)
    breakdownLines.push(`- ${fb.personalEmail} personal email domains`);
  if (fb.suppressionDomain > 0)
    breakdownLines.push(`- ${fb.suppressionDomain} suppression list matches`);
  if (fb.missingCompany > 0)
    breakdownLines.push(`- ${fb.missingCompany} missing company data`);
  if (fb.duplicateEmail > 0)
    breakdownLines.push(`- ${fb.duplicateEmail} duplicate emails`);

  if (breakdownLines.length > 0) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: breakdownLines.join('\n'),
      },
    });
  }

  // Domain dedup info (US3 — only when duplicateDomainRows > 0)
  if (result.uniqueDomains > 0 && result.duplicateDomainRows > 0) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `${result.uniqueDomains} unique domains detected across ${result.passedRows} rows. Technographic enrichment will run for ${result.uniqueDomains} domains.`,
      },
    });
  }

  // Download button
  if (downloadUrl) {
    blocks.push({
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: {
            type: 'plain_text',
            text: 'Download filtered rows',
          },
          url: downloadUrl,
          action_id: 'quality_gate_download_filtered',
        },
      ],
    });
  }

  return blocks;
}
