/**
 * Client platform usage routes (T059 — Feature 39).
 *
 * GET /usage      — workspace usage dashboard
 * GET /executions — workspace execution history
 */

import { Router } from 'express';
import { prisma } from '../../models/index.js';
import type { ClientSession } from '../../lib/clientAuth.js';
import logger from '../../lib/logger.js';

export const clientPlatformUsageRouter = Router();

const log = logger.withContext({ service: 'client:platformUsage' });

/**
 * GET /usage — workspace usage dashboard.
 */
clientPlatformUsageRouter.get('/usage', async (req, res) => {
  try {
    const { slackTeamId } = req.session as unknown as ClientSession;

    // Active subscriptions
    const subscriptions = await prisma.packSubscription.findMany({
      where: { slackTeamId, status: 'ACTIVE' },
      include: {
        pack: { select: { name: true, slug: true } },
      },
    });

    // Recent executions (last 10)
    const recentExecutions = await prisma.skillExecution.findMany({
      where: { slackTeamId },
      include: {
        skill: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    // Map to pack names for execution display
    const subMap = new Map(subscriptions.map((s) => [s.id, s.pack.name]));

    res.json({
      subscriptions: subscriptions.map((s) => ({
        packName: s.pack.name,
        creditsRemaining: Math.max(0, s.creditsIncluded - s.creditsUsed),
        creditsUsed: s.creditsUsed,
        creditsIncluded: s.creditsIncluded,
        periodEnd: s.currentPeriodEnd,
      })),
      dailySpend: {
        usedUsd: 0,
        limitUsd: 0,
      },
      recentExecutions: recentExecutions.map((e) => ({
        id: e.id,
        skillName: e.skill.name,
        status: e.status,
        creditsCost: Number(e.creditsCost),
        packName: e.packSubscriptionId ? subMap.get(e.packSubscriptionId) ?? null : null,
        createdAt: e.createdAt,
      })),
    });
  } catch (err) {
    log.error('Failed to get workspace usage', { error: (err as Error).message });
    res.status(500).json({ error: 'Failed to get workspace usage' });
  }
});

/**
 * GET /executions — workspace execution history.
 */
clientPlatformUsageRouter.get('/executions', async (req, res) => {
  try {
    const { slackTeamId } = req.session as unknown as ClientSession;
    const { page = '1', limit = '20' } = req.query as Record<string, string>;

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const skip = (pageNum - 1) * limitNum;

    const where = { slackTeamId };

    const [executions, total] = await Promise.all([
      prisma.skillExecution.findMany({
        where,
        include: {
          skill: { select: { name: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limitNum,
      }),
      prisma.skillExecution.count({ where }),
    ]);

    // Map subscription IDs to pack names
    const subIds = [...new Set(executions.map((e) => e.packSubscriptionId).filter(Boolean))] as string[];
    const subs = subIds.length > 0
      ? await prisma.packSubscription.findMany({
          where: { id: { in: subIds } },
          include: { pack: { select: { name: true } } },
        })
      : [];
    const subMap = new Map(subs.map((s) => [s.id, s.pack.name]));

    res.json({
      executions: executions.map((e) => ({
        id: e.id,
        skillName: e.skill.name,
        status: e.status,
        creditsCost: Number(e.creditsCost),
        packName: e.packSubscriptionId ? subMap.get(e.packSubscriptionId) ?? null : null,
        createdAt: e.createdAt,
      })),
      total,
    });
  } catch (err) {
    log.error('Failed to get workspace executions', { error: (err as Error).message });
    res.status(500).json({ error: 'Failed to get workspace executions' });
  }
});
