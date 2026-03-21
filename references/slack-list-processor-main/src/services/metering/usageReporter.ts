/**
 * Usage reporting service for workspace billing summaries (T048).
 *
 * Aggregates current billing period (monthly) usage from DailyAggregate
 * and provides formatted summaries for Slack display and dashboard views.
 */

import { Prisma } from '@prisma/client';
import { prisma } from '../../models/index.js';
import logger from '../../lib/logger.js';

/**
 * Service-level usage breakdown.
 */
export interface ServiceUsage {
  /** Service name (BUILTWITH, APOLLO, AI_ORCHESTRATOR). */
  service: string;
  /** Total cost in USD. */
  costUsd: string;
  /** Total API requests made. */
  requests: number;
  /** Total input tokens (AI only). */
  tokensInput: number;
  /** Total output tokens (AI only). */
  tokensOutput: number;
  /** Total vendor credits consumed (Apollo/BuiltWith). */
  creditsConsumed: string;
}

/**
 * Workspace usage summary for current billing period.
 */
export interface UsageSummary {
  /** Slack team/workspace ID. */
  slackTeamId: string;
  /** Workspace name. */
  slackTeamName: string;
  /** Billing period start date (ISO 8601). */
  periodStart: string;
  /** Billing period end date (ISO 8601). */
  periodEnd: string;
  /** Total cost across all services in USD. */
  totalCostUsd: string;
  /** Total API requests across all services. */
  totalRequests: number;
  /** Breakdown by service. */
  byService: ServiceUsage[];
  /** Human-readable formatted summary text for Slack display. */
  formattedSummary: string;
}

/**
 * Retrieves usage summary for a workspace's current billing period (month).
 *
 * Aggregates DailyAggregate records for the current calendar month and
 * returns a structured breakdown by service plus a formatted text summary.
 *
 * @param teamId - Slack workspace team ID.
 * @returns Usage summary with cost, request counts, and formatted text.
 *
 * @example
 * ```typescript
 * const summary = await getUsageSummary('T1234567890');
 * await client.chat.postMessage({
 *   channel: adminChannelId,
 *   text: summary.formattedSummary,
 * });
 * ```
 */
