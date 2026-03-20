/**
 * Tests for configuration loader
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadConfig } from './config-loader.js';

describe('Configuration Loader', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset environment
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should load configuration with API key', () => {
    process.env.BUILTWITH_API_KEY = 'test-api-key';

    const config = loadConfig();

    expect(config.builtwith.apiKey).toBe('test-api-key');
  });

  it('should throw error when API key is missing', () => {
    delete process.env.BUILTWITH_API_KEY;

    expect(() => loadConfig()).toThrow('Configuration validation failed');
  });

  it('should use default values when env vars not set', () => {
    process.env.BUILTWITH_API_KEY = 'test-key';

    const config = loadConfig();

    expect(config.rateLimit.requestsPerSecond).toBe(10);
    expect(config.rateLimit.maxConcurrent).toBe(8);
    expect(config.cache.enabled).toBe(true);
    expect(config.cache.maxSize).toBe(1000);
    expect(config.cache.ttlMs).toBe(3600000);
    expect(config.retry.maxRetries).toBe(3);
    expect(config.retry.initialDelayMs).toBe(1000);
    expect(config.retry.maxDelayMs).toBe(60000);
    expect(config.retry.backoffMultiplier).toBe(2);
    expect(config.retry.jitterMaxMs).toBe(1000);
    expect(config.logging.level).toBe('info');
    expect(config.logging.pretty).toBe(false);
    expect(config.metrics.enabled).toBe(true);
  });

  it('should parse custom rate limit values', () => {
    process.env.BUILTWITH_API_KEY = 'test-key';
    process.env.MCP_RATE_LIMIT_RPS = '5';
    process.env.MCP_MAX_CONCURRENT = '4';

    const config = loadConfig();

    expect(config.rateLimit.requestsPerSecond).toBe(5);
    expect(config.rateLimit.maxConcurrent).toBe(4);
  });

  it('should parse cache configuration', () => {
    process.env.BUILTWITH_API_KEY = 'test-key';
    process.env.MCP_CACHE_ENABLED = 'false';
    process.env.MCP_CACHE_SIZE = '500';
    process.env.MCP_CACHE_TTL = '1800'; // 30 minutes in seconds

    const config = loadConfig();

    expect(config.cache.enabled).toBe(false);
    expect(config.cache.maxSize).toBe(500);
    expect(config.cache.ttlMs).toBe(1800000); // Converted to milliseconds
  });

  it('should parse retry configuration', () => {
    process.env.BUILTWITH_API_KEY = 'test-key';
    process.env.MCP_RETRY_MAX = '5';
    process.env.MCP_RETRY_INITIAL_DELAY = '2000';
    process.env.MCP_RETRY_MAX_DELAY = '30000';
    process.env.MCP_RETRY_BACKOFF_MULTIPLIER = '3';
    process.env.MCP_RETRY_JITTER_MAX = '500';

    const config = loadConfig();

    expect(config.retry.maxRetries).toBe(5);
    expect(config.retry.initialDelayMs).toBe(2000);
    expect(config.retry.maxDelayMs).toBe(30000);
    expect(config.retry.backoffMultiplier).toBe(3);
    expect(config.retry.jitterMaxMs).toBe(500);
  });

  it('should parse logging configuration', () => {
    process.env.BUILTWITH_API_KEY = 'test-key';
    process.env.MCP_LOG_LEVEL = 'debug';
    process.env.MCP_LOG_PRETTY = 'true';

    const config = loadConfig();

    expect(config.logging.level).toBe('debug');
    expect(config.logging.pretty).toBe(true);
  });

  it('should parse metrics configuration', () => {
    process.env.BUILTWITH_API_KEY = 'test-key';
    process.env.MCP_METRICS_ENABLED = 'false';

    const config = loadConfig();

    expect(config.metrics.enabled).toBe(false);
  });

  it('should handle boolean string variations', () => {
    process.env.BUILTWITH_API_KEY = 'test-key';

    process.env.MCP_CACHE_ENABLED = 'TRUE';
    let config = loadConfig();
    expect(config.cache.enabled).toBe(true);

    process.env.MCP_CACHE_ENABLED = '1';
    config = loadConfig();
    expect(config.cache.enabled).toBe(true);

    process.env.MCP_CACHE_ENABLED = 'false';
    config = loadConfig();
    expect(config.cache.enabled).toBe(false);

    process.env.MCP_CACHE_ENABLED = '0';
    config = loadConfig();
    expect(config.cache.enabled).toBe(false);
  });

  it('should use defaults for invalid number values', () => {
    process.env.BUILTWITH_API_KEY = 'test-key';
    process.env.MCP_RATE_LIMIT_RPS = 'invalid';
    process.env.MCP_CACHE_SIZE = 'not-a-number';

    const config = loadConfig();

    expect(config.rateLimit.requestsPerSecond).toBe(10); // Default
    expect(config.cache.maxSize).toBe(1000); // Default
  });

  it('should validate rate limit constraints', () => {
    process.env.BUILTWITH_API_KEY = 'test-key';
    process.env.MCP_RATE_LIMIT_RPS = '0'; // Below minimum

    expect(() => loadConfig()).toThrow('Configuration validation failed');
  });

  it('should validate cache size constraints', () => {
    process.env.BUILTWITH_API_KEY = 'test-key';
    process.env.MCP_CACHE_SIZE = '5'; // Below minimum

    expect(() => loadConfig()).toThrow('Configuration validation failed');
  });
});
