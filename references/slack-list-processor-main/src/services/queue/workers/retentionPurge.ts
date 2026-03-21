/**
 * Retention purge BullMQ worker.
 *
 * Runs at 01:00 UTC (after daily aggregation at 00:30).
 * Iterates RetentionConfig entries and calls retentionManager
 * for each purgeable data type. Logs results to AuditLog.
 */

import { Worker } from 'bullmq';
import { config } from '../../../config/index.js';
import { runRetentionPurge } from '../../admin/retentionManager.js';
import { logAudit } from '../../../lib/auditLogger.js';
import logger from '../../../lib/logger.js';
import type { RetentionPurgeJobData } from '../queues.js';

/**
 * Creates and returns the retention purge worker.
 */
export function createRetentionPurgeWorker(): Worker<RetentionPurgeJobData> {
  const worker = new Worker<RetentionPurgeJobData>(
    'admin',
    async (job) => {
      if (job.name !== 'retention-purge') return;

      logger.info('Retention purge starting');

      await runRetentionPurge();

      await logAudit({
        action: 'retention_updated',
        actorUserId: 'system',
        actorTeamId: 'system',
        metadata: {
          trigger: 'scheduled_purge',
          date: new Date().toISOString(),
        },
      });

      logger.info('Retention purge complete');
    },
    {
      connection: { url: config.redis.url },
    },
  );

  worker.on('failed', (job, err) => {
    logger.error('Retention purge worker failed', {
      jobId: job?.id,
      error: err.message,
    });
  });

  return worker;
}
