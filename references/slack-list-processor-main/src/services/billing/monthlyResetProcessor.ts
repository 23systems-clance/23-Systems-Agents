/**
 * Monthly credit cycle reset processor.
 *
 * Handles monthly credit allocation with capped rollover.
 * Negative balances carry forward (no rollover applied).
 */

import { prisma } from '../../models/index.js';
import logger from '../../lib/logger.js';
import type { BillingProfile } from '@prisma/client';

export interface MonthlyResetResult {
  previousBalance: number;
  rolloverCredits: number;
  newBalance: number;
  transactionId: string;
}

/**
 * Checks if a billing profile should reset today based on its cycle day.
 *
 * Handles short months: if billingCycleDay is 31 but the month only has
 * 28-30 days, resets on the last day of the month.
 *
 * @param billingCycleDay - Day of month for the billing cycle (1-31).
 * @returns True if the reset should happen today.
 */
export function shouldResetToday(billingCycleDay: number): boolean {
  const now = new Date();
  const today = now.getUTCDate();
  const lastDayOfMonth = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0),
  ).getUTCDate();

  // If cycle day exceeds the last day of the month, reset on the last day
  if (billingCycleDay > lastDayOfMonth) {
    return today === lastDayOfMonth;
  }

  return today === billingCycleDay;
}

/**
 * Processes the monthly credit reset for a billing profile.
 *
 * Logic:
 * - Negative balance: newBalance = currentBalance + monthlyAllowance (no rollover)
 * - Positive balance: rollover = min(currentBalance, maxRolloverCredits),
 *   newBalance = rollover + monthlyAllowance
 *
 * @param profile - The billing profile to reset.
 * @returns Reset result with balance details.
 */
export async function processMonthlyReset(
  profile: BillingProfile,
): Promise<MonthlyResetResult> {
  const previousBalance = profile.creditBalance;
  let rolloverCredits = 0;
  let newBalance: number;

  if (previousBalance < 0) {
    // Negative balance: carry forward, no rollover
    newBalance = previousBalance + profile.monthlyAllowance;
  } else {
    // Positive balance: cap rollover
    rolloverCredits = Math.min(previousBalance, profile.maxRolloverCredits);
    newBalance = rolloverCredits + profile.monthlyAllowance;
  }

  // Create transaction and update balance atomically
  const transaction = await prisma.$transaction(async (tx) => {
    const txn = await tx.creditTransaction.create({
      data: {
        billingProfileId: profile.id,
        type: 'MONTHLY_ALLOCATION',
        amount: profile.monthlyAllowance,
        balanceAfter: newBalance,
        description: rolloverCredits > 0
          ? `Monthly allocation: +${profile.monthlyAllowance} credits (${rolloverCredits} rolled over)`
          : `Monthly allocation: +${profile.monthlyAllowance} credits`,
        metadata: {
          previousBalance,
          rolloverCredits,
          monthlyAllowance: profile.monthlyAllowance,
        },
      },
    });

    // Also reset rollover if there was rollover excess
    if (previousBalance > 0 && previousBalance > profile.maxRolloverCredits) {
      await tx.creditTransaction.create({
        data: {
          billingProfileId: profile.id,
          type: 'ROLLOVER_RESET',
          amount: -(previousBalance - rolloverCredits),
          balanceAfter: newBalance,
          description: `Rollover cap applied: ${previousBalance - rolloverCredits} credits expired`,
        },
      });
    }

    await tx.billingProfile.update({
      where: { id: profile.id },
      data: {
        creditBalance: newBalance,
        lastResetAt: new Date(),
      },
    });

    return txn;
  });

  logger.info('Monthly credit reset completed', {
    slackTeamId: profile.slackTeamId,
    previousBalance,
    rolloverCredits,
    newBalance,
    monthlyAllowance: profile.monthlyAllowance,
  });

  return {
    previousBalance,
    rolloverCredits,
    newBalance,
    transactionId: transaction.id,
  };
}
