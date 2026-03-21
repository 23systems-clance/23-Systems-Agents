/**
 * Campaign stats aggregation service.
 *
 * Provides campaign-level stats, step funnel data,
 * and BDR activity summaries for the admin dashboard.
 */

import { StepExecutionStatus, ContactCampaignStatus } from '@prisma/client';
import { prisma } from '../../models/index.js';

/** Step funnel data for a campaign. */
export interface StepFunnelItem {
  stepIndex: number;
  stepType: string;
  total: number;
  completed: number;
  skipped: number;
  failed: number;
  waiting: number;
  pending: number;
}

/** Campaign stats overview. */
export interface CampaignStats {
  totalContacts: number;
  activeContacts: number;
  completedContacts: number;
  respondedContacts: number;
  skippedContacts: number;
  responseRate: number;
  completionRate: number;
}

/** BDR activity summary for manager view. */
export interface BdrActivitySummary {
  slackUserId: string;
  displayName: string;
  totalEmailsSent: number;
  totalLinkedinActions: number;
  totalCallsCompleted: number;
  totalEmailReplies: number;
  totalLinkedinReplies: number;
  totalActions: number;
  activeCampaigns: number;
}

/** Contact quality stats for a campaign. */
export interface ContactQualityStats {
  totalContacts: number;
  emailVerified: number;
  phoneCallable: number;
  linkedinAvailable: number;
  multiChannel: number;
}

/**
 * Gets contact quality breakdown for a campaign.
 * Counts contacts by channel reachability (email, phone, LinkedIn, multi-channel).
 */
export async function getContactQualityStats(campaignId: string): Promise<ContactQualityStats> {
  const [totalContacts, emailVerified, phoneCallable, linkedinAvailable, multiChannel] =
    await Promise.all([
      prisma.campaignContact.count({ where: { campaignId } }),
      prisma.campaignContact.count({ where: { campaignId, canEmail: true } }),
      prisma.campaignContact.count({ where: { campaignId, canCall: true } }),
      prisma.campaignContact.count({ where: { campaignId, canLinkedin: true } }),
      prisma.campaignContact.count({
        where: { campaignId, canEmail: true, canCall: true, canLinkedin: true },
      }),
    ]);

  return { totalContacts, emailVerified, phoneCallable, linkedinAvailable, multiChannel };
}

/**
 * Gets aggregate stats for a campaign.
 */
export async function getCampaignStats(campaignId: string): Promise<CampaignStats> {
  const [total, active, completed, responded, skipped] = await Promise.all([
    prisma.campaignContact.count({ where: { campaignId } }),
    prisma.campaignContact.count({
      where: { campaignId, status: ContactCampaignStatus.ACTIVE },
    }),
    prisma.campaignContact.count({
      where: { campaignId, status: ContactCampaignStatus.COMPLETED },
    }),
    prisma.campaignContact.count({
      where: { campaignId, status: ContactCampaignStatus.RESPONDED },
    }),
    prisma.campaignContact.count({
      where: { campaignId, status: ContactCampaignStatus.SKIPPED },
    }),
  ]);

  return {
    totalContacts: total,
    activeContacts: active,
    completedContacts: completed,
    respondedContacts: responded,
    skippedContacts: skipped,
    responseRate: total > 0 ? responded / total : 0,
    completionRate: total > 0 ? (completed + responded) / total : 0,
  };
}

/**
 * Gets step funnel data for a campaign.
 * Shows how many contacts are at each step and their status breakdown.
 */
