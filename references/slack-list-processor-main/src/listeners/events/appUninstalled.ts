/**
 * Bolt app_uninstalled event handler (T058).
 *
 * Listens for app uninstallation events and:
 * 1. Updates WorkspaceInstallation status to UNINSTALLED
 * 2. Sets uninstalledAt timestamp
 * 3. Sets purgeAfter to now + 90 days
 * 4. Invalidates Redis auth cache
 * 5. Cancels any running jobs for the workspace
 */

import type { App } from '@slack/bolt';
import { prisma } from '../../models/index.js';
import redis from '../../lib/redis.js';
import logger from '../../lib/logger.js';
import { enrichmentQueue } from '../../services/queue/queues.js';

/**
 * Registers the app_uninstalled event listener on the given Bolt app.
 */
export function registerAppUninstalledListener(app: App): void {
  app.event('app_uninstalled', async ({ event }) => {
    try {
      const teamId = (event as unknown as { team_id?: string }).team_id;

      if (!teamId) {
        logger.warn('app_uninstalled event missing team_id');
        return;
      }

      logger.info('App uninstalled event received', { teamId });

      // Calculate purge date (90 days from now)
      const now = new Date();
      const purgeAfter = new Date();
      purgeAfter.setDate(purgeAfter.getDate() + 90);

      // Update workspace installation status
      await prisma.workspaceInstallation.update({
        where: { slackTeamId: teamId },
        data: {
          status: 'UNINSTALLED',
          uninstalledAt: now,
          purgeAfter,
        },
      });

      // Invalidate Redis auth cache
      await redis.del(`install:${teamId}`);

      logger.info('Workspace installation marked as uninstalled', {
        teamId,
        purgeAfter: purgeAfter.toISOString(),
      });

      // Cancel all running jobs for this workspace
      await cancelWorkspaceJobs(teamId);
    } catch (error) {
      logger.error('Error handling app_uninstalled event', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
}

/**
 * Cancels all running jobs for a workspace across all queues.
 */
async function cancelWorkspaceJobs(teamId: string): Promise<void> {
  try {
    // Find all active jobs for this workspace
    const activeJobs = await prisma.job.findMany({
      where: {
        slackTeamId: teamId,
        status: {
          in: ['PENDING', 'PROCESSING', 'AWAITING_PHONES'],
        },
      },
      select: { id: true, jobType: true, status: true },
    });

    if (activeJobs.length === 0) {
      logger.info('No active jobs to cancel', { teamId });
      return;
    }

    logger.info('Cancelling active jobs for uninstalled workspace', {
      teamId,
      jobCount: activeJobs.length,
    });

    // Update job statuses to CANCELLED
    await prisma.job.updateMany({
      where: {
        slackTeamId: teamId,
        status: {
          in: ['PENDING', 'PROCESSING', 'AWAITING_PHONES'],
        },
      },
      data: {
        status: 'CANCELLED',
        completedAt: new Date(),
      },
    });

    // Remove jobs from BullMQ enrichment queue
    const queues = [enrichmentQueue];

    for (const queue of queues) {
      // Get all jobs in the queue
      const jobs = await queue.getJobs(['active', 'waiting', 'delayed']);

      // Filter and remove jobs for this team
      for (const job of jobs) {
        const jobData = job.data as { jobId?: string };
        if (!jobData.jobId) continue;

        // Check if this job belongs to the uninstalled workspace
        const dbJob = await prisma.job.findUnique({
          where: { id: jobData.jobId },
          select: { slackTeamId: true },
        });

        if (dbJob?.slackTeamId === teamId) {
          await job.remove();
          logger.debug('Removed job from queue', {
            jobId: jobData.jobId,
            queueName: queue.name,
          });
        }
      }
    }

    logger.info('Active jobs cancelled', {
      teamId,
      cancelledCount: activeJobs.length,
    });
  } catch (error) {
    logger.error('Error cancelling workspace jobs', {
      teamId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
