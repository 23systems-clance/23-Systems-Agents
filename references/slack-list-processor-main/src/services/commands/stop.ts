/**
 * Job cancellation service for the /enrich slash command.
 *
 * Finds the user's most recent active job and cancels it,
 * removing it from the BullMQ queue if still waiting.
 */

import { prisma } from '../../models/index.js';
import { enrichmentQueue } from '../queue/queues.js';
import logger from '../../lib/logger.js';

/**
 * Result of a job cancellation attempt.
 */
export interface StopResult {
  success: boolean;
  message: string;
  jobId?: string;
  otherActiveCount?: number;
}

/**
 * Cancels the most recent active job for a user.
 *
 * Finds the user's most recent PENDING or PROCESSING job across all
 * threads, marks it as CANCELLED, and removes it from the BullMQ queue
 * if still waiting/delayed.
 *
 * @param userId - Slack user ID requesting cancellation.
 * @returns StopResult with cancellation outcome.
 */
export async function cancelActiveJob(userId: string): Promise<StopResult> {
  const activeJob = await prisma.job.findFirst({
    where: {
      slackUserId: userId,
      status: { in: ['PENDING', 'PROCESSING'] },
    },
    orderBy: { createdAt: 'desc' },
  });

  if (!activeJob) {
    return {
      success: false,
      message: 'No active enrichment job found.',
    };
  }

  // Mark job as CANCELLED in DB.
  await prisma.job.update({
    where: { id: activeJob.id },
    data: { status: 'CANCELLED', completedAt: new Date() },
  });

  // Remove from BullMQ queue if still waiting.
  if (activeJob.bullmqJobId) {
    try {
      const bullmqJob = await enrichmentQueue.getJob(activeJob.bullmqJobId);
      if (bullmqJob) {
        const state = await bullmqJob.getState();
        if (state === 'waiting' || state === 'delayed') {
          await bullmqJob.remove();
        }
      }
    } catch (err) {
      logger.warn('Failed to remove BullMQ job during cancellation', {
        bullmqJobId: activeJob.bullmqJobId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const processed = activeJob.companiesProcessed;
  const total = activeJob.sourceRowCount ?? 0;

  // Count remaining active jobs for this user.
  const otherActiveCount = await prisma.job.count({
    where: {
      slackUserId: userId,
      status: { in: ['PENDING', 'PROCESSING'] },
    },
  });

  logger.info('Job cancelled by user via /enrich stop', {
    jobId: activeJob.id,
    userId,
    processed,
    total,
  });

  return {
    success: true,
    message: `Job cancelled. ${processed}/${total} companies were processed before stopping.`,
    jobId: activeJob.id,
    otherActiveCount,
  };
}
