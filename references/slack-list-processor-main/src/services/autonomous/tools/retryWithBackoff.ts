/**
 * Shared retry utility with exponential backoff (T026a).
 *
 * Executes a function with up to `maxAttempts` retries using exponential
 * backoff delays (1s, 2s, 4s by default). On all attempts exhausted,
 * emits a SystemEvent with severity=HIGH and returns the error.
 *
 * Used by all autonomous agents for AWS API calls and other retriable
 * external service interactions.
 */

import logger from '../../../lib/logger.js';
import { emitEvent } from '../systemEventEmitter.js';

const log = logger.withContext({ service: 'retryWithBackoff' });

/** Options for configuring retry behavior. */
export interface RetryOptions {
  /** Maximum number of attempts (including the first). Defaults to 3. */
  maxAttempts?: number;
  /** Base delay in milliseconds. Defaults to 1000. */
  baseDelayMs?: number;
  /** Label for logging and SystemEvent messages. */
  operationName?: string;
  /** Agent name for SystemEvent metadata. */
  agentName?: string;
}

/**
 * Executes `fn` with exponential backoff retries.
 *
 * @param fn - The async function to execute.
 * @param options - Retry configuration.
 * @returns The result of `fn` on success.
 * @throws The last error after all attempts are exhausted.
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options?: RetryOptions,
): Promise<T> {
  const maxAttempts = options?.maxAttempts ?? 3;
  const baseDelayMs = options?.baseDelayMs ?? 1000;
  const operationName = options?.operationName ?? 'unknown_operation';

  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt < maxAttempts) {
        const delay = baseDelayMs * Math.pow(2, attempt - 1);

        log.warn('Retrying after failure', {
          operationName,
          attempt,
          maxAttempts,
          delayMs: delay,
          error: lastError.message,
        });

        await sleep(delay);
      }
    }
  }

  // All attempts exhausted — emit SystemEvent and throw.
  log.error('All retry attempts exhausted', {
    operationName,
    maxAttempts,
    error: lastError?.message,
  });

  try {
    await emitEvent({
      type: 'retry_exhausted',
      severity: 'HIGH',
      message: `All ${maxAttempts} retry attempts exhausted for ${operationName}: ${lastError?.message}`,
      metadata: {
        operationName,
        maxAttempts,
        error: lastError?.message,
      },
      agentName: options?.agentName,
    });
  } catch (emitError) {
    log.error('Failed to emit retry-exhausted SystemEvent', {
      error: emitError instanceof Error ? emitError.message : String(emitError),
    });
  }

  throw lastError;
}

/**
 * Sleeps for the given number of milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
