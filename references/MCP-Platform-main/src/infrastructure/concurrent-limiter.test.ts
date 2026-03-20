/**
 * Tests for ConcurrentLimiter
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ConcurrentLimiter } from './concurrent-limiter.js';

describe('ConcurrentLimiter', () => {
  let limiter: ConcurrentLimiter;

  beforeEach(() => {
    limiter = new ConcurrentLimiter({
      maxConcurrent: 3,
    });
  });

  it('should allow requests up to max concurrent limit', () => {
    expect(limiter.tryAcquire()).toBe(true);
    expect(limiter.tryAcquire()).toBe(true);
    expect(limiter.tryAcquire()).toBe(true);
    expect(limiter.tryAcquire()).toBe(false);

    expect(limiter.getActive()).toBe(3);
  });

  it('should release slots and allow new requests', () => {
    limiter.tryAcquire();
    limiter.tryAcquire();
    limiter.tryAcquire();

    expect(limiter.tryAcquire()).toBe(false);

    limiter.release();
    expect(limiter.getActive()).toBe(2);
    expect(limiter.tryAcquire()).toBe(true);
  });

  it('should queue requests when at capacity', async () => {
    limiter.tryAcquire();
    limiter.tryAcquire();
    limiter.tryAcquire();

    // This will be queued
    const acquirePromise = limiter.acquire();

    expect(limiter.getQueueLength()).toBe(1);

    // Release one slot
    limiter.release();

    // Queued request should be processed
    await acquirePromise;

    expect(limiter.getActive()).toBe(3);
    expect(limiter.getQueueLength()).toBe(0);
  });

  it('should process queue in FIFO order', async () => {
    limiter.tryAcquire();
    limiter.tryAcquire();
    limiter.tryAcquire();

    const results: number[] = [];

    const promise1 = limiter.acquire().then(() => results.push(1));
    const promise2 = limiter.acquire().then(() => results.push(2));
    const promise3 = limiter.acquire().then(() => results.push(3));

    expect(limiter.getQueueLength()).toBe(3);

    limiter.release();
    await promise1;

    limiter.release();
    await promise2;

    limiter.release();
    await promise3;

    expect(results).toEqual([1, 2, 3]);
  });

  it('should report when at capacity', () => {
    expect(limiter.isAtCapacity()).toBe(false);

    limiter.tryAcquire();
    limiter.tryAcquire();
    expect(limiter.isAtCapacity()).toBe(false);

    limiter.tryAcquire();
    expect(limiter.isAtCapacity()).toBe(true);

    limiter.release();
    expect(limiter.isAtCapacity()).toBe(false);
  });

  it('should handle multiple releases correctly', () => {
    limiter.tryAcquire();
    limiter.tryAcquire();
    limiter.tryAcquire();

    limiter.release();
    limiter.release();
    limiter.release();

    expect(limiter.getActive()).toBe(0);
    expect(limiter.tryAcquire()).toBe(true);
  });
});
