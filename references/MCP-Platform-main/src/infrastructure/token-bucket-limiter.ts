/**
 * Token Bucket Rate Limiter
 * Implements token bucket algorithm for rate limiting API requests
 */

import type { Logger } from './logger.js';

export interface TokenBucketConfig {
  maxTokens: number; // Maximum number of tokens in the bucket
  refillRate: number; // Tokens added per millisecond
  logger?: Logger;
}

export class TokenBucketRateLimiter {
  private tokens: number;
  private lastRefill: number;
  private readonly maxTokens: number;
  private readonly refillRate: number;
  private readonly logger?: Logger;

  constructor(config: TokenBucketConfig) {
    this.maxTokens = config.maxTokens;
    this.refillRate = config.refillRate;
    this.tokens = config.maxTokens; // Start with full bucket
    this.lastRefill = Date.now();
    this.logger = config.logger;
  }

  /**
   * Try to acquire a token immediately
   * @returns true if token acquired, false otherwise
   */
  tryAcquire(): boolean {
    this.refill();

    if (this.tokens >= 1) {
      this.tokens -= 1;
      this.logger?.debug({ msg: 'Token acquired', availableTokens: this.tokens });
      return true;
    }

    this.logger?.debug({ msg: 'No tokens available', availableTokens: this.tokens });
    return false;
  }

  /**
   * Wait until a token is available and acquire it
   * @returns Promise that resolves when token is acquired
   */
  async acquire(): Promise<void> {
    while (!this.tryAcquire()) {
      // Calculate wait time until next token
      const waitMs = Math.ceil(1 / this.refillRate);
      this.logger?.debug({ msg: 'Waiting for token', waitMs });
      await this.sleep(waitMs);
    }
  }

  /**
   * Get current number of available tokens
   */
  getAvailableTokens(): number {
    this.refill();
    return this.tokens;
  }

  /**
   * Refill tokens based on elapsed time
   */
  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    const tokensToAdd = elapsed * this.refillRate;

    if (tokensToAdd > 0) {
      this.tokens = Math.min(this.maxTokens, this.tokens + tokensToAdd);
      this.lastRefill = now;
    }
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Reset the bucket to full capacity
   */
  reset(): void {
    this.tokens = this.maxTokens;
    this.lastRefill = Date.now();
    this.logger?.debug({ msg: 'Token bucket reset' });
  }
}
