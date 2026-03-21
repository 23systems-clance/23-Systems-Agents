/**
 * Reusable concurrency pool with rate limiting and exponential backoff.
 *
 * Executes async tasks with configurable concurrency limits and per-second
 * rate limiting. Retries tasks on 429/5xx errors with exponential backoff.
 * Used by all provider batch handlers in the waterfall enrichment.
 */

import logger from './logger.js';

/**
 * Configuration for the concurrency pool.
 */
export interface ConcurrencyPoolOptions {
  /** Maximum number of tasks executing simultaneously. */
  maxConcurrent: number;
  /** Maximum tasks dispatched per second (rate limit). 0 = unlimited. */
  maxPerSecond: number;
  /** Name for log context. */
  name: string;
  /** Maximum retry attempts per task on retryable errors (default: 3). */
  maxRetries?: number;
  /** Initial backoff delay in ms for retries (default: 1000). */
  initialBackoffMs?: number;
}

/**
 * Result of a single task execution.
 */
export interface TaskResult<T> {
  /** Index in the original tasks array. */
  index: number;
  /** The result value if successful, null if failed. */
  result: T | null;
  /** Error if the task failed after all retries, null if successful. */
  error: Error | null;
  /** Number of retries attempted. */
  retries: number;
}

/**
 * Checks if an error is retryable (429 rate limit or 5xx server error).
 *
 * @param error - The error to check.
 * @returns true if the error should be retried.
 */
function isRetryableError(error: unknown): boolean {
  if (error instanceof Error) {
    const msg = error.message;
    // Check for rate limit
    if (msg.includes('429') || msg.includes('rate limit')) return true;
    // Check for server errors
    if (msg.includes('5') && /HTTP\s*5\d\d/.test(msg)) return true;
    // Check statusCode property
    const statusCode = (error as any).statusCode;
    if (typeof statusCode === 'number') {
      return statusCode === 429 || statusCode >= 500;
    }
  }
  return false;
}

/**
 * Pauses execution for a given number of milliseconds.
 *
 * @param ms - Milliseconds to sleep.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Rate-limited concurrency pool for batch task execution.
 *
 * Manages a pool of concurrent tasks with:
 * - Hard concurrency limit (max in-flight)
 * - Per-second rate limiting (token bucket)
 * - Exponential backoff retry on retryable errors
 * - Progress callback support
 *
 * @example
 * ```typescript
 * const pool = new ConcurrencyPool({
 *   maxConcurrent: 10,
 *   maxPerSecond: 10,
 *   name: 'apollo',
 * });
 *
 * const results = await pool.executeAll(
 *   contacts.map((c) => () => enrichContact(c)),
 *   (completed, total) => console.log(`${completed}/${total}`),
 * );
 * ```
 */
export class ConcurrencyPool {
  private readonly maxConcurrent: number;
  private readonly maxPerSecond: number;
  private readonly name: string;
  private readonly maxRetries: number;
  private readonly initialBackoffMs: number;

  /** Circular buffer tracking dispatch timestamps for rate limiting. */
  private dispatchTimestamps: number[] = [];
  private dispatchIndex = 0;

  constructor(options: ConcurrencyPoolOptions) {
    this.maxConcurrent = options.maxConcurrent;
    this.maxPerSecond = options.maxPerSecond;
    this.name = options.name;
    this.maxRetries = options.maxRetries ?? 3;
    this.initialBackoffMs = options.initialBackoffMs ?? 1000;

    // Initialize timestamp buffer for rate limiting
    if (this.maxPerSecond > 0) {
      this.dispatchTimestamps = new Array(this.maxPerSecond).fill(0);
    }
  }

  /**
   * Execute all tasks with concurrency and rate limiting.
   * Returns results in the same order as input tasks.
   *
   * @param tasks - Array of async functions to execute.
   * @param onProgress - Optional callback invoked after each task completes.
   * @returns Array of TaskResult in input order.
   */
  async executeAll<T>(
    tasks: Array<() => Promise<T>>,
    onProgress?: (completed: number, total: number) => void,
  ): Promise<TaskResult<T>[]> {
    if (tasks.length === 0) return [];

    const total = tasks.length;
    const results: TaskResult<T>[] = new Array(total);
    let completed = 0;
    let taskIndex = 0;

    logger.info(`${this.name} pool starting`, {
      totalTasks: total,
      maxConcurrent: this.maxConcurrent,
      maxPerSecond: this.maxPerSecond,
    });

    const startTime = Date.now();

    // Worker function: picks up tasks from the queue
    const worker = async (): Promise<void> => {
      while (taskIndex < total) {
        const currentIndex = taskIndex++;

        // Rate limit: wait if needed
        await this.waitForRateLimit();

        // Execute task with retries
        const taskResult = await this.executeWithRetry(
          tasks[currentIndex]!,
          currentIndex,
        );

        results[currentIndex] = taskResult;
        completed++;

        if (onProgress) {
          onProgress(completed, total);
        }
      }
    };

    // Launch workers up to maxConcurrent
    const workerCount = Math.min(this.maxConcurrent, total);
    const workers = Array.from({ length: workerCount }, () => worker());

    await Promise.all(workers);

    const durationMs = Date.now() - startTime;
    const successCount = results.filter((r) => r.result !== null).length;

    logger.info(`${this.name} pool completed`, {
      totalTasks: total,
      successCount,
      failedCount: total - successCount,
      durationMs,
      avgMs: Math.round(durationMs / total),
    });

    return results;
  }

  /**
   * Execute a single task with retry logic.
   */
  private async executeWithRetry<T>(
    task: () => Promise<T>,
    index: number,
  ): Promise<TaskResult<T>> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const result = await task();
        return { index, result, error: null, retries: attempt };
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));

        if (attempt < this.maxRetries && isRetryableError(err)) {
          const delay = this.initialBackoffMs * Math.pow(2, attempt);
          logger.warn(`${this.name} task retry`, {
            index,
            attempt: attempt + 1,
            maxRetries: this.maxRetries,
            delayMs: delay,
            error: lastError.message,
          });
          await sleep(delay);
        } else if (!isRetryableError(err)) {
          // Non-retryable error, stop immediately
          break;
        }
      }
    }

    return { index, result: null, error: lastError, retries: this.maxRetries };
  }

  /**
   * Rate limiter using token bucket approach.
   * Waits if we've exceeded maxPerSecond in the last 1-second window.
   */
  private async waitForRateLimit(): Promise<void> {
    if (this.maxPerSecond <= 0) return;

    const now = Date.now();
    const oldestIndex = this.dispatchIndex % this.maxPerSecond;
    const oldestTimestamp = this.dispatchTimestamps[oldestIndex]!;

    // If the oldest dispatch in our window was < 1 second ago, wait
    const elapsed = now - oldestTimestamp;
    if (elapsed < 1000) {
      const waitMs = 1000 - elapsed + 10; // +10ms buffer
      await sleep(waitMs);
    }

    // Record this dispatch
    this.dispatchTimestamps[oldestIndex] = Date.now();
    this.dispatchIndex++;
  }
}
