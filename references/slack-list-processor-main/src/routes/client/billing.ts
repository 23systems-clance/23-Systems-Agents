/**
 * Client billing routes (T053).
 *
 * Client-facing billing info, credit pack listing, and Stripe checkout.
 */

import { Router } from 'express';
import { prisma } from '../../models/index.js';
import { getCreditBalance } from '../../services/billing/creditManager.js';
import { listActiveCreditPacks, createCreditPackCheckout } from '../../services/billing/creditPackService.js';
import { config } from '../../config/index.js';
import type { ClientSession } from '../../lib/clientAuth.js';
import logger from '../../lib/logger.js';

export const clientBillingRouter = Router();

/** GET /api/v1/client/billing — billing details and transaction history. */
clientBillingRouter.get('/', async (req, res) => {
  try {
    const session = (req as unknown as Record<string, unknown>).clientSession as ClientSession;
    const { slackTeamId } = session;

    const [creditBalance, billingProfile, transactions] = await Promise.all([
      getCreditBalance(slackTeamId),
      prisma.billingProfile.findUnique({
        where: { slackTeamId },
        select: {
          monthlyAllowance: true,
          subscriptionTier: true,
          nextResetAt: true,
          stripeCustomerId: true,
        },
      }),
      prisma.creditTransaction.findMany({
        where: { billingProfile: { slackTeamId } },
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: {
          id: true,
          type: true,
          amount: true,
          description: true,
          createdAt: true,
        },
      }),
    ]);

    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const usedThisMonth = await prisma.creditTransaction.aggregate({
      where: {
        billingProfile: { slackTeamId },
        createdAt: { gte: startOfMonth },
        type: 'ENRICHMENT_DEDUCTION',
      },
      _sum: { amount: true },
    });

    res.json({
      creditBalance,
      monthlyAllowance: billingProfile?.monthlyAllowance ?? 0,
      creditsUsedThisMonth: Math.abs(usedThisMonth._sum?.amount ?? 0),
      nextResetDate: billingProfile?.nextResetAt ?? null,
      subscriptionTier: billingProfile?.subscriptionTier ?? 'starter',
      transactions,
    });
  } catch (error) {
    logger.error('Failed to get client billing', {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ error: 'Failed to get billing info' });
  }
});

/** GET /api/v1/client/billing/credit-packs — available packs. */
clientBillingRouter.get('/credit-packs', async (_req, res) => {
  try {
    const packs = await listActiveCreditPacks();
    res.json({ packs });
  } catch (error) {
    logger.error('Failed to list credit packs', {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ error: 'Failed to list credit packs' });
  }
});

/** POST /api/v1/client/billing/credit-packs/:packId/checkout — Stripe Checkout. */
clientBillingRouter.post('/credit-packs/:packId/checkout', async (req, res) => {
  try {
    const session = (req as unknown as Record<string, unknown>).clientSession as ClientSession;
    const { slackTeamId } = session;
    const { packId } = req.params;

    const checkoutUrl = await createCreditPackCheckout(packId, slackTeamId);

    if (!checkoutUrl) {
      res.status(404).json({ error: 'Credit pack not found' });
      return;
    }

    res.json({ checkoutUrl });
  } catch (error) {
    logger.error('Failed to create credit pack checkout', {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ error: 'Failed to create checkout session' });
  }
});

/** POST /api/v1/client/billing/manage — Stripe Billing Portal. */
clientBillingRouter.post('/manage', async (req, res) => {
  try {
    const session = (req as unknown as Record<string, unknown>).clientSession as ClientSession;
    const { slackTeamId } = session;

    const billingProfile = await prisma.billingProfile.findUnique({
      where: { slackTeamId },
      select: { stripeCustomerId: true },
    });

    if (!billingProfile?.stripeCustomerId) {
      res.status(400).json({ error: 'No billing profile found' });
      return;
    }

    const Stripe = (await import('stripe')).default;
    const stripe = new Stripe(config.billing.stripeSecretKey);

    const portalSession = await stripe.billingPortal.sessions.create({
      customer: billingProfile.stripeCustomerId,
      return_url: config.licensing.clientDashboardUrl || '/',
    });

    res.json({ portalUrl: portalSession.url });
  } catch (error) {
    logger.error('Failed to create billing portal session', {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ error: 'Failed to create billing portal' });
  }
});
