/**
 * Credit pack service (T029).
 *
 * Shared service for credit pack operations, used by both admin and
 * client dashboard routes. Handles Stripe Checkout session creation
 * and credit pack purchase fulfillment.
 */

import Stripe from 'stripe';
import { prisma } from '../../models/index.js';
import { addCredits } from './creditManager.js';
import { logAudit } from '../../lib/auditLogger.js';
import { config } from '../../config/index.js';
import logger from '../../lib/logger.js';

const stripe = new Stripe(config.billing.stripeSecretKey);

/**
 * Lists all active credit packs, ordered by sort order.
 *
 * @returns Array of active CreditPack records.
 */
export async function listActiveCreditPacks() {
  return prisma.creditPack.findMany({
    where: { active: true },
    orderBy: { sortOrder: 'asc' },
  });
}

/**
 * Creates a Stripe Checkout session for a credit pack purchase.
 *
 * @param packId      - CreditPack ID to purchase.
 * @param slackTeamId - Workspace team ID making the purchase.
 * @param successUrl  - URL to redirect after successful payment.
 * @param cancelUrl   - URL to redirect if payment is cancelled.
 * @returns Stripe Checkout session URL.
 */
export async function createCreditPackCheckout(
  packId: string,
  slackTeamId: string,
  successUrl?: string,
  cancelUrl?: string,
): Promise<string> {
  const pack = await prisma.creditPack.findUnique({
    where: { id: packId },
  });

  if (!pack || !pack.active) {
    throw new Error('Credit pack not found or inactive');
  }

  // Look up Stripe customer for the workspace
  const billingProfile = await prisma.billingProfile.findUnique({
    where: { slackTeamId },
    select: { stripeCustomerId: true },
  });

  const sessionParams: Stripe.Checkout.SessionCreateParams = {
    mode: 'payment',
    line_items: [
      pack.stripePriceId
        ? { price: pack.stripePriceId, quantity: 1 }
        : {
            price_data: {
              currency: 'usd',
              product_data: { name: pack.name },
              unit_amount: Math.round(Number(pack.priceUsd) * 100),
            },
            quantity: 1,
          },
    ],
    metadata: {
      slackTeamId,
      creditPackId: pack.id,
      creditAmount: String(pack.creditAmount),
    },
    success_url: successUrl || `${config.billing.appBaseUrl}/api/v1/admin/credit-packs/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: cancelUrl || `${config.billing.appBaseUrl}/api/v1/admin/credit-packs/cancelled`,
  };

  if (billingProfile?.stripeCustomerId) {
    sessionParams.customer = billingProfile.stripeCustomerId;
  }

  const session = await stripe.checkout.sessions.create(sessionParams);

  logger.info('Stripe Checkout session created for credit pack', {
    packId,
    slackTeamId,
    sessionId: session.id,
    creditAmount: pack.creditAmount,
  });

  if (!session.url) {
    throw new Error('Stripe Checkout session URL not returned');
  }

  return session.url;
}

/**
 * Fulfills a credit pack purchase after successful Stripe payment.
 *
 * Called by the Stripe webhook handler when `checkout.session.completed`
 * fires. Adds credits to the workspace and creates a transaction record.
 *
 * @param session - Stripe Checkout Session from the webhook event.
 */
export async function fulfillCreditPackPurchase(
  session: Stripe.Checkout.Session,
): Promise<void> {
  const { slackTeamId, creditPackId, creditAmount } = session.metadata ?? {};

  if (!slackTeamId || !creditPackId || !creditAmount) {
    logger.error('Credit pack webhook missing metadata', {
      sessionId: session.id,
      metadata: session.metadata,
    });
    return;
  }

  const amount = parseInt(creditAmount, 10);
  if (isNaN(amount) || amount <= 0) {
    logger.error('Invalid credit amount in metadata', {
      sessionId: session.id,
      creditAmount,
    });
    return;
  }

  await addCredits(
    slackTeamId,
    amount,
    creditPackId,
    `Credit pack purchase: ${amount} credits (session ${session.id})`,
    'CREDIT_PACK_PURCHASE',
  );

  logAudit({
    action: 'CREDIT_PACK_PURCHASED',
    actorUserId: session.client_reference_id ?? 'stripe-webhook',
    actorTeamId: slackTeamId,
    targetType: 'CreditPack',
    targetId: creditPackId,
    metadata: { creditAmount: amount, sessionId: session.id },
  });

  logger.info('Credit pack purchase fulfilled', {
    slackTeamId,
    creditPackId,
    creditAmount: amount,
    sessionId: session.id,
  });
}
