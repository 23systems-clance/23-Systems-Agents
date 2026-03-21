import redis from '../../lib/redis.js';
import logger from '../../lib/logger.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single conversation turn in the agent thread. */
export interface ConversationTurn {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  intent?: string;
  confidence?: number;
}

/** Accumulated enrichment parameters for the agent thread. */
export interface EnrichmentParams {
  listType?: 'company' | 'contact';
  enrichIntent?: 'technographic' | 'contact' | 'combined';
  purpose?: string;
  fileId?: string;
  fileName?: string;
  technology?: string; // for tech reports
  /** Auto-filter to apply after enrichment completes (smart file upload). */
  postEnrichmentFilter?: {
    filterExpression: string;
    technology?: string;
  };
}

/**
 * Agent thread state stored in Redis during multi-turn conversations.
 * Used by Claude agent to maintain context across messages in a DM thread.
 */
export interface AgentThreadState {
  threadTs: string;
  channelId: string; // DM channel
  userId: string;
  teamId: string;

  // Channel context (from threadContextChanged)
  viewingChannelId?: string;
  viewingChannelName?: string;

  // Accumulated enrichment parameters
  enrichmentParams: EnrichmentParams;

  // Job references in this thread
  jobIds: string[];
  activeJobId?: string;

  // Conversation turns (last N for context window)
  turns: ConversationTurn[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** TTL applied to every agent thread state key (24 hours). */
const TTL_SECONDS = 86400;

/**
 * Builds the Redis key for a given agent thread.
 */
function buildKey(teamId: string, threadTs: string): string {
  return `agent:thread:${teamId}:${threadTs}`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Retrieves an agent thread state from Redis, or null if not found / expired.
 * Returns null on Redis failure (T069b: stateless single-turn fallback).
 */
export async function getThreadState(
  teamId: string,
  threadTs: string,
): Promise<AgentThreadState | null> {
  try {
    const key = buildKey(teamId, threadTs);
    const raw = await redis.get(key);
    if (!raw) {
      return null;
    }
    return JSON.parse(raw) as AgentThreadState;
  } catch (err) {
    logger.warn('Redis unavailable for getThreadState — operating in stateless mode', {
      teamId,
      threadTs,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Persists a full agent thread state to Redis with a 24-hour TTL.
 * Silently fails on Redis error (T069b: degraded mode).
 */
export async function setThreadState(state: AgentThreadState): Promise<void> {
  try {
    const key = buildKey(state.teamId, state.threadTs);
    await redis.set(key, JSON.stringify(state), 'EX', TTL_SECONDS);
  } catch (err) {
    logger.warn('Redis unavailable for setThreadState — context will not persist', {
      teamId: state.teamId,
      threadTs: state.threadTs,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Merges a partial update into an existing agent thread state.
 * Returns the updated state, or null if the thread does not exist or Redis fails.
 */
export async function updateThreadState(
  teamId: string,
  threadTs: string,
  updates: Partial<AgentThreadState>,
): Promise<AgentThreadState | null> {
  const existing = await getThreadState(teamId, threadTs);
  if (!existing) {
    return null;
  }
  const merged: AgentThreadState = { ...existing, ...updates };
  await setThreadState(merged);
  return merged;
}

/**
 * Deletes an agent thread state from Redis.
 * Silently fails on Redis error.
 */
export async function deleteThreadState(
  teamId: string,
  threadTs: string,
): Promise<void> {
  try {
    const key = buildKey(teamId, threadTs);
    await redis.del(key);
  } catch (err) {
    logger.warn('Redis unavailable for deleteThreadState', {
      teamId,
      threadTs,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// ---------------------------------------------------------------------------
// Concurrent conversation gauge (T076)
// ---------------------------------------------------------------------------

const ACTIVE_THREADS_KEY = 'agent:active-threads';

/**
 * Increments the active thread count in Redis.
 * Returns the new count, or -1 on failure.
 */
export async function incrementActiveThreads(): Promise<number> {
  try {
    return await redis.incr(ACTIVE_THREADS_KEY);
  } catch {
    return -1;
  }
}

/**
 * Decrements the active thread count in Redis.
 * Floors at zero to prevent negative counts.
 * Returns the new count, or -1 on failure.
 */
export async function decrementActiveThreads(): Promise<number> {
  try {
    const val = await redis.decr(ACTIVE_THREADS_KEY);
    if (val < 0) {
      await redis.set(ACTIVE_THREADS_KEY, '0');
      return 0;
    }
    return val;
  } catch {
    return -1;
  }
}

/**
 * Returns the current number of active agent threads, or -1 on failure.
 */
export async function getActiveThreadCount(): Promise<number> {
  try {
    const val = await redis.get(ACTIVE_THREADS_KEY);
    return val ? parseInt(val, 10) : 0;
  } catch {
    return -1;
  }
}
