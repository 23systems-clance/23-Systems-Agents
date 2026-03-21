/**
 * Autonomous agent management REST API routes (Feature 31).
 *
 * Provides audit trail, agent management, system events, and dashboard
 * aggregation endpoints for the admin dashboard.
 *
 * GET  /audit                          - Query audit action trail
 * GET  /agents                         - List autonomous agents
 * GET  /agents/:agentId                - Get agent detail with stats
 * PUT  /agents/:agentId/mode           - Toggle suggest-only / auto-execute
 * POST /agents/:agentId/approve/:auditActionId - Approve a pending action
 * POST /agents/:agentId/reject/:auditActionId  - Reject a pending action
 * GET  /events                         - Query system events
 * GET  /dashboard                      - Dashboard aggregation
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { prisma } from '../../models/index.js';
import logger from '../../lib/logger.js';
import type { Prisma, Severity, AuditOutcome } from '@prisma/client';

const log = logger.withContext({ service: 'autonomousApi' });

export const autonomousRouter = Router();

// ---------------------------------------------------------------------------
// Severity / outcome helpers
// ---------------------------------------------------------------------------

/** Map lowercase query param to Prisma Severity enum value. */
function parseSeverity(raw: string | undefined): Severity | undefined {
  if (!raw) return undefined;
  const map: Record<string, Severity> = {
    info: 'INFO',
    warning: 'WARNING',
    high: 'HIGH',
    critical: 'CRITICAL',
  };
  return map[raw.toLowerCase()];
}

/** Map lowercase query param to Prisma AuditOutcome enum value. */
function parseOutcome(raw: string | undefined): AuditOutcome | undefined {
  if (!raw) return undefined;
  const map: Record<string, AuditOutcome> = {
    auto_executed: 'AUTO_EXECUTED',
    suggested: 'SUGGESTED',
    approved: 'APPROVED',
    rejected: 'REJECTED',
    escalated: 'ESCALATED',
  };
  return map[raw.toLowerCase()];
}

/** Clamp a numeric query param between min and max with a default. */
function clampInt(raw: unknown, defaultVal: number, min: number, max: number): number {
  const n = Number(raw);
  if (isNaN(n)) return defaultVal;
  return Math.min(Math.max(Math.round(n), min), max);
}

// ---------------------------------------------------------------------------
// T060: GET /audit — Query audit action trail
// ---------------------------------------------------------------------------

autonomousRouter.get('/audit', async (req: Request, res: Response) => {
  try {
    const page = clampInt(req.query.page, 1, 1, 10000);
    const limit = clampInt(req.query.limit, 25, 1, 100);
    const skip = (page - 1) * limit;

    const where: Prisma.AuditActionWhereInput = {};

    // Optional filters.
    if (req.query.agentName) {
      where.agentName = {
        contains: req.query.agentName as string,
        mode: 'insensitive',
      };
    }

    const severity = parseSeverity(req.query.severity as string | undefined);
    if (severity) {
      where.severity = severity;
    }

    const outcome = parseOutcome(req.query.outcome as string | undefined);
    if (outcome) {
      where.outcome = outcome;
    }

    // Date range on timestamp field.
    if (req.query.startDate || req.query.endDate) {
      where.timestamp = {};
      if (req.query.startDate) {
        (where.timestamp as Prisma.DateTimeFilter).gte = new Date(req.query.startDate as string);
      }
      if (req.query.endDate) {
        (where.timestamp as Prisma.DateTimeFilter).lte = new Date(req.query.endDate as string);
      }
    }

    const [auditActions, totalItems] = await Promise.all([
      prisma.auditAction.findMany({
        where,
        orderBy: { timestamp: 'desc' },
        skip,
        take: limit,
      }),
      prisma.auditAction.count({ where }),
    ]);

    res.json({
      auditActions,
      pagination: {
        page,
        limit,
        totalItems,
        totalPages: Math.ceil(totalItems / limit),
      },
    });
  } catch (err) {
    log.error('Failed to query audit trail', { error: err });
    res.status(500).json({ error: 'internal_error', message: 'Failed to query audit trail' });
  }
});

// ---------------------------------------------------------------------------
// T061: GET /agents — List autonomous agents
// ---------------------------------------------------------------------------

