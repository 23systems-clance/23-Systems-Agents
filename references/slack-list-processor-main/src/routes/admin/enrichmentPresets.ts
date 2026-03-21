/**
 * Enrichment preset CRUD endpoints.
 *
 * GET    /api/v1/admin/enrichment-presets       — List all presets
 * GET    /api/v1/admin/enrichment-presets/:id   — Get a single preset
 * POST   /api/v1/admin/enrichment-presets       — Create a new preset
 * PUT    /api/v1/admin/enrichment-presets/:id   — Update a preset
 * DELETE /api/v1/admin/enrichment-presets/:id   — Delete a preset
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { prisma } from '../../models/index.js';
import { logAudit } from '../../lib/auditLogger.js';
import { APOLLO_SENIORITY_OPTIONS } from '../../types/enrichmentFilters.js';

export const enrichmentPresetsRouter = Router();

/** Valid seniority values accepted by Apollo. */
const VALID_SENIORITIES: string[] = APOLLO_SENIORITY_OPTIONS.map((o) => o.value);

/**
 * Maps a Prisma EnrichmentPreset record to the API response shape.
 *
 * @param preset - Prisma record.
 * @returns API-safe response object.
 */
/** Valid scope values. */
const VALID_SCOPES = ['global', 'private'] as const;

function toResponse(preset: {
  id: string;
  name: string;
  isDefault: boolean;
  scope: string;
  personSeniorities: string[];
  personTitles: string[];
  personDepartments: string[];
  personFunctions: string[];
  perPage: number;
  createdByUserId: string;
  createdByName: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: preset.id,
    name: preset.name,
    isDefault: preset.isDefault,
    scope: preset.scope,
    personSeniorities: preset.personSeniorities,
    personTitles: preset.personTitles,
    personDepartments: preset.personDepartments,
    personFunctions: preset.personFunctions,
    perPage: preset.perPage,
    createdByUserId: preset.createdByUserId,
    createdByName: preset.createdByName,
    createdAt: preset.createdAt,
    updatedAt: preset.updatedAt,
  };
}

// ---------------------------------------------------------------------------
// GET / — List all presets
// ---------------------------------------------------------------------------

enrichmentPresetsRouter.get('/', async (_req: Request, res: Response) => {
  try {
    const presets = await prisma.enrichmentPreset.findMany({
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
    });

    res.json({
      presets: presets.map(toResponse),
      total: presets.length,
    });
  } catch (error) {
    res.status(500).json({
      error: 'internal_error',
      message: 'An unexpected error occurred',
    });
  }
});

// ---------------------------------------------------------------------------
// GET /:id — Get a single preset
// ---------------------------------------------------------------------------

enrichmentPresetsRouter.get('/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params['id'] as string;

    const preset = await prisma.enrichmentPreset.findUnique({ where: { id } });
    if (!preset) {
      res.status(404).json({ error: 'not_found', message: 'Preset not found' });
      return;
    }

    res.json(toResponse(preset));
  } catch (error) {
    res.status(500).json({
      error: 'internal_error',
      message: 'An unexpected error occurred',
    });
  }
});

// ---------------------------------------------------------------------------
// POST / — Create a new preset
// ---------------------------------------------------------------------------

enrichmentPresetsRouter.post('/', async (req: Request, res: Response) => {
  try {
    const {
      name,
      isDefault,
      scope,
      personSeniorities,
      personTitles,
      personDepartments,
      personFunctions,
      perPage,
    } = req.body;

    // Validation
    if (!name || typeof name !== 'string' || !name.trim()) {
      res.status(400).json({
        error: 'validation_error',
        message: 'name is required',
      });
      return;
    }

    if (!personSeniorities || !Array.isArray(personSeniorities) || personSeniorities.length === 0) {
      res.status(400).json({
        error: 'validation_error',
        message: 'personSeniorities must be a non-empty array',
      });
      return;
    }

    const invalidSeniorities = personSeniorities.filter(
      (s: string) => !VALID_SENIORITIES.includes(s),
    );
    if (invalidSeniorities.length > 0) {
      res.status(400).json({
        error: 'validation_error',
        message: `Invalid seniority values: ${invalidSeniorities.join(', ')}. Valid values: ${VALID_SENIORITIES.join(', ')}`,
      });
      return;
    }

    if (perPage !== undefined && (typeof perPage !== 'number' || perPage < 1 || perPage > 100)) {
      res.status(400).json({
        error: 'validation_error',
        message: 'perPage must be a number between 1 and 100',
      });
      return;
    }

    if (scope !== undefined && !VALID_SCOPES.includes(scope)) {
      res.status(400).json({
        error: 'validation_error',
        message: `Invalid scope: ${scope}. Valid values: ${VALID_SCOPES.join(', ')}`,
      });
      return;
    }

    // Private presets cannot be the default
    if (isDefault && scope === 'private') {
      res.status(400).json({
        error: 'validation_error',
        message: 'A private preset cannot be set as the default. Only global presets can be default.',
      });
      return;
    }

    const adminId = req.admin!.id;
    const adminName = req.admin!.name;

    // If setting as default, unset the current default first
    if (isDefault) {
      await prisma.enrichmentPreset.updateMany({
        where: { isDefault: true },
        data: { isDefault: false },
      });
    }

    const preset = await prisma.enrichmentPreset.create({
      data: {
        name: name.trim(),
        isDefault: isDefault ?? false,
        scope: scope ?? 'global',
        personSeniorities,
        personTitles: personTitles ?? [],
        personDepartments: personDepartments ?? [],
        personFunctions: personFunctions ?? [],
        perPage: perPage ?? 25,
        createdByUserId: adminId,
        createdByName: adminName,
      },
    });

    await logAudit({
      action: 'preset_created',
      actorUserId: adminId,
      actorTeamId: 'admin',
      targetType: 'enrichment_preset',
      targetId: preset.id,
      metadata: {
        name: preset.name,
        isDefault: preset.isDefault,
        personSeniorities: preset.personSeniorities,
      },
    });

    res.status(201).json(toResponse(preset));
  } catch (error) {
    res.status(500).json({
      error: 'internal_error',
      message: 'An unexpected error occurred',
    });
  }
});

