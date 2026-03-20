/**
 * Concurrent Request Limiter
 * Limits the number of concurrent operations
 */

import type { Logger } from './logger.js';

export interface ConcurrentLimiterConfig {
  maxConcurrent: number; // Maximum concurrent operations
  logger?: Logger;
}

interface QueuedRequest {
  resolve: () => void;
  timestamp: number;
}

export class ConcurrentLimiter {
  private active: number = 0;
  private readonly maxConcurrent: number;
  private readonly queue: QueuedRequest[] = [];
  private readonly logger?: Logger;

  constructor(config: ConcurrentLimiterConfig) {
    this.maxConcurrent = config.maxConcurrent;
    this.logger = config.logger;
  }

  /**
   * Try to acquire a concurrent slot immediately
   * @returns true if slot acquired, false otherwise
   */
  tryAcquire(): boolean {
    if (this.active < this.maxConcurrent) {
      this.active++;
      this.logger?.debug({
        msg: 'Concurrent slot acquired',
        active: this.active,
        max: this.maxConcurrent,
      });
      return true;
    }

    this.logger?.debug({
      msg: 'No concurrent slots available',
      active: this.active,
      max: this.maxConcurrent,
      queued: this.queue.length,
    });
    return false;
  }

  /**
   * Wait until a concurrent slot is available and acquire it
   * @returns Promise that resolves when slot is acquired
   */
  async acquire(): Promise<void> {
    if (this.tryAcquire()) {
      return;
    }

    // Queue the request
    return new Promise<void>((resolve) => {
      this.queue.push({
        resolve,
        timestamp: Date.now(),
      });
      this.logger?.debug({
        msg: 'Request queued',
        queueLength: this.queue.length,
      });
    });
  }

  /**
   * Release a concurrent slot
   */
  release(): void {
    this.active--;
    this.logger?.debug({
      msg: 'Concurrent slot released',
      active: this.active,
      queued: this.queue.length,
    });

    // Process next queued request
    const next = this.queue.shift();
    if (next) {
      this.active++;
      const waitTime = Date.now() - next.timestamp;
      this.logger?.debug({
        msg: 'Processing queued request',
        waitTime,
        active: this.active,
      });
      next.resolve();
    }
  }

  /**
   * Get current active count
   */
  getActive(): number {
    return this.active;
  }

  /**
   * Get current queue length
   */
  getQueueLength(): number {
    return this.queue.length;
  }

  /**
   * Check if at capacity
   */
  isAtCapacity(): boolean {
    return this.active >= this.maxConcurrent;
  }
}
