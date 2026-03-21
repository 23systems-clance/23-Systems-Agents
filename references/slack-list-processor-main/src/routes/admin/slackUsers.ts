/**
 * Admin endpoint to list Slack workspace members.
 *
 * Returns non-bot, non-deleted users with profile info so the admin dashboard
 * can present a searchable user picker when creating BDRs.
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { WebClient } from '@slack/web-api';
import { config } from '../../config/index.js';
import logger from '../../lib/logger.js';

const router = Router();

/** Cached user list and timestamp. */
let cache: { users: SlackUserDto[]; fetchedAt: number } | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface SlackUserDto {
  id: string;
  teamId: string;
  name: string;
  email: string | null;
  avatar: string | null;
  title: string | null;
}

/**
 * GET /api/v1/admin/slack/users
 *
 * Lists all human (non-bot, non-deleted) Slack workspace members.
 * Results are cached in-memory for 5 minutes.
 */
router.get('/users', async (_req: Request, res: Response) => {
  try {
    // Return cached data if fresh
    if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
      res.json({ users: cache.users });
      return;
    }

    const client = new WebClient(config.slack.botToken);
    const allUsers: SlackUserDto[] = [];
    let cursor: string | undefined;

    // Paginate through all workspace members
    do {
      const result = await client.users.list({ limit: 200, cursor });

      for (const member of result.members ?? []) {
        // Skip bots, deleted users, app users, and Slackbot
        if (
          member.is_bot ||
          member.deleted ||
          member.is_app_user ||
          member.id === 'USLACKBOT'
        ) {
          continue;
        }

        allUsers.push({
          id: member.id!,
          teamId: member.team_id ?? '',
          name: member.real_name || member.name || '',
          email: member.profile?.email ?? null,
          avatar: member.profile?.image_72 ?? null,
          title: member.profile?.title || null,
        });
      }

      cursor = result.response_metadata?.next_cursor || undefined;
    } while (cursor);

    // Sort alphabetically by name
    allUsers.sort((a, b) => a.name.localeCompare(b.name));

    // Update cache
    cache = { users: allUsers, fetchedAt: Date.now() };

    logger.info('Fetched Slack workspace users', { count: allUsers.length });
    res.json({ users: allUsers });
  } catch (error) {
    logger.error('Failed to fetch Slack users', {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ error: 'Failed to fetch Slack users' });
  }
});

export { router as slackUsersRouter };
