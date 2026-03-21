/**
 * BullMQ worker for smart reply draft generation.
 *
 * Processes jobs from the `smart-reply` queue. Each job loads the
 * UniboxReply, CampaignContact, and Campaign context, calls the
 * smartReplyGenerator for combined intent classification + draft
 * generation, and updates the reply record with the result.
 *
 * Concurrency: 3 (allows parallel draft generation without
 * overwhelming the Claude API).
 */

import { Worker, Job } from 'bullmq';
import { WebClient } from '@slack/web-api';
import { SmartReplyDraftStatus } from '@prisma/client';
import { config } from '../../../config/index.js';
import { prisma } from '../../../models/index.js';
import {
  generateSmartReply,
  type CampaignContext,
  type ContactContext,
  type PersonalityContext,
  type DraftTone,
} from '../../ai/smartReplyGenerator.js';
import type { SmartReplyJobData } from '../queues.js';
import logger from '../../../lib/logger.js';

/** Lazily initialised Slack client for draft-ready notifications. */
let _slackClient: WebClient | null = null;
function getSlackClient(): WebClient {
  if (!_slackClient) {
    _slackClient = new WebClient(config.slack.botToken);
  }
  return _slackClient;
}

/**
 * Processes a single smart reply generation job.
 *
 * Flow:
 * 1. Load UniboxReply + CampaignContact + Campaign
 * 2. Build context objects from DB records
 * 3. Call generateSmartReply (Claude Haiku 4.5)
 * 4. Update UniboxReply with result (READY or FAILED)
 */
async function processSmartReplyJob(job: Job<SmartReplyJobData>): Promise<void> {
  const { replyId, tone } = job.data;
  const jobLogger = logger.withContext({ smartReplyJobId: job.id, replyId });

  jobLogger.info('Smart reply generation started', { tone: tone ?? 'default' });

  // 1. Load reply with contact and campaign
  const reply = await prisma.uniboxReply.findUnique({
    where: { id: replyId },
    include: {
      campaignContact: {
        include: {
          campaign: {
            select: {
              id: true,
              name: true,
              icpDefinition: true,
              meetingLink: true,
            },
          },
        },
      },
      campaign: {
        select: {
          id: true,
          name: true,
          icpDefinition: true,
          meetingLink: true,
        },
      },
    },
  });

  if (!reply) {
    jobLogger.warn('UniboxReply not found, skipping');
    return;
  }

  const contact = reply.campaignContact;
  const campaign = reply.campaign;

  // 2. Build context
  const campaignCtx: CampaignContext = {
    campaignName: campaign.name,
    icpDefinition: campaign.icpDefinition ?? undefined,
    meetingLink: campaign.meetingLink ?? undefined,
  };

  const contactCtx: ContactContext = contact
    ? {
        firstName: contact.firstName,
        lastName: contact.lastName,
        companyName: contact.companyName ?? undefined,
        jobTitle: contact.jobTitle ?? undefined,
      }
    : {
        firstName: reply.fromName ?? 'Unknown',
        lastName: '',
        companyName: undefined,
        jobTitle: undefined,
      };

  // 3. Extract personality data if available
  let personalityCtx: PersonalityContext | null = null;
  if (contact?.personalityData) {
    const pd = contact.personalityData as Record<string, unknown>;
    const comm = pd.communication as Record<string, unknown> | undefined;
    const emailApproach = pd.email_approach as Record<string, unknown> | undefined;
    const archetype = pd.archetype as Record<string, unknown> | undefined;

    personalityCtx = {
      archetype: archetype?.name as string | undefined,
      communicationAdjectives: comm?.adjectives as string[] | undefined,
      whatToSay: comm?.what_to_say as string[] | undefined,
      whatToAvoid: comm?.what_to_avoid as string[] | undefined,
      emailTone: emailApproach?.tone as string | undefined,
      emailLength: emailApproach?.length as string | undefined,
    };
  }

  try {
    // 4. Call AI
    const result = await generateSmartReply(
      reply.body,
      campaignCtx,
      contactCtx,
      personalityCtx,
      tone as DraftTone | undefined,
    );

    // 5. Update reply with result
    await prisma.uniboxReply.update({
      where: { id: replyId },
      data: {
        draftIntent: result.intent,
        draftBody: result.shouldReply ? result.draftBody : null,
        draftStatus: result.shouldReply
          ? SmartReplyDraftStatus.READY
          : SmartReplyDraftStatus.READY, // Still READY so BDR sees intent label
        draftGeneratedAt: new Date(),
        draftTokensUsed: result.usage.inputTokens + result.usage.outputTokens,
        draftCostUsd: result.usage.estimatedCostUsd,
        draftError: null,
      },
    });

    jobLogger.info('Smart reply generation completed', {
      intent: result.intent,
      shouldReply: result.shouldReply,
      confidence: result.confidence,
      tokensUsed: result.usage.inputTokens + result.usage.outputTokens,
      costUsd: result.usage.estimatedCostUsd,
      durationMs: result.usage.durationMs,
    });

    // Send follow-up Slack notification with intent classification (FR-023)
    try {
      await notifyBdrsDraftReady(replyId, result.intent, contactCtx, campaign.name);
    } catch (notifyErr) {
      jobLogger.warn('Failed to send draft-ready notification', {
        error: notifyErr instanceof Error ? notifyErr.message : String(notifyErr),
      });
    }
  } catch (err) {
    const errorMessage =
      err instanceof Error ? err.message : 'Unknown error during draft generation';

    jobLogger.error('Smart reply generation failed', { error: errorMessage });

    // Mark as FAILED so BDR can retry
    await prisma.uniboxReply.update({
      where: { id: replyId },
      data: {
        draftStatus: SmartReplyDraftStatus.FAILED,
        draftError: errorMessage,
        draftGeneratedAt: new Date(),
      },
    });

    throw err; // Re-throw so BullMQ can handle retries
  }
}

