/**
 * BDR management routes.
 *
 * CRUD operations for Business Development Representatives.
 * Only ADMIN role can manage BDRs.
 */

import { Router } from 'express';
import { prisma } from '../../models/index.js';
import { requireAdmin } from '../../lib/adminAuth.js';
import { logAudit } from '../../lib/auditLogger.js';
import logger from '../../lib/logger.js';

export const bdrManagementRouter = Router();

// All BDR management routes require ADMIN role.
bdrManagementRouter.use(requireAdmin);

/**
 * GET /bdrs
 * List all BDRs with client counts.
 */
bdrManagementRouter.get('/', async (req, res) => {
  try {
    const search = req.query.search as string | undefined;
    const isActive = req.query.isActive as string | undefined;

    const where: Record<string, unknown> = {};
    if (isActive !== undefined) {
      where.isActive = isActive === 'true';
    }
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { slackUserId: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [bdrs, total] = await Promise.all([
      prisma.bdr.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        include: {
          _count: { select: { clients: true } },
        },
      }),
      prisma.bdr.count({ where }),
    ]);

    res.json({
      bdrs: bdrs.map((b) => ({
        id: b.id,
        name: b.name,
        email: b.email,
        slackUserId: b.slackUserId,
        slackTeamId: b.slackTeamId,
        managerId: b.managerId ?? null,
        isActive: b.isActive,
        clientCount: b._count.clients,
        createdAt: b.createdAt.toISOString(),
        updatedAt: b.updatedAt.toISOString(),
      })),
      total,
    });
  } catch (error) {
    logger.error('Failed to list BDRs', {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ error: 'internal_error', message: 'Failed to list BDRs' });
  }
});

/**
 * GET /bdrs/:id
 * Get a single BDR with associated clients.
 */
bdrManagementRouter.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const bdr = await prisma.bdr.findUnique({
      where: { id },
      include: {
        clients: {
          include: {
            client: {
              select: {
                id: true,
                name: true,
                slug: true,
                isActive: true,
              },
            },
          },
        },
      },
    });

    if (!bdr) {
      res.status(404).json({ error: 'not_found', message: 'BDR not found' });
      return;
    }

    res.json({
      id: bdr.id,
      name: bdr.name,
      email: bdr.email,
      slackUserId: bdr.slackUserId,
      slackTeamId: bdr.slackTeamId,
      managerId: bdr.managerId ?? null,
      isActive: bdr.isActive,
      createdAt: bdr.createdAt.toISOString(),
      updatedAt: bdr.updatedAt.toISOString(),
      clients: bdr.clients.map((bc) => bc.client),
    });
  } catch (error) {
    logger.error('Failed to get BDR detail', {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ error: 'internal_error', message: 'Failed to get BDR' });
  }
});

/**
 * POST /bdrs
 * Create a new BDR.
 */
bdrManagementRouter.post('/', async (req, res) => {
  try {
    const { name, email, slackUserId, slackTeamId, managerId } = req.body;

    if (!name || !slackUserId || !slackTeamId) {
      res.status(400).json({
        error: 'bad_request',
        message: 'name, slackUserId, and slackTeamId are required',
      });
      return;
    }

    // Check for duplicate slackUserId+slackTeamId.
    const existing = await prisma.bdr.findUnique({
      where: { slackUserId_slackTeamId: { slackUserId, slackTeamId } },
    });
    if (existing) {
      res.status(409).json({
        error: 'conflict',
        message: 'A BDR with this Slack User ID already exists in this workspace',
      });
      return;
    }

    const bdr = await prisma.bdr.create({
      data: {
        name,
        email: email || null,
        managerId: managerId || null,
        slackUserId,
        slackTeamId,
      },
    });

    logAudit({
      action: 'bdr_created',
      actorUserId: req.admin!.id,
      targetType: 'Bdr',
      targetId: bdr.id,
      metadata: { name: bdr.name, slackUserId: bdr.slackUserId },
    }).catch(() => {});

    res.status(201).json({
      id: bdr.id,
      name: bdr.name,
      email: bdr.email,
      slackUserId: bdr.slackUserId,
      slackTeamId: bdr.slackTeamId,
      managerId: bdr.managerId ?? null,
      isActive: bdr.isActive,
      clientCount: 0,
      createdAt: bdr.createdAt.toISOString(),
      updatedAt: bdr.updatedAt.toISOString(),
    });
  } catch (error) {
    logger.error('Failed to create BDR', {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ error: 'internal_error', message: 'Failed to create BDR' });
  }
});

/**
 * PUT /bdrs/:id
 * Update a BDR.
 */
