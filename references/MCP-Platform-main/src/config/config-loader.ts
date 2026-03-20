/**
 * Configuration loader with environment variable support and validation
 */

import { z } from 'zod';
import type { ServerConfig } from '../types/config.js';

// Zod schema for configuration validation
const configSchema = z.object({
  builtwith: z.object({
    apiKey: z.string().min(1, 'BuildWith API key is required'),
  }),
  rateLimit: z.object({
    requestsPerSecond: z.number().min(1).max(100).default(10),
    maxConcurrent: z.number().min(1).max(20).default(8),
  }),
  cache: z.object({
    enabled: z.boolean().default(true),
    maxSize: z.number().min(10).max(10000).default(1000),
    ttlMs: z.number().min(1000).default(3600000), // 1 hour default
  }),
  retry: z.object({
    maxRetries: z.number().min(0).max(10).default(3),
    initialDelayMs: z.number().min(100).default(1000),
    maxDelayMs: z.number().min(1000).default(60000),
    backoffMultiplier: z.number().min(1).max(10).default(2),
    jitterMaxMs: z.number().min(0).default(1000),
  }),
  logging: z.object({
    level: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
    pretty: z.boolean().default(false),
  }),
  metrics: z.object({
    enabled: z.boolean().default(true),
  }),
});

/**
 * Load and validate configuration from environment variables
 */
export function loadConfig(): ServerConfig {
  const rawConfig = {
    builtwith: {
      apiKey: process.env.BUILTWITH_API_KEY || '',
    },
    rateLimit: {
      requestsPerSecond: parseNumber(process.env.MCP_RATE_LIMIT_RPS, 10),
      maxConcurrent: parseNumber(process.env.MCP_MAX_CONCURRENT, 8),
    },
    cache: {
      enabled: parseBoolean(process.env.MCP_CACHE_ENABLED, true),
      maxSize: parseNumber(process.env.MCP_CACHE_SIZE, 1000),
      ttlMs: parseNumber(process.env.MCP_CACHE_TTL, 3600) * 1000, // Convert seconds to ms
    },
    retry: {
      maxRetries: parseNumber(process.env.MCP_RETRY_MAX, 3),
      initialDelayMs: parseNumber(process.env.MCP_RETRY_INITIAL_DELAY, 1000),
      maxDelayMs: parseNumber(process.env.MCP_RETRY_MAX_DELAY, 60000),
      backoffMultiplier: parseNumber(process.env.MCP_RETRY_BACKOFF_MULTIPLIER, 2),
      jitterMaxMs: parseNumber(process.env.MCP_RETRY_JITTER_MAX, 1000),
    },
    logging: {
      level: (process.env.MCP_LOG_LEVEL as ServerConfig['logging']['level']) || 'info',
      pretty: parseBoolean(process.env.MCP_LOG_PRETTY, false),
    },
    metrics: {
      enabled: parseBoolean(process.env.MCP_METRICS_ENABLED, true),
    },
  };

  try {
    return configSchema.parse(rawConfig);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const issues = error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
      throw new Error(`Configuration validation failed:\n${issues.join('\n')}`);
    }
    throw error;
  }
}

/**
 * Parse string to number with default fallback
 */
function parseNumber(value: string | undefined, defaultValue: number): number {
  if (!value) return defaultValue;
  const parsed = Number(value);
  return isNaN(parsed) ? defaultValue : parsed;
}

/**
 * Parse string to boolean with default fallback
 */
function parseBoolean(value: string | undefined, defaultValue: boolean): boolean {
  if (!value) return defaultValue;
  return value.toLowerCase() === 'true' || value === '1';
}
