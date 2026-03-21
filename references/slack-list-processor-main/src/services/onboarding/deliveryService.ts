/**
 * Onboarding daily module delivery service (Feature 7).
 *
 * Orchestrates the daily DM delivery to BDRs: determines the current
 * business day, loads the correct module, builds the Block Kit message,
 * sends the DM via Slack, updates progress records, schedules intra-day
 * automations, and triggers manager alerts when a BDR falls behind.
 */

import { OnboardingModuleStatus, OnboardingEnrollmentStatus, ContactCampaignStatus, StepExecutionStatus, StepType } from '@prisma/client';
import type { WebClient } from '@slack/web-api';
import { prisma } from '../../models/index.js';
import { config } from '../../config/index.js';
import logger from '../../lib/logger.js';
import * as slackBlocks from './slackBlocks.js';
import { scheduleAutomationsForDay } from './automationService.js';
import { checkConsecutiveIncomplete } from './progressService.js';

// ---------------------------------------------------------------------------
// Business-day calculation
// ---------------------------------------------------------------------------

/**
 * Calculates the number of business days (weekdays) between a start date
 * and a target date, inclusive of the start date as day 1.
 *
 * If `weekdaysOnly` is false, counts all calendar days instead.
 *
 * @param startDate - The enrollment start date.
 * @param today     - The target/current date.
 * @param weekdaysOnly - Whether to skip weekends (default true).
 * @returns The 1-based business day number.
 */
