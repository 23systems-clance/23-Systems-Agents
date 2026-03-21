/**
 * Dialer Callback Worker (T077)
 *
 * Processes repeatable jobs from the dialer-callback queue:
 * - `missed-callback-check`: scans for overdue PENDING callbacks and marks them MISSED
 */

import { Worker, type Job } from 'bullmq';
import { config } from '../../../config/index.js';
import { missedCallbackCheck } from '../../dialer/callbackService.js';
import logger from '../../../lib/logger.js';

/**
 * Process a single dialer callback job.
 */
async function processCallbackJob(job: Job): Promise<void> {
  if (job.name === 'missed-callback-check') {
    const count = await missedCallbackCheck();
    logger.debug('[CallbackWorker] Missed callback check completed', { missedCount: count });
    return;
  }

  logger.warn('[CallbackWorker] Unknown job name', { name: job.name });
}

/**
 * Create and return the dialer callback worker.
 */
export function createDialerCallbackWorker(): Worker {
  const worker = new Worker(
    'dialer-callback',
    async (job: Job) => {
      await processCallbackJob(job);
    },
    {
      connection: { url: config.redis.url },
      concurrency: 1,
    },
  );

  worker.on('failed', (job, err) => {
    logger.error('[CallbackWorker] Job failed', {
      jobId: job?.id,
      name: job?.name,
      error: err.message,
    });
  });

  return worker;
}
