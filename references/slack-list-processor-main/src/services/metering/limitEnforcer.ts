/**
 * Workspace usage limit enforcement (T047, T051).
 *
 * Checks workspace spending caps and API limits before allowing job execution.
 * Sends Slack DM notifications to workspace admins at 80% and 100% thresholds.
 */

import { Prisma } from '@prisma/client';
import { WebClient } from '@slack/web-api';
import { prisma } from '../../models/index.js';
import logger from '../../lib/logger.js';

/**
 * Result of a limit check operation.
 */
export interface LimitCheckResult {
  /** Whether the request is allowed to proceed. */
  allowed: boolean;
  /** Human-readable reason if blocked. */
  reason?: string;
  /** Percentage of monthly cap consumed (0-100+). */
  usagePercent: number;
}

/**
 * Threshold notification levels (T051).
 */
export type ThresholdLevel = 80 | 100;

/**
 * Checks if a workspace has exceeded its monthly spending or API limits.
 *
 * Queries WorkspaceInstallation for configured caps and DailyAggregate
 * for current month totals. Returns a result indicating whether the
 * request should proceed and the current usage percentage.
 *
 * @param teamId - Slack workspace team ID.
 * @returns Limit check result with allowed flag and usage percentage.
 *
 * @example
 * ```typescript
 * const result = await checkLimits('T1234567890');
 * if (!result.allowed) {
 *   throw new Error(result.reason);
 * }
 * ```
 */
export async function checkLimits(teamId: string): Promise<LimitCheckResult> {
  try {
    // Load workspace configuration.
    const workspace = await prisma.workspaceInstallation.findUnique({
      where: { slackTeamId: teamId },
      select: {
        monthlySpendCapUsd: true,
        maxBuiltwithLookups: true,
        maxApolloCredits: true,
        maxAiTokens: true,
        status: true,
      },
    });

    if (!workspace) {
      return {
        allowed: false,
        reason: 'Workspace not found',
        usagePercent: 0,
      };
    }

    if (workspace.status !== 'ACTIVE') {
      return {
        allowed: false,
        reason: `Workspace status: ${workspace.status}`,
        usagePercent: 0,
      };
    }

    // If no caps are configured, allow all requests.
    if (
      !workspace.monthlySpendCapUsd &&
      !workspace.maxBuiltwithLookups &&
      !workspace.maxApolloCredits &&
      !workspace.maxAiTokens
    ) {
      return { allowed: true, usagePercent: 0 };
    }

    // Get current month date range.
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59));

    // Query current month aggregates.
    const aggregates = await prisma.dailyAggregate.findMany({
      where: {
        slackTeamId: teamId,
        date: { gte: monthStart, lte: monthEnd },
      },
      select: {
        service: true,
        totalCostUsd: true,
        totalRequests: true,
        totalCreditsConsumed: true,
        totalTokensInput: true,
        totalTokensOutput: true,
      },
    });

    // Sum totals by service.
    let totalCost = new Prisma.Decimal(0);
    let builtwithRequests = 0;
    let apolloCredits = new Prisma.Decimal(0);
    let aiTokensTotal = 0;

    for (const agg of aggregates) {
      totalCost = totalCost.add(agg.totalCostUsd);

      if (agg.service === 'BUILTWITH') {
        builtwithRequests += agg.totalRequests;
      } else if (agg.service === 'APOLLO') {
        apolloCredits = apolloCredits.add(agg.totalCreditsConsumed);
      } else if (agg.service === 'AI_ORCHESTRATOR') {
        aiTokensTotal += agg.totalTokensInput + agg.totalTokensOutput;
      }
    }

    // Check each limit.
    const violations: string[] = [];
    let maxUsagePercent = 0;

    if (workspace.monthlySpendCapUsd) {
      const pct = totalCost.div(workspace.monthlySpendCapUsd).mul(100).toNumber();
      maxUsagePercent = Math.max(maxUsagePercent, pct);
      if (pct >= 100) {
        violations.push(
          `Monthly spend cap exceeded: $${totalCost.toFixed(2)} / $${workspace.monthlySpendCapUsd.toString()}`
        );
      }
    }

    if (workspace.maxBuiltwithLookups) {
      const pct = (builtwithRequests / workspace.maxBuiltwithLookups) * 100;
      maxUsagePercent = Math.max(maxUsagePercent, pct);
      if (pct >= 100) {
        violations.push(
          `BuiltWith lookup limit exceeded: ${builtwithRequests} / ${workspace.maxBuiltwithLookups}`
        );
      }
    }

    if (workspace.maxApolloCredits) {
      const pct = apolloCredits
        .div(new Prisma.Decimal(workspace.maxApolloCredits))
        .mul(100)
        .toNumber();
      maxUsagePercent = Math.max(maxUsagePercent, pct);
      if (pct >= 100) {
        violations.push(
          `Apollo credit limit exceeded: ${apolloCredits.toFixed(0)} / ${workspace.maxApolloCredits}`
        );
      }
    }

    if (workspace.maxAiTokens) {
      const pct = (aiTokensTotal / workspace.maxAiTokens) * 100;
      maxUsagePercent = Math.max(maxUsagePercent, pct);
      if (pct >= 100) {
        violations.push(`AI token limit exceeded: ${aiTokensTotal} / ${workspace.maxAiTokens}`);
      }
    }

    if (violations.length > 0) {
      return {
        allowed: false,
        reason: violations.join('; '),
        usagePercent: maxUsagePercent,
      };
    }

    return { allowed: true, usagePercent: maxUsagePercent };
  } catch (error) {
    logger.error('Limit check failed', {
      teamId,
      error: error instanceof Error ? error.message : String(error),
    });
    // On error, allow the request but log the issue.
    return { allowed: true, usagePercent: 0 };
  }
}

