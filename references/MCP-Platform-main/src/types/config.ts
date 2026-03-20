/**
 * Configuration type definitions
 */

export interface ServerConfig {
  builtwith: {
    apiKey: string;
  };
  rateLimit: {
    requestsPerSecond: number;
    maxConcurrent: number;
  };
  cache: {
    enabled: boolean;
    maxSize: number;
    ttlMs: number;
  };
  retry: {
    maxRetries: number;
    initialDelayMs: number;
    maxDelayMs: number;
    backoffMultiplier: number;
    jitterMaxMs: number;
  };
  logging: {
    level: 'debug' | 'info' | 'warn' | 'error';
    pretty: boolean;
  };
  metrics: {
    enabled: boolean;
  };
}
