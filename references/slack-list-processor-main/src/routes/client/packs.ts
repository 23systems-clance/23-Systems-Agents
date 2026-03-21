/**
 * Client pack catalog and subscription routes (Feature 39 - Vertical Pack Platform).
 *
 * Browse catalog, subscribe, list subscriptions, cancel.
 * Per contracts/packs-api.yaml.
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import {
  browseCatalog,
  subscribeToPack,
  listSubscriptions,
  cancelSubscription,
} from '../../services/platform/packManager.js';
import logger from '../../lib/logger.js';

export const clientPackRouter = Router();

/**
 * GET /api/v1/client/packs
 * Browse pack catalog with subscription status.
 */
clientPackRouter.get('/', async (req: Request, res: Response) => {
  const slackTeamId = (req as any).slackTeamId;

  if (!slackTeamId) {
    res.status(401).json({ error: 'Workspace not authenticated' });
    return;
  }

  try {
    const packs = await browseCatalog(slackTeamId);
    res.json({ packs });
  } catch (error) {
    logger.error('Failed to browse catalog', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ error: 'Failed to load pack catalog' });
  }
});

/**
 * POST /api/v1/client/packs/:packId/subscribe
 * Subscribe to a pack.
 */
clientPackRouter.post('/:packId/subscribe', async (req: Request, res: Response) => {
  const slackTeamId = (req as any).slackTeamId;

  if (!slackTeamId) {
    res.status(401).json({ error: 'Workspace not authenticated' });
    return;
  }

  try {
    const subscription = await subscribeToPack(req.params.packId as string, slackTeamId);
    res.status(201).json(subscription);
  } catch (error) {
    logger.error('Failed to subscribe', {
      packId: req.params.packId as string,
      slackTeamId,
      error: error instanceof Error ? error.message : String(error),
    });
    if (error instanceof Error && error.message.includes('not found')) {
      res.status(404).json({ error: error.message });
      return;
    }
    if (error instanceof Error && error.message.includes('already subscribed')) {
      res.status(409).json({ error: error.message });
      return;
    }
    res.status(400).json({ error: error instanceof Error ? error.message : 'Failed to subscribe' });
  }
});

/**
 * GET /api/v1/client/subscriptions
 * List workspace's active subscriptions.
 */
clientPackRouter.get('/subscriptions', async (req: Request, res: Response) => {
  const slackTeamId = (req as any).slackTeamId;

  if (!slackTeamId) {
    res.status(401).json({ error: 'Workspace not authenticated' });
    return;
  }

  try {
    const subscriptions = await listSubscriptions(slackTeamId);
    res.json({ subscriptions });
  } catch (error) {
    logger.error('Failed to list subscriptions', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ error: 'Failed to list subscriptions' });
  }
});

/**
 * POST /api/v1/client/subscriptions/:subscriptionId/cancel
 * Cancel a pack subscription.
 */
clientPackRouter.post('/subscriptions/:subscriptionId/cancel', async (req: Request, res: Response) => {
  try {
    const subscription = await cancelSubscription(req.params.subscriptionId as string);
    res.json(subscription);
  } catch (error) {
    logger.error('Failed to cancel subscription', { error: error instanceof Error ? error.message : String(error) });
    res.status(400).json({ error: error instanceof Error ? error.message : 'Failed to cancel subscription' });
  }
});
