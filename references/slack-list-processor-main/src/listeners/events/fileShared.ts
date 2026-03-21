/**
 * Bolt file_shared event handler (T018).
 *
 * Listens for file uploads in channels the bot is a member of.
 * When a CSV or XLSX file is detected, posts a Block Kit message
 * prompting the user to use the ENRICH prefix and stores a pending
 * file reference in the conversation store.
 */

import type { App } from '@slack/bolt';
import type { KnownBlock } from '@slack/types';
import { getConversation, setConversation } from '../../services/state/conversationStore.js';
import type { PendingFile } from '../../services/state/conversationStore.js';
import { isBotUpload, isThreadExpectingBotUpload, getBotUserId } from '../../services/file/slackFile.js';
import { handleConfigDocUpload } from '../actions/analyzeFlow.js';
import { isDocsChannel } from '../../services/document/channelDetector.js';
// import { handleDocumentUpload } from './fileSharedDocument.js'; // Disabled
import { startExecution } from '../../services/workflow/workflowEngine.js';
import { renderNodeToSlackBlocks } from '../../services/workflow/workflowSlackRenderer.js';
import { isPlatformOwner } from '../../services/workspace/platformOwner.js';
import { verifyChannelAccess } from '../../services/workspace/enrichmentChannelManager.js';
import logger from '../../lib/logger.js';

/** MIME types accepted as CSV uploads. */
const CSV_MIME_TYPES = new Set([
  'text/csv',
  'text/plain',
  'application/csv',
]);

/** MIME types accepted as XLSX uploads. */
const XLSX_MIME_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
]);

