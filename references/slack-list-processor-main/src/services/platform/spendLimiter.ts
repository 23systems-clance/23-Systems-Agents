/**
 * Spend Limiter Service (Feature 39 - Vertical Pack Platform)
 *
 * Enforces per-workspace daily spend limits for skill executions.
 * Reads dailySpendLimitUsd/dailySpendUsedUsd from WorkspaceInstallation
 * and returns allow/block decision (FR-025).
 */

import { prisma } from '../../models/index.js';
import logger from '../../lib/logger.js';
import { Prisma } from '@prisma/client';

const log = logger.withContext({ service: 'spendLimiter' });

export interface SpendCheckResult {
  allowed: boolean;
  currentSpendUsd: number;
  limitUsd: number | null;
  remainingUsd: number | null;
  reason?: string;
}

/**
 * Check if a workspace can spend the given amount within its daily limit.
 * Returns allow if no limit is set (unlimited).
 */
export async function checkDailySpendLimit(
  slackTeamId: string,
  estimatedCostUsd: number,
): Promise<SpendCheckResult> {
  const workspace = await prisma.workspaceInstallation.findUnique({
    where: { slackTeamId },
    select: {
      dailySpendLimitUsd: true,
      dailySpendUsedUsd: true,
      dailySpendResetAt: true,
    },
  });

  if (!workspace) {
    return {
      allowed: false,
      currentSpendUsd: 0,
      limitUsd: null,
      remainingUsd: null,
      reason: 'Workspace not found',
    };
  }

  // No limit set → unlimited
  if (!workspace.dailySpendLimitUsd) {
    return {
      allowed: true,
      currentSpendUsd: Number(workspace.dailySpendUsedUsd),
      limitUsd: null,
      remainingUsd: null,
    };
  }

  const limit = Number(workspace.dailySpendLimitUsd);
  const used = Number(workspace.dailySpendUsedUsd);
  const remaining = limit - used;

  if (used + estimatedCostUsd > limit) {
    log.warn('Daily spend limit would be exceeded', {
      slackTeamId,
      limit,
      used,
      estimatedCostUsd,
    });

    return {
      allowed: false,
      currentSpendUsd: used,
      limitUsd: limit,
      remainingUsd: Math.max(0, remaining),
      reason: `Daily spend limit of $${limit.toFixed(2)} would be exceeded. Current spend: $${used.toFixed(2)}.`,
    };
  }

  return {
    allowed: true,
    currentSpendUsd: used,
    limitUsd: limit,
    remainingUsd: remaining - estimatedCostUsd,
  };
}

/**
 * Increment the workspace's daily spend tracker after a skill execution completes.
 * Uses an atomic update to prevent race conditions.
 */
export async function incrementDailySpend(
  slackTeamId: string,
  costUsd: number,
): Promise<void> {
  await prisma.workspaceInstallation.update({
    where: { slackTeamId },
    data: {
      dailySpendUsedUsd: {
        increment: new Prisma.Decimal(costUsd),
      },
    },
  });

  log.debug('Daily spend incremented', { slackTeamId, costUsd });
}

/**
 * Reset daily spend counters for all workspaces.
 * Called by the daily spend reset cron job at midnight UTC.
 */
export async function resetAllDailySpend(): Promise<number> {
  const result = await prisma.workspaceInstallation.updateMany({
    where: {
      dailySpendUsedUsd: { gt: 0 },
    },
    data: {
      dailySpendUsedUsd: 0,
      dailySpendResetAt: new Date(),
    },
  });

  log.info('Daily spend reset completed', { workspacesReset: result.count });
  return result.count;
}
