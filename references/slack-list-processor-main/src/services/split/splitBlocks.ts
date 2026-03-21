/**
 * Block Kit builders for the /split command flow.
 *
 * Provides interactive UI components for file selection, naming,
 * split mode selection, column selection, previews, and summaries.
 */

import type { ColumnGroup } from './splitEngine.js';

// Re-export the shared RecentFile type
export type { RecentFile } from '../filter/filterBlocks.js';
import type { RecentFile } from '../filter/filterBlocks.js';

// ---------------------------------------------------------------------------
// File selection blocks
// ---------------------------------------------------------------------------

/**
 * Builds blocks showing a dropdown of recent enrichment/filter result files
 * plus an "Upload New File" fallback. Uses split-specific action IDs.
 */
export function buildSplitFileSelectionBlocks(
  recentFiles: RecentFile[],
): object[] {
  const blocks: object[] = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '*Select a file to split:*',
      },
    },
  ];

  for (const file of recentFiles) {
    const name = file.resultFileName ?? 'Untitled file';
    const date = file.completedAt.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    });
    const rowInfo = file.rowCount != null ? ` | ${file.rowCount} rows` : '';
    const typeLabel = file.jobType === 'filter' ? 'Filtered' : 'Enrichment';
    const fileType = file.resultFileUrl.endsWith('.xlsx') ? 'xlsx' : 'csv';

    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*${name}*\n${typeLabel} | ${date}${rowInfo}`,
      },
      accessory: {
        type: 'button',
        text: { type: 'plain_text', text: 'Use This' },
        action_id: 'split_use_enrichment_file',
        value: JSON.stringify({
          jobId: file.jobId,
          s3Key: file.resultFileUrl,
          fileName: name,
          fileType,
        }),
      },
    });
  }

  blocks.push(
    { type: 'divider' },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Upload New File' },
          action_id: 'split_upload_new',
        },
      ],
    },
  );

  return blocks;
}

/**
 * Builds blocks prompting the user to upload a file.
 */
export function buildSplitUploadPromptBlocks(): object[] {
  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: 'Upload a CSV or XLSX file to this thread, then I\'ll help you split it.',
      },
    },
  ];
}

// ---------------------------------------------------------------------------
// Naming blocks
// ---------------------------------------------------------------------------

/**
 * Builds blocks showing the detected name from the source file and
 * offering two buttons: Use Existing Name or Update Name.
 */
export function buildSplitNamingBlocks(
  sourceFileName: string,
  detectedName: string,
): object[] {
  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `Source file: *${sourceFileName}*\nDetected name: *${detectedName}*`,
      },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: 'How would you like to name the split output files?',
      },
    },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Use Existing Name' },
          action_id: 'split_use_existing_name',
          style: 'primary',
          value: detectedName,
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Update Name' },
          action_id: 'split_update_name',
          value: detectedName,
        },
      ],
    },
  ];
}

/**
 * Builds a modal for entering Client name only (when using existing file name).
 */
export function buildSplitClientModal(
  threadTs: string,
  channelId: string,
  campaignName: string,
): object {
  return {
    type: 'modal',
    callback_id: 'split_client_submit',
    private_metadata: JSON.stringify({ threadTs, channelId, campaignName }),
    title: { type: 'plain_text', text: 'Client Name' },
    submit: { type: 'plain_text', text: 'Continue' },
    close: { type: 'plain_text', text: 'Cancel' },
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `Campaign name: *${campaignName}*`,
        },
      },
      {
        type: 'input',
        block_id: 'client_name_block',
        label: { type: 'plain_text', text: 'Client Name' },
        element: {
          type: 'plain_text_input',
          action_id: 'client_name_input',
          placeholder: { type: 'plain_text', text: 'e.g., Acme Corp' },
        },
      },
    ],
  };
}

/**
 * Builds a modal for entering both Client name and Campaign/Target List name.
 */
export function buildSplitNamingModal(
  threadTs: string,
  channelId: string,
  detectedName: string,
): object {
  return {
    type: 'modal',
    callback_id: 'split_naming_submit',
    private_metadata: JSON.stringify({ threadTs, channelId }),
    title: { type: 'plain_text', text: 'Name Split Files' },
    submit: { type: 'plain_text', text: 'Continue' },
    close: { type: 'plain_text', text: 'Cancel' },
    blocks: [
      {
        type: 'input',
        block_id: 'client_name_block',
        label: { type: 'plain_text', text: 'Client Name' },
        element: {
          type: 'plain_text_input',
          action_id: 'client_name_input',
          placeholder: { type: 'plain_text', text: 'e.g., Acme Corp' },
        },
      },
      {
        type: 'input',
        block_id: 'campaign_name_block',
        label: { type: 'plain_text', text: 'Campaign / Target List Name' },
        element: {
          type: 'plain_text_input',
          action_id: 'campaign_name_input',
          placeholder: { type: 'plain_text', text: 'e.g., Q1 Cloud Migration Targets' },
          initial_value: detectedName,
        },
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Split mode selection blocks
// ---------------------------------------------------------------------------

/**
 * Builds blocks for split mode selection, showing 4 options.
 */
export function buildSplitModeSelectionBlocks(rowCount: number): object[] {
  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*How would you like to split this list?* (${rowCount} rows)`,
      },
    },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: 'In Half (2 parts)' },
          action_id: 'split_mode_half',
          style: 'primary',
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: 'In Quarters (4 parts)' },
          action_id: 'split_mode_quarters',
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: 'By Column Value' },
          action_id: 'split_mode_by_column',
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Custom N-way' },
          action_id: 'split_mode_custom',
        },
      ],
    },
  ];
}

