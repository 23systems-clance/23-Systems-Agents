/**
 * BullMQ worker for DNC scrub jobs.
 *
 * Processes jobs from the 'dnc-scrub' queue. For each job:
 * 1. Load all JobContacts with directPhone for the given jobId.
 * 2. Call the DNCScrub API with all phone numbers.
 * 3. Update each contact:
 *    - Clean: dncStatus = CLEAN
 *    - On DNC: dncStatus = ON_DNC_LIST, clear directPhone
 * 4. Post summary to Slack thread.
 * 5. Enqueue file generation.
 */

import { Worker, Job } from 'bullmq';
import type { WebClient } from '@slack/web-api';
import { config } from '../../../config/index.js';
import { prisma } from '../../../models/index.js';
import { scrubPhoneNumbers, toSignificant } from '../../dncscrub/client.js';
import { fileGenerationQueue } from '../queues.js';
import type { DncScrubJobData, FileGenerationData } from '../queues.js';
import { publishProgress } from '../../agent/taskVisualizer.js';
import logger from '../../../lib/logger.js';

/**
 * Creates and returns a BullMQ Worker that listens on the 'dnc-scrub' queue.
 *
 * @param slackClient - Slack Web API client for posting status messages.
 * @returns A configured BullMQ Worker instance.
 */
export function createDncScrubWorker(slackClient: WebClient): Worker {
  const worker = new Worker<DncScrubJobData>(
    'dnc-scrub',
    async (job: Job<DncScrubJobData>) => {
      const { jobId, channelId, threadTs } = job.data;
      const jobLogger = logger.withContext({ jobId, worker: 'dnc-scrub' });

      jobLogger.info('DNC scrub worker started', { jobId });

      try {
        // 1. Load all contacts with phone numbers for this job
        const contacts = await prisma.jobContact.findMany({
          where: { jobId, directPhone: { not: null } },
          select: { id: true, directPhone: true },
        });

        if (contacts.length === 0) {
          jobLogger.info('No contacts with phone numbers to scrub');
          await enqueueFileGen(jobId, jobLogger);
          return;
        }

        const apiKey = config.dncscrub.apiKey;
        if (!apiKey) {
          jobLogger.warn('DNCSCRUB_API_KEY not configured, skipping scrub');
          await enqueueFileGen(jobId, jobLogger);
          return;
        }

        // 2. Build phone -> contactId mapping
        const phoneToContactIds = new Map<string, string[]>();
        for (const contact of contacts) {
          const sig = toSignificant(contact.directPhone!);
          if (sig) {
            const existing = phoneToContactIds.get(sig) ?? [];
            existing.push(contact.id);
            phoneToContactIds.set(sig, existing);
          }
        }

        jobLogger.info('Calling DNCScrub API', {
          phoneCount: contacts.length,
          uniquePhones: phoneToContactIds.size,
        });

        // 3. Call the DNCScrub API
        const scrubResults = await scrubPhoneNumbers(
          contacts.map((c) => c.directPhone!),
          apiKey,
        );

        // 4. Update contacts based on results
        let flaggedCount = 0;
        let cleanCount = 0;

        for (const result of scrubResults.results) {
          const contactIds = phoneToContactIds.get(result.phone);
          if (!contactIds) continue;

          for (const contactId of contactIds) {
            if (result.isOnDnc) {
              await prisma.jobContact.update({
                where: { id: contactId },
                data: {
                  dncStatus: 'ON_DNC_LIST',
                  directPhone: null, // Remove the phone number
                },
              });
              flaggedCount++;
            } else {
              await prisma.jobContact.update({
                where: { id: contactId },
                data: { dncStatus: 'CLEAN' },
              });
              cleanCount++;
            }
          }
        }

        // Set remaining contacts (no phone or not in results) to NOT_CHECKED
        await prisma.jobContact.updateMany({
          where: { jobId, dncStatus: null },
          data: { dncStatus: 'NOT_CHECKED' },
        });

        jobLogger.info('DNC scrub complete', {
          totalChecked: scrubResults.totalChecked,
          flagged: flaggedCount,
          clean: cleanCount,
        });

        // 5. Post summary to Slack
        try {
          await slackClient.chat.postMessage({
            channel: channelId,
            thread_ts: threadTs,
            text: `DNC scrub complete: ${scrubResults.totalChecked} number${scrubResults.totalChecked !== 1 ? 's' : ''} checked, ${flaggedCount} flagged and removed.`,
          });
        } catch (err) {
          jobLogger.warn('Failed to post DNC summary to Slack', {
            error: err instanceof Error ? err.message : String(err),
          });
        }

        // 6. DNC is the last gate — complete and enqueue file generation
        await prisma.job.update({
          where: { id: jobId },
          data: { status: 'COMPLETED', completedAt: new Date() },
        });
        await enqueueFileGen(jobId, jobLogger);
      } catch (error) {
        jobLogger.error('DNC scrub worker failed', {
          error: error instanceof Error ? error.message : String(error),
        });

        // Post error to Slack
        try {
          await slackClient.chat.postMessage({
            channel: channelId,
            thread_ts: threadTs,
            text: 'DNC scrub failed. Generating results file without DNC data.',
          });
        } catch {
          // Ignore Slack notification failure
        }

        // Still complete the job even if DNC scrub fails
        await prisma.job.update({
          where: { id: jobId },
          data: { status: 'COMPLETED', completedAt: new Date() },
        });
        await enqueueFileGen(jobId, jobLogger);
      }
    },
    {
      connection: { url: config.redis.url },
      concurrency: 1,
    },
  );

  worker.on('failed', (job, err) => {
    logger.error('DNC scrub job failed', {
      jobId: job?.data?.jobId,
      error: err.message,
    });
  });

  return worker;
}

/**
 * Helper to enqueue file generation for a job.
 */
async function enqueueFileGen(
  jobId: string,
  jobLogger: ReturnType<typeof logger.withContext>,
): Promise<void> {
  const dbJob = await prisma.job.findUniqueOrThrow({
    where: { id: jobId },
    select: { slackChannelId: true, slackThreadTs: true, sourceFileType: true },
  });

  const fileJobData: FileGenerationData = {
    jobId,
    outputFormat: dbJob.sourceFileType === 'XLSX' ? 'XLSX' : 'CSV',
    channelId: dbJob.slackChannelId,
    threadTs: dbJob.slackThreadTs,
  };

  await fileGenerationQueue.add('generate-result-file', fileJobData);
  await publishProgress({ jobId, stage: 'generate', status: 'complete' });

  jobLogger.info('File generation enqueued after DNC scrub', { jobId });
}

