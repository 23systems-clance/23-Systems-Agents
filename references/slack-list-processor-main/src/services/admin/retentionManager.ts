/**
 * Retention manager service.
 *
 * Purges records older than configured retention_days per data type.
 * Deletes in 1000-row batches with a sleep between batches to avoid
 * long-running transactions. Respects locked types (audit_logs, daily_aggregates).
 * Preserves OPEN ErrorLog entries regardless of age.
 */

import { prisma } from '../../models/index.js';
import logger from '../../lib/logger.js';

/**
 * Locked data types that can never be purged.
 */
const LOCKED_TYPES = new Set(['audit_logs', 'daily_aggregates']);

/**
 * Batch size for deletion operations.
 */
const BATCH_SIZE = 1000;

/**
 * Sleep duration between batches in milliseconds.
 */
const BATCH_SLEEP_MS = 500;

/**
 * Sleeps for the given number of milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Purges records for a single data type based on retention configuration.
 *
 * @param dataType - The data type to purge (e.g. 'api_usage_logs').
 * @param retentionDays - Number of days to retain. 0 means permanent (no purge).
 * @returns The total number of records deleted.
 */
export async function purgeDataType(dataType: string, retentionDays: number): Promise<number> {
  if (LOCKED_TYPES.has(dataType)) {
    logger.info('Skipping purge for locked data type', { dataType });
    return 0;
  }

  if (retentionDays <= 0) {
    logger.info('Skipping purge — permanent retention', { dataType });
    return 0;
  }

  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - retentionDays);
  cutoff.setUTCHours(0, 0, 0, 0);

  let totalDeleted = 0;

  switch (dataType) {
    case 'api_usage_logs':
      totalDeleted = await purgeBatched(
        async (batchSize) => {
          const records = await prisma.apiUsageLog.findMany({
            where: { createdAt: { lt: cutoff } },
            select: { id: true },
            take: batchSize,
          });
          if (records.length === 0) return 0;
          const ids = records.map((r) => r.id);
          const result = await prisma.apiUsageLog.deleteMany({
            where: { id: { in: ids } },
          });
          return result.count;
        },
      );
      break;

    case 'error_logs':
      // Only purge RESOLVED errors; preserve OPEN and ACKNOWLEDGED entries.
      totalDeleted = await purgeBatched(
        async (batchSize) => {
          const records = await prisma.errorLog.findMany({
            where: {
              createdAt: { lt: cutoff },
              lifecycleState: 'RESOLVED',
            },
            select: { id: true },
            take: batchSize,
          });
          if (records.length === 0) return 0;
          const ids = records.map((r) => r.id);
          const result = await prisma.errorLog.deleteMany({
            where: { id: { in: ids } },
          });
          return result.count;
        },
      );
      break;

    default:
      logger.warn('Unknown data type for purge', { dataType });
      return 0;
  }

  logger.info('Purge complete', { dataType, totalDeleted, retentionDays });
  return totalDeleted;
}

/**
 * Runs a batch deletion function repeatedly until no more records to delete.
 */
async function purgeBatched(
  deleteBatch: (batchSize: number) => Promise<number>,
): Promise<number> {
  let totalDeleted = 0;

  while (true) {
    const deleted = await deleteBatch(BATCH_SIZE);
    totalDeleted += deleted;

    if (deleted < BATCH_SIZE) break;

    await sleep(BATCH_SLEEP_MS);
  }

  return totalDeleted;
}

/**
 * Runs the full retention purge cycle for all configured data types.
 * Updates last_purged_at for each type after processing.
 */
export async function runRetentionPurge(): Promise<void> {
  const configs = await prisma.retentionConfig.findMany();

  for (const cfg of configs) {
    try {
      const deleted = await purgeDataType(cfg.dataType, cfg.retentionDays);

      if (deleted > 0 || cfg.retentionDays > 0) {
        await prisma.retentionConfig.update({
          where: { id: cfg.id },
          data: { lastPurgedAt: new Date() },
        });
      }
    } catch (error) {
      logger.error('Retention purge failed for data type', {
        dataType: cfg.dataType,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
