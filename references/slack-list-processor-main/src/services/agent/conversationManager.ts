/**
 * Conversation Manager for multi-turn agent threads.
 *
 * Persists conversation turns to both Redis (hot cache) and PostgreSQL
 * (durable 7-day retention). Assembles context for classification calls.
 * Implements research.md R4 multi-turn architecture.
 */

import { prisma } from '../../models/index.js';
import {
  getThreadState,
  setThreadState,
  updateThreadState,
  type AgentThreadState,
  type ConversationTurn,
  type EnrichmentParams,
} from './contextStore.js';
import type { AgentClassificationResult } from '../ai/agentOrchestrator.js';
import logger from '../../lib/logger.js';

/** Maximum conversation turns to retain in context window. */
const MAX_TURNS = 20;

/** Maximum estimated tokens for the context window. */
const MAX_CONTEXT_TOKENS = 4000;

/** Rough characters-per-token ratio for estimation. */
const CHARS_PER_TOKEN = 4;

/**
 * Initializes a new agent thread state in Redis and DB.
 */
export async function initThread(params: {
  threadTs: string;
  channelId: string;
  userId: string;
  teamId: string;
}): Promise<AgentThreadState> {
  const state: AgentThreadState = {
    threadTs: params.threadTs,
    channelId: params.channelId,
    userId: params.userId,
    teamId: params.teamId,
    enrichmentParams: {},
    jobIds: [],
    turns: [],
  };

  // Persist to Redis
  await setThreadState(state);

  // Persist to DB (handle missing workspace gracefully)
  try {
    await prisma.agentThread.create({
      data: {
        slackThreadTs: params.threadTs,
        slackChannelId: params.channelId,
        slackUserId: params.userId,
        slackTeamId: params.teamId,
        status: 'ACTIVE',
      },
    });
  } catch (err) {
    // FK constraint violation: workspace not yet registered
    const isFkViolation =
      err instanceof Error &&
      err.message.includes('Foreign key constraint');

    if (isFkViolation) {
      logger.warn('Workspace not found for agent thread, auto-registering', {
        teamId: params.teamId,
      });

      await prisma.workspaceInstallation.upsert({
        where: { slackTeamId: params.teamId },
        update: {},
        create: {
          slackTeamId: params.teamId,
          slackTeamName: params.teamId,
          botToken: '',
          botId: '',
          botUserId: '',
          appId: '',
          installedByUserId: params.userId,
          scopes: '',
        },
      });

      await prisma.agentThread.create({
        data: {
          slackThreadTs: params.threadTs,
          slackChannelId: params.channelId,
          slackUserId: params.userId,
          slackTeamId: params.teamId,
          status: 'ACTIVE',
        },
      });
    } else {
      throw err;
    }
  }

  return state;
}

/**
 * Records a new conversation turn in both Redis and DB.
 * Returns the updated thread state.
 */
export async function addTurn(
  teamId: string,
  threadTs: string,
  turn: {
    role: 'user' | 'assistant';
    content: string;
    intent?: string;
    confidence?: number;
    extractedParams?: Record<string, unknown>;
    tokensInput?: number;
    tokensOutput?: number;
  },
): Promise<AgentThreadState | null> {
  // Get current state from Redis
  let state = await getThreadState(teamId, threadTs);
  if (!state) {
    logger.warn('Thread state not found in Redis, attempting DB recovery', { teamId, threadTs });
    state = await recoverStateFromDb(teamId, threadTs);
    if (!state) return null;
  }

  // Create the conversation turn entry
  const newTurn: ConversationTurn = {
    role: turn.role,
    content: turn.content,
    timestamp: new Date().toISOString(),
    intent: turn.intent,
    confidence: turn.confidence,
  };

  // Add to turns array, enforce max window (count + token limits)
  state.turns.push(newTurn);
  state.turns = trimContextWindow(state.turns);

  // Update Redis
  await setThreadState(state);

  // Persist turn to DB
  const dbThread = await prisma.agentThread.findFirst({
    where: { slackTeamId: teamId, slackThreadTs: threadTs },
    select: { id: true },
  });

  if (dbThread) {
    await prisma.conversationTurn.create({
      data: {
        agentThreadId: dbThread.id,
        role: turn.role === 'user' ? 'USER' : 'ASSISTANT',
        content: turn.content,
        intent: turn.intent,
        confidence: turn.confidence,
        extractedParams: turn.extractedParams ? JSON.parse(JSON.stringify(turn.extractedParams)) : undefined,
        tokensInput: turn.tokensInput,
        tokensOutput: turn.tokensOutput,
      },
    });

    // Update last activity timestamp
    await prisma.agentThread.update({
      where: { id: dbThread.id },
      data: { lastActivityAt: new Date() },
    });
  }

  return state;
}

/**
 * Loads conversation history for context assembly.
 * Tries Redis first, falls back to DB.
 *
 * @returns Array of recent turns for the classification prompt.
 */
export async function loadTurns(
  teamId: string,
  threadTs: string,
): Promise<ConversationTurn[]> {
  // Try Redis first
  const state = await getThreadState(teamId, threadTs);
  if (state && state.turns.length > 0) {
    return state.turns;
  }

  // Fallback: load from DB
  const dbThread = await prisma.agentThread.findFirst({
    where: { slackTeamId: teamId, slackThreadTs: threadTs },
    select: { id: true },
  });

  if (!dbThread) return [];

  const dbTurns = await prisma.conversationTurn.findMany({
    where: { agentThreadId: dbThread.id },
    orderBy: { createdAt: 'asc' },
    take: MAX_TURNS,
    select: {
      role: true,
      content: true,
      createdAt: true,
      intent: true,
      confidence: true,
    },
  });

  return dbTurns.map((t) => ({
    role: t.role === 'USER' ? 'user' as const : 'assistant' as const,
    content: t.content,
    timestamp: t.createdAt.toISOString(),
    intent: t.intent ?? undefined,
    confidence: t.confidence ?? undefined,
  }));
}

