/**
 * Admin error log endpoints.
 *
 * GET    /api/v1/admin/errors         - Paginated error list with filters.
 * GET    /api/v1/admin/errors/trends   - Error frequency trends.
 * GET    /api/v1/admin/errors/:id      - Error detail with stack trace.
 * PATCH  /api/v1/admin/errors/:id      - Update error lifecycle state.
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../models/index.js';
import { logAudit } from '../../lib/auditLogger.js';
import type { AuditAction } from '../../lib/auditLogger.js';

export const errorsRouter = Router();

// ---------------------------------------------------------------------------
// T017: GET /errors (list with filters)
// ---------------------------------------------------------------------------

errorsRouter.get('/', async (req: Request, res: Response) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
    const offset = Math.max(Number(req.query.offset) || 0, 0);

    const now = new Date();
    const endDate = req.query.end_date ? new Date(req.query.end_date as string) : now;
    const startDate = req.query.start_date
      ? new Date(req.query.start_date as string)
      : new Date(endDate.getTime() - 7 * 24 * 60 * 60 * 1000);
    endDate.setHours(23, 59, 59, 999);

    const where: Prisma.ErrorLogWhereInput = {
      createdAt: { gte: startDate, lte: endDate },
    };

    if (req.query.category) where.category = req.query.category as Prisma.EnumErrorCategoryFilter;
    if (req.query.service) where.service = req.query.service as string;
    if (req.query.lifecycle_state) where.lifecycleState = req.query.lifecycle_state as Prisma.EnumErrorLifecycleStateFilter;
    if (req.query.slack_team_id) where.slackTeamId = req.query.slack_team_id as string;
    if (req.query.job_id) where.jobId = req.query.job_id as string;

    const sortParam = (req.query.sort as string) || 'created_at:desc';
    const [sortField, sortDir] = sortParam.split(':');
    const fieldMap: Record<string, string> = {
      created_at: 'createdAt',
      category: 'category',
      service: 'service',
      lifecycle_state: 'lifecycleState',
    };
    const orderBy: Prisma.ErrorLogOrderByWithRelationInput = {
      [fieldMap[sortField] ?? 'createdAt']: sortDir === 'asc' ? 'asc' : 'desc',
    };

    const [errors, total] = await Promise.all([
      prisma.errorLog.findMany({
        where,
        orderBy,
        take: limit,
        skip: offset,
        select: {
          id: true,
          category: true,
          service: true,
          message: true,
          lifecycleState: true,
          jobId: true,
          slackUserId: true,
          slackChannelId: true,
          slackTeamId: true,
          createdAt: true,
          acknowledgedBy: true,
          acknowledgedAt: true,
          resolvedBy: true,
          resolvedAt: true,
        },
      }),
      prisma.errorLog.count({ where }),
    ]);

    res.json({ errors, total, limit, offset });
  } catch {
    res.status(500).json({ error: 'internal_error', message: 'An unexpected error occurred' });
  }
});

// ---------------------------------------------------------------------------
// T020: GET /errors/trends (frequency trends)
// NOTE: This route MUST be before /:id to avoid matching "trends" as an id.
// ---------------------------------------------------------------------------

errorsRouter.get('/trends', async (req: Request, res: Response) => {
  try {
    const now = new Date();
    const endDate = req.query.end_date ? new Date(req.query.end_date as string) : now;
    const startDate = req.query.start_date
      ? new Date(req.query.start_date as string)
      : new Date(endDate.getTime() - 30 * 24 * 60 * 60 * 1000);
    endDate.setHours(23, 59, 59, 999);

    const granularity = (req.query.granularity as string) || 'daily';
    const groupBy = (req.query.group_by as string) || 'category';

    const errors = await prisma.errorLog.findMany({
      where: { createdAt: { gte: startDate, lte: endDate } },
      select: {
        category: true,
        service: true,
        createdAt: true,
      },
    });

    // Group by the requested dimension and bucket by time.
    const groupMap = new Map<string, Map<string, number>>();
    for (const err of errors) {
      const group = groupBy === 'service' ? err.service : err.category;
      const period = bucketDate(err.createdAt, granularity);
      if (!groupMap.has(group)) groupMap.set(group, new Map());
      const periodMap = groupMap.get(group)!;
      periodMap.set(period, (periodMap.get(period) ?? 0) + 1);
    }

    const groups = Array.from(groupMap.entries()).map(([group, periodMap]) => ({
      group,
      data_points: Array.from(periodMap.entries())
        .map(([period, count]) => ({ period, count }))
        .sort((a, b) => a.period.localeCompare(b.period)),
    }));

    res.json({ granularity, groups });
  } catch {
    res.status(500).json({ error: 'internal_error', message: 'An unexpected error occurred' });
  }
});

// ---------------------------------------------------------------------------
// T018: GET /errors/:id (detail with stack trace)
// ---------------------------------------------------------------------------

errorsRouter.get('/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params['id'] as string;
    const errorLog = await prisma.errorLog.findUnique({
      where: { id },
      include: {
        job: {
          select: {
            id: true,
            jobType: true,
            status: true,
            sourceFileName: true,
            slackUserId: true,
            slackChannelName: true,
          },
        },
      },
    });

    if (!errorLog) {
      res.status(404).json({ error: 'not_found', message: 'Error not found' });
      return;
    }

    // Fetch admin names for acknowledged/resolved.
    let acknowledgedAdmin = null;
    let resolvedAdmin = null;
    if (errorLog.acknowledgedBy) {
      acknowledgedAdmin = await prisma.adminUser.findUnique({
        where: { id: errorLog.acknowledgedBy },
        select: { id: true, name: true },
      });
    }
    if (errorLog.resolvedBy) {
      resolvedAdmin = await prisma.adminUser.findUnique({
        where: { id: errorLog.resolvedBy },
        select: { id: true, name: true },
      });
    }

    res.json({ ...errorLog, acknowledgedAdmin, resolvedAdmin });
  } catch {
    res.status(500).json({ error: 'internal_error', message: 'An unexpected error occurred' });
  }
});

// ---------------------------------------------------------------------------
// T019: PATCH /errors/:id (lifecycle state transition)
// ---------------------------------------------------------------------------

const VALID_TRANSITIONS: Record<string, string[]> = {
  OPEN: ['ACKNOWLEDGED', 'RESOLVED'],
  ACKNOWLEDGED: ['RESOLVED', 'OPEN'],
  RESOLVED: [],
};

errorsRouter.patch('/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params['id'] as string;
    const { lifecycle_state: newState } = req.body;
    if (!newState) {
      res.status(400).json({ error: 'bad_request', message: 'lifecycle_state is required' });
      return;
    }

    const existing = await prisma.errorLog.findUnique({ where: { id } });

    if (!existing) {
      res.status(404).json({ error: 'not_found', message: 'Error not found' });
      return;
    }

    const allowed = VALID_TRANSITIONS[existing.lifecycleState] ?? [];
    if (!allowed.includes(newState)) {
      res.status(400).json({
        error: 'bad_request',
        message: `Cannot transition from ${existing.lifecycleState} to ${newState}`,
      });
      return;
    }

    const adminId = req.admin!.id;
    const updateData: Prisma.ErrorLogUncheckedUpdateInput = {
      lifecycleState: newState,
    };

    if (newState === 'ACKNOWLEDGED') {
      updateData.acknowledgedBy = adminId;
      updateData.acknowledgedAt = new Date();
    } else if (newState === 'RESOLVED') {
      updateData.resolvedBy = adminId;
      updateData.resolvedAt = new Date();
    } else if (newState === 'OPEN') {
      updateData.acknowledgedBy = null;
      updateData.acknowledgedAt = null;
    }

    const updated = await prisma.errorLog.update({
      where: { id },
      data: updateData,
    });

    // Fetch admin names for response.
    let acknowledgedAdmin = null;
    let resolvedAdmin = null;
    if (updated.acknowledgedBy) {
      acknowledgedAdmin = await prisma.adminUser.findUnique({
        where: { id: updated.acknowledgedBy },
        select: { id: true, name: true },
      });
    }
    if (updated.resolvedBy) {
      resolvedAdmin = await prisma.adminUser.findUnique({
        where: { id: updated.resolvedBy },
        select: { id: true, name: true },
      });
    }

    // Audit log.
    const auditAction = newState === 'ACKNOWLEDGED' ? 'error_acknowledged' : newState === 'RESOLVED' ? 'error_resolved' : 'error_reopened';
    logAudit({
      action: auditAction as AuditAction,
      actorUserId: adminId,
      targetType: 'error_log',
      targetId: id,
      metadata: { previousState: existing.lifecycleState, newState },
    });

    res.json({
      id: updated.id,
      lifecycle_state: updated.lifecycleState,
      acknowledged_by: acknowledgedAdmin,
      acknowledged_at: updated.acknowledgedAt,
      resolved_by: resolvedAdmin,
      resolved_at: updated.resolvedAt,
    });
  } catch {
    res.status(500).json({ error: 'internal_error', message: 'An unexpected error occurred' });
  }
});

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function bucketDate(date: Date, granularity: string): string {
  const d = new Date(date);
  switch (granularity) {
    case 'weekly': {
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
