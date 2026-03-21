/**
 * Client insights service.
 *
 * Provides aggregated per-workspace metrics derived from Job + ApiUsageLog
 * tables. Supports client list with sorting, and per-client detail views
 * with cost breakdown, top users, and recent jobs.
 */

import { Prisma } from '@prisma/client';
import { prisma } from '../../models/index.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ClientSummary {
  slackTeamId: string;
  slackTeamName: string | null;
  totalJobs: number;
  totalApiCalls: number;
  totalCostUsd: string;
  errorRatePercent: number;
  lastActiveAt: Date | null;
}

export interface ClientDetail {
  slackTeamId: string;
  slackTeamName: string | null;
  summary: {
    totalJobs: number;
    totalApiCalls: number;
    totalCostUsd: string;
    errorRatePercent: number;
    lastActiveAt: Date | null;
  };
  costByProvider: Array<{ service: string; costUsd: string }>;
  topUsers: Array<{
    slackUserId: string;
    displayName: string | null;
    totalJobs: number;
    totalCostUsd: string;
  }>;
  recentJobs: Array<{
    id: string;
    jobType: string;
    status: string;
    sourceFileName: string | null;
    sourceRowCount: number | null;
    purpose: string | null;
    isCosell: boolean;
    cosellProvider: string | null;
    listOwner: string | null;
    createdAt: Date;
  }>;
}

interface DateRange {
  startDate: Date;
  endDate: Date;
}

// ---------------------------------------------------------------------------
// Client List
// ---------------------------------------------------------------------------

/**
 * Returns aggregated metrics for all client workspaces.
 */
export async function getClientList(opts: {
  range: DateRange;
  sort: string;
  limit: number;
  offset: number;
}): Promise<{ clients: ClientSummary[]; total: number }> {
  const { range, limit, offset } = opts;

  // Get all unique team IDs from jobs in the date range.
  const jobs = await prisma.job.findMany({
    where: { createdAt: { gte: range.startDate, lte: range.endDate } },
    select: {
      slackTeamId: true,
      status: true,
      createdAt: true,
    },
  });

  // Group jobs by team.
  const teamMap = new Map<string, {
    totalJobs: number;
    failedJobs: number;
    lastActiveAt: Date | null;
  }>();

  for (const job of jobs) {
    const entry = teamMap.get(job.slackTeamId) ?? {
      totalJobs: 0,
      failedJobs: 0,
      lastActiveAt: null,
    };
    entry.totalJobs++;
    if (job.status === 'FAILED') entry.failedJobs++;
    if (!entry.lastActiveAt || job.createdAt > entry.lastActiveAt) {
      entry.lastActiveAt = job.createdAt;
    }
    teamMap.set(job.slackTeamId, entry);
  }

  // Look up actual workspace names from WorkspaceInstallation.
  const teamIds = Array.from(teamMap.keys());
  const installations = await prisma.workspaceInstallation.findMany({
    where: { slackTeamId: { in: teamIds } },
    select: { slackTeamId: true, slackTeamName: true },
  });
  const nameMap = new Map(installations.map((i) => [i.slackTeamId, i.slackTeamName]));

  // Get API usage per team.
  const usageLogs = await prisma.apiUsageLog.findMany({
    where: { createdAt: { gte: range.startDate, lte: range.endDate } },
    select: {
      requestCount: true,
      estimatedCostUsd: true,
      job: { select: { slackTeamId: true } },
    },
  });

  const usageMap = new Map<string, { calls: number; cost: Prisma.Decimal }>();
  for (const log of usageLogs) {
    const teamId = log.job.slackTeamId;
    const entry = usageMap.get(teamId) ?? { calls: 0, cost: new Prisma.Decimal(0) };
    entry.calls += log.requestCount;
    entry.cost = entry.cost.add(log.estimatedCostUsd ?? new Prisma.Decimal(0));
    usageMap.set(teamId, entry);
  }

  // Build client summaries.
  const clients: ClientSummary[] = Array.from(teamMap.entries()).map(([teamId, data]) => {
    const usage = usageMap.get(teamId) ?? { calls: 0, cost: new Prisma.Decimal(0) };
    return {
      slackTeamId: teamId,
      slackTeamName: nameMap.get(teamId) ?? null,
      totalJobs: data.totalJobs,
      totalApiCalls: usage.calls,
      totalCostUsd: usage.cost.toString(),
      errorRatePercent:
        data.totalJobs > 0
          ? Math.round((data.failedJobs / data.totalJobs) * 1000) / 10
          : 0,
      lastActiveAt: data.lastActiveAt,
    };
  });

  // Sort.
  const [sortField, sortDir] = (opts.sort || 'total_cost:desc').split(':');
  const dir = sortDir === 'asc' ? 1 : -1;
  clients.sort((a, b) => {
    switch (sortField) {
      case 'total_jobs':
        return (a.totalJobs - b.totalJobs) * dir;
      case 'error_rate':
        return (a.errorRatePercent - b.errorRatePercent) * dir;
      case 'last_active':
        return ((a.lastActiveAt?.getTime() ?? 0) - (b.lastActiveAt?.getTime() ?? 0)) * dir;
      case 'total_cost':
      default:
        return (parseFloat(a.totalCostUsd) - parseFloat(b.totalCostUsd)) * dir;
    }
  });

  const total = clients.length;
  return { clients: clients.slice(offset, offset + limit), total };
}

