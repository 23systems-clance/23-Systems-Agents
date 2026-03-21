/**
 * Block Kit builders for the /filter command flow.
 *
 * Provides interactive UI components for file selection, filter input
 * (natural language + structured form), and filter preview/confirmation.
 */

import type { FilterCriterion } from '../state/conversationStore.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A recent enrichment or filter result file available for filtering. */
export interface RecentFile {
  jobId: string;
  jobType: 'enrichment' | 'filter';
  resultFileName: string | null;
  resultFileUrl: string;
  rowCount: number | null;
  completedAt: Date;
}

// ---------------------------------------------------------------------------
// File selection blocks
// ---------------------------------------------------------------------------

/**
 * Builds blocks asking the user to select a file for filtering.
 * Shown when a file was recently uploaded in the channel.
 */
export function buildFilterFileSelectionBlocks(
  fileName: string,
  fileId: string,
): object[] {
  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `I found *${fileName}* in this thread. Would you like to filter this file?`,
      },
    },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Use This File' },
          action_id: 'filter_use_last_file',
          style: 'primary',
          value: fileId,
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Upload New File' },
          action_id: 'filter_upload_new',
        },
      ],
    },
  ];
}

/**
 * Builds blocks prompting the user to upload a file.
 */
export function buildFilterUploadPromptBlocks(): object[] {
  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: 'Upload a CSV or XLSX file to this thread, then I\'ll help you filter it.',
      },
    },
  ];
}

/**
 * Builds blocks showing a dropdown of recent enrichment/filter result files
 * in the channel, plus an "Upload New File" fallback.
 */
export function buildFilterEnrichmentFileSelectionBlocks(
  recentFiles: RecentFile[],
): object[] {
  const blocks: object[] = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '*Select a file to filter:*',
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
        action_id: 'filter_use_enrichment_file',
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
          action_id: 'filter_upload_new',
        },
      ],
    },
  );

  return blocks;
}

// ---------------------------------------------------------------------------
// List type selection blocks
// ---------------------------------------------------------------------------

/**
 * Builds blocks asking the user to identify the list type (company or contact).
 * Only shown when auto-detection is ambiguous.
 */
export function buildFilterListTypeBlocks(): object[] {
  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: 'What type of list is this?',
      },
    },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Company List' },
          action_id: 'filter_list_type_company',
          value: 'company',
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Contact List' },
          action_id: 'filter_list_type_contact',
          value: 'contact',
        },
      ],
    },
  ];
}

// ---------------------------------------------------------------------------
// Column value analysis helper
// ---------------------------------------------------------------------------

/** Unique value summary for a column. */
export interface ColumnValueSummary {
  value: string;
  count: number;
}

/**
 * Analyzes unique values in a column and returns groups with counts,
 * sorted by count descending. Capped at `limit` entries.
 */
export function analyzeColumnValues(
  rows: Record<string, string>[],
  columnName: string,
  limit = 25,
): ColumnValueSummary[] {
  const groups = new Map<string, number>();
  for (const row of rows) {
    const value = (row[columnName] ?? '').trim();
    groups.set(value, (groups.get(value) ?? 0) + 1);
  }
  return Array.from(groups.entries())
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}

// ---------------------------------------------------------------------------
// Filter input blocks
// ---------------------------------------------------------------------------

/**
 * Builds blocks for the filter input prompt, showing a column picker
 * dropdown, NL option, and structured form fallback.
 */
