/**
 * Budget threshold CRUD endpoints.
 *
 * GET    /api/v1/admin/thresholds       — List all thresholds with current month spend
 * POST   /api/v1/admin/thresholds       — Create a new threshold
 * PUT    /api/v1/admin/thresholds/:id   — Update a threshold
 * DELETE /api/v1/admin/thresholds/:id   — Delete a threshold
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../../models/index.js';
import { logAudit } from '../../lib/auditLogger.js';

export const thresholdsRouter = Router();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns current calendar month spend, optionally filtered by provider.
 */
async function getCurrentMonthSpend(providerScope?: string | null): Promise<Prisma.Decimal> {
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

  const where: Record<string, unknown> = {
    createdAt: { gte: monthStart },
  };
  if (providerScope) {
    where.service = providerScope;
  }

  const result = await prisma.apiUsageLog.aggregate({
    where,
    _sum: { estimatedCostUsd: true },
  });

  return result._sum.estimatedCostUsd ?? new Prisma.Decimal(0);
}

// ---------------------------------------------------------------------------
// GET / — List thresholds
// ---------------------------------------------------------------------------

thresholdsRouter.get('/', async (_req: Request, res: Response) => {
  try {
    const thresholds = await prisma.budgetThreshold.findMany({
      include: { creator: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'desc' },
    });

    // Compute current month spend for each threshold's scope.
    const spendCache = new Map<string, Prisma.Decimal>();

    const results = await Promise.all(
      thresholds.map(async (t) => {
        const cacheKey = t.providerScope ?? '__all__';
        if (!spendCache.has(cacheKey)) {
          spendCache.set(cacheKey, await getCurrentMonthSpend(t.providerScope));
        }
        return {
          id: t.id,
          name: t.name,
          threshold_amount_usd: t.thresholdAmountUsd.toString(),
          provider_scope: t.providerScope,
          slack_channel_id: t.slackChannelId,
          is_active: t.isActive,
          last_triggered_at: t.lastTriggeredAt,
          last_triggered_month: t.lastTriggeredMonth,
          current_month_spend_usd: spendCache.get(cacheKey)!.toString(),
          created_by: { id: t.creator.id, name: t.creator.name },
          created_at: t.createdAt,
        };
      }),
    );

    res.json({ thresholds: results });
  } catch (error) {
    res.status(500).json({
      error: 'internal_error',
      message: 'An unexpected error occurred',
    });
  }
});

// ---------------------------------------------------------------------------
// POST / — Create threshold
// ---------------------------------------------------------------------------

thresholdsRouter.post('/', async (req: Request, res: Response) => {
  try {
    const { name, threshold_amount_usd, provider_scope, slack_channel_id } = req.body;

    if (!name || threshold_amount_usd == null || !slack_channel_id) {
      res.status(400).json({
        error: 'validation_error',
        message: 'name, threshold_amount_usd, and slack_channel_id are required',
      });
      return;
    }

    const validProviders = ['BUILTWITH', 'APOLLO', 'AI_ORCHESTRATOR'];
    if (provider_scope && !validProviders.includes(provider_scope)) {
      res.status(400).json({
        error: 'validation_error',
        message: `provider_scope must be one of: ${validProviders.join(', ')}`,
      });
      return;
    }

    const adminId = req.admin!.id;

    const threshold = await prisma.budgetThreshold.create({
      data: {
        name,
        thresholdAmountUsd: new Prisma.Decimal(threshold_amount_usd),
        providerScope: provider_scope ?? null,
        slackChannelId: slack_channel_id,
        createdBy: adminId,
      },
      include: { creator: { select: { id: true, name: true } } },
    });

    await logAudit({
      action: 'threshold_created',
      actorUserId: adminId,
      actorTeamId: 'admin',
      metadata: {
        thresholdId: threshold.id,
        name: threshold.name,
        thresholdAmountUsd: threshold.thresholdAmountUsd.toString(),
        providerScope: threshold.providerScope,
      },
    });

    res.status(201).json({
      id: threshold.id,
      name: threshold.name,
      threshold_amount_usd: threshold.thresholdAmountUsd.toString(),
      provider_scope: threshold.providerScope,
      slack_channel_id: threshold.slackChannelId,
      is_active: threshold.isActive,
      created_by: { id: threshold.creator.id, name: threshold.creator.name },
      created_at: threshold.createdAt,
    });
  } catch (error) {
    res.status(500).json({
      error: 'internal_error',
      message: 'An unexpected error occurred',
    });
  }
});

// ---------------------------------------------------------------------------
// PUT /:id — Update threshold
// ---------------------------------------------------------------------------

thresholdsRouter.put('/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params['id'] as string;
    const { name, threshold_amount_usd, provider_scope, slack_channel_id, is_active } = req.body;

    const existing = await prisma.budgetThreshold.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ error: 'not_found', message: 'Threshold not found' });
      return;
    }

    const validProviders = ['BUILTWITH', 'APOLLO', 'AI_ORCHESTRATOR'];
    if (provider_scope !== undefined && provider_scope !== null && !validProviders.includes(provider_scope)) {
      res.status(400).json({
        error: 'validation_error',
        message: `provider_scope must be one of: ${validProviders.join(', ')}`,
      });
      return;
    }

    const data: Record<string, unknown> = {};
    if (name !== undefined) data.name = name;
    if (threshold_amount_usd !== undefined) data.thresholdAmountUsd = new Prisma.Decimal(threshold_amount_usd);
    if (provider_scope !== undefined) data.providerScope = provider_scope;
    if (slack_channel_id !== undefined) data.slackChannelId = slack_channel_id;
    if (is_active !== undefined) data.isActive = is_active;

    const updated = await prisma.budgetThreshold.update({
      where: { id },
      data,
      include: { creator: { select: { id: true, name: true } } },
    });

    await logAudit({
      action: 'threshold_updated',
      actorUserId: req.admin!.id,
      actorTeamId: 'admin',
      metadata: {
        thresholdId: updated.id,
        changes: req.body,
      },
    });

    res.json({
      id: updated.id,
      name: updated.name,
      threshold_amount_usd: updated.thresholdAmountUsd.toString(),
      provider_scope: updated.providerScope,
      slack_channel_id: updated.slackChannelId,
      is_active: updated.isActive,
      last_triggered_at: updated.lastTriggeredAt,
      last_triggered_month: updated.lastTriggeredMonth,
      created_by: { id: updated.creator.id, name: updated.creator.name },
      created_at: updated.createdAt,
    });
  } catch (error) {
    res.status(500).json({
      error: 'internal_error',
      message: 'An unexpected error occurred',
    });
  }
});

// ---------------------------------------------------------------------------
// DELETE /:id — Delete threshold
// ---------------------------------------------------------------------------

thresholdsRouter.delete('/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params['id'] as string;

    const existing = await prisma.budgetThreshold.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ error: 'not_found', message: 'Threshold not found' });
      return;
    }

    await prisma.budgetThreshold.delete({ where: { id } });

    res.status(204).send();
  } catch (error) {
    res.status(500).json({
      error: 'internal_error',
      message: 'An unexpected error occurred',
    });
  }
});
