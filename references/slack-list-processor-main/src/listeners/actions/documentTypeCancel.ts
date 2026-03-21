/**
 * Action handler for cancelling document type confirmation flow.
 *
 * When user clicks the "Cancel" button on document type confirmation,
 * this handler:
 * 1. Clears pending classification state from Redis
 * 2. Deletes the confirmation message
 * 3. Sends ephemeral confirmation to the user
 */

import type { App } from '@slack/bolt';
import redis from '../../lib/redis.js';
import logger from '../../lib/logger.js';

/** Redis key prefix for pending classification state. */
const CLASSIFY_STATE_PREFIX = 'doc-classify';

/**
 * Registers the document_type_cancel action handler.
 *
 * @param app - The Slack Bolt application instance.
 */
export function registerDocumentTypeCancelAction(app: App): void {
  app.action('document_type_cancel', async ({ ack, body, client }) => {
    await ack();

    if (body.type !== 'block_actions') {
      return;
    }

    const teamId = body.team?.id;
    const channelId = body.channel?.id;
    const messageTs = body.message?.ts;
    const userId = body.user.id;

    if (!teamId || !channelId || !messageTs || !userId) {
      logger.error('Missing required IDs in document type cancel', {
        teamId,
        channelId,
        messageTs,
        userId,
      });
      return;
    }

    // Clear pending classification state from Redis
    const stateKey = `${CLASSIFY_STATE_PREFIX}:${channelId}:${messageTs}`;
    try {
      await redis.del(stateKey);
    } catch (error) {
      logger.error('Failed to delete classification state', {
        error: error instanceof Error ? error.message : String(error),
        stateKey,
      });
    }

    // Delete the confirmation message
    try {
      await client.chat.delete({
        channel: channelId,
        ts: messageTs,
      });
    } catch (error) {
      logger.error('Failed to delete document type confirmation message', {
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
        text: 'Document upload cancelled',
      });
    } catch (error) {
      logger.error('Failed to send ephemeral confirmation', {
        error: error instanceof Error ? error.message : String(error),
        channelId,
        userId,
      });
    }

    logger.info('Document type confirmation cancelled by user', {
      teamId,
      channelId,
      userId,
      messageTs,
    });
  });
}
