/**
 * Daily admin reset BullMQ worker (Feature 39 + Feature 31).
 *
 * Runs at midnight UTC via repeatable jobs on the admin queue.
 * Handles:
 *   - daily-spend-reset: Resets dailySpendUsedUsd to 0 for all workspaces.
 *   - daily-agent-actions-reset (T099): Resets actionsToday to 0 for all agents.
 */

import { Worker } from 'bullmq';
import { config } from '../../../config/index.js';
import logger from '../../../lib/logger.js';
import { prisma } from '../../../models/index.js';
import { resetAllDailySpend } from '../../platform/spendLimiter.js';
import type { DailySpendResetJobData } from '../queues.js';

/**
 * Creates and returns the admin queue worker.
 * Listens on the 'admin' queue for daily reset jobs.
 */
export function createDailySpendResetWorker(): Worker<DailySpendResetJobData> {
  const worker = new Worker<DailySpendResetJobData>(
    'admin',
    async (job) => {
      if (job.name === 'daily-spend-reset') {
        logger.info('Daily spend reset starting');
        const count = await resetAllDailySpend();
        logger.info('Daily spend reset complete', { workspacesReset: count });
      } else if (job.name === 'daily-agent-actions-reset') {
        logger.info('Daily agent actionsToday reset starting');
        const result = await prisma.agent.updateMany({
          where: { actionsToday: { gt: 0 } },
          data: { actionsToday: 0 },
        });
        logger.info('Daily agent actionsToday reset complete', {
          agentsReset: result.count,
        });
      }
    },
    {
      connection: { url: config.redis.url },
    },
  );

  worker.on('failed', (job, err) => {
    logger.error('Admin queue worker failed', {
      jobId: job?.id,
      jobName: job?.name,
      error: err.message,
    });
  });

  return worker;
}
