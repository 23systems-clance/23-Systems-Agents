/**
 * Action handlers for the /split interactive flow.
 *
 * Handles: file selection from S3, naming step (client + campaign name),
 * split mode selection, column selection for by-column splits, custom N
 * input via modal, preview confirmation, and output file generation + upload.
 */

import type { App } from '@slack/bolt';
import type { KnownBlock } from '@slack/types';
import {
  getConversation,
  updateConversation,
} from '../../services/state/conversationStore.js';
import { downloadFile, uploadFile } from '../../lib/storage.js';
import { parseFile } from '../../services/file/parser.js';
import { uploadSlackFile, markThreadForBotUpload } from '../../services/file/slackFile.js';
import {
  splitEqual,
  splitByColumn,
  analyzeColumnGroups,
  buildSplitFileName,
  detectCampaignName,
} from '../../services/split/splitEngine.js';
import {
  buildSplitNamingBlocks,
  buildSplitClientModal,
  buildSplitNamingModal,
  buildSplitModeSelectionBlocks,
  buildSplitColumnSelectionBlocks,
  buildSplitByColumnPreviewBlocks,
  buildSplitEqualPreviewBlocks,
  buildSplitCustomModal,
  buildSplitCompleteSummary,
} from '../../services/split/splitBlocks.js';
import { prisma } from '../../models/index.js';
import logger from '../../lib/logger.js';
import redis from '../../lib/redis.js';
import { stringify } from 'csv-stringify/sync';
import * as XLSX from 'xlsx';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Redis key prefix for cached parsed split data. */
const SPLIT_DATA_PREFIX = 'split-data';

/** TTL for cached split data (1 hour). */
const SPLIT_DATA_TTL = 3600;

/** Maximum number of files for by-column splits. */
const MAX_COLUMN_GROUPS = 100;

/** Delay between Slack file uploads to respect rate limits (ms). */
const UPLOAD_DELAY_MS = 200;

// ---------------------------------------------------------------------------
// Redis cache helpers
// ---------------------------------------------------------------------------

/**
 * Caches parsed file data in Redis for the split flow.
 */
async function cacheSplitData(
  channelId: string,
  threadTs: string,
  data: { rows: Record<string, string>[]; headers: string[] },
): Promise<void> {
  const key = `${SPLIT_DATA_PREFIX}:${channelId}:${threadTs}`;
  await redis.set(key, JSON.stringify(data), 'EX', SPLIT_DATA_TTL);
}

/**
 * Retrieves cached parsed file data from Redis.
 */
async function getCachedSplitData(
  channelId: string,
  threadTs: string,
): Promise<{ rows: Record<string, string>[]; headers: string[] } | null> {
  const key = `${SPLIT_DATA_PREFIX}:${channelId}:${threadTs}`;
  const raw = await redis.get(key);
  if (!raw) return null;
  return JSON.parse(raw) as { rows: Record<string, string>[]; headers: string[] };
}

// ---------------------------------------------------------------------------
// Output generation helpers
// ---------------------------------------------------------------------------

/**
 * Generates a CSV buffer from rows and headers.
 */
function generateCsv(
  rows: Record<string, string>[],
  headers: string[],
): Buffer {
  const output = stringify(rows, { header: true, columns: headers });
  return Buffer.from(output);
}

/**
 * Generates an XLSX buffer from rows and headers.
 */
function generateXlsx(
  rows: Record<string, string>[],
  headers: string[],
): Buffer {
  const wsData = [headers, ...rows.map((row) => headers.map((h) => row[h] ?? ''))];
  const ws = XLSX.utils.aoa_to_sheet(wsData);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Split');
  return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
}

/**
 * Small delay helper for rate limiting.
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Action handler registration
// ---------------------------------------------------------------------------

/**
 * Registers all /split flow action handlers.
 */
