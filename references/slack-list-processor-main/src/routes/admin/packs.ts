/**
 * Vertical Packs admin API routes (Feature 39 - Vertical Pack Platform).
 *
 * CRUD for packs, skill assignment, publish/deprecate.
 * Per contracts/packs-api.yaml.
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import {
  createPack,
  getPack,
  listPacks,
  updatePack,
  publishPack,
  deprecatePack,
  assignSkills,
} from '../../services/platform/packManager.js';
import {
  createPackSchema,
  updatePackSchema,
  listPacksQuerySchema,
  assignSkillsSchema,
  validateBody,
  validateQuery,
} from '../../lib/platformValidation.js';
import logger from '../../lib/logger.js';

export const packAdminRouter = Router();

/**
 * GET /api/v1/admin/packs
 * List all packs with optional status and category filters.
 */
packAdminRouter.get('/', async (req: Request, res: Response) => {
  try {
    const query = validateQuery(listPacksQuerySchema, req.query, res);
    if (!query) return;

    const packs = await listPacks({
      status: query.status as any,
      category: query.category as any,
    });
    res.json({ packs });
  } catch (error) {
    logger.error('Failed to list packs', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ error: 'Failed to list packs' });
  }
});

/**
 * POST /api/v1/admin/packs
 * Create a new vertical pack.
 */
packAdminRouter.post('/', async (req: Request, res: Response) => {
  const data = validateBody(createPackSchema, req.body, res);
  if (!data) return;

  try {
    const pack = await createPack(data);
    res.status(201).json(pack);
  } catch (error) {
    logger.error('Failed to create pack', { error: error instanceof Error ? error.message : String(error) });
    if (error instanceof Error && error.message.includes('Unique constraint')) {
      res.status(409).json({ error: `Pack with slug "${data.slug}" already exists` });
      return;
    }
    res.status(400).json({ error: error instanceof Error ? error.message : 'Failed to create pack' });
  }
});

/**
 * GET /api/v1/admin/packs/:packId
 * Get pack details with skills and analytics.
 */
packAdminRouter.get('/:packId', async (req: Request, res: Response) => {
  try {
    const pack = await getPack(req.params.packId as string);
    if (!pack) {
      res.status(404).json({ error: 'Pack not found' });
      return;
    }
    res.json(pack);
  } catch (error) {
    logger.error('Failed to get pack', { packId: req.params.packId as string, error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ error: 'Failed to get pack' });
  }
});

/**
 * PUT /api/v1/admin/packs/:packId
 * Update pack.
 */
packAdminRouter.put('/:packId', async (req: Request, res: Response) => {
  const data = validateBody(updatePackSchema, req.body, res);
  if (!data) return;

  try {
    const pack = await updatePack(req.params.packId as string, data);
    res.json(pack);
  } catch (error) {
    logger.error('Failed to update pack', { packId: req.params.packId as string, error: error instanceof Error ? error.message : String(error) });
    if (error instanceof Error && error.message.includes('not found')) {
      res.status(404).json({ error: error.message });
      return;
    }
    res.status(400).json({ error: error instanceof Error ? error.message : 'Failed to update pack' });
  }
});

/**
 * POST /api/v1/admin/packs/:packId/publish
 * Publish pack.
 */
packAdminRouter.post('/:packId/publish', async (req: Request, res: Response) => {
  try {
    const pack = await publishPack(req.params.packId as string);
    res.json(pack);
  } catch (error) {
    logger.error('Failed to publish pack', { packId: req.params.packId as string, error: error instanceof Error ? error.message : String(error) });
    if (error instanceof Error && error.message.includes('not found')) {
      res.status(404).json({ error: error.message });
      return;
    }
    res.status(400).json({ error: error instanceof Error ? error.message : 'Failed to publish pack' });
  }
});

/**
 * POST /api/v1/admin/packs/:packId/deprecate
 * Deprecate pack.
 */
packAdminRouter.post('/:packId/deprecate', async (req: Request, res: Response) => {
  try {
    const pack = await deprecatePack(req.params.packId as string);
    res.json(pack);
  } catch (error) {
    logger.error('Failed to deprecate pack', { packId: req.params.packId as string, error: error instanceof Error ? error.message : String(error) });
    if (error instanceof Error && error.message.includes('not found')) {
      res.status(404).json({ error: error.message });
      return;
    }
    res.status(400).json({ error: error instanceof Error ? error.message : 'Failed to deprecate pack' });
  }
});

/**
 * PUT /api/v1/admin/packs/:packId/skills
 * Assign skills to a pack (replaces all).
 */
packAdminRouter.put('/:packId/skills', async (req: Request, res: Response) => {
  const data = validateBody(assignSkillsSchema, req.body, res);
  if (!data) return;

  try {
    await assignSkills(req.params.packId as string, data.skillIds);
    res.json({ success: true });
  } catch (error) {
    logger.error('Failed to assign skills', { packId: req.params.packId as string, error: error instanceof Error ? error.message : String(error) });
    res.status(400).json({ error: error instanceof Error ? error.message : 'Failed to assign skills' });
  }
});
