/**
 * Onboarding Plan CRUD and versioning service (Feature 7).
 *
 * Provides lifecycle management for OnboardingPlan records with nested
 * modules, training items, and automations. Plans are versioned -- edits
 * against plans with active enrollments create new version records rather
 * than mutating in place.
 */

import type {
  OnboardingPlan,
  OnboardingModule,
  TrainingItem,
  OnboardingAutomation,
  TrainingItemType,
  AutomationType,
} from '@prisma/client';
import { prisma } from '../../models/index.js';
import logger from '../../lib/logger.js';
import { logAudit } from '../../lib/auditLogger.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Input payload for creating a new onboarding plan with nested modules. */
export interface CreatePlanInput {
  slackTeamId: string;
  name: string;
  description?: string;
  durationDays: number;
  supervisedStartDay?: number;
  weekdaysOnly?: boolean;
  createdByUserId: string;
  modules: Array<{
    dayNumber: number;
    title: string;
    description?: string;
    estimatedMinutes?: number;
    trainingItems: Array<{
      type: TrainingItemType;
      title: string;
      content?: string;
      metadata?: unknown;
      estimatedMinutes?: number;
      libraryItemId?: string;
    }>;
    automations: Array<{
      type: AutomationType;
      triggerTime: string;
      content?: string;
      conditions?: unknown;
    }>;
  }>;
}

/** Shape of a plan returned with all nested relations included. */
export type PlanWithRelations = OnboardingPlan & {
  modules: Array<
    OnboardingModule & {
      trainingItems: TrainingItem[];
      automations: OnboardingAutomation[];
    }
  >;
};

/** Shape of a plan returned from listPlans with enrollment counts. */
export type PlanListItem = OnboardingPlan & {
  _count: { enrollments: number };
};

/** Enrollment statuses considered "active" for versioning and deletion guards. */
const ACTIVE_ENROLLMENT_STATUSES = ['ACTIVE', 'SUPERVISED', 'PENDING_GRADUATION'] as const;

/** Standard include clause for fetching a plan with all nested relations. */
const PLAN_INCLUDE = {
  modules: {
    orderBy: { dayNumber: 'asc' as const },
    include: {
      trainingItems: { orderBy: { sortOrder: 'asc' as const } },
      automations: { orderBy: { sortOrder: 'asc' as const } },
    },
  },
} as const;

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

/**
 * Creates a new onboarding plan with nested modules, training items, and automations.
 *
 * All records are created within a single Prisma transaction. Each module's
 * weekNumber is derived from its dayNumber: `Math.ceil(dayNumber / 5)`.
 *
 * @param input - Full plan payload including nested module data.
 * @returns The created plan with all relations included.
 */