/**
 * Sends a threshold warning notification to all workspace admins (T051).
 *
 * Queries Slack's users.list API to find admins and sends each a DM
 * with the current usage percentage and spending details.
 *
 * @param teamId - Slack workspace team ID.
 * @param percent - Usage percentage that triggered the warning (80 or 100).
 * @param client - Slack WebClient instance (must be authenticated for this workspace).
 *
 * @example
 * ```typescript
 * const { usagePercent } = await checkLimits(teamId);
 * if (usagePercent >= 80 && usagePercent < 100) {
 *   await sendThresholdNotification(teamId, 80, slackClient);
 * }
 * ```
 */
export async function sendThresholdNotification(
  teamId: string,
  percent: ThresholdLevel,
  client: WebClient
): Promise<void> {
  try {
    // Fetch workspace details.
    const workspace = await prisma.workspaceInstallation.findUnique({
      where: { slackTeamId: teamId },
      select: {
        slackTeamName: true,
        monthlySpendCapUsd: true,
      },
    });

    if (!workspace) {
      logger.warn('Workspace not found for threshold notification', { teamId });
      return;
    }

    // Get current month usage.
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59));

    const aggregates = await prisma.dailyAggregate.findMany({
      where: {
        slackTeamId: teamId,
        date: { gte: monthStart, lte: monthEnd },
      },
      select: { totalCostUsd: true },
    });

    const totalCost = aggregates.reduce(
      (sum, agg) => sum.add(agg.totalCostUsd),
      new Prisma.Decimal(0)
    );

    // Find all workspace admins.
    const usersResult = await client.users.list({ team_id: teamId });
    const admins =
      usersResult.members?.filter((user) => user.is_admin === true && !user.is_bot) ?? [];

    if (admins.length === 0) {
      logger.warn('No admins found for threshold notification', { teamId });
      return;
    }

    // Build notification message.
    const emoji = percent >= 100 ? ':rotating_light:' : ':warning:';
    const level = percent >= 100 ? 'LIMIT REACHED' : 'Warning';
    const message =
      `${emoji} *Usage ${level}* ${emoji}\n\n` +
      `Your workspace *${workspace.slackTeamName}* has reached *${percent}%* of its monthly usage limit.\n\n` +
      `*Current Month Spend:* $${totalCost.toFixed(2)}\n` +
      `*Monthly Cap:* $${workspace.monthlySpendCapUsd?.toString() ?? 'Not set'}\n\n` +
      (percent >= 100
        ? 'New enrichment requests will be blocked until next month or cap is increased.'
        : 'You are approaching your monthly limit. Consider upgrading or pausing non-critical jobs.');

    // Send DM to each admin.
    for (const admin of admins) {
      if (!admin.id) continue;
      try {
        await client.chat.postMessage({
          channel: admin.id,
          text: message,
          mrkdwn: true,
        });
      } catch (err) {
        logger.error('Failed to send threshold DM', {
          teamId,
          adminId: admin.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    logger.info('Threshold notifications sent', {
      teamId,
      percent,
      adminCount: admins.length,
    });
  } catch (error) {
    logger.error('Threshold notification failed', {
      teamId,
      percent,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
