/**
 * Channel lifecycle event listeners (T039).
 *
 * Handles channel_deleted and member_left_channel events to deactivate
 * enrichment channels when the channel is deleted or the bot is removed.
 */

import type { App } from '@slack/bolt';
import { deactivateChannel } from '../../services/workspace/enrichmentChannelManager.js';
import { prisma } from '../../models/index.js';
import logger from '../../lib/logger.js';

/**
 * Registers channel lifecycle event listeners.
 *
 * @param app - Slack Bolt app instance.
 */
export function registerChannelLifecycleListeners(app: App): void {
  // Handle channel deletion
  app.event('channel_deleted', async ({ event, context }) => {
    const channelId = event.channel;
    const teamId = context.teamId ?? '';

    logger.info('channel_deleted event received', { channelId, teamId });

    const deactivated = await deactivateChannel(teamId, channelId);

    if (deactivated) {
      // Look up the assigned user to notify them
      const channel = await prisma.enrichmentChannel.findUnique({
        where: { slackTeamId_slackChannelId: { slackTeamId: teamId, slackChannelId: channelId } },
        select: { assignedUserId: true },
      });

      if (channel?.assignedUserId) {
        try {
          await app.client.chat.postMessage({
            channel: channel.assignedUserId,
            text: 'Your enrichment channel has been deleted. Please create a new private channel and invite the bot to set up a new enrichment channel.',
          });
        } catch (err) {
          logger.warn('Failed to send channel deletion DM', {
            userId: channel.assignedUserId,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      logger.info('Enrichment channel deactivated due to channel deletion', { channelId, teamId });
    }
  });

  // Handle bot being removed from a channel
  app.event('member_left_channel', async ({ event, context }) => {
    const botUserId = context.botUserId;

    // Only react when the BOT is the one leaving
    if (event.user !== botUserId) {
      return;
    }

    const channelId = event.channel;
    const teamId = context.teamId ?? '';

    logger.info('Bot removed from channel', { channelId, teamId });

    // Look up the assigned user before deactivating
    const channelRecord = await prisma.enrichmentChannel.findUnique({
      where: { slackTeamId_slackChannelId: { slackTeamId: teamId, slackChannelId: channelId } },
      select: { assignedUserId: true, status: true },
    });

    if (!channelRecord || channelRecord.status !== 'ACTIVE') {
      return;
    }

    const deactivated = await deactivateChannel(teamId, channelId);

    if (deactivated && channelRecord.assignedUserId) {
      try {
        await app.client.chat.postMessage({
          channel: channelRecord.assignedUserId,
          text: 'The bot was removed from your enrichment channel, so it has been deactivated. To set up a new enrichment channel, create a private channel and invite the bot.',
        });
      } catch (err) {
        logger.warn('Failed to send bot removal DM', {
          userId: channelRecord.assignedUserId,
          error: err instanceof Error ? err.message : String(err),
        });
      }

      logger.info('Enrichment channel deactivated due to bot removal', { channelId, teamId });
    }
  });
}
