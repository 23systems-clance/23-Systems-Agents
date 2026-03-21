/**
 * File validation module for CSV/XLSX uploads.
 *
 * Validates file structure, data quality, and domain cleanliness before
 * enrichment processing begins. Provides Block Kit error messages and
 * a template CSV download when validation fails.
 */

import type { KnownBlock } from '@slack/types';
import { hasRecognizableColumns, validateRowCount } from './parser.js';
import type { ParsedFile } from './parser.js';
import { normalizeDomain, containsHtml } from './domainUtils.js';
import { uploadSlackFile } from './slackFile.js';
import logger from '../../lib/logger.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Error codes returned by file validation. */
export type ValidationErrorCode =
  | 'NO_RECOGNIZABLE_COLUMNS'
  | 'LOW_DATA_QUALITY'
  | 'ROW_LIMIT_EXCEEDED';

/** Warning codes returned by file validation. */
export type ValidationWarningCode =
  | 'HTML_CONTAMINATION'
  | 'DOMAINS_NORMALIZED';

/** A single validation error. */
export interface FileValidationError {
  code: ValidationErrorCode;
  message: string;
  details?: string;
}

/** A single validation warning. */
export interface FileValidationWarning {
  code: ValidationWarningCode;
  message: string;
  affectedCount: number;
}

/** Result of comprehensive file validation. */
export interface FileValidationResult {
  valid: boolean;
  errors: FileValidationError[];
  warnings: FileValidationWarning[];
  /** Rows with normalized domain values (use these for enrichment). */
  normalizedRows: Record<string, string>[];
}

// ---------------------------------------------------------------------------
// Template CSV (embedded to avoid file-path resolution issues with dist/)
// ---------------------------------------------------------------------------

const TEMPLATE_CSV_CONTENT = `domain,company
example.com,Example Corp
acme.org,Acme Industries
demo-startup.io,Demo Startup Inc
globaltech.com,Global Tech Solutions
`;

/** Google Sheet template link (placeholder -- replace when available). */
const GOOGLE_SHEET_LINK = 'https://docs.google.com/spreadsheets/d/12Thkv69aKs2UyJPtnBuEsvQwu4Wsbllj1lvsB5To2w4/edit?usp=sharing';

// ---------------------------------------------------------------------------
// Core validation
// ---------------------------------------------------------------------------

/**
 * Validates a parsed file for data quality before enrichment.
 *
 * Checks:
 * 1. Required columns exist (domain or company name)
 * 2. Domain values are clean (detects HTML contamination)
 * 3. Normalizes domain values in the returned rows
 * 4. Data quality: reasonable % of rows have usable values
 * 5. Row count within limits (max 1,000)
 *
 * @param parsed - The ParsedFile from parseFile().
 * @returns Validation result with errors, warnings, and normalized rows.
 */
