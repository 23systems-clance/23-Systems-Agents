/**
 * Client overview route (T052).
 *
 * Returns workspace credit balance, usage stats, and feature summary.
 */

import { Router } from 'express';
import { prisma } from '../../models/index.js';
import { getCreditBalance } from '../../services/billing/creditManager.js';
import { resolveFeatureFlags } from '../../services/featureToggle/featureFlags.js';
import type { ClientSession } from '../../lib/clientAuth.js';
import logger from '../../lib/logger.js';

export const clientOverviewRouter = Router();

clientOverviewRouter.get('/', async (req, res) => {
  try {
    const session = (req as unknown as Record<string, unknown>).clientSession as ClientSession;
    const { slackTeamId } = session;

    const [workspace, creditBalance, billingProfile, monthlyStats] = await Promise.all([
      prisma.workspaceInstallation.findUnique({
        where: { slackTeamId },
        select: { slackTeamName: true, featureFlags: true },
      }),
      getCreditBalance(slackTeamId),
      prisma.billingProfile.findUnique({
        where: { slackTeamId },
        select: { monthlyAllowance: true, subscriptionTier: true },
      }),
      getMonthlyStats(slackTeamId),
    ]);

    const flags = resolveFeatureFlags(slackTeamId, workspace?.featureFlags as Record<string, boolean> | null);
    const enabledFeatures = Object.entries(flags)
      .filter(([, v]) => v)
      .map(([k]) => k);

    res.json({
      workspaceName: workspace?.slackTeamName ?? slackTeamId,
      creditBalance,
      monthlyAllowance: billingProfile?.monthlyAllowance ?? 0,
      creditsUsedThisMonth: monthlyStats.creditsUsed,
      subscriptionTier: billingProfile?.subscriptionTier ?? 'starter',
      enrichmentJobsThisMonth: monthlyStats.jobCount,
      totalRowsEnrichedThisMonth: monthlyStats.totalRows,
      enabledFeatures,
    });
  } catch (error) {
    logger.error('Failed to get client overview', {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ error: 'Failed to get overview' });
  }
});

/** Gets monthly enrichment stats for a workspace. */
async function getMonthlyStats(slackTeamId: string) {
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const [jobs, creditTransactions] = await Promise.all([
    prisma.job.findMany({
      where: {
        slackTeamId,
        createdAt: { gte: startOfMonth },
        status: { in: ['COMPLETED', 'PROCESSING'] },
      },
      select: { sourceRowCount: true },
    }),
    prisma.creditTransaction.aggregate({
      where: {
        billingProfile: { slackTeamId },
        createdAt: { gte: startOfMonth },
        type: 'ENRICHMENT_DEDUCTION',
      },
      _sum: { amount: true },
    }),
  ]);

  return {
    jobCount: jobs.length,
    totalRows: jobs.reduce((sum, j) => sum + (j.sourceRowCount ?? 0), 0),
    creditsUsed: Math.abs(creditTransactions._sum?.amount ?? 0),
  };
}
