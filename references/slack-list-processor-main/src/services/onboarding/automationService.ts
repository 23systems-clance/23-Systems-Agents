/**
 * Onboarding automation scheduling and dispatch service (Feature 7).
 *
 * Manages intra-day automations (check-ins, reminders, weekly summaries,
 * custom messages) for BDR onboarding enrollments. Automations are defined
 * on each module and scheduled as delayed BullMQ jobs after the daily module
 * DM is delivered.
 */

import { OnboardingModuleStatus } from '@prisma/client';
import type { AutomationType } from '@prisma/client';
import type { WebClient } from '@slack/web-api';
import { prisma } from '../../models/index.js';
import logger from '../../lib/logger.js';
import { logAudit } from '../../lib/auditLogger.js';
import { onboardingQueue } from '../queue/queues.js';
import type { OnboardingAutomationJobData } from '../queue/queues.js';
import * as slackBlocks from './slackBlocks.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Shape of an enrollment loaded with plan + module progress for automation processing. */
interface EnrollmentWithProgress {
  id: string;
  slackTeamId: string;
  slackUserId: string;
  bdrName: string;
  planId: string;
  managerId: string;
  timezone: string;
  currentDay: number;
  plan: {
    id: string;
    name: string;
    durationDays: number;
    modules: Array<{
      id: string;
      dayNumber: number;
      weekNumber: number;
      title: string;
    }>;
  };
  moduleProgress: Array<{
    dayNumber: number;
    status: OnboardingModuleStatus;
    module: {
      id: string;
      title: string;
      weekNumber: number;
    };
  }>;
}

/** Shape of an automation record loaded from the database. */
interface AutomationRecord {
  id: string;
  moduleId: string;
  type: AutomationType;
  triggerTime: string;
  content: string | null;
  conditions: unknown;
}

// ---------------------------------------------------------------------------
// scheduleAutomationsForDay
// ---------------------------------------------------------------------------

/**
 * Schedules all intra-day automations for a given enrollment and day number.
 *
 * Called by the daily delivery worker after sending a module DM. Loads the
 * module's automations for that day, calculates delays from the current time
 * to each automation's triggerTime (HH:mm), and creates BullMQ delayed jobs
 * on the 'onboarding' queue with job name 'onboarding-automation'.
 *
 * @param enrollmentId - The onboarding enrollment ID.
 * @param dayNumber    - The day/module number whose automations to schedule.
 */
export async function scheduleAutomationsForDay(
  enrollmentId: string,
  dayNumber: number,
): Promise<void> {
  // Load enrollment to get timezone and planId
  const enrollment = await prisma.onboardingEnrollment.findUniqueOrThrow({
    where: { id: enrollmentId },
    select: { planId: true, timezone: true },
  });

  // Load the module for this plan + dayNumber with its automations
  const module = await prisma.onboardingModule.findUnique({
    where: { planId_dayNumber: { planId: enrollment.planId, dayNumber } },
    include: {
      automations: { orderBy: { sortOrder: 'asc' } },
    },
  });

  if (!module) {
    logger.warn('No module found for automation scheduling', {
      enrollmentId,
      planId: enrollment.planId,
      dayNumber,
    });
    return;
  }

  if (module.automations.length === 0) {
    logger.debug('No automations defined for module', {
      enrollmentId,
      dayNumber,
      moduleId: module.id,
    });
    return;
  }

  const now = new Date();
  let scheduledCount = 0;

  for (const automation of module.automations) {
    const delayMs = calculateDelayMs(automation.triggerTime, enrollment.timezone, now);

    if (delayMs <= 0) {
      logger.debug('Automation trigger time already passed, skipping', {
        enrollmentId,
        automationId: automation.id,
        triggerTime: automation.triggerTime,
        timezone: enrollment.timezone,
      });
      continue;
    }

    const jobData: OnboardingAutomationJobData = {
      enrollmentId,
      automationId: automation.id,
      dayNumber,
    };

    await onboardingQueue.add('onboarding-automation', jobData, {
      delay: delayMs,
      jobId: `onboarding-auto-${enrollmentId}-${dayNumber}-${automation.id}`,
    });

    scheduledCount++;
  }

  logger.info('Scheduled intra-day automations', {
    enrollmentId,
    dayNumber,
    moduleId: module.id,
    totalAutomations: module.automations.length,
    scheduledCount,
  });
}

