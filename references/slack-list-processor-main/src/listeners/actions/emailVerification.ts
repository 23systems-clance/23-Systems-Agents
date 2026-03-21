/**
 * Bolt action handlers for email verification decision buttons (US6).
 *
 * After email enrichment completes (when FINDYMAIL_API_KEY is configured),
 * the bot posts "Verify Emails" / "Do Not Verify" buttons.
 * This handler processes both button clicks.
 *
 * Pattern: same as dncScrub.ts
 */

import type { App } from '@slack/bolt';
import type { KnownBlock } from '@slack/types';
import { prisma } from '../../models/index.js';
import { emailVerificationQueue } from '../../services/queue/queues.js';
import { runPostEmailPipeline } from '../../services/queue/workers/postEnrichmentPipeline.js';
import logger from '../../lib/logger.js';

/**
 * Builds Block Kit blocks for the email verification decision prompt.
 *
 * @param jobId - The enrichment job ID (passed via button value).
 * @param emailCount - Number of emails that would be verified.
 * @returns Block Kit blocks array.
 */
export function buildEmailVerificationDecisionBlocks(
  jobId: string,
  emailCount: number,
): KnownBlock[] {
  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `Email enrichment complete! *${emailCount}* email${emailCount !== 1 ? 's' : ''} found.\n\nWould you like to verify these emails via Findymail?`,
      },
    },
    {
      type: 'actions',
      block_id: 'email_verify_decision',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Verify Emails' },
          action_id: 'email_verify_yes',
          value: jobId,
          style: 'primary',
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Do Not Verify' },
          action_id: 'email_verify_no',
          value: jobId,
        },
      ],
    },
  ];
}

/**
 * Registers Bolt action handlers for `email_verify_yes` and `email_verify_no`.
 *
 * @param app - The Slack Bolt application instance.
 */
export function registerEmailVerificationHandlers(app: App): void {
  // -------------------------------------------------------------------------
  // email_verify_yes -- enqueue Findymail verification job
  // -------------------------------------------------------------------------
  app.action('email_verify_yes', async ({ ack, body, client }) => {
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
      logger.warn('email_verify_yes: missing context', { channelId, threadTs, jobId });
      return;
    }

    logger.info('Email verification accepted', { jobId, channelId, threadTs });

    // Update the button message
    if (messageTs) {
      try {
        await client.chat.update({
          channel: channelId,
          ts: messageTs,
          text: 'Verifying emails via Findymail...',
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: 'Verifying emails via Findymail...',
              },
            },
          ],
        });
      } catch (err) {
        logger.warn('email_verify_yes: failed to update message', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Record the choice
    await prisma.job.update({
      where: { id: jobId },
      data: { emailVerificationChoice: 'VERIFY' },
    });

    // Enqueue email verification job
    await emailVerificationQueue.add('email-verify', {
      jobId,
      channelId,
      threadTs,
    });

    logger.info('Email verification job enqueued', { jobId });
  });

  // -------------------------------------------------------------------------
  // email_verify_no -- skip verification, go to file generation
  // -------------------------------------------------------------------------
  app.action('email_verify_no', async ({ ack, body, client }) => {
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
      logger.warn('email_verify_no: missing context', { channelId, jobId });
      return;
    }

    logger.info('Email verification declined', { jobId });

    // Update the button message
    if (messageTs) {
      try {
        await client.chat.update({
          channel: channelId,
          ts: messageTs,
          text: 'Email verification skipped. Generating results file...',
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: 'Email verification skipped. Generating results file...',
              },
            },
          ],
        });
      } catch (err) {
        logger.warn('email_verify_no: failed to update message', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Record the choice
    await prisma.job.update({
      where: { id: jobId },
      data: { emailVerificationChoice: 'SKIP' },
    });

    const threadTs = action.message?.thread_ts ?? action.message?.ts;

    // Run post-email pipeline: phone cascade -> DNC gate -> file generation
    await runPostEmailPipeline(jobId, channelId, threadTs ?? channelId);

    logger.info('Post-email pipeline started after email verification skip', { jobId });
  });
}
