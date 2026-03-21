/**
 * CRM field mapping API routes.
 *
 * Routes:
 *   GET    /:connectionId/field-mappings       — List field mappings + unmapped fields
 *   POST   /:connectionId/field-mappings       — Create a single field mapping
 *   PUT    /:connectionId/field-mappings       — Bulk replace all field mappings
 *   PATCH  /:connectionId/field-mappings/:id   — Update a single mapping
 *   DELETE /:connectionId/field-mappings/:id   — Delete a single mapping
 *   POST   /:connectionId/auto-map            — Auto-detect field mappings
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { prisma } from '../../models/index.js';
import { CANONICAL_CONTACT_FIELDS } from '../../services/canonical/types.js';
import { HUBSPOT_CONTACT_FIELD_MAP } from '../../services/crm/adapters/hubspot/hubspotFieldMap.js';
import logger from '../../lib/logger.js';

export const crmFieldMappingsRouter = Router();

/**
 * GET /:connectionId/field-mappings
 * List all field mappings for a connection, plus unmapped canonical fields.
 */
crmFieldMappingsRouter.get('/:connectionId/field-mappings', async (req: Request, res: Response) => {
  try {
    const connectionId = req.params.connectionId as string;

    const mappings = await prisma.crmFieldMapping.findMany({
      where: { crmConnectionId: connectionId },
      orderBy: { displayOrder: 'asc' },
    });

    // Determine unmapped canonical fields
    const mappedFields = new Set(mappings.map((m) => m.canonicalField));
    const unmappedCanonicalFields = CANONICAL_CONTACT_FIELDS.filter(
      (f) => !mappedFields.has(f),
    );

    res.json({ mappings, unmappedCanonicalFields });
  } catch (err) {
    logger.error('Failed to list field mappings', { error: err });
    res.status(500).json({ error: 'Failed to list field mappings' });
  }
});

/**
 * POST /:connectionId/field-mappings
 * Create a single field mapping.
 */
crmFieldMappingsRouter.post('/:connectionId/field-mappings', async (req: Request, res: Response) => {
  try {
    const connectionId = req.params.connectionId as string;
    const {
      canonicalField,
      crmProperty,
      crmPropertyLabel,
      dataType,
      transformRule,
      isRequired,
      syncDirection,
      overwriteExisting,
      displayOrder,
    } = req.body;

    if (!canonicalField || !crmProperty) {
      return res.status(400).json({ error: 'canonicalField and crmProperty are required' });
    }

    const mapping = await prisma.crmFieldMapping.create({
      data: {
        crmConnectionId: connectionId,
        canonicalField,
        crmProperty,
        crmPropertyLabel,
        dataType: dataType || 'string',
        transformRule,
        isRequired: isRequired ?? false,
        syncDirection: syncDirection || 'TO_CRM',
        overwriteExisting: overwriteExisting ?? true,
        displayOrder: displayOrder ?? 0,
      },
    });

    res.status(201).json({ mapping });
  } catch (err) {
    logger.error('Failed to create field mapping', { error: err });
    res.status(500).json({ error: 'Failed to create field mapping' });
  }
});

/**
 * PUT /:connectionId/field-mappings
 * Bulk replace all field mappings for a connection.
 */
crmFieldMappingsRouter.put('/:connectionId/field-mappings', async (req: Request, res: Response) => {
  try {
    const connectionId = req.params.connectionId as string;
    const { mappings } = req.body;

    if (!Array.isArray(mappings)) {
      return res.status(400).json({ error: 'mappings array is required' });
    }

    // Delete existing and recreate in a transaction
    const result = await prisma.$transaction(async (tx) => {
      await tx.crmFieldMapping.deleteMany({
        where: { crmConnectionId: connectionId },
      });

      const created = await Promise.all(
        mappings.map((m: any, index: number) =>
          tx.crmFieldMapping.create({
            data: {
              crmConnectionId: connectionId,
              canonicalField: m.canonicalField,
              crmProperty: m.crmProperty,
              crmPropertyLabel: m.crmPropertyLabel,
              dataType: m.dataType || 'string',
              transformRule: m.transformRule,
              isRequired: m.isRequired ?? false,
              syncDirection: m.syncDirection || 'TO_CRM',
              overwriteExisting: m.overwriteExisting ?? true,
              displayOrder: m.displayOrder ?? index,
            },
          }),
        ),
      );

      return created;
    });

    logger.info('Field mappings bulk updated', {
      connectionId,
      count: result.length,
    });

    res.json({ mappings: result });
  } catch (err) {
    logger.error('Failed to bulk update field mappings', { error: err });
    res.status(500).json({ error: 'Failed to bulk update field mappings' });
  }
});

