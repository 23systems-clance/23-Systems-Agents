/**
 * Post-enrichment pipeline: phone cascade + DNC gate + file generation.
 *
 * Called after email verification completes (or is skipped), or when the
 * email verification gate is not triggered (no Findymail API key / no emails).
 *
 * Flow: Phone cascade (if needed) -> DNC gate -> File generation
 */

import { config } from '../../../config/index.js';
import { prisma } from '../../../models/index.js';
import { fileGenerationQueue } from '../queues.js';
import type { FileGenerationData } from '../queues.js';
import { publishProgress } from '../../agent/taskVisualizer.js';
import { cascadePhoneWaterfall } from '../../enrichment/cascadePhones.js';
import logger from '../../../lib/logger.js';

/**
 * Runs the post-email-verification pipeline:
 * 1. Phone waterfall cascade (if job purpose requires phones)
 * 2. DNC quality gate (if phones found and DNC API key configured)
 * 3. File generation (if no DNC gate triggered)
 *
 * @param jobId     - Parent job UUID.
 * @param channelId - Slack channel ID for notifications.
 * @param threadTs  - Slack thread timestamp.
 */
export async function runPostEmailPipeline(
  jobId: string,
  channelId: string,
  threadTs: string,
): Promise<void> {
  const jobLogger = logger.withContext({ jobId, pipeline: 'post-email' });

  // 1. Check if job needs phones
  const dbJob = await prisma.job.findUniqueOrThrow({
    where: { id: jobId },
    select: { purpose: true, sourceFileType: true },
  });

  const needsPhones = dbJob.purpose === 'COLD_CALLING' || dbJob.purpose === 'ALL';
  if (needsPhones) {
    await cascadePhoneWaterfall(jobId, jobLogger);
  }

  // 2. DNC gate: if phones found and DNC API key configured
  if (config.dncscrub.apiKey) {
    const phoneCount = await prisma.jobContact.count({
      where: { jobId, directPhone: { not: null } },
    });

    if (phoneCount > 0) {
      const { WebClient } = await import('@slack/web-api');
      const { buildDncScrubDecisionBlocks } = await import(
        '../../../listeners/actions/dncScrub.js'
      );
      const slackClient = new WebClient(config.slack.botToken);

      await slackClient.chat.postMessage({
        channel: channelId,
        thread_ts: threadTs,
        text: `Phone enrichment complete! ${phoneCount} phone numbers found. Would you like to scrub against the DNC registry?`,
        blocks: buildDncScrubDecisionBlocks(jobId, phoneCount),
      });

      await prisma.job.update({
        where: { id: jobId },
        data: { status: 'AWAITING_DNC_DECISION' },
      });

      jobLogger.info('DNC gate triggered in post-email pipeline', { jobId, phoneCount });
      return; // DNC button handler takes over
    }
  }

  // 3. No DNC gate needed — mark complete and enqueue file generation
  await prisma.job.update({
    where: { id: jobId },
    data: { status: 'COMPLETED', completedAt: new Date() },
  });

  const fileJobData: FileGenerationData = {
    jobId,
    outputFormat: dbJob.sourceFileType === 'XLSX' ? 'XLSX' : 'CSV',
    channelId,
    threadTs,
  };

  await fileGenerationQueue.add('generate-result-file', fileJobData);
  await publishProgress({ jobId, stage: 'generate', status: 'complete' });

  jobLogger.info('File generation enqueued via post-email pipeline', { jobId });
}
