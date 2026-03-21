/**
 * Single BullMQ dispatcher worker for the 'onboarding' queue.
 *
 * Routes incoming jobs to the correct processor based on `job.name`.
 * Handles: onboarding-daily-dm, onboarding-automation, onboarding-daily-check.
 */

import { Worker, Job } from 'bullmq';
import type { WebClient } from '@slack/web-api';
import { config } from '../../../config/index.js';
import { logError } from '../../../services/admin/errorLogger.js';
import { processAutomation } from '../../onboarding/automationService.js';
import { deliverDailyModule } from '../../onboarding/deliveryService.js';
import { checkConsecutiveIncomplete } from '../../onboarding/progressService.js';
import * as slackBlocks from '../../onboarding/slackBlocks.js';
import { prisma } from '../../../models/index.js';
import logger from '../../../lib/logger.js';

/**
 * Creates a single BullMQ Worker on the 'onboarding' queue that
 * dispatches each job to the correct processor based on job.name.
 *
 * @param slackClient - Slack Web API client for DM-sending jobs
 * @returns A configured BullMQ Worker instance.
 */
export function createOnboardingWorker(slackClient: WebClient): Worker {
  /**
   * Processes a daily DM delivery job for a single enrollment.
   * Called by per-enrollment BullMQ job schedulers.
   */
  async function processOnboardingDailyDm(job: Job): Promise<void> {
    const { enrollmentId } = job.data;
    logger.info('Processing onboarding daily DM job', {
      enrollmentId,
      bullmqJobId: job.id,
    });

    await deliverDailyModule(enrollmentId, slackClient);

    logger.info('Onboarding daily DM job completed', {
      enrollmentId,
      bullmqJobId: job.id,
    });
  }

  /**
   * Processes an intra-day automation job (check-in, reminder, weekly summary, custom message).
   * Scheduled as delayed jobs by the daily delivery processor.
   */
  async function processOnboardingAutomation(job: Job): Promise<void> {
    const { enrollmentId, automationId, dayNumber } = job.data;
    logger.info('Processing onboarding automation job', {
      enrollmentId,
      automationId,
      dayNumber,
      bullmqJobId: job.id,
    });

    await processAutomation(enrollmentId, automationId, dayNumber, slackClient);

    logger.info('Onboarding automation job completed', {
      enrollmentId,
      automationId,
      bullmqJobId: job.id,
    });
  }

  /**
   * Processes the daily check job: scans all active/supervised enrollments
   * for overdue, behind-schedule, or quiz-failed conditions and alerts managers.
   */
  async function processOnboardingDailyCheck(job: Job): Promise<void> {
    logger.info('Processing onboarding daily check job', { bullmqJobId: job.id });

    // Iterate all active/supervised enrollments and check for alerts
    const enrollments = await prisma.onboardingEnrollment.findMany({
      where: {
        status: { in: ['ACTIVE', 'SUPERVISED'] },
      },
      include: {
        plan: { select: { durationDays: true } },
      },
    });

    let alertsSent = 0;

    for (const enrollment of enrollments) {
      try {
        // Check consecutive incomplete modules (default threshold: 2)
        const behindCheck = await checkConsecutiveIncomplete(enrollment.id);
        if (behindCheck.behind) {
          const alertMsg = slackBlocks.buildAlertDm({
            alertType: 'behind_schedule',
            bdrName: enrollment.bdrName,
            details: `${behindCheck.consecutiveIncomplete} consecutive modules incomplete. Current module: ${behindCheck.currentModule}`,
            enrollmentId: enrollment.id,
          });
          await slackClient.chat.postMessage({
            channel: enrollment.managerId,
            text: alertMsg.text,
            blocks: alertMsg.blocks,
          });
          alertsSent++;
        }

        // Check if past expected end date
        const expectedEndDay = enrollment.plan.durationDays + enrollment.extendedDays;
        if (enrollment.currentDay > expectedEndDay) {
          const alertMsg = slackBlocks.buildAlertDm({
            alertType: 'overdue',
            bdrName: enrollment.bdrName,
            details: `Onboarding is overdue — currently on day ${enrollment.currentDay} of a ${expectedEndDay}-day plan.`,
            enrollmentId: enrollment.id,
          });
          await slackClient.chat.postMessage({
            channel: enrollment.managerId,
            text: alertMsg.text,
            blocks: alertMsg.blocks,
          });
          alertsSent++;
        }
      } catch (enrollmentErr) {
        logger.error('Error checking enrollment in daily check', {
          enrollmentId: enrollment.id,
          error: (enrollmentErr as Error).message,
        });
      }
    }

    logger.info('Onboarding daily check job completed', {
      bullmqJobId: job.id,
      enrollmentsChecked: enrollments.length,
      alertsSent,
    });
  }

  const processors: Record<string, (job: Job) => Promise<void>> = {
    'onboarding-daily-dm': processOnboardingDailyDm,
    'onboarding-automation': processOnboardingAutomation,
    'onboarding-daily-check': processOnboardingDailyCheck,
  };

  const worker = new Worker(
    'onboarding',
    async (job: Job) => {
      const processor = processors[job.name];
      if (!processor) {
        logger.error('Unknown job name on onboarding queue', {
          jobName: job.name,
          bullmqJobId: job.id,
        });
        throw new Error(`Unknown onboarding job name: ${job.name}`);
      }

      await processor(job);
    },
    {
      connection: { url: config.redis.url },
      concurrency: 1,
    },
  );

  worker.on('completed', (job: Job) => {
    logger.info('Onboarding job completed', {
      bullmqJobId: job.id,
      jobName: job.name,
      enrollmentId: job.data?.enrollmentId,
    });
  });

  worker.on('failed', (job: Job | undefined, err: Error) => {
    logger.error('Onboarding job failed', {
      bullmqJobId: job?.id,
      jobName: job?.name,
      enrollmentId: job?.data?.enrollmentId,
      error: err.message,
    });
    logError({
      category: 'QUEUE_ERROR',
      service: `queue:${job?.name ?? 'onboarding'}`,
      message: err.message,
      stackTrace: err.stack,
    });
  });

  return worker;
}
