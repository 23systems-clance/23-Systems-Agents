/**
 * Onboarding graduation service (Feature 7).
 *
 * Handles the graduation lifecycle when a BDR completes all onboarding
 * modules: triggering manager review, approving/rejecting graduation,
 * and extending onboarding with additional days.
 */

import { OnboardingEnrollmentStatus } from '@prisma/client';
import type { WebClient } from '@slack/web-api';
import { prisma } from '../../models/index.js';
import logger from '../../lib/logger.js';
import { logAudit } from '../../lib/auditLogger.js';
import * as slackBlocks from './slackBlocks.js';
import { onboardingQueue } from '../queue/queues.js';
import type { OnboardingDailyDmJobData } from '../queue/queues.js';

// ---------------------------------------------------------------------------
// triggerGraduationReview
// ---------------------------------------------------------------------------

/**
 * Triggers a graduation review by notifying the manager when a BDR has
 * completed all onboarding modules.
 *
 * Loads the enrollment with its plan and module progress, calculates
 * completion metrics, sends a graduation notification to the manager
 * with approve/extend/reject buttons, and updates the enrollment status
 * to PENDING_GRADUATION.
 *
 * @param enrollmentId - The onboarding enrollment ID.
 * @param slackClient  - Authenticated Slack Web API client.
 */
