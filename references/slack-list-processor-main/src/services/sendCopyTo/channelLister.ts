/**
 * Channel listing utility (T033).
 *
 * Lists accessible Slack channels (public + private) for a workspace
 * with a 5-minute Redis cache per workspace.
 */

import type { WebClient } from '@slack/web-api';
import redis from '../../lib/redis.js';
import logger from '../../lib/logger.js';

/** Channel info for display. */
export interface SlackChannelInfo {
  id: string;
  name: string;
  isPrivate: boolean;
  memberCount: number;
}

/** Cache TTL in seconds (5 minutes). */
const CACHE_TTL = 300;

/**
 * Lists all accessible channels (public + private) for a workspace.
 *
 * Uses the `conversations.list` API with pagination and caches results
 * in Redis for 5 minutes per workspace to reduce API calls.
 *
 * @param slackTeamId - Workspace team ID (for cache key).
 * @param client      - Slack Web API client with bot token.
 * @returns Array of channel info objects.
 */
export async function listAccessibleChannels(
  slackTeamId: string,
  client: WebClient,
): Promise<SlackChannelInfo[]> {
  const cacheKey = `channels:list:${slackTeamId}`;

  // Check cache first
  const cached = await redis.get(cacheKey);
  if (cached) {
    try {
      return JSON.parse(cached) as SlackChannelInfo[];
    } catch {
      // Invalid cache — fall through to API call
    }
  }

  const channels: SlackChannelInfo[] = [];
  let cursor: string | undefined;

  try {
    do {
      const result = await client.conversations.list({
        types: 'public_channel,private_channel',
        exclude_archived: true,
        limit: 200,
        cursor,
      });

      for (const channel of result.channels ?? []) {
        if (channel.id && channel.name) {
          channels.push({
            id: channel.id,
            name: channel.name,
            isPrivate: channel.is_private ?? false,
            memberCount: channel.num_members ?? 0,
          });
        }
      }

      cursor = result.response_metadata?.next_cursor || undefined;
    } while (cursor);

    // Cache for 5 minutes
    await redis.setex(cacheKey, CACHE_TTL, JSON.stringify(channels));

    logger.info('Channel list fetched and cached', {
      slackTeamId,
      channelCount: channels.length,
    });
  } catch (error) {
    logger.error('Failed to list channels', {
      slackTeamId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return channels;
}
