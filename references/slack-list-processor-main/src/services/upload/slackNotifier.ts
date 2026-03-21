/**
 * Slack notification helper for config doc upload/delete events.
 *
 * Posts visible messages to the originating channel after dashboard actions.
 * Uses its own WebClient instance with the bot token.
 */

import { WebClient } from '@slack/web-api';
import { config } from '../../config/index.js';
import { DOC_TYPE_LABELS } from '../analyze/configDocService.js';
import type { ConfigDocType } from '@prisma/client';
import logger from '../../lib/logger.js';

const slack = new WebClient(config.slack.botToken);

/**
 * Posts a channel message confirming a config doc upload.
 * Fire-and-forget — errors are logged but don't propagate.
 */
export async function notifyConfigDocUpload(
  channelId: string,
  docType: ConfigDocType,
  version: number,
  displayLabel: string,
  userId: string,
): Promise<void> {
  try {
    const label = DOC_TYPE_LABELS[docType] || docType;
    await slack.chat.postMessage({
      channel: channelId,
      text: `:white_check_mark: *${label}* document uploaded (v${version}) by <@${userId}>\n_${displayLabel}_`,
    });
  } catch (err) {
    logger.warn('Failed to send upload notification to Slack', { channelId, docType, err });
  }
}

/**
 * Posts a channel message confirming a config doc deletion.
 * Fire-and-forget — errors are logged but don't propagate.
 */
export async function notifyConfigDocDelete(
  channelId: string,
  docType: ConfigDocType,
  userId: string,
): Promise<void> {
  try {
    const label = DOC_TYPE_LABELS[docType] || docType;
    await slack.chat.postMessage({
      channel: channelId,
      text: `:wastebasket: *${label}* document removed by <@${userId}>`,
    });
  } catch (err) {
    logger.warn('Failed to send delete notification to Slack', { channelId, docType, err });
  }
}