export function validateFile(parsed: ParsedFile): FileValidationResult {
  const errors: FileValidationError[] = [];
  const warnings: FileValidationWarning[] = [];

  // Make a deep copy of rows for normalization.
  const normalizedRows = parsed.rows.map((row) => ({ ...row }));

  // ----- Check 1: Recognizable columns -----
  if (!hasRecognizableColumns(parsed)) {
    errors.push({
      code: 'NO_RECOGNIZABLE_COLUMNS',
      message: 'No recognizable columns found in your file.',
      details:
        `Found columns: ${parsed.headers.join(', ')}.\n` +
        'Expected at least one of: domain, website, url, company, name, organization.',
    });
  }

  // ----- Check 2 & 3: HTML contamination + domain normalization -----
  if (parsed.domainColumn) {
    let htmlCount = 0;
    let normalizedCount = 0;

    for (const row of normalizedRows) {
      const rawDomain = row[parsed.domainColumn];
      if (!rawDomain) continue;

      if (containsHtml(rawDomain)) {
        htmlCount++;
      }

      const cleaned = normalizeDomain(rawDomain);
      if (cleaned && cleaned !== rawDomain) {
        normalizedCount++;
      }
      row[parsed.domainColumn] = cleaned ?? '';
    }

    if (htmlCount > 0) {
      warnings.push({
        code: 'HTML_CONTAMINATION',
        message: `Detected HTML tags in ${htmlCount} domain values (common in Salesforce exports). Domains have been cleaned automatically.`,
        affectedCount: htmlCount,
      });
    }

    if (normalizedCount > 0 && htmlCount === 0) {
      warnings.push({
        code: 'DOMAINS_NORMALIZED',
        message: `Normalized ${normalizedCount} domain values (removed http://, www., etc.).`,
        affectedCount: normalizedCount,
      });
    }
  }

  // ----- Check 4: Data quality -----
  if (parsed.rows.length > 0 && (parsed.domainColumn || parsed.companyNameColumn)) {
    let emptyCount = 0;
    for (const row of normalizedRows) {
      const domain = parsed.domainColumn ? row[parsed.domainColumn]?.trim() : '';
      const company = parsed.companyNameColumn ? row[parsed.companyNameColumn]?.trim() : '';
      if (!domain && !company) {
        emptyCount++;
      }
    }

    const emptyPercent = (emptyCount / parsed.rows.length) * 100;
    if (emptyPercent > 50) {
      errors.push({
        code: 'LOW_DATA_QUALITY',
        message: `${Math.round(emptyPercent)}% of rows have no domain or company name.`,
        details: `${emptyCount} of ${parsed.rows.length} rows are empty. Please ensure your file has data in the domain or company name columns.`,
      });
    }
  }

  // ----- Check 5: Row count -----
  const rowValidation = validateRowCount(parsed.rows.length);
  if (!rowValidation.valid) {
    errors.push({
      code: 'ROW_LIMIT_EXCEEDED',
      message: rowValidation.message ?? 'File has too many rows.',
      details: `Your file has ${parsed.rows.length} rows. Maximum allowed is 1,000 per request.`,
    });
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    normalizedRows,
  };
}

// ---------------------------------------------------------------------------
// Block Kit error message builder
// ---------------------------------------------------------------------------

/**
 * Builds Slack Block Kit blocks for a validation failure message.
 *
 * @param result - The validation result containing errors and warnings.
 * @returns Block Kit blocks array for posting to Slack.
 */
export function buildValidationErrorBlocks(
  result: FileValidationResult,
): KnownBlock[] {
  const blocks: KnownBlock[] = [];

  // Header
  blocks.push({
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: '*File Validation Failed*\n\nI found some issues with your uploaded file:',
    },
  });

  // Errors
  for (const error of result.errors) {
    let text = `*${error.message}*`;
    if (error.details) {
      text += `\n${error.details}`;
    }
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text },
    });
  }

  // Warnings (if any)
  if (result.warnings.length > 0) {
    const warningLines = result.warnings
      .map((w) => `- ${w.message}`)
      .join('\n');
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*Warnings:*\n${warningLines}` },
    });
  }

  // Template instructions
  const templateText = `Please fix the issues above and re-upload. You can use this <${GOOGLE_SHEET_LINK}|Google Sheet template> as a reference, or see the template CSV attached below.`;

  blocks.push({
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: templateText,
    },
  });

  // Expected format
  blocks.push({
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: '*Expected columns:*\n- `domain` or `website` - Company domain (e.g. example.com)\n- `company` or `name` - Company name\n\nAt least one of these columns is required.',
    },
  });

  return blocks;
}

// ---------------------------------------------------------------------------
// Template upload
// ---------------------------------------------------------------------------

/**
 * Uploads the template CSV file to the Slack thread to show expected format.
 *
 * @param client    - Slack WebClient instance.
 * @param channelId - Slack channel ID.
 * @param threadTs  - Thread timestamp.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function uploadTemplateCsv(
  client: any,
  channelId: string,
  threadTs: string,
): Promise<void> {
  try {
    await uploadSlackFile({
      client,
      channelId,
      threadTs,
      fileBuffer: Buffer.from(TEMPLATE_CSV_CONTENT, 'utf-8'),
      filename: 'enrichment-template.csv',
      title: 'Enrichment Template',
      initialComment: 'Here is a template CSV showing the expected format.',
    });
  } catch (err) {
    logger.error('Failed to upload template CSV', {
      channelId,
      threadTs,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Sets the Google Sheet template link for validation error messages.
 *
 * Call this at startup or when the link is configured.
 *
 * @param link - The full Google Sheet URL.
 */
export function setGoogleSheetTemplateLink(link: string): void {
  // This is a module-level mutation, intentionally simple.
  (setGoogleSheetTemplateLink as any).__link = link;
}
