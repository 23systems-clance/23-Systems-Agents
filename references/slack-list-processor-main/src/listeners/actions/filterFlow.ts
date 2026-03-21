/**
 * Action handlers for the /filter interactive flow.
 *
 * Handles: file selection, list type detection, NL filter input (via
 * message listener), structured form submission, preview confirmation,
 * and filter application with output file generation.
 */

import type { App } from '@slack/bolt';
import type { GenericMessageEvent, KnownBlock } from '@slack/types';
import {
  getConversation,
  updateConversation,
  type FilterCriterion,
} from '../../services/state/conversationStore.js';
import { downloadSlackFile } from '../../services/file/slackFile.js';
import { parseFile } from '../../services/file/parser.js';
import { uploadSlackFile, markThreadForBotUpload } from '../../services/file/slackFile.js';
import { uploadFile, downloadFile } from '../../lib/storage.js';
import { parseFilterCriteria } from '../../services/ai/filterParser.js';
import { applyFilters, previewFilterCount } from '../../services/filter/filterEngine.js';
import {
  buildFilterInputBlocks,
  buildFilterPreviewBlocks,
  buildFilterCompleteSummary,
  buildFilterFormModal,
  buildFilterListTypeBlocks,
  buildFilterColumnValuesBlocks,
  buildFilterColumnCustomModal,
  analyzeColumnValues,
} from '../../services/filter/filterBlocks.js';
import { config } from '../../config/index.js';
import { prisma } from '../../models/index.js';
import logger from '../../lib/logger.js';
import redis from '../../lib/redis.js';
import { stringify } from 'csv-stringify/sync';
import * as XLSX from 'xlsx';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MIME_TYPE_MAP: Record<string, string> = {
  csv: 'text/csv',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

/** Redis key prefix for cached parsed filter data. */
const FILTER_DATA_PREFIX = 'filter-data';

/** TTL for cached filter data (1 hour). */
const FILTER_DATA_TTL = 3600;

// ---------------------------------------------------------------------------
// Redis cache helpers for parsed file data
// ---------------------------------------------------------------------------

/**
 * Caches parsed file data in Redis for the filter flow.
 */
async function cacheFilterData(
  channelId: string,
  threadTs: string,
  data: { rows: Record<string, string>[]; headers: string[] },
): Promise<void> {
  const key = `${FILTER_DATA_PREFIX}:${channelId}:${threadTs}`;
  await redis.set(key, JSON.stringify(data), 'EX', FILTER_DATA_TTL);
}

/**
 * Retrieves cached parsed file data from Redis.
 */
async function getCachedFilterData(
  channelId: string,
  threadTs: string,
): Promise<{ rows: Record<string, string>[]; headers: string[] } | null> {
  const key = `${FILTER_DATA_PREFIX}:${channelId}:${threadTs}`;
  const raw = await redis.get(key);
  if (!raw) return null;
  return JSON.parse(raw) as { rows: Record<string, string>[]; headers: string[] };
}

// ---------------------------------------------------------------------------
// Shared: download, parse, and present filter input
// ---------------------------------------------------------------------------

/**
 * Downloads and parses a file, then shows the filter input UI.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function processFileForFilter(
  client: any,
  channelId: string,
  threadTs: string,
  conversation: { fileId: string; fileName: string; fileType: string },
): Promise<void> {
  // Download file from Slack
  const fileInfo = await client.files.info({ file: conversation.fileId });
  const downloadUrl = fileInfo.file?.url_private;

  if (!downloadUrl) {
    await client.chat.postMessage({
      channel: channelId,
      thread_ts: threadTs,
      text: 'Unable to access the uploaded file. Please re-upload and try again.',
    });
    return;
  }

  const fileBuffer = await downloadSlackFile(downloadUrl, config.slack.botToken);
  const mimeType = MIME_TYPE_MAP[conversation.fileType] ?? 'text/csv';
  const parsed = parseFile(fileBuffer, mimeType);

  // Auto-detect list type
  const headersLower = parsed.headers.map((h) => h.toLowerCase());
  const hasContactColumns = headersLower.some((h) =>
    ['email', 'first_name', 'last_name', 'firstname', 'lastname', 'job_title', 'jobtitle'].includes(h),
  );
  const hasCompanyColumns = headersLower.some((h) =>
    ['domain', 'website', 'company', 'company_name', 'companyname'].includes(h),
  );

  let detectedType: 'company' | 'contact' | null = null;
  if (hasContactColumns && !hasCompanyColumns) detectedType = 'contact';
  else if (hasCompanyColumns && !hasContactColumns) detectedType = 'company';
  else if (hasContactColumns && hasCompanyColumns) detectedType = 'contact';
  // If neither, leave null and ask

  // Cache parsed data in Redis
  await cacheFilterData(channelId, threadTs, {
    rows: parsed.rows,
    headers: parsed.headers,
  });

  await updateConversation(channelId, threadTs, {
    listType: detectedType ?? undefined,
  });

  if (!detectedType) {
    // Ask user to identify list type
    await client.chat.postMessage({
      channel: channelId,
      thread_ts: threadTs,
      blocks: buildFilterListTypeBlocks(),
      text: 'What type of list is this?',
    });
    return;
  }

  // Show filter input UI
  await client.chat.postMessage({
    channel: channelId,
    thread_ts: threadTs,
    blocks: buildFilterInputBlocks(parsed.rowCount, parsed.headers),
    text: 'How would you like to filter this list?',
  });
}

// ---------------------------------------------------------------------------
// Output generation helpers
// ---------------------------------------------------------------------------

/**
 * Generates a filtered CSV buffer from rows and headers.
 */
function generateFilteredCsv(
  rows: Record<string, string>[],
  headers: string[],
): Buffer {
  const output = stringify(rows, { header: true, columns: headers });
  return Buffer.from(output);
}

/**
 * Generates a filtered XLSX buffer from rows and headers.
 */
function generateFilteredXlsx(
  rows: Record<string, string>[],
  headers: string[],
): Buffer {
  const wsData = [headers, ...rows.map((row) => headers.map((h) => row[h] ?? ''))];
  const ws = XLSX.utils.aoa_to_sheet(wsData);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Filtered');
  return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
}

// ---------------------------------------------------------------------------
// Action handler registration
// ---------------------------------------------------------------------------

/**
 * Registers all /filter flow action handlers and the thread message
 * listener for natural language filter input.
 */
export function registerFilterFlowHandlers(app: App): void {
  // --- Use last file button ---
  app.action('filter_use_last_file', async ({ ack, body, client }) => {
    await ack();
    const channelId = body.channel?.id;
    const messageTs = (body as any).message?.thread_ts ?? (body as any).message?.ts;
    if (!channelId || !messageTs) return;

    // Update original message to show selection
    await client.chat.update({
      channel: channelId,
      ts: (body as any).message?.ts,
      text: 'Using the uploaded file for filtering.',
      blocks: [{ type: 'section', text: { type: 'mrkdwn', text: 'Using the uploaded file for filtering.' } }],
    });

    const conversation = await getConversation(channelId, messageTs);
    if (!conversation?.fileId) {
      await client.chat.postMessage({
        channel: channelId,
        thread_ts: messageTs,
        text: 'Could not find the file. Please upload a new one.',
      });
      return;
    }

    await processFileForFilter(client, channelId, messageTs, conversation);
  });

  // --- Upload new file button ---
  app.action('filter_upload_new', async ({ ack, body, client }) => {
    await ack();
    const channelId = body.channel?.id;
    const messageTs = (body as any).message?.thread_ts ?? (body as any).message?.ts;
    if (!channelId || !messageTs) return;

    await client.chat.update({
      channel: channelId,
      ts: (body as any).message?.ts,
      text: 'Upload a new file to this thread.',
      blocks: [{ type: 'section', text: { type: 'mrkdwn', text: 'Upload a new CSV or XLSX file to this thread.' } }],
    });
  });

  // --- Use enrichment/filter result file from S3 ---
  app.action('filter_use_enrichment_file', async ({ ack, body, client, action }) => {
    await ack();
    const channelId = body.channel?.id;
    const messageTs = (body as any).message?.thread_ts ?? (body as any).message?.ts;
    if (!channelId || !messageTs) return;

    const { jobId, s3Key, fileName, fileType } = JSON.parse(
      (action as any).value as string,
    );

    // Update selection message to show what was picked
    await client.chat.update({
      channel: channelId,
      ts: (body as any).message?.ts,
      text: `Selected: ${fileName}`,
      blocks: [{ type: 'section', text: { type: 'mrkdwn', text: `Selected *${fileName}* for filtering.` } }],
    });

    try {
      // Download from S3 and parse
      const fileBuffer = await downloadFile(s3Key);
      const mimeType = fileType === 'xlsx'
        ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        : 'text/csv';
      const parsed = parseFile(fileBuffer, mimeType);

      // Cache parsed data in Redis
      await cacheFilterData(channelId, messageTs, {
        rows: parsed.rows,
        headers: parsed.headers,
      });

      // Update conversation state
      await updateConversation(channelId, messageTs, {
        fileId: '',
        fileName,
        fileType: fileType as 'csv' | 'xlsx',
        sourceJobId: jobId,
      });

      // Auto-detect list type
      const headersLower = parsed.headers.map((h) => h.toLowerCase());
      const hasContactColumns = headersLower.some((h) =>
        ['email', 'first_name', 'last_name', 'firstname', 'lastname', 'job_title', 'jobtitle'].includes(h),
      );
      const hasCompanyColumns = headersLower.some((h) =>
        ['domain', 'website', 'company', 'company_name', 'companyname'].includes(h),
      );

      let detectedType: 'company' | 'contact' | null = null;
      if (hasContactColumns && !hasCompanyColumns) detectedType = 'contact';
      else if (hasCompanyColumns && !hasContactColumns) detectedType = 'company';
      else if (hasContactColumns && hasCompanyColumns) detectedType = 'contact';

      if (detectedType) {
        await updateConversation(channelId, messageTs, { listType: detectedType });
      }

      if (!detectedType) {
        await client.chat.postMessage({
          channel: channelId,
          thread_ts: messageTs,
          blocks: buildFilterListTypeBlocks() as KnownBlock[],
          text: 'What type of list is this?',
        });
        return;
      }

      // Show filter input UI
      await client.chat.postMessage({
        channel: channelId,
        thread_ts: messageTs,
        blocks: buildFilterInputBlocks(parsed.rowCount, parsed.headers) as KnownBlock[],
        text: 'How would you like to filter this list?',
      });
    } catch (error) {
      logger.error('Error downloading enrichment file from S3', { error, s3Key, jobId });
      await client.chat.postMessage({
        channel: channelId,
        thread_ts: messageTs,
        text: 'This file is no longer available. Please upload a new file to filter.',
      });
    }
  });

  // --- List type selection (when auto-detect is ambiguous) ---
  app.action(/^filter_list_type_(company|contact)$/, async ({ ack, body, client, action }) => {
    await ack();
    const channelId = body.channel?.id;
    const messageTs = (body as any).message?.thread_ts ?? (body as any).message?.ts;
    if (!channelId || !messageTs) return;

    const listType = (action as any).value as 'company' | 'contact';

    await client.chat.update({
      channel: channelId,
      ts: (body as any).message?.ts,
      text: `Selected: ${listType} list`,
      blocks: [{ type: 'section', text: { type: 'mrkdwn', text: `Selected: *${listType} list*` } }],
    });

    await updateConversation(channelId, messageTs, { listType });

    // Show filter input UI
    const cached = await getCachedFilterData(channelId, messageTs);
    if (!cached) {
      await client.chat.postMessage({
        channel: channelId,
        thread_ts: messageTs,
        text: 'Session expired. Please start over with /filter.',
      });
      return;
    }

    await client.chat.postMessage({
      channel: channelId,
      thread_ts: messageTs,
      blocks: buildFilterInputBlocks(cached.rows.length, cached.headers) as KnownBlock[],
      text: 'How would you like to filter this list?',
    });
  });

  // --- Use structured form button ---
  app.action('filter_use_form', async ({ ack, body, client }) => {
    await ack();
    const channelId = body.channel?.id;
    const messageTs = (body as any).message?.thread_ts ?? (body as any).message?.ts;
    if (!channelId || !messageTs) return;

    const cached = await getCachedFilterData(channelId, messageTs);
    if (!cached) {
      await client.chat.postMessage({
        channel: channelId,
        thread_ts: messageTs,
        text: 'Session expired. Please start over with /filter.',
      });
      return;
    }

    // Open modal with structured form
    await client.views.open({
      trigger_id: (body as any).trigger_id,
      view: buildFilterFormModal(cached.headers, messageTs, channelId) as any,
    });
  });

  // --- Column picker: user selects a column to filter by ---
  app.action('filter_pick_column', async ({ ack, body, client, action }) => {
    await ack();
    const channelId = body.channel?.id;
    const messageTs = (body as any).message?.thread_ts ?? (body as any).message?.ts;
    if (!channelId || !messageTs) return;

    const columnName = (action as any).selected_option?.value as string;
    if (!columnName) return;

    const cached = await getCachedFilterData(channelId, messageTs);
    if (!cached) {
      await client.chat.postMessage({
        channel: channelId,
        thread_ts: messageTs,
        text: 'Session expired. Please start over with /filter.',
      });
      return;
    }

    // Store selected column for value selection handlers
    await updateConversation(channelId, messageTs, {
      filterSelectedColumn: columnName,
    });

    // Analyze unique values
    const values = analyzeColumnValues(cached.rows, columnName);

    await client.chat.postMessage({
      channel: channelId,
      thread_ts: messageTs,
      blocks: buildFilterColumnValuesBlocks(columnName, values, cached.rows.length) as KnownBlock[],
      text: `Column: ${columnName} — ${values.length} unique values`,
    });
  });

  // --- Column value multi-select (stores selection for keep/exclude buttons) ---
  app.action('filter_column_values_select', async ({ ack }) => {
    // Just ack — the selected values are read when the user clicks Keep/Exclude
    await ack();
  });

  // --- Keep Only Selected Values ---
  app.action('filter_keep_selected_values', async ({ ack, body, client }) => {
    await ack();
    const channelId = body.channel?.id;
    const messageTs = (body as any).message?.thread_ts ?? (body as any).message?.ts;
    if (!channelId || !messageTs) return;

    // Extract selected values from the multi_static_select in the same message
    const actionsBlock = (body as any).message?.blocks?.find(
      (b: any) => b.type === 'actions' && b.elements?.some((e: any) => e.action_id === 'filter_column_values_select'),
    );
    // Slack stores the current selection in the state
    const state = (body as any).state?.values;
    let selectedValues: string[] = [];
    if (state) {
      for (const blockId of Object.keys(state)) {
        const selectState = state[blockId]?.filter_column_values_select;
        if (selectState?.selected_options) {
          selectedValues = selectState.selected_options.map((o: any) => o.value);
        }
      }
    }

    if (selectedValues.length === 0) {
      await client.chat.postMessage({
        channel: channelId,
        thread_ts: messageTs,
        text: 'Please select at least one value from the dropdown first.',
      });
      return;
    }

    const conversation = await getConversation(channelId, messageTs);
    const columnName = conversation?.filterSelectedColumn;
    if (!columnName) return;

    // Build criteria: include rows where column equals any selected value
    // Use multiple "include" criteria with OR logic by creating one "contains" per value
    // Actually, for exact match include, we use: keep rows where column equals value1 OR value2...
    // Since filter engine uses AND logic, we need a single criterion.
    // Best approach: use regex to match any of the selected values
    const escapedValues = selectedValues.map((v) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const regexPattern = `^(${escapedValues.join('|')})$`;

    const criterion: FilterCriterion = {
      field: columnName,
      operator: 'regex',
      value: regexPattern,
      action: 'include',
    };

    const existingCriteria = conversation?.filterCriteria ?? [];
    const allCriteria = [...existingCriteria, criterion];
    await updateConversation(channelId, messageTs, { filterCriteria: allCriteria });

    // Update the message to show what was selected
    const valueList = selectedValues.map((v) => `\`${v || '(empty)'}\``).join(', ');
    await client.chat.update({
      channel: channelId,
      ts: (body as any).message?.ts,
      text: `Keeping rows where ${columnName} is: ${valueList}`,
      blocks: [{ type: 'section', text: { type: 'mrkdwn', text: `Keeping rows where *${columnName}* is: ${valueList}` } }],
    });

    // Show preview
    const cached = await getCachedFilterData(channelId, messageTs);
    if (!cached) return;

    const preview = previewFilterCount(cached.rows, allCriteria, cached.headers);
    await client.chat.postMessage({
      channel: channelId,
      thread_ts: messageTs,
      blocks: buildFilterPreviewBlocks(allCriteria, cached.rows.length, preview.estimatedResultCount) as KnownBlock[],
      text: `Filter preview: ${cached.rows.length} → ${preview.estimatedResultCount} rows`,
    });
  });

  // --- Exclude Selected Values ---
  app.action('filter_exclude_selected_values', async ({ ack, body, client }) => {
    await ack();
    const channelId = body.channel?.id;
    const messageTs = (body as any).message?.thread_ts ?? (body as any).message?.ts;
    if (!channelId || !messageTs) return;

    const state = (body as any).state?.values;
    let selectedValues: string[] = [];
    if (state) {
      for (const blockId of Object.keys(state)) {
        const selectState = state[blockId]?.filter_column_values_select;
        if (selectState?.selected_options) {
          selectedValues = selectState.selected_options.map((o: any) => o.value);
        }
      }
    }

    if (selectedValues.length === 0) {
      await client.chat.postMessage({
        channel: channelId,
        thread_ts: messageTs,
        text: 'Please select at least one value from the dropdown first.',
      });
      return;
    }

    const conversation = await getConversation(channelId, messageTs);
    const columnName = conversation?.filterSelectedColumn;
    if (!columnName) return;

    const escapedValues = selectedValues.map((v) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const regexPattern = `^(${escapedValues.join('|')})$`;

    const criterion: FilterCriterion = {
      field: columnName,
      operator: 'regex',
      value: regexPattern,
      action: 'exclude',
    };

    const existingCriteria = conversation?.filterCriteria ?? [];
    const allCriteria = [...existingCriteria, criterion];
    await updateConversation(channelId, messageTs, { filterCriteria: allCriteria });

    const valueList = selectedValues.map((v) => `\`${v || '(empty)'}\``).join(', ');
    await client.chat.update({
      channel: channelId,
      ts: (body as any).message?.ts,
      text: `Excluding rows where ${columnName} is: ${valueList}`,
      blocks: [{ type: 'section', text: { type: 'mrkdwn', text: `Excluding rows where *${columnName}* is: ${valueList}` } }],
    });

    const cached = await getCachedFilterData(channelId, messageTs);
    if (!cached) return;

    const preview = previewFilterCount(cached.rows, allCriteria, cached.headers);
    await client.chat.postMessage({
      channel: channelId,
      thread_ts: messageTs,
      blocks: buildFilterPreviewBlocks(allCriteria, cached.rows.length, preview.estimatedResultCount) as KnownBlock[],
      text: `Filter preview: ${cached.rows.length} → ${preview.estimatedResultCount} rows`,
    });
  });

  // --- Write Custom Filter on selected column ---
  app.action('filter_column_custom', async ({ ack, body, client }) => {
    await ack();
    const channelId = body.channel?.id;
    const messageTs = (body as any).message?.thread_ts ?? (body as any).message?.ts;
    if (!channelId || !messageTs) return;

    const triggerId = (body as any).trigger_id;
    if (!triggerId) return;

    const conversation = await getConversation(channelId, messageTs);
    const columnName = conversation?.filterSelectedColumn;
    if (!columnName) return;

    await client.views.open({
      trigger_id: triggerId,
      view: buildFilterColumnCustomModal(messageTs, channelId, columnName) as any,
    });
  });

  // --- Custom column filter modal submission ---
  app.view('filter_column_custom_submit', async ({ ack, view, client }) => {
    await ack();

    const metadata = JSON.parse(view.private_metadata);
    const { threadTs, channelId, columnName } = metadata;

    const operator = view.state.values['filter_operator']?.['filter_operator_select']?.selected_option?.value;
    const value = view.state.values['filter_value']?.['filter_value_input']?.value ?? '';
    const action = view.state.values['filter_action']?.['filter_action_select']?.selected_option?.value ?? 'exclude';

    if (!operator) return;

    const criterion: FilterCriterion = {
      field: columnName,
      operator: operator as FilterCriterion['operator'],
      value,
      action: action as 'include' | 'exclude',
    };

    const conversation = await getConversation(channelId, threadTs);
    const existingCriteria = conversation?.filterCriteria ?? [];
    const allCriteria = [...existingCriteria, criterion];
    await updateConversation(channelId, threadTs, { filterCriteria: allCriteria });

    const cached = await getCachedFilterData(channelId, threadTs);
    if (!cached) return;

    const preview = previewFilterCount(cached.rows, allCriteria, cached.headers);
    await client.chat.postMessage({
      channel: channelId,
      thread_ts: threadTs,
      blocks: buildFilterPreviewBlocks(allCriteria, cached.rows.length, preview.estimatedResultCount) as KnownBlock[],
      text: `Filter preview: ${cached.rows.length} → ${preview.estimatedResultCount} rows`,
    });
  });

  // --- Structured form modal submission ---
  app.view('filter_structured_submit', async ({ ack, view, client, body }) => {
    await ack();

    const metadata = JSON.parse(view.private_metadata);
    const { threadTs, channelId } = metadata;

    const column = view.state.values['filter_column']?.['filter_column_select']?.selected_option?.value;
    const operator = view.state.values['filter_operator']?.['filter_operator_select']?.selected_option?.value;
    const value = view.state.values['filter_value']?.['filter_value_input']?.value ?? '';
    const action = view.state.values['filter_action']?.['filter_action_select']?.selected_option?.value ?? 'exclude';

    if (!column || !operator) return;

    const criterion: FilterCriterion = {
      field: column,
      operator: operator as FilterCriterion['operator'],
      value,
      action: action as 'include' | 'exclude',
    };

    // Get existing criteria or start fresh
    const conversation = await getConversation(channelId, threadTs);
    const existingCriteria = conversation?.filterCriteria ?? [];
    const allCriteria = [...existingCriteria, criterion];

    await updateConversation(channelId, threadTs, { filterCriteria: allCriteria });

    // Show preview
    const cached = await getCachedFilterData(channelId, threadTs);
    if (!cached) return;

    const preview = previewFilterCount(cached.rows, allCriteria, cached.headers);

    await client.chat.postMessage({
      channel: channelId,
      thread_ts: threadTs,
      blocks: buildFilterPreviewBlocks(
        allCriteria,
        cached.rows.length,
        preview.estimatedResultCount,
      ) as KnownBlock[],
      text: `Filter preview: ${cached.rows.length} → ${preview.estimatedResultCount} rows`,
    });
  });

  // --- Confirm and apply filter ---
  app.action('filter_confirm_apply', async ({ ack, body, client }) => {
    await ack();
    const channelId = body.channel?.id;
    const messageTs = (body as any).message?.thread_ts ?? (body as any).message?.ts;
    if (!channelId || !messageTs) return;

    // Update the confirmation message
    await client.chat.update({
      channel: channelId,
      ts: (body as any).message?.ts,
      text: 'Applying filter...',
      blocks: [{ type: 'section', text: { type: 'mrkdwn', text: 'Applying filter...' } }],
    });

    const conversation = await getConversation(channelId, messageTs);
    if (!conversation?.filterCriteria?.length) {
      await client.chat.postMessage({
        channel: channelId,
        thread_ts: messageTs,
        text: 'No filter criteria found. Please start over.',
      });
      return;
    }

    const cached = await getCachedFilterData(channelId, messageTs);
    if (!cached) {
      await client.chat.postMessage({
        channel: channelId,
        thread_ts: messageTs,
        text: 'Session expired. Please start over with /filter.',
      });
      return;
    }

    try {
      // Apply the filter
      const result = applyFilters(cached.rows, conversation.filterCriteria, cached.headers);

      // Generate output file
      const fileType = conversation.fileType ?? 'csv';
      const outputBuffer = fileType === 'xlsx'
        ? generateFilteredXlsx(result.filtered, cached.headers)
        : generateFilteredCsv(result.filtered, cached.headers);

      const now = new Date();
      const datePrefix = `${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
      const baseName = conversation.fileName?.replace(/\.(csv|xlsx)$/i, '') ?? 'filtered';
      const outputFileName = `[${datePrefix}] FILTERED - ${baseName}.${fileType}`;

      // Upload to S3
      const s3Key = `filter-results/${Date.now()}-${outputFileName}`;
      const contentType = fileType === 'xlsx'
        ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        : 'text/csv';
      await uploadFile(s3Key, outputBuffer, contentType);

      // Upload to Slack
      markThreadForBotUpload(channelId, messageTs);
      await uploadSlackFile({
        client,
        channelId,
        threadTs: messageTs,
        fileBuffer: outputBuffer,
        filename: outputFileName,
        title: outputFileName,
        initialComment: '',
      });

      // Create FilterJob record
      await prisma.filterJob.create({
        data: {
          slackChannelId: channelId,
          slackThreadTs: messageTs,
          slackUserId: conversation.userId,
          slackTeamId: conversation.teamId ?? '',
          status: 'COMPLETED',
          sourceFileName: conversation.fileName,
          sourceFileType: fileType === 'xlsx' ? 'XLSX' : 'CSV',
          sourceRowCount: result.originalCount,
          resultRowCount: result.filtered.length,
          filterCriteria: conversation.filterCriteria as any,
          filterMode: 'natural_language',
          resultFileUrl: s3Key,
          resultFileName: outputFileName,
          startedAt: now,
          completedAt: new Date(),
        },
      });

      // Post summary
      await client.chat.postMessage({
        channel: channelId,
        thread_ts: messageTs,
        blocks: buildFilterCompleteSummary(
          conversation.fileName || 'file',
          result.originalCount,
          result.filtered.length,
        ) as KnownBlock[],
        text: `Filtered: ${result.originalCount} → ${result.filtered.length} rows`,
      });
    } catch (error) {
      logger.error('Error applying filter', { error, channelId, messageTs });
      await client.chat.postMessage({
        channel: channelId,
        thread_ts: messageTs,
        text: 'An error occurred while applying the filter. Please try again.',
      });
    }
  });

  // --- Edit criteria (restart filter input) ---
  app.action('filter_edit_criteria', async ({ ack, body, client }) => {
    await ack();
    const channelId = body.channel?.id;
    const messageTs = (body as any).message?.thread_ts ?? (body as any).message?.ts;
    if (!channelId || !messageTs) return;

    // Clear existing criteria
    await updateConversation(channelId, messageTs, { filterCriteria: [] });

    const cached = await getCachedFilterData(channelId, messageTs);
    if (!cached) return;

    await client.chat.postMessage({
      channel: channelId,
      thread_ts: messageTs,
      blocks: buildFilterInputBlocks(cached.rows.length, cached.headers) as KnownBlock[],
      text: 'Enter new filter criteria.',
    });
  });

  // --- Cancel filter ---
  app.action('filter_cancel', async ({ ack, body, client }) => {
    await ack();
    const channelId = body.channel?.id;
    const ts = (body as any).message?.ts;
    if (!channelId || !ts) return;

    await client.chat.update({
      channel: channelId,
      ts,
      text: 'Filter cancelled.',
      blocks: [{ type: 'section', text: { type: 'mrkdwn', text: 'Filter cancelled.' } }],
    });
  });
}

// ---------------------------------------------------------------------------
// NL filter message handler (called from message listener)
// ---------------------------------------------------------------------------

/**
 * Handles a natural language filter message posted in a filter thread.
 * Called from the main message event listener when flowType is 'filter'.
 */
export async function handleFilterMessage(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any,
  channelId: string,
  threadTs: string,
  userMessage: string,
): Promise<void> {
  const cached = await getCachedFilterData(channelId, threadTs);
  if (!cached) {
    await client.chat.postMessage({
      channel: channelId,
      thread_ts: threadTs,
      text: 'Session expired. Please start over with /filter.',
    });
    return;
  }

  try {
    // Post a processing indicator
    await client.chat.postMessage({
      channel: channelId,
      thread_ts: threadTs,
      text: 'Parsing your filter criteria...',
    });

    // Parse NL filter via AI
    const parseResult = await parseFilterCriteria(
      userMessage,
      cached.headers,
      cached.rows,
    );

    // Guard rail: AI couldn't understand the filter instruction
    if (!parseResult.understood || parseResult.filters.length === 0) {
      const hint = parseResult.explanation
        ? `\n>${parseResult.explanation}`
        : '';
      await client.chat.postMessage({
        channel: channelId,
        thread_ts: threadTs,
        text: `I didn't understand that filter request. Please try again with a clearer instruction.${hint}\n\nExamples:\n- "Exclude rows where Company Size is less than 50"\n- "Only keep rows with Tech Spend Tier equal to Tier 1"\n- "Remove rows where Email is empty"\n\nOr use the *Browse Columns* option above to pick a column and filter visually.`,
      });
      return;
    }

    // Store parsed criteria
    await updateConversation(channelId, threadTs, {
      filterCriteria: parseResult.filters,
    });

    // Preview the filter result
    const preview = previewFilterCount(cached.rows, parseResult.filters, cached.headers);

    await client.chat.postMessage({
      channel: channelId,
      thread_ts: threadTs,
      blocks: buildFilterPreviewBlocks(
        parseResult.filters,
        cached.rows.length,
        preview.estimatedResultCount,
      ),
      text: `Filter preview: ${cached.rows.length} → ${preview.estimatedResultCount} rows`,
    });
  } catch (error) {
    logger.error('Error parsing NL filter', { error, channelId, threadTs });
    await client.chat.postMessage({
      channel: channelId,
      thread_ts: threadTs,
      text: 'Something went wrong processing your filter. Please try again, or use the structured form.',
    });
  }
}