// ---------------------------------------------------------------------------
// PUT /:id — Update a preset
// ---------------------------------------------------------------------------

enrichmentPresetsRouter.put('/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params['id'] as string;

    const existing = await prisma.enrichmentPreset.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ error: 'not_found', message: 'Preset not found' });
      return;
    }

    const {
      name,
      isDefault,
      scope,
      personSeniorities,
      personTitles,
      personDepartments,
      personFunctions,
      perPage,
    } = req.body;

    // Validate scope if provided
    if (scope !== undefined && !VALID_SCOPES.includes(scope)) {
      res.status(400).json({
        error: 'validation_error',
        message: `Invalid scope: ${scope}. Valid values: ${VALID_SCOPES.join(', ')}`,
      });
      return;
    }

    // Private presets cannot be the default
    const effectiveScope = scope ?? existing.scope;
    const effectiveIsDefault = isDefault ?? existing.isDefault;
    if (effectiveIsDefault && effectiveScope === 'private') {
      res.status(400).json({
        error: 'validation_error',
        message: 'A private preset cannot be set as the default. Only global presets can be default.',
      });
      return;
    }

    // Validate seniorities if provided
    if (personSeniorities !== undefined) {
      if (!Array.isArray(personSeniorities) || personSeniorities.length === 0) {
        res.status(400).json({
          error: 'validation_error',
          message: 'personSeniorities must be a non-empty array',
        });
        return;
      }

      const invalidSeniorities = personSeniorities.filter(
        (s: string) => !VALID_SENIORITIES.includes(s),
      );
      if (invalidSeniorities.length > 0) {
        res.status(400).json({
          error: 'validation_error',
          message: `Invalid seniority values: ${invalidSeniorities.join(', ')}`,
        });
        return;
      }
    }

    if (perPage !== undefined && (typeof perPage !== 'number' || perPage < 1 || perPage > 100)) {
      res.status(400).json({
        error: 'validation_error',
        message: 'perPage must be a number between 1 and 100',
      });
      return;
    }

    // If setting as default, unset the current default first
    if (isDefault === true && !existing.isDefault) {
      await prisma.enrichmentPreset.updateMany({
        where: { isDefault: true },
        data: { isDefault: false },
      });
    }

    const data: Record<string, unknown> = {};
    if (name !== undefined) data.name = name.trim();
    if (isDefault !== undefined) data.isDefault = isDefault;
    if (scope !== undefined) data.scope = scope;
    if (personSeniorities !== undefined) data.personSeniorities = personSeniorities;
    if (personTitles !== undefined) data.personTitles = personTitles;
    if (personDepartments !== undefined) data.personDepartments = personDepartments;
    if (personFunctions !== undefined) data.personFunctions = personFunctions;
    if (perPage !== undefined) data.perPage = perPage;

    const updated = await prisma.enrichmentPreset.update({
      where: { id },
      data,
    });

    await logAudit({
      action: 'preset_updated',
      actorUserId: req.admin!.id,
      actorTeamId: 'admin',
      targetType: 'enrichment_preset',
      targetId: updated.id,
      metadata: { changes: req.body },
    });

    res.json(toResponse(updated));
  } catch (error) {
    res.status(500).json({
      error: 'internal_error',
      message: 'An unexpected error occurred',
    });
  }
});

// ---------------------------------------------------------------------------
// DELETE /:id — Delete a preset
// ---------------------------------------------------------------------------

enrichmentPresetsRouter.delete('/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params['id'] as string;

    const existing = await prisma.enrichmentPreset.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ error: 'not_found', message: 'Preset not found' });
      return;
    }

    if (existing.isDefault) {
      res.status(400).json({
        error: 'validation_error',
        message: 'Cannot delete the default preset. Set another preset as default first.',
      });
      return;
    }

    await prisma.enrichmentPreset.delete({ where: { id } });

    await logAudit({
      action: 'preset_deleted',
      actorUserId: req.admin!.id,
      actorTeamId: 'admin',
      targetType: 'enrichment_preset',
      targetId: id,
      metadata: { name: existing.name },
    });

    res.status(204).send();
  } catch (error) {
    res.status(500).json({
      error: 'internal_error',
      message: 'An unexpected error occurred',
    });
  }
});
