/**
 * Action handlers for "Split" and "Filter" buttons shown on the file
 * upload detection prompt. These bridge the uploaded file into the
 * existing /split and /filter interactive flows.
 */

import type { App } from '@slack/bolt';
import type { KnownBlock } from '@slack/types';
import {
  getConversation,
  updateConversation,
} from '../../services/state/conversationStore.js';
import { downloadSlackFile } from '../../services/file/slackFile.js';
import { parseFile } from '../../services/file/parser.js';
import {
  buildSplitNamingBlocks,
} from '../../services/split/splitBlocks.js';
import {
  buildFilterInputBlocks,
  buildFilterListTypeBlocks,
} from '../../services/filter/filterBlocks.js';
import { detectCampaignName } from '../../services/split/splitEngine.js';
import { config } from '../../config/index.js';
import redis from '../../lib/redis.js';
import logger from '../../lib/logger.js';

/** Redis key prefixes (must match splitFlow.ts and filterFlow.ts). */
const SPLIT_DATA_PREFIX = 'split-data';
const FILTER_DATA_PREFIX = 'filter-data';
const CACHE_TTL = 3600;

/**
 * Downloads the pending file from Slack and parses it.
 */
async function downloadAndParse(
  client: any,
  fileId: string,
  fileType: string,
): Promise<{ rows: Record<string, string>[]; headers: string[]; rowCount: number }> {
  const fileInfo = await client.files.info({ file: fileId });
  const downloadUrl = fileInfo.file?.url_private;
  if (!downloadUrl) throw new Error('Unable to access file download URL');

  const fileBuffer = await downloadSlackFile(downloadUrl, config.slack.botToken);
  const mimeType = fileType === 'xlsx'
    ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    : 'text/csv';
  return parseFile(fileBuffer, mimeType);
}

/**
 * Registers action handlers for the file upload Split and Filter buttons.
 */
export function registerFileUploadActionHandlers(app: App): void {
  // --- Split button on file upload prompt ---
  app.action('file_upload_split', async ({ ack, body, client }) => {
    await ack();
    const channelId = body.channel?.id;
    const messageTs = (body as any).message?.thread_ts ?? (body as any).message?.ts;
    if (!channelId || !messageTs) return;

    const conversation = await getConversation(channelId, messageTs);
    if (!conversation?.fileId) {
      await client.chat.postMessage({
        channel: channelId,
        thread_ts: messageTs,
        text: 'Could not find the uploaded file. Please re-upload and try again.',
      });
      return;
    }

    // Update the original message to reflect selection
    await client.chat.update({
      channel: channelId,
      ts: (body as any).message?.ts,
      text: `Action selected: *Split*`,
      blocks: [{ type: 'section', text: { type: 'mrkdwn', text: `Action selected: *Split*` } }],
    });

    try {
      // Download and parse the uploaded file
      const parsed = await downloadAndParse(client, conversation.fileId, conversation.fileType);

      // Cache parsed data in Redis (same key format as splitFlow.ts)
      const cacheKey = `${SPLIT_DATA_PREFIX}:${channelId}:${messageTs}`;
      await redis.set(cacheKey, JSON.stringify({ rows: parsed.rows, headers: parsed.headers }), 'EX', CACHE_TTL);

      // Switch conversation to split flow
      await updateConversation(channelId, messageTs, {
        flowType: 'split',
      });

      // Show the split naming step (same as splitFlow.ts)
      const detectedName = detectCampaignName(conversation.fileName);
      await client.chat.postMessage({
        channel: channelId,
        thread_ts: messageTs,
        blocks: buildSplitNamingBlocks(conversation.fileName, detectedName) as KnownBlock[],
        text: 'How would you like to name the split output files?',
      });
    } catch (error) {
      logger.error('Error starting split from file upload', { error, channelId, messageTs });
      await client.chat.postMessage({
        channel: channelId,
        thread_ts: messageTs,
        text: 'Failed to process the file for splitting. Please try again.',
      });
    }
  });

  // --- Filter button on file upload prompt ---
  app.action('file_upload_filter', async ({ ack, body, client }) => {
    await ack();
    const channelId = body.channel?.id;
    const messageTs = (body as any).message?.thread_ts ?? (body as any).message?.ts;
    if (!channelId || !messageTs) return;

    const conversation = await getConversation(channelId, messageTs);
    if (!conversation?.fileId) {
      await client.chat.postMessage({
        channel: channelId,
        thread_ts: messageTs,
        text: 'Could not find the uploaded file. Please re-upload and try again.',
      });
      return;
    }

    // Update the original message to reflect selection
    await client.chat.update({
      channel: channelId,
      ts: (body as any).message?.ts,
      text: `Action selected: *Filter*`,
      blocks: [{ type: 'section', text: { type: 'mrkdwn', text: `Action selected: *Filter*` } }],
    });

    try {
      // Download and parse the uploaded file
      const parsed = await downloadAndParse(client, conversation.fileId, conversation.fileType);

      // Cache parsed data in Redis (same key format as filterFlow.ts)
      const cacheKey = `${FILTER_DATA_PREFIX}:${channelId}:${messageTs}`;
      await redis.set(cacheKey, JSON.stringify({ rows: parsed.rows, headers: parsed.headers }), 'EX', CACHE_TTL);

      // Switch conversation to filter flow
      await updateConversation(channelId, messageTs, {
        flowType: 'filter',
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
        // Ask user to identify list type before showing filter UI
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
      logger.error('Error starting filter from file upload', { error, channelId, messageTs });
      await client.chat.postMessage({
        channel: channelId,
        thread_ts: messageTs,
        text: 'Failed to process the file for filtering. Please try again.',
      });
    }
  });
}
