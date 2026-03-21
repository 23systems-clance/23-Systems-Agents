/**
 * Admin usage endpoints.
 *
 * GET /api/v1/admin/usage/trends - Cost/usage time-series data.
 * GET /api/v1/admin/usage/logs   - Paginated API call log with filters (US2).
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../models/index.js';
import { getUsageTrends } from '../../services/admin/aggregation.js';
import type { Granularity } from '../../services/admin/aggregation.js';

export const usageRouter = Router();

/**
 * GET /usage/trends
 */
usageRouter.get('/trends', async (req: Request, res: Response) => {
  try {
    const now = new Date();
    const endDate = req.query.end_date
      ? new Date(req.query.end_date as string)
      : now;
    const startDate = req.query.start_date
      ? new Date(req.query.start_date as string)
      : new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000);
    endDate.setHours(23, 59, 59, 999);

    const granularity = (req.query.granularity as Granularity) || 'daily';
    const service = req.query.service as string | undefined;
    const slackTeamId = req.query.slack_team_id as string | undefined;

    const dataPoints = await getUsageTrends({
      range: { startDate, endDate },
      granularity,
      service,
      slackTeamId,
    });

    res.json({ granularity, data_points: dataPoints });
  } catch (error) {
    res.status(500).json({
      error: 'internal_error',
      message: 'An unexpected error occurred',
    });
  }
});

/**
 * GET /usage/workspaces
 *
 * Cross-workspace usage aggregation for admin dashboard (T050).
 * Returns usage summary per workspace for the current billing period.
 */
usageRouter.get('/workspaces', async (_req: Request, res: Response) => {
  try {
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0, 23, 59, 59));

    // Get all active workspaces
    const workspaces = await prisma.workspaceInstallation.findMany({
      where: { status: 'ACTIVE' },
      select: {
        slackTeamId: true,
        slackTeamName: true,
        monthlySpendCapUsd: true,
      },
    });

    // Get aggregates for all workspaces this month
    const aggregates = await prisma.dailyAggregate.groupBy({
      by: ['slackTeamId'],
      where: {
        date: { gte: monthStart, lte: monthEnd },
      },
      _sum: {
        totalCostUsd: true,
        totalRequests: true,
      },
    });

    const aggMap = new Map(aggregates.map((a) => [
      a.slackTeamId,
      { cost: a._sum.totalCostUsd, requests: a._sum.totalRequests },
    ]));

    const result = workspaces.map((ws) => {
      const usage = aggMap.get(ws.slackTeamId);
      return {
        slack_team_id: ws.slackTeamId,
        slack_team_name: ws.slackTeamName,
        monthly_spend_cap_usd: ws.monthlySpendCapUsd?.toString() ?? null,
        current_month_cost_usd: usage?.cost?.toString() ?? '0',
        current_month_requests: usage?.requests ?? 0,
      };
    });

    res.json({
      period_start: monthStart.toISOString().split('T')[0],
      period_end: monthEnd.toISOString().split('T')[0],
      workspaces: result,
    });
  } catch (error) {
    res.status(500).json({
      error: 'internal_error',
      message: 'An unexpected error occurred',
    });
  }
});

/**
 * GET /usage/logs
 *
 * Paginated API call log with multi-filter support.
 */
usageRouter.get('/logs', async (req: Request, res: Response) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
    const offset = Math.max(Number(req.query.offset) || 0, 0);

    // Date range defaults to last 7 days.
    const now = new Date();
    const endDate = req.query.end_date
      ? new Date(req.query.end_date as string)
      : now;
    const startDate = req.query.start_date
      ? new Date(req.query.start_date as string)
      : new Date(endDate.getTime() - 7 * 24 * 60 * 60 * 1000);
    endDate.setHours(23, 59, 59, 999);

    // Build dynamic WHERE clause.
    const where: Prisma.ApiUsageLogWhereInput = {
      createdAt: { gte: startDate, lte: endDate },
    };

    if (req.query.service) {
      where.service = req.query.service as Prisma.EnumApiServiceFilter;
    }
    if (req.query.endpoint) {
      where.endpoint = { contains: req.query.endpoint as string, mode: 'insensitive' };
    }
    if (req.query.job_id) {
      where.jobId = req.query.job_id as string;
    }
    if (req.query.status) {
      const status = req.query.status as string;
      if (status === 'success') {
        where.responseStatus = { lt: 400 };
      } else if (status === 'error') {
        where.responseStatus = { gte: 400 };
      }
    }

    // Slack context filters require joining through Job.
    const jobFilter: Prisma.JobWhereInput = {};
    if (req.query.slack_user_id) jobFilter.slackUserId = req.query.slack_user_id as string;
    if (req.query.slack_channel_id) jobFilter.slackChannelId = req.query.slack_channel_id as string;
    if (req.query.slack_team_id) jobFilter.slackTeamId = req.query.slack_team_id as string;
    if (Object.keys(jobFilter).length > 0) {
      where.job = { is: jobFilter };
    }

    // Sort.
    const sortParam = (req.query.sort as string) || 'created_at:desc';
    const [sortField, sortDir] = sortParam.split(':');
    const fieldMap: Record<string, string> = {
      created_at: 'createdAt',
      estimated_cost_usd: 'estimatedCostUsd',
      duration_ms: 'durationMs',
    };
    const orderBy: Prisma.ApiUsageLogOrderByWithRelationInput = {
      [fieldMap[sortField] ?? 'createdAt']: sortDir === 'asc' ? 'asc' : 'desc',
    };

    const [logs, total] = await Promise.all([
      prisma.apiUsageLog.findMany({
        where,
        orderBy,
        take: limit,
        skip: offset,
        select: {
          id: true,
          service: true,
          endpoint: true,
          responseStatus: true,
          durationMs: true,
          creditsConsumed: true,
          tokensInput: true,
          tokensOutput: true,
          estimatedCostUsd: true,
          createdAt: true,
          job: {
            select: {
              id: true,
              jobType: true,
              slackUserId: true,
              slackChannelId: true,
              slackChannelName: true,
              slackTeamId: true,
            },
          },
        },
      }),
      prisma.apiUsageLog.count({ where }),
    ]);

    res.json({ logs, total, limit, offset });
  } catch (error) {
    res.status(500).json({
      error: 'internal_error',
      message: 'An unexpected error occurred',
    });
  }
});