// ---------------------------------------------------------------------------
// Client Detail
// ---------------------------------------------------------------------------

/**
 * Returns detailed metrics for a specific client workspace.
 */
export async function getClientDetail(
  slackTeamId: string,
  range: DateRange,
): Promise<ClientDetail | null> {
  const jobs = await prisma.job.findMany({
    where: {
      slackTeamId,
      createdAt: { gte: range.startDate, lte: range.endDate },
    },
    select: {
      id: true,
      slackUserId: true,
      jobType: true,
      status: true,
      sourceFileName: true,
      sourceRowCount: true,
      purpose: true,
      isCosell: true,
      cosellProvider: true,
      listOwner: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
  });

  if (jobs.length === 0) return null;

  const totalJobs = jobs.length;
  const failedJobs = jobs.filter((j) => j.status === 'FAILED').length;
  const lastActiveAt = jobs[0].createdAt;
  // Look up actual workspace name from WorkspaceInstallation.
  const installation = await prisma.workspaceInstallation.findUnique({
    where: { slackTeamId },
    select: { slackTeamName: true },
  });
  const teamName = installation?.slackTeamName ?? null;

  // Cost by provider.
  const usageLogs = await prisma.apiUsageLog.findMany({
    where: {
      createdAt: { gte: range.startDate, lte: range.endDate },
      job: { slackTeamId },
    },
    select: {
      service: true,
      requestCount: true,
      estimatedCostUsd: true,
      job: { select: { slackUserId: true } },
    },
  });

  let totalCalls = 0;
  let totalCost = new Prisma.Decimal(0);
  const providerMap = new Map<string, Prisma.Decimal>();
  const userCostMap = new Map<string, Prisma.Decimal>();

  for (const log of usageLogs) {
    totalCalls += log.requestCount;
    const cost = log.estimatedCostUsd ?? new Prisma.Decimal(0);
    totalCost = totalCost.add(cost);

    const existing = providerMap.get(log.service) ?? new Prisma.Decimal(0);
    providerMap.set(log.service, existing.add(cost));

    const userCost = userCostMap.get(log.job.slackUserId) ?? new Prisma.Decimal(0);
    userCostMap.set(log.job.slackUserId, userCost.add(cost));
  }

  const costByProvider = Array.from(providerMap.entries())
    .map(([service, cost]) => ({ service, costUsd: cost.toString() }))
    .sort((a, b) => parseFloat(b.costUsd) - parseFloat(a.costUsd));

  // Top users by job count and cost.
  const userJobMap = new Map<string, number>();
  for (const job of jobs) {
    userJobMap.set(job.slackUserId, (userJobMap.get(job.slackUserId) ?? 0) + 1);
  }

  const topUsers = Array.from(userJobMap.entries())
    .map(([userId, jobCount]) => ({
      slackUserId: userId,
      displayName: userId,
      totalJobs: jobCount,
      totalCostUsd: (userCostMap.get(userId) ?? new Prisma.Decimal(0)).toString(),
    }))
    .sort((a, b) => b.totalJobs - a.totalJobs)
    .slice(0, 10);

  // Recent jobs (already sorted desc).
  const recentJobs = jobs.slice(0, 10).map((j) => ({
    id: j.id,
    jobType: j.jobType,
    status: j.status,
    sourceFileName: j.sourceFileName,
    sourceRowCount: j.sourceRowCount,
    purpose: j.purpose,
    isCosell: j.isCosell,
    cosellProvider: j.cosellProvider,
    listOwner: j.listOwner,
    createdAt: j.createdAt,
  }));

  return {
    slackTeamId,
    slackTeamName: teamName,
    summary: {
      totalJobs,
      totalApiCalls: totalCalls,
      totalCostUsd: totalCost.toString(),
      errorRatePercent:
        totalJobs > 0 ? Math.round((failedJobs / totalJobs) * 1000) / 10 : 0,
      lastActiveAt,
    },
    costByProvider,
    topUsers,
    recentJobs,
  };
}
