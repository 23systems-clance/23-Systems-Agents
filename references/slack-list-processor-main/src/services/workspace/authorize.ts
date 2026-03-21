/**
 * Custom authorize function for Socket Mode multi-workspace support.
 *
 * Called on every incoming Slack event to resolve the bot token for the
 * originating workspace. Uses Redis cache with 1-hour TTL for fast lookups,
 * falls back to DB with token decryption on cache miss.
 *
 * Extended for multi-tenant SaaS licensing (Feature 35):
 * - Injects featureFlags, isPlatformOwner, and onboardingStatus into context
 * - Lazily configures platform owner workspace on first access
 */

import { fetchAuthResult } from './installationStore.js';
import { isPlatformOwner, ensurePlatformOwnerStatus } from './platformOwner.js';
import { resolveFeatureFlags } from '../featureToggle/featureFlags.js';
import { prisma } from '../../models/index.js';
import type { FeatureFlags } from '../../types/featureFlags.js';
import logger from '../../lib/logger.js';

interface AuthorizeArgs {
  teamId?: string;
  enterpriseId?: string;
}

interface AuthorizeResult {
  botToken: string;
  botId: string;
  botUserId: string;
  /** Resolved feature flags for the workspace. */
  featureFlags: FeatureFlags;
  /** Whether this workspace is the platform owner. */
  isPlatformOwner: boolean;
  /** Current onboarding step for the workspace. */
  onboardingStatus: string;
}

/**
 * Authorize function compatible with @slack/bolt's App constructor.
 *
 * Resolves bot credentials for the given workspace. Socket Mode calls this
 * on every event to determine which bot token to use for API responses.
 * Also injects multi-tenant context (feature flags, platform owner status,
 * onboarding status) for downstream middleware and handlers.
 *
 * @throws Error if no active installation found for the team
 */
export async function authorize({ teamId }: AuthorizeArgs): Promise<AuthorizeResult> {
  if (!teamId) {
    throw new Error('Cannot authorize: teamId is required');
  }

  try {
    const authResult = await fetchAuthResult(teamId);

    // Lazily configure platform owner workspace on first access
    await ensurePlatformOwnerStatus(teamId);

    // Fetch workspace feature flags and onboarding status
    const workspace = await prisma.workspaceInstallation.findUnique({
      where: { slackTeamId: teamId },
      select: { featureFlags: true, onboardingStatus: true },
    });

    const featureFlags = resolveFeatureFlags(
      teamId,
      workspace?.featureFlags as Record<string, unknown> | null,
    );

    return {
      ...authResult,
      featureFlags,
      isPlatformOwner: isPlatformOwner(teamId),
      onboardingStatus: workspace?.onboardingStatus ?? 'PENDING',
    };
  } catch (error) {
    logger.error('Authorization failed for workspace', {
      teamId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
