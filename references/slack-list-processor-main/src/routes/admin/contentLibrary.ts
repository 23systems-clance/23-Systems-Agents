/**
 * Content library admin endpoints (Feature 7 — BDR Onboarding).
 *
 * GET    /api/v1/admin/content-library              — List items (filtered)
 * POST   /api/v1/admin/content-library              — Create item
 * GET    /api/v1/admin/content-library/categories    — Get category tag counts
 * PUT    /api/v1/admin/content-library/:itemId       — Update item
 * DELETE /api/v1/admin/content-library/:itemId       — Delete item
 *
 * Auth: adminAuth middleware is applied by the parent router.
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import * as contentLibraryService from '../../services/onboarding/contentLibraryService.js';
import { logError } from '../../services/admin/errorLogger.js';
import logger from '../../lib/logger.js';

export const contentLibraryRouter = Router();

// ---------------------------------------------------------------------------
// Helper — snake_case response mapper
// ---------------------------------------------------------------------------

/**
 * Maps a Prisma ContentLibraryItem record to the snake_case API contract.
 *
 * @param item - A ContentLibraryItem record from Prisma.
 * @returns The item with keys in snake_case format.
 */
function toSnakeCase(item: Record<string, unknown>) {
  return {
    id: item.id,
    type: item.type,
    title: item.title,
    content: item.content ?? null,
    metadata: item.metadata ?? null,
    estimated_minutes: item.estimatedMinutes ?? null,
    category_tags: item.categoryTags,
    usage_count: item.usageCount,
    created_by_user_id: item.createdByUserId,
    created_at: item.createdAt,
    updated_at: item.updatedAt,
  };
}

// ---------------------------------------------------------------------------
// GET / — List items with filters
// ---------------------------------------------------------------------------

/**
 * Lists content library items for a workspace.
 *
 * Query params:
 *   - teamId (required) — Slack workspace ID
 *   - type (optional)   — TrainingItemType filter
 *   - category (optional) — category tag filter
 *   - search (optional) — case-insensitive title search
 */
contentLibraryRouter.get('/', async (req: Request, res: Response) => {
  try {
    const teamId = req.query.teamId as string;
    if (!teamId) {
      return res.status(400).json({ error: 'missing_param', message: 'teamId is required' });
    }

    const filters: contentLibraryService.ListItemsFilters = {
      teamId,
      type: req.query.type as any,
      category: req.query.category as string | undefined,
      search: req.query.search as string | undefined,
    };

    const { items, total } = await contentLibraryService.listItems(filters);

    res.json({
      items: items.map((item) => toSnakeCase(item as unknown as Record<string, unknown>)),
      total,
    });
  } catch (error) {
    logger.error('Failed to list content library items', { error });
    logError({
      category: 'SYSTEM_ERROR',
      service: 'admin:content-library',
      message: error instanceof Error ? error.message : String(error),
      stackTrace: error instanceof Error ? error.stack : undefined,
    });
    res.status(500).json({ error: 'internal_error', message: 'An unexpected error occurred' });
  }
});

// ---------------------------------------------------------------------------
// POST / — Create item
// ---------------------------------------------------------------------------

/**
 * Creates a new content library item.
 *
 * Body (JSON):
 *   - slack_team_id (required)
 *   - type (required) — TrainingItemType
 *   - title (required)
 *   - content (optional)
 *   - metadata (optional)
 *   - estimated_minutes (optional)
 *   - category_tags (optional)
 *   - created_by_user_id (optional, defaults to 'admin')
 */
contentLibraryRouter.post('/', async (req: Request, res: Response) => {
  try {
    const body = req.body;

    if (!body.slack_team_id || !body.type || !body.title) {
      return res.status(400).json({
        error: 'missing_param',
        message: 'slack_team_id, type, and title are required',
      });
    }

    const item = await contentLibraryService.createItem({
      slackTeamId: body.slack_team_id,
      type: body.type,
      title: body.title,
      content: body.content,
      metadata: body.metadata,
      estimatedMinutes: body.estimated_minutes,
      categoryTags: body.category_tags,
      createdByUserId: body.created_by_user_id || 'admin',
    });

    res.status(201).json({ item: toSnakeCase(item as unknown as Record<string, unknown>) });
  } catch (error) {
    logger.error('Failed to create content library item', { error });
    logError({
      category: 'SYSTEM_ERROR',
      service: 'admin:content-library',
      message: error instanceof Error ? error.message : String(error),
      stackTrace: error instanceof Error ? error.stack : undefined,
    });
    res.status(500).json({ error: 'internal_error', message: 'An unexpected error occurred' });
  }
});

