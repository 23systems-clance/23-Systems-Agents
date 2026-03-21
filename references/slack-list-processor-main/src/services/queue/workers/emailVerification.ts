/**
 * BullMQ worker for Findymail email verification jobs (US6).
 *
 * Processes jobs from the 'email-verify' queue. For each job:
 * 1. Load all JobContacts with email for the given jobId.
 * 2. Call the Findymail API to verify each email.
 * 3. Update each contact with verification result.
 * 4. Post summary to Slack thread.
 * 5. Enqueue file generation.
 */

import { Worker, Job } from 'bullmq';
import type { WebClient } from '@slack/web-api';
import { config } from '../../../config/index.js';
import { prisma } from '../../../models/index.js';
import { verifyEmailsBatch } from '../../findymail/client.js';
import type { EmailVerificationData } from '../queues.js';
import { runPostEmailPipeline } from './postEnrichmentPipeline.js';
import { publishProgress } from '../../agent/taskVisualizer.js';
import logger from '../../../lib/logger.js';

/**
 * Creates and returns a BullMQ Worker that listens on the 'email-verify' queue.
 *
 * @param slackClient - Slack Web API client for posting status messages.
 * @returns A configured BullMQ Worker instance.
 */
export function createEmailVerificationWorker(slackClient: WebClient): Worker {
  const worker = new Worker<EmailVerificationData>(
    'email-verify',
    async (job: Job<EmailVerificationData>) => {
      const { jobId, channelId, threadTs } = job.data;
      const jobLogger = logger.withContext({ jobId, worker: 'email-verify' });

      jobLogger.info('Email verification worker started', { jobId });

      try {
        // 1. Load all contacts with emails for this job
        const contacts = await prisma.jobContact.findMany({
          where: { jobId, email: { not: null } },
          select: { id: true, email: true },
        });

        if (contacts.length === 0) {
          jobLogger.info('No contacts with emails to verify');
          await runPostEmailPipeline(jobId, channelId, threadTs);
          return;
        }

        const apiKey = config.findymail.apiKey;
        if (!apiKey) {
          jobLogger.warn('FINDYMAIL_API_KEY not configured, skipping verification');
          await runPostEmailPipeline(jobId, channelId, threadTs);
          return;
        }

        jobLogger.info('Calling Findymail API', { emailCount: contacts.length });

        await publishProgress({
          jobId,
          stage: 'email_verification',
          status: 'in_progress',
          detail: `Verifying ${contacts.length} email${contacts.length !== 1 ? 's' : ''}`,
        });

        // 2. Build email -> contactIds mapping (emails may not be unique)
        const emailToContactIds = new Map<string, string[]>();
        for (const contact of contacts) {
          const email = contact.email!;
          const existing = emailToContactIds.get(email) ?? [];
          existing.push(contact.id);
          emailToContactIds.set(email, existing);
        }

        const uniqueEmails = Array.from(emailToContactIds.keys());

        // 3. Call the Findymail API
        const batchResult = await verifyEmailsBatch(
          uniqueEmails,
          apiKey,
          config.findymail.maxConcurrency,
        );

        // 4. Update contacts based on results
        const costPerVerification = config.findymail.costPerVerification;
        let verifiedCount = 0;
        let unverifiedCount = 0;

        for (const result of batchResult.results) {
          const contactIds = emailToContactIds.get(result.email);
          if (!contactIds) continue;

          for (const contactId of contactIds) {
            await prisma.jobContact.update({
              where: { id: contactId },
              data: {
                emailVerified: result.verified,
                emailProvider: result.provider,
                verificationCost: costPerVerification,
              },
            });

            if (result.verified) {
              verifiedCount++;
            } else {
              unverifiedCount++;
            }
          }
        }

        jobLogger.info('Email verification complete', {
          totalChecked: batchResult.totalChecked,
          verified: verifiedCount,
          unverified: unverifiedCount,
        });

        await publishProgress({
          jobId,
          stage: 'email_verification',
          status: 'complete',
          detail: `${verifiedCount} verified, ${unverifiedCount} unverified`,
        });

        // 5. Post summary to Slack
        try {
          await slackClient.chat.postMessage({
            channel: channelId,
            thread_ts: threadTs,
            text: `Email verification complete: ${verifiedCount} verified, ${unverifiedCount} unverified out of ${contacts.length} checked.`,
          });
        } catch (err) {
          jobLogger.warn('Failed to post email verification summary to Slack', {
            error: err instanceof Error ? err.message : String(err),
          });
        }

        // 6. Update verification counts, then run post-email pipeline
        //    (phone cascade -> DNC gate -> file generation)
        await prisma.job.update({
          where: { id: jobId },
          data: {
            emailsVerified: verifiedCount,
            emailsUnverified: unverifiedCount,
          },
        });

        await runPostEmailPipeline(jobId, channelId, threadTs);
      } catch (error) {
        jobLogger.error('Email verification worker failed', {
          error: error instanceof Error ? error.message : String(error),
        });

        // Post error to Slack
        try {
          await slackClient.chat.postMessage({
            channel: channelId,
            thread_ts: threadTs,
            text: 'Email verification failed. Generating results file without verification data.',
          });
        } catch {
          // Ignore Slack notification failure
        }

        // Still proceed even if verification fails (graceful degradation)
        // Run post-email pipeline: phone cascade -> DNC gate -> file generation
        await runPostEmailPipeline(jobId, channelId, threadTs);
      }
    },
    {
      connection: { url: config.redis.url },
      concurrency: 1,
    },
  );

  worker.on('failed', (job, err) => {
    logger.error('Email verification job failed', {
      jobId: job?.data?.jobId,
      error: err.message,
    });
  });

  return worker;
}

