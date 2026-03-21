/**
 * Prompt Context Cache Service
 * Feature 23: Dynamic Suggested Prompts - Redis caching with sliding TTL
 */

import { redis } from '../../lib/redis';
import logger from '../../lib/logger';
import { PromptContext, IPromptContextCache } from '../../types/promptTypes';
import { PROMPT_CACHE_CONFIG } from '../../constants/promptCategories';

class PromptCacheKeyBuilder {
  static userContext(teamId: string, userId: string): string {
    return `${teamId}:${PROMPT_CACHE_CONFIG.USER_CONTEXT_KEY_PREFIX}:${userId}`;
  }

  static channelHistory(teamId: string, channelId: string): string {
    return `${teamId}:${PROMPT_CACHE_CONFIG.CHANNEL_HISTORY_KEY_PREFIX}:${channelId}:history`;
  }

  static recentPrompts(teamId: string, userId: string): string {
    return `${teamId}:${PROMPT_CACHE_CONFIG.RECENT_PROMPTS_KEY_PREFIX}:${userId}`;
  }

  static workspacePattern(teamId: string): string {
    return `${teamId}:${PROMPT_CACHE_CONFIG.USER_CONTEXT_KEY_PREFIX}:*`;
  }
}

export class PromptContextCache implements IPromptContextCache {
  async get(teamId: string, userId: string): Promise<PromptContext | null> {
    const key = PromptCacheKeyBuilder.userContext(teamId, userId);

    try {
      const data = await redis.get(key);
      if (!data) return null;

      await redis.expire(key, PROMPT_CACHE_CONFIG.TTL_SECONDS);

      const context = JSON.parse(data) as PromptContext;
      context.generatedAt = new Date(context.generatedAt);
      context.activeJobs.forEach(job => job.createdAt = new Date(job.createdAt));
      context.completedJobs.forEach(job => job.createdAt = new Date(job.createdAt));
      context.failedJobs.forEach(job => job.createdAt = new Date(job.createdAt));
      if (context.channelEnrichmentHistory) {
        context.channelEnrichmentHistory.lastJobAt = new Date(context.channelEnrichmentHistory.lastJobAt);
      }
      if (context.channelDocuments) {
        context.channelDocuments.forEach(doc => {
          if (doc.uploadedAt) doc.uploadedAt = new Date(doc.uploadedAt);
        });
      }

      return context;
    } catch (error) {
      logger.error('Failed to get cached prompt context', { error, teamId, userId });
      return null;
    }
  }

  async set(teamId: string, userId: string, context: PromptContext): Promise<void> {
    const key = PromptCacheKeyBuilder.userContext(teamId, userId);

    try {
      await redis.setex(key, PROMPT_CACHE_CONFIG.TTL_SECONDS, JSON.stringify(context));
    } catch (error) {
      logger.error('Failed to cache prompt context', { error, teamId, userId });
    }
  }

  async invalidate(teamId: string, userId: string): Promise<void> {
    const key = PromptCacheKeyBuilder.userContext(teamId, userId);

    try {
      await redis.del(key);
    } catch (error) {
      logger.error('Failed to invalidate prompt context', { error, teamId, userId });
    }
  }

  async invalidateWorkspace(teamId: string): Promise<void> {
    const pattern = PromptCacheKeyBuilder.workspacePattern(teamId);

    try {
      const keys = await this.scanKeys(pattern);
      if (keys.length > 0) {
        await redis.del(...keys);
        logger.info('Workspace prompt contexts invalidated', { teamId, count: keys.length });
      }
    } catch (error) {
      logger.error('Failed to invalidate workspace prompt contexts', { error, teamId });
    }
  }

  private async scanKeys(pattern: string): Promise<string[]> {
    const keys: string[] = [];
    let cursor = '0';

    do {
      const [newCursor, matchedKeys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
      cursor = newCursor;
      keys.push(...matchedKeys);
    } while (cursor !== '0');

    return keys;
  }

  async getRecentPrompts(teamId: string, userId: string): Promise<string[]> {
    const key = PromptCacheKeyBuilder.recentPrompts(teamId, userId);

    try {
      return await redis.lrange(key, 0, -1);
    } catch (error) {
      logger.error('Failed to get recent prompts', { error, teamId, userId });
      return [];
    }
  }

  async trackRecentPrompts(teamId: string, userId: string, promptIds: string[]): Promise<void> {
    const key = PromptCacheKeyBuilder.recentPrompts(teamId, userId);

    try {
      const pipeline = redis.pipeline();
      promptIds.forEach(id => pipeline.lpush(key, id));
      pipeline.ltrim(key, 0, 19);
      pipeline.expire(key, PROMPT_CACHE_CONFIG.TTL_SECONDS);
      await pipeline.exec();
    } catch (error) {
      logger.error('Failed to track recent prompts', { error, teamId, userId });
    }
  }
}

export const promptContextCache = new PromptContextCache();
