/**
 * Action handler for cancelling file detection flow.
 *
 * When user clicks the "Cancel" button on the "What type of list is this?" prompt,
 * this handler:
 * 1. Clears pending files from Redis conversation store
 * 2. Deletes the prompt message
 * 3. Sends ephemeral confirmation to the user
 */

import type { App } from '@slack/bolt';
import { deleteConversation } from '../../services/state/conversationStore.js';
import logger from '../../lib/logger.js';

/**
 * Registers the file_detection_cancel action handler.
 *
 * @param app - The Slack Bolt application instance.
 */
export function registerFileDetectionCancelAction(app: App): void {
  app.action('file_detection_cancel', async ({ ack, body, client }) => {
    await ack();

    if (body.type !== 'block_actions') {
      return;
    }

    const teamId = body.team?.id;
    const channelId = body.channel?.id;
    const messageTs = body.message?.ts;
    const userId = body.user.id;

    if (!teamId || !channelId || !messageTs || !userId) {
      logger.error('Missing required IDs in file detection cancel', {
        teamId,
        channelId,
        messageTs,
        userId,
      });
      return;
    }

    // Clear pending files from Redis
    await deleteConversation(channelId, messageTs);

    // Delete the prompt message
    try {
      await client.chat.delete({
        channel: channelId,
        ts: messageTs,
      });
    } catch (error) {
      logger.error('Failed to delete file detection message', {
        error: error instanceof Error ? error.message : String(error),
        channelId,
        messageTs,
      });
    }

    // Send ephemeral confirmation
    try {
      await client.chat.postEphemeral({
        channel: channelId,
        user: userId,
        text: 'File upload cancelled',
      });
    } catch (error) {
      logger.error('Failed to send ephemeral confirmation', {
        error: error instanceof Error ? error.message : String(error),
        channelId,
        userId,
      });
    }

    logger.info('File detection cancelled by user', {
      teamId,
      channelId,
      userId,
      messageTs,
    });
  });
}
