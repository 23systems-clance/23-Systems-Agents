/**
 * Prompt resolution service.
 *
 * Resolves a prompt slug into its published content, model config, and
 * tool definitions via a 3-tier chain:
 *   1. Redis cache  (< 1 ms)
 *   2. PostgreSQL    (< 50 ms)
 *   3. Compiled-in defaults (instant, zero external deps)
 *
 * Caching uses a 5-minute TTL. Active invalidation is triggered on
 * publish via `invalidateCache()`.
 *
 * @module promptResolver
 */

import redis from '../../lib/redis.js';
import { prisma } from '../../models/index.js';
import logger from '../../lib/logger.js';
import { DEFAULT_PROMPTS } from './defaultPrompts.js';
import { resolveTemplateVariables, type TemplateContext } from './templateEngine.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ResolvedPrompt {
  content: string;
  modelConfig: {
    model: string;
    maxTokens: number;
    temperature?: number;
  };
  toolDefinitions: Record<string, unknown>[] | null;
  version: number;
  source: 'cache' | 'db' | 'default';
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Redis key prefix for cached prompts. */
const CACHE_PREFIX = 'prompt';

/** Cache TTL in seconds (5 minutes). */
const CACHE_TTL_SECONDS = 300;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Builds the Redis cache key for a prompt.
 */
function cacheKey(slug: string, workspaceId?: string): string {
  if (workspaceId) {
    return `${CACHE_PREFIX}:${slug}:ws:${workspaceId}`;
  }
  return `${CACHE_PREFIX}:${slug}:published`;
}

/**
 * Loads workspace overrides for variables associated with a prompt.
 */
async function loadWorkspaceOverrides(
  promptId: string,
  workspaceId: string,
): Promise<Record<string, string>> {
  const overrides = await prisma.workspacePromptOverride.findMany({
    where: {
      workspaceId,
      variable: {
        prompts: { some: { promptId } },
      },
    },
    include: { variable: true },
  });

  const map: Record<string, string> = {};
  for (const o of overrides) {
    map[o.variable.name] = o.overrideValue;
  }
  return map;
}

/**
 * Loads global default values for variables associated with a prompt.
 */