export async function getUsageSummary(teamId: string): Promise<UsageSummary> {
  try {
    // Load workspace details.
    const workspace = await prisma.workspaceInstallation.findUnique({
      where: { slackTeamId: teamId },
      select: { slackTeamName: true },
    });

    if (!workspace) {
      throw new Error(`Workspace not found: ${teamId}`);
    }

    // Get current month date range.
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59));

    // Query aggregates for current month.
    const aggregates = await prisma.dailyAggregate.findMany({
      where: {
        slackTeamId: teamId,
        date: { gte: monthStart, lte: monthEnd },
      },
      select: {
        service: true,
        totalCostUsd: true,
        totalRequests: true,
        totalTokensInput: true,
        totalTokensOutput: true,
        totalCreditsConsumed: true,
      },
    });

    // Group by service.
    const serviceMap = new Map<
      string,
      {
        costUsd: Prisma.Decimal;
        requests: number;
        tokensInput: number;
        tokensOutput: number;
        creditsConsumed: Prisma.Decimal;
      }
    >();

    for (const agg of aggregates) {
      const existing = serviceMap.get(agg.service) ?? {
        costUsd: new Prisma.Decimal(0),
        requests: 0,
        tokensInput: 0,
        tokensOutput: 0,
        creditsConsumed: new Prisma.Decimal(0),
      };
      existing.costUsd = existing.costUsd.add(agg.totalCostUsd);
      existing.requests += agg.totalRequests;
      existing.tokensInput += agg.totalTokensInput;
      existing.tokensOutput += agg.totalTokensOutput;
      existing.creditsConsumed = existing.creditsConsumed.add(agg.totalCreditsConsumed);
      serviceMap.set(agg.service, existing);
    }

    // Build service breakdown.
    const byService: ServiceUsage[] = Array.from(serviceMap.entries()).map(([service, data]) => ({
      service,
      costUsd: data.costUsd.toFixed(2),
      requests: data.requests,
      tokensInput: data.tokensInput,
      tokensOutput: data.tokensOutput,
      creditsConsumed: data.creditsConsumed.toFixed(0),
    }));

    // Calculate totals.
    const totalCostUsd = byService
      .reduce((sum, s) => sum.add(new Prisma.Decimal(s.costUsd)), new Prisma.Decimal(0))
      .toFixed(2);
    const totalRequests = byService.reduce((sum, s) => sum + s.requests, 0);

    // Format text summary for Slack display.
    const formattedSummary = formatUsageSummary({
      slackTeamName: workspace.slackTeamName,
      periodStart: monthStart.toISOString().split('T')[0],
      periodEnd: monthEnd.toISOString().split('T')[0],
      totalCostUsd,
      totalRequests,
      byService,
    });

    return {
      slackTeamId: teamId,
      slackTeamName: workspace.slackTeamName,
      periodStart: monthStart.toISOString().split('T')[0],
      periodEnd: monthEnd.toISOString().split('T')[0],
      totalCostUsd,
      totalRequests,
      byService,
      formattedSummary,
    };
  } catch (error) {
    logger.error('Failed to get usage summary', {
      teamId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Formats a usage summary as human-readable text for Slack display.
 *
 * @param summary - Partial usage summary data to format.
 * @returns Multi-line formatted string with markdown.
 */
function formatUsageSummary(summary: {
  slackTeamName: string;
  periodStart: string;
  periodEnd: string;
  totalCostUsd: string;
  totalRequests: number;
  byService: ServiceUsage[];
}): string {
  const lines: string[] = [];

  lines.push(`*Usage Summary for ${summary.slackTeamName}*`);
  lines.push(`Period: ${summary.periodStart} to ${summary.periodEnd}`);
  lines.push('');
  lines.push(`*Total Cost:* $${summary.totalCostUsd}`);
  lines.push(`*Total API Requests:* ${summary.totalRequests.toLocaleString()}`);
  lines.push('');

  if (summary.byService.length === 0) {
    lines.push('No usage recorded for this period.');
    return lines.join('\n');
  }

  lines.push('*Breakdown by Service:*');

  for (const svc of summary.byService) {
    const serviceName = formatServiceName(svc.service);
    lines.push(`\n*${serviceName}*`);
    lines.push(`  • Cost: $${svc.costUsd}`);
    lines.push(`  • Requests: ${svc.requests.toLocaleString()}`);

    if (svc.service === 'AI_ORCHESTRATOR') {
      const totalTokens = svc.tokensInput + svc.tokensOutput;
      lines.push(`  • Tokens: ${totalTokens.toLocaleString()} (in: ${svc.tokensInput.toLocaleString()}, out: ${svc.tokensOutput.toLocaleString()})`);
    }

    if (svc.service === 'APOLLO' || svc.service === 'BUILTWITH') {
      if (parseFloat(svc.creditsConsumed) > 0) {
        lines.push(`  • Credits Used: ${parseFloat(svc.creditsConsumed).toLocaleString()}`);
      }
    }
  }

  return lines.join('\n');
}

/**
 * Converts internal service enum to human-readable name.
 *
 * @param service - Prisma ApiService enum value.
 * @returns Human-friendly service name.
 */
function formatServiceName(service: string): string {
  switch (service) {
    case 'BUILTWITH':
      return 'BuiltWith';
    case 'APOLLO':
      return 'Apollo.io';
    case 'AI_ORCHESTRATOR':
      return 'AI (Anthropic)';
    default:
      return service;
  }
}

/**
 * Validates metering accuracy by comparing DailyAggregate cost sums
 * against raw ApiUsageLog cost sums for the current calendar month.
 *
 * Logs a warning when discrepancy exceeds 1%.
 *
 * @param teamId - Slack workspace team ID.
 * @returns Whether the totals are within 1% and the discrepancy percentage.
 */
export async function validateMeteringAccuracy(
  teamId: string,
): Promise<{ accurate: boolean; discrepancyPercent: number }> {
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const aggregates = await prisma.dailyAggregate.aggregate({
    where: { slackTeamId: teamId, date: { gte: monthStart } },
    _sum: { totalCostUsd: true },
  });

  const rawLogs = await prisma.apiUsageLog.aggregate({
    where: { slackTeamId: teamId, createdAt: { gte: monthStart } },
    _sum: { estimatedCostUsd: true },
  });

  const aggTotal = aggregates._sum.totalCostUsd?.toNumber() ?? 0;
  const rawTotal = rawLogs._sum.estimatedCostUsd?.toNumber() ?? 0;

  const discrepancy =
    rawTotal > 0 ? (Math.abs(aggTotal - rawTotal) / rawTotal) * 100 : 0;

  if (discrepancy > 1) {
    logger.warn('Metering accuracy discrepancy detected', {
      teamId,
      aggregateTotal: aggTotal,
      rawLogTotal: rawTotal,
      discrepancyPercent: discrepancy.toFixed(2),
    });
  }

  return { accurate: discrepancy <= 1, discrepancyPercent: discrepancy };
}
