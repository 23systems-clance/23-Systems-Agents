/**
 * Admin credit rates routes.
 *
 * GET/PUT active credit rate configuration and preview
 * effective costs with hypothetical changes.
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { prisma } from '../../models/index.js';
import { computeEffectiveCosts } from '../../services/billing/creditRateCalculator.js';
import { logAudit } from '../../lib/auditLogger.js';
import logger from '../../lib/logger.js';

export const creditRatesRouter = Router();

/**
 * GET /api/v1/admin/credit-rates
 * Return active CreditRateConfig with computed effectiveCosts.
 */
creditRatesRouter.get('/', async (req: Request, res: Response) => {
  try {
    const config = await prisma.creditRateConfig.findFirst({
      where: { isActive: true },
      orderBy: { createdAt: 'desc' },
    });

    if (!config) {
      res.status(404).json({ error: 'not_found', message: 'No active credit rate configuration found' });
      return;
    }

    res.json({
      ...config,
      effectiveCosts: computeEffectiveCosts(config),
    });
  } catch (error) {
    logger.error('Failed to get credit rates', { error });
    res.status(500).json({ error: 'internal_error', message: 'An unexpected error occurred' });
  }
});

/**
 * PUT /api/v1/admin/credit-rates
 * Update active config (partial update). Recomputes effectiveCosts.
 */
creditRatesRouter.put('/', async (req: Request, res: Response) => {
  try {
    const config = await prisma.creditRateConfig.findFirst({
      where: { isActive: true },
      orderBy: { createdAt: 'desc' },
    });

    if (!config) {
      res.status(404).json({ error: 'not_found', message: 'No active credit rate configuration found' });
      return;
    }

    const allowedFields = [
      'builtWithCtuLookupCost', 'builtWithDomainLookupCost',
      'apolloPeopleSearchCost', 'apolloBulkEnrichCost', 'markupPercent',
    ];

    const data: Record<string, any> = {};
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        data[field] = req.body[field];
      }
    }

    if (Object.keys(data).length === 0) {
      res.status(400).json({ error: 'validation_error', message: 'No valid fields to update' });
      return;
    }

    data.updatedByAdminId = req.admin!.id;

    const updated = await prisma.creditRateConfig.update({
      where: { id: config.id },
      data,
    });

    logAudit({
      action: 'credit_rates_updated',
      actorUserId: req.admin!.id,
      targetType: 'credit_rate_config',
      targetId: updated.id,
      metadata: { updatedFields: Object.keys(data).filter((k) => k !== 'updatedByAdminId') },
    });

    res.json({
      ...updated,
      effectiveCosts: computeEffectiveCosts(updated),
    });
  } catch (error) {
    logger.error('Failed to update credit rates', { error });
    res.status(500).json({ error: 'internal_error', message: 'An unexpected error occurred' });
  }
});

/**
 * GET /api/v1/admin/credit-rates/preview
 * Preview effective costs with hypothetical changes without saving.
 */
creditRatesRouter.get('/preview', async (req: Request, res: Response) => {
  try {
    const config = await prisma.creditRateConfig.findFirst({
      where: { isActive: true },
      orderBy: { createdAt: 'desc' },
    });

    if (!config) {
      res.status(404).json({ error: 'not_found', message: 'No active credit rate configuration found' });
      return;
    }

    // Build a hypothetical config with overrides from query params
    const hypothetical = { ...config };
    const numParam = (key: string) => {
      const val = req.query[key];
      return val !== undefined ? parseInt(val as string, 10) : undefined;
    };

    const overrides: Record<string, number | undefined> = {
      builtWithCtuLookupCost: numParam('builtWithCtuLookupCost'),
      builtWithDomainLookupCost: numParam('builtWithDomainLookupCost'),
      apolloPeopleSearchCost: numParam('apolloPeopleSearchCost'),
      apolloBulkEnrichCost: numParam('apolloBulkEnrichCost'),
      markupPercent: numParam('markupPercent'),
    };

    for (const [key, val] of Object.entries(overrides)) {
      if (val !== undefined && !isNaN(val)) {
        (hypothetical as any)[key] = val;
      }
    }

    res.json({
      current: computeEffectiveCosts(config),
      preview: computeEffectiveCosts(hypothetical),
    });
  } catch (error) {
    logger.error('Failed to preview credit rates', { error });
    res.status(500).json({ error: 'internal_error', message: 'An unexpected error occurred' });
  }
});
