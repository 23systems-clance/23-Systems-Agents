/**
 * Billing gate service.
 *
 * Checks if a workspace is allowed to run an enrichment job
 * based on billing profile status and credit balance.
 * Called at all 7 entry points before job creation.
 */

import { prisma } from '../../models/index.js';
import { createRateSnapshot, estimateJobCredits } from './creditRateCalculator.js';
import { generateAndSendMagicLink } from './magicLinkService.js';
import logger from '../../lib/logger.js';
import type { BillingProfile } from '@prisma/client';
import type { CreditRateSnapshot } from './creditRateCalculator.js';

export interface BillingGateResult {
  allowed: boolean;
  reason?: string;
  profile?: BillingProfile;
  rateSnapshot?: CreditRateSnapshot;
  estimatedCredits?: number;
  estimatedOverage?: number;
}

/**
 * Check if a workspace is allowed to run an enrichment job.
 *
 * Logic:
 * 1. billingExempt=true -> ALLOW (skip all checks)
 * 2. No profile -> check legacy limits, or BLOCK + auto-send magic link
 * 3. status != ACTIVE -> BLOCK with status-specific message
 * 4. Sufficient credits -> ALLOW
 * 5. Zero credits + valid payment method -> ALLOW with overage warning
 * 6. Low credits -> ALLOW with overage estimate
 */
export async function checkBillingGate(
  slackTeamId: string,
  estimatedCredits: number,
  channelId?: string,
): Promise<BillingGateResult> {
  const profile = await prisma.billingProfile.findUnique({
    where: { slackTeamId },
  });

  // No billing profile
  if (!profile) {
    return handleNoProfile(slackTeamId, channelId);
  }

  // Billing exempt -- always allow
  if (profile.billingExempt) {
    const rateSnapshot = await createRateSnapshot();
    return { allowed: true, profile, rateSnapshot, estimatedCredits: 0 };
  }

  // Status check
  if (profile.status !== 'ACTIVE') {
    const statusMessages: Record<string, string> = {
      PENDING: 'Your workspace billing is pending setup. A billing setup link has been sent -- please complete payment setup to continue.',
      SUSPENDED: 'Your workspace billing has been suspended. Please contact your administrator.',
      DELINQUENT: 'Your workspace has an outstanding payment issue. Please resolve it to continue enrichments.',
    };
    return {
      allowed: false,
      profile,
      reason: statusMessages[profile.status] ?? 'Billing is not active for this workspace.',
    };
  }

  // Active profile -- check credits
  const rateSnapshot = await createRateSnapshot();

  if (profile.creditBalance >= estimatedCredits) {
    // Sufficient credits
    return { allowed: true, profile, rateSnapshot, estimatedCredits };
  }

  if (profile.creditBalance <= 0 && profile.stripePaymentMethodId) {
    // Zero credits but has payment method -> allow with overage warning
    return {
      allowed: true,
      profile,
      rateSnapshot,
      estimatedCredits,
      estimatedOverage: estimatedCredits - profile.creditBalance,
    };
  }

  if (profile.creditBalance > 0) {
    // Low credits but some available -> allow with overage estimate
    const overage = Math.max(0, estimatedCredits - profile.creditBalance);
    return {
      allowed: true,
      profile,
      rateSnapshot,
      estimatedCredits,
      estimatedOverage: overage > 0 ? overage : undefined,
    };
  }

  // Zero credits and no payment method
  return {
    allowed: false,
    profile,
    reason: 'Insufficient credits and no payment method on file. Please set up billing to continue.',
  };
}

/**
 * Handle case where no billing profile exists.
 * Checks for legacy limits; if none, blocks and auto-sends magic link.
 */
async function handleNoProfile(
  slackTeamId: string,
  channelId?: string,
): Promise<BillingGateResult> {
  // Check for legacy limits on WorkspaceInstallation
  const workspace = await prisma.workspaceInstallation.findFirst({
    where: { slackTeamId },
    select: {
      monthlySpendCapUsd: true,
      maxBuiltwithLookups: true,
      maxApolloCredits: true,
      maxAiTokens: true,
    },
  });

  // If legacy limits exist, allow under legacy rules
  if (workspace && (
    workspace.monthlySpendCapUsd !== null ||
    workspace.maxBuiltwithLookups !== null ||
    workspace.maxApolloCredits !== null ||
    workspace.maxAiTokens !== null
  )) {
    return { allowed: true };
  }

  // No legacy limits and no billing profile -- block
  // Auto-create a billing profile and attempt to send magic link
  try {
    const newProfile = await prisma.billingProfile.create({
      data: {
        slackTeamId,
        monthlyAllowance: 500,
        maxRolloverCredits: 1000,
        overageRateUsd: 0.05,
        billingCycleDay: 1,
      },
    });

    // Attempt to send magic link (best effort)
    generateAndSendMagicLink(newProfile.id).catch((err) => {
      logger.error('Failed to auto-send magic link', { slackTeamId, error: err });
    });
  } catch (error) {
    // Profile may already exist from race condition
    logger.debug('Could not auto-create billing profile', { slackTeamId, error });
  }

  return {
    allowed: false,
    reason: 'This workspace needs billing to be set up before running enrichments. A billing setup link has been sent to your workspace administrator.',
  };
}
