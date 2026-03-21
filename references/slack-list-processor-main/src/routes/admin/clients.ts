/**
 * Client management endpoints.
 *
 * GET /api/v1/admin/clients          — List clients with aggregated metrics
 * GET /api/v1/admin/clients/:id      — Per-client detail
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { getClientList, getClientDetail } from '../../services/admin/clientInsights.js';

export const clientsRouter = Router();

// ---------------------------------------------------------------------------
// T023 — GET /clients (list)
// ---------------------------------------------------------------------------

clientsRouter.get('/', async (req: Request, res: Response) => {
  try {
    const now = new Date();
    const endDate = req.query.end_date
      ? new Date(req.query.end_date as string)
      : now;
    const startDate = req.query.start_date
      ? new Date(req.query.start_date as string)
      : new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000);

    endDate.setHours(23, 59, 59, 999);

    const sort = (req.query.sort as string) || 'total_cost:desc';
    const limit = Math.min(Math.max(parseInt(req.query.limit as string, 10) || 50, 1), 200);
    const offset = Math.max(parseInt(req.query.offset as string, 10) || 0, 0);

    const result = await getClientList({
      range: { startDate, endDate },
      sort,
      limit,
      offset,
    });

    res.json({
      clients: result.clients.map((c) => ({
        slack_team_id: c.slackTeamId,
        slack_team_name: c.slackTeamName,
        total_jobs: c.totalJobs,
        total_api_calls: c.totalApiCalls,
        total_cost_usd: c.totalCostUsd,
        error_rate_percent: c.errorRatePercent,
        last_active_at: c.lastActiveAt,
      })),
      total: result.total,
      limit,
      offset,
    });
  } catch (error) {
    res.status(500).json({
      error: 'internal_error',
      message: 'An unexpected error occurred',
    });
  }
});

// ---------------------------------------------------------------------------
// T024 — GET /clients/:slack_team_id (detail)
// ---------------------------------------------------------------------------

clientsRouter.get('/:slack_team_id', async (req: Request, res: Response) => {
  try {
    const slackTeamId = req.params['slack_team_id'] as string;

    const now = new Date();
    const endDate = req.query.end_date
      ? new Date(req.query.end_date as string)
      : now;
    const startDate = req.query.start_date
      ? new Date(req.query.start_date as string)
      : new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000);

    endDate.setHours(23, 59, 59, 999);

    const detail = await getClientDetail(slackTeamId, { startDate, endDate });

    if (!detail) {
      res.status(404).json({
        error: 'not_found',
        message: `No data found for workspace ${slackTeamId}`,
      });
      return;
    }

    res.json({
      slack_team_id: detail.slackTeamId,
      slack_team_name: detail.slackTeamName,
      summary: {
        total_jobs: detail.summary.totalJobs,
        total_api_calls: detail.summary.totalApiCalls,
        total_cost_usd: detail.summary.totalCostUsd,
        error_rate_percent: detail.summary.errorRatePercent,
        last_active_at: detail.summary.lastActiveAt,
      },
      cost_by_provider: detail.costByProvider.map((p) => ({
        service: p.service,
        cost_usd: p.costUsd,
      })),
      top_users: detail.topUsers.map((u) => ({
        slack_user_id: u.slackUserId,
        display_name: u.displayName,
        total_jobs: u.totalJobs,
        total_cost_usd: u.totalCostUsd,
      })),
      recent_jobs: detail.recentJobs.map((j) => ({
        id: j.id,
        job_type: j.jobType,
        status: j.status,
        source_file_name: j.sourceFileName,
        source_row_count: j.sourceRowCount,
        purpose: j.purpose,
        is_cosell: j.isCosell,
        cosell_provider: j.cosellProvider,
        list_owner: j.listOwner,
        created_at: j.createdAt,
      })),
    });
  } catch (error) {
    res.status(500).json({
      error: 'internal_error',
      message: 'An unexpected error occurred',
    });
  }
});
