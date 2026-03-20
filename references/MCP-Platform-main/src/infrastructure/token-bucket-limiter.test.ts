/**
 * Tests for TokenBucketRateLimiter
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TokenBucketRateLimiter } from './token-bucket-limiter.js';

describe('TokenBucketRateLimiter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('should allow requests within rate limit', () => {
    const limiter = new TokenBucketRateLimiter({
      maxTokens: 10,
      refillRate: 10 / 1000, // 10 tokens per second
    });

    // Should be able to acquire 10 tokens immediately
    for (let i = 0; i < 10; i++) {
      expect(limiter.tryAcquire()).toBe(true);
    }

    // 11th token should fail
    expect(limiter.tryAcquire()).toBe(false);
  });

  it('should refill tokens over time', () => {
    const limiter = new TokenBucketRateLimiter({
      maxTokens: 10,
      refillRate: 10 / 1000, // 10 tokens per second
    });

    // Exhaust all tokens
    for (let i = 0; i < 10; i++) {
      limiter.tryAcquire();
    }

    expect(limiter.tryAcquire()).toBe(false);

    // Advance time by 100ms (should refill 1 token)
    vi.advanceTimersByTime(100);

    expect(limiter.tryAcquire()).toBe(true);
    expect(limiter.tryAcquire()).toBe(false);
  });

  it('should not exceed max tokens', () => {
    const limiter = new TokenBucketRateLimiter({
      maxTokens: 10,
      refillRate: 10 / 1000,
    });

    // Advance time by 10 seconds (would refill 100 tokens if no cap)
    vi.advanceTimersByTime(10000);

    // Should only have 10 tokens (max)
    for (let i = 0; i < 10; i++) {
      expect(limiter.tryAcquire()).toBe(true);
    }
    expect(limiter.tryAcquire()).toBe(false);
  });

  it('should return available tokens', () => {
    const limiter = new TokenBucketRateLimiter({
      maxTokens: 10,
      refillRate: 10 / 1000,
    });

    expect(limiter.getAvailableTokens()).toBe(10);

    limiter.tryAcquire();
    expect(limiter.getAvailableTokens()).toBe(9);

    limiter.tryAcquire();
    limiter.tryAcquire();
    expect(limiter.getAvailableTokens()).toBe(7);
  });

  it('should reset bucket to full capacity', () => {
    const limiter = new TokenBucketRateLimiter({
      maxTokens: 10,
      refillRate: 10 / 1000,
    });

    // Exhaust tokens
    for (let i = 0; i < 10; i++) {
      limiter.tryAcquire();
    }

    expect(limiter.getAvailableTokens()).toBe(0);

    limiter.reset();

    expect(limiter.getAvailableTokens()).toBe(10);
  });

  it('should wait and acquire token when using acquire()', async () => {
    const limiter = new TokenBucketRateLimiter({
      maxTokens: 1,
      refillRate: 1 / 1000, // 1 token per second
    });

    // Exhaust the single token
    limiter.tryAcquire();

    // Start acquiring (will wait)
    const acquirePromise = limiter.acquire();

    // Advance time to allow refill
    vi.advanceTimersByTime(1000);

    await vi.runAllTimersAsync();
    await acquirePromise;

    // Should have acquired the token
    expect(limiter.getAvailableTokens()).toBe(0);
  });
});
