/**
 * Chat streaming helper for the agent side-panel.
 *
 * Wraps Slack's chat.startStream / chat.appendStream / chat.stopStream
 * lifecycle with flush batching (100ms or 500 chars, whichever comes first).
 *
 * Two modes:
 * 1. Text streaming — progressive LLM response delivery
 * 2. Task pipeline — visual task cards for enrichment progress
 *
 * @see streaming-protocol.md contract
 */

import type { WebClient } from '@slack/web-api';
import type { ChatStartStreamArguments, ChatAppendStreamArguments, ChatStopStreamArguments } from '@slack/web-api/dist/types/request/index.js';
import logger from '../../lib/logger.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Configuration for a streaming session. */
export interface StreamConfig {
  client: WebClient;
  channel: string;
  threadTs: string;
  userId: string;
  teamId: string;
}

/** A running stream session with append/stop capabilities. */
export interface StreamSession {
  /** The stream message timestamp (set after startStream). */
  ts: string;
  /** Append markdown text to the stream (auto-batched). */
  appendText: (text: string) => void;
  /** Flush any buffered text immediately. */
  flush: () => Promise<void>;
  /** Append task card update chunks. */
  appendChunks: (chunks: TaskChunk[]) => Promise<void>;
  /** Stop the stream and finalize the message. */
  stop: (opts?: StopOptions) => Promise<void>;
}

/** Options for stopping a stream. */
interface StopOptions {
  /** Final markdown text to include. */
  markdownText?: string;
}

/** A chunk for task card updates (plan_update or task_update). */
export interface TaskChunk {
  type: 'plan_update' | 'task_update';
  id?: string;
  title: string;
  status?: 'pending' | 'in_progress' | 'complete' | 'error';
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Flush text buffer every 100ms. */
const FLUSH_INTERVAL_MS = 100;

/** Flush text buffer when it reaches 500 chars. */
const FLUSH_CHAR_THRESHOLD = 500;

/** Maximum characters per appendStream call (Slack limit). */
const MAX_APPEND_CHARS = 12_000;

/** Max retries for rate-limited API calls (T068). */
const MAX_RETRIES = 3;

/** Base delay in ms for exponential backoff (T068). */
const BACKOFF_BASE_MS = 500;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Executes a Slack API call with exponential backoff for rate limits (T068).
 */
async function withBackoff(
  fn: () => Promise<void>,
  label: string,
): Promise<void> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      await fn();
      return;
    } catch (err: unknown) {
      const isRateLimited = err instanceof Error && err.message.includes('rate_limited');
      if (!isRateLimited || attempt >= MAX_RETRIES) {
        throw err;
      }
      const delay = BACKOFF_BASE_MS * Math.pow(2, attempt);
      logger.warn(`${label} rate limited, retrying in ${delay}ms`, { attempt });
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

/**
 * Starts a new streaming session on the given channel/thread.
 *
 * @param config  - Stream configuration (client, channel, thread, user, team).
 * @param opts    - Optional initial task chunks for pipeline mode.
 * @returns A StreamSession for appending text/chunks and stopping.
 */
export async function startStream(
  config: StreamConfig,
  opts?: { taskDisplayMode?: 'timeline' | 'plan'; initialChunks?: TaskChunk[] },
): Promise<StreamSession> {
  const { client, channel, threadTs, userId, teamId } = config;

  const startPayload: ChatStartStreamArguments = {
    channel,
    thread_ts: threadTs,
    recipient_user_id: userId,
    recipient_team_id: teamId,
  };

  if (opts?.taskDisplayMode) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (startPayload as any).task_display_mode = opts.taskDisplayMode;
  }

  if (opts?.initialChunks && opts.initialChunks.length > 0) {
    startPayload.chunks = opts.initialChunks as ChatStartStreamArguments['chunks'];
  }

  let streamTs: string;
  try {
    const result = await client.chat.startStream(startPayload);
    streamTs = result.ts as string;
  } catch (err) {
    // T067: Graceful error if stream can't start — return a no-op session
    logger.error('chat.startStream failed', {
      error: err instanceof Error ? err.message : String(err),
      channel,
    });
    throw new Error('Failed to start streaming session');
  }

  if (!streamTs) {
    throw new Error('chat.startStream did not return a message ts');
  }

  // -- Text buffer + auto-flush --
  let textBuffer = '';
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  async function doFlush(): Promise<void> {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    if (!textBuffer || stopped) return;

    const chunk = textBuffer.slice(0, MAX_APPEND_CHARS);
    textBuffer = textBuffer.slice(MAX_APPEND_CHARS);

    try {
      await withBackoff(
        async () => { await client.chat.appendStream({ channel, ts: streamTs, markdown_text: chunk }); },
        'chat.appendStream (text)',
      );
    } catch (err) {
      logger.error('chat.appendStream (text) failed', {
        error: err instanceof Error ? err.message : String(err),
        channel,
        streamTs,
      });
    }

    // If there's still text left, schedule another flush
    if (textBuffer) {
      flushTimer = setTimeout(() => void doFlush(), FLUSH_INTERVAL_MS);
    }
  }

  function scheduleFlush(): void {
    if (stopped) return;
    if (textBuffer.length >= FLUSH_CHAR_THRESHOLD) {
      void doFlush();
    } else if (!flushTimer) {
      flushTimer = setTimeout(() => void doFlush(), FLUSH_INTERVAL_MS);
    }
  }

  const session: StreamSession = {
    ts: streamTs,

    appendText(text: string): void {
      if (stopped) return;
      textBuffer += text;
      scheduleFlush();
    },

    async flush(): Promise<void> {
      await doFlush();
    },

    async appendChunks(chunks: TaskChunk[]): Promise<void> {
      if (stopped || chunks.length === 0) return;
      try {
        await withBackoff(
          async () => { await client.chat.appendStream({ channel, ts: streamTs, chunks: chunks as ChatAppendStreamArguments['chunks'] }); },
          'chat.appendStream (chunks)',
        );
      } catch (err) {
        logger.error('chat.appendStream (chunks) failed', {
          error: err instanceof Error ? err.message : String(err),
          channel,
          streamTs,
        });
      }
    },

    async stop(stopOpts?: StopOptions): Promise<void> {
      if (stopped) return;
      stopped = true;

      // Flush remaining text
      await doFlush();

      const stopPayload: ChatStopStreamArguments = {
        channel,
        ts: streamTs,
      };

      if (stopOpts?.markdownText) {
        stopPayload.markdown_text = stopOpts.markdownText;
      }

      try {
        await withBackoff(
          async () => { await client.chat.stopStream(stopPayload); },
          'chat.stopStream',
        );
      } catch (err) {
        logger.error('chat.stopStream failed', {
          error: err instanceof Error ? err.message : String(err),
          channel,
          streamTs,
        });
      }
    },
  };

  return session;
}
