/**
 * End-of-day report service for BDRs.
 *
 * Auto-generates EOD reports from DailyBdrActivity data
 * and sends a summary Slack DM to each active BDR.
 */

import { CampaignStatus } from '@prisma/client';
import { prisma } from '../../models/index.js';
import type { WebClient } from '@slack/web-api';
import logger from '../../lib/logger.js';


/**
 * Generates and sends EOD reports to all active BDRs.
 *
 * @param slackClient - Slack Web API client for sending DMs
 */
export async function sendEodReports(slackClient: WebClient): Promise<void> {
  // Find all BDRs with active campaigns
  const activeBdrs = await prisma.campaignBdr.findMany({
    where: {
      campaign: { status: CampaignStatus.ACTIVE },
    },
    select: {
      slackUserId: true,
      slackTeamId: true,
      displayName: true,
    },
    distinct: ['slackUserId'],
  });

  logger.info('Generating EOD reports', { bdrCount: activeBdrs.length });

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  for (const bdr of activeBdrs) {
    try {
      await generateAndSendEodReport(slackClient, bdr.slackUserId, bdr.slackTeamId, bdr.displayName, today);
    } catch (err) {
      const error = err as Error;
      logger.error('Failed to generate EOD report for BDR', {
        slackUserId: bdr.slackUserId,
        error: error.message,
      });
    }
  }
}

/**
 * Generates and sends an EOD report for a single BDR.
 */
async function generateAndSendEodReport(
  slackClient: WebClient,
  slackUserId: string,
  slackTeamId: string,
  displayName: string,
  date: Date,
): Promise<void> {
  // Aggregate today's activity across all campaigns
  const activities = await prisma.dailyBdrActivity.findMany({
    where: {
      slackUserId,
      date,
    },
    include: {
      campaign: {
        select: { id: true, name: true },
      },
    },
  });

  // Compute totals
  const totals = {
    emailsSent: 0,
    linkedinActionsSent: 0,
    callsCompleted: 0,
    emailRepliesReceived: 0,
    linkedinRepliesReceived: 0,
  };

  const campaignBreakdowns: string[] = [];

  for (const activity of activities) {
    totals.emailsSent += activity.emailsSent;
    totals.linkedinActionsSent += activity.linkedinActionsSent;
    totals.callsCompleted += activity.callsCompleted;
    totals.emailRepliesReceived += activity.emailRepliesReceived;
    totals.linkedinRepliesReceived += activity.linkedinRepliesReceived;

    campaignBreakdowns.push(
      `*${activity.campaign.name}*\n` +
      `  Emails sent: ${activity.emailsSent}\n` +
      `  LinkedIn actions: ${activity.linkedinActionsSent}\n` +
      `  Calls completed: ${activity.callsCompleted}\n` +
      `  Email replies: ${activity.emailRepliesReceived}\n` +
      `  LinkedIn replies: ${activity.linkedinRepliesReceived}`,
    );
  }

  const totalActions =
    totals.emailsSent + totals.linkedinActionsSent + totals.callsCompleted;
  const totalReplies =
    totals.emailRepliesReceived + totals.linkedinRepliesReceived;

  // Store the report
  await prisma.eodReport.create({
    data: {
      slackUserId,
      slackTeamId,
      date,
      stats: JSON.parse(JSON.stringify(totals)),
    },
  });

  // Build message
  const message =
    `End-of-day report for ${displayName}\n\n` +
    `*Today's Totals*\n` +
    `  Total actions: ${totalActions}\n` +
    `  Emails sent: ${totals.emailsSent}\n` +
    `  LinkedIn actions: ${totals.linkedinActionsSent}\n` +
    `  Calls completed: ${totals.callsCompleted}\n` +
    `  Total replies received: ${totalReplies}\n\n` +
    (campaignBreakdowns.length > 0
      ? `*By Campaign*\n${campaignBreakdowns.join('\n\n')}`
      : `_No campaign activity recorded today._`);

  // Send DM
  await slackClient.chat.postMessage({
    channel: slackUserId,
    text: message,
    mrkdwn: true,
  });

  logger.info('EOD report sent to BDR', {
    slackUserId,
    totalActions,
    totalReplies,
    campaigns: activities.length,
  });
}
