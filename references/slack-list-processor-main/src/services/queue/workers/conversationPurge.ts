/**
 * BullMQ worker for conversation purge jobs (T064).
 *
 * Processes jobs from the 'retention' queue with the name 'conversation-purge'.
 * Purges conversation turns older than 7 days and creates audit summaries.
 *
 * Implements Phase 11 - Data Retention & Audit requirements.
 */

import { Worker, Job } from 'bullmq';
import { config } from '../../../config/index.js';
import { purgeExpiredConversations } from '../../retention/conversationPurge.js';
import logger from '../../../lib/logger.js';
import type { ConversationPurgeJobData } from '../queues.js';

/**
 * Processes a single conversation purge job.
 *
 * Calls the purgeExpiredConversations service to:
 *   - Find threads with turns older than 7 days
 *   - Create audit summaries
 *   - Delete expired turns
 *   - Update thread statuses
 *
 * @param job - BullMQ job containing {@link ConversationPurgeJobData}.
 */
export async function processConversationPurge(
  job: Job<ConversationPurgeJobData>,
): Promise<void> {
  logger.info('Conversation purge job started', {
    bullmqJobId: job.id,
  });

  try {
    const stats = await purgeExpiredConversations();

    logger.info('Conversation purge job completed', {
      bullmqJobId: job.id,
      ...stats,
    });
  } catch (err) {
    logger.error('Conversation purge job failed', {
      bullmqJobId: job.id,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

/**
 * Creates and returns a BullMQ Worker that listens on the 'retention' queue
 * for jobs named 'conversation-purge'.
 *
 * The worker uses the Redis connection URL from the application config.
 * Concurrency is set to 1 to ensure sequential processing.
 *
 * @returns A configured BullMQ {@link Worker} instance.
 */
export function createConversationPurgeWorker(): Worker {
  const worker = new Worker<ConversationPurgeJobData>(
    'retention',
    async (job: Job<ConversationPurgeJobData>) => {
      if (job.name !== 'conversation-purge') {
        logger.debug('Skipping non-conversation-purge job on retention queue', {
          jobName: job.name,
        });
        return;
      }

      await processConversationPurge(job);
    },
    {
      connection: { url: config.redis.url },
      concurrency: 1,
    },
  );

  worker.on('completed', (job: Job<ConversationPurgeJobData>) => {
    logger.info('Conversation purge worker job completed', {
      bullmqJobId: job.id,
    });
  });

  worker.on('failed', (job: Job<ConversationPurgeJobData> | undefined, err: Error) => {
    logger.error('Conversation purge worker job failed', {
      bullmqJobId: job?.id,
      error: err.message,
    });
  });

  return worker;
}
