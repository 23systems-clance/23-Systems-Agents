/**
 * Cost & usage aggregation service.
 *
 * Provides methods for overview summary, cost-by-provider/workspace
 * breakdowns, and time-series trending (daily/weekly/monthly granularity).
 * Merges pre-computed DailyAggregate data with today's on-the-fly
 * calculations from raw ApiUsageLog.
 */

import { Prisma } from '@prisma/client';
import { prisma } from '../../models/index.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DateRange {
  startDate: Date;
  endDate: Date;
}

export interface OverviewSummary {
  totalCostUsd: string;
  totalApiCalls: number;
  totalTokensInput: number;
  totalTokensOutput: number;
  activeJobs: number;
  completedJobs: number;
  failedJobs: number;
}

export interface CostByProvider {
  service: string;
  costUsd: string;
  percentage: number;
}

export interface CostByWorkspace {
  slackTeamId: string;
  slackTeamName: string | null;
  costUsd: string;
}

export interface TrendDataPoint {
  period: string;
  totalCostUsd: string;
  totalRequests: number;
  totalTokensInput: number;
  totalTokensOutput: number;
  totalCreditsConsumed: string;
  errorCount: number;
  avgDurationMs: number | null;
}

export interface OverviewResult {
  period: { startDate: string; endDate: string };
  summary: OverviewSummary;
  costByProvider: CostByProvider[];
  costByWorkspace: CostByWorkspace[];
  openErrors: number;
  errorRatePercent: number;
}

// ---------------------------------------------------------------------------
// Helper: build date filters
// ---------------------------------------------------------------------------

function dateFilter(range: DateRange) {
  return {
    createdAt: {
      gte: range.startDate,
      lte: range.endDate,
    },
  };
}

// ---------------------------------------------------------------------------
// Overview Summary
// ---------------------------------------------------------------------------

/**
 * Returns the full overview dashboard payload.
 */
export async function getOverview(range: DateRange): Promise<OverviewResult> {
  const [summary, costByProvider, costByWorkspace, openErrors, totalCalls, errorCalls] =
    await Promise.all([
      getOverviewSummary(range),
      getCostByProvider(range),
      getCostByWorkspace(range),
      prisma.errorLog.count({ where: { lifecycleState: 'OPEN' } }),
      prisma.apiUsageLog.count({ where: dateFilter(range) }),
      prisma.apiUsageLog.count({
        where: {
          ...dateFilter(range),
          responseStatus: { gte: 400 },
        },
      }),
    ]);

  const errorRatePercent =
    totalCalls > 0 ? Math.round((errorCalls / totalCalls) * 1000) / 10 : 0;

  return {
    period: {
      startDate: range.startDate.toISOString().split('T')[0],
      endDate: range.endDate.toISOString().split('T')[0],
    },
    summary,
    costByProvider,
    costByWorkspace,
    openErrors,
    errorRatePercent,
  };
}

/**
 * Returns aggregate summary metrics for a date range.
 */
