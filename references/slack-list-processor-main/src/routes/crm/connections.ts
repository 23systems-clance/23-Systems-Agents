/**
 * CRM connection API routes.
 *
 * Routes:
 *   GET    /                   — List all CRM connections (optional ?clientId filter)
 *   POST   /                   — Create a new CRM connection
 *   GET    /:id                — Get connection details
 *   DELETE /:id                — Disconnect (soft delete)
 *   GET    /:id/properties     — Fetch CRM properties via adapter
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { prisma } from '../../models/index.js';
import { getAdapter } from '../../services/crm/crmAdapterRegistry.js';
import { HUBSPOT_CONTACT_FIELD_MAP } from '../../services/crm/adapters/hubspot/hubspotFieldMap.js';
import logger from '../../lib/logger.js';

export const crmConnectionsRouter = Router();

/**
 * GET /
 * List all CRM connections. Optional ?clientId filter.
 */
crmConnectionsRouter.get('/', async (req: Request, res: Response) => {
  try {
    const { clientId } = req.query;
    const where = clientId ? { clientId: String(clientId) } : {};

    const connections = await prisma.crmConnection.findMany({
      where,
      include: {
        client: { select: { id: true, name: true } },
        hubspotConnection: { select: { id: true, hubspotPortalId: true, hubspotPortalName: true } },
        _count: { select: { fieldMappings: true, pushRecords: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ connections });
  } catch (err) {
    logger.error('Failed to list CRM connections', { error: err });
    res.status(500).json({ error: 'Failed to list CRM connections' });
  }
});

/**
 * POST /
 * Create a new CRM connection.
 */
crmConnectionsRouter.post('/', async (req: Request, res: Response) => {
  try {
    const { clientId, crmType, displayName, hubspotConnectionId } = req.body;

    if (!clientId || !crmType) {
      return res.status(400).json({ error: 'clientId and crmType are required' });
    }

    // Check for existing connection of same type for this client
    const existing = await prisma.crmConnection.findUnique({
      where: { clientId_crmType: { clientId, crmType } },
    });

    if (existing) {
      return res.status(409).json({
        error: `A ${crmType} connection already exists for this client`,
        connectionId: existing.id,
      });
    }

    const connection = await prisma.crmConnection.create({
      data: {
        clientId,
        crmType,
        displayName,
        hubspotConnectionId,
        status: 'ACTIVE',
      },
      include: {
        client: { select: { id: true, name: true } },
      },
    });

    // Auto-populate default field mappings based on CRM type
    let mappingsCreated = 0;
    if (crmType === 'HUBSPOT') {
      let displayOrder = 0;
      for (const [canonicalField, crmProperty] of Object.entries(HUBSPOT_CONTACT_FIELD_MAP)) {
        if (!crmProperty) continue;
        try {
          await prisma.crmFieldMapping.create({
            data: {
              crmConnectionId: connection.id,
              canonicalField,
              crmProperty,
              dataType: 'string',
              syncDirection: 'TO_CRM',
              overwriteExisting: true,
              displayOrder: displayOrder++,
            },
          });
          mappingsCreated++;
        } catch {
          // Skip duplicate mappings
        }
      }
    }

    logger.info('CRM connection created', {
      connectionId: connection.id,
      clientId,
      crmType,
      defaultMappings: mappingsCreated,
    });

    res.status(201).json({ connection, defaultMappingsCreated: mappingsCreated });
  } catch (err) {
    logger.error('Failed to create CRM connection', { error: err });
    res.status(500).json({ error: 'Failed to create CRM connection' });
  }
});

/**
 * GET /:id
 * Get CRM connection details.
 */
crmConnectionsRouter.get('/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const connection = await prisma.crmConnection.findUnique({
      where: { id },
      include: {
        client: { select: { id: true, name: true } },
        hubspotConnection: { select: { id: true, hubspotPortalId: true, hubspotPortalName: true, status: true } },
        fieldMappings: { orderBy: { displayOrder: 'asc' } },
        _count: { select: { pushRecords: true } },
      },
    });

    if (!connection) {
      return res.status(404).json({ error: 'CRM connection not found' });
    }

    res.json({ connection });
  } catch (err) {
    logger.error('Failed to get CRM connection', { error: err });
    res.status(500).json({ error: 'Failed to get CRM connection' });
  }
});

/**
 * DELETE /:id
 * Disconnect a CRM connection (sets status to DISCONNECTED).
 */
crmConnectionsRouter.delete('/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const connection = await prisma.crmConnection.findUnique({
      where: { id },
    });

    if (!connection) {
      return res.status(404).json({ error: 'CRM connection not found' });
    }

    const updated = await prisma.crmConnection.update({
      where: { id },
      data: { status: 'DISCONNECTED' },
    });

    logger.info('CRM connection disconnected', { connectionId: id });
    res.json({ connection: updated });
  } catch (err) {
    logger.error('Failed to disconnect CRM connection', { error: err });
    res.status(500).json({ error: 'Failed to disconnect CRM connection' });
  }
});

/**
 * GET /:id/properties
 * Fetch available CRM properties via the adapter (cached 1hr in Redis).
 */
crmConnectionsRouter.get('/:id/properties', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const connection = await prisma.crmConnection.findUnique({
      where: { id },
    });

    if (!connection) {
      return res.status(404).json({ error: 'CRM connection not found' });
    }

    const adapter = getAdapter(connection.crmType);
    const properties = await adapter.getProperties(id);

    res.json({ properties });
  } catch (err) {
    logger.error('Failed to fetch CRM properties', { error: err });
    res.status(500).json({ error: 'Failed to fetch CRM properties' });
  }
});