async function loadGlobalDefaults(
  promptId: string,
): Promise<Record<string, string>> {
  const mappings = await prisma.promptVariableMapping.findMany({
    where: { promptId },
    include: { variable: true },
  });

  const map: Record<string, string> = {};
  for (const m of mappings) {
    if (m.variable.defaultValue != null) {
      map[m.variable.name] = m.variable.defaultValue;
    }
  }
  return map;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Resolves a prompt by slug, applying template variable resolution.
 *
 * Resolution chain:
 *   1. Redis cache (if hit, template variables re-applied with job context)
 *   2. PostgreSQL (published version + variable overrides)
 *   3. Compiled-in default (from defaultPrompts.ts)
 *
 * @param slug         - The prompt's unique slug identifier.
 * @param workspaceId  - Optional workspace ID for per-workspace overrides.
 * @param jobContext    - Optional runtime key-value pairs (e.g. column headers).
 * @returns The fully resolved prompt with content, model config, and tools.
 */
export async function resolvePrompt(
  slug: string,
  workspaceId?: string,
  jobContext?: Record<string, string>,
): Promise<ResolvedPrompt> {
  const key = cacheKey(slug, workspaceId);

  // -----------------------------------------------------------------------
  // Tier 1: Redis cache
  // -----------------------------------------------------------------------
  try {
    const cached = await redis.get(key);
    if (cached) {
      const parsed = JSON.parse(cached) as ResolvedPrompt;
      // Re-apply template variables with job context (cache stores
      // workspace-resolved content but job context is per-invocation).
      if (jobContext && Object.keys(jobContext).length > 0) {
        parsed.content = resolveTemplateVariables(parsed.content, { jobContext });
      }
      parsed.source = 'cache';
      logger.debug('Prompt resolved from cache', { slug, key });
      return parsed;
    }
  } catch (err) {
    logger.warn('Redis cache read failed, falling through to DB', {
      slug,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // -----------------------------------------------------------------------
  // Tier 2: PostgreSQL
  // -----------------------------------------------------------------------
  try {
    const prompt = await prisma.prompt.findUnique({
      where: { slug },
      include: {
        versions: {
          where: { status: 'PUBLISHED' },
          take: 1,
        },
      },
    });

    if (prompt && prompt.versions.length > 0) {
      const publishedVersion = prompt.versions[0];

      // Build template context
      const templateCtx: TemplateContext = { jobContext };

      if (workspaceId) {
        templateCtx.workspaceOverrides = await loadWorkspaceOverrides(
          prompt.id,
          workspaceId,
        );
      }
      templateCtx.globalDefaults = await loadGlobalDefaults(prompt.id);

      const resolvedContent = resolveTemplateVariables(
        publishedVersion.content,
        templateCtx,
      );

      const result: ResolvedPrompt = {
        content: resolvedContent,
        modelConfig: prompt.modelConfig as ResolvedPrompt['modelConfig'],
        toolDefinitions: prompt.toolDefinitions as Record<string, unknown>[] | null,
        version: publishedVersion.version,
        source: 'db',
      };

      // Cache the resolved result (with workspace overrides applied but
      // WITHOUT job context, which is per-invocation).
      const contentForCache = resolveTemplateVariables(
        publishedVersion.content,
        {
          workspaceOverrides: templateCtx.workspaceOverrides,
          globalDefaults: templateCtx.globalDefaults,
        },
      );

      const cachePayload: ResolvedPrompt = {
        ...result,
        content: contentForCache,
      };

      try {
        await redis.set(key, JSON.stringify(cachePayload), 'EX', CACHE_TTL_SECONDS);
        logger.debug('Prompt cached', { slug, key, ttl: CACHE_TTL_SECONDS });
      } catch (cacheErr) {
        logger.warn('Failed to cache prompt in Redis', {
          slug,
          error: cacheErr instanceof Error ? cacheErr.message : String(cacheErr),
        });
      }

      logger.debug('Prompt resolved from DB', { slug, version: result.version });
      return result;
    }
  } catch (err) {
    logger.warn('DB prompt lookup failed, falling through to default', {
      slug,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // -----------------------------------------------------------------------
  // Tier 3: Compiled-in default
  // -----------------------------------------------------------------------
  const fallback = DEFAULT_PROMPTS[slug];
  if (fallback) {
    let resolvedContent = fallback.content;
    if (jobContext && Object.keys(jobContext).length > 0) {
      resolvedContent = resolveTemplateVariables(resolvedContent, { jobContext });
    }

    logger.info('Prompt resolved from compiled default', { slug });
    return {
      content: resolvedContent,
      modelConfig: fallback.modelConfig,
      toolDefinitions: fallback.toolDefinitions,
      version: 0,
      source: 'default',
    };
  }

  // No prompt found anywhere — this is a programming error
  logger.error('Prompt not found in any tier', { slug });
  throw new Error(`Prompt "${slug}" not found in cache, database, or defaults`);
}

/**
 * Invalidates all cached entries for a prompt slug.
 *
 * Uses SCAN to find and delete all keys matching `prompt:{slug}:*`.
 * Called after publishing a new version.
 *
 * @param slug - The prompt slug whose cache entries should be purged.
 */
export async function invalidateCache(slug: string): Promise<void> {
  const pattern = `${CACHE_PREFIX}:${slug}:*`;

  try {
    let cursor = '0';
    let deletedCount = 0;

    do {
      const [nextCursor, keys] = await redis.scan(
        cursor,
        'MATCH',
        pattern,
        'COUNT',
        100,
      );
      cursor = nextCursor;

      if (keys.length > 0) {
        await redis.del(...keys);
        deletedCount += keys.length;
      }
    } while (cursor !== '0');

    logger.info('Prompt cache invalidated', { slug, deletedCount, pattern });
  } catch (err) {
    logger.error('Failed to invalidate prompt cache', {
      slug,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