export function registerSplitFlowHandlers(app: App): void {
  // --- Use enrichment/filter result file from S3 ---
  app.action('split_use_enrichment_file', async ({ ack, body, client, action }) => {
    await ack();
    const channelId = body.channel?.id;
    const messageTs = (body as any).message?.thread_ts ?? (body as any).message?.ts;
    if (!channelId || !messageTs) return;

    const { jobId, s3Key, fileName, fileType } = JSON.parse(
      (action as any).value as string,
    );

    // Update selection message
    await client.chat.update({
      channel: channelId,
      ts: (body as any).message?.ts,
      text: `Selected: ${fileName}`,
      blocks: [{ type: 'section', text: { type: 'mrkdwn', text: `Selected *${fileName}* for splitting.` } }],
    });

    try {
      // Download from S3 and parse
      const fileBuffer = await downloadFile(s3Key);
      const mimeType = fileType === 'xlsx'
        ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        : 'text/csv';
      const parsed = parseFile(fileBuffer, mimeType);

      // Cache parsed data in Redis
      await cacheSplitData(channelId, messageTs, {
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

      // Show naming step
      const detectedName = detectCampaignName(fileName);
      await client.chat.postMessage({
        channel: channelId,
        thread_ts: messageTs,
        blocks: buildSplitNamingBlocks(fileName, detectedName) as KnownBlock[],
        text: 'How would you like to name the split output files?',
      });
    } catch (error) {
      logger.error('Error downloading file from S3 for split', { error, s3Key, jobId });
      await client.chat.postMessage({
        channel: channelId,
        thread_ts: messageTs,
        text: 'Failed to download the file. Please try again or upload a new file.',
      });
    }
  });

  // --- Upload new file button ---
  app.action('split_upload_new', async ({ ack, body, client }) => {
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

  // --- Naming: Use Existing Name (opens client-only modal) ---
  app.action('split_use_existing_name', async ({ ack, body, client, action }) => {
    await ack();
    const channelId = body.channel?.id;
    const messageTs = (body as any).message?.thread_ts ?? (body as any).message?.ts;
    if (!channelId || !messageTs) return;

    const campaignName = (action as any).value as string;
    const triggerId = (body as any).trigger_id;
    if (!triggerId) return;

    await client.views.open({
      trigger_id: triggerId,
      view: buildSplitClientModal(messageTs, channelId, campaignName) as any,
    });
  });

  // --- Naming: Update Name (opens full naming modal) ---
  app.action('split_update_name', async ({ ack, body, client, action }) => {
    await ack();
    const channelId = body.channel?.id;
    const messageTs = (body as any).message?.thread_ts ?? (body as any).message?.ts;
    if (!channelId || !messageTs) return;

    const detectedName = (action as any).value as string;
    const triggerId = (body as any).trigger_id;
    if (!triggerId) return;

    await client.views.open({
      trigger_id: triggerId,
      view: buildSplitNamingModal(messageTs, channelId, detectedName) as any,
    });
  });

  // --- Client-only modal submission ---
  app.view('split_client_submit', async ({ ack: ackView, view, client }) => {
    await ackView();

    const meta = JSON.parse(view.private_metadata);
    const { threadTs, channelId, campaignName } = meta;
    const clientName = view.state.values.client_name_block?.client_name_input?.value?.trim();

    if (!clientName) return;

    // Update naming message
    await client.chat.postMessage({
      channel: channelId,
      thread_ts: threadTs,
      text: `Files will be named: \`MMDD [${clientName}] ${campaignName} - Part N\``,
    });

    // Store naming in conversation state
    await updateConversation(channelId, threadTs, {
      splitClientName: clientName,
      splitCampaignName: campaignName,
    });

    // Show split mode selection
    const cached = await getCachedSplitData(channelId, threadTs);
    if (!cached) {
      await client.chat.postMessage({
        channel: channelId,
        thread_ts: threadTs,
        text: 'Session expired. Please start over with /split.',
      });
      return;
    }

    await client.chat.postMessage({
      channel: channelId,
      thread_ts: threadTs,
      blocks: buildSplitModeSelectionBlocks(cached.rows.length) as KnownBlock[],
      text: 'How would you like to split this list?',
    });
  });

  // --- Full naming modal submission ---
  app.view('split_naming_submit', async ({ ack: ackView, view, client }) => {
    await ackView();

    const meta = JSON.parse(view.private_metadata);
    const { threadTs, channelId } = meta;
    const clientName = view.state.values.client_name_block?.client_name_input?.value?.trim();
    const campaignName = view.state.values.campaign_name_block?.campaign_name_input?.value?.trim();

    if (!clientName || !campaignName) return;

    // Update naming message
    await client.chat.postMessage({
      channel: channelId,
      thread_ts: threadTs,
      text: `Files will be named: \`MMDD [${clientName}] ${campaignName} - Part N\``,
    });

    // Store naming in conversation state
    await updateConversation(channelId, threadTs, {
      splitClientName: clientName,
      splitCampaignName: campaignName,
    });

    // Show split mode selection
    const cached = await getCachedSplitData(channelId, threadTs);
    if (!cached) {
      await client.chat.postMessage({
        channel: channelId,
        thread_ts: threadTs,
        text: 'Session expired. Please start over with /split.',
      });
      return;
    }

    await client.chat.postMessage({
      channel: channelId,
      thread_ts: threadTs,
      blocks: buildSplitModeSelectionBlocks(cached.rows.length) as KnownBlock[],
      text: 'How would you like to split this list?',
    });
  });

  // --- Split Mode: Half ---
  app.action('split_mode_half', async ({ ack, body, client }) => {
    await ack();
    const channelId = body.channel?.id;
    const messageTs = (body as any).message?.thread_ts ?? (body as any).message?.ts;
    if (!channelId || !messageTs) return;

    await updateConversation(channelId, messageTs, {
      splitMode: 'half',
      splitCount: 2,
    });

    const cached = await getCachedSplitData(channelId, messageTs);
    if (!cached) return;

    await client.chat.update({
      channel: channelId,
      ts: (body as any).message?.ts,
      text: 'Split mode: In Half',
      blocks: buildSplitEqualPreviewBlocks(2, cached.rows.length) as KnownBlock[],
    });
  });

  // --- Split Mode: Quarters ---
  app.action('split_mode_quarters', async ({ ack, body, client }) => {
    await ack();
    const channelId = body.channel?.id;
    const messageTs = (body as any).message?.thread_ts ?? (body as any).message?.ts;
    if (!channelId || !messageTs) return;

    await updateConversation(channelId, messageTs, {
      splitMode: 'quarters',
      splitCount: 4,
    });

    const cached = await getCachedSplitData(channelId, messageTs);
    if (!cached) return;

    await client.chat.update({
      channel: channelId,
      ts: (body as any).message?.ts,
      text: 'Split mode: In Quarters',
      blocks: buildSplitEqualPreviewBlocks(4, cached.rows.length) as KnownBlock[],
    });
  });

  // --- Split Mode: By Column ---
  app.action('split_mode_by_column', async ({ ack, body, client }) => {
    await ack();
    const channelId = body.channel?.id;
    const messageTs = (body as any).message?.thread_ts ?? (body as any).message?.ts;
    if (!channelId || !messageTs) return;

    await updateConversation(channelId, messageTs, { splitMode: 'by_column' });

    const cached = await getCachedSplitData(channelId, messageTs);
    if (!cached) return;

    await client.chat.update({
      channel: channelId,
      ts: (body as any).message?.ts,
      text: 'Select a column to split by',
      blocks: buildSplitColumnSelectionBlocks(cached.headers) as KnownBlock[],
    });
  });

  // --- Column selected for by-column split ---
  app.action('split_column_select', async ({ ack, body, client, action }) => {
    await ack();
    const channelId = body.channel?.id;
    const messageTs = (body as any).message?.thread_ts ?? (body as any).message?.ts;
    if (!channelId || !messageTs) return;

    const columnName = (action as any).selected_option?.value as string;
    if (!columnName) return;

    await updateConversation(channelId, messageTs, { splitColumn: columnName });

    const cached = await getCachedSplitData(channelId, messageTs);
    if (!cached) return;

    const groups = analyzeColumnGroups(cached.rows, columnName);

    if (groups.length > MAX_COLUMN_GROUPS) {
      await client.chat.postMessage({
        channel: channelId,
        thread_ts: messageTs,
        text: `Column \`${columnName}\` has ${groups.length} unique values, which exceeds the maximum of ${MAX_COLUMN_GROUPS}. Please choose a different column.`,
      });
      await client.chat.postMessage({
        channel: channelId,
        thread_ts: messageTs,
        blocks: buildSplitColumnSelectionBlocks(cached.headers) as KnownBlock[],
        text: 'Select a different column.',
      });
      return;
    }

    await client.chat.postMessage({
      channel: channelId,
      thread_ts: messageTs,
      blocks: buildSplitByColumnPreviewBlocks(columnName, groups, cached.rows.length) as KnownBlock[],
      text: `Split by ${columnName}: ${groups.length} groups`,
    });
  });

  // --- Split Mode: Custom N-way ---
  app.action('split_mode_custom', async ({ ack, body, client }) => {
    await ack();
    const channelId = body.channel?.id;
    const messageTs = (body as any).message?.thread_ts ?? (body as any).message?.ts;
    if (!channelId || !messageTs) return;

    const triggerId = (body as any).trigger_id;
    if (!triggerId) return;

    const cached = await getCachedSplitData(channelId, messageTs);
    if (!cached) return;

    await client.views.open({
      trigger_id: triggerId,
      view: buildSplitCustomModal(messageTs, channelId, cached.rows.length) as any,
    });
  });

  // --- Custom N modal submission ---
  app.view('split_custom_submit', async ({ ack: ackView, view, client }) => {
    const meta = JSON.parse(view.private_metadata);
    const { threadTs, channelId } = meta;
    const rawN = view.state.values.split_count_block?.split_count_input?.value?.trim();
    const n = parseInt(rawN ?? '', 10);

    if (isNaN(n) || n < 2 || n > 100) {
      await ackView({
        response_action: 'errors',
        errors: {
          split_count_block: 'Please enter a number between 2 and 100.',
        },
      } as any);
      return;
    }

    await ackView();

    await updateConversation(channelId, threadTs, {
      splitMode: 'custom',
      splitCount: n,
    });

    const cached = await getCachedSplitData(channelId, threadTs);
    if (!cached) return;

    await client.chat.postMessage({
      channel: channelId,
      thread_ts: threadTs,
      blocks: buildSplitEqualPreviewBlocks(n, cached.rows.length) as KnownBlock[],
      text: `Split into ${n} parts preview`,
    });
  });

  // --- Confirm and execute split ---
  app.action('split_confirm_apply', async ({ ack, body, client }) => {
    await ack();
    const channelId = body.channel?.id;
    const messageTs = (body as any).message?.thread_ts ?? (body as any).message?.ts;
    if (!channelId || !messageTs) return;

    // Update the confirmation message
    await client.chat.update({
      channel: channelId,
      ts: (body as any).message?.ts,
      text: 'Splitting...',
      blocks: [{ type: 'section', text: { type: 'mrkdwn', text: 'Splitting...' } }],
    });

    const conversation = await getConversation(channelId, messageTs);
    if (!conversation?.splitMode) {
      await client.chat.postMessage({
        channel: channelId,
        thread_ts: messageTs,
        text: 'No split configuration found. Please start over.',
      });
      return;
    }

    const cached = await getCachedSplitData(channelId, messageTs);
    if (!cached) {
      await client.chat.postMessage({
        channel: channelId,
        thread_ts: messageTs,
        text: 'Session expired. Please start over with /split.',
      });
      return;
    }

    try {
      // Execute the split
      const splitResult = conversation.splitMode === 'by_column'
        ? splitByColumn(cached.rows, conversation.splitColumn!)
        : splitEqual(cached.rows, conversation.splitCount!);

      const clientName = conversation.splitClientName ?? 'Client';
      const campaignName = conversation.splitCampaignName ?? 'Target List';
      const fileType = (conversation.fileType ?? 'csv') as 'csv' | 'xlsx';
      const now = new Date();

      const resultFileUrls: string[] = [];
      const resultFileNames: string[] = [];
      const resultFileCounts: number[] = [];

      // Mark thread for bot upload ONCE before all uploads
      markThreadForBotUpload(channelId, messageTs);

      // Generate and upload each part
      const activeParts = splitResult.parts.filter((p) => p.rows.length > 0);

      for (let i = 0; i < activeParts.length; i++) {
        const part = activeParts[i];

        const outputFileName = buildSplitFileName(
          clientName,
          campaignName,
          part.label,
          fileType,
        );

        const outputBuffer = fileType === 'xlsx'
          ? generateXlsx(part.rows, cached.headers)
          : generateCsv(part.rows, cached.headers);

        // Upload to S3
        const s3Key = `split-results/${Date.now()}-${outputFileName}`;
        const contentType = fileType === 'xlsx'
          ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
          : 'text/csv';
        await uploadFile(s3Key, outputBuffer, contentType);

        // Upload to Slack
        await uploadSlackFile({
          client,
          channelId,
          threadTs: messageTs,
          fileBuffer: outputBuffer,
          filename: outputFileName,
          title: outputFileName,
          initialComment: '',
        });

        resultFileUrls.push(s3Key);
        resultFileNames.push(outputFileName);
        resultFileCounts.push(part.rows.length);

        // Rate limit delay between uploads
        if (i < activeParts.length - 1 && activeParts.length > 10) {
          await delay(UPLOAD_DELAY_MS);
        }
      }

      // Determine the Prisma SplitMode enum value
      const splitModeMap: Record<string, 'HALF' | 'QUARTERS' | 'BY_COLUMN' | 'CUSTOM'> = {
        half: 'HALF',
        quarters: 'QUARTERS',
        by_column: 'BY_COLUMN',
        custom: 'CUSTOM',
      };

      // Create SplitJob record
      await prisma.splitJob.create({
        data: {
          slackChannelId: channelId,
          slackThreadTs: messageTs,
          slackUserId: conversation.userId,
          slackTeamId: conversation.teamId ?? '',
          status: 'COMPLETED',
          sourceFileName: conversation.fileName,
          sourceFileType: fileType === 'xlsx' ? 'XLSX' : 'CSV',
          sourceRowCount: cached.rows.length,
          splitMode: splitModeMap[conversation.splitMode] ?? 'CUSTOM',
          splitColumn: conversation.splitColumn ?? null,
          splitCount: activeParts.length,
          clientName,
          campaignName,
          resultFileUrls,
          resultFileNames,
          resultFileCounts,
          startedAt: now,
          completedAt: new Date(),
        },
      });

      // Post summary
      const partsSummary = activeParts.map((p) => ({
        name: p.label,
        rowCount: p.rows.length,
      }));

      await client.chat.postMessage({
        channel: channelId,
        thread_ts: messageTs,
        blocks: buildSplitCompleteSummary(
          conversation.fileName || 'file',
          cached.rows.length,
          partsSummary.length,
          partsSummary,
        ) as KnownBlock[],
        text: `Split complete: ${cached.rows.length} rows into ${partsSummary.length} files`,
      });
    } catch (error) {
      logger.error('Error applying split', { error, channelId, messageTs });
      await client.chat.postMessage({
        channel: channelId,
        thread_ts: messageTs,
        text: 'An error occurred while splitting the file. Please try again.',
      });
    }
  });

  // --- Cancel split ---
  app.action('split_cancel', async ({ ack, body, client }) => {
    await ack();
    const channelId = body.channel?.id;
    const ts = (body as any).message?.ts;
    if (!channelId || !ts) return;

    await client.chat.update({
      channel: channelId,
      ts,
      text: 'Split cancelled.',
      blocks: [{ type: 'section', text: { type: 'mrkdwn', text: 'Split cancelled.' } }],
    });
  });
}
