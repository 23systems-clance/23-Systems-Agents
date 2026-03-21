/**
 * Credit Manager service.
 *
 * Handles atomic credit deduction and balance queries using
 * PostgreSQL advisory locks for concurrency safety.
 */

import { prisma } from '../../models/index.js';
import { chargeOverage } from './overageCharger.js';
import { notifyLowBalance, notifyDepleted } from './billingNotifier.js';
import logger from '../../lib/logger.js';

export interface DeductCreditsResult {
  newBalance: number;
  isOverage: boolean;
  transactionId: string;
}

/**
 * Atomically deducts credits from a workspace's billing profile.
 *
 * Uses PG advisory lock (`pg_advisory_xact_lock`) keyed on slackTeamId
 * to prevent concurrent balance reads/writes from conflicting.
 *
 * @param slackTeamId - Workspace identifier.
 * @param amount      - Number of credits to deduct (positive).
 * @param reference   - Job ID or other reference for the transaction.
 * @param description - Human-readable description for the transaction log.
 * @returns Deduction result with new balance and overage indicator.
 */
export async function deductCredits(
  slackTeamId: string,
  amount: number,
  reference: string,
  description: string,
): Promise<DeductCreditsResult | null> {
  if (amount <= 0) return null;

  // Track profile data for post-transaction threshold checks
  let profileData: {
    previousBalance: number;
    monthlyAllowance: number;
    overageRateUsd: number;
    stripePaymentMethodId: string | null;
  } | null = null;

  const result = await prisma.$transaction(async (tx) => {
    // Acquire advisory lock scoped to this transaction
    await tx.$executeRawUnsafe(
      `SELECT pg_advisory_xact_lock(hashtext($1)::bigint)`,
      slackTeamId,
    );

    const profile = await tx.billingProfile.findUnique({
      where: { slackTeamId },
    });

    if (!profile) {
      logger.warn('deductCredits: no billing profile found', { slackTeamId });
      return null;
    }

    // Skip deduction for exempt workspaces
    if (profile.billingExempt) {
      return null;
    }

    const newBalance = profile.creditBalance - amount;
    const isOverage = newBalance < 0;

    // Insert credit transaction record
    const transaction = await tx.creditTransaction.create({
      data: {
        billingProfileId: profile.id,
        type: 'ENRICHMENT_DEDUCTION',
        amount: -amount,
        balanceAfter: newBalance,
        referenceId: reference,
        description,
      },
    });

    // Update the balance
    await tx.billingProfile.update({
      where: { id: profile.id },
      data: { creditBalance: newBalance },
    });

    logger.info('Credits deducted', {
      slackTeamId,
      amount,
      newBalance,
      isOverage,
      transactionId: transaction.id,
      reference,
    });

    // Capture profile data for post-transaction checks
    profileData = {
      previousBalance: profile.creditBalance,
      monthlyAllowance: profile.monthlyAllowance,
      overageRateUsd: Number(profile.overageRateUsd),
      stripePaymentMethodId: profile.stripePaymentMethodId,
    };

    // Trigger overage charge if balance crossed zero
    if (newBalance < 0 && profile.creditBalance >= 0 && profile.stripePaymentMethodId) {
      const overageCredits = Math.abs(newBalance);
      // Fire-and-forget: charge overage asynchronously
      chargeOverage(profile, overageCredits, reference).catch((err) => {
        logger.error('Overage charge failed (will retry via webhook)', {
          slackTeamId,
          overageCredits,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }

    return {
      newBalance,
      isOverage,
      transactionId: transaction.id,
    };
  });

  // Post-transaction: check low-balance and depleted thresholds
  if (result && profileData) {
    const { previousBalance, monthlyAllowance, overageRateUsd } = profileData;
    const threshold = monthlyAllowance * 0.2;

    // Look up the Slack channel from the job reference for notifications
    const job = await prisma.job.findUnique({
      where: { id: reference },
      select: { slackChannelId: true },
    }).catch(() => null);

    if (job?.slackChannelId) {
      // Balance crossed below 20% threshold
      if (previousBalance >= threshold && result.newBalance < threshold && result.newBalance > 0) {
        notifyLowBalance(job.slackChannelId, result.newBalance, monthlyAllowance).catch((err) => {
          logger.warn('Low-balance notification failed', {
            error: err instanceof Error ? err.message : String(err),
          });
        });
      }

      // Balance reached zero or went negative
      if (previousBalance > 0 && result.newBalance <= 0) {
        notifyDepleted(job.slackChannelId, overageRateUsd).catch((err) => {
          logger.warn('Depleted notification failed', {
            error: err instanceof Error ? err.message : String(err),
          });
        });
      }
    }
  }

  return result;
}

/**
 * Returns the current credit balance for a workspace.
 *
 * @param slackTeamId - Workspace identifier.
 * @returns Current balance, or null if no billing profile exists.
 */
export async function getCreditBalance(slackTeamId: string): Promise<number | null> {
  const profile = await prisma.billingProfile.findUnique({
    where: { slackTeamId },
    select: { creditBalance: true },
  });
  return profile?.creditBalance ?? null;
}

export interface AddCreditsResult {
  newBalance: number;
  transactionId: string;
}

/**
 * Atomically adds credits to a workspace's billing profile.
 *
 * Uses the same PG advisory lock pattern as deductCredits() for
 * concurrency safety. Used for credit pack purchases and license
 * key activation initial credits.
 *
 * @param slackTeamId    - Workspace identifier.
 * @param amount         - Number of credits to add (positive).
 * @param reference      - Reference ID (e.g., credit pack ID, license key ID).
 * @param description    - Human-readable description for the transaction log.
 * @param transactionType - Type of credit transaction.
 * @returns Add result with new balance and transaction ID, or null if no profile.
 */
export async function addCredits(
  slackTeamId: string,
  amount: number,
  reference: string,
  description: string,
  transactionType: 'CREDIT_PACK_PURCHASE' | 'LICENSE_ACTIVATION' | 'MANUAL_ADJUSTMENT',
): Promise<AddCreditsResult | null> {
  if (amount <= 0) return null;

  const result = await prisma.$transaction(async (tx) => {
    // Acquire advisory lock scoped to this transaction
    await tx.$executeRawUnsafe(
      `SELECT pg_advisory_xact_lock(hashtext($1)::bigint)`,
      slackTeamId,
    );

    const profile = await tx.billingProfile.findUnique({
      where: { slackTeamId },
    });

    if (!profile) {
      logger.warn('addCredits: no billing profile found', { slackTeamId });
      return null;
    }

    const newBalance = profile.creditBalance + amount;

    // Insert credit transaction record
    const transaction = await tx.creditTransaction.create({
      data: {
        billingProfileId: profile.id,
        type: transactionType,
        amount,
        balanceAfter: newBalance,
        referenceId: reference,
        description,
      },
    });

    // Update the balance
    await tx.billingProfile.update({
      where: { id: profile.id },
      data: { creditBalance: newBalance },
    });

    logger.info('Credits added', {
      slackTeamId,
      amount,
      newBalance,
      transactionType,
      transactionId: transaction.id,
      reference,
    });

    return {
      newBalance,
      transactionId: transaction.id,
    };
  });

  return result;
}
