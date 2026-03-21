/**
 * Credit Gate Service (Feature 39 - Vertical Pack Platform)
 *
 * Checks and deducts credits from pack subscriptions for skill executions.
 * Supports multi-pack routing: selects the subscription with most remaining credits (FR-016a).
 * Handles overage billing (FR-019).
 */

import { prisma } from '../../models/index.js';
import logger from '../../lib/logger.js';

const log = logger.withContext({ service: 'creditGate' });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CreditCheckResult {
  allowed: boolean;
  packSubscriptionId?: string;
  creditsRemaining?: number;
  reason?: string;
}

// ---------------------------------------------------------------------------
// Credit Gate (T043)
// ---------------------------------------------------------------------------

/**
 * Check if a workspace has sufficient credits to execute a skill.
 * Finds all active PackSubscriptions containing this skill and selects
 * the one with the most remaining credits (FR-016a).
 */
export async function checkCredits(
  skillId: string,
  slackTeamId: string,
): Promise<CreditCheckResult> {
  // Find active subscriptions that include this skill
  const subscriptions = await prisma.packSubscription.findMany({
    where: {
      slackTeamId,
      status: 'ACTIVE',
      pack: {
        packSkills: {
          some: { skillId },
        },
      },
    },
    orderBy: { createdAt: 'asc' },
  });

  if (subscriptions.length === 0) {
    return {
      allowed: false,
      reason: 'No active pack subscription includes this skill',
    };
  }

  // Select subscription with most remaining credits
  let bestSub = subscriptions[0];
  let bestRemaining = bestSub.creditsIncluded - bestSub.creditsUsed;

  for (const sub of subscriptions) {
    const remaining = sub.creditsIncluded - sub.creditsUsed;
    if (remaining > bestRemaining) {
      bestSub = sub;
      bestRemaining = remaining;
    }
  }

  // Allow execution even if over credits (overage billing), but warn
  if (bestRemaining <= 0) {
    const overageRate = Number(bestSub.overageRateUsd ?? 0);
    if (overageRate > 0) {
      // Overage allowed
      log.info('Credit overage allowed', {
        subscriptionId: bestSub.id,
        creditsUsed: bestSub.creditsUsed,
        creditsIncluded: bestSub.creditsIncluded,
        overageRate,
      });

      return {
        allowed: true,
        packSubscriptionId: bestSub.id,
        creditsRemaining: 0,
      };
    }

    return {
      allowed: false,
      packSubscriptionId: bestSub.id,
      creditsRemaining: 0,
      reason: 'Insufficient credits and no overage billing configured',
    };
  }

  return {
    allowed: true,
    packSubscriptionId: bestSub.id,
    creditsRemaining: bestRemaining,
  };
}

/**
 * Deduct credits from a pack subscription after successful skill execution.
 * Creates a PackCreditTransaction record and increments creditsUsed.
 */
export async function deductCredits(
  packSubscriptionId: string,
  amount: number,
  executionId: string,
): Promise<void> {
  await prisma.$transaction([
    prisma.packSubscription.update({
      where: { id: packSubscriptionId },
      data: { creditsUsed: { increment: amount } },
    }),
    prisma.packCreditTransaction.create({
      data: {
        packSubscriptionId,
        type: 'ENRICHMENT_DEDUCTION' as any,
        amount: -amount,
        balanceAfter: 0, // Will be updated by caller if needed
        description: `Skill execution ${executionId}`,
      },
    }),
  ]);

  log.debug('Credits deducted', { packSubscriptionId, amount, executionId });
}
