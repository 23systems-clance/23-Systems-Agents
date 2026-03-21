/**
 * Analytics Saved Views Routes (T088)
 *
 * GET    /admin/saved-views     — List saved views for user
 * POST   /admin/saved-views     — Create a saved view
 * PUT    /admin/saved-views/:id — Update a saved view
 * DELETE /admin/saved-views/:id — Delete a saved view
 */

import { Router, type Request, type Response } from 'express';
import { prisma } from '../../models/index.js';
import logger from '../../lib/logger.js';

const router = Router();

/**
 * Extract admin user ID from the request.
 * Falls back to 'system' when no admin session is present.
 */
function getAdminUserId(req: Request): string {
  return (req as any).adminUser?.id ?? 'system';
}

/* ------------------------------------------------------------------ */
/*  GET / — List saved views for the current user                      */
/* ------------------------------------------------------------------ */

router.get('/', async (req: Request, res: Response) => {
  try {
    const clientId = (req.query.clientId as string) || '';
    const createdBy = getAdminUserId(req);

    const where: Record<string, any> = { createdBy };
    if (clientId) where.clientId = clientId;

    const views = await (prisma as any).analyticsSavedView.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });

    res.json(views);
  } catch (error: any) {
    logger.error('[SavedViews] Failed to list saved views', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

/* ------------------------------------------------------------------ */
/*  POST / — Create a new saved view                                   */
/* ------------------------------------------------------------------ */

router.post('/', async (req: Request, res: Response) => {
  try {
    const { name, tab, filters, clientId } = req.body;

    if (!name || !tab || !clientId) {
      res.status(400).json({ error: 'name, tab, and clientId are required' });
      return;
    }

    const createdBy = getAdminUserId(req);

    const view = await (prisma as any).analyticsSavedView.create({
      data: {
        name,
        tab,
        filters: filters ?? {},
        createdBy,
        clientId,
      },
    });

    res.status(201).json(view);
  } catch (error: any) {
    logger.error('[SavedViews] Failed to create saved view', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

/* ------------------------------------------------------------------ */
/*  PUT /:id — Update an existing saved view                           */
/* ------------------------------------------------------------------ */

router.put('/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const createdBy = getAdminUserId(req);

    // Verify ownership
    const existing = await (prisma as any).analyticsSavedView.findUnique({
      where: { id },
    });

    if (!existing) {
      res.status(404).json({ error: 'Saved view not found' });
      return;
    }

    if (existing.createdBy !== createdBy) {
      res.status(403).json({ error: 'You can only update your own saved views' });
      return;
    }

    const { name, tab, filters } = req.body;
    const data: Record<string, any> = {};
    if (name !== undefined) data.name = name;
    if (tab !== undefined) data.tab = tab;
    if (filters !== undefined) data.filters = filters;

    const updated = await (prisma as any).analyticsSavedView.update({
      where: { id },
      data,
    });

    res.json(updated);
  } catch (error: any) {
    logger.error('[SavedViews] Failed to update saved view', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

/* ------------------------------------------------------------------ */
/*  DELETE /:id — Delete a saved view                                  */
/* ------------------------------------------------------------------ */

router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const createdBy = getAdminUserId(req);

    // Verify ownership
    const existing = await (prisma as any).analyticsSavedView.findUnique({
      where: { id },
    });

    if (!existing) {
      res.status(404).json({ error: 'Saved view not found' });
      return;
    }

    if (existing.createdBy !== createdBy) {
      res.status(403).json({ error: 'You can only delete your own saved views' });
      return;
    }

    await (prisma as any).analyticsSavedView.delete({ where: { id } });

    res.json({ success: true, id });
  } catch (error: any) {
    logger.error('[SavedViews] Failed to delete saved view', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

export { router as savedViewsRouter };