export function buildFilterInputBlocks(
  rowCount: number,
  headers: string[],
): object[] {
  const columnOptions = headers.map((h) => ({
    text: { type: 'plain_text' as const, text: h.substring(0, 75) },
    value: h,
  }));

  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*How would you like to filter this list?* (${rowCount} rows, ${headers.length} columns)`,
      },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '*Option 1:* Pick a column to filter by',
      },
    },
    {
      type: 'actions',
      elements: [
        {
          type: 'static_select',
          action_id: 'filter_pick_column',
          placeholder: { type: 'plain_text', text: 'Select a column...' },
          options: columnOptions,
        },
      ],
    },
    { type: 'divider' },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: [
          '*Option 2:* Describe your filter in plain English in this thread.',
          '',
          '_Examples:_',
          '> exclude companies with more than 200 employees',
          '> only keep rows where country is US',
        ].join('\n'),
      },
    },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Use Structured Form' },
          action_id: 'filter_use_form',
        },
      ],
    },
  ];
}

// ---------------------------------------------------------------------------
// Column value browser blocks
// ---------------------------------------------------------------------------

/**
 * Builds blocks showing unique values for a selected column,
 * with options to include/exclude specific values or type a custom filter.
 */
export function buildFilterColumnValuesBlocks(
  columnName: string,
  values: ColumnValueSummary[],
  totalRows: number,
): object[] {
  const blocks: object[] = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Column:* \`${columnName}\` — ${values.length} unique values in ${totalRows} rows`,
      },
    },
  ];

  // Show unique values as a summary
  const displayValues = values.slice(0, 15);
  const hasMore = values.length > 15;
  const valueLines = displayValues
    .map((v) => `- \`${v.value || '(empty)'}\` — ${v.count} rows`)
    .join('\n');
  const moreText = hasMore ? `\n_...and ${values.length - 15} more_` : '';

  blocks.push({
    type: 'section',
    text: {
      type: 'mrkdwn',
      text: `${valueLines}${moreText}`,
    },
  });

  // Build multi_static_select options (up to 100 for Slack limit)
  const selectOptions = values.slice(0, 100).map((v) => ({
    text: { type: 'plain_text' as const, text: `${(v.value || '(empty)').substring(0, 60)} (${v.count})` },
    value: v.value,
  }));

  blocks.push(
    { type: 'divider' },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '*Select values to keep or exclude:*',
      },
    },
    {
      type: 'actions',
      elements: [
        {
          type: 'multi_static_select',
          action_id: 'filter_column_values_select',
          placeholder: { type: 'plain_text', text: 'Select values...' },
          options: selectOptions,
        },
      ],
    },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Keep Only Selected' },
          action_id: 'filter_keep_selected_values',
          style: 'primary',
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Exclude Selected' },
          action_id: 'filter_exclude_selected_values',
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Write Custom Filter' },
          action_id: 'filter_column_custom',
        },
      ],
    },
  );

  return blocks;
}

/**
 * Builds a modal for writing a custom filter on a specific column.
 */