/**
 * Sends a follow-up Slack DM to assigned BDRs after draft generation
 * completes, including the classified intent.
 */
async function notifyBdrsDraftReady(
  replyId: string,
  intent: string,
  contactCtx: ContactContext,
  campaignName: string,
): Promise<void> {
  // Look up reply to get the campaignId
  const reply = await prisma.uniboxReply.findUnique({
    where: { id: replyId },
    select: { campaignId: true },
  });
  if (!reply) return;

  const bdrs = await prisma.campaignBdr.findMany({
    where: { campaignId: reply.campaignId },
    select: { slackUserId: true },
  });
  if (bdrs.length === 0) return;

  const contactName = `${contactCtx.firstName} ${contactCtx.lastName}`.trim();
  const dashboardBaseUrl = config.adminDashboardUrl ?? '';
  const uniboxUrl = dashboardBaseUrl ? `${dashboardBaseUrl}/bdr/unibox` : '';

  const intentLabel = intent.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

  const blocks: any[] = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Draft ready for ${contactName}*\n*Campaign:* ${campaignName}\n*Intent:* ${intentLabel}`,
      },
    },
  ];

  if (uniboxUrl) {
    blocks.push({
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Review Draft in UniBox' },
          url: uniboxUrl,
          action_id: 'draft_ready_open_unibox',
        },
      ],
    });
  }

  const client = getSlackClient();
  const fallbackText = `Draft ready for ${contactName} (${campaignName}) — Intent: ${intentLabel}`;

  await Promise.allSettled(
    bdrs.map(async (bdr) => {
      try {
        await client.chat.postMessage({
          channel: bdr.slackUserId,
          blocks,
          text: fallbackText,
        });
      } catch (err) {
        logger.warn('Failed to DM BDR about draft ready', {
          bdrSlackUserId: bdr.slackUserId,
          replyId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }),
  );
}

/**
 * Creates and returns the smart reply BullMQ worker.
 * Register in app.ts via `workers.push(createSmartReplyWorker())`.
 */
export function createSmartReplyWorker(): Worker<SmartReplyJobData> {
  const worker = new Worker<SmartReplyJobData>(
    'smart-reply',
    async (job) => {
      await processSmartReplyJob(job);
    },
    {
      connection: { url: config.redis.url },
      concurrency: 3,
    },
  );

  worker.on('failed', (job, err) => {
    logger.error('Smart reply worker job failed', {
      jobId: job?.id,
      replyId: job?.data?.replyId,
      error: err.message,
    });
  });

  worker.on('completed', (job) => {
    logger.debug('Smart reply worker job completed', {
      jobId: job.id,
      replyId: job.data.replyId,
    });
  });

  return worker;
}
