/**
 * Admin endpoint to list Slack workspace channels.
 *
 * Returns public and private channels the bot has access to, so the admin
 * dashboard can present a searchable channel picker for channel-client mappings.
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { WebClient } from '@slack/web-api';
import { config } from '../../config/index.js';
import logger from '../../lib/logger.js';

const router = Router();

/** Per-teamId cached channel list. */
const channelCache = new Map<string, { channels: SlackChannelDto[]; fetchedAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface SlackChannelDto {
  id: string;
  name: string;
  isPrivate: boolean;
  memberCount: number;
  topic: string | null;
}

/**
 * Fetch and cache all workspace channels from the Slack API.
 * Reusable by both the HTTP handler and resolveChannelName.
 */
async function ensureChannelsCached(cacheKey: string): Promise<SlackChannelDto[]> {
  const cached = channelCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.channels;
  }

  const client = new WebClient(config.slack.botToken);
  const allChannels: SlackChannelDto[] = [];
  let cursor: string | undefined;

  do {
    const result = await client.conversations.list({
      types: 'public_channel,private_channel',
      exclude_archived: true,
      limit: 200,
      cursor,
    });

    for (const channel of result.channels ?? []) {
      allChannels.push({
        id: channel.id!,
        name: channel.name ?? '',
        isPrivate: channel.is_private ?? false,
        memberCount: channel.num_members ?? 0,
        topic: channel.topic?.value || null,
      });
    }

    cursor = result.response_metadata?.next_cursor || undefined;
  } while (cursor);

  allChannels.sort((a, b) => a.name.localeCompare(b.name));
  channelCache.set(cacheKey, { channels: allChannels, fetchedAt: Date.now() });

  return allChannels;
}

/**
 * GET /api/v1/admin/slack/channels?teamId=T12345
 *
 * Lists all channels the bot has access to in the given workspace.
 * Results are cached in-memory for 5 minutes per teamId.
 */
router.get('/channels', async (req: Request, res: Response) => {
  try {
    const teamId = (req.query.teamId as string | undefined) || 'default';
    const channels = await ensureChannelsCached(teamId);
    logger.info('Fetched Slack workspace channels', { teamId, count: channels.length });
    res.json({ channels });
  } catch (error) {
    logger.error('Failed to fetch Slack channels', {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ error: 'Failed to fetch Slack channels' });
  }
});

/**
 * Resolve a channel name from cache, fetching from Slack API if cache is cold.
 */
export async function resolveChannelName(teamId: string, channelId: string): Promise<string | null> {
  try {
    const channels = await ensureChannelsCached(teamId || 'default');
    const ch = channels.find((c) => c.id === channelId);
    return ch?.name ?? null;
  } catch {
    return null;
  }
}

export { router as slackChannelsRouter };
