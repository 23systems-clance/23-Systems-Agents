/**
 * Platform owner auto-detection service.
 *
 * Identifies the platform owner workspace by comparing the incoming
 * slackTeamId against the configured PLATFORM_OWNER_TEAM_ID env var.
 * Platform owner workspaces get all features enabled and billing exempt.
 */

import { config } from '../../config/index.js';
import { prisma } from '../../models/index.js';
import logger from '../../lib/logger.js';

/**
 * Checks whether a workspace is the platform owner.
 *
 * @param slackTeamId - Slack workspace team ID.
 * @returns True if the workspace matches the configured platform owner team ID.
 */
export function isPlatformOwner(slackTeamId: string): boolean {
  return (
    config.licensing.platformOwnerTeamId !== '' &&
    slackTeamId === config.licensing.platformOwnerTeamId
  );
}

/**
 * Ensures the platform owner workspace has the correct type and billing exemption.
 *
 * Called during authorize() to lazily migrate the workspace record. Only writes
 * to DB if the workspace type isn't already PLATFORM_OWNER. Idempotent.
 *
 * @param slackTeamId - Slack workspace team ID.
 */
export async function ensurePlatformOwnerStatus(slackTeamId: string): Promise<void> {
  if (!isPlatformOwner(slackTeamId)) return;

  try {
    const workspace = await prisma.workspaceInstallation.findUnique({
      where: { slackTeamId },
      select: { workspaceType: true, onboardingStatus: true },
    });

    if (!workspace) return;

    // Already configured — skip DB write
    if (workspace.workspaceType === 'PLATFORM_OWNER') return;

    await prisma.workspaceInstallation.update({
      where: { slackTeamId },
      data: {
        workspaceType: 'PLATFORM_OWNER',
        onboardingStatus: 'COMPLETE',
      },
    });

    // Ensure billing profile is exempt
    await prisma.billingProfile.updateMany({
      where: { slackTeamId },
      data: { billingExempt: true },
    });

    logger.info('Platform owner workspace detected and configured', { slackTeamId });
  } catch (error) {
    logger.error('Failed to configure platform owner status', {
      slackTeamId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