export async function getStepFunnel(campaignId: string): Promise<StepFunnelItem[]> {
  const steps = await prisma.campaignSequenceStep.findMany({
    where: { campaignId },
    orderBy: { stepOrder: 'asc' },
  });

  const funnel: StepFunnelItem[] = [];

  for (const step of steps) {
    const [total, completed, skipped, failed, waiting, pending] = await Promise.all([
      prisma.campaignContactStepExecution.count({
        where: { stepIndex: step.stepOrder, campaignContact: { campaignId } },
      }),
      prisma.campaignContactStepExecution.count({
        where: {
          stepIndex: step.stepOrder,
          campaignContact: { campaignId },
          status: StepExecutionStatus.COMPLETED,
        },
      }),
      prisma.campaignContactStepExecution.count({
        where: {
          stepIndex: step.stepOrder,
          campaignContact: { campaignId },
          status: StepExecutionStatus.SKIPPED,
        },
      }),
      prisma.campaignContactStepExecution.count({
        where: {
          stepIndex: step.stepOrder,
          campaignContact: { campaignId },
          status: StepExecutionStatus.FAILED,
        },
      }),
      prisma.campaignContactStepExecution.count({
        where: {
          stepIndex: step.stepOrder,
          campaignContact: { campaignId },
          status: StepExecutionStatus.WAITING_WEBHOOK,
        },
      }),
      prisma.campaignContactStepExecution.count({
        where: {
          stepIndex: step.stepOrder,
          campaignContact: { campaignId },
          status: StepExecutionStatus.PENDING,
        },
      }),
    ]);

    funnel.push({
      stepIndex: step.stepOrder,
      stepType: step.stepType,
      total,
      completed,
      skipped,
      failed,
      waiting,
      pending,
    });
  }

  return funnel;
}

/**
 * Gets BDR activity summary across all campaigns (manager view).
 *
 * @param slackTeamId - Filter by Slack team
 * @param days - Number of days to aggregate (default 7)
 */
export async function getBdrActivitySummary(
  slackTeamId: string,
  days = 7,
): Promise<BdrActivitySummary[]> {
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - days);
  since.setUTCHours(0, 0, 0, 0);

  // Get all BDRs in this team
  const bdrs = await prisma.campaignBdr.findMany({
    where: { slackTeamId },
    select: { slackUserId: true, displayName: true, campaignId: true },
  });

  // Group by BDR
  const bdrMap = new Map<string, { displayName: string; campaignIds: Set<string> }>();
  for (const bdr of bdrs) {
    const existing = bdrMap.get(bdr.slackUserId);
    if (existing) {
      existing.campaignIds.add(bdr.campaignId);
    } else {
      bdrMap.set(bdr.slackUserId, {
        displayName: bdr.displayName,
        campaignIds: new Set([bdr.campaignId]),
      });
    }
  }

  const summaries: BdrActivitySummary[] = [];

  for (const [slackUserId, info] of bdrMap) {
    const activities = await prisma.dailyBdrActivity.findMany({
      where: {
        slackUserId,
        date: { gte: since },
      },
    });

    const totals = activities.reduce(
      (acc, a) => ({
        emailsSent: acc.emailsSent + a.emailsSent,
        linkedinActions: acc.linkedinActions + a.linkedinActionsSent,
        callsCompleted: acc.callsCompleted + a.callsCompleted,
        emailReplies: acc.emailReplies + a.emailRepliesReceived,
        linkedinReplies: acc.linkedinReplies + a.linkedinRepliesReceived,
      }),
      { emailsSent: 0, linkedinActions: 0, callsCompleted: 0, emailReplies: 0, linkedinReplies: 0 },
    );

    summaries.push({
      slackUserId,
      displayName: info.displayName,
      totalEmailsSent: totals.emailsSent,
      totalLinkedinActions: totals.linkedinActions,
      totalCallsCompleted: totals.callsCompleted,
      totalEmailReplies: totals.emailReplies,
      totalLinkedinReplies: totals.linkedinReplies,
      totalActions: totals.emailsSent + totals.linkedinActions + totals.callsCompleted,
      activeCampaigns: info.campaignIds.size,
    });
  }

  // Sort by total actions descending
  return summaries.sort((a, b) => b.totalActions - a.totalActions);
}