async function getOverviewSummary(range: DateRange): Promise<OverviewSummary> {
  const [agg, jobCounts] = await Promise.all([
    prisma.apiUsageLog.aggregate({
      where: dateFilter(range),
      _sum: {
        estimatedCostUsd: true,
        requestCount: true,
        tokensInput: true,
        tokensOutput: true,
      },
    }),
    prisma.job.groupBy({
      by: ['status'],
      where: dateFilter(range),
      _count: true,
    }),
  ]);

  const jobCountMap: Record<string, number> = {};
  for (const row of jobCounts) {
    jobCountMap[row.status] = row._count;
  }

  return {
    totalCostUsd: (agg._sum.estimatedCostUsd ?? new Prisma.Decimal(0)).toString(),
    totalApiCalls: agg._sum.requestCount ?? 0,
    totalTokensInput: agg._sum.tokensInput ?? 0,
    totalTokensOutput: agg._sum.tokensOutput ?? 0,
    activeJobs: (jobCountMap['PROCESSING'] ?? 0) + (jobCountMap['PENDING'] ?? 0),
    completedJobs: jobCountMap['COMPLETED'] ?? 0,
    failedJobs: jobCountMap['FAILED'] ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Cost Breakdown
// ---------------------------------------------------------------------------

/**
 * Returns cost breakdown by API provider.
 */
export async function getCostByProvider(range: DateRange): Promise<CostByProvider[]> {
  const groups = await prisma.apiUsageLog.groupBy({
    by: ['service'],
    where: dateFilter(range),
    _sum: { estimatedCostUsd: true },
  });

  const totalCost = groups.reduce(
    (sum, g) => sum.add(g._sum.estimatedCostUsd ?? new Prisma.Decimal(0)),
    new Prisma.Decimal(0),
  );

  return groups
    .map((g) => {
      const cost = g._sum.estimatedCostUsd ?? new Prisma.Decimal(0);
      const pct = totalCost.isZero()
        ? 0
        : Math.round(cost.div(totalCost).mul(1000).toNumber()) / 10;
      return {
        service: g.service,
        costUsd: cost.toString(),
        percentage: pct,
      };
    })
    .sort((a, b) => parseFloat(b.costUsd) - parseFloat(a.costUsd));
}

/**
 * Returns cost breakdown by Slack workspace.
 */
export async function getCostByWorkspace(range: DateRange): Promise<CostByWorkspace[]> {
  // Join ApiUsageLog -> Job to group by slackTeamId.
  const logs = await prisma.apiUsageLog.findMany({
    where: dateFilter(range),
    select: {
      estimatedCostUsd: true,
      job: {
        select: {
          slackTeamId: true,
        },
      },
    },
  });

  const costMap = new Map<string, Prisma.Decimal>();
  for (const log of logs) {
    const teamId = log.job.slackTeamId;
    const cost = log.estimatedCostUsd ?? new Prisma.Decimal(0);
    costMap.set(teamId, (costMap.get(teamId) ?? new Prisma.Decimal(0)).add(cost));
  }

  // Look up actual workspace names from WorkspaceInstallation.
  const teamIds = Array.from(costMap.keys());
  const installations = await prisma.workspaceInstallation.findMany({
    where: { slackTeamId: { in: teamIds } },
    select: { slackTeamId: true, slackTeamName: true },
  });
  const nameMap = new Map(installations.map((i) => [i.slackTeamId, i.slackTeamName]));

  return teamIds
    .map((teamId) => ({
      slackTeamId: teamId,
      slackTeamName: nameMap.get(teamId) ?? null,
      costUsd: (costMap.get(teamId) ?? new Prisma.Decimal(0)).toString(),
    }))
    .sort((a, b) => parseFloat(b.costUsd) - parseFloat(a.costUsd));
}

// ---------------------------------------------------------------------------
// Time-Series Trending
// ---------------------------------------------------------------------------

export type Granularity = 'daily' | 'weekly' | 'monthly';

export interface TrendOptions {
  range: DateRange;
  granularity: Granularity;
  service?: string;
  slackTeamId?: string;
}

/**
 * Returns time-series trend data.
 *
 * Uses DailyAggregate for historical data and merges today's on-the-fly
 * calculations from raw ApiUsageLog.
 */
export async function getUsageTrends(opts: TrendOptions): Promise<TrendDataPoint[]> {
  const { range, granularity, service, slackTeamId } = opts;

  // Build filter for DailyAggregate.
  const aggWhere: Prisma.DailyAggregateWhereInput = {
    date: { gte: range.startDate, lte: range.endDate },
  };
  if (service) aggWhere.service = service as Prisma.EnumApiServiceFilter;
  if (slackTeamId) aggWhere.slackTeamId = slackTeamId;

  const aggregates = await prisma.dailyAggregate.findMany({
    where: aggWhere,
    orderBy: { date: 'asc' },
  });

  // Also compute today's data from raw logs if today is within range.
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = today.toISOString().split('T')[0];

  let todayAggregates: typeof aggregates = [];
  if (today >= range.startDate && today <= range.endDate) {
    const rawWhere: Prisma.ApiUsageLogWhereInput = {
      createdAt: { gte: today },
    };
    if (service) rawWhere.service = service as Prisma.EnumApiServiceFilter;

    const rawLogs = await prisma.apiUsageLog.findMany({
      where: rawWhere,
      select: {
        service: true,
        estimatedCostUsd: true,
        requestCount: true,
        tokensInput: true,
        tokensOutput: true,
        creditsConsumed: true,
        responseStatus: true,
        durationMs: true,
        job: { select: { slackTeamId: true } },
      },
    });

    // Group by service + team.
    const todayMap = new Map<string, {
      service: string;
      slackTeamId: string;
      totalRequests: number;
      totalCostUsd: Prisma.Decimal;
      totalTokensInput: number;
      totalTokensOutput: number;
      totalCreditsConsumed: Prisma.Decimal;
      errorCount: number;
      durationSum: number;
      durationCount: number;
    }>();

    for (const log of rawLogs) {
      const teamId = log.job.slackTeamId;
      if (slackTeamId && teamId !== slackTeamId) continue;
      const key = `${log.service}:${teamId}`;
      const entry = todayMap.get(key) ?? {
        service: log.service,
        slackTeamId: teamId,
        totalRequests: 0,
        totalCostUsd: new Prisma.Decimal(0),
        totalTokensInput: 0,
        totalTokensOutput: 0,
        totalCreditsConsumed: new Prisma.Decimal(0),
        errorCount: 0,
        durationSum: 0,
        durationCount: 0,
      };
      entry.totalRequests += log.requestCount;
      entry.totalCostUsd = entry.totalCostUsd.add(log.estimatedCostUsd ?? new Prisma.Decimal(0));
      entry.totalTokensInput += log.tokensInput ?? 0;
      entry.totalTokensOutput += log.tokensOutput ?? 0;
      entry.totalCreditsConsumed = entry.totalCreditsConsumed.add(log.creditsConsumed ?? new Prisma.Decimal(0));
      if (log.responseStatus && log.responseStatus >= 400) entry.errorCount++;
      if (log.durationMs) {
        entry.durationSum += log.durationMs;
        entry.durationCount++;
      }
      todayMap.set(key, entry);
    }

    todayAggregates = Array.from(todayMap.values()).map((e) => ({
      id: '',
      date: today,
      service: e.service as 'BUILTWITH' | 'APOLLO' | 'AI_ORCHESTRATOR',
      slackTeamId: e.slackTeamId,
      totalRequests: e.totalRequests,
      totalCostUsd: e.totalCostUsd,
      totalTokensInput: e.totalTokensInput,
      totalTokensOutput: e.totalTokensOutput,
      totalCreditsConsumed: e.totalCreditsConsumed,
      errorCount: e.errorCount,
      avgDurationMs: e.durationCount > 0 ? Math.round(e.durationSum / e.durationCount) : null,
      createdAt: new Date(),
    }));
  }

  // Merge historical + today, filtering out any pre-computed today rows.
  const allAggregates = [
    ...aggregates.filter((a) => a.date.toISOString().split('T')[0] !== todayStr),
    ...todayAggregates,
  ];

  // Bucket by granularity.
  const bucketMap = new Map<string, TrendDataPoint>();
  for (const agg of allAggregates) {
    const period = bucketDate(agg.date, granularity);
    const existing = bucketMap.get(period) ?? {
      period,
      totalCostUsd: '0',
      totalRequests: 0,
      totalTokensInput: 0,
      totalTokensOutput: 0,
      totalCreditsConsumed: '0',
      errorCount: 0,
      avgDurationMs: null,
    };

    existing.totalCostUsd = new Prisma.Decimal(existing.totalCostUsd)
      .add(agg.totalCostUsd)
      .toString();
    existing.totalRequests += agg.totalRequests;
    existing.totalTokensInput += agg.totalTokensInput;
    existing.totalTokensOutput += agg.totalTokensOutput;
    existing.totalCreditsConsumed = new Prisma.Decimal(existing.totalCreditsConsumed)
      .add(agg.totalCreditsConsumed)
      .toString();
    existing.errorCount += agg.errorCount;
    // Average durations across aggregates (rough approximation).
    if (agg.avgDurationMs !== null) {
      existing.avgDurationMs =
        existing.avgDurationMs === null
          ? agg.avgDurationMs
          : Math.round((existing.avgDurationMs + agg.avgDurationMs) / 2);
    }
    bucketMap.set(period, existing);
  }

  return Array.from(bucketMap.values()).sort((a, b) => a.period.localeCompare(b.period));
}

/**
 * Buckets a date into a period string based on granularity.
 */
function bucketDate(date: Date, granularity: Granularity): string {
  const d = new Date(date);
  switch (granularity) {
    case 'daily':
      return d.toISOString().split('T')[0];
    case 'weekly': {
      // ISO week: Monday-based. Return the Monday of the week.
      const day = d.getUTCDay();
      const diff = d.getUTCDate() - day + (day === 0 ? -6 : 1);
      const monday = new Date(d);
      monday.setUTCDate(diff);
      return monday.toISOString().split('T')[0];
    }
    case 'monthly':
      return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    default:
      return d.toISOString().split('T')[0];
  }
}
