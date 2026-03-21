/**
 * Overage Charger service.
 *
 * Creates Stripe PaymentIntents for overage charges when a workspace
 * exceeds its credit allowance.
 */

import Stripe from 'stripe';
import { config } from '../../config/index.js';
import { prisma } from '../../models/index.js';
import logger from '../../lib/logger.js';
import type { BillingProfile } from '@prisma/client';

function getStripe(): Stripe {
  if (!config.billing.stripeSecretKey) {
    throw new Error('STRIPE_SECRET_KEY is not configured');
  }
  return new Stripe(config.billing.stripeSecretKey);
}

export interface OverageChargeResult {
  paymentIntentId: string;
  amountUsd: number;
  status: string;
}

/**
 * Charges a workspace for overage credits via Stripe.
 *
 * Creates an off-session PaymentIntent using the stored payment method
 * and records an OVERAGE_CHARGE CreditTransaction.
 *
 * @param profile        - The billing profile to charge.
 * @param overageCredits - Number of credits in overage (positive).
 * @param referenceId    - Job ID or other reference.
 * @returns Charge result with PaymentIntent details.
 */
export async function chargeOverage(
  profile: BillingProfile,
  overageCredits: number,
  referenceId?: string,
): Promise<OverageChargeResult | null> {
  if (overageCredits <= 0) return null;

  const amountUsd = overageCredits * Number(profile.overageRateUsd);
  if (amountUsd <= 0) return null;

  if (!profile.stripeCustomerId || !profile.stripePaymentMethodId) {
    logger.warn('Cannot charge overage: missing Stripe payment info', {
      slackTeamId: profile.slackTeamId,
      overageCredits,
    });
    return null;
  }

  try {
    const paymentIntent = await getStripe().paymentIntents.create({
      amount: Math.round(amountUsd * 100), // Stripe expects cents
      currency: 'usd',
      customer: profile.stripeCustomerId,
      payment_method: profile.stripePaymentMethodId,
      off_session: true,
      confirm: true,
      metadata: {
        type: 'overage_charge',
        slackTeamId: profile.slackTeamId,
        overageCredits: String(overageCredits),
        billingProfileId: profile.id,
        ...(referenceId ? { referenceId } : {}),
      },
    });

    // Record the overage transaction
    await prisma.creditTransaction.create({
      data: {
        billingProfileId: profile.id,
        type: 'OVERAGE_CHARGE',
        amount: overageCredits, // positive, representing the overage amount billed
        balanceAfter: profile.creditBalance, // balance doesn't change from overage charge
        referenceId: paymentIntent.id,
        description: `Overage charge: ${overageCredits} credits ($${amountUsd.toFixed(2)})`,
        metadata: {
          paymentIntentId: paymentIntent.id,
          amountUsd,
          overageCredits,
        },
      },
    });

    logger.info('Overage charge created', {
      slackTeamId: profile.slackTeamId,
      overageCredits,
      amountUsd,
      paymentIntentId: paymentIntent.id,
      status: paymentIntent.status,
    });

    return {
      paymentIntentId: paymentIntent.id,
      amountUsd,
      status: paymentIntent.status,
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.error('Overage charge failed', {
      slackTeamId: profile.slackTeamId,
      overageCredits,
      amountUsd,
      error: errorMsg,
    });

    // If payment fails, mark profile as delinquent
    await prisma.billingProfile.update({
      where: { id: profile.id },
      data: { status: 'DELINQUENT' },
    });

    throw err;
  }
}
