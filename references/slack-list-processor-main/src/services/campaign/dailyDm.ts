/**
 * Daily DM briefing service for BDRs.
 *
 * Sends a morning Slack DM to each active BDR with:
 * - Summary of pending tasks across all their campaigns
 * - Phone call counts, emails firing, LinkedIn actions, unread replies
 * - Deep link to the web task UI
 */

import { ContactCampaignStatus, StepExecutionStatus, StepType, CampaignStatus } from '@prisma/client';
import { prisma } from '../../models/index.js';
import type { WebClient } from '@slack/web-api';
import { config } from '../../config/index.js';
import { generateBdrToken } from '../../lib/bdrAuth.js';
import logger from '../../lib/logger.js';


/**
 * Sends daily briefing DMs to all BDRs with active campaigns.
 *
 * @param slackClient - Slack Web API client for sending DMs
 */
export async function sendDailyBriefings(slackClient: WebClient): Promise<void> {
  // Find all BDRs with at least one ACTIVE campaign
  const activeBdrs = await prisma.campaignBdr.findMany({
    where: {
      campaign: {
        status: CampaignStatus.ACTIVE,
      },
    },
    select: {
      slackUserId: true,
      slackTeamId: true,
      displayName: true,
    },
    distinct: ['slackUserId'],
  });

  logger.info('Sending daily briefings', { bdrCount: activeBdrs.length });

  for (const bdr of activeBdrs) {
    try {
      await sendBriefingToBdr(slackClient, bdr.slackUserId, bdr.slackTeamId, bdr.displayName);
    } catch (err) {
      const error = err as Error;
      logger.error('Failed to send daily briefing to BDR', {
        slackUserId: bdr.slackUserId,
        error: error.message,
      });
    }
  }
}

/**
 * Sends a daily briefing DM to a single BDR.
 */
export async function sendBriefingToBdr(
  slackClient: WebClient,
  slackUserId: string,
  slackTeamId: string,
  displayName: string,
): Promise<void> {
  // Get all active campaigns this BDR is assigned to
  const assignments = await prisma.campaignBdr.findMany({
    where: {
      slackUserId,
      campaign: { status: CampaignStatus.ACTIVE },
    },
    include: {
      campaign: {
        select: {
          id: true,
          name: true,
          totalContacts: true,
          activeContacts: true,
          completedContacts: true,
        },
      },
    },
  });

  if (assignments.length === 0) return;

  // Aggregate stats across campaigns
  let totalPendingCalls = 0;
  let totalWaitingWebhook = 0;
  let totalUnreadReplies = 0;
  const campaignSummaries: string[] = [];

  for (const assignment of assignments) {
    const campaign = assignment.campaign;

    // Count pending phone calls (step executions at PENDING with PHONE type)
    const pendingCalls = await prisma.campaignContactStepExecution.count({
      where: {
        status: StepExecutionStatus.PENDING,
        stepType: StepType.PHONE,
        campaignContact: {
          campaignId: campaign.id,
          status: ContactCampaignStatus.ACTIVE,
        },
      },
    });

    // Count steps waiting for webhooks
    const waitingWebhook = await prisma.campaignContactStepExecution.count({
      where: {
        status: StepExecutionStatus.WAITING_WEBHOOK,
        campaignContact: {
          campaignId: campaign.id,
          status: ContactCampaignStatus.ACTIVE,
        },
      },
    });

    // Count unread UniBox replies
    const unreadReplies = await prisma.uniboxReply.count({
      where: {
        campaignId: campaign.id,
        isRead: false,
      },
    });

    totalPendingCalls += pendingCalls;
    totalWaitingWebhook += waitingWebhook;
    totalUnreadReplies += unreadReplies;

    campaignSummaries.push(
      `*${campaign.name}*\n` +
      `  Contacts: ${campaign.activeContacts} active / ${campaign.totalContacts} total\n` +
      `  Calls pending: ${pendingCalls}\n` +
      `  Emails/LinkedIn in progress: ${waitingWebhook}\n` +
      `  Unread replies: ${unreadReplies}`,
    );
  }

  // Build the message with magic link token for auto-login
  const token = generateBdrToken(slackUserId, slackTeamId);
  const taskUrl = `${config.dashboardUrl}/bdr/tasks?token=${token}`;
  const greeting = getGreeting();

  const message =
    `${greeting}, ${displayName}! Here's your daily campaign briefing:\n\n` +
    `*Summary*\n` +
    `  Phone calls to make: ${totalPendingCalls}\n` +
    `  Sequences in progress: ${totalWaitingWebhook}\n` +
    `  Unread replies: ${totalUnreadReplies}\n\n` +
    `*Campaigns (${assignments.length})*\n` +
    campaignSummaries.join('\n\n') +
    `\n\n<${taskUrl}|Open Task Dashboard>`;

  // Send DM
  await slackClient.chat.postMessage({
    channel: slackUserId,
    text: message,
    mrkdwn: true,
  });

  logger.info('Daily briefing sent to BDR', {
    slackUserId,
    campaigns: assignments.length,
    pendingCalls: totalPendingCalls,
    unreadReplies: totalUnreadReplies,
  });
}

/**
 * Returns a time-appropriate greeting.
 */
function getGreeting(): string {
  const hour = new Date().getUTCHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}
