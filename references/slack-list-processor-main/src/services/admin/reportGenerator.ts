/**
 * Report generator service.
 *
 * Generates CSV content for on-demand and scheduled report exports.
 * Supports report types: COST_SUMMARY, USAGE_BREAKDOWN, CLIENT_REPORT, ERROR_SUMMARY.
 */

import { Prisma } from '@prisma/client';
import { prisma } from '../../models/index.js';

/**
 * Filters that can be applied to reports.
 */
export interface ReportFilters {
  service?: string | null;
  slackTeamId?: string | null;
}

/**
 * Options for generating a report.
 */
export interface ReportOptions {
  reportType: 'COST_SUMMARY' | 'USAGE_BREAKDOWN' | 'CLIENT_REPORT' | 'ERROR_SUMMARY';
  startDate: Date;
  endDate: Date;
  filters?: ReportFilters;
}

// ---------------------------------------------------------------------------
// CSV helper
// ---------------------------------------------------------------------------

/**
 * Escapes a value for CSV output.
 */
function csvEscape(val: unknown): string {
  if (val == null) return '';
  const str = String(val);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/**
 * Converts an array of objects to CSV string.
 */
function toCsv(headers: string[], rows: Record<string, unknown>[]): string {
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map((h) => csvEscape(row[h])).join(','));
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Report generators
// ---------------------------------------------------------------------------

/**
 * COST_SUMMARY: Daily cost totals by service.
 */
async function generateCostSummary(opts: ReportOptions): Promise<string> {
  const where: Record<string, unknown> = {
    createdAt: { gte: opts.startDate, lte: opts.endDate },
  };
  if (opts.filters?.service) where.service = opts.filters.service;
  if (opts.filters?.slackTeamId) {
    where.job = { slackTeamId: opts.filters.slackTeamId };
  }

  const logs = await prisma.apiUsageLog.findMany({
    where,
    select: {
      service: true,
      requestCount: true,
      estimatedCostUsd: true,
      createdAt: true,
      job: { select: { slackTeamId: true } },
    },
    orderBy: { createdAt: 'asc' },
  });

  const rows = logs.map((l) => ({
    date: l.createdAt.toISOString().split('T')[0],
    service: l.service,
    slack_team_id: l.job.slackTeamId,
    request_count: l.requestCount,
    cost_usd: (l.estimatedCostUsd ?? new Prisma.Decimal(0)).toString(),
  }));

  return toCsv(['date', 'service', 'slack_team_id', 'request_count', 'cost_usd'], rows);
}

/**
 * USAGE_BREAKDOWN: Detailed API usage log export.
 */
async function generateUsageBreakdown(opts: ReportOptions): Promise<string> {
  const where: Record<string, unknown> = {
    createdAt: { gte: opts.startDate, lte: opts.endDate },
  };
  if (opts.filters?.service) where.service = opts.filters.service;
  if (opts.filters?.slackTeamId) {
    where.job = { slackTeamId: opts.filters.slackTeamId };
  }

  const logs = await prisma.apiUsageLog.findMany({
    where,
    select: {
      service: true,
      endpoint: true,
      requestCount: true,
      estimatedCostUsd: true,
      tokensInput: true,
      tokensOutput: true,
      creditsConsumed: true,
      responseStatus: true,
      durationMs: true,
      createdAt: true,
      job: { select: { id: true, slackTeamId: true, slackUserId: true } },
    },
    orderBy: { createdAt: 'asc' },
  });

  const rows = logs.map((l) => ({
    date: l.createdAt.toISOString(),
    service: l.service,
    endpoint: l.endpoint,
    job_id: l.job.id,
    slack_team_id: l.job.slackTeamId,
    slack_user_id: l.job.slackUserId,
    request_count: l.requestCount,
    cost_usd: (l.estimatedCostUsd ?? new Prisma.Decimal(0)).toString(),
    tokens_input: l.tokensInput ?? '',
    tokens_output: l.tokensOutput ?? '',
    credits_consumed: l.creditsConsumed?.toString() ?? '',
    response_status: l.responseStatus ?? '',
    duration_ms: l.durationMs ?? '',
  }));

  return toCsv(
    ['date', 'service', 'endpoint', 'job_id', 'slack_team_id', 'slack_user_id',
     'request_count', 'cost_usd', 'tokens_input', 'tokens_output',
     'credits_consumed', 'response_status', 'duration_ms'],
    rows,
  );
}

/**
 * CLIENT_REPORT: Per-workspace aggregated metrics.
 */
async function generateClientReport(opts: ReportOptions): Promise<string> {
  const jobWhere: Record<string, unknown> = {
    createdAt: { gte: opts.startDate, lte: opts.endDate },
  };
  if (opts.filters?.slackTeamId) jobWhere.slackTeamId = opts.filters.slackTeamId;

  const jobs = await prisma.job.findMany({
    where: jobWhere,
    select: {
      slackTeamId: true,
      status: true,
    },
  });

  // Aggregate by team.
  const teamMap = new Map<string, { totalJobs: number; failedJobs: number }>();
  for (const job of jobs) {
    const entry = teamMap.get(job.slackTeamId) ?? { totalJobs: 0, failedJobs: 0 };
    entry.totalJobs++;
    if (job.status === 'FAILED') entry.failedJobs++;
    teamMap.set(job.slackTeamId, entry);
  }

  // Get cost per team.
  const usageLogs = await prisma.apiUsageLog.findMany({
    where: { createdAt: { gte: opts.startDate, lte: opts.endDate } },
    select: {
      estimatedCostUsd: true,
      requestCount: true,
      job: { select: { slackTeamId: true } },
    },
  });

  const costMap = new Map<string, { cost: Prisma.Decimal; calls: number }>();
  for (const log of usageLogs) {
    const tid = log.job.slackTeamId;
    const entry = costMap.get(tid) ?? { cost: new Prisma.Decimal(0), calls: 0 };
    entry.cost = entry.cost.add(log.estimatedCostUsd ?? new Prisma.Decimal(0));
    entry.calls += log.requestCount;
    costMap.set(tid, entry);
  }

  const rows = Array.from(teamMap.entries()).map(([teamId, data]) => {
    const usage = costMap.get(teamId) ?? { cost: new Prisma.Decimal(0), calls: 0 };
    return {
      slack_team_id: teamId,
      total_jobs: data.totalJobs,
      failed_jobs: data.failedJobs,
      error_rate_percent: data.totalJobs > 0
        ? (Math.round((data.failedJobs / data.totalJobs) * 1000) / 10).toString()
        : '0',
      total_api_calls: usage.calls,
      total_cost_usd: usage.cost.toString(),
    };
  });

  return toCsv(
    ['slack_team_id', 'total_jobs', 'failed_jobs', 'error_rate_percent', 'total_api_calls', 'total_cost_usd'],
    rows,
  );
}

/**
 * ERROR_SUMMARY: Error log export.
 */
async function generateErrorSummary(opts: ReportOptions): Promise<string> {
  const where: Record<string, unknown> = {
    createdAt: { gte: opts.startDate, lte: opts.endDate },
  };
  if (opts.filters?.service) where.service = opts.filters.service;

  const errors = await prisma.errorLog.findMany({
    where,
    select: {
      id: true,
      category: true,
      service: true,
      message: true,
      lifecycleState: true,
      createdAt: true,
      job: { select: { id: true, slackTeamId: true } },
    },
    orderBy: { createdAt: 'asc' },
  });

  const rows = errors.map((e) => ({
    id: e.id,
    date: e.createdAt.toISOString(),
    category: e.category,
    service: e.service,
    message: e.message,
    lifecycle_state: e.lifecycleState,
    job_id: e.job?.id ?? '',
    slack_team_id: e.job?.slackTeamId ?? '',
  }));

  return toCsv(
    ['id', 'date', 'category', 'service', 'message', 'lifecycle_state', 'job_id', 'slack_team_id'],
    rows,
  );
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Generates CSV content for the given report type and options.
 */
export async function generateReport(opts: ReportOptions): Promise<string> {
  switch (opts.reportType) {
    case 'COST_SUMMARY':
      return generateCostSummary(opts);
    case 'USAGE_BREAKDOWN':
      return generateUsageBreakdown(opts);
    case 'CLIENT_REPORT':
      return generateClientReport(opts);
    case 'ERROR_SUMMARY':
      return generateErrorSummary(opts);
    default:
      throw new Error(`Unknown report type: ${opts.reportType}`);
  }
}