autonomousRouter.get('/agents', async (req: Request, res: Response) => {
  try {
    const statusFilter = req.query.status as string | undefined;
    const modeFilter = req.query.mode as string | undefined;

    const where: Prisma.AgentWhereInput = {};

    if (statusFilter) {
      where.status = statusFilter.toUpperCase() as Prisma.EnumAgentStatusFilter;
    }

    if (modeFilter) {
      where.suggestOnlyMode = modeFilter === 'suggest_only';
    }

    const agents = await prisma.agent.findMany({
      where,
      include: {
        skills: {
          select: { id: true, name: true, status: true },
        },
        _count: {
          select: {
            teamAgents: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // For each agent, count pending audit actions and total executions.
    const agentResponses = await Promise.all(
      agents.map(async (agent) => {
        const [pendingActions, totalExecutions, successfulExecutions] = await Promise.all([
          prisma.auditAction.count({
            where: { agentName: agent.name, outcome: 'SUGGESTED' },
          }),
          prisma.skillExecution.count({
            where: { skill: { agentId: agent.id } },
          }),
          prisma.skillExecution.count({
            where: { skill: { agentId: agent.id }, status: 'COMPLETED' },
          }),
        ]);

        return {
          id: agent.id,
          name: agent.name,
          slug: agent.slug,
          description: agent.description,
          status: agent.status,
          mode: agent.suggestOnlyMode ? 'suggest_only' : 'auto_execute',
          skills: agent.skills,
          pendingActions,
          totalExecutions,
          successRate: totalExecutions > 0
            ? Math.round((successfulExecutions / totalExecutions) * 100)
            : 0,
          lastRunAt: agent.lastRunAt,
          actionsToday: agent.actionsToday,
          createdAt: agent.createdAt,
          updatedAt: agent.updatedAt,
        };
      }),
    );

    res.json({
      agents: agentResponses,
      totalAgents: agentResponses.length,
    });
  } catch (err) {
    log.error('Failed to list autonomous agents', { error: err });
    res.status(500).json({ error: 'internal_error', message: 'Failed to list agents' });
  }
});

// ---------------------------------------------------------------------------
// T061: GET /agents/:agentId — Get agent detail with stats
// ---------------------------------------------------------------------------

autonomousRouter.get('/agents/:agentId', async (req: Request, res: Response) => {
  try {
    const agentId = req.params.agentId as string;

    const agent = await prisma.agent.findUnique({
      where: { id: agentId },
      include: {
        skills: {
          select: {
            id: true,
            name: true,
            slug: true,
            status: true,
            triggerType: true,
            chainEventName: true,
          },
        },
        teamAgents: {
          include: {
            team: { select: { id: true, name: true, slug: true } },
          },
        },
      },
    });

    if (!agent) {
      res.status(404).json({ error: 'not_found', message: 'Agent not found' });
      return;
    }

    // Fetch recent executions, pending actions, and stats in parallel.
    const now = new Date();
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const [
      recentExecutions,
      pendingActions,
      totalExecutions,
      successfulExecutions,
      failedExecutions,
      last24hExecutions,
      avgDuration,
    ] = await Promise.all([
      prisma.skillExecution.findMany({
        where: { skill: { agentId } },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: {
          id: true,
          status: true,
          input: true,
          output: true,
          createdAt: true,
          completedAt: true,
          startedAt: true,
          skill: { select: { name: true } },
        },
      }),
      prisma.auditAction.findMany({
        where: { agentName: agent.name, outcome: 'SUGGESTED' },
        orderBy: { timestamp: 'desc' },
        take: 20,
      }),
      prisma.skillExecution.count({
        where: { skill: { agentId } },
      }),
      prisma.skillExecution.count({
        where: { skill: { agentId }, status: 'COMPLETED' },
      }),
      prisma.skillExecution.count({
        where: { skill: { agentId }, status: 'FAILED' },
      }),
      prisma.skillExecution.count({
        where: { skill: { agentId }, createdAt: { gte: twentyFourHoursAgo } },
      }),
      prisma.skillExecution.aggregate({
        where: { skill: { agentId }, completedAt: { not: null }, startedAt: { not: null } },
        _avg: { creditsCost: true },
      }),
    ]);

    // Compute average execution duration from recent executions.
    const completedExecs = recentExecutions.filter((e) => e.startedAt && e.completedAt);
    let avgExecutionMs = 0;
    if (completedExecs.length > 0) {
      const totalMs = completedExecs.reduce((sum, e) => {
        return sum + (new Date(e.completedAt!).getTime() - new Date(e.startedAt!).getTime());
      }, 0);
      avgExecutionMs = Math.round(totalMs / completedExecs.length);
    }

    res.json({
      id: agent.id,
      name: agent.name,
      slug: agent.slug,
      description: agent.description,
      status: agent.status,
      mode: agent.suggestOnlyMode ? 'suggest_only' : 'auto_execute',
      skills: agent.skills,
      teams: agent.teamAgents.map((ta) => ta.team),
      recentExecutions,
      pendingActions,
      stats: {
        totalExecutions,
        successfulExecutions,
        failedExecutions,
        successRate: totalExecutions > 0
          ? Math.round((successfulExecutions / totalExecutions) * 100)
          : 0,
        avgExecutionMs,
        last24hExecutions,
      },
      lastRunAt: agent.lastRunAt,
      actionsToday: agent.actionsToday,
      suggestOnlyApprovals: agent.suggestOnlyApprovals,
      suggestOnlyRejections: agent.suggestOnlyRejections,
      createdAt: agent.createdAt,
      updatedAt: agent.updatedAt,
    });
  } catch (err) {
    log.error('Failed to get agent detail', { error: err, agentId: req.params.agentId });
    res.status(500).json({ error: 'internal_error', message: 'Failed to get agent detail' });
  }
});

// ---------------------------------------------------------------------------
// T061: PUT /agents/:agentId/mode — Toggle suggest-only / auto-execute
// ---------------------------------------------------------------------------

autonomousRouter.put('/agents/:agentId/mode', async (req: Request, res: Response) => {
  try {
    const agentId = req.params.agentId as string;
    const { mode } = req.body as { mode?: string };

    if (!mode || !['suggest_only', 'auto_execute'].includes(mode)) {
      res.status(400).json({
        error: 'invalid_mode',
        message: 'mode must be "suggest_only" or "auto_execute"',
      });
      return;
    }

    const agent = await prisma.agent.findUnique({
      where: { id: agentId },
      select: { id: true, name: true, suggestOnlyMode: true },
    });

    if (!agent) {
      res.status(404).json({ error: 'not_found', message: 'Agent not found' });
      return;
    }

    const previousMode = agent.suggestOnlyMode ? 'suggest_only' : 'auto_execute';
    const newSuggestOnly = mode === 'suggest_only';

    // Update agent mode.
    await prisma.agent.update({
      where: { id: agentId },
      data: { suggestOnlyMode: newSuggestOnly },
    });

    // Record audit action for mode change.
    const adminUserId = (req as any).adminUser?.id ?? null;
    await prisma.auditAction.create({
      data: {
        agentName: agent.name,
        action: `mode_changed:${previousMode}->${mode}`,
        confidence: 1.0,
        severity: 'INFO',
        metadata: { previousMode, newMode: mode, changedBy: adminUserId },
        outcome: 'AUTO_EXECUTED',
        adminUserId,
      },
    });

    log.info('Agent mode changed', { agentId, previousMode, newMode: mode });

    res.json({
      success: true,
      message: `Agent mode changed from ${previousMode} to ${mode}`,
      previousMode,
      newMode: mode,
    });
  } catch (err) {
    log.error('Failed to update agent mode', { error: err, agentId: req.params.agentId });
    res.status(500).json({ error: 'internal_error', message: 'Failed to update agent mode' });
  }
});

// ---------------------------------------------------------------------------
// T061: POST /agents/:agentId/approve/:auditActionId — Approve a pending action
// ---------------------------------------------------------------------------

autonomousRouter.post('/agents/:agentId/approve/:auditActionId', async (req: Request, res: Response) => {
  try {
    const agentId = req.params.agentId as string;
    const auditActionId = req.params.auditActionId as string;
    const { comment } = req.body as { comment?: string };

    const agent = await prisma.agent.findUnique({
      where: { id: agentId },
      select: { id: true, name: true, suggestOnlyApprovals: true },
    });

    if (!agent) {
      res.status(404).json({ error: 'not_found', message: 'Agent not found' });
      return;
    }

    const auditAction = await prisma.auditAction.findUnique({
      where: { id: auditActionId },
    });

    if (!auditAction) {
      res.status(404).json({ error: 'not_found', message: 'Audit action not found' });
      return;
    }

    // Verify the action belongs to this agent.
    if (auditAction.agentName !== agent.name) {
      res.status(400).json({
        error: 'mismatch',
        message: 'Audit action does not belong to this agent',
      });
      return;
    }

    // Verify it is pending (SUGGESTED).
    if (auditAction.outcome !== 'SUGGESTED') {
      res.status(400).json({
        error: 'invalid_state',
        message: `Action is in ${auditAction.outcome} state and cannot be approved`,
      });
      return;
    }

    const adminUserId = (req as any).adminUser?.id ?? null;

    const updated = await prisma.auditAction.update({
      where: { id: auditActionId },
      data: {
        outcome: 'APPROVED',
        adminUserId,
        metadata: {
          ...(auditAction.metadata as Record<string, unknown> ?? {}),
          ...(comment ? { approvalComment: comment } : {}),
          approvedAt: new Date().toISOString(),
        },
      },
    });

    // Increment agent approval counter.
    await prisma.agent.update({
      where: { id: agentId },
      data: { suggestOnlyApprovals: { increment: 1 } },
    });

    log.info('Audit action approved', { agentId, auditActionId, adminUserId });

    res.json({
      id: updated.id,
      outcome: updated.outcome,
      agentName: updated.agentName,
      action: updated.action,
      message: 'Action approved successfully',
    });
  } catch (err) {
    log.error('Failed to approve audit action', {
      error: err,
      agentId: req.params.agentId,
      auditActionId: req.params.auditActionId,
    });
    res.status(500).json({ error: 'internal_error', message: 'Failed to approve action' });
  }
});

// ---------------------------------------------------------------------------
// T061: POST /agents/:agentId/reject/:auditActionId — Reject a pending action
// ---------------------------------------------------------------------------

autonomousRouter.post('/agents/:agentId/reject/:auditActionId', async (req: Request, res: Response) => {
  try {
    const agentId = req.params.agentId as string;
    const auditActionId = req.params.auditActionId as string;
    const { reason } = req.body as { reason?: string };

    const agent = await prisma.agent.findUnique({
      where: { id: agentId },
      select: { id: true, name: true, suggestOnlyRejections: true },
    });

    if (!agent) {
      res.status(404).json({ error: 'not_found', message: 'Agent not found' });
      return;
    }

    const auditAction = await prisma.auditAction.findUnique({
      where: { id: auditActionId },
    });

    if (!auditAction) {
      res.status(404).json({ error: 'not_found', message: 'Audit action not found' });
      return;
    }

    // Verify the action belongs to this agent.
    if (auditAction.agentName !== agent.name) {
      res.status(400).json({
        error: 'mismatch',
        message: 'Audit action does not belong to this agent',
      });
      return;
    }

    // Verify it is pending (SUGGESTED).
    if (auditAction.outcome !== 'SUGGESTED') {
      res.status(400).json({
        error: 'invalid_state',
        message: `Action is in ${auditAction.outcome} state and cannot be rejected`,
      });
      return;
    }

    const adminUserId = (req as any).adminUser?.id ?? null;

    const updated = await prisma.auditAction.update({
      where: { id: auditActionId },
      data: {
        outcome: 'REJECTED',
        adminUserId,
        metadata: {
          ...(auditAction.metadata as Record<string, unknown> ?? {}),
          ...(reason ? { rejectionReason: reason } : {}),
          rejectedAt: new Date().toISOString(),
        },
      },
    });

    // Increment agent rejection counter.
    await prisma.agent.update({
      where: { id: agentId },
      data: { suggestOnlyRejections: { increment: 1 } },
    });

    log.info('Audit action rejected', { agentId, auditActionId, adminUserId });

    res.json({
      id: updated.id,
      outcome: updated.outcome,
      agentName: updated.agentName,
      action: updated.action,
      message: 'Action rejected successfully',
    });
  } catch (err) {
    log.error('Failed to reject audit action', {
      error: err,
      agentId: req.params.agentId,
      auditActionId: req.params.auditActionId,
    });
    res.status(500).json({ error: 'internal_error', message: 'Failed to reject action' });
  }
});

// ---------------------------------------------------------------------------
// T063: GET /events — Query system events
// ---------------------------------------------------------------------------

autonomousRouter.get('/events', async (req: Request, res: Response) => {
  try {
    const page = clampInt(req.query.page, 1, 1, 10000);
    const limit = clampInt(req.query.limit, 25, 1, 100);
    const skip = (page - 1) * limit;

    const where: Prisma.SystemEventWhereInput = {};

    if (req.query.type) {
      where.type = req.query.type as string;
    }

    // Severity mapping: info->INFO, warning->WARNING, error->HIGH, critical->CRITICAL.
    const severityParam = req.query.severity as string | undefined;
    if (severityParam) {
      const sevMap: Record<string, Severity> = {
        info: 'INFO',
        warning: 'WARNING',
        error: 'HIGH',
        critical: 'CRITICAL',
      };
      const mapped = sevMap[severityParam.toLowerCase()];
      if (mapped) {
        where.severity = mapped;
      }
    }

    // Date range on timestamp field.
    if (req.query.startDate || req.query.endDate) {
      where.timestamp = {};
      if (req.query.startDate) {
        (where.timestamp as Prisma.DateTimeFilter).gte = new Date(req.query.startDate as string);
      }
      if (req.query.endDate) {
        (where.timestamp as Prisma.DateTimeFilter).lte = new Date(req.query.endDate as string);
      }
    }

    const [events, totalItems] = await Promise.all([
      prisma.systemEvent.findMany({
        where,
        orderBy: { timestamp: 'desc' },
        skip,
        take: limit,
      }),
      prisma.systemEvent.count({ where }),
    ]);

    res.json({
      events,
      pagination: {
        page,
        limit,
        totalItems,
        totalPages: Math.ceil(totalItems / limit),
      },
    });
  } catch (err) {
    log.error('Failed to query system events', { error: err });
    res.status(500).json({ error: 'internal_error', message: 'Failed to query system events' });
  }
});

// ---------------------------------------------------------------------------
// T064: GET /dashboard — Dashboard aggregation
// ---------------------------------------------------------------------------

autonomousRouter.get('/dashboard', async (req: Request, res: Response) => {
  try {
    const now = new Date();
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const [
      totalAgents,
      publishedAgents,
      draftAgents,
      deprecatedAgents,
      suggestOnlyAgents,
      autoExecuteAgents,
      pendingActions,
      actionsLast24h,
      autoExecutedLast24h,
      recentActions,
      recentAlerts,
      teamsSummary,
    ] = await Promise.all([
      // Agent counts.
      prisma.agent.count(),
      prisma.agent.count({ where: { status: 'PUBLISHED' } }),
      prisma.agent.count({ where: { status: 'DRAFT' } }),
      prisma.agent.count({ where: { status: 'DEPRECATED' } }),
      prisma.agent.count({ where: { suggestOnlyMode: true } }),
      prisma.agent.count({ where: { suggestOnlyMode: false } }),

      // Pending audit actions.
      prisma.auditAction.count({ where: { outcome: 'SUGGESTED' } }),

      // Actions in last 24h.
      prisma.auditAction.count({
        where: { timestamp: { gte: twentyFourHoursAgo } },
      }),

      // Auto-executed in last 24h.
      prisma.auditAction.count({
        where: {
          outcome: 'AUTO_EXECUTED',
          timestamp: { gte: twentyFourHoursAgo },
        },
      }),

      // Recent actions (last 10).
      prisma.auditAction.findMany({
        orderBy: { timestamp: 'desc' },
        take: 10,
      }),

      // Recent alerts (severity WARNING or higher, last 5).
      prisma.systemEvent.findMany({
        where: {
          severity: { in: ['WARNING', 'HIGH', 'CRITICAL'] },
        },
        orderBy: { timestamp: 'desc' },
        take: 5,
      }),

      // Teams summary.
      prisma.team.findMany({
        include: {
          _count: { select: { teamAgents: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    res.json({
      agents: {
        total: totalAgents,
        published: publishedAgents,
        draft: draftAgents,
        deprecated: deprecatedAgents,
        suggestOnly: suggestOnlyAgents,
        autoExecute: autoExecuteAgents,
      },
      actions: {
        pending: pendingActions,
        last24h: actionsLast24h,
        autoExecutedLast24h,
      },
      recentActions,
      recentAlerts,
      teams: teamsSummary.map((t) => ({
        id: t.id,
        name: t.name,
        slug: t.slug,
        status: t.status,
        agentCount: t._count.teamAgents,
      })),
    });
  } catch (err) {
    log.error('Failed to aggregate dashboard data', { error: err });
    res.status(500).json({ error: 'internal_error', message: 'Failed to aggregate dashboard data' });
  }
});
