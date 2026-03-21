/**
 * License key validation and activation service.
 *
 * Validates a license key for correctness, expiration, revocation,
 * and single-use enforcement. On success, atomically activates the
 * key by setting activatedWorkspaceId and activatedAt.
 */

import { prisma } from '../../models/index.js';
import { resolveFeatureFlags } from '../featureToggle/featureFlags.js';
import { addCredits } from '../billing/creditManager.js';
import { DEFAULT_CLIENT_FLAGS } from '../../types/featureFlags.js';
import type { FeatureFlags } from '../../types/featureFlags.js';
import type { LicenseKeyValidationResult, SubscriptionTier } from '../../types/licensing.js';
import logger from '../../lib/logger.js';

/**
 * Validates a license key and activates it for the given workspace.
 *
 * Performs these checks in order:
 * 1. Key exists in DB
 * 2. Key is not revoked
 * 3. Key is not expired
 * 4. Key has not already been used (single-use enforcement)
 *
 * On success:
 * - Sets activatedWorkspaceId and activatedAt on the key
 * - Updates workspace featureFlags and onboardingStatus
 * - Adds initial credits to the workspace billing profile
 *
 * @param key         - The license key string (e.g., SLKP-XXXX-XXXX-XXXX-XXXX).
 * @param slackTeamId - Workspace team ID activating the key.
 * @returns Validation result with feature flags and credits on success.
 */
export async function validateAndActivate(
  key: string,
  slackTeamId: string,
): Promise<LicenseKeyValidationResult> {
  const normalizedKey = key.trim().toUpperCase();

  const licenseKey = await prisma.licenseKey.findUnique({
    where: { key: normalizedKey },
  });

  if (!licenseKey) {
    logger.warn('License key validation failed: not found', { key: normalizedKey });
    return { valid: false, errorCode: 'NOT_FOUND' };
  }

  if (licenseKey.revokedAt) {
    logger.warn('License key validation failed: revoked', { keyId: licenseKey.id });
    return { valid: false, errorCode: 'REVOKED' };
  }

  if (licenseKey.expiresAt && licenseKey.expiresAt < new Date()) {
    logger.warn('License key validation failed: expired', { keyId: licenseKey.id });
    return { valid: false, errorCode: 'EXPIRED' };
  }

  if (licenseKey.singleUse && licenseKey.activatedWorkspaceId) {
    logger.warn('License key validation failed: already used', {
      keyId: licenseKey.id,
      activatedWorkspaceId: licenseKey.activatedWorkspaceId,
    });
    return { valid: false, errorCode: 'ALREADY_USED' };
  }

  // Resolve feature flags from the key's preset
  const keyFlags = licenseKey.featureFlags as Record<string, unknown>;
  const mergedFlags: FeatureFlags = { ...DEFAULT_CLIENT_FLAGS };
  for (const flagKey of Object.keys(DEFAULT_CLIENT_FLAGS) as (keyof FeatureFlags)[]) {
    if (flagKey in keyFlags && typeof keyFlags[flagKey] === 'boolean') {
      mergedFlags[flagKey] = keyFlags[flagKey] as boolean;
    }
  }

  // Atomically activate the key and update the workspace
  await prisma.$transaction(async (tx) => {
    // Mark key as activated
    await tx.licenseKey.update({
      where: { id: licenseKey.id },
      data: {
        activatedWorkspaceId: slackTeamId,
        activatedAt: new Date(),
      },
    });

    // Update workspace with key's feature flags and advance onboarding
    await tx.workspaceInstallation.update({
      where: { slackTeamId },
      data: {
        licenseKeyId: licenseKey.id,
        featureFlags: mergedFlags as unknown as Record<string, boolean>,
        onboardingStatus: 'BILLING',
      },
    });
  });

  // Add initial credits (outside the main transaction — uses its own advisory lock)
  if (licenseKey.initialCredits > 0) {
    await addCredits(
      slackTeamId,
      licenseKey.initialCredits,
      licenseKey.id,
      `Initial credits from license key activation`,
      'LICENSE_ACTIVATION',
    );
  }

  logger.info('License key activated successfully', {
    keyId: licenseKey.id,
    slackTeamId,
    initialCredits: licenseKey.initialCredits,
    subscriptionTier: licenseKey.subscriptionTier,
  });

  return {
    valid: true,
    featureFlags: mergedFlags,
    initialCredits: licenseKey.initialCredits,
    subscriptionTier: licenseKey.subscriptionTier as SubscriptionTier,
  };
}
