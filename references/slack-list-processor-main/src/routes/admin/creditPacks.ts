/**
 * Credit pack management admin API routes (T029).
 *
 * Platform owner endpoints for CRUD operations on credit packs
 * and Stripe Checkout session creation for purchases.
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { prisma } from '../../models/index.js';
import { createCreditPackCheckout } from '../../services/billing/creditPackService.js';
import logger from '../../lib/logger.js';

export const creditPackRouter = Router();

/**
 * GET /api/v1/admin/credit-packs
 * Lists all credit packs. Optional ?activeOnly=true filter.
 */
creditPackRouter.get('/', async (req: Request, res: Response) => {
  const activeOnly = req.query.activeOnly === 'true';
  const packs = await prisma.creditPack.findMany({
    where: activeOnly ? { active: true } : undefined,
    orderBy: { sortOrder: 'asc' },
  });
  res.json({ packs });
});

/**
 * POST /api/v1/admin/credit-packs
 * Creates a new credit pack.
 */
creditPackRouter.post('/', async (req: Request, res: Response) => {
  const { name, creditAmount, priceUsd, sortOrder } = req.body;

  if (!name || !creditAmount || !priceUsd) {
    res.status(400).json({ error: 'name, creditAmount, and priceUsd are required' });
    return;
  }

  const pack = await prisma.creditPack.create({
    data: {
      name,
      creditAmount: Number(creditAmount),
      priceUsd: Number(priceUsd),
      sortOrder: sortOrder ?? 0,
    },
  });

  logger.info('Credit pack created', { packId: pack.id, name });
  res.status(201).json(pack);
});

/**
 * PATCH /api/v1/admin/credit-packs/:id
 * Updates a credit pack.
 */
creditPackRouter.patch('/:id', async (req: Request, res: Response) => {
  const id = req.params.id as string;
  const { name, creditAmount, priceUsd, active, sortOrder } = req.body;

  const pack = await prisma.creditPack.update({
    where: { id },
    data: {
      ...(name !== undefined && { name }),
      ...(creditAmount !== undefined && { creditAmount: Number(creditAmount) }),
      ...(priceUsd !== undefined && { priceUsd: Number(priceUsd) }),
      ...(active !== undefined && { active }),
      ...(sortOrder !== undefined && { sortOrder }),
    },
  });

  logger.info('Credit pack updated', { packId: id });
  res.json(pack);
});

/**
 * DELETE /api/v1/admin/credit-packs/:id
 * Soft-deletes (deactivates) a credit pack.
 */
creditPackRouter.delete('/:id', async (req: Request, res: Response) => {
  const id = req.params.id as string;

  await prisma.creditPack.update({
    where: { id },
    data: { active: false },
  });

  logger.info('Credit pack deactivated', { packId: id });
  res.json({ success: true });
});

/**
 * POST /api/v1/admin/credit-packs/:packId/checkout
 * Creates a Stripe Checkout session for purchasing a credit pack.
 */
creditPackRouter.post('/:packId/checkout', async (req: Request, res: Response) => {
  const packId = req.params.packId as string;
  const slackTeamId = (req.query.team as string) || req.body.slackTeamId;

  if (!slackTeamId) {
    res.status(400).json({ error: 'slackTeamId is required' });
    return;
  }

  try {
    const checkoutUrl = await createCreditPackCheckout(
      packId,
      slackTeamId,
      req.body.successUrl,
      req.body.cancelUrl,
    );
    res.json({ checkoutUrl });
  } catch (error) {
    logger.error('Failed to create credit pack checkout', {
      packId,
      slackTeamId,
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(400).json({ error: error instanceof Error ? error.message : 'Checkout failed' });
  }
});