export async function triggerGraduationReview(
  enrollmentId: string,
  slackClient: WebClient,
): Promise<void> {
  const enrollment = await prisma.onboardingEnrollment.findUniqueOrThrow({
    where: { id: enrollmentId },
    include: {
      plan: true,
      moduleProgress: {
        orderBy: { dayNumber: 'asc' },
      },
    },
  });

  // Calculate how many calendar days from start to now
  const now = new Date();
  const completionDays = Math.ceil(
    (now.getTime() - enrollment.startDate.getTime()) / (1000 * 60 * 60 * 24),
  );

  // Count completed modules
  const modulesCompleted = enrollment.moduleProgress.filter(
    (mp) => mp.status === 'COMPLETED',
  ).length;

  // Build the graduation notification blocks
  const message = slackBlocks.buildGraduationNotification({
    enrollmentId,
    bdrName: enrollment.bdrName,
    planName: enrollment.plan.name,
    completionDays,
    modulesCompleted,
  });

  // Send notification to the manager
  try {
    await slackClient.chat.postMessage({
      channel: enrollment.managerId,
      blocks: message.blocks,
      text: message.text,
    });
  } catch (error) {
    logger.error('Failed to send graduation notification to manager', {
      enrollmentId,
      managerId: enrollment.managerId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }

  // Update enrollment status to PENDING_GRADUATION
  await prisma.onboardingEnrollment.update({
    where: { id: enrollmentId },
    data: { status: OnboardingEnrollmentStatus.PENDING_GRADUATION },
  });

  logger.info('Graduation review triggered', {
    enrollmentId,
    bdrName: enrollment.bdrName,
    managerId: enrollment.managerId,
    completionDays,
    modulesCompleted,
  });
}

// ---------------------------------------------------------------------------
// approveGraduation
// ---------------------------------------------------------------------------

/**
 * Approves a BDR's graduation from the onboarding plan.
 *
 * Updates the enrollment status to GRADUATED with a graduation timestamp,
 * removes the BullMQ daily DM job scheduler so no further modules are
 * delivered, and sends a congratulations DM to the BDR.
 *
 * @param enrollmentId - The onboarding enrollment ID.
 * @param slackClient  - Authenticated Slack Web API client.
 */
export async function approveGraduation(
  enrollmentId: string,
  slackClient: WebClient,
): Promise<void> {
  // Update enrollment to GRADUATED
  const enrollment = await prisma.onboardingEnrollment.update({
    where: { id: enrollmentId },
    data: {
      status: OnboardingEnrollmentStatus.GRADUATED,
      graduatedAt: new Date(),
    },
    include: { plan: true },
  });

  // Remove the BullMQ daily DM scheduler
  await onboardingQueue.removeJobScheduler(`onboarding-dm-${enrollmentId}`);

  // Send graduation DM to the BDR
  const message = slackBlocks.buildGraduationDm({
    bdrName: enrollment.bdrName,
    planName: enrollment.plan.name,
  });

  try {
    await slackClient.chat.postMessage({
      channel: enrollment.slackUserId,
      blocks: message.blocks,
      text: message.text,
    });
  } catch (error) {
    logger.error('Failed to send graduation DM to BDR', {
      enrollmentId,
      slackUserId: enrollment.slackUserId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  logger.info('Graduation approved', {
    enrollmentId,
    bdrName: enrollment.bdrName,
    slackUserId: enrollment.slackUserId,
  });
  logAudit({ action: 'onboarding_enrollment_graduated', actorUserId: 'manager', targetType: 'onboarding_enrollment', targetId: enrollmentId, metadata: { bdrName: enrollment.bdrName } });
}

// ---------------------------------------------------------------------------
// extendOnboarding
// ---------------------------------------------------------------------------

/**
 * Extends a BDR's onboarding by adding additional days to the plan.
 *
 * Increments the extendedDays counter on the enrollment, resets the
 * status back to ACTIVE so daily module delivery continues, and sends
 * a DM to the BDR explaining the extension. The BullMQ job scheduler
 * remains active since the enrollment returns to an active state.
 *
 * Note: No orphan ModuleProgress records are created for extension days.
 * The manager assigns additional modules via the drip builder, which
 * creates the corresponding progress records.
 *
 * @param enrollmentId  - The onboarding enrollment ID.
 * @param additionalDays - Number of days to add to the plan.
 * @param reason         - Manager-provided reason for the extension.
 * @param slackClient    - Authenticated Slack Web API client.
 */
export async function extendOnboarding(
  enrollmentId: string,
  additionalDays: number,
  reason: string,
  slackClient: WebClient,
): Promise<void> {
  // Load current enrollment to check previous status and compute new extendedDays
  const current = await prisma.onboardingEnrollment.findUniqueOrThrow({
    where: { id: enrollmentId },
    include: { plan: true },
  });

  const newExtendedDays = (current.extendedDays ?? 0) + additionalDays;

  // Reset status to ACTIVE (keeps scheduler running for daily DMs)
  await prisma.onboardingEnrollment.update({
    where: { id: enrollmentId },
    data: {
      extendedDays: newExtendedDays,
      status: OnboardingEnrollmentStatus.ACTIVE,
    },
  });

  // Ensure the BullMQ scheduler is active for continued delivery
  await onboardingQueue.upsertJobScheduler(
    `onboarding-dm-${enrollmentId}`,
    {
      pattern: `0 ${current.deliveryHour} * * 1-5`,
      tz: current.timezone,
    },
    {
      name: 'onboarding-daily-dm',
      data: { enrollmentId } satisfies OnboardingDailyDmJobData,
    },
  );

  // Notify the BDR about the extension
  try {
    await slackClient.chat.postMessage({
      channel: current.slackUserId,
      text: `Your onboarding for *${current.plan.name}* has been extended by ${additionalDays} day${additionalDays === 1 ? '' : 's'}.\n\n*Reason:* ${reason}\n\nYour manager will assign additional modules shortly. Keep up the great work!`,
    });
  } catch (error) {
    logger.error('Failed to send extension DM to BDR', {
      enrollmentId,
      slackUserId: current.slackUserId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  logger.info('Onboarding extended', {
    enrollmentId,
    bdrName: current.bdrName,
    additionalDays,
    newExtendedDays,
    reason,
  });
  logAudit({ action: 'onboarding_enrollment_extended', actorUserId: 'manager', targetType: 'onboarding_enrollment', targetId: enrollmentId, metadata: { additionalDays, reason, newExtendedDays } });
}

// ---------------------------------------------------------------------------
// rejectGraduation
// ---------------------------------------------------------------------------

/**
 * Rejects a BDR's graduation and returns them to active onboarding (FR-028).
 *
 * Resets the enrollment status to ACTIVE so daily module delivery resumes,
 * and sends a DM to the BDR with the manager's feedback and additional
 * requirements. The BullMQ job scheduler remains active.
 *
 * @param enrollmentId - The onboarding enrollment ID.
 * @param reason       - Manager-provided reason for rejection with additional requirements.
 * @param slackClient  - Authenticated Slack Web API client.
 */
export async function rejectGraduation(
  enrollmentId: string,
  reason: string,
  slackClient: WebClient,
): Promise<void> {
  // Update enrollment back to ACTIVE
  const enrollment = await prisma.onboardingEnrollment.update({
    where: { id: enrollmentId },
    data: {
      status: OnboardingEnrollmentStatus.ACTIVE,
    },
    include: { plan: true },
  });

  // Send DM to BDR with rejection reason and additional requirements
  try {
    await slackClient.chat.postMessage({
      channel: enrollment.slackUserId,
      text: `Your graduation from *${enrollment.plan.name}* has been deferred by your manager.\n\n*Feedback:* ${reason}\n\nYou'll continue receiving daily modules. Please address the feedback above and your manager will re-evaluate when you're ready.`,
    });
  } catch (error) {
    logger.error('Failed to send graduation rejection DM to BDR', {
      enrollmentId,
      slackUserId: enrollment.slackUserId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  logger.info('Graduation rejected', {
    enrollmentId,
    bdrName: enrollment.bdrName,
    reason,
  });
  logAudit({ action: 'onboarding_enrollment_rejected', actorUserId: 'manager', targetType: 'onboarding_enrollment', targetId: enrollmentId, metadata: { reason } });
}
