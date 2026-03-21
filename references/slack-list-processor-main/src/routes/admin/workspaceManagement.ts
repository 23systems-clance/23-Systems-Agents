/**
 * Workspace management admin routes (T043).
 *
 * Admin API for listing workspaces with feature flags, updating
 * per-workspace feature toggles, and manual credit adjustments.
 */

import { Router } from 'express';
import { prisma } from '../../models/index.js';
import { resolveFeatureFlags } from '../../services/featureToggle/featureFlags.js';
import { addCredits } from '../../services/billing/creditManager.js';
import { getCreditBalance } from '../../services/billing/creditManager.js';
import type { FeatureFlags } from '../../types/featureFlags.js';
import logger from '../../lib/logger.js';

export const workspaceManagementRouter = Router();

/**
 * GET /api/v1/admin/workspace-management
 *
 * Lists all client workspaces with feature flags, credit balance, and status.
 */
workspaceManagementRouter.get('/', async (req, res) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 25;
    const skip = (page - 1) * limit;
    const onboardingStatus = req.query.onboardingStatus as string | undefined;

    const where: Record<string, unknown> = {};
    if (onboardingStatus && onboardingStatus !== 'all') {
      where.onboardingStatus = onboardingStatus;
    }

    const [workspaces, total] = await Promise.all([
      prisma.workspaceInstallation.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        select: {
          slackTeamId: true,
          slackTeamName: true,
          workspaceType: true,
          onboardingStatus: true,
          featureFlags: true,
          clientDashboardEnabled: true,
          createdAt: true,
          licenseKeyId: true,
          licenseKey: {
            select: { key: true, subscriptionTier: true },
          },
        },
      }),
      prisma.workspaceInstallation.count({ where }),
    ]);

    // Enrich with credit balances and resolved flags
    const enriched = await Promise.all(
      workspaces.map(async (ws) => {
        const creditBalance = await getCreditBalance(ws.slackTeamId);
        const storedFlags = ws.featureFlags as Record<string, boolean> | null;
        const resolvedFlags = resolveFeatureFlags(ws.slackTeamId, storedFlags);

        // Mask license key for display
        const maskedKey = ws.licenseKey?.key
          ? `${ws.licenseKey.key.slice(0, 5)}****-****-****-${ws.licenseKey.key.slice(-4)}`
          : null;

        return {
          slackTeamId: ws.slackTeamId,
          slackTeamName: ws.slackTeamName,
          workspaceType: ws.workspaceType,
          onboardingStatus: ws.onboardingStatus,
          featureFlags: resolvedFlags,
          creditBalance,
          subscriptionTier: ws.licenseKey?.subscriptionTier ?? null,
          licenseKey: maskedKey,
          licenseKeyId: ws.licenseKeyId,
          createdAt: ws.createdAt,
        };
      }),
    );

    res.json({ workspaces: enriched, total, page });
  } catch (error) {
    logger.error('Failed to list workspaces', {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ error: 'Failed to list workspaces' });
  }
});

/**
 * GET /api/v1/admin/workspace-management/:slackTeamId/features
 *
 * Gets resolved feature flags for a workspace.
 */
workspaceManagementRouter.get('/:slackTeamId/features', async (req, res) => {
  try {
    const { slackTeamId } = req.params;

    const workspace = await prisma.workspaceInstallation.findUnique({
      where: { slackTeamId },
      select: { featureFlags: true },
    });

    if (!workspace) {
      res.status(404).json({ error: 'Workspace not found' });
      return;
    }

    const storedFlags = workspace.featureFlags as Record<string, boolean> | null;
    const flags = resolveFeatureFlags(slackTeamId, storedFlags);

    res.json(flags);
  } catch (error) {
    logger.error('Failed to get workspace features', {
      slackTeamId: req.params.slackTeamId,
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ error: 'Failed to get workspace features' });
  }
});

/**
 * PATCH /api/v1/admin/workspace-management/:slackTeamId/features
 *
 * Updates feature flags for a workspace. Partial update — only include
 * flags that should change.
 */
workspaceManagementRouter.patch('/:slackTeamId/features', async (req, res) => {
  try {
    const { slackTeamId } = req.params;
    const flagUpdates = req.body as Partial<FeatureFlags>;

    const workspace = await prisma.workspaceInstallation.findUnique({
      where: { slackTeamId },
      select: { featureFlags: true },
    });

    if (!workspace) {
      res.status(404).json({ error: 'Workspace not found' });
      return;
    }

    // Merge existing flags with updates
    const existingFlags = (workspace.featureFlags as Record<string, boolean>) ?? {};
    const mergedFlags = { ...existingFlags, ...flagUpdates };

    const updated = await prisma.workspaceInstallation.update({
      where: { slackTeamId },
      data: { featureFlags: mergedFlags },
      select: { featureFlags: true, updatedAt: true },
    });

    // Audit log
    const adminId = (req as unknown as Record<string, unknown>).adminId as string ?? 'system';
    await prisma.auditLog.create({
      data: {
        action: 'FEATURE_FLAGS_UPDATED',
        actorUserId: adminId,
        actorTeamId: '',
        targetType: 'WorkspaceInstallation',
        targetId: slackTeamId,
        metadata: {
          previousFlags: existingFlags,
          updatedFlags: mergedFlags,
          changes: flagUpdates,
        },
      },
    });

    logger.info('Workspace feature flags updated', {
      slackTeamId,
      changes: flagUpdates,
      adminId,
    });

    res.json({
      featureFlags: resolveFeatureFlags(slackTeamId, updated.featureFlags as Record<string, boolean>),
      updatedAt: updated.updatedAt,
    });
  } catch (error) {
    logger.error('Failed to update workspace features', {
      slackTeamId: req.params.slackTeamId,
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ error: 'Failed to update workspace features' });
  }
});

/**
 * POST /api/v1/admin/workspace-management/:slackTeamId/credits
 *
 * Manual credit adjustment with audit trail.
 */
workspaceManagementRouter.post('/:slackTeamId/credits', async (req, res) => {
  try {
    const { slackTeamId } = req.params;
    const { amount, reason } = req.body;

    if (amount == null || !reason) {
      res.status(400).json({ error: 'amount and reason are required' });
      return;
    }

    const adminId = (req as unknown as Record<string, unknown>).adminId as string ?? 'system';

    const newBalance = await addCredits(
      slackTeamId,
      amount,
      `admin:${adminId}`,
      reason,
      'MANUAL_ADJUSTMENT',
    );

    // Audit log
    await prisma.auditLog.create({
      data: {
        action: 'MANUAL_CREDIT_ADJUSTMENT',
        actorUserId: adminId,
        actorTeamId: '',
        targetType: 'BillingProfile',
        targetId: slackTeamId,
        metadata: { amount, reason, newBalance } as any,
      },
    });

    logger.info('Manual credit adjustment', {
      slackTeamId,
      amount,
      reason,
      newBalance,
      adminId,
    });

    res.json({ newBalance });
  } catch (error) {
    logger.error('Failed to adjust credits', {
      slackTeamId: req.params.slackTeamId,
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ error: 'Failed to adjust credits' });
  }
});
