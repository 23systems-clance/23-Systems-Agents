/**
 * Stripe webhook handler.
 *
 * Handles checkout completion, payment success/failure, and disputes.
 * MUST use raw body for signature verification -- mounted OUTSIDE
 * admin auth middleware in server.ts.
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import Stripe from 'stripe';
import { prisma } from '../../models/index.js';
import { config } from '../../config/index.js';
import { fulfillCreditPackPurchase } from '../../services/billing/creditPackService.js';
import logger from '../../lib/logger.js';

export const stripeWebhookRouter = Router();

/**
 * POST /api/stripe/webhook
 * Receives Stripe webhook events with raw body for signature verification.
 */
stripeWebhookRouter.post('/', async (req: Request, res: Response) => {
  const stripe = new Stripe(config.billing.stripeSecretKey);
  const sig = req.headers['stripe-signature'] as string;

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(
      req.body, // Must be raw buffer
      sig,
      config.billing.stripeWebhookSecret,
    );
  } catch (err: any) {
    logger.error('Stripe webhook signature verification failed', { error: err.message });
    res.status(400).json({ error: 'Invalid signature' });
    return;
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
        break;
      case 'payment_intent.succeeded':
        await handlePaymentSucceeded(event.data.object as Stripe.PaymentIntent);
        break;
      case 'payment_intent.payment_failed':
        await handlePaymentFailed(event.data.object as Stripe.PaymentIntent);
        break;
      case 'charge.dispute.created':
        await handleDisputeCreated(event.data.object as Stripe.Dispute);
        break;
      default:
        logger.debug('Unhandled Stripe event type', { type: event.type });
    }

    res.json({ received: true });
  } catch (error) {
    logger.error('Stripe webhook processing error', { type: event.type, error });
    res.status(500).json({ error: 'Processing failed' });
  }
});

/**
 * checkout.session.completed: handles billing setup AND credit pack purchases.
 */
async function handleCheckoutCompleted(session: Stripe.Checkout.Session): Promise<void> {
  // Credit pack purchase (Feature 35): identified by creditPackId in metadata
  if (session.metadata?.creditPackId) {
    await fulfillCreditPackPurchase(session);
    return;
  }

  // Original billing setup flow
  const customerId = session.customer as string;
  const setupIntent = session.setup_intent as string | null;

  // Find billing profile by metadata or customer ID
  const billingProfileId = session.metadata?.billingProfileId;
  const profile = billingProfileId
    ? await prisma.billingProfile.findUnique({ where: { id: billingProfileId } })
    : await prisma.billingProfile.findFirst({ where: { stripeCustomerId: customerId } });

  if (!profile) {
    logger.warn('checkout.session.completed: no billing profile found', { customerId, billingProfileId });
    return;
  }

  // Get payment method from setup intent if available
  let paymentMethodId: string | undefined;
  if (setupIntent) {
    const stripe = new Stripe(config.billing.stripeSecretKey);
    const si = await stripe.setupIntents.retrieve(setupIntent);
    paymentMethodId = si.payment_method as string;
  }

  await prisma.$transaction(async (tx) => {
    // Update profile: store Stripe IDs, activate, allocate credits
    await tx.billingProfile.update({
      where: { id: profile.id },
      data: {
        stripeCustomerId: customerId,
        ...(paymentMethodId && { stripePaymentMethodId: paymentMethodId }),
        status: 'ACTIVE',
        creditBalance: profile.monthlyAllowance,
        lastResetAt: new Date(),
      },
    });

    // Create initial monthly allocation transaction
    await tx.creditTransaction.create({
      data: {
        billingProfileId: profile.id,
        type: 'MONTHLY_ALLOCATION',
        amount: profile.monthlyAllowance,
        balanceAfter: profile.monthlyAllowance,
        description: 'Initial credit allocation on payment setup',
      },
    });

    // Mark magic link as used
    await tx.magicLink.updateMany({
      where: {
        billingProfileId: profile.id,
        usedAt: null,
      },
      data: { usedAt: new Date() },
    });
  });

  logger.info('Billing profile activated via Stripe Checkout', { profileId: profile.id, customerId });
}

/**
 * payment_intent.succeeded: Record overage charge transaction.
 */
async function handlePaymentSucceeded(paymentIntent: Stripe.PaymentIntent): Promise<void> {
  const customerId = paymentIntent.customer as string;
  if (!customerId) return;

  const profile = await prisma.billingProfile.findFirst({
    where: { stripeCustomerId: customerId },
  });

  if (!profile) {
    logger.debug('payment_intent.succeeded: no billing profile for customer', { customerId });
    return;
  }

  // Only record if this is an overage charge (has our metadata)
  if (paymentIntent.metadata?.type !== 'overage_charge') return;

  const chargeId = paymentIntent.latest_charge as string;

  await prisma.creditTransaction.create({
    data: {
      billingProfileId: profile.id,
      type: 'OVERAGE_CHARGE',
      amount: 0, // Overage charges don't add credits
      balanceAfter: profile.creditBalance,
      referenceId: chargeId,
      description: `Overage charge collected: $${(paymentIntent.amount / 100).toFixed(2)}`,
      metadata: {
        paymentIntentId: paymentIntent.id,
        amountUsd: paymentIntent.amount / 100,
      },
    },
  });
}

/**
 * payment_intent.payment_failed: ACTIVE -> DELINQUENT.
 */
async function handlePaymentFailed(paymentIntent: Stripe.PaymentIntent): Promise<void> {
  const customerId = paymentIntent.customer as string;
  if (!customerId) return;

  const profile = await prisma.billingProfile.findFirst({
    where: { stripeCustomerId: customerId, status: 'ACTIVE' },
  });

  if (!profile) return;

  await prisma.billingProfile.update({
    where: { id: profile.id },
    data: { status: 'DELINQUENT' },
  });

  logger.warn('Billing profile marked DELINQUENT due to payment failure', {
    profileId: profile.id,
    customerId,
    paymentIntentId: paymentIntent.id,
  });
}

/**
 * charge.dispute.created: ACTIVE -> DELINQUENT (FR-028).
 */
async function handleDisputeCreated(dispute: Stripe.Dispute): Promise<void> {
  const chargeId = typeof dispute.charge === 'string' ? dispute.charge : dispute.charge?.id;
  if (!chargeId) return;

  // Look up the customer from the charge
  const stripe = new Stripe(config.billing.stripeSecretKey);
  const charge = await stripe.charges.retrieve(chargeId);
  const customerId = charge.customer as string;
  if (!customerId) return;

  const profile = await prisma.billingProfile.findFirst({
    where: { stripeCustomerId: customerId, status: 'ACTIVE' },
  });

  if (!profile) return;

  await prisma.billingProfile.update({
    where: { id: profile.id },
    data: { status: 'DELINQUENT' },
  });

  logger.warn('Billing profile marked DELINQUENT due to chargeback dispute', {
    profileId: profile.id,
    customerId,
    disputeId: dispute.id,
  });
}
