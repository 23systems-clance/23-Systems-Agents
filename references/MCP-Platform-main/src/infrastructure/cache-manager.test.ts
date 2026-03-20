/**
 * Tests for CacheManager
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { CacheManager } from './cache-manager.js';

describe('CacheManager', () => {
  let cache: CacheManager<string, string>;

  beforeEach(() => {
    vi.useFakeTimers();
    cache = new CacheManager({
      maxSize: 3,
      ttlMs: 1000,
    });
  });

  afterEach(() => {
    cache.destroy();
    vi.useRealTimers();
  });

  it('should store and retrieve values', () => {
    cache.set('key1', 'value1');
    expect(cache.get('key1')).toBe('value1');
  });

  it('should return undefined for non-existent keys', () => {
    expect(cache.get('nonexistent')).toBeUndefined();
  });

  it('should expire entries after TTL', () => {
    cache.set('key1', 'value1');
    expect(cache.get('key1')).toBe('value1');

    // Advance time past TTL
    vi.advanceTimersByTime(1001);

    expect(cache.get('key1')).toBeUndefined();
  });

  it('should check if key exists', () => {
    cache.set('key1', 'value1');
    expect(cache.has('key1')).toBe(true);
    expect(cache.has('key2')).toBe(false);

    // After TTL
    vi.advanceTimersByTime(1001);
    expect(cache.has('key1')).toBe(false);
  });

  it('should evict LRU entry when at max size', () => {
    cache.set('key1', 'value1');
    cache.set('key2', 'value2');
    cache.set('key3', 'value3');

    // Access key1 to make it more recently used
    cache.get('key1');

    // Add key4, should evict key2 (least recently used)
    cache.set('key4', 'value4');

    expect(cache.get('key1')).toBe('value1');
    expect(cache.get('key2')).toBeUndefined();
    expect(cache.get('key3')).toBe('value3');
    expect(cache.get('key4')).toBe('value4');
  });

  it('should invalidate specific keys', () => {
    cache.set('key1', 'value1');
    cache.set('key2', 'value2');

    cache.invalidate('key1');

    expect(cache.get('key1')).toBeUndefined();
    expect(cache.get('key2')).toBe('value2');
  });

  it('should clear all entries', () => {
    cache.set('key1', 'value1');
    cache.set('key2', 'value2');

    cache.clear();

    expect(cache.get('key1')).toBeUndefined();
    expect(cache.get('key2')).toBeUndefined();
  });

  it('should track cache statistics', () => {
    cache.set('key1', 'value1');
    cache.get('key1'); // Hit
    cache.get('key2'); // Miss
    cache.get('key1'); // Hit
    cache.get('key3'); // Miss

    const stats = cache.getStats();

    expect(stats.hits).toBe(2);
    expect(stats.misses).toBe(2);
    expect(stats.hitRate).toBe(0.5);
    expect(stats.size).toBe(1);
    expect(stats.maxSize).toBe(3);
  });

  it('should update LRU order on access', () => {
    cache.set('key1', 'value1');
    cache.set('key2', 'value2');
    cache.set('key3', 'value3');

    // Access key1 and key2 to move them to end
    cache.get('key1');
    cache.get('key2');

    // Add key4, should evict key3 (now LRU)
    cache.set('key4', 'value4');

    expect(cache.get('key1')).toBe('value1');
    expect(cache.get('key2')).toBe('value2');
    expect(cache.get('key3')).toBeUndefined();
    expect(cache.get('key4')).toBe('value4');
  });

  it('should not evict when updating existing key', () => {
    cache.set('key1', 'value1');
    cache.set('key2', 'value2');
    cache.set('key3', 'value3');

    // Update key1
    cache.set('key1', 'updated');

    const stats = cache.getStats();
    expect(stats.size).toBe(3);
    expect(stats.evictions).toBe(0);
  });

  it('should clean up expired entries periodically', () => {
    cache.set('key1', 'value1');
    cache.set('key2', 'value2');

    // Advance past TTL
    vi.advanceTimersByTime(1001);

    // Trigger cleanup (runs every 60 seconds)
    vi.advanceTimersByTime(60000);

    const stats = cache.getStats();
    expect(stats.size).toBe(0);
    expect(stats.expirations).toBe(2);
  });

  it('should track evictions in statistics', () => {
    cache.set('key1', 'value1');
    cache.set('key2', 'value2');
    cache.set('key3', 'value3');
    cache.set('key4', 'value4'); // Should evict key1

    const stats = cache.getStats();
    expect(stats.evictions).toBe(1);
  });

  it('should track expirations in statistics', () => {
    cache.set('key1', 'value1');

    vi.advanceTimersByTime(1001);

    cache.get('key1'); // Will be expired

    const stats = cache.getStats();
    expect(stats.expirations).toBe(1);
  });
});
