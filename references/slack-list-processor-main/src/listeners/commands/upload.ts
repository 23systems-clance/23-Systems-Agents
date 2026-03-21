/**
 * Slash command handler for /upload.
 *
 * Generates a JWT-secured link to the admin dashboard upload page
 * where users can upload config documents (ICP, Use Cases, Campaigns, Settings).
 */

import type { App } from '@slack/bolt';
import { generateUploadToken } from '../../services/upload/tokenService.js';
import { config } from '../../config/index.js';
import logger from '../../lib/logger.js';

/**
 * Registers the /upload command handler.
 */
export function registerUploadCommand(app: App): void {
  app.command('/upload', async ({ command, ack, respond }) => {
    await ack();

    const { team_id: teamId, channel_id: channelId, user_id: userId, channel_name: channelName } = command;

    // Block usage in DMs (no channel context)
    if (channelName === 'directmessage') {
      await respond({
        response_type: 'ephemeral',
        text: 'This command must be used in a channel, not a direct message.',
      });
      return;
    }

    const token = generateUploadToken(teamId, channelId, userId);
    const uploadUrl = `${config.dashboardUrl}/upload/${token}`;

    logger.info('Upload link generated', { teamId, channelId, userId });

    await respond({
      response_type: 'ephemeral',
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: ':page_facing_up: *Upload Config Documents*\nClick the link below to manage your channel\'s configuration documents (ICP, Use Cases, Campaigns, Settings).',
          },
        },
        {
          type: 'actions',
          elements: [
            {
              type: 'button',
              text: { type: 'plain_text', text: 'Open Upload Page' },
              url: uploadUrl,
              style: 'primary',
            },
          ],
        },
        {
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: 'This link expires in 24 hours.',
            },
          ],
        },
      ],
    });
  });
}
