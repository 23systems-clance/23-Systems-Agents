/**
 * Retention configuration endpoints.
 *
 * GET /api/v1/admin/retention                — List all retention configs
 * PUT /api/v1/admin/retention/:data_type     — Update a retention config
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { prisma } from '../../models/index.js';
import { logAudit } from '../../lib/auditLogger.js';

export const retentionRouter = Router();

/**
 * Data types that cannot be modified (permanent retention).
 */
const LOCKED_TYPES = new Set(['audit_logs', 'daily_aggregates']);

/**
 * Minimum retention days for purgeable types.
 */
const MIN_RETENTION_DAYS = 30;

// ---------------------------------------------------------------------------
// GET / — List retention configs
// ---------------------------------------------------------------------------

retentionRouter.get('/', async (_req: Request, res: Response) => {
  try {
    const configs = await prisma.retentionConfig.findMany({
      orderBy: { dataType: 'asc' },
    });

    res.json({
      configs: configs.map((c) => ({
        data_type: c.dataType,
        retention_days: c.retentionDays,
        last_purged_at: c.lastPurgedAt,
        locked: LOCKED_TYPES.has(c.dataType),
      })),
    });
  } catch (error) {
    res.status(500).json({
      error: 'internal_error',
      message: 'An unexpected error occurred',
    });
  }
});

// ---------------------------------------------------------------------------
// PUT /:data_type — Update retention config
// ---------------------------------------------------------------------------

retentionRouter.put('/:data_type', async (req: Request, res: Response) => {
  try {
    const dataType = req.params['data_type'] as string;
    const { retention_days } = req.body;

    if (retention_days == null || typeof retention_days !== 'number') {
      res.status(400).json({
        error: 'validation_error',
        message: 'retention_days is required and must be a number',
      });
      return;
    }

    // Check if type is locked.
    if (LOCKED_TYPES.has(dataType)) {
      res.status(400).json({
        error: 'validation_error',
        message: `${dataType} is locked and cannot be modified`,
      });
      return;
    }

    // Enforce minimum retention.
    if (retention_days < MIN_RETENTION_DAYS) {
      res.status(400).json({
        error: 'validation_error',
        message: `Minimum retention is ${MIN_RETENTION_DAYS} days for purgeable types`,
      });
      return;
    }

    const existing = await prisma.retentionConfig.findUnique({
      where: { dataType },
    });

    if (!existing) {
      res.status(404).json({
        error: 'not_found',
        message: `Retention config for ${dataType} not found`,
      });
      return;
    }

    const updated = await prisma.retentionConfig.update({
      where: { dataType },
      data: {
        retentionDays: retention_days,
        updatedBy: req.admin!.id,
      },
    });

    // Fetch admin name for response.
    const admin = await prisma.adminUser.findUnique({
      where: { id: req.admin!.id },
      select: { id: true, name: true },
    });

    await logAudit({
      action: 'retention_updated',
      actorUserId: req.admin!.id,
      actorTeamId: 'admin',
      metadata: {
        dataType,
        retentionDays: retention_days,
        previousRetentionDays: existing.retentionDays,
      },
    });

    res.json({
      data_type: updated.dataType,
      retention_days: updated.retentionDays,
      updated_by: admin ? { id: admin.id, name: admin.name } : null,
      updated_at: updated.updatedAt,
    });
  } catch (error) {
    res.status(500).json({
      error: 'internal_error',
      message: 'An unexpected error occurred',
    });
  }
});
