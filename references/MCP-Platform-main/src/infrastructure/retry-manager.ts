/**
 * Retry Manager with Exponential Backoff
 * Handles retrying failed operations with exponential backoff and jitter
 */

import type { Logger } from './logger.js';
import { MaxRetriesError, BuildWithError } from '../types/errors.js';

export interface RetryConfig {
  maxRetries: number; // Maximum number of retry attempts
  initialDelayMs: number; // Initial delay before first retry
  maxDelayMs: number; // Maximum delay cap
  backoffMultiplier: number; // Exponential backoff multiplier
  jitterMaxMs: number; // Maximum random jitter to add
  logger?: Logger;
}

export class RetryManager {
  private readonly config: RetryConfig;
  private readonly logger?: Logger;

  constructor(config: RetryConfig) {
    this.config = config;
    this.logger = config.logger;
  }

  /**
   * Execute a function with retry logic
   * @param fn Function to execute
   * @param context Optional context for logging
   * @returns Result of the function
   * @throws MaxRetriesError if all retries are exhausted
   */
  async execute<T>(fn: () => Promise<T>, context?: string): Promise<T> {
    let lastError: Error;

    for (let attempt = 0; attempt <= this.config.maxRetries; attempt++) {
      try {
        if (attempt > 0) {
          this.logger?.info({
            msg: 'Retry attempt',
            attempt,
            context,
            maxRetries: this.config.maxRetries,
          });
        }

        return await fn();
      } catch (error) {
        lastError = error as Error;

        // Don't retry non-retryable errors
        if (!this.isRetryable(error as Error)) {
          this.logger?.warn({
            msg: 'Non-retryable error, not retrying',
            error: (error as Error).message,
            context,
          });
          throw error;
        }

        // Don't delay on last attempt
        if (attempt === this.config.maxRetries) {
          break;
        }

        // Calculate backoff delay
        const delay = this.calculateDelay(attempt);

        this.logger?.info({
          msg: 'Backing off before retry',
          attempt,
          delay,
          error: (error as Error).message,
          context,
        });

        await this.sleep(delay);
      }
    }

    // All retries exhausted
    this.logger?.error({
      msg: 'Max retries exceeded',
      context,
      maxRetries: this.config.maxRetries,
    });

    throw new MaxRetriesError(
      `Max retries (${this.config.maxRetries}) exceeded`,
      lastError!
    );
  }

  /**
   * Determine if an error is retryable
   */
  private isRetryable(error: Error): boolean {
    // BuildWith errors have isRetryable flag
    if (error instanceof BuildWithError) {
      return error.isRetryable;
    }

    // Network errors are retryable
    if (error.message.includes('ECONNREFUSED') || error.message.includes('ETIMEDOUT')) {
      return true;
    }

    // Default to not retryable
    return false;
  }

  /**
   * Calculate delay with exponential backoff and jitter
   */
  private calculateDelay(attempt: number): number {
    // Exponential backoff: initialDelay * (multiplier ^ attempt)
    const exponentialDelay =
      this.config.initialDelayMs * Math.pow(this.config.backoffMultiplier, attempt);

    // Add random jitter (0 to jitterMaxMs)
    const jitter = Math.random() * this.config.jitterMaxMs;

    // Cap at maxDelayMs
    return Math.min(exponentialDelay + jitter, this.config.maxDelayMs);
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
