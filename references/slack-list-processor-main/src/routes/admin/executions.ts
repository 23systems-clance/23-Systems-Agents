/**
 * Execution Logs & Analytics admin routes (T058 — Feature 39).
 *
 * GET /executions          — list with filters
 * GET /executions/:id      — full trace
 * GET /analytics/skills    — per-skill aggregates
 * GET /analytics/packs     — per-pack aggregates
 * GET /analytics/workspaces — per-workspace aggregates
 */

import { Router } from 'express';
import { prisma } from '../../models/index.js';
import logger from '../../lib/logger.js';

export const executionAdminRouter = Router();

const log = logger.withContext({ service: 'admin:executions' });

/**
 * GET /executions — list with filters.
 */
executionAdminRouter.get('/executions', async (req, res) => {
  try {
    const {
      skillId,
      slackTeamId,
      status,
      from,
      to,
      page = '1',
      limit = '50',
    } = req.query as Record<string, string>;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));
    const skip = (pageNum - 1) * limitNum;

    const where: Record<string, unknown> = {};
    if (skillId) where.skillId = skillId;
    if (slackTeamId) where.slackTeamId = slackTeamId;
    if (status) where.status = status;
    if (from || to) {
      where.createdAt = {
        ...(from && { gte: new Date(from) }),
        ...(to && { lte: new Date(to) }),
      };
    }

    const [executions, total] = await Promise.all([
      prisma.skillExecution.findMany({
        where,
        include: {
          skill: { select: { name: true, slug: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limitNum,
      }),
      prisma.skillExecution.count({ where }),
    ]);

    res.json({
      executions: executions.map((e) => ({
        id: e.id,
        skillName: e.skill.name,
        slackTeamId: e.slackTeamId,
        status: e.status,
        triggerType: e.triggerType,
        creditsCost: Number(e.creditsCost),
        durationMs: e.startedAt && e.completedAt
          ? new Date(e.completedAt).getTime() - new Date(e.startedAt).getTime()
          : null,
        createdAt: e.createdAt,
      })),
      total,
    });
  } catch (err) {
    log.error('Failed to list executions', { error: (err as Error).message });
    res.status(500).json({ error: 'Failed to list executions' });
  }
});

/**
 * GET /executions/:executionId — full trace.
 */
executionAdminRouter.get('/executions/:executionId', async (req, res) => {
  try {
    const execution = await prisma.skillExecution.findUnique({
      where: { id: req.params.executionId },
      include: {
        skill: { select: { name: true, slug: true } },
        agentInvocations: {
          include: {
            agentVersion: {
              include: { agent: { select: { name: true } } },
            },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!execution) {
      return res.status(404).json({ error: 'Execution not found' });
    }

    res.json({
      id: execution.id,
      skillName: execution.skill.name,
      skillId: execution.skillId,
      status: execution.status,
      triggerType: execution.triggerType,
      triggerSource: execution.triggerSource,
      input: execution.input,
      output: execution.output,
      creditsCost: Number(execution.creditsCost),
      packSubscriptionId: execution.packSubscriptionId,
      errorMessage: execution.errorMessage,
      retryCount: execution.retryCount,
      startedAt: execution.startedAt,
      completedAt: execution.completedAt,
      agentInvocations: execution.agentInvocations.map((inv) => ({
        id: inv.id,
        agentName: inv.agentVersion.agent.name,
        agentVersion: inv.agentVersion.version,
        input: inv.input,
        output: inv.output,
        tokensInput: inv.tokensInput,
        tokensOutput: inv.tokensOutput,
        costUsd: Number(inv.costUsd),
        durationMs: inv.durationMs,
        toolCallsMade: inv.toolCallsMade,
      })),
    });
  } catch (err) {
    log.error('Failed to get execution trace', { error: (err as Error).message });
    res.status(500).json({ error: 'Failed to get execution trace' });
  }
});

/**
 * GET /analytics/skills — per-skill aggregates.
 */
executionAdminRouter.get('/analytics/skills', async (req, res) => {
  try {
    const { from, to } = req.query as Record<string, string>;
    const where: Record<string, unknown> = {};
    if (from || to) {
      where.createdAt = {
        ...(from && { gte: new Date(from) }),
        ...(to && { lte: new Date(to) }),
      };
    }

    const skills = await prisma.skill.findMany({
      select: { id: true, name: true, slug: true },
      orderBy: { name: 'asc' },
    });

    const analytics = await Promise.all(
      skills.map(async (skill) => {
        const execWhere = { ...where, skillId: skill.id };

        const [total, completed, agg] = await Promise.all([
          prisma.skillExecution.count({ where: execWhere }),
          prisma.skillExecution.count({ where: { ...execWhere, status: 'COMPLETED' } }),
          prisma.skillExecution.aggregate({
            where: execWhere,
            _sum: { creditsCost: true },
            _avg: { creditsCost: true },
          }),
        ]);

        // Duration avg via raw query would be complex, approximate from agent invocations
        const invAgg = await prisma.agentInvocation.aggregate({
          where: { execution: execWhere },
          _avg: { durationMs: true },
          _sum: { costUsd: true },
        });

        return {
          skillId: skill.id,
          skillName: skill.name,
          totalExecutions: total,
          successRate: total > 0 ? completed / total : 0,
          avgDurationMs: invAgg._avg.durationMs ?? 0,
          totalCreditsConsumed: Number(agg._sum.creditsCost ?? 0),
          totalCostUsd: Number(invAgg._sum.costUsd ?? 0),
        };
      }),
    );

    res.json({ skills: analytics.filter((a) => a.totalExecutions > 0) });
  } catch (err) {
    log.error('Failed to get skill analytics', { error: (err as Error).message });
    res.status(500).json({ error: 'Failed to get skill analytics' });
  }
});

/**
 * GET /analytics/packs — per-pack aggregates.
 */
executionAdminRouter.get('/analytics/packs', async (req, res) => {
  try {
    const packs = await prisma.verticalPack.findMany({
      include: {
        subscriptions: {
          select: {
            id: true,
            status: true,
            creditsUsed: true,
            creditsIncluded: true,
          },
        },
        _count: { select: { subscriptions: true } },
      },
      orderBy: { name: 'asc' },
    });

    const analytics = packs.map((pack) => {
      const activeSubs = pack.subscriptions.filter((s) => s.status === 'ACTIVE');
      const totalCreditsUsed = pack.subscriptions.reduce((sum, s) => sum + s.creditsUsed, 0);
      const totalCreditsIncluded = activeSubs.reduce((sum, s) => sum + s.creditsIncluded, 0);
      const mrr = activeSubs.length * Number(pack.monthlyPriceUsd ?? 0);

      return {
        packId: pack.id,
        packName: pack.name,
        subscriberCount: pack._count.subscriptions,
        activeUsers: activeSubs.length,
        totalCreditsUsed,
        totalCreditsIncluded,
        overageRevenue: 0,
        churnRate: 0,
        monthlyRecurringRevenue: mrr,
      };
    });

    res.json({ packs: analytics });
  } catch (err) {
    log.error('Failed to get pack analytics', { error: (err as Error).message });
    res.status(500).json({ error: 'Failed to get pack analytics' });
  }
});

/**
 * GET /analytics/workspaces — per-workspace aggregates.
 */
executionAdminRouter.get('/analytics/workspaces', async (req, res) => {
  try {
    const workspaces = await prisma.workspaceInstallation.findMany({
      select: { slackTeamId: true, slackTeamName: true },
      orderBy: { slackTeamName: 'asc' },
    });

    const analytics = await Promise.all(
      workspaces.map(async (ws) => {
        const [activePacks, totalExec, creditsAgg] = await Promise.all([
          prisma.packSubscription.count({
            where: { slackTeamId: ws.slackTeamId, status: 'ACTIVE' },
          }),
          prisma.skillExecution.count({
            where: { slackTeamId: ws.slackTeamId },
          }),
          prisma.packSubscription.aggregate({
            where: { slackTeamId: ws.slackTeamId },
            _sum: { creditsUsed: true },
          }),
        ]);

        return {
          slackTeamId: ws.slackTeamId,
          teamName: ws.slackTeamName,
          activePacks,
          totalExecutions: totalExec,
          totalCreditsUsed: creditsAgg._sum.creditsUsed ?? 0,
          dailySpendUsedUsd: 0,
          dailySpendLimitUsd: 0,
        };
      }),
    );

    res.json({ workspaces: analytics.filter((w) => w.totalExecutions > 0 || w.activePacks > 0) });
  } catch (err) {
    log.error('Failed to get workspace analytics', { error: (err as Error).message });
    res.status(500).json({ error: 'Failed to get workspace analytics' });
  }
});
