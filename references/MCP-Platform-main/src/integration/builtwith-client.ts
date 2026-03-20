/**
 * BuildWith API Client
 * Low-level HTTP client for BuildWith API with rate limiting, caching, and retry
 */

import { request } from 'undici';
import type { ServerConfig } from '../types/config.js';
import type { Logger } from '../infrastructure/logger.js';
import { TokenBucketRateLimiter } from '../infrastructure/token-bucket-limiter.js';
import { ConcurrentLimiter } from '../infrastructure/concurrent-limiter.js';
import { RetryManager } from '../infrastructure/retry-manager.js';
import { CacheManager } from '../infrastructure/cache-manager.js';
import {
  RateLimitError,
  AuthenticationError,
  ValidationError,
  ServerError,
  NetworkError,
} from '../types/errors.js';
import crypto from 'crypto';

export interface DomainLookupOptions {
  hideMetadata?: boolean;
  onlyLive?: boolean;
}

export interface ListSitesOptions {
  includeMetadata?: boolean;
  offset?: number;
  since?: string;
}

export class BuildWithClient {
  private readonly baseUrl = 'https://api.builtwith.com';
  private readonly apiKey: string;
  private readonly rateLimiter: TokenBucketRateLimiter;
  private readonly concurrentLimiter: ConcurrentLimiter;
  private readonly retryManager: RetryManager;
  private readonly cacheManager: CacheManager;
  private readonly logger: Logger;

  constructor(config: ServerConfig, logger: Logger) {
    this.apiKey = config.builtwith.apiKey;
    this.logger = logger;

    // Initialize rate limiter (tokens per millisecond)
    this.rateLimiter = new TokenBucketRateLimiter({
      maxTokens: config.rateLimit.requestsPerSecond,
      refillRate: config.rateLimit.requestsPerSecond / 1000,
      logger,
    });

    // Initialize concurrent limiter
    this.concurrentLimiter = new ConcurrentLimiter({
      maxConcurrent: config.rateLimit.maxConcurrent,
      logger,
    });

    // Initialize retry manager
    this.retryManager = new RetryManager({
      maxRetries: config.retry.maxRetries,
      initialDelayMs: config.retry.initialDelayMs,
      maxDelayMs: config.retry.maxDelayMs,
      backoffMultiplier: config.retry.backoffMultiplier,
      jitterMaxMs: config.retry.jitterMaxMs,
      logger,
    });

    // Initialize cache manager
    this.cacheManager = new CacheManager({
      maxSize: config.cache.maxSize,
      ttlMs: config.cache.ttlMs,
      logger,
    });
  }

  /**
   * Free API - Basic technology information
   */
  async freeLookup(domain: string): Promise<unknown> {
    const cacheKey = `free:${domain}`;

    // Check cache first
    const cached = this.cacheManager.get(cacheKey);
    if (cached) {
      this.logger.debug({ msg: 'Cache hit for free lookup', domain });
      return cached;
    }

    // Execute request with rate limiting and retry
    const result = await this.executeRequest('free-api', 'json', {
      LOOKUP: domain,
    });

    // Cache successful result
    this.cacheManager.set(cacheKey, result);

    return result;
  }

  /**
   * Domain API - Comprehensive technology stack
   */
  async domainLookup(domain: string, options: DomainLookupOptions = {}): Promise<unknown> {
    const cacheKey = `domain:${domain}:${this.hashOptions(options as Record<string, unknown>)}`;

    // Check cache first
    const cached = this.cacheManager.get(cacheKey);
    if (cached) {
      this.logger.debug({ msg: 'Cache hit for domain lookup', domain });
      return cached;
    }

    const params: Record<string, string> = {
      LOOKUP: domain,
    };

    if (options.hideMetadata) params.hideAll = 'yes';
    if (options.onlyLive) params.onlyLiveTechnologies = 'yes';

    const result = await this.executeRequest('domain-api', 'json', params);

    // Cache successful result
    this.cacheManager.set(cacheKey, result);

    return result;
  }

  /**
   * Lists API - Find websites using specific technology
   */
  async listSites(technology: string, options: ListSitesOptions = {}): Promise<unknown> {
    const cacheKey = `lists:${technology}:${this.hashOptions(options as Record<string, unknown>)}`;

    // Check cache first
    const cached = this.cacheManager.get(cacheKey);
    if (cached) {
      this.logger.debug({ msg: 'Cache hit for list sites', technology });
      return cached;
    }

    const params: Record<string, string> = {
      TECH: technology,
    };

    if (options.includeMetadata) params.META = 'yes';
    if (options.offset) params.OFFSET = options.offset.toString();
    if (options.since) params.SINCE = options.since;

    const result = await this.executeRequest('lists-api', 'json', params);

    // Cache successful result
    this.cacheManager.set(cacheKey, result);

    return result;
  }

  /**
   * Get cache statistics
   */
  getCacheStats() {
    return this.cacheManager.getStats();
  }

  /**
   * Execute HTTP request with rate limiting and retry
   */
  private async executeRequest(
    endpoint: string,
    format: string,
    params: Record<string, string>
  ): Promise<unknown> {
    // Acquire rate limit token
    await this.rateLimiter.acquire();

    // Acquire concurrent slot
    await this.concurrentLimiter.acquire();

    try {
      // Execute with retry
      return await this.retryManager.execute(async () => {
        const url = this.buildUrl(endpoint, format, params);

        this.logger.debug({
          msg: 'API request',
          endpoint,
          url: url.pathname,
        });

        const response = await request(url.toString(), {
          method: 'GET',
          headers: {
            'User-Agent': 'BuildWith-MCP-Server/1.0',
          },
        });

        if (response.statusCode !== 200) {
          throw this.handleHttpError(response.statusCode, endpoint);
        }

        const data = await response.body.json();

        this.logger.debug({
          msg: 'API response received',
          endpoint,
          statusCode: response.statusCode,
        });

        return data;
      }, endpoint);
    } finally {
      // Always release concurrent slot
      this.concurrentLimiter.release();
    }
  }

  /**
   * Build API URL with parameters
   */
  private buildUrl(
    endpoint: string,
    format: string,
    params: Record<string, string>
  ): URL {
    const url = new URL(`${this.baseUrl}/${endpoint}/api.${format}`);

    url.searchParams.set('KEY', this.apiKey);

    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }

    return url;
  }

  /**
   * Handle HTTP error responses
   */
  private handleHttpError(statusCode: number, endpoint: string): Error {
    switch (statusCode) {
      case 429:
        return new RateLimitError('Rate limit exceeded');
      case 401:
      case 403:
        return new AuthenticationError('Invalid API key');
      case 400:
        return new ValidationError('Invalid request parameters');
      case 500:
      case 502:
      case 503:
      case 504:
        return new ServerError(`BuildWith API error (${statusCode})`, statusCode);
      default:
        if (statusCode >= 500) {
          return new ServerError(`HTTP ${statusCode}`, statusCode);
        } else if (statusCode >= 400) {
          return new ValidationError(`HTTP ${statusCode}`);
        }
        return new NetworkError(`Unexpected HTTP ${statusCode}`);
    }
  }

  /**
   * Hash options object for cache key
   */
  private hashOptions(options: Record<string, unknown>): string {
    const sorted = Object.keys(options)
      .sort()
      .reduce((acc, key) => {
        acc[key] = options[key];
        return acc;
      }, {} as Record<string, unknown>);

    return crypto.createHash('md5').update(JSON.stringify(sorted)).digest('hex').substring(0, 8);
  }
}
