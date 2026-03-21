/**
 * BullMQ worker for processing large HubSpot batch sync jobs.
 *
 * Processes jobs queued by the workflow engine's HUBSPOT node when
 * the contact count exceeds 100 (too large for inline processing).
 * Uses the HubSpot sync service with progress tracking.
 */

import { Worker } from 'bullmq';
import { config } from '../../config/index.js';
import { syncContactsToHubSpot } from '../hubspot/hubspotSyncService.js';
import { initNodeProgress, updateNodeProgress, completeNodeProgress } from '../workflow/progressTracker.js';
import { prisma } from '../../models/index.js';
import type { HubSpotSyncJobData } from './queues.js';
import type { HubSpotNodeConfig } from '../workflow/types.js';
import logger from '../../lib/logger.js';

/**
 * Creates and starts the HubSpot sync worker.
 *
 * @returns The BullMQ Worker instance.
 */
export function createHubSpotWorker(): Worker<HubSpotSyncJobData> {
  const worker = new Worker<HubSpotSyncJobData>(
    'hubspot-sync',
    async (job) => {
      const { executionId, nodeId, contacts, config: nodeConfig } = job.data;

      logger.info('HubSpot sync worker: processing batch', {
        jobId: job.id,
        executionId,
        nodeId,
        contactCount: contacts.length,
      });

      // Initialize progress tracking
      await initNodeProgress(executionId, nodeId, 'HUBSPOT', contacts.length, 'HubSpot Sync');

      try {
        const result = await syncContactsToHubSpot(
          contacts,
          nodeConfig as unknown as HubSpotNodeConfig,
        );

        // Update progress with final counts
        await updateNodeProgress(executionId, nodeId, {
          processed: result.total,
          succeeded: result.created + result.updated,
          failed: result.failed,
          skipped: result.skipped,
          errorSample: result.errors?.map((e) => e.error).slice(0, 5),
        });

        await completeNodeProgress(executionId, nodeId);

        // Store result in execution context
        await prisma.workflowExecution.update({
          where: { id: executionId },
          data: {
            context: {
              ...(await getExecutionContext(executionId)),
              [`hubspot_${nodeId}_result`]: result,
            } as any,
          },
        });

        logger.info('HubSpot sync worker: batch completed', {
          jobId: job.id,
          executionId,
          created: result.created,
          updated: result.updated,
          failed: result.failed,
        });

        return result;
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);

        await updateNodeProgress(executionId, nodeId, {
          processed: contacts.length,
          failed: contacts.length,
          errorSample: [errorMsg],
        });

        await completeNodeProgress(executionId, nodeId);

        logger.error('HubSpot sync worker: batch failed', {
          jobId: job.id,
          executionId,
          error: errorMsg,
        });

        throw err;
      }
    },
    {
      connection: { url: config.redis.url },
      concurrency: 2,
    },
  );

  worker.on('failed', (job, err) => {
    logger.error('HubSpot sync worker: job failed', {
      jobId: job?.id,
      error: err.message,
    });
  });

  logger.info('HubSpot sync worker started');
  return worker;
}

/**
 * Helper to get current execution context.
 */
async function getExecutionContext(executionId: string): Promise<Record<string, unknown>> {
  const execution = await prisma.workflowExecution.findUnique({
    where: { id: executionId },
    select: { context: true },
  });
  return (execution?.context as Record<string, unknown>) || {};
}
