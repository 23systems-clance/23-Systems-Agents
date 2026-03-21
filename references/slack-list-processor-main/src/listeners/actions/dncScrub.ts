/**
 * Bolt action handlers for DNC scrub decision buttons.
 *
 * After phone enrichment completes (when DNCSCRUB_API_KEY is configured),
 * the bot posts "DNC Enrich" / "Don't Enrich DNC" buttons.
 * This handler processes both button clicks.
 *
 * Pattern: same as contactChain.ts
 */

import type { App } from '@slack/bolt';
import type { KnownBlock } from '@slack/types';
import { prisma } from '../../models/index.js';
import { dncScrubQueue, fileGenerationQueue } from '../../services/queue/queues.js';
import type { FileGenerationData } from '../../services/queue/queues.js';
import { publishProgress } from '../../services/agent/taskVisualizer.js';
import logger from '../../lib/logger.js';

/**
 * Builds Block Kit blocks for the DNC scrub decision prompt.
 *
 * @param jobId - The enrichment job ID (passed via button value).
 * @param phonesCount - Number of phone numbers that would be scrubbed.
 * @returns Block Kit blocks array.
 */
export function buildDncScrubDecisionBlocks(
  jobId: string,
  phonesCount: number,
): KnownBlock[] {
  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `Phone enrichment complete! *${phonesCount}* phone number${phonesCount !== 1 ? 's' : ''} found.\n\nWould you like to scrub these numbers against the Do Not Call registry?`,
      },
    },
    {
      type: 'actions',
      block_id: 'dnc_scrub_decision',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: 'DNC Enrich' },
          action_id: 'dnc_scrub_yes',
          value: jobId,
          style: 'primary',
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: "Don't Enrich DNC" },
          action_id: 'dnc_scrub_no',
          value: jobId,
        },
      ],
    },
  ];
}

/**
 * Registers Bolt action handlers for `dnc_scrub_yes` and `dnc_scrub_no`.
 *
 * @param app - The Slack Bolt application instance.
 */
export function registerDncScrubHandlers(app: App): void {
  // -------------------------------------------------------------------------
  // dnc_scrub_yes -- enqueue DNC scrub job
  // -------------------------------------------------------------------------
  app.action('dnc_scrub_yes', async ({ ack, body, client }) => {
    await ack();

    const action = body as {
      type: string;
      channel?: { id: string };
      message?: { ts: string; thread_ts?: string };
      user?: { id: string };
      actions?: Array<{ action_id: string; value: string }>;
    };

    const channelId = action.channel?.id;
    const messageTs = action.message?.ts;
    const threadTs = action.message?.thread_ts ?? messageTs;
    const jobId = action.actions?.[0]?.value;

    if (!channelId || !threadTs || !jobId) {
      logger.warn('dnc_scrub_yes: missing context', { channelId, threadTs, jobId });
      return;
    }

    logger.info('DNC scrub accepted', { jobId, channelId, threadTs });

    // Update the button message
    if (messageTs) {
      try {
        await client.chat.update({
          channel: channelId,
          ts: messageTs,
          text: 'Running DNC scrub...',
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: 'Running DNC scrub on enriched phone numbers...',
              },
            },
          ],
        });
      } catch (err) {
        logger.warn('dnc_scrub_yes: failed to update message', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Enqueue DNC scrub job
    await dncScrubQueue.add('dnc-scrub', {
      jobId,
      channelId,
      threadTs,
    });

    logger.info('DNC scrub job enqueued', { jobId });
  });

  // -------------------------------------------------------------------------
  // dnc_scrub_no -- skip DNC scrub, go to file generation
  // -------------------------------------------------------------------------
  app.action('dnc_scrub_no', async ({ ack, body, client }) => {
    await ack();

    const action = body as {
      type: string;
      channel?: { id: string };
      message?: { ts: string; thread_ts?: string };
      actions?: Array<{ action_id: string; value: string }>;
    };

    const channelId = action.channel?.id;
    const messageTs = action.message?.ts;
    const jobId = action.actions?.[0]?.value;

    if (!channelId || !jobId) {
      logger.warn('dnc_scrub_no: missing context', { channelId, jobId });
      return;
    }

    logger.info('DNC scrub declined', { jobId });

    // Update the button message
    if (messageTs) {
      try {
        await client.chat.update({
          channel: channelId,
          ts: messageTs,
          text: 'DNC scrub skipped. Generating results file...',
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: 'DNC scrub skipped. Generating results file...',
              },
            },
          ],
        });
      } catch (err) {
        logger.warn('dnc_scrub_no: failed to update message', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Set all contacts with phones to NOT_CHECKED
    await prisma.jobContact.updateMany({
      where: { jobId, directPhone: { not: null } },
      data: { dncStatus: 'NOT_CHECKED' },
    });

    // Enqueue file generation
    const dbJob = await prisma.job.findUniqueOrThrow({
      where: { id: jobId },
      select: { slackChannelId: true, slackThreadTs: true, sourceFileType: true },
    });

    await prisma.job.update({
      where: { id: jobId },
      data: { status: 'COMPLETED', completedAt: new Date() },
    });

    const fileJobData: FileGenerationData = {
      jobId,
      outputFormat: dbJob.sourceFileType === 'XLSX' ? 'XLSX' : 'CSV',
      channelId: dbJob.slackChannelId,
      threadTs: dbJob.slackThreadTs,
    };

    await fileGenerationQueue.add('generate-result-file', fileJobData);
    await publishProgress({ jobId, stage: 'generate', status: 'complete' });

    logger.info('File generation enqueued after DNC skip', { jobId });
  });
}
