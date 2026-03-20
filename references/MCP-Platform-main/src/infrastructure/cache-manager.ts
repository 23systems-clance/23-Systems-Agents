/**
 * LRU Cache Manager
 * Least Recently Used cache with TTL support
 */

import type { Logger } from './logger.js';

export interface CacheConfig {
  maxSize: number; // Maximum number of entries
  ttlMs: number; // Time to live in milliseconds
  logger?: Logger;
}

interface CacheEntry<T> {
  value: T;
  expiry: number;
  hits: number;
  createdAt: number;
}

export interface CacheStats {
  size: number;
  maxSize: number;
  hits: number;
  misses: number;
  hitRate: number;
  evictions: number;
  expirations: number;
}

export class CacheManager<K = string, V = unknown> {
  private cache: Map<K, CacheEntry<V>>;
  private readonly maxSize: number;
  private readonly ttlMs: number;
  private readonly logger?: Logger;

  // Statistics
  private hits: number = 0;
  private misses: number = 0;
  private evictions: number = 0;
  private expirations: number = 0;

  private cleanupInterval?: NodeJS.Timeout;

  constructor(config: CacheConfig) {
    this.cache = new Map();
    this.maxSize = config.maxSize;
    this.ttlMs = config.ttlMs;
    this.logger = config.logger;

    // Start periodic cleanup
    this.startCleanup();
  }

  /**
   * Get value from cache
   * @returns Value if found and not expired, undefined otherwise
   */
  get(key: K): V | undefined {
    const entry = this.cache.get(key);

    if (!entry) {
      this.misses++;
      this.logger?.debug({ msg: 'Cache miss', key });
      return undefined;
    }

    // Check expiry
    if (Date.now() > entry.expiry) {
      this.cache.delete(key);
      this.misses++;
      this.expirations++;
      this.logger?.debug({ msg: 'Cache expired', key });
      return undefined;
    }

    // Update access (move to end for LRU)
    entry.hits++;
    this.cache.delete(key);
    this.cache.set(key, entry);

    this.hits++;
    this.logger?.debug({
      msg: 'Cache hit',
      key,
      age: Date.now() - entry.createdAt,
      hits: entry.hits,
    });

    return entry.value;
  }

  /**
   * Set value in cache
   */
  set(key: K, value: V): void {
    // Evict if at capacity
    if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
      this.evictLRU();
    }

    this.cache.set(key, {
      value,
      expiry: Date.now() + this.ttlMs,
      hits: 0,
      createdAt: Date.now(),
    });

    this.logger?.debug({
      msg: 'Cache set',
      key,
      size: this.cache.size,
      ttlMs: this.ttlMs,
    });
  }

  /**
   * Check if key exists in cache (without updating LRU)
   */
  has(key: K): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;

    // Check expiry
    if (Date.now() > entry.expiry) {
      this.cache.delete(key);
      this.expirations++;
      return false;
    }

    return true;
  }

  /**
   * Invalidate (delete) a cache entry
   */
  invalidate(key: K): void {
    this.cache.delete(key);
    this.logger?.debug({ msg: 'Cache invalidated', key });
  }

  /**
   * Clear all cache entries
   */
  clear(): void {
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
    this.evictions = 0;
    this.expirations = 0;
    this.logger?.info({ msg: 'Cache cleared' });
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    const total = this.hits + this.misses;
    const hitRate = total > 0 ? this.hits / total : 0;

    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      hits: this.hits,
      misses: this.misses,
      hitRate,
      evictions: this.evictions,
      expirations: this.expirations,
    };
  }

  /**
   * Evict least recently used entry
   */
  private evictLRU(): void {
    // First entry is least recently used
    const firstKey = this.cache.keys().next().value;

    if (firstKey !== undefined) {
      this.cache.delete(firstKey);
      this.evictions++;
      this.logger?.debug({ msg: 'LRU eviction', key: firstKey });
    }
  }

  /**
   * Start periodic cleanup of expired entries
   */
  private startCleanup(): void {
    // Cleanup every minute
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 60000);
  }

  /**
   * Cleanup expired entries
   */
  private cleanup(): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [key, entry] of this.cache.entries()) {
      if (now > entry.expiry) {
        this.cache.delete(key);
        this.expirations++;
        cleaned++;
      }
    }

    if (cleaned > 0) {
      this.logger?.debug({
        msg: 'Cache cleanup completed',
        cleaned,
        remaining: this.cache.size,
      });
    }
  }

  /**
   * Stop periodic cleanup
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = undefined;
    }
  }
}
