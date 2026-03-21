/**
 * Content library service for managing reusable training content items.
 *
 * Provides CRUD operations for ContentLibraryItem records, along with
 * category aggregation and usage-count tracking. Items in the library
 * can be referenced by TrainingItems inside onboarding plan modules.
 */

import type { TrainingItemType } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { prisma } from '../../models/index.js';
import logger from '../../lib/logger.js';
import { logAudit } from '../../lib/auditLogger.js';

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

/** Input for creating a new content library item. */
export interface CreateItemInput {
  /** Slack workspace this item belongs to. */
  slackTeamId: string;
  /** Type of training content. */
  type: TrainingItemType;
  /** Human-readable title. */
  title: string;
  /** Body content (text, markdown, URL, etc.). */
  content?: string;
  /** Structured metadata (e.g. video URL, quiz questions). */
  metadata?: Record<string, unknown>;
  /** Estimated completion time in minutes. */
  estimatedMinutes?: number;
  /** Tags used for categorisation and filtering. */
  categoryTags?: string[];
  /** Slack user ID of the creator. */
  createdByUserId: string;
}

/** Input for updating an existing content library item. */
export interface UpdateItemInput {
  /** Updated title. */
  title?: string;
  /** Updated body content. */
  content?: string;
  /** Updated metadata. */
  metadata?: Record<string, unknown>;
  /** Updated estimated completion time. */
  estimatedMinutes?: number;
  /** Updated category tags. */
  categoryTags?: string[];
}

/** Filters for listing content library items. */
export interface ListItemsFilters {
  /** Slack workspace ID (required). */
  teamId: string;
  /** Optional type filter. */
  type?: TrainingItemType;
  /** Optional category tag filter (must appear in categoryTags array). */
  category?: string;
  /** Optional case-insensitive search against title. */
  search?: string;
}

// ---------------------------------------------------------------------------
// Service functions
// ---------------------------------------------------------------------------

/**
 * Creates a new content library item.
 *
 * @param input - The fields for the new item.
 * @returns The newly created ContentLibraryItem.
 */
export async function createItem(input: CreateItemInput) {
  logger.debug('Creating content library item', { title: input.title, type: input.type, teamId: input.slackTeamId });

  const item = await prisma.contentLibraryItem.create({
    data: {
      slackTeamId: input.slackTeamId,
      type: input.type,
      title: input.title,
      content: input.content,
      metadata: input.metadata as Prisma.InputJsonValue ?? undefined,
      estimatedMinutes: input.estimatedMinutes,
      categoryTags: input.categoryTags ?? [],
      createdByUserId: input.createdByUserId,
    },
  });

  logger.info(`Created content library item ${item.id} ("${item.title}")`);
  logAudit({ action: 'onboarding_library_item_created', actorUserId: 'admin', targetType: 'content_library_item', targetId: item.id, metadata: { title: input.title, type: input.type } });
  return item;
}

/**
 * Updates an existing content library item.
 *
 * If the item is currently referenced by one or more TrainingItems,
 * a warning string is included in the response so the caller can
 * inform the user that linked plans will be affected.
 *
 * @param itemId - UUID of the item to update.
 * @param data - Fields to update.
 * @returns Object with the updated item and an optional warning.
 */
export async function updateItem(itemId: string, data: UpdateItemInput) {
  logger.debug(`Updating content library item ${itemId}`);

  const item = await prisma.contentLibraryItem.update({
    where: { id: itemId },
    data: {
      title: data.title,
      content: data.content,
      metadata: data.metadata as Prisma.InputJsonValue ?? undefined,
      estimatedMinutes: data.estimatedMinutes,
      categoryTags: data.categoryTags,
    },
  });

  // Count linked training items separately
  const linkedCount = await prisma.trainingItem.count({
    where: { libraryItemId: itemId },
  });

  let warning: string | undefined;

  if (linkedCount > 0) {
    warning = `This item is referenced by ${linkedCount} training item(s) in existing plans. Changes will be reflected in those plans.`;
  }

  logger.info(`Updated content library item ${item.id} ("${item.title}")${warning ? ' [has linked training items]' : ''}`);
  logAudit({ action: 'onboarding_library_item_updated', actorUserId: 'admin', targetType: 'content_library_item', targetId: itemId });

  return { item, warning };
}

/**
 * Deletes a content library item.
 *
 * Before deleting, checks whether any TrainingItems referencing this
 * library item belong to modules inside plans that have active
 * enrollments (status ACTIVE, SUPERVISED, or EXTENDED). If so,
 * throws an error listing the plan names so the caller can return
 * a 409 response.
 *
 * @param itemId - UUID of the item to delete.
 * @throws Error if the item is used in active plan enrollments.
 */
