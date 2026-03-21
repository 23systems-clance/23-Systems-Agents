/**
 * Admin API routes for managing provider enrichment costs.
 *
 * CRUD operations on the ProviderCost table, allowing admins to view
 * and update per-provider pricing without code deployment.
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { prisma } from '../../models/index.js';
import { logAudit } from '../../lib/auditLogger.js';
import logger from '../../lib/logger.js';

export const providerCostsRouter = Router();

/**
 * GET /api/v1/admin/provider-costs
 * List all current (non-expired) provider costs.
 */
providerCostsRouter.get('/', async (req: Request, res: Response) => {
  try {
    const includeExpired = req.query.includeExpired === 'true';

    const where = includeExpired ? {} : { expiresAt: null };

    const costs = await prisma.providerCost.findMany({
      where,
      orderBy: [{ provider: 'asc' }, { dataType: 'asc' }, { effectiveDate: 'desc' }],
    });

    res.json({ costs, total: costs.length });
  } catch (error) {
    logger.error('Failed to fetch provider costs', { error });
    res.status(500).json({ error: 'internal_error' });
  }
});

/**
 * POST /api/v1/admin/provider-costs
 * Create a new provider cost entry.
 */
providerCostsRouter.post('/', async (req: Request, res: Response) => {
  try {
    const { provider, dataType, costPerUnit, creditsPerUnit, notes } = req.body;

    if (!provider || !dataType || costPerUnit == null) {
      res.status(400).json({
        error: 'validation_error',
        message: 'provider, dataType, and costPerUnit are required',
      });
      return;
    }

    if (costPerUnit < 0) {
      res.status(400).json({
        error: 'validation_error',
        message: 'costPerUnit must be non-negative',
      });
      return;
    }

    // Expire any existing current pricing for this provider+dataType
    await prisma.providerCost.updateMany({
      where: { provider, dataType, expiresAt: null },
      data: { expiresAt: new Date() },
    });

    const created = await prisma.providerCost.create({
      data: {
        provider,
        dataType,
        costPerUnit: parseFloat(costPerUnit),
        creditsPerUnit: creditsPerUnit ? parseInt(creditsPerUnit, 10) : null,
        notes: notes || null,
      },
    });

    await logAudit({
      action: 'provider_cost_created',
      actorUserId: req.admin!.id,
      targetType: 'provider_cost',
      targetId: created.id,
      metadata: { provider, dataType, costPerUnit: created.costPerUnit },
    });

    logger.info('Provider cost created', {
      id: created.id,
      provider,
      dataType,
      costPerUnit: created.costPerUnit,
    });

    res.json(created);
  } catch (error) {
    logger.error('Failed to create provider cost', { error });
    res.status(500).json({ error: 'internal_error' });
  }
});

/**
 * PUT /api/v1/admin/provider-costs/:id
 * Update an existing provider cost entry.
 */
providerCostsRouter.put('/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const { costPerUnit, creditsPerUnit, notes } = req.body;

    const existing = await prisma.providerCost.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ error: 'not_found', message: 'Provider cost not found' });
      return;
    }

    if (costPerUnit != null && costPerUnit < 0) {
      res.status(400).json({
        error: 'validation_error',
        message: 'costPerUnit must be non-negative',
      });
      return;
    }

    const updated = await prisma.providerCost.update({
      where: { id },
      data: {
        ...(costPerUnit != null && { costPerUnit: parseFloat(costPerUnit) }),
        ...(creditsPerUnit !== undefined && {
          creditsPerUnit: creditsPerUnit ? parseInt(creditsPerUnit, 10) : null,
        }),
        ...(notes !== undefined && { notes: notes || null }),
      },
    });

    await logAudit({
      action: 'provider_cost_updated',
      actorUserId: req.admin!.id,
      targetType: 'provider_cost',
      targetId: updated.id,
      metadata: {
        provider: updated.provider,
        dataType: updated.dataType,
        costPerUnit: updated.costPerUnit,
        previousCostPerUnit: existing.costPerUnit,
      },
    });

    logger.info('Provider cost updated', {
      id: updated.id,
      provider: updated.provider,
      dataType: updated.dataType,
      costPerUnit: updated.costPerUnit,
    });

    res.json(updated);
  } catch (error) {
    logger.error('Failed to update provider cost', { error });
    res.status(500).json({ error: 'internal_error' });
  }
});

/**
 * DELETE /api/v1/admin/provider-costs/:id
 * Expire (soft-delete) a provider cost entry.
 */
providerCostsRouter.delete('/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;

    const existing = await prisma.providerCost.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ error: 'not_found', message: 'Provider cost not found' });
      return;
    }

    // Soft-delete by setting expiresAt
    const expired = await prisma.providerCost.update({
      where: { id },
      data: { expiresAt: new Date() },
    });

    await logAudit({
      action: 'provider_cost_deleted',
      actorUserId: req.admin!.id,
      targetType: 'provider_cost',
      targetId: id,
      metadata: { provider: existing.provider, dataType: existing.dataType },
    });

    logger.info('Provider cost expired', {
      id,
      provider: existing.provider,
      dataType: existing.dataType,
    });

    res.json({ success: true, expired });
  } catch (error) {
    logger.error('Failed to delete provider cost', { error });
    res.status(500).json({ error: 'internal_error' });
  }
});
