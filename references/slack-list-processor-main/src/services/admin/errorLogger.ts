/**
 * Database-backed error logger helper.
 *
 * Creates ErrorLog records for centralized error monitoring.
 * Uses the same fire-and-forget pattern as logAudit() and logApiUsage().
 */

import type { ErrorCategory, Prisma } from '@prisma/client';
import { prisma } from '../../models/index.js';
import logger from '../../lib/logger.js';

/** Input data for recording a system error. */
export interface ErrorLogEntry {
  /** Error category for classification. */
  category: ErrorCategory;
  /** Service that generated the error (e.g., "builtwith", "apollo", "queue:technographic"). */
  service: string;
  /** Error message. */
  message: string;
  /** Full stack trace if available. */
  stackTrace?: string;
  /** Associated job ID (null for non-job errors). */
  jobId?: string;
  /** Slack user whose request triggered the error. */
  slackUserId?: string;
  /** Slack channel where the error originated. */
  slackChannelId?: string;
  /** Slack workspace/team ID. */
  slackTeamId?: string;
  /** Additional structured context (e.g., endpoint URL, HTTP status). */
  metadata?: Record<string, unknown>;
}

/**
 * Persists an error log record to the database.
 *
 * Fire-and-forget: errors are caught internally and logged rather than
 * propagated. Callers do not need to await the returned promise.
 *
 * @param entry - The error data to record.
 */
export async function logError(entry: ErrorLogEntry): Promise<void> {
  try {
    await prisma.errorLog.create({
      data: {
        category: entry.category,
        service: entry.service,
        message: entry.message,
        stackTrace: entry.stackTrace ?? null,
        jobId: entry.jobId ?? null,
        slackUserId: entry.slackUserId ?? null,
        slackChannelId: entry.slackChannelId ?? null,
        slackTeamId: entry.slackTeamId ?? null,
        metadata: (entry.metadata as Prisma.InputJsonValue) ?? undefined,
      },
    });

    logger.debug('Error logged to database', {
      category: entry.category,
      service: entry.service,
    });
  } catch (error) {
    logger.error('Failed to log error to database', {
      category: entry.category,
      service: entry.service,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
