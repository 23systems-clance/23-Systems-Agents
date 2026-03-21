/**
 * Dialer Inactivity Worker (T062)
 *
 * Processes delayed jobs from the dialer-inactivity queue:
 * - `warning` type: logs warning event (frontend polls for this)
 * - `timeout` type: auto-completes the session after 30 min inactivity
 */

import { Worker, type Job } from 'bullmq';
import { config } from '../../../config/index.js';
import { handleInactivityTimeout } from '../../dialer/sessionManager.js';
import { prisma } from '../../../models/index.js';
import logger from '../../../lib/logger.js';

interface InactivityJobData {
  sessionId: string;
  type: 'warning' | 'timeout';
}

/**
 * Process a single inactivity job.
 */
async function processInactivityJob(job: Job<InactivityJobData>): Promise<void> {
  const { sessionId, type } = job.data;

  if (type === 'warning') {
    // Mark session as having a pending warning.
    // The frontend polls the session endpoint and checks this flag.
    try {
      await prisma.dialerSession.update({
        where: { id: sessionId },
        data: { metadata: { inactivityWarning: true, warningAt: new Date().toISOString() } },
      });
      logger.info('[InactivityWorker] Warning sent for session', { sessionId });
    } catch (error) {
      // Session may have been completed already
      logger.debug('[InactivityWorker] Could not set warning flag', {
        sessionId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return;
  }

  if (type === 'timeout') {
    const stats = await handleInactivityTimeout(sessionId);
    if (stats) {
      logger.info('[InactivityWorker] Session auto-completed due to inactivity', {
        sessionId,
        totalDialed: stats.totalDialed,
        totalConnected: stats.totalConnected,
      });
    }
  }
}

/**
 * Create and return the dialer inactivity worker.
 */
export function createDialerInactivityWorker(): Worker {
  const worker = new Worker<InactivityJobData>(
    'dialer-inactivity',
    async (job: Job<InactivityJobData>) => {
      await processInactivityJob(job);
    },
    {
      connection: { url: config.redis.url },
      concurrency: 5,
    },
  );

  worker.on('failed', (job, err) => {
    logger.error('[InactivityWorker] Job failed', {
      jobId: job?.id,
      sessionId: job?.data?.sessionId,
      error: err.message,
    });
  });

  return worker;
}
