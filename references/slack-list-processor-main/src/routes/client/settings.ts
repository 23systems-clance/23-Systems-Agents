/**
 * Client settings routes (T056).
 *
 * Workspace settings and notification preferences.
 * Admin users can update settings.
 */

import { Router } from 'express';
import { prisma } from '../../models/index.js';
import { resolveFeatureFlags } from '../../services/featureToggle/featureFlags.js';
import { requireClientAdmin } from '../../lib/clientAuth.js';
import type { ClientSession } from '../../lib/clientAuth.js';
import logger from '../../lib/logger.js';

export const clientSettingsRouter = Router();

/** GET /api/v1/client/settings — workspace settings. */
clientSettingsRouter.get('/', async (req, res) => {
  try {
    const session = (req as unknown as Record<string, unknown>).clientSession as ClientSession;
    const { slackTeamId } = session;

    const workspace = await prisma.workspaceInstallation.findUnique({
      where: { slackTeamId },
      select: {
        featureFlags: true,
        settings: true,
      },
    });

    const flags = resolveFeatureFlags(slackTeamId, workspace?.featureFlags as Record<string, boolean> | null);
    const enabledFeatures = Object.entries(flags)
      .filter(([, v]) => v)
      .map(([k]) => k);

    const settingsObj = (workspace?.settings as Record<string, unknown>) ?? {};

    res.json({
      defaultEnrichmentType: settingsObj.defaultEnrichmentType ?? null,
      enabledFeatures,
      notificationPreferences: settingsObj.notificationPreferences ?? {
        jobComplete: true,
        lowBalance: true,
        weeklyReport: false,
      },
    });
  } catch (error) {
    logger.error('Failed to get client settings', {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ error: 'Failed to get settings' });
  }
});

/** PATCH /api/v1/client/settings — update settings (admin only). */
clientSettingsRouter.patch('/', requireClientAdmin, async (req, res) => {
  try {
    const session = (req as unknown as Record<string, unknown>).clientSession as ClientSession;
    const { slackTeamId } = session;
    const { defaultEnrichmentType, notificationPreferences } = req.body;

    // Load current settings to merge
    const workspace = await prisma.workspaceInstallation.findUnique({
      where: { slackTeamId },
      select: { settings: true },
    });

    const currentSettings = (workspace?.settings as Record<string, unknown>) ?? {};

    if (defaultEnrichmentType !== undefined) {
      const validTypes = ['TECHNOGRAPHIC', 'CONTACT', 'COMBINED', 'TECH_REPORT'];
      if (!validTypes.includes(defaultEnrichmentType)) {
        res.status(400).json({ error: 'Invalid enrichment type' });
        return;
      }
      currentSettings.defaultEnrichmentType = defaultEnrichmentType;
    }

    if (notificationPreferences !== undefined) {
      currentSettings.notificationPreferences = notificationPreferences;
    }

    if (!defaultEnrichmentType && !notificationPreferences) {
      res.status(400).json({ error: 'No valid fields to update' });
      return;
    }

    await prisma.workspaceInstallation.update({
      where: { slackTeamId },
      data: { settings: currentSettings as any },
    });

    res.json({ success: true });
  } catch (error) {
    logger.error('Failed to update client settings', {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ error: 'Failed to update settings' });
  }
});