// ---------------------------------------------------------------------------
// processAutomation (dispatcher)
// ---------------------------------------------------------------------------

/**
 * Main dispatcher for processing an onboarding automation job.
 *
 * Loads the automation record from the database and routes to the correct
 * handler based on the automation type.
 *
 * @param enrollmentId - The onboarding enrollment ID.
 * @param automationId - The automation record ID.
 * @param dayNumber    - The day number in the plan.
 * @param slackClient  - Authenticated Slack WebClient for sending DMs.
 */
export async function processAutomation(
  enrollmentId: string,
  automationId: string,
  dayNumber: number,
  slackClient: WebClient,
): Promise<void> {
  // Load automation record
  const automation = await prisma.onboardingAutomation.findUniqueOrThrow({
    where: { id: automationId },
  });

  // Load enrollment with plan and module progress
  const enrollment = await loadEnrollmentWithProgress(enrollmentId);

  logger.info('Processing onboarding automation', {
    enrollmentId,
    automationId,
    type: automation.type,
    dayNumber,
  });

  switch (automation.type) {
    case 'CHECK_IN':
      await processCheckin(enrollment, automation, slackClient);
      break;
    case 'REMINDER':
      await processReminder(enrollment, automation, dayNumber, slackClient);
      break;
    case 'WEEKLY_SUMMARY':
      await processWeeklySummary(enrollment, slackClient);
      break;
    case 'CUSTOM_MESSAGE':
      await processCustomMessage(enrollment, automation, slackClient);
      break;
    default:
      logger.warn('Unknown automation type, skipping', {
        enrollmentId,
        automationId,
        type: automation.type,
      });
      return;
  }

  logAudit({ action: 'onboarding_automation_fired', actorUserId: 'system', targetType: 'onboarding_automation', targetId: automationId, metadata: { enrollmentId, dayNumber } });
}

// ---------------------------------------------------------------------------
// processCheckin
// ---------------------------------------------------------------------------

/**
 * Sends a check-in DM to the BDR.
 *
 * Uses slackBlocks.buildCheckinPrompt to build the message and sends it
 * via the Slack WebClient.
 *
 * @param enrollment - The enrollment record with plan and progress.
 * @param automation - The automation record containing prompt text.
 * @param slackClient - Authenticated Slack WebClient.
 */
export async function processCheckin(
  enrollment: EnrollmentWithProgress,
  automation: AutomationRecord,
  slackClient: WebClient,
): Promise<void> {
  const promptText = automation.content ?? 'How is your onboarding going so far? Let us know if you have any questions!';

  const message = slackBlocks.buildCheckinPrompt({
    enrollmentId: enrollment.id,
    automationId: automation.id,
    dayNumber: enrollment.currentDay,
    promptText,
  });

  await slackClient.chat.postMessage({
    channel: enrollment.slackUserId,
    text: message.text,
    blocks: message.blocks,
  });

  logger.info('Sent check-in DM', {
    enrollmentId: enrollment.id,
    automationId: automation.id,
    slackUserId: enrollment.slackUserId,
  });
}

// ---------------------------------------------------------------------------
// processReminder
// ---------------------------------------------------------------------------

/**
 * Sends a reminder DM if the module for the given day is still incomplete.
 *
 * Checks the module progress status. If the module is already COMPLETED,
 * the reminder is suppressed (no-op with a debug log). Otherwise, sends
 * a reminder DM via slackBlocks.buildReminderDm.
 *
 * @param enrollment  - The enrollment record with plan and progress.
 * @param automation  - The automation record.
 * @param dayNumber   - The day number to check completion for.
 * @param slackClient - Authenticated Slack WebClient.
 */