/**
 * PATCH /:connectionId/field-mappings/:id
 * Update a single field mapping.
 */
crmFieldMappingsRouter.patch('/:connectionId/field-mappings/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const updateData: Record<string, any> = {};

    // Only update fields that are provided
    const allowedFields = [
      'canonicalField', 'crmProperty', 'crmPropertyLabel', 'dataType',
      'transformRule', 'isRequired', 'syncDirection', 'overwriteExisting', 'displayOrder',
    ];

    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        updateData[field] = req.body[field];
      }
    }

    const mapping = await prisma.crmFieldMapping.update({
      where: { id },
      data: updateData,
    });

    res.json({ mapping });
  } catch (err) {
    logger.error('Failed to update field mapping', { error: err });
    res.status(500).json({ error: 'Failed to update field mapping' });
  }
});

/**
 * DELETE /:connectionId/field-mappings/:id
 * Delete a single field mapping.
 */
crmFieldMappingsRouter.delete('/:connectionId/field-mappings/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    await prisma.crmFieldMapping.delete({
      where: { id },
    });

    res.status(204).send();
  } catch (err) {
    logger.error('Failed to delete field mapping', { error: err });
    res.status(500).json({ error: 'Failed to delete field mapping' });
  }
});

/**
 * POST /:connectionId/auto-map
 * Auto-detect field mappings by matching canonical fields to CRM properties.
 */
crmFieldMappingsRouter.post('/:connectionId/auto-map', async (req: Request, res: Response) => {
  try {
    const connectionId = req.params.connectionId as string;

    // Get the CRM connection to determine type
    const connection = await prisma.crmConnection.findUniqueOrThrow({
      where: { id: connectionId },
    });

    // Get existing mappings to avoid duplicates
    const existingMappings = await prisma.crmFieldMapping.findMany({
      where: { crmConnectionId: connectionId },
      select: { canonicalField: true },
    });
    const alreadyMapped = new Set(existingMappings.map((m) => m.canonicalField));

    // Use the default field map for the CRM type
    let defaultMap: Record<string, string | null>;
    if (connection.crmType === 'HUBSPOT') {
      defaultMap = HUBSPOT_CONTACT_FIELD_MAP;
    } else {
      return res.status(400).json({
        error: `Auto-map not available for CRM type: ${connection.crmType}`,
      });
    }

    // Create mappings for unmapped fields that have a default mapping
    const created = [];
    let displayOrder = existingMappings.length;

    for (const [canonicalField, crmProperty] of Object.entries(defaultMap)) {
      if (!crmProperty || alreadyMapped.has(canonicalField)) continue;

      const mapping = await prisma.crmFieldMapping.create({
        data: {
          crmConnectionId: connectionId,
          canonicalField,
          crmProperty,
          dataType: 'string',
          syncDirection: 'TO_CRM',
          overwriteExisting: true,
          displayOrder: displayOrder++,
        },
      });
      created.push(mapping);
    }

    logger.info('Auto-map field mappings created', {
      connectionId,
      count: created.length,
    });

    res.json({ mappings: created, count: created.length });
  } catch (err) {
    logger.error('Failed to auto-map field mappings', { error: err });
    res.status(500).json({ error: 'Failed to auto-map field mappings' });
  }
});