// ---------------------------------------------------------------------------
// GET /categories — Aggregate category tags with counts
// ---------------------------------------------------------------------------
// IMPORTANT: This route is defined BEFORE /:itemId to prevent Express
// from treating "categories" as an itemId parameter.

/**
 * Returns distinct category tags with their usage counts for a workspace.
 *
 * Query params:
 *   - teamId (required) — Slack workspace ID
 */
contentLibraryRouter.get('/categories', async (req: Request, res: Response) => {
  try {
    const teamId = req.query.teamId as string;
    if (!teamId) {
      return res.status(400).json({ error: 'missing_param', message: 'teamId is required' });
    }

    const categories = await contentLibraryService.getCategories(teamId);

    res.json({ categories });
  } catch (error) {
    logger.error('Failed to get content library categories', { error });
    logError({
      category: 'SYSTEM_ERROR',
      service: 'admin:content-library',
      message: error instanceof Error ? error.message : String(error),
      stackTrace: error instanceof Error ? error.stack : undefined,
    });
    res.status(500).json({ error: 'internal_error', message: 'An unexpected error occurred' });
  }
});

// ---------------------------------------------------------------------------
// PUT /:itemId — Update item
// ---------------------------------------------------------------------------

/**
 * Updates an existing content library item.
 *
 * If the item's usageCount is greater than 0, a warning is included
 * in the response to inform the caller that linked plans may be affected.
 *
 * Body (JSON):
 *   - title (optional)
 *   - content (optional)
 *   - metadata (optional)
 *   - estimated_minutes (optional)
 *   - category_tags (optional)
 */
contentLibraryRouter.put('/:itemId', async (req: Request, res: Response) => {
  try {
    const body = req.body;

    const itemId = req.params.itemId as string;
    const { item, warning } = await contentLibraryService.updateItem(itemId, {
      title: body.title,
      content: body.content,
      metadata: body.metadata,
      estimatedMinutes: body.estimated_minutes,
      categoryTags: body.category_tags,
    });

    const response: Record<string, unknown> = {
      item: toSnakeCase(item as unknown as Record<string, unknown>),
    };

    if (warning) {
      response.warning = warning;
    }

    res.json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'An unexpected error occurred';
    if (message.includes('Record to update not found') || message.includes('not found')) {
      return res.status(404).json({ error: 'not_found', message: 'Item not found' });
    }
    logger.error('Failed to update content library item', { itemId: req.params.itemId, error });
    logError({
      category: 'SYSTEM_ERROR',
      service: 'admin:content-library',
      message,
      stackTrace: error instanceof Error ? error.stack : undefined,
    });
    res.status(500).json({ error: 'internal_error', message: 'An unexpected error occurred' });
  }
});

// ---------------------------------------------------------------------------
// DELETE /:itemId — Delete item
// ---------------------------------------------------------------------------

/**
 * Deletes a content library item.
 *
 * Returns 409 if the item is referenced by TrainingItems in plans
 * that have active enrollments, including the plan names in the error.
 */
contentLibraryRouter.delete('/:itemId', async (req: Request, res: Response) => {
  try {
    const itemId = req.params.itemId as string;
    await contentLibraryService.deleteItem(itemId);

    res.json({ message: 'Item deleted successfully', item_id: itemId });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'An unexpected error occurred';

    if (message.includes('Cannot delete')) {
      return res.status(409).json({ error: 'item_in_use', message });
    }

    if (message.includes('Record to delete does not exist') || message.includes('not found')) {
      return res.status(404).json({ error: 'not_found', message: 'Item not found' });
    }

    logger.error('Failed to delete content library item', { itemId: req.params.itemId, error });
    logError({
      category: 'SYSTEM_ERROR',
      service: 'admin:content-library',
      message,
      stackTrace: error instanceof Error ? error.stack : undefined,
    });
    res.status(500).json({ error: 'internal_error', message: 'An unexpected error occurred' });
  }
});
