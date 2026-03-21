/**
 * Module service for managing OnboardingModule records within plans.
 *
 * Provides CRUD operations and reordering for onboarding modules,
 * including nested trainingItems and automations.
 */

import type { TrainingItemType, AutomationType } from '@prisma/client';
import { prisma } from '../../models/index.js';
import logger from '../../lib/logger.js';

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

/** Input for creating a new onboarding module with nested items. */
export interface CreateModuleInput {
  dayNumber: number;
  title: string;
  description?: string;
  estimatedMinutes?: number;
  trainingItems: Array<{
    type: TrainingItemType;
    title: string;
    content?: string;
    metadata?: any;
    estimatedMinutes?: number;
    libraryItemId?: string;
  }>;
  automations: Array<{
    type: AutomationType;
    triggerTime: string;
    content?: string;
    conditions?: any;
  }>;
}

/** Input for updating an existing onboarding module. */
export interface UpdateModuleInput {
  title?: string;
  description?: string;
  estimatedMinutes?: number;
  trainingItems?: CreateModuleInput['trainingItems'];
  automations?: CreateModuleInput['automations'];
}

// ---------------------------------------------------------------------------
// Shared include clause
// ---------------------------------------------------------------------------

/** Standard Prisma include for returning a module with all relations. */
const MODULE_INCLUDE = {
  trainingItems: { orderBy: { sortOrder: 'asc' as const } },
  automations: { orderBy: { sortOrder: 'asc' as const } },
} as const;

// ---------------------------------------------------------------------------
// Service functions
// ---------------------------------------------------------------------------

/**
 * Retrieves all modules for a given plan, ordered by dayNumber.
 *
 * Each module includes its trainingItems (ordered by sortOrder)
 * and automations (ordered by sortOrder).
 *
 * @param planId - UUID of the onboarding plan.
 * @returns Array of modules with nested trainingItems and automations.
 */
export async function getModulesForPlan(planId: string) {
  logger.debug(`Fetching modules for plan ${planId}`);

  const modules = await prisma.onboardingModule.findMany({
    where: { planId },
    orderBy: { dayNumber: 'asc' },
    include: MODULE_INCLUDE,
  });

  logger.info(`Found ${modules.length} modules for plan ${planId}`);
  return modules;
}

/**
 * Creates a new module with nested trainingItems and automations.
 *
 * The weekNumber is auto-calculated as `Math.ceil(dayNumber / 5)`.
 * Sort orders for trainingItems and automations are derived from array index.
 *
 * @param planId - UUID of the onboarding plan to add the module to.
 * @param data - Module fields including nested trainingItems and automations.
 * @returns The created module with all relations.
 */
export async function createModule(planId: string, data: CreateModuleInput) {
  const weekNumber = Math.ceil(data.dayNumber / 5);

  logger.debug(`Creating module "${data.title}" for plan ${planId} (day ${data.dayNumber}, week ${weekNumber})`);

  const module = await prisma.$transaction(async (tx) => {
    return tx.onboardingModule.create({
      data: {
        planId,
        dayNumber: data.dayNumber,
        weekNumber,
        title: data.title,
        description: data.description,
        estimatedMinutes: data.estimatedMinutes,
        trainingItems: {
          create: data.trainingItems.map((item, index) => ({
            type: item.type,
            title: item.title,
            content: item.content,
            metadata: item.metadata,
            estimatedMinutes: item.estimatedMinutes,
            libraryItemId: item.libraryItemId,
            sortOrder: index,
          })),
        },
        automations: {
          create: data.automations.map((auto, index) => ({
            type: auto.type,
            triggerTime: auto.triggerTime,
            content: auto.content,
            conditions: auto.conditions,
            sortOrder: index,
          })),
        },
      },
      include: MODULE_INCLUDE,
    });
  });

  logger.info(`Created module ${module.id} ("${module.title}") for plan ${planId}`);
  return module;
}

/**
 * Updates an existing module's fields.
 *
 * When trainingItems or automations arrays are provided, the existing
 * records are deleted and replaced with the new set in a transaction.
 *
 * @param moduleId - UUID of the module to update.
 * @param data - Fields to update, optionally including replacement trainingItems/automations.
 * @returns The updated module with all relations.
 */
export async function updateModule(moduleId: string, data: UpdateModuleInput) {
  logger.debug(`Updating module ${moduleId}`);

  const module = await prisma.$transaction(async (tx) => {
    // Delete existing trainingItems if replacements are provided
    if (data.trainingItems) {
      await tx.trainingItem.deleteMany({ where: { moduleId } });
    }

    // Delete existing automations if replacements are provided
    if (data.automations) {
      await tx.onboardingAutomation.deleteMany({ where: { moduleId } });
    }

    return tx.onboardingModule.update({
      where: { id: moduleId },
      data: {
        title: data.title,
        description: data.description,
        estimatedMinutes: data.estimatedMinutes,
        trainingItems: data.trainingItems
          ? {
              create: data.trainingItems.map((item, index) => ({
                type: item.type,
                title: item.title,
                content: item.content,
                metadata: item.metadata,
                estimatedMinutes: item.estimatedMinutes,
                libraryItemId: item.libraryItemId,
                sortOrder: index,
              })),
            }
          : undefined,
        automations: data.automations
          ? {
              create: data.automations.map((auto, index) => ({
                type: auto.type,
                triggerTime: auto.triggerTime,
                content: auto.content,
                conditions: auto.conditions,
                sortOrder: index,
              })),
            }
          : undefined,
      },
      include: MODULE_INCLUDE,
    });
  });

  logger.info(`Updated module ${module.id} ("${module.title}")`);
  return module;
}

/**
 * Deletes a module by ID.
 *
 * Cascading deletes defined in the Prisma schema handle removal
 * of associated trainingItems and automations.
 *
 * @param moduleId - UUID of the module to delete.
 */
export async function deleteModule(moduleId: string): Promise<void> {
  logger.debug(`Deleting module ${moduleId}`);

  await prisma.onboardingModule.delete({ where: { id: moduleId } });

  logger.info(`Deleted module ${moduleId}`);
}

/**
 * Reorders modules within a plan by updating dayNumber and recalculating weekNumber.
 *
 * All updates run inside a single transaction for atomicity.
 *
 * @param planId - UUID of the onboarding plan (used for logging context).
 * @param moduleOrder - Array of objects mapping moduleId to its new dayNumber.
 * @returns The updated list of modules for the plan.
 */
export async function reorderModules(
  planId: string,
  moduleOrder: Array<{ moduleId: string; dayNumber: number }>,
) {
  logger.debug(`Reordering ${moduleOrder.length} modules for plan ${planId}`);

  await prisma.$transaction(
    moduleOrder.map(({ moduleId, dayNumber }) =>
      prisma.onboardingModule.update({
        where: { id: moduleId },
        data: {
          dayNumber,
          weekNumber: Math.ceil(dayNumber / 5),
        },
      }),
    ),
  );

  logger.info(`Reordered ${moduleOrder.length} modules for plan ${planId}`);

  // Return the freshly-ordered module list
  return getModulesForPlan(planId);
}
