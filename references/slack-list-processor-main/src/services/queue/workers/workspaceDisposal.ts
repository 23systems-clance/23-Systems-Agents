/**
 * BullMQ worker for workspace disposal jobs (T065).
 *
 * Processes jobs from the 'retention' queue with the name 'workspace-disposal'.
 * Disposes of expired workspace operational data and audit logs.
 *
 * Implements Phase 11 - Data Retention & Audit requirements.
 */

import { Worker, Job } from 'bullmq';
import { config } from '../../../config/index.js';
import {
  disposeExpiredWorkspaces,
  disposeExpiredAuditLogs,
} from '../../retention/workspaceDisposal.js';
import logger from '../../../lib/logger.js';
import type { WorkspaceDisposalJobData } from '../queues.js';

/**
 * Processes a single workspace disposal job.
 *
 * Calls both disposal functions:
 *   1. disposeExpiredWorkspaces - Deletes operational data for workspaces past purgeAfter
 *   2. disposeExpiredAuditLogs - Deletes audit/usage data for workspaces older than 1 year
 *
 * @param job - BullMQ job containing {@link WorkspaceDisposalJobData}.
 */
export async function processWorkspaceDisposal(
  job: Job<WorkspaceDisposalJobData>,
): Promise<void> {
  logger.info('Workspace disposal job started', {
    bullmqJobId: job.id,
  });

  try {
    // Phase 1: Dispose of expired operational data
    const operationalStats = await disposeExpiredWorkspaces();

    logger.info('Operational data disposal completed', {
      bullmqJobId: job.id,
      ...operationalStats,
    });

    // Phase 2: Dispose of expired audit logs (1 year post-uninstall)
    const auditStats = await disposeExpiredAuditLogs();

    logger.info('Audit data disposal completed', {
      bullmqJobId: job.id,
      ...auditStats,
    });

    logger.info('Workspace disposal job completed', {
      bullmqJobId: job.id,
      operationalStats,
      auditStats,
    });
  } catch (err) {
    logger.error('Workspace disposal job failed', {
      bullmqJobId: job.id,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

/**
 * Creates and returns a BullMQ Worker that listens on the 'retention' queue
 * for jobs named 'workspace-disposal'.
 *
 * The worker uses the Redis connection URL from the application config.
 * Concurrency is set to 1 to ensure sequential processing.
 *
 * @returns A configured BullMQ {@link Worker} instance.
 */
export function createWorkspaceDisposalWorker(): Worker {
  const worker = new Worker<WorkspaceDisposalJobData>(
    'retention',
    async (job: Job<WorkspaceDisposalJobData>) => {
      if (job.name !== 'workspace-disposal') {
        logger.debug('Skipping non-workspace-disposal job on retention queue', {
          jobName: job.name,
        });
        return;
      }

      await processWorkspaceDisposal(job);
    },
    {
      connection: { url: config.redis.url },
      concurrency: 1,
    },
  );

  worker.on('completed', (job: Job<WorkspaceDisposalJobData>) => {
    logger.info('Workspace disposal worker job completed', {
      bullmqJobId: job.id,
    });
  });

  worker.on('failed', (job: Job<WorkspaceDisposalJobData> | undefined, err: Error) => {
    logger.error('Workspace disposal worker job failed', {
      bullmqJobId: job?.id,
      error: err.message,
    });
  });

  return worker;
}