export async function processReminder(
  enrollment: EnrollmentWithProgress,
  automation: AutomationRecord,
  dayNumber: number,
  slackClient: WebClient,
): Promise<void> {
  // Find the module progress for this day
  const progress = enrollment.moduleProgress.find(
    (mp) => mp.dayNumber === dayNumber,
  );

  if (!progress) {
    logger.warn('No module progress found for reminder', {
      enrollmentId: enrollment.id,
      automationId: automation.id,
      dayNumber,
    });
    return;
  }

  // Suppress reminder if module is already completed
  if (progress.status === OnboardingModuleStatus.COMPLETED) {
    logger.debug('Module already completed, suppressing reminder', {
      enrollmentId: enrollment.id,
      dayNumber,
      moduleTitle: progress.module.title,
    });
    return;
  }

  const message = slackBlocks.buildReminderDm({
    moduleTitle: progress.module.title,
    dayNumber,
  });

  await slackClient.chat.postMessage({
    channel: enrollment.slackUserId,
    text: message.text,
    blocks: message.blocks,
  });

  logger.info('Sent reminder DM', {
    enrollmentId: enrollment.id,
    automationId: automation.id,
    dayNumber,
    moduleTitle: progress.module.title,
  });
}

// ---------------------------------------------------------------------------
// processWeeklySummary
// ---------------------------------------------------------------------------

/**
 * Calculates weekly stats and sends a weekly summary DM to the BDR.
 *
 * Computes the current week number based on the enrollment's currentDay,
 * counts modules completed this week and overall, determines a preview
 * of next week's upcoming modules, and sends the summary via
 * slackBlocks.buildWeeklySummary.
 *
 * @param enrollment  - The enrollment record with plan and progress.
 * @param slackClient - Authenticated Slack WebClient.
 */
export async function processWeeklySummary(
  enrollment: EnrollmentWithProgress,
  slackClient: WebClient,
): Promise<void> {
  const currentDay = enrollment.currentDay;
  const weekNumber = Math.ceil(currentDay / 5);

  // Calculate days belonging to this week (1-5 for week 1, 6-10 for week 2, etc.)
  const weekStartDay = (weekNumber - 1) * 5 + 1;
  const weekEndDay = weekNumber * 5;

  // Count modules completed this week
  const completedThisWeek = enrollment.moduleProgress.filter(
    (mp) =>
      mp.dayNumber >= weekStartDay &&
      mp.dayNumber <= weekEndDay &&
      mp.status === OnboardingModuleStatus.COMPLETED,
  ).length;

  // Count total completed modules
  const totalCompleted = enrollment.moduleProgress.filter(
    (mp) => mp.status === OnboardingModuleStatus.COMPLETED,
  ).length;

  const totalModules = enrollment.moduleProgress.length;

  // Build next week preview from upcoming modules
  const nextWeekStartDay = weekEndDay + 1;
  const nextWeekEndDay = nextWeekStartDay + 4;

  const upcomingModules = enrollment.plan.modules
    .filter(
      (mod) => mod.dayNumber >= nextWeekStartDay && mod.dayNumber <= nextWeekEndDay,
    )
    .sort((a, b) => a.dayNumber - b.dayNumber);

  const nextWeekPreview =
    upcomingModules.length > 0
      ? upcomingModules.map((mod) => mod.title).join(', ')
      : undefined;

  const message = slackBlocks.buildWeeklySummary({
    weekNumber,
    completedThisWeek,
    totalCompleted,
    totalModules,
    nextWeekPreview,
  });

  await slackClient.chat.postMessage({
    channel: enrollment.slackUserId,
    text: message.text,
    blocks: message.blocks,
  });

  logger.info('Sent weekly summary DM', {
    enrollmentId: enrollment.id,
    weekNumber,
    completedThisWeek,
    totalCompleted,
    totalModules,
  });
}

// ---------------------------------------------------------------------------
// processCustomMessage
// ---------------------------------------------------------------------------

/**
 * Sends a custom content DM using the automation's content field.
 *
 * @param enrollment  - The enrollment record with plan and progress.
 * @param automation  - The automation record containing the custom content.
 * @param slackClient - Authenticated Slack WebClient.
 */
export async function processCustomMessage(
  enrollment: EnrollmentWithProgress,
  automation: AutomationRecord,
  slackClient: WebClient,
): Promise<void> {
  const content = automation.content ?? '';

  if (!content.trim()) {
    logger.warn('Custom message automation has empty content, skipping', {
      enrollmentId: enrollment.id,
      automationId: automation.id,
    });
    return;
  }

  await slackClient.chat.postMessage({
    channel: enrollment.slackUserId,
    text: content,
    blocks: [
      {
        type: 'section',
        text: { type: 'mrkdwn', text: content },
      },
    ],
  });

  logger.info('Sent custom message DM', {
    enrollmentId: enrollment.id,
    automationId: automation.id,
  });
}

