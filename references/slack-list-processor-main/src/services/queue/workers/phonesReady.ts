/**
 * BullMQ worker for phones-ready jobs (T042).
 *
 * Processes jobs from the 'phone-data' queue with the name 'phones-ready'.
 * When all phone lookups for a contact enrichment job have been received
 * (or timed out), this worker verifies the data and enqueues a
 * file-generation job to produce the final output.
 */

import { Worker, Job } from 'bullmq';
import { WebClient } from '@slack/web-api';
import { config } from '../../../config/index.js';
import { prisma } from '../../../models/index.js';
import { fileGenerationQueue } from '../queues.js';
import logger from '../../../lib/logger.js';
import type { PhonesReadyData, FileGenerationData } from '../queues.js';

const slackClient = new WebClient(config.slack.botToken);

// ---------------------------------------------------------------------------
// Worker processor
// ---------------------------------------------------------------------------

/**
 * Processes a phones-ready job.
 *
 * Steps:
 * 1. Load all contacts for the job.
 * 2. Verify all phone data received (mark timed-out lookups).
 * 3. Update job status.
 * 4. Enqueue file-generation job.
 *
 * @param job - BullMQ job containing {@link PhonesReadyData}.
 */
async function processPhonesReady(job: Job<PhonesReadyData>): Promise<void> {
  const { jobId } = job.data;
  const jobLogger = logger.withContext({ jobId });

  jobLogger.info('Phones-ready processing started');

  // 1. Load the job and check pending lookups
  const dbJob = await prisma.job.findUniqueOrThrow({
    where: { id: jobId },
    select: {
      slackChannelId: true,
      slackThreadTs: true,
      sourceFileType: true,
      status: true,
    },
  });

  // 2. Check for any remaining PENDING lookups (shouldn't happen but handle gracefully)
  const pendingLookups = await prisma.pendingPhoneLookup.findMany({
    where: {
      jobId,
      status: 'PENDING',
    },
  });

  if (pendingLookups.length > 0) {
    jobLogger.warn('Some phone lookups still pending, marking as TIMED_OUT', {
      pendingCount: pendingLookups.length,
    });

    // Mark remaining lookups as timed out
    await prisma.pendingPhoneLookup.updateMany({
      where: {
        jobId,
        status: 'PENDING',
      },
      data: {
        status: 'TIMED_OUT',
      },
    });
  }

  // 3. Count contacts with phone data
  const totalContacts = await prisma.jobContact.count({
    where: { jobId },
  });

  const contactsWithPhones = await prisma.jobContact.count({
    where: {
      jobId,
      OR: [
        { directPhone: { not: null } },
        { businessPhone: { not: null } },
      ],
    },
  });

  // Update job contacts found count
  await prisma.job.update({
    where: { id: jobId },
    data: {
      contactsFound: totalContacts,
    },
  });

  jobLogger.info('Phone data summary', {
    totalContacts,
    contactsWithPhones,
    contactsWithoutPhones: totalContacts - contactsWithPhones,
  });

  // 4. Enqueue file generation job
  const fileJobData: FileGenerationData = {
    jobId,
    outputFormat: dbJob.sourceFileType === 'XLSX' ? 'XLSX' : 'CSV',
    channelId: dbJob.slackChannelId,
    threadTs: dbJob.slackThreadTs,
  };

  await fileGenerationQueue.add('generate-result-file', fileJobData);

  jobLogger.info('File generation job enqueued after phone data received', {
    contactsWithPhones,
    totalContacts,
  });

  // Notify user that phone data has been added and file is being regenerated
  try {
    const phoneMessage = contactsWithPhones > 0
      ? `:phone: Phone numbers received! Updating your list with *${contactsWithPhones}* phone numbers...`
      : `:information_source: Phone enrichment complete. ${totalContacts - contactsWithPhones} contacts don't have publicly available phone numbers.`;

    await slackClient.chat.postMessage({
      channel: dbJob.slackChannelId,
      thread_ts: dbJob.slackThreadTs,
      text: phoneMessage,
    });
  } catch (err) {
    jobLogger.warn('Failed to send phone data notification', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Creates and returns a BullMQ Worker that listens on the 'phone-data'
 * queue for 'phones-ready' jobs.
 *
 * @returns A configured BullMQ {@link Worker} instance.
 */
export function createPhonesReadyWorker(): Worker {
  const worker = new Worker<PhonesReadyData>(
    'phone-data',
    async (job: Job<PhonesReadyData>) => {
      if (job.name !== 'phones-ready') {
        logger.debug('Skipping non-phones-ready job on phone-data queue', {
          jobName: job.name,
        });
        return;
      }

      await processPhonesReady(job);
    },
    {
      connection: { url: config.redis.url },
      concurrency: 1,
    },
  );

  worker.on('completed', (job: Job<PhonesReadyData>) => {
    logger.info('Phones-ready job completed', {
      bullmqJobId: job.id,
      jobId: job.data.jobId,
    });
  });

  worker.on('failed', (job: Job<PhonesReadyData> | undefined, err: Error) => {
    logger.error('Phones-ready job failed', {
      bullmqJobId: job?.id,
      jobId: job?.data.jobId,
      error: err.message,
    });
  });

  return worker;
}
