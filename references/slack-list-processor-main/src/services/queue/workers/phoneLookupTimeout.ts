/**
 * BullMQ repeatable scheduler for phone lookup timeout detection (T066).
 *
 * Runs every 5 minutes to find PendingPhoneLookup records that have exceeded
 * their expiry window. Timed-out records are marked as TIMED_OUT, and when
 * all lookups for a given job are resolved (RECEIVED or TIMED_OUT), a
 * 'phones-ready' job is enqueued on the phoneDataQueue so file generation
 * can proceed.
 */

import { Worker, Queue, Job } from 'bullmq';
import { config } from '../../../config/index.js';
import { prisma } from '../../../models/index.js';
import { phoneDataQueue } from '../queues.js';
import logger from '../../../lib/logger.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Queue name dedicated to the phone-timeout scheduler. */
const QUEUE_NAME = 'phone-timeout';

/** Interval between timeout checks (5 minutes). */
const CHECK_INTERVAL_MS = 5 * 60 * 1000;

// ---------------------------------------------------------------------------
// Processor
// ---------------------------------------------------------------------------

/**
 * Scans for expired PendingPhoneLookup records, marks them as TIMED_OUT,
 * and triggers phones-ready jobs for any fully-resolved jobs.
 *
 * @param _job - The BullMQ repeatable trigger job (payload unused).
 */
async function processTimeoutCheck(_job: Job): Promise<void> {
  const now = new Date();

  // 1. Find all PENDING lookups that have passed their expiry time.
  const expiredLookups = await prisma.pendingPhoneLookup.findMany({
    where: {
      status: 'PENDING',
      expiresAt: { lt: now },
    },
    select: {
      id: true,
      jobId: true,
    },
  });

  if (expiredLookups.length === 0) {
    logger.debug('Phone lookup timeout check: no expired lookups found');
    return;
  }

  const expiredIds = expiredLookups.map((l) => l.id);

  logger.info('Phone lookup timeout check: marking expired lookups', {
    expiredCount: expiredIds.length,
  });

  // 2. Mark all expired lookups as TIMED_OUT in a single batch.
  await prisma.pendingPhoneLookup.updateMany({
    where: { id: { in: expiredIds } },
    data: { status: 'TIMED_OUT' },
  });

  // 3. Group by jobId to check per-job completion.
  const affectedJobIds = [...new Set(expiredLookups.map((l) => l.jobId))];

  for (const jobId of affectedJobIds) {
    const stillPending = await prisma.pendingPhoneLookup.count({
      where: {
        jobId,
        status: 'PENDING',
      },
    });

    if (stillPending === 0) {
      // All lookups for this job are resolved -- enqueue phones-ready.
      logger.info('All phone lookups resolved for job, enqueuing phones-ready', {
        jobId,
      });

      await phoneDataQueue.add('phones-ready', { jobId });
    } else {
      logger.debug('Job still has pending phone lookups', {
        jobId,
        stillPending,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Public scheduler factory
// ---------------------------------------------------------------------------

/**
 * Starts the phone lookup timeout scheduler.
 *
 * Creates a dedicated BullMQ queue and worker pair. A repeatable job is
 * registered to fire every 5 minutes. Each invocation runs
 * {@link processTimeoutCheck} to sweep expired lookups.
 *
 * @returns A promise that resolves once the repeatable job and worker are set up.
 */
export async function startPhoneLookupTimeoutScheduler(): Promise<void> {
  const connection = { url: config.redis.url };

  const queue = new Queue(QUEUE_NAME, { connection });

  // Upsert the repeatable job (idempotent -- BullMQ deduplicates by key).
  await queue.add(
    'check-timeouts',
    {},
    {
      repeat: { every: CHECK_INTERVAL_MS },
    },
  );

  const worker = new Worker(
    QUEUE_NAME,
    async (job: Job) => {
      await processTimeoutCheck(job);
    },
    {
      connection,
      concurrency: 1,
    },
  );

  worker.on('completed', (job: Job) => {
    logger.debug('Phone timeout check completed', { bullmqJobId: job.id });
  });

  worker.on('failed', (job: Job | undefined, err: Error) => {
    logger.error('Phone lookup timeout check failed', {
      bullmqJobId: job?.id,
      error: err.message,
    });
  });

  logger.info('Phone lookup timeout scheduler started', {
    intervalMs: CHECK_INTERVAL_MS,
  });
}
