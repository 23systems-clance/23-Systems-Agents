/**
 * Cache purge BullMQ worker (Feature 17).
 *
 * Runs daily at 02:00 UTC via a repeatable job.
 * Deletes expired DomainEnrichmentCache entries and logs to AuditLog.
 */

import { Worker } from 'bullmq';
import { config } from '../../../config/index.js';
import * as domainCacheService from '../../builtwith/domainCache.js';
import { logAudit } from '../../../lib/auditLogger.js';
import logger from '../../../lib/logger.js';

/**
 * Creates and returns the cache purge worker.
 */
export function createCachePurgeWorker(): Worker {
  const worker = new Worker(
    'admin',
    async (job) => {
      if (job.name !== 'cache-purge') return;

      logger.info('Cache purge starting');

      const purgedCount = await domainCacheService.purgeExpired();

      await logAudit({
        action: 'cache_auto_purge',
        actorUserId: 'system',
        actorTeamId: 'system',
        metadata: {
          purgedCount,
          date: new Date().toISOString(),
        },
      });

      logger.info('Cache purge complete', { purgedCount });
    },
    {
      connection: { url: config.redis.url },
    },
  );

  worker.on('failed', (job, err) => {
    logger.error('Cache purge worker failed', {
      jobId: job?.id,
      error: err.message,
    });
  });

  return worker;
}