function calculateCurrentBusinessDay(
  startDate: Date,
  today: Date,
  weekdaysOnly: boolean = true,
): number {
  // Normalise both dates to midnight UTC to avoid time-of-day drift
  const start = new Date(Date.UTC(startDate.getFullYear(), startDate.getMonth(), startDate.getDate()));
  const end = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));

  if (end < start) {
    return 0;
  }

  if (!weekdaysOnly) {
    // Simple calendar-day count, 1-based
    const diffMs = end.getTime() - start.getTime();
    return Math.floor(diffMs / (1000 * 60 * 60 * 24)) + 1;
  }

  // Count weekdays between start and end (inclusive)
  let businessDays = 0;
  const cursor = new Date(start);

  while (cursor <= end) {
    const dayOfWeek = cursor.getUTCDay(); // 0=Sun, 6=Sat
    if (dayOfWeek !== 0 && dayOfWeek !== 6) {
      businessDays++;
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return businessDays;
}

// ---------------------------------------------------------------------------
// deliverDailyModule
// ---------------------------------------------------------------------------

/**
 * Delivers the daily onboarding module DM to a BDR.
 *
 * This is the main entry point called by the BullMQ worker when the
 * `onboarding-daily-dm` job fires. It:
 *
 * 1. Loads the enrollment with plan modules and module progress.
 * 2. Determines the current business day.
 * 3. Finds the module for that day.
 * 4. Checks whether the previous day's module is incomplete.
 * 5. Builds and sends the Block Kit DM via Slack.
 * 6. Updates ModuleProgress (status, deliveredAt, messageTs).
 * 7. Advances the enrollment's currentDay.
 * 8. Schedules intra-day automations.
 * 9. Checks consecutive-incomplete threshold and alerts manager if needed.
 * 10. Transitions to SUPERVISED status when supervisedStartDay is reached.
 *
 * @param enrollmentId - The onboarding enrollment ID.
 * @param slackClient  - Authenticated Slack WebClient for sending DMs.
 */
export async function deliverDailyModule(
  enrollmentId: string,
  slackClient: WebClient,
): Promise<void> {
  try {
    // ------------------------------------------------------------------
    // 1. Load enrollment with plan, modules, training items, and progress
    // ------------------------------------------------------------------
    const enrollment = await prisma.onboardingEnrollment.findUniqueOrThrow({
      where: { id: enrollmentId },
      include: {
        plan: {
          include: {
            modules: {
              orderBy: { dayNumber: 'asc' },
              include: {
                trainingItems: { orderBy: { sortOrder: 'asc' } },
              },
            },
          },
        },
        moduleProgress: {
          orderBy: { dayNumber: 'asc' },
          include: {
            module: { select: { id: true, title: true, weekNumber: true } },
          },
        },
      },
    });

    // Guard: only deliver for active/supervised enrollments
    if (
      enrollment.status !== OnboardingEnrollmentStatus.ACTIVE &&
      enrollment.status !== OnboardingEnrollmentStatus.SUPERVISED
    ) {
      logger.info('Enrollment not in deliverable status, skipping', {
        enrollmentId,
        status: enrollment.status,
      });
      return;
    }

    // ------------------------------------------------------------------
    // 2. Determine current business day
    // ------------------------------------------------------------------
    const today = new Date();
    const currentDay = calculateCurrentBusinessDay(
      enrollment.startDate,
      today,
      enrollment.plan.weekdaysOnly,
    );

    if (currentDay <= 0) {
      logger.warn('Current business day is non-positive, skipping delivery', {
        enrollmentId,
        startDate: enrollment.startDate,
        currentDay,
      });
      return;
    }

    // ------------------------------------------------------------------
    // 3. Get the module for the current day number
    // ------------------------------------------------------------------
    const todaysModule = enrollment.plan.modules.find(
      (mod) => mod.dayNumber === currentDay,
    );

    if (!todaysModule) {
      logger.info(
        'No module found for current day — BDR may have completed all modules or day exceeds plan duration',
        {
          enrollmentId,
          currentDay,
          totalModules: enrollment.plan.modules.length,
          planDurationDays: enrollment.plan.durationDays,
        },
      );
      return;
    }

    // ------------------------------------------------------------------
    // 4. Check if previous day's module is incomplete
    // ------------------------------------------------------------------
    let hasPreviousIncomplete = false;
    let previousModuleTitle: string | undefined;

    if (currentDay > 1) {
      const previousProgress = enrollment.moduleProgress.find(
        (mp) => mp.dayNumber === currentDay - 1,
      );

      if (
        previousProgress &&
        previousProgress.status !== OnboardingModuleStatus.COMPLETED
      ) {
        hasPreviousIncomplete = true;
        previousModuleTitle = previousProgress.module.title;
      }
    }

    // ------------------------------------------------------------------
    // 5. Build Block Kit DM
    // ------------------------------------------------------------------
    const completedCount = enrollment.moduleProgress.filter(
      (mp) => mp.status === OnboardingModuleStatus.COMPLETED,
    ).length;

    const trainingItems: slackBlocks.TrainingItemBlock[] =
      todaysModule.trainingItems.map((item) => ({
        type: item.type,
        title: item.title,
        content: item.content ?? undefined,
        quizOptions:
          item.type === 'QUIZ' && item.metadata
            ? (item.metadata as Record<string, unknown> & { options?: Array<{ text: string; value: string }> })
                .options?.map((opt: { text: string; value: string }) => ({
                  text: opt.text,
                  value: opt.value,
                }))
            : undefined,
      }));

    // Choose between standard DM and supervised blended DM
    let message: slackBlocks.SlackMessage;

    if (
      enrollment.status === OnboardingEnrollmentStatus.SUPERVISED &&
      enrollment.supervisedCampaignId
    ) {
      // Supervised phase: build blended DM with campaign tasks
      const campaignTasks = await loadCampaignTaskSummary(
        enrollment.supervisedCampaignId,
        enrollment.slackUserId,
      );

      message = slackBlocks.buildSupervisedDm({
        enrollmentId,
        dayNumber: currentDay,
        weekNumber: todaysModule.weekNumber,
        moduleTitle: todaysModule.title,
        moduleDescription: todaysModule.description ?? undefined,
        trainingItems,
        progressCompleted: completedCount,
        progressTotal: enrollment.moduleProgress.length,
        hasPreviousIncomplete,
        previousModuleTitle,
        campaignTasks,
      });
    } else {
      message = slackBlocks.buildDailyModuleDm({
        enrollmentId,
        dayNumber: currentDay,
        weekNumber: todaysModule.weekNumber,
        moduleTitle: todaysModule.title,
        moduleDescription: todaysModule.description ?? undefined,
        trainingItems,
        progressCompleted: completedCount,
        progressTotal: enrollment.moduleProgress.length,
        hasPreviousIncomplete,
        previousModuleTitle,
      });
    }

    // ------------------------------------------------------------------
    // 6. Send DM to BDR
    // ------------------------------------------------------------------
    let messageTs: string | undefined;
    try {
      const result = await slackClient.chat.postMessage({
        channel: enrollment.slackUserId,
        text: message.text,
        blocks: message.blocks,
      });
      messageTs = result.ts;
    } catch (dmError) {
      // DM send failed — record failure on the progress record
      logger.error('Failed to send daily module DM', {
        enrollmentId,
        currentDay,
        error: (dmError as Error).message,
      });

      await prisma.moduleProgress.update({
        where: {
          enrollmentId_dayNumber: { enrollmentId, dayNumber: currentDay },
        },
        data: {
          deliveryFailed: true,
          deliveryError: (dmError as Error).message,
        },
      });

      return;
    }

    // ------------------------------------------------------------------
    // 7. Update ModuleProgress: DELIVERED, deliveredAt, messageTs
    // ------------------------------------------------------------------
    await prisma.moduleProgress.update({
      where: {
        enrollmentId_dayNumber: { enrollmentId, dayNumber: currentDay },
      },
      data: {
        status: OnboardingModuleStatus.DELIVERED,
        deliveredAt: new Date(),
        deliveryMessageTs: messageTs,
      },
    });

    // ------------------------------------------------------------------
    // 8. Update enrollment currentDay
    // ------------------------------------------------------------------
    await prisma.onboardingEnrollment.update({
      where: { id: enrollmentId },
      data: { currentDay },
    });

    logger.info('Daily module delivered', {
      enrollmentId,
      currentDay,
      moduleTitle: todaysModule.title,
      weekNumber: todaysModule.weekNumber,
    });

    // ------------------------------------------------------------------
    // 9. Schedule intra-day automations
    // ------------------------------------------------------------------
    await scheduleAutomationsForDay(enrollmentId, currentDay);

    // ------------------------------------------------------------------
    // 10. Check consecutive incomplete threshold — alert manager
    // ------------------------------------------------------------------
    const incompleteCheck = await checkConsecutiveIncomplete(enrollmentId);

    if (incompleteCheck.behind) {
      const alertMessage = slackBlocks.buildAlertDm({
        alertType: 'behind_schedule',
        bdrName: enrollment.bdrName,
        details: `${enrollment.bdrName} has ${incompleteCheck.consecutiveIncomplete} consecutive incomplete modules. Current module: ${incompleteCheck.currentModule}.`,
        enrollmentId,
      });

      try {
        await slackClient.chat.postMessage({
          channel: enrollment.managerId,
          text: alertMessage.text,
          blocks: alertMessage.blocks,
        });

        logger.info('Manager alert sent for behind-schedule BDR', {
          enrollmentId,
          managerId: enrollment.managerId,
          consecutiveIncomplete: incompleteCheck.consecutiveIncomplete,
        });
      } catch (alertError) {
        logger.error('Failed to send manager alert DM', {
          enrollmentId,
          managerId: enrollment.managerId,
          error: (alertError as Error).message,
        });
      }
    }

    // ------------------------------------------------------------------
    // 11. Check if supervisedStartDay reached — transition status
    // ------------------------------------------------------------------
    if (
      enrollment.plan.supervisedStartDay &&
      currentDay >= enrollment.plan.supervisedStartDay &&
      enrollment.status === OnboardingEnrollmentStatus.ACTIVE
    ) {
      await prisma.onboardingEnrollment.update({
        where: { id: enrollmentId },
        data: { status: OnboardingEnrollmentStatus.SUPERVISED },
      });

      logger.info('Enrollment transitioned to SUPERVISED status', {
        enrollmentId,
        currentDay,
        supervisedStartDay: enrollment.plan.supervisedStartDay,
      });
    }
  } catch (error) {
    logger.error('Unexpected error in deliverDailyModule', {
      enrollmentId,
      error: (error as Error).message,
      stack: (error as Error).stack,
    });
    throw error;
  }
}

// ---------------------------------------------------------------------------
// loadCampaignTaskSummary
// ---------------------------------------------------------------------------

/**
 * Loads today's campaign task summary for a supervised BDR.
 *
 * Queries pending calls, queued emails, queued LinkedIn actions, and unread
 * replies from the campaign's contacts and step executions.
 *
 * @param campaignId - The supervised campaign ID.
 * @param slackUserId - The BDR's Slack user ID.
 * @returns Summary of today's campaign tasks.
 */
async function loadCampaignTaskSummary(
  campaignId: string,
  _slackUserId: string,
): Promise<slackBlocks.CampaignTaskSummary> {
  const [campaign, pendingCalls, emailsQueued, linkedinQueued, unreadReplies] =
    await Promise.all([
      prisma.campaign.findUniqueOrThrow({
        where: { id: campaignId },
        select: { name: true },
      }),

      // Calls to make: pending phone step executions for this campaign
      prisma.campaignContactStepExecution.count({
        where: {
          stepType: StepType.PHONE,
          status: StepExecutionStatus.PENDING,
          campaignContact: { campaignId },
        },
      }),

      // Emails queued: pending email step executions
      prisma.campaignContactStepExecution.count({
        where: {
          stepType: StepType.EMAIL,
          status: StepExecutionStatus.PENDING,
          campaignContact: { campaignId },
        },
      }),

      // LinkedIn actions queued
      prisma.campaignContactStepExecution.count({
        where: {
          stepType: StepType.LINKEDIN,
          status: StepExecutionStatus.PENDING,
          campaignContact: { campaignId },
        },
      }),

      // Unread replies (contacts in RESPONDED status)
      prisma.campaignContact.count({
        where: {
          campaignId,
          status: ContactCampaignStatus.RESPONDED,
        },
      }),
    ]);

  const baseUrl = config.webhookBaseUrl ?? '';
  const taskDashboardUrl = baseUrl ? `${baseUrl}/bdr/tasks` : undefined;

  return {
    campaignName: campaign.name,
    callsToMake: pendingCalls,
    emailsQueued,
    linkedinQueued,
    unreadReplies,
    taskDashboardUrl,
  };
}
