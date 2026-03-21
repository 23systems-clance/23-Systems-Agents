/**
 * License key management admin routes (T041).
 *
 * Admin API for creating, listing, viewing, and revoking license keys.
 * All routes require admin authentication via adminAuth middleware.
 */

import { Router } from 'express';
import {
  createLicenseKey,
  listLicenseKeys,
  getLicenseKey,
  revokeLicenseKey,
} from '../../services/licensing/licenseManager.js';
import logger from '../../lib/logger.js';

export const licensingRouter = Router();

/**
 * GET /api/v1/admin/licenses
 *
 * Lists all license keys with optional status filter and pagination.
 */
licensingRouter.get('/', async (req, res) => {
  try {
    const status = (req.query.status as string) ?? 'all';
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 25;

    const result = await listLicenseKeys({ status: status as 'active' | 'activated' | 'expired' | 'revoked' | 'all', page, limit });

    res.json(result);
  } catch (error) {
    logger.error('Failed to list license keys', {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ error: 'Failed to list license keys' });
  }
});

/**
 * POST /api/v1/admin/licenses
 *
 * Creates a new license key with feature flags, credits, and tier.
 */
licensingRouter.post('/', async (req, res) => {
  try {
    const { featureFlags, initialCredits, subscriptionTier, expiresAt, notes } = req.body;

    if (!featureFlags || initialCredits == null || !subscriptionTier) {
      res.status(400).json({ error: 'featureFlags, initialCredits, and subscriptionTier are required' });
      return;
    }

    const adminId = (req as unknown as Record<string, unknown>).adminId as string ?? 'system';

    const key = await createLicenseKey({
      featureFlags,
      initialCredits,
      subscriptionTier,
      expiresAt: expiresAt ? new Date(expiresAt) : null,
      notes: notes ?? null,
      createdByAdminId: adminId,
    });

    res.status(201).json(key);
  } catch (error) {
    logger.error('Failed to create license key', {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ error: 'Failed to create license key' });
  }
});

/**
 * GET /api/v1/admin/licenses/:id
 *
 * Gets a single license key by ID with related admin and workspace info.
 */
licensingRouter.get('/:id', async (req, res) => {
  try {
    const key = await getLicenseKey(req.params.id);

    if (!key) {
      res.status(404).json({ error: 'License key not found' });
      return;
    }

    res.json(key);
  } catch (error) {
    logger.error('Failed to get license key', {
      id: req.params.id,
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ error: 'Failed to get license key' });
  }
});

/**
 * POST /api/v1/admin/licenses/:id/revoke
 *
 * Revokes a license key, preventing future use.
 */
licensingRouter.post('/:id/revoke', async (req, res) => {
  try {
    const adminId = (req as unknown as Record<string, unknown>).adminId as string ?? 'system';
    const key = await revokeLicenseKey(req.params.id, adminId);

    if (!key) {
      res.status(404).json({ error: 'License key not found' });
      return;
    }

    res.json({ success: true, revokedAt: key.revokedAt });
  } catch (error) {
    logger.error('Failed to revoke license key', {
      id: req.params.id,
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ error: 'Failed to revoke license key' });
  }
});
