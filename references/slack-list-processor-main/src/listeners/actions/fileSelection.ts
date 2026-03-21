/**
 * Bolt action handler for file selection when multiple files are uploaded.
 *
 * When a user uploads multiple CSV/XLSX files in the same thread and sends
 * an ENRICH command, they are prompted to select which file to enrich.
 * This handler processes that selection, updates the conversation state
 * to the chosen file, and re-triggers the ENRICH flow.
 */

import type { App } from '@slack/bolt';
import {
  getConversation,
  updateConversation,
} from '../../services/state/conversationStore.js';
import logger from '../../lib/logger.js';

/**
 * Registers file selection action handlers on the given Bolt app.
 *
 * Listens for action_ids matching `select_file_*` (regex). When a user
 * picks a file, updates the conversation state to point at the selected
 * file, clears the pendingFiles array, and posts a confirmation so the
 * user can re-send their ENRICH command.
 *
 * @param app - The Slack Bolt application instance.
 */
export function registerFileSelectionHandlers(app: App): void {
  app.action(/^select_file_\d+$/, async ({ ack, body, client }) => {
    await ack();

    const action = (body as any).actions?.[0];
    if (!action?.value) return;

    const channelId = (body as any).channel?.id;
    const threadTs = (body as any).message?.thread_ts ?? (body as any).message?.ts;

    if (!channelId || !threadTs) {
      logger.warn('File selection action missing channel or thread context');
      return;
    }

    let selectedFile: { fileId: string; fileName: string; fileType: string };
    try {
      selectedFile = JSON.parse(action.value);
    } catch {
      logger.error('Failed to parse file selection value', { value: action.value });
      return;
    }

    // Update conversation to point at the selected file and clear multi-file state.
    const conversation = await getConversation(channelId, threadTs);
    if (!conversation) {
      await client.chat.postMessage({
        channel: channelId,
        thread_ts: threadTs,
        text: 'Session expired. Please re-upload your file and try again.',
      });
      return;
    }

    await updateConversation(channelId, threadTs, {
      fileId: selectedFile.fileId,
      fileName: selectedFile.fileName,
      fileType: selectedFile.fileType as 'csv' | 'xlsx',
      pendingFiles: undefined,
    });

    logger.info('File selected from multi-file upload', {
      channelId,
      threadTs,
      selectedFile: selectedFile.fileName,
    });

    // Prompt the user to re-send their ENRICH command now that a file is selected.
    const enrichInstruction = conversation.enrichInstruction;
    await client.chat.postMessage({
      channel: channelId,
      thread_ts: threadTs,
      text: `Selected *${selectedFile.fileName}*. Please re-send your ENRICH command:\n> ${enrichInstruction ?? 'ENRICH ...'}`,
    });
  });
}
