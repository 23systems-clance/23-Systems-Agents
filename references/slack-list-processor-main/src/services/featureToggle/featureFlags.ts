/**
 * Feature flag resolution service.
 *
 * Merges workspace-specific feature flag overrides with default flags.
 * Platform owner workspaces always get all flags enabled. Empty JSON ({})
 * is treated as "all features enabled" for backward compatibility.
 */

import type { FeatureFlags } from '../../types/featureFlags.js';
import { DEFAULT_CLIENT_FLAGS, PLATFORM_OWNER_FLAGS } from '../../types/featureFlags.js';
import { isPlatformOwner } from '../workspace/platformOwner.js';

/**
 * Resolves the effective feature flags for a workspace.
 *
 * Resolution order:
 * 1. Platform owner → all flags true (PLATFORM_OWNER_FLAGS)
 * 2. Empty JSON ({}) → all flags true (backward compatibility for existing workspaces)
 * 3. Partial JSON → merge with DEFAULT_CLIENT_FLAGS (explicit values override defaults)
 *
 * @param slackTeamId - Workspace team ID for platform owner check.
 * @param storedFlags - Raw JSON from WorkspaceInstallation.featureFlags.
 * @returns Fully resolved FeatureFlags object.
 */
export function resolveFeatureFlags(
  slackTeamId: string,
  storedFlags: Record<string, unknown> | null | undefined,
): FeatureFlags {
  // Platform owner always gets all features
  if (isPlatformOwner(slackTeamId)) {
    return { ...PLATFORM_OWNER_FLAGS };
  }

  // Empty or null flags = all features enabled (backward compatibility)
  if (!storedFlags || Object.keys(storedFlags).length === 0) {
    return { ...PLATFORM_OWNER_FLAGS };
  }

  // Merge stored flags with client defaults — stored values override defaults
  const resolved: FeatureFlags = { ...DEFAULT_CLIENT_FLAGS };
  for (const key of Object.keys(DEFAULT_CLIENT_FLAGS) as (keyof FeatureFlags)[]) {
    if (key in storedFlags && typeof storedFlags[key] === 'boolean') {
      resolved[key] = storedFlags[key] as boolean;
    }
  }

  return resolved;
}

/**
 * Checks whether a specific feature is enabled for a resolved flags set.
 *
 * @param flags - Resolved feature flags.
 * @param feature - Feature flag key to check.
 * @returns True if the feature is enabled.
 */
export function isFeatureEnabled(flags: FeatureFlags, feature: keyof FeatureFlags): boolean {
  return flags[feature] === true;
}
