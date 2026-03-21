/**
 * Onboarding enrollment lifecycle service (Feature 7).
 *
 * Manages BDR onboarding enrollments: creation with module progress records,
 * schedule management via BullMQ job schedulers, and status transitions.
 */

import { OnboardingEnrollmentStatus } from '@prisma/client';
import { prisma } from '../../models/index.js';
import logger from '../../lib/logger.js';
import { logAudit } from '../../lib/auditLogger.js';
import { onboardingQueue } from '../queue/queues.js';
import type { OnboardingDailyDmJobData } from '../queue/queues.js';

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

/** Input for creating a new BDR onboarding enrollment. */
export interface EnrollBdrInput {
  slackTeamId: string;
  slackUserId: string;
  bdrName: string;
  planId: string;
  managerId: string;
  startDate: Date;
  deliveryHour: number;
  timezone: string;
}

// ---------------------------------------------------------------------------
// Enrollment CRUD
// ---------------------------------------------------------------------------

/**
 * Creates an onboarding enrollment and pre-populates ModuleProgress records
 * for every module in the plan. After the transaction, registers a BullMQ
 * job scheduler for weekday daily DM delivery.
 *
 * Note: Welcome DM sending is NOT handled here -- the caller is responsible
 * for delivering the welcome message after enrollment creation.
 */
export async function enrollBdr(input: EnrollBdrInput) {
  // Load the plan with all modules to create progress records
  const plan = await prisma.onboardingPlan.findUniqueOrThrow({
    where: { id: input.planId },
    include: {
      modules: {
        orderBy: { dayNumber: 'asc' },
      },
    },
  });

  // Create enrollment + module progress in a single transaction
  const enrollment = await prisma.$transaction(async (tx) => {
    const created = await tx.onboardingEnrollment.create({
      data: {
        slackTeamId: input.slackTeamId,
        slackUserId: input.slackUserId,
        bdrName: input.bdrName,
        planId: input.planId,
        managerId: input.managerId,
        startDate: input.startDate,
        deliveryHour: input.deliveryHour,
        timezone: input.timezone,
        status: OnboardingEnrollmentStatus.ACTIVE,
      },
    });

    // Create one ModuleProgress record per module
    if (plan.modules.length > 0) {
      await tx.moduleProgress.createMany({
        data: plan.modules.map((mod) => ({
          enrollmentId: created.id,
          moduleId: mod.id,
          dayNumber: mod.dayNumber,
          status: 'PENDING' as const,
        })),
      });
    }

    return created;
  });

  // Register BullMQ job scheduler for weekday daily DM delivery
  await onboardingQueue.upsertJobScheduler(
    `onboarding-dm-${enrollment.id}`,
    {
      pattern: `0 ${input.deliveryHour} * * 1-5`,
      tz: input.timezone,
    },
    {
      name: 'onboarding-daily-dm',
      data: { enrollmentId: enrollment.id } satisfies OnboardingDailyDmJobData,
    },
  );

  logger.info('BDR enrolled in onboarding plan', {
    enrollmentId: enrollment.id,
    planId: input.planId,
    slackUserId: input.slackUserId,
    bdrName: input.bdrName,
  });
  logAudit({ action: 'onboarding_enrollment_created', actorUserId: input.managerId, actorTeamId: input.slackTeamId, targetType: 'onboarding_enrollment', targetId: enrollment.id, metadata: { bdrName: input.bdrName, planId: input.planId } });

  return enrollment;
}

/**
 * Retrieves a single enrollment by ID with its plan info and ordered
 * module progress (including the related module for each progress record).
 * Returns null if the enrollment does not exist.
 */
export async function getEnrollment(enrollmentId: string) {
  const enrollment = await prisma.onboardingEnrollment.findUnique({
    where: { id: enrollmentId },
    include: {
      plan: true,
      moduleProgress: {
        orderBy: { dayNumber: 'asc' },
        include: { module: true },
      },
    },
  });

  return enrollment ?? null;
}

/**
 * Lists enrollments for a Slack team, optionally filtered by status.
 * Includes plan name and a computed summary with aggregate metrics.
 */
