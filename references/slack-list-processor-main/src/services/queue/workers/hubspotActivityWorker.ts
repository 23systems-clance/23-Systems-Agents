/**
 * BullMQ worker for HubSpot activity sync jobs.
 *
 * Processes jobs from the 'hubspot-activity-sync' queue. Pushes campaign
 * activity (calls, emails, meetings) to HubSpot as engagement records
 * with idempotency tracking.
 */

import { Worker, Job } from 'bullmq';
import { config } from '../../../config/index.js';
import { pushActivity } from '../../hubspot/hubspotActivity.js';
import { isTokenError, handlePermanentSyncFailure } from '../../dialer/crmSyncService.js';
import { prisma } from '../../../models/index.js';
import { logAudit } from '../../../lib/auditLogger.js';
import logger from '../../../lib/logger.js';
import type { HubSpotActivitySyncJobData } from '../queues.js';

// ---------------------------------------------------------------------------
// Worker processor
// ---------------------------------------------------------------------------

/**
 * Processes a single activity sync job.
 *
 * Steps:
 *   1. Load HubSpotConnection for the client
 *   2. Validate connection is ACTIVE
 *   3. Call pushActivity() which handles idempotency, contact upsert,
 *      engagement creation, and sync logging
 */
async function processActivitySyncJob(
  job: Job<HubSpotActivitySyncJobData>,
): Promise<void> {
  const { clientId, eventType, eventId, eventSource, payload } = job.data;

  const connection = await prisma.hubSpotConnection.findUnique({
    where: { clientId },
  });

  if (!connection || connection.status !== 'ACTIVE') {
    logger.info('Skipping activity sync — no active HubSpot connection', { clientId });
    return;
  }

  await pushActivity({
    connectionId: connection.id,
    eventType,
    eventId,
    eventSource,
    contactEmail: (payload as Record<string, unknown>)?.contactEmail as string || '',
    engagementData: payload as Record<string, unknown>,
  });

  logger.info('HubSpot activity synced', { clientId, eventType, eventId, eventSource });
}

// ---------------------------------------------------------------------------
// Worker factory
// ---------------------------------------------------------------------------

/**
 * Creates and returns the HubSpot activity sync BullMQ worker.
 */
export function createHubSpotActivityWorker(): Worker {
  const worker = new Worker<HubSpotActivitySyncJobData>(
    'hubspot-activity-sync',
    async (job: Job<HubSpotActivitySyncJobData>) => {
      await processActivitySyncJob(job);
    },
    {
      connection: { url: config.redis.url },
      concurrency: 2,
    },
  );

  worker.on('failed', (job, err) => {
    const isLastAttempt = job ? job.attemptsMade >= (job.opts.attempts ?? 3) : true;

    logger.error('HubSpot activity sync worker job failed', {
      jobId: job?.id,
      error: err.message,
      eventType: job?.data.eventType,
      eventId: job?.data.eventId,
      attempt: job?.attemptsMade,
      isLastAttempt,
    });

    // Log failure in sync log
    if (job?.data.clientId) {
      // T047: On final attempt with token error, mark connection as expired
      if (isLastAttempt && isTokenError(err)) {
        handlePermanentSyncFailure(job.data.clientId, err.message).catch((e) => {
          logger.warn('Failed to handle permanent sync failure', { error: e });
        });
      }

      prisma.hubSpotConnection
        .findUnique({ where: { clientId: job.data.clientId } })
        .then((conn) => {
          if (conn) {
            return prisma.hubSpotSyncLog.create({
              data: {
                connectionId: conn.id,
                syncType: 'ACTIVITY_PUSH',
                direction: 'push',
                recordsProcessed: 1,
                recordsCreated: 0,
                recordsUpdated: 0,
                recordsFailed: 1,
                errorMessage: err.message,
                metadata: {
                  eventType: job.data.eventType,
                  eventId: job.data.eventId,
                  eventSource: job.data.eventSource,
                  isTokenError: isTokenError(err),
                },
              },
            });
          }
        })
        .catch((logErr) => {
          logger.warn('Failed to log activity sync failure', { error: logErr });
        });

      logAudit({
        action: 'hubspot_activity_sync_failed',
        actorUserId: 'system',
        targetType: 'HubSpotConnection',
        metadata: {
          clientId: job.data.clientId,
          eventType: job.data.eventType,
          eventId: job.data.eventId,
          error: err.message,
        },
      }).catch(() => {});
    }
  });

  return worker;
}
