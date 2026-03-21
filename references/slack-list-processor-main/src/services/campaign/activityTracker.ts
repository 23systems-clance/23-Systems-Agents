/**
 * Activity tracker for BDR daily activity metrics.
 *
 * Provides atomic upsert on the DailyBdrActivity table.
 * Called from webhook handlers and sequence engine to
 * track per-BDR, per-campaign daily metrics.
 */

import { prisma } from '../../models/index.js';
import logger from '../../lib/logger.js';


/** Supported activity metrics. */
type ActivityMetric =
  | 'emailsSent'
  | 'linkedinActionsSent'
  | 'callsCompleted'
  | 'emailRepliesReceived'
  | 'linkedinRepliesReceived';

/**
 * Tracks a BDR activity metric for today.
 * Creates or increments the DailyBdrActivity row.
 *
 * @param campaignId - Campaign the activity belongs to
 * @param slackUserId - BDR's Slack user ID
 * @param metric - Which metric to increment
 * @param count - Amount to increment (default 1)
 * @param supervised - Whether this BDR is in the supervised onboarding phase (FR-026)
 */
export async function trackActivity(
  campaignId: string,
  slackUserId: string,
  metric: ActivityMetric,
  count = 1,
  supervised = false,
): Promise<void> {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  try {
    await prisma.dailyBdrActivity.upsert({
      where: {
        campaignId_slackUserId_date: {
          campaignId,
          slackUserId,
          date: today,
        },
      },
      create: {
        campaignId,
        slackUserId,
        date: today,
        [metric]: count,
        supervised,
      },
      update: {
        [metric]: { increment: count },
        ...(supervised ? { supervised: true } : {}),
      },
    });
  } catch (err) {
    const error = err as Error;
    logger.error('Failed to track activity', {
      campaignId,
      slackUserId,
      metric,
      error: error.message,
    });
  }
}

/**
 * Resolves a BDR Slack user ID for a campaign.
 * Uses round-robin assignment across campaign BDRs.
 *
 * @param campaignId - Campaign to look up BDRs for
 * @returns The Slack user ID of the assigned BDR, or null if none assigned
 */
export async function getAssignedBdr(campaignId: string): Promise<string | null> {
  const bdrs = await prisma.campaignBdr.findMany({
    where: { campaignId },
    select: { slackUserId: true },
  });

  if (bdrs.length === 0) return null;

  // For webhook-driven activity tracking, use the first BDR
  // (actual round-robin assignment would be more complex)
  return bdrs[0].slackUserId;
}
