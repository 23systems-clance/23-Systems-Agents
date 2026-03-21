/**
 * Block Kit builders for the /analyze command flow.
 *
 * Provides interactive UI components for data source selection,
 * config doc status, and the report summary message.
 */

import type { ScoredCompany, ScoringSummary } from '../ai/opportunityScorer.js';
import type { CloudDistribution } from '../ai/reportAnalyzer.js';
import type { ConfigDocType } from '@prisma/client';
import { DOC_TYPE_LABELS } from './configDocService.js';

// ---------------------------------------------------------------------------
// Data source selection blocks
// ---------------------------------------------------------------------------

/**
 * Builds blocks for selecting data sources for the analysis.
 */
export function buildAnalyzeDataSourceBlocks(params: {
  recentJobs: Array<{
    id: string;
    jobType: string;
    companyCount: number;
    contactCount: number;
    createdAt: Date;
    sourceFileName: string | null;
  }>;
  configDocs: Array<{ docType: ConfigDocType; version: number; updatedAt: Date }>;
  missingDocs: ConfigDocType[];
}): object[] {
  const blocks: object[] = [
    {
      type: 'section',
      text: { type: 'mrkdwn', text: '*Available Data Sources:*' },
    },
  ];

  if (params.recentJobs.length > 0) {
    params.recentJobs.forEach((job) => {
      const dateStr = job.createdAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const label = job.jobType === 'TECHNOGRAPHIC'
        ? `Technographic enrichment - ${job.companyCount} companies (${dateStr})`
        : job.jobType === 'CONTACT'
          ? `Contact enrichment - ${job.contactCount} contacts (${dateStr})`
          : `Combined enrichment - ${job.companyCount} companies, ${job.contactCount} contacts (${dateStr})`;

      blocks.push({
        type: 'section',
        text: { type: 'mrkdwn', text: `> ${label}\n> _${job.sourceFileName ?? 'Unnamed'}_` },
        accessory: {
          type: 'button',
          text: { type: 'plain_text', text: 'Select' },
          action_id: `analyze_select_job_${job.id}`,
          value: job.id,
        },
      });
    });
  } else {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '_No enrichment jobs found in this channel. Run an enrichment first with /enrich or upload data._',
      },
    });
  }

  // Config doc status
  blocks.push({ type: 'divider' });
  blocks.push({
    type: 'section',
    text: { type: 'mrkdwn', text: '*Config Documents:*' },
  });

  if (params.configDocs.length > 0) {
    const docLines = params.configDocs.map((d) => {
      const dateStr = d.updatedAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      return `${DOC_TYPE_LABELS[d.docType]} (v${d.version}, updated ${dateStr})`;
    });
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: docLines.join('\n') },
    });
  }

  if (params.missingDocs.length > 0) {
    const missingLines = params.missingDocs.map((d) => `_Missing: ${DOC_TYPE_LABELS[d]}_`);
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: missingLines.join('\n') },
    });
  }

  // Action buttons
  if (params.recentJobs.length > 0) {
    blocks.push({
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Start Analysis' },
          action_id: 'analyze_confirm_start',
          style: 'primary',
        },
      ],
    });
  }

  return blocks;
}

// ---------------------------------------------------------------------------
// Report summary blocks (posted alongside PDF)
// ---------------------------------------------------------------------------

/**
 * Builds the Slack Block Kit summary message posted alongside the PDF.
 */
export function buildReportSummaryBlocks(params: {
  summary: ScoringSummary;
  totalContacts: number;
  topCompanies: ScoredCompany[];
  cloudDistribution: CloudDistribution[];
  missingDocs: ConfigDocType[];
}): object[] {
  const { summary, totalContacts, topCompanies, cloudDistribution, missingDocs } = params;

  const blocks: object[] = [
    {
      type: 'header',
      text: { type: 'plain_text', text: 'Account Analysis Report' },
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*${summary.totalCompanies}*\nTotal Accounts` },
        { type: 'mrkdwn', text: `*${totalContacts}*\nEnriched Contacts` },
        { type: 'mrkdwn', text: `*${summary.migrationTargetCount}*\nMigration Targets` },
        { type: 'mrkdwn', text: `*${summary.aiEnabledCount}*\nAI-Enabled` },
        { type: 'mrkdwn', text: `*${summary.highOpportunityCount}*\nHigh-Opp (85+)` },
      ],
    },
    { type: 'divider' },
  ];

  // Top opportunities
  if (topCompanies.length > 0) {
    const topList = topCompanies.slice(0, 5).map((c, i) =>
      `${i + 1}. *${c.companyName ?? 'Unknown'}* (${c.domain ?? 'N/A'}) — Score: ${c.score} ${c.tier}`,
    ).join('\n');

    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*Top 5 Opportunities:*\n${topList}` },
    });
  }

  // Cloud distribution summary
  if (cloudDistribution.length > 0) {
    const cloudSummary = cloudDistribution
      .slice(0, 6)
      .map((c) => `${c.provider} ${c.percentage.toFixed(1)}%`)
      .join(' | ');

    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: `*Cloud Distribution:* ${cloudSummary}` },
    });
  }

  blocks.push({
    type: 'section',
    text: { type: 'mrkdwn', text: '_Full report attached as PDF._' },
  });

  // Missing docs
  if (missingDocs.length > 0) {
    const missingList = missingDocs
      .map((d) => `• ${DOC_TYPE_LABELS[d]}`)
      .join('\n');

    blocks.push({ type: 'divider' });
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Missing Configuration Documents:*\n${missingList}\n\nUpload with: \`/analyze upload <type>\``,
      },
    });
  }

  return blocks;
}

/**
 * Builds blocks for the config doc upload confirmation.
 */
export function buildConfigDocUploadedBlocks(
  docType: ConfigDocType,
  version: number,
): object[] {
  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `Stored *${DOC_TYPE_LABELS[docType]}* document (v${version}) for this channel. This will be used in future \`/analyze\` reports.`,
      },
    },
  ];
}

/**
 * Builds blocks listing all config docs for the channel.
 */
export function buildConfigDocListBlocks(
  docs: Array<{ docType: ConfigDocType; version: number; updatedAt: Date }>,
  missingTypes: ConfigDocType[],
): object[] {
  const blocks: object[] = [
    {
      type: 'header',
      text: { type: 'plain_text', text: 'Configuration Documents' },
    },
  ];

  if (docs.length > 0) {
    docs.forEach((d) => {
      const dateStr = d.updatedAt.toLocaleDateString('en-US', {
        month: 'short', day: 'numeric', year: 'numeric',
      });
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*${DOC_TYPE_LABELS[d.docType]}* — v${d.version}, updated ${dateStr}`,
        },
      });
    });
  } else {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: '_No configuration documents uploaded for this channel._' },
    });
  }

  if (missingTypes.length > 0) {
    blocks.push({ type: 'divider' });
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Missing:* ${missingTypes.map((t) => DOC_TYPE_LABELS[t]).join(', ')}\nUpload with: \`/analyze upload <type>\``,
      },
    });
  }

  return blocks;
}