export async function listEnrollments(
  teamId: string,
  status?: OnboardingEnrollmentStatus,
) {
  const where: {
    slackTeamId: string;
    status?: OnboardingEnrollmentStatus;
  } = { slackTeamId: teamId };

  if (status) {
    where.status = status;
  }

  const enrollments = await prisma.onboardingEnrollment.findMany({
    where,
    include: {
      plan: { select: { name: true } },
      moduleProgress: { select: { status: true, dayNumber: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  // Compute summary metrics
  let totalActive = 0;
  let totalSupervised = 0;
  let totalPendingGraduation = 0;
  let progressSum = 0;

  for (const enrollment of enrollments) {
    if (enrollment.status === OnboardingEnrollmentStatus.ACTIVE) totalActive++;
    if (enrollment.status === OnboardingEnrollmentStatus.SUPERVISED) totalSupervised++;
    if (enrollment.status === OnboardingEnrollmentStatus.PENDING_GRADUATION) totalPendingGraduation++;

    // Compute progress as percentage of completed modules
    const totalModules = enrollment.moduleProgress.length;
    const completedModules = enrollment.moduleProgress.filter(
      (mp) => mp.status === 'COMPLETED',
    ).length;
    if (totalModules > 0) {
      progressSum += completedModules / totalModules;
    }
  }

  const averageProgress =
    enrollments.length > 0
      ? Math.round((progressSum / enrollments.length) * 100) / 100
      : 0;

  return {
    enrollments,
    summary: {
      totalActive,
      totalSupervised,
      totalPendingGraduation,
      averageProgress,
    },
  };
}

/**
 * Updates delivery settings for an enrollment. If deliveryHour or timezone
 * changes, the BullMQ job scheduler is upserted with the new schedule.
 */
export async function updateEnrollment(
  enrollmentId: string,
  data: {
    deliveryHour?: number;
    timezone?: string;
    supervisedCampaignId?: string | null;
  },
) {
  const updated = await prisma.onboardingEnrollment.update({
    where: { id: enrollmentId },
    data: {
      ...(data.deliveryHour !== undefined && { deliveryHour: data.deliveryHour }),
      ...(data.timezone !== undefined && { timezone: data.timezone }),
      ...(data.supervisedCampaignId !== undefined && {
        supervisedCampaignId: data.supervisedCampaignId,
      }),
    },
  });

  // Re-sync BullMQ scheduler if delivery schedule changed
  if (data.deliveryHour !== undefined || data.timezone !== undefined) {
    await onboardingQueue.upsertJobScheduler(
      `onboarding-dm-${enrollmentId}`,
      {
        pattern: `0 ${updated.deliveryHour} * * 1-5`,
        tz: updated.timezone,
      },
      {
        name: 'onboarding-daily-dm',
        data: { enrollmentId } satisfies OnboardingDailyDmJobData,
      },
    );

    logger.info('Onboarding delivery schedule updated', {
      enrollmentId,
      deliveryHour: updated.deliveryHour,
      timezone: updated.timezone,
    });
  }

  return updated;
}

/**
 * Cancels an enrollment by setting its status to CANCELLED and recording
 * the cancellation timestamp. Removes the BullMQ job scheduler so no
 * further daily DMs are delivered.
 */
export async function cancelEnrollment(enrollmentId: string, reason?: string) {
  const updated = await prisma.onboardingEnrollment.update({
    where: { id: enrollmentId },
    data: {
      status: OnboardingEnrollmentStatus.CANCELLED,
      cancelledAt: new Date(),
    },
  });

  // Remove the BullMQ job scheduler
  await onboardingQueue.removeJobScheduler(`onboarding-dm-${enrollmentId}`);

  logger.info('Onboarding enrollment cancelled', {
    enrollmentId,
    reason: reason ?? 'no reason provided',
  });
  logAudit({ action: 'onboarding_enrollment_cancelled', actorUserId: 'system', targetType: 'onboarding_enrollment', targetId: enrollmentId });

  return updated;
}

/**
 * Finds an enrollment by Slack user ID, optionally filtering by status.
 * Defaults to searching for ACTIVE or SUPERVISED enrollments.
 * Returns the enrollment with plan and module progress, or null if not found.
 */
export async function getEnrollmentBySlackUser(
  slackUserId: string,
  statuses?: OnboardingEnrollmentStatus[],
) {
  const statusFilter = statuses ?? [
    OnboardingEnrollmentStatus.ACTIVE,
    OnboardingEnrollmentStatus.SUPERVISED,
  ];

  const enrollment = await prisma.onboardingEnrollment.findFirst({
    where: {
      slackUserId,
      status: { in: statusFilter },
    },
    include: {
      plan: true,
      moduleProgress: {
        orderBy: { dayNumber: 'asc' },
        include: { module: true },
      },
    },
  });

  return enrollment ?? null;
}