export async function createPlan(input: CreatePlanInput): Promise<PlanWithRelations> {
  const plan = await prisma.$transaction(async (tx) => {
    const created = await tx.onboardingPlan.create({
      data: {
        slackTeamId: input.slackTeamId,
        name: input.name,
        description: input.description,
        durationDays: input.durationDays,
        supervisedStartDay: input.supervisedStartDay,
        weekdaysOnly: input.weekdaysOnly ?? true,
        createdByUserId: input.createdByUserId,
        version: 1,
        isLatest: true,
        modules: {
          create: input.modules.map((mod, idx) => ({
            dayNumber: mod.dayNumber,
            weekNumber: Math.ceil(mod.dayNumber / 5),
            title: mod.title,
            description: mod.description,
            estimatedMinutes: mod.estimatedMinutes,
            sortOrder: idx,
            trainingItems: {
              create: mod.trainingItems.map((item, itemIdx) => ({
                type: item.type,
                title: item.title,
                content: item.content,
                metadata: item.metadata ?? undefined,
                estimatedMinutes: item.estimatedMinutes,
                libraryItemId: item.libraryItemId,
                sortOrder: itemIdx,
              })),
            },
            automations: {
              create: mod.automations.map((auto, autoIdx) => ({
                type: auto.type,
                triggerTime: auto.triggerTime,
                content: auto.content,
                conditions: auto.conditions ?? undefined,
                sortOrder: autoIdx,
              })),
            },
          })),
        },
      },
      include: PLAN_INCLUDE,
    });

    return created;
  });

  logger.info('Onboarding plan created', { planId: plan.id, name: plan.name });
  logAudit({ action: 'onboarding_plan_created', actorUserId: input.createdByUserId, actorTeamId: input.slackTeamId, targetType: 'onboarding_plan', targetId: plan.id });

  return plan as PlanWithRelations;
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

/**
 * Retrieves a single onboarding plan by ID with all nested relations.
 *
 * Modules are ordered by dayNumber. Training items and automations within
 * each module are ordered by sortOrder.
 *
 * @param planId - UUID of the plan to retrieve.
 * @returns The plan with relations, or null if not found.
 */
export async function getPlan(planId: string): Promise<PlanWithRelations | null> {
  const plan = await prisma.onboardingPlan.findUnique({
    where: { id: planId },
    include: PLAN_INCLUDE,
  });

  return (plan as PlanWithRelations) ?? null;
}

/**
 * Lists onboarding plans for a workspace with optional latest-only filtering.
 *
 * Each returned plan includes a count of active enrollments (status in
 * ACTIVE, SUPERVISED, or PENDING_GRADUATION).
 *
 * @param teamId - Slack workspace team ID to filter by.
 * @param latestOnly - When true (default), only returns plans where isLatest is true.
 * @returns Array of plans with enrollment counts.
 */
export async function listPlans(
  teamId: string,
  latestOnly: boolean = true,
): Promise<PlanListItem[]> {
  const where: Record<string, unknown> = { slackTeamId: teamId };
  if (latestOnly) {
    where.isLatest = true;
  }

  const plans = await prisma.onboardingPlan.findMany({
    where,
    include: {
      _count: {
        select: {
          enrollments: {
            where: {
              status: { in: [...ACTIVE_ENROLLMENT_STATUSES] },
            },
          },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  return plans as PlanListItem[];
}

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

/**
 * Updates an onboarding plan with version-aware semantics.
 *
 * If the plan has active enrollments (ACTIVE, SUPERVISED, or PENDING_GRADUATION),
 * a new version is created with the updates applied and the old plan's isLatest
 * flag is set to false. If there are no active enrollments, the plan is updated
 * in place.
 *
 * @param planId - UUID of the plan to update.
 * @param data - Partial plan fields to apply as updates.
 * @returns The updated or newly versioned plan with all relations.
 * @throws Error if the plan is not found.
 */
export async function updatePlan(
  planId: string,
  data: Partial<Pick<OnboardingPlan, 'name' | 'description' | 'durationDays' | 'supervisedStartDay' | 'weekdaysOnly'>>,
): Promise<PlanWithRelations> {
  const existing = await prisma.onboardingPlan.findUnique({
    where: { id: planId },
    include: {
      ...PLAN_INCLUDE,
      enrollments: {
        where: { status: { in: [...ACTIVE_ENROLLMENT_STATUSES] } },
        select: { id: true },
      },
    },
  });

  if (!existing) {
    throw new Error(`Onboarding plan not found: ${planId}`);
  }

  const hasActiveEnrollments = existing.enrollments.length > 0;

  if (hasActiveEnrollments) {
    // Version-aware: create a new plan record with incremented version
    const newPlan = await prisma.$transaction(async (tx) => {
      // Mark old plan as no longer latest
      await tx.onboardingPlan.update({
        where: { id: planId },
        data: { isLatest: false },
      });

      // Create new versioned plan with updates applied
      const parentPlanId = existing.parentPlanId ?? existing.id;
      const created = await tx.onboardingPlan.create({
        data: {
          slackTeamId: existing.slackTeamId,
          name: data.name ?? existing.name,
          description: data.description !== undefined ? data.description : existing.description,
          durationDays: data.durationDays ?? existing.durationDays,
          supervisedStartDay: data.supervisedStartDay !== undefined ? data.supervisedStartDay : existing.supervisedStartDay,
          weekdaysOnly: data.weekdaysOnly ?? existing.weekdaysOnly,
          createdByUserId: existing.createdByUserId,
          version: existing.version + 1,
          isLatest: true,
          parentPlanId,
          modules: {
            create: existing.modules.map((mod) => ({
              dayNumber: mod.dayNumber,
              weekNumber: mod.weekNumber,
              title: mod.title,
              description: mod.description,
              estimatedMinutes: mod.estimatedMinutes,
              sortOrder: mod.sortOrder,
              trainingItems: {
                create: mod.trainingItems.map((item) => ({
                  type: item.type,
                  title: item.title,
                  content: item.content,
                  metadata: item.metadata ?? undefined,
                  estimatedMinutes: item.estimatedMinutes,
                  libraryItemId: item.libraryItemId,
                  sortOrder: item.sortOrder,
                })),
              },
              automations: {
                create: mod.automations.map((auto) => ({
                  type: auto.type,
                  triggerTime: auto.triggerTime,
                  content: auto.content,
                  conditions: auto.conditions ?? undefined,
                  sortOrder: auto.sortOrder,
                })),
              },
            })),
          },
        },
        include: PLAN_INCLUDE,
      });

      return created;
    });

    logger.info('Onboarding plan versioned', {
      oldPlanId: planId,
      newPlanId: newPlan.id,
      version: newPlan.version,
    });
    logAudit({ action: 'onboarding_plan_updated', actorUserId: 'system', targetType: 'onboarding_plan', targetId: planId, metadata: { versioned: true } });

    return newPlan as PlanWithRelations;
  }

  // No active enrollments: update in place
  const updated = await prisma.onboardingPlan.update({
    where: { id: planId },
    data: {
      name: data.name,
      description: data.description,
      durationDays: data.durationDays,
      supervisedStartDay: data.supervisedStartDay,
      weekdaysOnly: data.weekdaysOnly,
    },
    include: PLAN_INCLUDE,
  });

  logger.info('Onboarding plan updated in place', { planId });
  logAudit({ action: 'onboarding_plan_updated', actorUserId: 'system', targetType: 'onboarding_plan', targetId: planId, metadata: { versioned: false } });

  return updated as PlanWithRelations;
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

/**
 * Soft-deletes an onboarding plan by setting isLatest to false.
 *
 * Plans with active enrollments (ACTIVE, SUPERVISED, or PENDING_GRADUATION)
 * cannot be deleted.
 *
 * @param planId - UUID of the plan to soft-delete.
 * @throws Error if the plan is not found or has active enrollments.
 */
export async function deletePlan(planId: string): Promise<void> {
  const plan = await prisma.onboardingPlan.findUnique({
    where: { id: planId },
    include: {
      _count: {
        select: {
          enrollments: {
            where: {
              status: { in: [...ACTIVE_ENROLLMENT_STATUSES] },
            },
          },
        },
      },
    },
  });

  if (!plan) {
    throw new Error(`Onboarding plan not found: ${planId}`);
  }

  if (plan._count.enrollments > 0) {
    throw new Error(
      `Cannot delete plan "${plan.name}" (${planId}): it has ${plan._count.enrollments} active enrollment(s)`,
    );
  }

  await prisma.onboardingPlan.update({
    where: { id: planId },
    data: { isLatest: false },
  });

  logger.info('Onboarding plan soft-deleted', { planId, name: plan.name });
  logAudit({ action: 'onboarding_plan_deleted', actorUserId: 'system', targetType: 'onboarding_plan', targetId: planId });
}

// ---------------------------------------------------------------------------
// Duplicate
// ---------------------------------------------------------------------------

/**
 * Deep-copies an onboarding plan with all modules, training items, and automations.
 *
 * The duplicate receives new UUIDs (generated by Prisma), version 1,
 * isLatest true, and no parentPlanId. The plan name is replaced with newName.
 *
 * @param planId - UUID of the source plan to duplicate.
 * @param newName - Name for the duplicated plan.
 * @returns The newly created duplicate plan with all relations.
 * @throws Error if the source plan is not found.
 */
export async function duplicatePlan(
  planId: string,
  newName: string,
): Promise<PlanWithRelations> {
  const source = await prisma.onboardingPlan.findUnique({
    where: { id: planId },
    include: PLAN_INCLUDE,
  });

  if (!source) {
    throw new Error(`Onboarding plan not found: ${planId}`);
  }

  const duplicate = await prisma.$transaction(async (tx) => {
    const created = await tx.onboardingPlan.create({
      data: {
        slackTeamId: source.slackTeamId,
        name: newName,
        description: source.description,
        durationDays: source.durationDays,
        supervisedStartDay: source.supervisedStartDay,
        weekdaysOnly: source.weekdaysOnly,
        createdByUserId: source.createdByUserId,
        version: 1,
        isLatest: true,
        parentPlanId: null,
        modules: {
          create: source.modules.map((mod) => ({
            dayNumber: mod.dayNumber,
            weekNumber: mod.weekNumber,
            title: mod.title,
            description: mod.description,
            estimatedMinutes: mod.estimatedMinutes,
            sortOrder: mod.sortOrder,
            trainingItems: {
              create: mod.trainingItems.map((item) => ({
                type: item.type,
                title: item.title,
                content: item.content,
                metadata: item.metadata ?? undefined,
                estimatedMinutes: item.estimatedMinutes,
                libraryItemId: item.libraryItemId,
                sortOrder: item.sortOrder,
              })),
            },
            automations: {
              create: mod.automations.map((auto) => ({
                type: auto.type,
                triggerTime: auto.triggerTime,
                content: auto.content,
                conditions: auto.conditions ?? undefined,
                sortOrder: auto.sortOrder,
              })),
            },
          })),
        },
      },
      include: PLAN_INCLUDE,
    });

    return created;
  });

  logger.info('Onboarding plan duplicated', {
    sourcePlanId: planId,
    newPlanId: duplicate.id,
    newName,
  });
  logAudit({ action: 'onboarding_plan_duplicated', actorUserId: 'system', targetType: 'onboarding_plan', targetId: duplicate.id, metadata: { sourceId: planId } });

  return duplicate as PlanWithRelations;
}
