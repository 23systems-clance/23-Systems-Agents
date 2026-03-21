/**
 * Enrichment Progress Notification Module
 *
 * Provides notifications to users during long-running enrichment processes:
 * 1. Initial notification with estimated completion time
 * 2. Periodic "still processing" notifications every 60 seconds
 */

import { WebClient } from '@slack/web-api';
import { config } from '../../../config/index.js';

const slackClient = new WebClient(config.slack.botToken);
import logger from '../../../lib/logger.js';

/**
 * Configuration for progress notifications
 */
interface ProgressNotificationConfig {
  /** Job ID for tracking */
  jobId: string;
  /** Slack channel ID */
  channelId: string;
  /** Slack thread timestamp */
  threadTs: string;
  /** Number of companies being processed */
  companyCount: number;
  /** Job type (combined, technographic, contact, tech_report) */
  jobType: 'combined' | 'technographic' | 'contact' | 'tech_report';
  /** Whether phone waterfall cascade will run (adds significant time). */
  needsPhones?: boolean;
}

/**
 * Active notification intervals by job ID
 */
const activeNotifications = new Map<string, NodeJS.Timeout>();

/**
 * Calculate estimated processing time in minutes
 */
function estimateProcessingTime(
  companyCount: number,
  jobType: string,
  needsPhones?: boolean,
): number {
  // Estimation formula based on job type and company count
  // These are rough estimates - adjust based on real-world data
  const baseTimePerCompany = {
    combined: 3, // seconds per company (tech + contacts)
    technographic: 1.5, // seconds per company (BuiltWith only)
    contact: 1.5, // seconds per company (Apollo only)
    tech_report: 2, // seconds per company
  };

  let secondsPerCompany = baseTimePerCompany[jobType as keyof typeof baseTimePerCompany] ?? 2;

  // Phone waterfall cascade (Wiza → AI Ark) adds ~12s per company
  // (2 contacts/company avg, Wiza 90s timeout with 5 concurrent ≈ 6s/contact)
  if (needsPhones && (jobType === 'combined' || jobType === 'contact')) {
    secondsPerCompany += 12;
  }

  const totalSeconds = companyCount * secondsPerCompany;
  const minutes = Math.ceil(totalSeconds / 60);

  // Cap at reasonable maximum
  return Math.min(minutes, 45);
}

/**
 * Format time estimate into human-readable string
 */
function formatTimeEstimate(minutes: number): string {
  if (minutes < 1) {
    return 'less than a minute';
  } else if (minutes === 1) {
    return 'about 1 minute';
  } else if (minutes < 5) {
    return `${minutes}-${minutes + 1} minutes`;
  } else {
    return `about ${minutes} minutes`;
  }
}

/**
 * Start progress notifications for an enrichment job
 *
 * Sends an initial notification with estimated time, then periodic
 * "still processing" notifications every 60 seconds.
 *
 * @param config - Progress notification configuration
 */
export async function startProgressNotifications(
  config: ProgressNotificationConfig,
): Promise<void> {
  const { jobId, channelId, threadTs, companyCount, jobType, needsPhones } = config;

  // Clean up any existing notification for this job
  stopProgressNotifications(jobId);

  const estimatedMinutes = estimateProcessingTime(companyCount, jobType, needsPhones);
  const timeEstimate = formatTimeEstimate(estimatedMinutes);

  // Send initial notification
  try {
    const client = slackClient;
    await client.chat.postMessage({
      channel: channelId,
      thread_ts: threadTs,
      text: `Processing ${companyCount} ${companyCount === 1 ? 'company' : 'companies'}... This should take ${timeEstimate}. I'll keep you updated!`,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `:hourglass_flowing_sand: Processing *${companyCount}* ${companyCount === 1 ? 'company' : 'companies'}...\n\nEstimated time: *${timeEstimate}*\n\nI'll keep you updated as I progress!`,
          },
        },
      ],
    });

    logger.info('Initial progress notification sent', {
      jobId,
      channelId,
      companyCount,
      estimatedMinutes,
    });
  } catch (error) {
    logger.error('Failed to send initial progress notification', {
      jobId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  // Set up periodic notifications every 60 seconds
  let notificationCount = 0;
  const interval = setInterval(async () => {
    notificationCount++;

    try {
      const client = slackClient;
      const messages = [
        'Still working on your list... Thanks for your patience!',
        'Processing continues... Your list is almost ready!',
        'Still enriching companies... Hang tight!',
        'Making progress... Almost there!',
      ];

      const message = messages[notificationCount % messages.length];

      await client.chat.postMessage({
        channel: channelId,
        thread_ts: threadTs,
        text: message,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `:hourglass: ${message}`,
            },
          },
        ],
      });

      logger.debug('Periodic progress notification sent', {
        jobId,
        channelId,
        notificationNumber: notificationCount,
      });
    } catch (error) {
      logger.error('Failed to send periodic progress notification', {
        jobId,
        notificationNumber: notificationCount,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }, 60000); // 60 seconds

  // Store the interval so we can clear it later
  activeNotifications.set(jobId, interval);

  logger.info('Progress notifications started', {
    jobId,
    companyCount,
    estimatedMinutes,
  });
}

/**
 * Stop progress notifications for a job
 *
 * Clears the periodic notification interval.
 *
 * @param jobId - Job ID to stop notifications for
 */
export function stopProgressNotifications(jobId: string): void {
  const interval = activeNotifications.get(jobId);
  if (interval) {
    clearInterval(interval);
    activeNotifications.delete(jobId);
    logger.debug('Progress notifications stopped', { jobId });
  }
}

/**
 * Send a completion notification
 *
 * @param config - Basic notification configuration
 * @param successCount - Number of successfully processed companies
 * @param failedCount - Number of failed companies
 * @param phonesPending - Whether phone enrichment is pending (async delivery)
 */
export async function sendCompletionNotification(
  config: Pick<ProgressNotificationConfig, 'jobId' | 'channelId' | 'threadTs'>,
  successCount: number,
  failedCount: number,
  phonesPending: boolean = false,
): Promise<void> {
  const { jobId, channelId, threadTs } = config;

  // Stop periodic notifications
  stopProgressNotifications(jobId);

  try {
    const client = slackClient;
    const totalProcessed = successCount + failedCount;

    let message: string;
    if (failedCount === 0) {
      message = `:white_check_mark: Enrichment complete! Successfully processed *${successCount}* ${successCount === 1 ? 'company' : 'companies'}.`;
      if (phonesPending) {
        message += '\n:hourglass: Phone numbers are being processed and will be added when ready (usually 5-15 minutes).';
      }
    } else if (successCount === 0) {
      message = `:x: Enrichment completed with errors. Failed to process *${failedCount}* ${failedCount === 1 ? 'company' : 'companies'}.`;
    } else {
      message = `:white_check_mark: Enrichment complete! Successfully processed *${successCount}* ${successCount === 1 ? 'company' : 'companies'}. ${failedCount} failed.`;
      if (phonesPending) {
        message += '\n:hourglass: Phone numbers are being processed and will be added when ready (usually 5-15 minutes).';
      }
    }

    await client.chat.postMessage({
      channel: channelId,
      thread_ts: threadTs,
      text: message,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: message,
          },
        },
      ],
    });

    logger.info('Completion notification sent', {
      jobId,
      channelId,
      successCount,
      failedCount,
    });
  } catch (error) {
    logger.error('Failed to send completion notification', {
      jobId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