export function buildFilterColumnCustomModal(
  threadTs: string,
  channelId: string,
  columnName: string,
): object {
  const operatorOptions = [
    { text: { type: 'plain_text' as const, text: 'Equals' }, value: 'equals' },
    { text: { type: 'plain_text' as const, text: 'Does not equal' }, value: 'not_equals' },
    { text: { type: 'plain_text' as const, text: 'Contains' }, value: 'contains' },
    { text: { type: 'plain_text' as const, text: 'Does not contain' }, value: 'not_contains' },
    { text: { type: 'plain_text' as const, text: 'Greater than' }, value: 'greater_than' },
    { text: { type: 'plain_text' as const, text: 'Less than' }, value: 'less_than' },
    { text: { type: 'plain_text' as const, text: 'Is empty' }, value: 'is_empty' },
    { text: { type: 'plain_text' as const, text: 'Is not empty' }, value: 'is_not_empty' },
  ];

  const actionOptions = [
    { text: { type: 'plain_text' as const, text: 'Exclude matching rows' }, value: 'exclude' },
    { text: { type: 'plain_text' as const, text: 'Keep matching rows only' }, value: 'include' },
  ];

  return {
    type: 'modal',
    callback_id: 'filter_column_custom_submit',
    private_metadata: JSON.stringify({ threadTs, channelId, columnName }),
    title: { type: 'plain_text', text: 'Filter Column' },
    submit: { type: 'plain_text', text: 'Apply Filter' },
    close: { type: 'plain_text', text: 'Cancel' },
    blocks: [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `Column: *${columnName}*`,
        },
      },
      {
        type: 'input',
        block_id: 'filter_operator',
        label: { type: 'plain_text', text: 'Operator' },
        element: {
          type: 'static_select',
          action_id: 'filter_operator_select',
          placeholder: { type: 'plain_text', text: 'Select an operator' },
          options: operatorOptions,
        },
      },
      {
        type: 'input',
        block_id: 'filter_value',
        label: { type: 'plain_text', text: 'Value' },
        element: {
          type: 'plain_text_input',
          action_id: 'filter_value_input',
          placeholder: { type: 'plain_text', text: 'Enter value (leave empty for is_empty/is_not_empty)' },
        },
        optional: true,
      },
      {
        type: 'input',
        block_id: 'filter_action',
        label: { type: 'plain_text', text: 'Action' },
        element: {
          type: 'static_select',
          action_id: 'filter_action_select',
          placeholder: { type: 'plain_text', text: 'Include or exclude?' },
          options: actionOptions,
          initial_option: actionOptions[0],
        },
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Structured form modal
// ---------------------------------------------------------------------------

/**
 * Builds a Slack modal view for structured filter input.
 */
export function buildFilterFormModal(
  headers: string[],
  threadTs: string,
  channelId: string,
): object {
  const headerOptions = headers.map((h) => ({
    text: { type: 'plain_text' as const, text: h },
    value: h,
  }));

  const operatorOptions = [
    { text: { type: 'plain_text' as const, text: 'Equals' }, value: 'equals' },
    { text: { type: 'plain_text' as const, text: 'Does not equal' }, value: 'not_equals' },
    { text: { type: 'plain_text' as const, text: 'Contains' }, value: 'contains' },
    { text: { type: 'plain_text' as const, text: 'Does not contain' }, value: 'not_contains' },
    { text: { type: 'plain_text' as const, text: 'Greater than' }, value: 'greater_than' },
    { text: { type: 'plain_text' as const, text: 'Less than' }, value: 'less_than' },
    { text: { type: 'plain_text' as const, text: 'Is empty' }, value: 'is_empty' },
    { text: { type: 'plain_text' as const, text: 'Is not empty' }, value: 'is_not_empty' },
  ];

  const actionOptions = [
    { text: { type: 'plain_text' as const, text: 'Exclude matching rows' }, value: 'exclude' },
    { text: { type: 'plain_text' as const, text: 'Keep matching rows only' }, value: 'include' },
  ];

  return {
    type: 'modal',
    callback_id: 'filter_structured_submit',
    private_metadata: JSON.stringify({ threadTs, channelId }),
    title: { type: 'plain_text', text: 'Filter List' },
    submit: { type: 'plain_text', text: 'Apply Filter' },
    close: { type: 'plain_text', text: 'Cancel' },
    blocks: [
      {
        type: 'input',
        block_id: 'filter_column',
        label: { type: 'plain_text', text: 'Column' },
        element: {
          type: 'static_select',
          action_id: 'filter_column_select',
          placeholder: { type: 'plain_text', text: 'Select a column' },
          options: headerOptions,
        },
      },
      {
        type: 'input',
        block_id: 'filter_operator',
        label: { type: 'plain_text', text: 'Operator' },
        element: {
          type: 'static_select',
          action_id: 'filter_operator_select',
          placeholder: { type: 'plain_text', text: 'Select an operator' },
          options: operatorOptions,
        },
      },
      {
        type: 'input',
        block_id: 'filter_value',
        label: { type: 'plain_text', text: 'Value' },
        element: {
          type: 'plain_text_input',
          action_id: 'filter_value_input',
          placeholder: { type: 'plain_text', text: 'Enter value (leave empty for is_empty/is_not_empty)' },
        },
        optional: true,
      },
      {
        type: 'input',
        block_id: 'filter_action',
        label: { type: 'plain_text', text: 'Action' },
        element: {
          type: 'static_select',
          action_id: 'filter_action_select',
          placeholder: { type: 'plain_text', text: 'Include or exclude?' },
          options: actionOptions,
          initial_option: actionOptions[0],
        },
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Preview / confirmation blocks
// ---------------------------------------------------------------------------

/**
 * Formats a single filter criterion as a human-readable string.
 */
function formatCriterion(c: FilterCriterion): string {
  const actionLabel = c.action === 'exclude' ? 'Exclude' : 'Keep';
  const opLabel: Record<string, string> = {
    equals: '=',
    not_equals: '!=',
    contains: 'contains',
    not_contains: 'does not contain',
    greater_than: '>',
    less_than: '<',
    is_empty: 'is empty',
    is_not_empty: 'is not empty',
    regex: 'matches regex',
  };
  const op = opLabel[c.operator] ?? c.operator;

  if (c.operator === 'is_empty' || c.operator === 'is_not_empty') {
    return `${actionLabel} rows where *${c.field}* ${op}`;
  }
  return `${actionLabel} rows where *${c.field}* ${op} \`${c.value}\``;
}

/**
 * Builds blocks showing the filter preview with estimated row counts
 * and confirmation buttons.
 */
export function buildFilterPreviewBlocks(
  criteria: FilterCriterion[],
  originalCount: number,
  estimatedResultCount: number,
): object[] {
  const removedCount = originalCount - estimatedResultCount;
  const pct = originalCount > 0
    ? Math.round((estimatedResultCount / originalCount) * 100)
    : 0;

  const criteriaList = criteria.map((c) => `- ${formatCriterion(c)}`).join('\n');

  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '*Filter Preview:*',
      },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: criteriaList,
      },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `Original rows: *${originalCount}*\nEstimated rows after filter: *~${estimatedResultCount}* (${pct}%) — ${removedCount} removed`,
      },
    },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Apply Filter' },
          action_id: 'filter_confirm_apply',
          style: 'primary',
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Edit Criteria' },
          action_id: 'filter_edit_criteria',
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Cancel' },
          action_id: 'filter_cancel',
          style: 'danger',
        },
      ],
    },
  ];
}

/**
 * Builds the summary message posted after filter completion.
 */
export function buildFilterCompleteSummary(
  fileName: string,
  originalCount: number,
  resultCount: number,
): object[] {
  const removedCount = originalCount - resultCount;
  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `Filtered *${fileName}*: ${originalCount} → ${resultCount} rows (${removedCount} removed)`,
      },
    },
  ];
}
