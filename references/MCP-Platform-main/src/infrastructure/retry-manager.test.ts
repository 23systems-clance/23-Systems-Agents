/**
 * Tests for RetryManager
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RetryManager } from './retry-manager.js';
import {
  RateLimitError,
  ServerError,
  NetworkError,
  AuthenticationError,
  ValidationError,
  MaxRetriesError,
} from '../types/errors.js';

describe('RetryManager', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('should succeed on first attempt', async () => {
    const manager = new RetryManager({
      maxRetries: 3,
      initialDelayMs: 1000,
      maxDelayMs: 60000,
      backoffMultiplier: 2,
      jitterMaxMs: 0, // No jitter for predictable testing
    });

    const fn = vi.fn().mockResolvedValue('success');

    const result = await manager.execute(fn);

    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should retry on retryable errors', async () => {
    const manager = new RetryManager({
      maxRetries: 3,
      initialDelayMs: 1000,
      maxDelayMs: 60000,
      backoffMultiplier: 2,
      jitterMaxMs: 0,
    });

    const fn = vi
      .fn()
      .mockRejectedValueOnce(new RateLimitError())
      .mockRejectedValueOnce(new ServerError('Server error'))
      .mockResolvedValue('success');

    const promise = manager.execute(fn);

    // First retry after 1000ms
    await vi.advanceTimersByTimeAsync(1000);

    // Second retry after 2000ms
    await vi.advanceTimersByTimeAsync(2000);

    const result = await promise;

    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('should not retry non-retryable errors', async () => {
    const manager = new RetryManager({
      maxRetries: 3,
      initialDelayMs: 1000,
      maxDelayMs: 60000,
      backoffMultiplier: 2,
      jitterMaxMs: 0,
    });

    const fn = vi.fn().mockRejectedValue(new AuthenticationError());

    await expect(manager.execute(fn)).rejects.toThrowError('Authentication failed');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should throw MaxRetriesError when retries exhausted', async () => {
    const manager = new RetryManager({
      maxRetries: 2,
      initialDelayMs: 100,
      maxDelayMs: 60000,
      backoffMultiplier: 2,
      jitterMaxMs: 0,
    });

    const error = new ServerError('Persistent error');
    const fn = vi.fn().mockRejectedValue(error);

    const promise = manager.execute(fn);

    await vi.advanceTimersByTimeAsync(100); // First retry
    await vi.advanceTimersByTimeAsync(200); // Second retry

    await expect(promise).rejects.toThrowError('Max retries (2) exceeded');
    expect(fn).toHaveBeenCalledTimes(3); // Initial + 2 retries
  });

  it('should calculate exponential backoff correctly', async () => {
    const manager = new RetryManager({
      maxRetries: 3,
      initialDelayMs: 1000,
      maxDelayMs: 60000,
      backoffMultiplier: 2,
      jitterMaxMs: 0,
    });

    const fn = vi.fn().mockRejectedValue(new NetworkError('Network error'));

    const promise = manager.execute(fn);

    // First retry: 1000ms
    await vi.advanceTimersByTimeAsync(999);
    expect(fn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fn).toHaveBeenCalledTimes(2);

    // Second retry: 2000ms (1000 * 2^1)
    await vi.advanceTimersByTimeAsync(1999);
    expect(fn).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(fn).toHaveBeenCalledTimes(3);

    // Third retry: 4000ms (1000 * 2^2)
    await vi.advanceTimersByTimeAsync(3999);
    expect(fn).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(1);
    expect(fn).toHaveBeenCalledTimes(4);

    await vi.runAllTimersAsync();
    await expect(promise).rejects.toThrowError('Max retries (3) exceeded');
  });

  it('should cap delay at maxDelayMs', async () => {
    const manager = new RetryManager({
      maxRetries: 5,
      initialDelayMs: 1000,
      maxDelayMs: 5000,
      backoffMultiplier: 2,
      jitterMaxMs: 0,
    });

    const fn = vi.fn().mockRejectedValue(new ServerError('Error'));

    const promise = manager.execute(fn);

    // Skip to 4th retry which would be 8000ms but capped at 5000ms
    await vi.advanceTimersByTimeAsync(1000); // 1st retry
    await vi.advanceTimersByTimeAsync(2000); // 2nd retry
    await vi.advanceTimersByTimeAsync(4000); // 3rd retry
    await vi.advanceTimersByTimeAsync(5000); // 4th retry (capped)

    expect(fn).toHaveBeenCalledTimes(5); // Initial + 4 retries

    await vi.runAllTimersAsync();
    await expect(promise).rejects.toThrowError('Max retries (5) exceeded');
  });

  it('should retry network errors', async () => {
    const manager = new RetryManager({
      maxRetries: 1,
      initialDelayMs: 100,
      maxDelayMs: 1000,
      backoffMultiplier: 2,
      jitterMaxMs: 0,
    });

    const networkError = new Error('ECONNREFUSED');
    const fn = vi.fn().mockRejectedValueOnce(networkError).mockResolvedValue('success');

    const promise = manager.execute(fn);
    await vi.advanceTimersByTimeAsync(100);
    const result = await promise;

    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