export async function deleteItem(itemId: string): Promise<void> {
  logger.debug(`Attempting to delete content library item ${itemId}`);

  // Find TrainingItems referencing this library item, and walk up to
  // their module -> plan -> enrollments to check for active usage.
  const linkedTrainingItems = await prisma.trainingItem.findMany({
    where: { libraryItemId: itemId },
    select: {
      module: {
        select: {
          plan: {
            select: {
              id: true,
              name: true,
              enrollments: {
                where: {
                  status: { in: ['ACTIVE', 'SUPERVISED', 'EXTENDED'] },
                },
                select: { id: true },
              },
            },
          },
        },
      },
    },
  });

  // Collect unique plan names that have active enrollments
  const activePlanNames = new Set<string>();
  for (const ti of linkedTrainingItems) {
    if (ti.module.plan.enrollments.length > 0) {
      activePlanNames.add(ti.module.plan.name);
    }
  }

  if (activePlanNames.size > 0) {
    const names = Array.from(activePlanNames).join(', ');
    throw new Error(
      `Cannot delete: item is used in active plan enrollments (${names}). Remove the item from those plans first.`,
    );
  }

  await prisma.contentLibraryItem.delete({ where: { id: itemId } });

  logger.info(`Deleted content library item ${itemId}`);
  logAudit({ action: 'onboarding_library_item_deleted', actorUserId: 'admin', targetType: 'content_library_item', targetId: itemId });
}

/**
 * Lists content library items with optional filters.
 *
 * Supports filtering by workspace (required), type, category tag,
 * and case-insensitive title search. Returns both the filtered
 * items and a total count for pagination.
 *
 * @param filters - Filter criteria for the query.
 * @returns Object with items array and total count.
 */
export async function listItems(filters: ListItemsFilters) {
  logger.debug('Listing content library items', { filters });

  const where: Record<string, unknown> = {
    slackTeamId: filters.teamId,
  };

  if (filters.type) {
    where.type = filters.type;
  }

  if (filters.category) {
    where.categoryTags = { has: filters.category };
  }

  if (filters.search) {
    where.title = { contains: filters.search, mode: 'insensitive' };
  }

  const [items, total] = await Promise.all([
    prisma.contentLibraryItem.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
    }),
    prisma.contentLibraryItem.count({ where }),
  ]);

  logger.info(`Found ${items.length} content library items (total: ${total})`);
  return { items, total };
}

/**
 * Aggregates distinct category tags with their usage counts for a workspace.
 *
 * Iterates over all items for the given team, flattens their categoryTags
 * arrays, and returns a sorted list of unique tags with counts.
 *
 * @param teamId - Slack workspace ID.
 * @returns Array of objects with tag name and count, sorted by count descending.
 */
export async function getCategories(teamId: string) {
  logger.debug(`Aggregating categories for team ${teamId}`);

  const items = await prisma.contentLibraryItem.findMany({
    where: { slackTeamId: teamId },
    select: { categoryTags: true },
  });

  const tagCounts = new Map<string, number>();
  for (const item of items) {
    for (const tag of item.categoryTags) {
      tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
    }
  }

  const categories = Array.from(tagCounts.entries())
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count);

  logger.info(`Found ${categories.length} distinct categories for team ${teamId}`);
  return categories;
}

/**
 * Increments the usage count of a content library item by 1.
 *
 * Called when a TrainingItem is created that references this library item.
 *
 * @param itemId - UUID of the content library item.
 * @returns The updated item.
 */
export async function incrementUsageCount(itemId: string) {
  logger.debug(`Incrementing usage count for item ${itemId}`);

  const item = await prisma.contentLibraryItem.update({
    where: { id: itemId },
    data: { usageCount: { increment: 1 } },
  });

  logger.info(`Incremented usage count for item ${itemId} (now ${item.usageCount})`);
  return item;
}

/**
 * Decrements the usage count of a content library item by 1 (minimum 0).
 *
 * Called when a TrainingItem referencing this library item is removed.
 * Uses a raw query to enforce a floor of zero.
 *
 * @param itemId - UUID of the content library item.
 * @returns The updated item.
 */
export async function decrementUsageCount(itemId: string) {
  logger.debug(`Decrementing usage count for item ${itemId}`);

  // First fetch the current count to enforce the floor
  const current = await prisma.contentLibraryItem.findUniqueOrThrow({
    where: { id: itemId },
    select: { usageCount: true },
  });

  if (current.usageCount <= 0) {
    logger.debug(`Usage count for item ${itemId} already at 0, skipping decrement`);
    return prisma.contentLibraryItem.findUniqueOrThrow({ where: { id: itemId } });
  }

  const item = await prisma.contentLibraryItem.update({
    where: { id: itemId },
    data: { usageCount: { decrement: 1 } },
  });

  logger.info(`Decremented usage count for item ${itemId} (now ${item.usageCount})`);
  return item;
}
