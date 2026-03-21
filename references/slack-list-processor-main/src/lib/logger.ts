import { config } from '../config/index.js';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

interface LogContext {
  jobId?: string;
  channelId?: string;
  [key: string]: unknown;
}

/**
 * Structured JSON logger that outputs newline-delimited JSON to stdout.
 * Supports log level filtering and context injection via child loggers.
 */
class Logger {
  private readonly minLevel: number;
  private readonly baseContext: LogContext;

  constructor(baseContext: LogContext = {}) {
    const configuredLevel = config.logLevel.toLowerCase() as LogLevel;
    this.minLevel = LOG_LEVEL_PRIORITY[configuredLevel] ?? LOG_LEVEL_PRIORITY.info;
    this.baseContext = baseContext;
  }

  /**
   * Creates a child logger with additional context merged into every log entry.
   */
  withContext(ctx: { jobId?: string; channelId?: string; [key: string]: unknown }): Logger {
    const child = new Logger({ ...this.baseContext, ...ctx });
    return child;
  }

  /**
   * Logs a debug-level message.
   */
  debug(message: string, context?: Record<string, unknown>): void {
    this.log('debug', message, context);
  }

  /**
   * Logs an info-level message.
   */
  info(message: string, context?: Record<string, unknown>): void {
    this.log('info', message, context);
  }

  /**
   * Logs a warn-level message.
   */
  warn(message: string, context?: Record<string, unknown>): void {
    this.log('warn', message, context);
  }

  /**
   * Logs an error-level message.
   */
  error(message: string, context?: Record<string, unknown>): void {
    this.log('error', message, context);
  }

  /**
   * Internal method that formats and writes a JSON log line if the level passes the filter.
   */
  private log(level: LogLevel, message: string, context?: Record<string, unknown>): void {
    if (LOG_LEVEL_PRIORITY[level] < this.minLevel) {
      return;
    }

    const entry = {
      level,
      message,
      timestamp: new Date().toISOString(),
      ...this.baseContext,
      ...context,
    };

    console.log(JSON.stringify(entry));
  }
}

/**
 * Default logger instance for application-wide use.
 */
const logger = new Logger();

export { Logger };
export default logger;
