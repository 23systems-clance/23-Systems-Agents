/**
 * BullMQ worker for daily billing cycle reset.
 *
 * Runs daily at 00:05 UTC. Queries active BillingProfiles whose
 * billingCycleDay matches today and processes their monthly reset.
 */

import { Worker, Job } from 'bullmq';
import { config } from '../../../config/index.js';
import { prisma } from '../../../models/index.js';
import {
  shouldResetToday,
  processMonthlyReset,
} from '../../billing/monthlyResetProcessor.js';
import logger from '../../../lib/logger.js';

/**
 * Processes the daily billing cycle reset job.
 *
 * Finds all ACTIVE billing profiles whose cycle day matches today
 * and runs their monthly credit reset.
 */
export async function processBillingCycleReset(
  job: Job,
): Promise<void> {
  const jobLogger = logger.withContext({ billingResetJobId: job.id });

  jobLogger.info('Billing cycle reset job started');

  // Fetch all active profiles
  const profiles = await prisma.billingProfile.findMany({
    where: { status: 'ACTIVE' },
  });

  let resetCount = 0;
  let skippedCount = 0;
  let errorCount = 0;

  for (const profile of profiles) {
    // Check if this profile should reset today
    if (!shouldResetToday(profile.billingCycleDay)) {
      skippedCount++;
      continue;
    }

    // Prevent double-reset: check lastResetAt
    if (profile.lastResetAt) {
      const lastReset = new Date(profile.lastResetAt);
      const now = new Date();
      const sameDay =
        lastReset.getUTCFullYear() === now.getUTCFullYear() &&
        lastReset.getUTCMonth() === now.getUTCMonth() &&
        lastReset.getUTCDate() === now.getUTCDate();
      if (sameDay) {
        jobLogger.info('Skipping already-reset profile', {
          slackTeamId: profile.slackTeamId,
          lastResetAt: profile.lastResetAt,
        });
        skippedCount++;
        continue;
      }
    }

    try {
      await processMonthlyReset(profile);
      resetCount++;
    } catch (err) {
      errorCount++;
      jobLogger.error('Failed to reset billing profile', {
        slackTeamId: profile.slackTeamId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  jobLogger.info('Billing cycle reset job completed', {
    totalProfiles: profiles.length,
    resetCount,
    skippedCount,
    errorCount,
  });
}

/**
 * Creates and returns the billing cycle reset worker.
 */
export function createBillingCycleResetWorker(): Worker {
  const worker = new Worker(
    'billing',
    async (job) => {
      if (job.name === 'billing-cycle-reset') {
        await processBillingCycleReset(job);
      }
    },
    {
      connection: { url: config.redis.url },
      concurrency: 1,
    },
  );

  worker.on('failed', (job, err) => {
    logger.error('Billing cycle reset worker failed', {
      jobId: job?.id,
      error: err.message,
    });
  });

  return worker;
}
