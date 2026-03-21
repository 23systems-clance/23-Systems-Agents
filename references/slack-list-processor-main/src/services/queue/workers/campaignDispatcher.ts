/**
 * Single BullMQ dispatcher worker for the 'campaign' queue.
 *
 * Routes incoming jobs to the correct processor based on `job.name`.
 * Handles: campaign-import, campaign-sequence, campaign-daily-dm,
 *          campaign-eod-report, campaign-stuck-check.
 */

import { Worker, Job } from 'bullmq';
import type { WebClient } from '@slack/web-api';
import { config } from '../../../config/index.js';
import { importContactsFromHubSpot } from '../../campaign/contactImport.js';
import { initializeSequence, executeStep } from '../../campaign/sequenceEngine.js';
import { detectAndFlagStuckSteps } from '../../campaign/stuckStepDetector.js';
import { sendDailyBriefings } from '../../campaign/dailyDm.js';
import { sendEodReports } from '../../campaign/eodReport.js';
import { logError } from '../../../services/admin/errorLogger.js';
import logger from '../../../lib/logger.js';

/**
 * Processes a campaign-import job by importing contacts from HubSpot.
 */
async function processCampaignImport(job: Job): Promise<void> {
  const { campaignId } = job.data;
  logger.info('Processing campaign import job', { campaignId, bullmqJobId: job.id });

  const result = await importContactsFromHubSpot(campaignId);

  logger.info('Campaign import job finished, initializing sequence', {
    campaignId,
    bullmqJobId: job.id,
    ...result,
  });

  // After import, initialize the sequence for all imported contacts
  await initializeSequence(campaignId);
}

/**
 * Processes a campaign-sequence job by executing the current step for a contact.
 */
async function processCampaignSequence(job: Job): Promise<void> {
  const { contactId } = job.data;
  logger.info('Processing campaign sequence job', { contactId, bullmqJobId: job.id });
  await executeStep(contactId);
}

/**
 * Processes a campaign-stuck-check job by detecting stuck step executions.
 */
async function processCampaignStuckCheck(job: Job): Promise<void> {
  logger.info('Processing campaign stuck check job', { bullmqJobId: job.id });
  const count = await detectAndFlagStuckSteps();
  logger.info('Campaign stuck check complete', { bullmqJobId: job.id, flagged: count });
}

/**
 * Creates a single BullMQ Worker on the 'campaign' queue that
 * dispatches each job to the correct processor based on job.name.
 *
 * @param slackClient - Slack Web API client for DM-sending jobs
 * @returns A configured BullMQ Worker instance.
 */
export function createCampaignDispatcher(slackClient: WebClient): Worker {
  /**
   * Processors that need the Slack client are created as closures.
   */
  async function processCampaignDailyDm(job: Job): Promise<void> {
    logger.info('Processing campaign daily DM job', { bullmqJobId: job.id });
    await sendDailyBriefings(slackClient);
  }

  async function processCampaignEodReport(job: Job): Promise<void> {
    logger.info('Processing campaign EOD report job', { bullmqJobId: job.id });
    await sendEodReports(slackClient);
  }

  const processors: Record<string, (job: Job) => Promise<void>> = {
    'campaign-import': processCampaignImport,
    'campaign-sequence': processCampaignSequence,
    'campaign-stuck-check': processCampaignStuckCheck,
    'campaign-daily-dm': processCampaignDailyDm,
    'campaign-eod-report': processCampaignEodReport,
  };

  const worker = new Worker(
    'campaign',
    async (job: Job) => {
      const processor = processors[job.name];
      if (!processor) {
        logger.error('Unknown job name on campaign queue', {
          jobName: job.name,
          bullmqJobId: job.id,
        });
        throw new Error(`Unknown campaign job name: ${job.name}`);
      }

      await processor(job);
    },
    {
      connection: { url: config.redis.url },
      concurrency: 1,
    },
  );

  worker.on('completed', (job: Job) => {
    logger.info('Campaign job completed', {
      bullmqJobId: job.id,
      jobName: job.name,
      campaignId: job.data?.campaignId,
    });
  });

  worker.on('failed', (job: Job | undefined, err: Error) => {
    logger.error('Campaign job failed', {
      bullmqJobId: job?.id,
      jobName: job?.name,
      campaignId: job?.data?.campaignId,
      error: err.message,
    });
    logError({
      category: 'QUEUE_ERROR',
      service: `queue:${job?.name ?? 'campaign'}`,
      message: err.message,
      stackTrace: err.stack,
      jobId: job?.data?.campaignId,
    });
  });

  return worker;
}