// ---------------------------------------------------------------------------
// cancelDayAutomations
// ---------------------------------------------------------------------------

/**
 * Removes any pending delayed automation jobs for a specific enrollment+day
 * combination from the onboarding queue.
 *
 * Loads the automations defined for the module at the given day number,
 * then removes each corresponding delayed job by its deterministic jobId.
 *
 * @param enrollmentId - The onboarding enrollment ID.
 * @param dayNumber    - The day number whose automation jobs to cancel.
 */
export async function cancelDayAutomations(
  enrollmentId: string,
  dayNumber: number,
): Promise<void> {
  // Load enrollment to get planId
  const enrollment = await prisma.onboardingEnrollment.findUniqueOrThrow({
    where: { id: enrollmentId },
    select: { planId: true },
  });

  // Load the module's automations to reconstruct job IDs
  const module = await prisma.onboardingModule.findUnique({
    where: { planId_dayNumber: { planId: enrollment.planId, dayNumber } },
    include: {
      automations: { select: { id: true } },
    },
  });

  if (!module || module.automations.length === 0) {
    logger.debug('No automations to cancel for day', {
      enrollmentId,
      dayNumber,
    });
    return;
  }

  let removedCount = 0;

  for (const automation of module.automations) {
    const jobId = `onboarding-auto-${enrollmentId}-${dayNumber}-${automation.id}`;
    try {
      const job = await onboardingQueue.getJob(jobId);
      if (job) {
        await job.remove();
        removedCount++;
      }
    } catch (err) {
      // Job may have already been processed or removed -- safe to ignore
      logger.debug('Could not remove automation job (may already be processed)', {
        jobId,
        error: (err as Error).message,
      });
    }
  }

  logger.info('Cancelled day automations', {
    enrollmentId,
    dayNumber,
    totalAutomations: module.automations.length,
    removedCount,
  });
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Loads an enrollment with plan (including modules) and ordered module progress.
 *
 * @param enrollmentId - The enrollment ID to load.
 * @returns The enrollment record shaped as EnrollmentWithProgress.
 */
async function loadEnrollmentWithProgress(
  enrollmentId: string,
): Promise<EnrollmentWithProgress> {
  const enrollment = await prisma.onboardingEnrollment.findUniqueOrThrow({
    where: { id: enrollmentId },
    include: {
      plan: {
        include: {
          modules: {
            orderBy: { dayNumber: 'asc' },
            select: {
              id: true,
              dayNumber: true,
              weekNumber: true,
              title: true,
            },
          },
        },
      },
      moduleProgress: {
        orderBy: { dayNumber: 'asc' },
        include: {
          module: {
            select: {
              id: true,
              title: true,
              weekNumber: true,
            },
          },
        },
      },
    },
  });

  return enrollment as EnrollmentWithProgress;
}

/**
 * Calculates the delay in milliseconds from `now` until a target trigger
 * time (HH:mm) in the enrollment's timezone.
 *
 * @param triggerTime - The target time in HH:mm format (e.g. "14:30").
 * @param timezone    - IANA timezone string (e.g. "America/New_York").
 * @param now         - The current Date reference point.
 * @returns Delay in milliseconds. Returns 0 or negative if the time has passed.
 */
function calculateDelayMs(
  triggerTime: string,
  timezone: string,
  now: Date,
): number {
  const [hoursStr, minutesStr] = triggerTime.split(':');
  const targetHours = parseInt(hoursStr, 10);
  const targetMinutes = parseInt(minutesStr, 10);

  if (isNaN(targetHours) || isNaN(targetMinutes)) {
    logger.warn('Invalid triggerTime format', { triggerTime });
    return 0;
  }

  // Get the current time in the enrollment's timezone
  const nowInTz = new Date(
    now.toLocaleString('en-US', { timeZone: timezone }),
  );

  // Build target time in the enrollment's timezone for today
  const targetInTz = new Date(nowInTz);
  targetInTz.setHours(targetHours, targetMinutes, 0, 0);

  // Calculate the difference in local-timezone milliseconds, then apply
  // that same offset to the real UTC clock
  const diffMs = targetInTz.getTime() - nowInTz.getTime();

  return diffMs;
}
