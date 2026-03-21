/**
 * BullMQ worker for email-only waterfall enrichment (Feature 27, US1).
 * Processes email enrichment jobs using Apollo -> Wiza -> AI Ark waterfall.
 */

import { Worker, Job } from 'bullmq';
import { config } from '../../../config/index.js';
import { prisma } from '../../../models/index.js';
import logger from '../../../lib/logger.js';
import { enrichEmailsBatch } from '../../enrichment/emailWaterfall.js';
import { skipExistingData } from '../../enrichment/skipExistingData.js';
import { updateJobTotalCost, formatCostBreakdown, getCostBreakdown } from '../../enrichment/costCalculator.js';
import { WebClient } from '@slack/web-api';

const slackClient = new WebClient(config.slack.botToken);

interface EmailEnrichmentData {
  jobId: string;
  channelId: string;
  threadTs: string;
}

/**
 * Processes an email-only enrichment job using the waterfall.
 *
 * Loads contacts with their related JobCompany (for domain/companyName),
 * filters out contacts that already have emails, runs the waterfall,
 * and updates records with results.
 *
 * @param job - BullMQ job containing {@link EmailEnrichmentData}.
 */
async function processEmailEnrichment(job: Job<EmailEnrichmentData>): Promise<void> {
  const { jobId, channelId, threadTs } = job.data;
  const jobLogger = logger.withContext({ jobId });

  jobLogger.info('Email enrichment started');

  // Load job and contacts with jobCompany relation for domain/companyName
  const dbJob = await prisma.job.findUniqueOrThrow({
    where: { id: jobId },
    include: {
      contacts: {
        select: {
          id: true,
          fullName: true,
          firstName: true,
          lastName: true,
          email: true,
          linkedinUrl: true,
          jobCompany: {
            select: {
              domain: true,
              companyName: true,
            },
          },
        },
      },
    },
  });

  // Filter out contacts with existing emails (FR-026)
  const contactsToEnrich = skipExistingData(dbJob.contacts.map(c => ({
    id: c.id,
    fullName: c.fullName ?? undefined,
    firstName: c.firstName ?? undefined,
    lastName: c.lastName ?? undefined,
    email: c.email ?? undefined,
    domain: c.jobCompany?.domain ?? undefined,
    companyName: c.jobCompany?.companyName ?? undefined,
    linkedinUrl: c.linkedinUrl ?? undefined,
  })), 'EMAIL');

  jobLogger.info('Contacts ready for email enrichment', {
    total: dbJob.contacts.length,
    toEnrich: contactsToEnrich.length,
    skipped: dbJob.contacts.length - contactsToEnrich.length,
  });

  // Enrich emails via waterfall (auto-routes to batch mode for > 5 contacts)
  const results = await enrichEmailsBatch(contactsToEnrich, jobId, (phase, completed, total) => {
    const pct = Math.round((completed / total) * 100);
    jobLogger.info(`Email enrichment progress: ${phase}`, { completed, total, pct });
    job.updateProgress(pct).catch(() => {});
  });

  // Update JobContact records
  let successCount = 0;
  for (const [contactId, result] of results.entries()) {
    if (result) {
      await prisma.jobContact.update({
        where: { id: contactId },
        data: {
          email: result.email,
          emailSource: result.provider,
          emailCost: result.cost,
        },
      });
      successCount++;
    }
  }

  // Update job status
  await prisma.job.update({
    where: { id: jobId },
    data: {
      status: 'COMPLETED',
      contactsFound: successCount,
      completedAt: new Date(),
    },
  });

  // Calculate and update total cost
  await updateJobTotalCost(jobId);

  // Send completion notification with provider breakdown
  const costSummary = await getCostBreakdown(jobId);
  const breakdownMessage = formatCostBreakdown(costSummary);

  await slackClient.chat.postMessage({
    channel: channelId,
    thread_ts: threadTs,
    text: `Email enrichment complete! Found ${successCount} emails.\n\nCost: ${breakdownMessage}`,
  });

  jobLogger.info('Email enrichment completed', {
    successCount,
    totalCost: costSummary.grandTotal,
  });
}

/**
 * Creates and returns a BullMQ Worker for the 'email-enrichment' queue.
 *
 * @returns A configured BullMQ {@link Worker} instance.
 */
export function createEmailEnrichmentWorker(): Worker {
  const worker = new Worker<EmailEnrichmentData>(
    'email-enrichment',
    async (job: Job<EmailEnrichmentData>) => {
      await processEmailEnrichment(job);
    },
    {
      connection: { url: config.redis.url },
      concurrency: 1,
    },
  );

  worker.on('completed', (job: Job<EmailEnrichmentData>) => {
    logger.info('Email enrichment job completed', {
      bullmqJobId: job.id,
      jobId: job.data.jobId,
    });
  });

  worker.on('failed', (job: Job<EmailEnrichmentData> | undefined, err: Error) => {
    logger.error('Email enrichment job failed', {
      bullmqJobId: job?.id,
      jobId: job?.data.jobId,
      error: err.message,
    });
  });

  return worker;
}