bdrManagementRouter.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { name, email, slackUserId, slackTeamId, isActive, managerId } = req.body;

    const existing = await prisma.bdr.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ error: 'not_found', message: 'BDR not found' });
      return;
    }

    // Check uniqueness if changing slack IDs.
    if (
      (slackUserId && slackUserId !== existing.slackUserId) ||
      (slackTeamId && slackTeamId !== existing.slackTeamId)
    ) {
      const dup = await prisma.bdr.findUnique({
        where: {
          slackUserId_slackTeamId: {
            slackUserId: slackUserId || existing.slackUserId,
            slackTeamId: slackTeamId || existing.slackTeamId,
          },
        },
      });
      if (dup && dup.id !== id) {
        res.status(409).json({
          error: 'conflict',
          message: 'A BDR with this Slack User ID already exists in this workspace',
        });
        return;
      }
    }

    const updateData: Record<string, unknown> = {};
    if (name !== undefined) updateData.name = name;
    if (email !== undefined) updateData.email = email || null;
    if (slackUserId !== undefined) updateData.slackUserId = slackUserId;
    if (slackTeamId !== undefined) updateData.slackTeamId = slackTeamId;
    if (isActive !== undefined) updateData.isActive = isActive;
    if (managerId !== undefined) updateData.managerId = managerId || null;

    const bdr = await prisma.bdr.update({
      where: { id },
      data: updateData,
      include: { _count: { select: { clients: true } } },
    });

    logAudit({
      action: 'bdr_updated',
      actorUserId: req.admin!.id,
      targetType: 'Bdr',
      targetId: id,
      metadata: { fields: Object.keys(updateData) },
    }).catch(() => {});

    res.json({
      id: bdr.id,
      name: bdr.name,
      email: bdr.email,
      slackUserId: bdr.slackUserId,
      slackTeamId: bdr.slackTeamId,
      managerId: bdr.managerId ?? null,
      isActive: bdr.isActive,
      clientCount: bdr._count.clients,
      createdAt: bdr.createdAt.toISOString(),
      updatedAt: bdr.updatedAt.toISOString(),
    });
  } catch (error) {
    logger.error('Failed to update BDR', {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ error: 'internal_error', message: 'Failed to update BDR' });
  }
});

/**
 * DELETE /bdrs/:id
 * Soft-delete a BDR (set isActive=false).
 */
bdrManagementRouter.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const existing = await prisma.bdr.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ error: 'not_found', message: 'BDR not found' });
      return;
    }

    await prisma.bdr.update({
      where: { id },
      data: { isActive: false },
    });

    logAudit({
      action: 'bdr_deactivated',
      actorUserId: req.admin!.id,
      targetType: 'Bdr',
      targetId: id,
    }).catch(() => {});

    res.json({ message: 'BDR deactivated' });
  } catch (error) {
    logger.error('Failed to deactivate BDR', {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ error: 'internal_error', message: 'Failed to deactivate BDR' });
  }
});

/**
 * POST /bdrs/:id/clients
 * Associate a client to this BDR.
 */
bdrManagementRouter.post('/:id/clients', async (req, res) => {
  try {
    const { id: bdrId } = req.params;
    const { clientId } = req.body;

    if (!clientId) {
      res.status(400).json({ error: 'bad_request', message: 'clientId is required' });
      return;
    }

    const [bdr, client] = await Promise.all([
      prisma.bdr.findUnique({ where: { id: bdrId } }),
      prisma.managedClient.findUnique({ where: { id: clientId } }),
    ]);

    if (!bdr) {
      res.status(404).json({ error: 'not_found', message: 'BDR not found' });
      return;
    }
    if (!client) {
      res.status(404).json({ error: 'not_found', message: 'Client not found' });
      return;
    }

    const existing = await prisma.bdrClient.findUnique({
      where: { bdrId_clientId: { bdrId, clientId } },
    });
    if (existing) {
      res.status(409).json({ error: 'conflict', message: 'Client is already associated with this BDR' });
      return;
    }

    await prisma.bdrClient.create({
      data: { bdrId, clientId },
    });

    logAudit({
      action: 'bdr_client_associated',
      actorUserId: req.admin!.id,
      targetType: 'BdrClient',
      metadata: { bdrId, clientId },
    }).catch(() => {});

    res.status(201).json({ message: 'Client associated with BDR' });
  } catch (error) {
    logger.error('Failed to associate client to BDR', {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ error: 'internal_error', message: 'Failed to associate client' });
  }
});

/**
 * DELETE /bdrs/:id/clients/:clientId
 * Disassociate a client from this BDR.
 */
bdrManagementRouter.delete('/:id/clients/:clientId', async (req, res) => {
  try {
    const { id: bdrId, clientId } = req.params;

    const existing = await prisma.bdrClient.findUnique({
      where: { bdrId_clientId: { bdrId, clientId } },
    });
    if (!existing) {
      res.status(404).json({ error: 'not_found', message: 'Association not found' });
      return;
    }

    await prisma.bdrClient.delete({
      where: { bdrId_clientId: { bdrId, clientId } },
    });

    logAudit({
      action: 'bdr_client_disassociated',
      actorUserId: req.admin!.id,
      targetType: 'BdrClient',
      metadata: { bdrId, clientId },
    }).catch(() => {});

    res.json({ message: 'Client disassociated from BDR' });
  } catch (error) {
    logger.error('Failed to disassociate client from BDR', {
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ error: 'internal_error', message: 'Failed to disassociate client' });
  }
});
