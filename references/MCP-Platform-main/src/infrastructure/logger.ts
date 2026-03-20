/**
 * Structured logging with Pino
 */

import pino from 'pino';
import type { ServerConfig } from '../types/config.js';

export type Logger = pino.Logger;

/**
 * Create a configured Pino logger instance
 */
export function createLogger(config: ServerConfig['logging']): Logger {
  return pino({
    level: config.level,
    transport: config.pretty
      ? {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:standard',
            ignore: 'pid,hostname',
          },
        }
      : undefined,
    formatters: {
      level: (label) => {
        return { level: label };
      },
    },
    redact: {
      paths: ['apiKey', '*.apiKey', 'BUILTWITH_API_KEY', '*.KEY'],
      remove: true,
    },
    serializers: {
      error: pino.stdSerializers.err,
    },
  });
}

/**
 * Create a child logger with additional context
 */
export function createChildLogger(logger: Logger, context: Record<string, unknown>): Logger {
  return logger.child(context);
}
