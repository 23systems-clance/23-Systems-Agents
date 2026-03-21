/**
 * CloudWatch Logs tool service for the autonomous agent framework (T022).
 *
 * Queries error logs from CloudWatch, parses winston JSON log entries,
 * and generates deep-link URLs to the CloudWatch console.
 */

import {
  CloudWatchLogsClient,
  FilterLogEventsCommand,
  type FilteredLogEvent,
} from '@aws-sdk/client-cloudwatch-logs';
import logger from '../../../lib/logger.js';

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

/** A structured log entry extracted from a CloudWatch log event. */
export interface LogEntry {
  /** Unix epoch milliseconds when the log was emitted. */
  timestamp: number;
  /** The log message (raw or extracted from JSON). */
  message: string;
  /** CloudWatch log stream name. */
  logStreamName: string;
  /** Log level (error, warn, info, debug). */
  level: string;
  /** Service name from structured log metadata. */
  service: string;
  /** Error details if present in the structured log. */
  error: string;
}

/** Parameters for querying error logs from CloudWatch. */
interface QueryErrorLogsParams {
  /** CloudWatch log group name (e.g., /ecs/prod-slack-list-processor). */
  logGroupName: string;
  /** Start of the time window (Unix epoch ms). */
  startTime: number;
  /** End of the time window (Unix epoch ms). */
  endTime: number;
  /** CloudWatch Logs filter pattern. Defaults to JSON error-level matching. */
  filterPattern?: string;
  /** Maximum number of log events to return. Defaults to 100. */
  limit?: number;
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

const log = logger.withContext({ service: 'cloudWatchLogs' });

const cwClient = new CloudWatchLogsClient({ region: process.env.AWS_REGION });

/** Default filter pattern matches winston JSON logs at error level. */
const DEFAULT_FILTER_PATTERN = '{ $.level = "error" }';

// ---------------------------------------------------------------------------
// Functions
// ---------------------------------------------------------------------------

/**
 * Queries CloudWatch Logs for error-level events within a time window.
 *
 * Handles pagination automatically by following `nextToken` until the
 * requested limit is reached or no more events are available.
 *
 * @param params - Query parameters including log group, time range, and optional filter.
 * @returns Array of parsed {@link LogEntry} objects.
 */
export async function queryErrorLogs(
  params: QueryErrorLogsParams,
): Promise<LogEntry[]> {
  const {
    logGroupName,
    startTime,
    endTime,
    filterPattern = DEFAULT_FILTER_PATTERN,
    limit = 100,
  } = params;

  try {
    log.info('Querying error logs', { logGroupName, startTime, endTime, limit });

    const allEvents: FilteredLogEvent[] = [];
    let nextToken: string | undefined;

    do {
      const response = await cwClient.send(
        new FilterLogEventsCommand({
          logGroupName,
          startTime,
          endTime,
          filterPattern,
          limit: Math.min(limit - allEvents.length, 10_000), // API max is 10 000
          nextToken,
        }),
      );

      const events = response.events ?? [];
      allEvents.push(...events);
      nextToken = response.nextToken;
    } while (nextToken && allEvents.length < limit);

    log.info('Retrieved error logs', {
      logGroupName,
      eventCount: allEvents.length,
    });

    return parseLogEntries(allEvents);
  } catch (error) {
    log.error('Failed to query error logs', {
      logGroupName,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Parses raw CloudWatch log events into structured {@link LogEntry} objects.
 *
 * Attempts to parse each event message as JSON (winston format). Falls back
 * to treating the raw message string when JSON parsing fails.
 *
 * @param events - Raw CloudWatch FilteredLogEvent array.
 * @returns Array of structured log entries.
 */
export function parseLogEntries(events: FilteredLogEvent[]): LogEntry[] {
  return events.map((event) => {
    const rawMessage = event.message ?? '';
    const logStreamName = event.logStreamName ?? '';
    const timestamp = event.timestamp ?? 0;

    try {
      const parsed = JSON.parse(rawMessage);

      return {
        timestamp,
        message: typeof parsed.message === 'string' ? parsed.message : rawMessage,
        logStreamName,
        level: typeof parsed.level === 'string' ? parsed.level : 'unknown',
        service: typeof parsed.service === 'string' ? parsed.service : '',
        error: extractErrorString(parsed.error),
      };
    } catch {
      // Not valid JSON -- treat as raw text
      return {
        timestamp,
        message: rawMessage,
        logStreamName,
        level: 'unknown',
        service: '',
        error: '',
      };
    }
  });
}

/**
 * Generates a deep link URL to a specific log event in the CloudWatch console.
 *
 * @param logGroupName  - CloudWatch log group name.
 * @param logStreamName - CloudWatch log stream name.
 * @param timestamp     - Unix epoch ms of the log event to link to.
 * @returns A fully-formed CloudWatch console URL.
 */
export function getLogLink(
  logGroupName: string,
  logStreamName: string,
  timestamp: number,
): string {
  const region = process.env.AWS_REGION ?? 'us-east-1';

  // CloudWatch console uses URL-encoded `$` characters in the path
  const encodedLogGroup = encodeURIComponent(encodeURIComponent(logGroupName));
  const encodedLogStream = encodeURIComponent(encodeURIComponent(logStreamName));

  return (
    `https://${region}.console.aws.amazon.com/cloudwatch/home?region=${region}` +
    `#logsV2:log-groups/log-group/${encodedLogGroup}` +
    `/log-events/${encodedLogStream}` +
    `?start=${timestamp}`
  );
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Extracts a string representation from an error field that may be a string,
 * object, or undefined.
 */
function extractErrorString(errorField: unknown): string {
  if (typeof errorField === 'string') {
    return errorField;
  }
  if (errorField && typeof errorField === 'object') {
    const err = errorField as Record<string, unknown>;
    return (
      (typeof err.message === 'string' ? err.message : '') +
      (typeof err.stack === 'string' ? `\n${err.stack}` : '')
    );
  }
  return '';
}
