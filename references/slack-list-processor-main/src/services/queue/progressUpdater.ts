/**
 * BullMQ QueueEvents listener for real-time progress updates (T033).
 *
 * Watches the enrichment queue for progress events and posts Slack thread
 * updates at regular intervals (e.g., "Processing... 50/150 companies enriched").
 * Also notifies users of their queue position when a new job is enqueued.
 */

import { QueueEvents, Queue } from 'bullmq';
import { config } from '../../config/index.js';
import { prisma } from '../../models/index.js';
import logger from '../../lib/logger.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Minimum progress change (percentage points) before posting an update. */
const MIN_PROGRESS_INTERVAL = 20;

/** Track last reported progress per job to avoid spamming Slack. */
const lastReportedProgress = new Map<string, number>();

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Creates and starts the QueueEvents listener for real-time Slack updates.
 *
 * Listens on the 'enrichment' queue for:
 * - `progress` events: Posts periodic updates to the Slack thread.
 * - `waiting` events: Notifies the user of their queue position.
 *
 * @param slackClient - Authenticated Slack WebClient for posting messages.
 * @returns The QueueEvents instance (for graceful shutdown).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createProgressUpdater(slackClient: any): QueueEvents {
  const queueEvents = new QueueEvents('enrichment', {
    connection: { url: config.redis.url },
  });

  const enrichmentQueue = new Queue('enrichment', {
    connection: { url: config.redis.url },
  });

  // -------------------------------------------------------------------------
  // Progress events
  // -------------------------------------------------------------------------
  queueEvents.on('progress', async ({ jobId: bullmqJobId, data }) => {
    try {
      const percent = typeof data === 'number' ? data : 0;

      // Check if we've already reported at this interval
      const lastReported = lastReportedProgress.get(bullmqJobId) ?? 0;

      // Skip if progress change is too small, OR if we've already reported 100%
      if (percent - lastReported < MIN_PROGRESS_INTERVAL && percent < 100) {
        return;
      }
      if (percent === 100 && lastReported === 100) {
        return; // Already reported 100%, skip duplicate
      }

      lastReportedProgress.set(bullmqJobId, percent);

      // Resolve the DB job ID from the BullMQ job data.
      // The BullMQ jobId is an auto-increment integer, not the DB UUID.
      const bullmqJob = await enrichmentQueue.getJob(bullmqJobId);
      if (!bullmqJob?.data?.jobId) {
        return;
      }

      const dbJobId = bullmqJob.data.jobId as string;

      // Look up job metadata from the database
      const job = await prisma.job.findUnique({
        where: { id: dbJobId },
        select: {
          slackChannelId: true,
          slackThreadTs: true,
          sourceRowCount: true,
        },
      });

      if (!job) {
        return;
      }

      const totalRows = job.sourceRowCount ?? 0;

      // Suppress progress messages for tiny lists (< 10 companies).
      if (totalRows > 0 && totalRows < 10) {
        return;
      }

      const processed = Math.round((percent / 100) * totalRows);

      await slackClient.chat.postMessage({
        channel: job.slackChannelId,
        thread_ts: job.slackThreadTs,
        text: `Processing... ${processed}/${totalRows} companies enriched (${percent}%)`,
      });

      logger.debug('Progress update posted to Slack', {
        jobId: dbJobId,
        percent,
        processed,
        total: totalRows,
      });

      // NOTE: Do NOT delete the tracking entry at 100%. Keeping it ensures
      // that if BullMQ retries the job, the duplicate progress events are
      // suppressed (the guard at line 62 catches percent===100 duplicates).
      // Cleanup happens when the job completes/fails via the events below.
    } catch (err) {
      logger.error('Failed to post progress update', {
        bullmqJobId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  // -------------------------------------------------------------------------
  // Queue position notification on new jobs
  // -------------------------------------------------------------------------
  queueEvents.on('waiting', async ({ jobId }) => {
    try {
      // Get the count of waiting jobs ahead of this one
      const waitingCount = await enrichmentQueue.getWaitingCount();

      // Only notify if the job is not first in line
      if (waitingCount <= 1) {
        return;
      }

      // Look up the job's Slack thread from the database
      // The jobId in BullMQ may differ from our DB jobId; resolve via job data
      const bullmqJob = await enrichmentQueue.getJob(jobId);
      if (!bullmqJob?.data?.jobId) {
        return;
      }

      const dbJob = await prisma.job.findUnique({
        where: { id: bullmqJob.data.jobId },
        select: {
          slackChannelId: true,
          slackThreadTs: true,
        },
      });

      if (!dbJob) {
        return;
      }

      await slackClient.chat.postMessage({
        channel: dbJob.slackChannelId,
        thread_ts: dbJob.slackThreadTs,
        text: `Your job is #${waitingCount} in the queue. I'll start processing as soon as the current job finishes.`,
      });

      logger.debug('Queue position notification posted', {
        jobId,
        position: waitingCount,
      });
    } catch (err) {
      logger.error('Failed to post queue position notification', {
        jobId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  // -------------------------------------------------------------------------
  // Cleanup progress tracking when jobs complete or fail
  // -------------------------------------------------------------------------
  queueEvents.on('completed', ({ jobId: bullmqJobId }) => {
    lastReportedProgress.delete(bullmqJobId);
  });

  queueEvents.on('failed', ({ jobId: bullmqJobId }) => {
    lastReportedProgress.delete(bullmqJobId);
  });

  logger.info('Progress updater started for enrichment queue');

  return queueEvents;
}