// ---------------------------------------------------------------------------
// Column selection blocks (for by-column mode)
// ---------------------------------------------------------------------------

/**
 * Builds blocks with a column dropdown for by-column splits.
 */
export function buildSplitColumnSelectionBlocks(
  headers: string[],
): object[] {
  const options = headers.map((h) => ({
    text: { type: 'plain_text' as const, text: h.substring(0, 75) },
    value: h,
  }));

  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '*Select a column to split by:*\nRows will be grouped by unique values in this column.',
      },
    },
    {
      type: 'actions',
      elements: [
        {
          type: 'static_select',
          action_id: 'split_column_select',
          placeholder: { type: 'plain_text', text: 'Select a column' },
          options,
        },
      ],
    },
  ];
}

// ---------------------------------------------------------------------------
// Preview blocks
// ---------------------------------------------------------------------------

/**
 * Builds preview blocks for by-column split showing unique values and counts.
 */
export function buildSplitByColumnPreviewBlocks(
  columnName: string,
  groups: ColumnGroup[],
  totalRows: number,
): object[] {
  const displayGroups = groups.slice(0, 20);
  const hasMore = groups.length > 20;

  const groupLines = displayGroups
    .map((g) => `- *${g.value || '(empty)'}*: ${g.count} rows`)
    .join('\n');

  const moreText = hasMore
    ? `\n_...and ${groups.length - 20} more groups_`
    : '';

  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Split by column:* \`${columnName}\`\n*${groups.length} unique values* found in ${totalRows} rows:`,
      },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `${groupLines}${moreText}`,
      },
    },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: `Split into ${groups.length} files` },
          action_id: 'split_confirm_apply',
          style: 'primary',
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Cancel' },
          action_id: 'split_cancel',
          style: 'danger',
        },
      ],
    },
  ];
}

/**
 * Builds preview blocks for equal-split modes (half, quarters, custom).
 */
export function buildSplitEqualPreviewBlocks(
  splitCount: number,
  rowCount: number,
): object[] {
  const baseSize = Math.floor(rowCount / splitCount);
  const remainder = rowCount % splitCount;

  const parts: string[] = [];
  for (let i = 0; i < splitCount; i++) {
    const size = baseSize + (i < remainder ? 1 : 0);
    parts.push(`- Part ${i + 1}: *${size} rows*`);
  }

  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Split Preview:* ${rowCount} rows into ${splitCount} parts`,
      },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: parts.join('\n'),
      },
    },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: `Split into ${splitCount} files` },
          action_id: 'split_confirm_apply',
          style: 'primary',
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Cancel' },
          action_id: 'split_cancel',
          style: 'danger',
        },
      ],
    },
  ];
}

/**
 * Builds a modal for entering a custom number of parts.
 */
export function buildSplitCustomModal(
  threadTs: string,
  channelId: string,
  rowCount: number,
): object {
  return {
    type: 'modal',
    callback_id: 'split_custom_submit',
    private_metadata: JSON.stringify({ threadTs, channelId }),
    title: { type: 'plain_text', text: 'Custom Split' },
    submit: { type: 'plain_text', text: 'Preview' },
    close: { type: 'plain_text', text: 'Cancel' },
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `Total rows: *${rowCount}*\nEnter the number of parts to split into (2–100):`,
        },
      },
      {
        type: 'input',
        block_id: 'split_count_block',
        label: { type: 'plain_text', text: 'Number of Parts' },
        element: {
          type: 'plain_text_input',
          action_id: 'split_count_input',
          placeholder: { type: 'plain_text', text: 'e.g., 3' },
        },
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Completion summary
// ---------------------------------------------------------------------------

/**
 * Builds the summary message posted after split completion.
 */
export function buildSplitCompleteSummary(
  fileName: string,
  totalRows: number,
  splitCount: number,
  parts: { name: string; rowCount: number }[],
): object[] {
  const partLines = parts.map((p) => `- *${p.name}*: ${p.rowCount} rows`).join('\n');

  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `Split *${fileName}* into ${splitCount} files (${totalRows} total rows):`,
      },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: partLines,
      },
    },
  ];
}
