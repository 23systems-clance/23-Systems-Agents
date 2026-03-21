/**
 * Docs channel detection helper.
 *
 * Determines whether a given Slack channel is a "docs channel" where
 * document uploads should be handled by the document management flow
 * rather than the enrichment flow.
 *
 * Detection sources (checked in order):
 * 1. Redis cache (`doc-channel:{teamId}` set) for fast repeated lookups
 * 2. DocsChannelConfig table for explicit registrations
 * 3. Channel name regex match against `config.doc.channelPattern`
 */

import redis from '../../lib/redis.js';
import { prisma } from '../../models/index.js';
import { config } from '../../config/index.js';
import logger from '../../lib/logger.js';

/** Redis key prefix for cached docs channel sets. */
const CACHE_KEY_PREFIX = 'doc-channel';

/** TTL for the cached docs channel set (1 hour). */
const CACHE_TTL_SECONDS = 3600;

/**
 * Checks whether the given channel is a recognized docs channel.
 *
 * @param teamId - Slack workspace/team ID.
 * @param channelId - Slack channel ID to check.
 * @param channelName - Optional channel name for regex matching.
 * @returns True if the channel is a docs channel.
 */
export async function isDocsChannel(
  teamId: string,
  channelId: string,
  channelName?: string,
): Promise<boolean> {
  const cacheKey = `${CACHE_KEY_PREFIX}:${teamId}`;

  try {
    // 1. Check Redis cache first.
    const isCached = await redis.sismember(cacheKey, channelId);
    if (isCached) {
      return true;
    }

    // 2. Check DocsChannelConfig table for explicit registration.
    const registration = await prisma.docsChannelConfig.findUnique({
      where: {
        slackTeamId_slackChannelId: {
          slackTeamId: teamId,
          slackChannelId: channelId,
        },
      },
    });

    if (registration?.isActive) {
      await redis.sadd(cacheKey, channelId);
      await redis.expire(cacheKey, CACHE_TTL_SECONDS);
      return true;
    }

    // 3. Check channel name against naming convention regex.
    if (channelName) {
      const pattern = new RegExp(config.doc.channelPattern);
      if (pattern.test(channelName)) {
        await redis.sadd(cacheKey, channelId);
        await redis.expire(cacheKey, CACHE_TTL_SECONDS);
        return true;
      }
    }

    return false;
  } catch (error) {
    logger.error('Failed to check docs channel status', {
      teamId,
      channelId,
      error: error instanceof Error ? error.message : String(error),
    });
    // Default to false on error -- don't accidentally route enrichment uploads
    // into the document management flow.
    return false;
  }
}
