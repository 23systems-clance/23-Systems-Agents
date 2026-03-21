/**
 * License key and onboarding type definitions for multi-tenant SaaS licensing.
 */

import type { FeatureFlags } from './featureFlags.js';

/** Onboarding wizard steps (mirrors Prisma OnboardingStep enum). */
export enum OnboardingStep {
  PENDING = 'PENDING',
  LICENSE_KEY = 'LICENSE_KEY',
  BILLING = 'BILLING',
  CHANNELS = 'CHANNELS',
  COMPLETE = 'COMPLETE',
}

/** Workspace type (mirrors Prisma WorkspaceType enum). */
export enum WorkspaceType {
  PLATFORM_OWNER = 'PLATFORM_OWNER',
  CLIENT = 'CLIENT',
}

/** Subscription tier names. */
export type SubscriptionTier = 'starter' | 'professional' | 'enterprise';

/** License key status derived from its fields. */
export type LicenseKeyStatus = 'active' | 'activated' | 'expired' | 'revoked';

/** Input for creating a new license key. */
export interface CreateLicenseKeyInput {
  /** Feature flags preset for workspaces activating this key. */
  featureFlags: Partial<FeatureFlags>;
  /** Initial credits allocated upon activation. */
  initialCredits: number;
  /** Subscription tier assigned to the workspace. */
  subscriptionTier: SubscriptionTier;
  /** Optional expiration date (blocks new activations only). */
  expiresAt?: Date;
  /** Whether the key can only be used once (default: true). */
  singleUse?: boolean;
  /** Internal notes (e.g., client name, deal reference). */
  notes?: string;
}

/** Result of a license key validation attempt. */
export interface LicenseKeyValidationResult {
  valid: boolean;
  errorCode?: 'NOT_FOUND' | 'REVOKED' | 'EXPIRED' | 'ALREADY_USED';
  /** Feature flags from the key (only present when valid). */
  featureFlags?: FeatureFlags;
  /** Initial credits from the key (only present when valid). */
  initialCredits?: number;
  /** Subscription tier from the key (only present when valid). */
  subscriptionTier?: SubscriptionTier;
}

/**
 * Derives the display status of a license key from its fields.
 */
export function deriveLicenseKeyStatus(key: {
  revokedAt: Date | null;
  expiresAt: Date | null;
  activatedAt: Date | null;
}): LicenseKeyStatus {
  if (key.revokedAt) return 'revoked';
  if (key.expiresAt && key.expiresAt < new Date()) return 'expired';
  if (key.activatedAt) return 'activated';
  return 'active';
}