/** MIME types accepted as document uploads (ICP, Use Case, Settings, etc.). */
const DOCUMENT_MIME_TYPES = new Set([
  'text/markdown',
  'text/plain',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);

/**
 * Registers the file_shared event listener on the given Bolt app.
 *
 * When a user uploads a CSV or XLSX file, the handler:
 * 1. Fetches file metadata via client.files.info
 * 2. Validates the MIME type (CSV or XLSX)
 * 3. Posts a Block Kit prompt asking the user to use the ENRICH prefix
 * 4. Stores the pending file reference in conversationStore (1-hour TTL)
 *
 * @param app - The Slack Bolt application instance.
 */
export function registerFileSharedListener(app: App): void {
  app.event('file_shared', async ({ event, client, context }) => {
    logger.info('file_shared event received', {
      fileId: event.file_id,
      userId: event.user_id,
      channelId: event.channel_id,
      eventTs: event.event_ts,
    });
    try {
      // Layer 1: Check event.user_id against cached bot user ID (most reliable).
      const cachedBotId = getBotUserId();
      const boltBotId = context.botUserId;
      const botUserId = cachedBotId ?? boltBotId;

      if (botUserId && event.user_id === botUserId) {
        logger.info('Ignoring file_shared from bot (user_id match)', {
          fileId: event.file_id,
          userId: event.user_id,
          botUserId,
          source: cachedBotId ? 'cached' : 'context',
        });
        return;
      }

      // Layer 2: Check file ID tracking (works when uploadV2 resolves before event).
      if (isBotUpload(event.file_id)) {
        logger.info('Ignoring file_shared from bot (file ID tracked)', {
          fileId: event.file_id,
        });
        return;
      }

      // Fetch full file metadata from Slack.
      const fileInfo = await client.files.info({ file: event.file_id });
      const file = fileInfo.file;

      if (!file) {
        logger.warn('file_shared event received but files.info returned no file', {
          fileId: event.file_id,
        });
        return;
      }

      // Layer 3: Check file.user against bot user ID (file metadata from API).
      const fileUser = (file as Record<string, unknown>).user as string | undefined;
      if (botUserId && fileUser === botUserId) {
        logger.info('Ignoring file_shared from bot (file.user matches botUserId)', {
          fileId: event.file_id,
          fileUser,
          botUserId,
        });
        return;
      }

      const mimetype = file.mimetype ?? '';

      // Determine the channel and thread timestamp for the reply.
      const channelId = event.channel_id;

      // Extract the actual file upload message ts from file.shares.
      // The file_shared event_ts is NOT the same as the message ts that
      // Slack uses as the thread parent. We must get it from shares.
      let threadTs = event.event_ts;

      const shares = file.shares as
        | Record<string, Record<string, Array<{ ts: string }>>>
        | undefined;
      if (shares) {
        const channelShares =
          shares['public']?.[channelId] ?? shares['private']?.[channelId];
        if (channelShares?.[0]?.ts) {
          threadTs = channelShares[0].ts;
        }
      }

      // Layer 4: Check thread-based tracking (set BEFORE upload to avoid race condition).
      if (isThreadExpectingBotUpload(channelId, threadTs)) {
        logger.debug('Ignoring file_shared from bot (thread expecting bot upload)', {
          fileId: event.file_id,
          channelId,
          threadTs,
        });
        return;
      }

      // Log all detection values for debugging if file passes all checks.
      logger.debug('file_shared passed all bot detection checks', {
        fileId: event.file_id,
        userId: event.user_id,
        botUserId,
        fileUser,
        channelId,
        threadTs,
        mimetype,
      });

      // If this is a docs channel, defer to the document upload handler.
      const teamId = context.teamId ?? '';
      let channelName: string | undefined;
      try {
        const channelInfo = await client.conversations.info({ channel: channelId });
        channelName = channelInfo.channel?.name ?? undefined;
      } catch {
        // Channel name lookup failure is non-fatal for this check.
      }
      if (await isDocsChannel(teamId, channelId, channelName)) {
        logger.info('file_shared in docs channel, document upload disabled', {
          fileId: event.file_id,
          channelId,
        });
        // Document upload feature disabled - Feature 22
        // await handleDocumentUpload(client, { fileId, userId, channelId, teamId, file, threadTs });
        return;
      }

      const fileName = file.name ?? 'unknown';

      // Check if this thread is expecting a config doc upload for /analyze.
      const existingConv = await getConversation(channelId, threadTs);
      if (existingConv?.flowType === 'analyze_config_upload') {
        const downloadUrl = (file as Record<string, unknown>).url_private as string | undefined;
        if (downloadUrl) {
          await handleConfigDocUpload(
            {
              fileId: event.file_id,
              fileName,
              fileUrl: downloadUrl,
              channelId,
              threadTs,
              userId: event.user_id,
            },
            client,
          );
        }
        return;
      }

      // --- Workflow engine integration (FR-045 fallback) ---
      // Check if there's an active workflow for FILE_UPLOAD trigger.
      // If so, start workflow execution instead of the legacy list type prompt.
      try {
        const workflowResult = await startExecution({
          triggerType: 'FILE_UPLOAD',
          slackTeamId: teamId,
          slackUserId: event.user_id,
          slackChannelId: channelId,
          slackThreadTs: threadTs,
          initialContext: { fileId: event.file_id, fileName },
        });

        if (workflowResult) {
          logger.info('Workflow execution started for file upload', {
            executionId: workflowResult.execution.id,
            fileId: event.file_id,
            channelId,
          });

          // Render the current node (where execution paused) to Slack
          if (workflowResult.currentNode) {
            const context = (workflowResult.execution.context as Record<string, unknown>) ?? {};
            const slackPayload = renderNodeToSlackBlocks(
              workflowResult.currentNode,
              workflowResult.execution.id,
              context,
            );

            if (slackPayload) {
              await client.chat.postMessage({
                channel: channelId,
                thread_ts: threadTs,
                ...slackPayload,
              });
            }
          }

          // Workflow handled the file upload — skip legacy flow
          return;
        }
        // workflowResult is null — no active workflow, fall through to legacy flow
      } catch (workflowError) {
        logger.error('Error starting workflow execution, falling back to legacy flow', {
          fileId: event.file_id,
          error: workflowError instanceof Error ? workflowError.message : String(workflowError),
        });
        // Fall through to legacy flow on error
      }
      // --- End workflow engine integration ---

      // --- Enrichment list detection (CSV/XLSX) - must come BEFORE document detection ---
      // Determine file type for spreadsheets.
      const isCSV = CSV_MIME_TYPES.has(mimetype);
      const isXLSX = XLSX_MIME_TYPES.has(mimetype);

      // If it's a CSV or XLSX, treat it as a potential enrichment list first.
      // Only fall through to document detection if user explicitly cancels.
      if (isCSV || isXLSX) {
        // --- Feature 35 (T076): Check onboarding status for client workspaces ---
        const onboardingStatus = (context as Record<string, unknown>).onboardingStatus as string | undefined;
        const isOwner = isPlatformOwner(teamId);
        if (!isOwner && onboardingStatus && onboardingStatus !== 'COMPLETE') {
          await client.chat.postMessage({
            channel: channelId,
            thread_ts: threadTs,
            text: 'Please complete your workspace onboarding before running enrichments. Open the app home tab to continue setup.',
          });
          return;
        }

        // --- Feature 35 (T037): Check enrichment channel access for client workspaces ---
        if (!isOwner) {
          const access = await verifyChannelAccess(teamId, channelId, event.user_id);
          if (!access.isRegisteredChannel) {
            // Channel is not registered — inform user
            await client.chat.postMessage({
              channel: channelId,
              thread_ts: threadTs,
              text: 'This channel is not set up for enrichment. To get started, invite the bot to a private channel and register it as your enrichment channel, or ask your admin for help.',
            });
            return;
          }
          if (!access.authorized) {
            // Channel is registered but user is not the assigned user
            await client.chat.postMessage({
              channel: channelId,
              thread_ts: threadTs,
              text: `This enrichment channel is assigned to <@${access.assignedUserId}>. Only the assigned user can trigger enrichments here.`,
            });
            return;
          }
        }
        // --- End Feature 35 enrichment channel check ---

        // This is a spreadsheet - prompt for list type (Company List vs Contact List).
        // Continue with enrichment list flow below...
      } else {
        // --- Universal document detection (for non-spreadsheet files) ---
        // Check if this is a document type (ICP, Use Case, etc.) - handle in ANY channel.
        const isDocumentType = DOCUMENT_MIME_TYPES.has(mimetype);
        if (isDocumentType) {
          logger.info('File is a document type, document upload disabled', {
            mimetype,
            fileId: event.file_id,
            channelId,
          });
          // Document upload feature disabled - Feature 22
          // await handleDocumentUpload(client, { fileId, userId, channelId, teamId, file, threadTs });
          return;
        }

        // Not a supported file type; inform user.
        logger.debug('file_shared: unsupported mime type, informing user', {
          fileId: event.file_id,
          mimetype,
          fileName,
        });
        await client.chat.postMessage({
          channel: channelId,
          thread_ts: threadTs,
          text: `Sorry, I don't support this file type yet. Supported types:\n• Spreadsheets: CSV, Excel\n• Documents: Markdown, PDF, Word`,
        });
        return;
      }

      // --- Continue with enrichment list flow for CSV/XLSX ---

      const fileType: 'csv' | 'xlsx' = isCSV ? 'csv' : 'xlsx';

      const newFile: PendingFile = {
        fileId: event.file_id,
        fileName,
        fileType,
      };

      // Check if there's already a conversation for this thread (multi-file upload).
      const existing = existingConv;
      let pendingFiles: PendingFile[] = existing?.pendingFiles ? [...existing.pendingFiles] : [];

      // If a file with the same name already exists, replace it (cache-busting).
      // This ensures we always use the newest file_id when re-uploading the same file.
      const existingFileIndex = pendingFiles.findIndex((f) => f.fileName === fileName);
      if (existingFileIndex !== -1) {
        logger.info('Replacing existing file with same name (cache-busting)', {
          fileName,
          oldFileId: pendingFiles[existingFileIndex]?.fileId,
          newFileId: event.file_id,
        });
        pendingFiles[existingFileIndex] = newFile;
      } else {
        pendingFiles.push(newFile);
      }

      // Build the prompt message based on file count.
      const userMention = `<@${event.user_id}>`;
      let promptText: string;
      let blocks: KnownBlock[];

      if (pendingFiles.length === 1) {
        promptText =
          `${userMention} I detected your file - *${fileName}*\n\n` +
          'What type of list is this?';
        blocks = [
          {
            type: 'section',
            text: { type: 'mrkdwn', text: promptText },
          },
          {
            type: 'actions',
            block_id: 'list_type_selection',
            elements: [
              {
                type: 'button',
                text: { type: 'plain_text', text: 'Company List', emoji: true },
                action_id: 'list_type_company',
                style: 'primary',
              },
              {
                type: 'button',
                text: { type: 'plain_text', text: 'Contact List', emoji: true },
                action_id: 'list_type_contact',
              },
              {
                type: 'button',
                text: { type: 'plain_text', text: 'Split', emoji: true },
                action_id: 'file_upload_split',
              },
              {
                type: 'button',
                text: { type: 'plain_text', text: 'Filter', emoji: true },
                action_id: 'file_upload_filter',
              },
              {
                type: 'button',
                text: { type: 'plain_text', text: 'Cancel', emoji: true },
                action_id: 'file_detection_cancel',
                style: 'danger',
              },
            ],
          },
        ];
      } else {
        const fileList = pendingFiles
          .map((f, i) => `${i + 1}. ${f.fileName}`)
          .join('\n');
        promptText =
          `${userMention} I detected another file - *${fileName}*\n\n` +
          `You now have ${pendingFiles.length} files uploaded:\n${fileList}\n\n` +
          'What type of list is this?';
        blocks = [
          {
            type: 'section',
            text: { type: 'mrkdwn', text: promptText },
          },
          {
            type: 'actions',
            block_id: 'list_type_selection',
            elements: [
              {
                type: 'button',
                text: { type: 'plain_text', text: 'Company List', emoji: true },
                action_id: 'list_type_company',
                style: 'primary',
              },
              {
                type: 'button',
                text: { type: 'plain_text', text: 'Contact List', emoji: true },
                action_id: 'list_type_contact',
              },
              {
                type: 'button',
                text: { type: 'plain_text', text: 'Split', emoji: true },
                action_id: 'file_upload_split',
              },
              {
                type: 'button',
                text: { type: 'plain_text', text: 'Filter', emoji: true },
                action_id: 'file_upload_filter',
              },
              {
                type: 'button',
                text: { type: 'plain_text', text: 'Cancel', emoji: true },
                action_id: 'file_detection_cancel',
                style: 'danger',
              },
            ],
          },
        ];
      }

      // Post Block Kit message in thread.
      const botReply = await client.chat.postMessage({
        channel: channelId,
        thread_ts: threadTs,
        blocks,
        text: promptText.replace(/\*/g, ''),
      });

      const replyThreadTs = botReply.ts ?? threadTs;
      const eventTs = event.event_ts;

      // Use the most recent file (last in pendingFiles array) as the primary file.
      // This ensures we always use the latest upload when re-uploading the same file.
      const primaryFile = pendingFiles[pendingFiles.length - 1] ?? newFile;

      // Store conversation under every possible thread key so the
      // ENRICH reply can find it regardless of which ts Slack uses.
      const conversationData = {
        fileId: primaryFile.fileId,
        fileName: primaryFile.fileName,
        fileType: primaryFile.fileType,
        userId: event.user_id,
        channelId,
        threadTs,
        status: 'pending' as const,
        pendingFiles,
      };

      // Deduplicate the keys before storing.
      const keys = Array.from(new Set([threadTs, replyThreadTs, eventTs]));
      for (const key of keys) {
        await setConversation(channelId, key, conversationData);
      }

      logger.info('File detected and conversation stored', {
        fileId: event.file_id,
        fileName,
        fileType,
        fileCount: pendingFiles.length,
        channelId,
        fileMessageTs: threadTs,
        replyThreadTs,
        eventTs,
        userId: event.user_id,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Error handling file_shared event', {
        fileId: event.file_id,
        error: errorMessage,
      });
    }
  });
}