/**
 * Gets the current thread state, initializing if needed.
 */
export async function getOrInitThread(params: {
  threadTs: string;
  channelId: string;
  userId: string;
  teamId: string;
}): Promise<AgentThreadState> {
  const existing = await getThreadState(params.teamId, params.threadTs);
  if (existing) return existing;

  return initThread(params);
}

/**
 * Links a job to an agent thread.
 */
export async function linkJobToThread(
  teamId: string,
  threadTs: string,
  jobId: string,
): Promise<void> {
  // Update Redis state
  const state = await getThreadState(teamId, threadTs);
  if (state) {
    state.jobIds.push(jobId);
    state.activeJobId = jobId;
    await setThreadState(state);
  }

  // Update DB
  const dbThread = await prisma.agentThread.findFirst({
    where: { slackTeamId: teamId, slackThreadTs: threadTs },
    select: { id: true },
  });

  if (dbThread) {
    await prisma.agentThreadJob.create({
      data: {
        agentThreadId: dbThread.id,
        jobId,
      },
    });
  }
}

/**
 * Merges extracted params from intent classification into the thread's
 * accumulated enrichmentParams. Persists the updated state to Redis.
 *
 * T030: Accumulated parameter tracking across turns.
 */
export async function mergeClassifiedParams(
  threadState: AgentThreadState,
  classification: AgentClassificationResult,
): Promise<void> {
  const { intent } = classification;
  const params = threadState.enrichmentParams;
  let changed = false;

  if (intent.enrichmentType) {
    params.enrichIntent = intent.enrichmentType as EnrichmentParams['enrichIntent'];
    changed = true;
  }

  if (intent.technology) {
    params.technology = intent.technology;
    changed = true;
  }

  // Map enrichment intents directly
  if (['technographic', 'contact', 'combined'].includes(intent.intent)) {
    params.enrichIntent = intent.intent as EnrichmentParams['enrichIntent'];
    changed = true;
  }

  if (changed) {
    await updateThreadState(threadState.teamId, threadState.threadTs, {
      enrichmentParams: params,
    });
  }
}

/**
 * Persists the current thread state's enrichmentParams to Redis.
 * Called by intent handlers after modifying params in-memory.
 *
 * T030: Persist accumulated params after handler modifications.
 */
export async function persistEnrichmentParams(
  threadState: AgentThreadState,
): Promise<void> {
  await updateThreadState(threadState.teamId, threadState.threadTs, {
    enrichmentParams: threadState.enrichmentParams,
  });
}

/**
 * Resolves a job reference from the thread context.
 * Returns the most recent job ID from the thread's jobIds array,
 * or a specific jobId if provided.
 *
 * T031: Context reference resolution for "those results", "that job", etc.
 */
export function resolveJobReference(
  threadState: AgentThreadState,
  explicitJobId?: string,
): string | undefined {
  if (explicitJobId) return explicitJobId;
  if (threadState.activeJobId) return threadState.activeJobId;
  if (threadState.jobIds.length > 0) {
    return threadState.jobIds[threadState.jobIds.length - 1];
  }
  return undefined;
}

/**
 * Trims the context window to respect both turn count and token limits.
 * Drops oldest turns first to stay within MAX_TURNS and MAX_CONTEXT_TOKENS.
 *
 * T034: Token-based context window management.
 */
function trimContextWindow(turns: ConversationTurn[]): ConversationTurn[] {
  // First, enforce max turn count
  let trimmed = turns.length > MAX_TURNS ? turns.slice(-MAX_TURNS) : turns;

  // Then, enforce token limit by dropping oldest turns
  while (trimmed.length > 1 && estimateTokens(trimmed) > MAX_CONTEXT_TOKENS) {
    trimmed = trimmed.slice(1);
  }

  return trimmed;
}

/**
 * Estimates the token count for an array of conversation turns.
 * Uses a rough characters-per-token heuristic.
 */
function estimateTokens(turns: ConversationTurn[]): number {
  let chars = 0;
  for (const turn of turns) {
    // Role prefix + content
    chars += turn.role.length + 2 + turn.content.length;
  }
  return Math.ceil(chars / CHARS_PER_TOKEN);
}

/**
 * Recovers thread state from DB when Redis cache has expired.
 */
async function recoverStateFromDb(
  teamId: string,
  threadTs: string,
): Promise<AgentThreadState | null> {
  const dbThread = await prisma.agentThread.findFirst({
    where: { slackTeamId: teamId, slackThreadTs: threadTs },
    include: {
      turns: { orderBy: { createdAt: 'asc' }, take: MAX_TURNS },
      threadJobs: { select: { jobId: true } },
    },
  });

  if (!dbThread) return null;

  const state: AgentThreadState = {
    threadTs: dbThread.slackThreadTs,
    channelId: dbThread.slackChannelId,
    userId: dbThread.slackUserId,
    teamId: dbThread.slackTeamId,
    viewingChannelId: dbThread.viewingChannelId ?? undefined,
    viewingChannelName: dbThread.viewingChannelName ?? undefined,
    enrichmentParams: {},
    jobIds: dbThread.threadJobs.map((tj) => tj.jobId),
    turns: dbThread.turns.map((t) => ({
      role: t.role === 'USER' ? 'user' as const : 'assistant' as const,
      content: t.content,
      timestamp: t.createdAt.toISOString(),
      intent: t.intent ?? undefined,
      confidence: t.confidence ?? undefined,
    })),
  };

  // Re-cache in Redis
  await setThreadState(state);

  return state;
}
