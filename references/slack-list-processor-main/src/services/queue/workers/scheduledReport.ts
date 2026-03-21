/**
 * Scheduled report BullMQ worker.
 *
 * Processes 'scheduled-report' jobs from the admin queue.
 * Loads report config, generates CSV via reportGenerator,
 * and posts the report content to the configured Slack channel.
 */

import { Worker } from 'bullmq';
import { WebClient } from '@slack/web-api';
import { prisma } from '../../../models/index.js';
import { config } from '../../../config/index.js';
import { generateReport } from '../../admin/reportGenerator.js';
import logger from '../../../lib/logger.js';
import type { ScheduledReportJobData } from '../queues.js';

/**
 * Creates and returns the scheduled report worker.
 */
export function createScheduledReportWorker(): Worker<ScheduledReportJobData> {
  const slackClient = new WebClient(config.slack.botToken);

  const worker = new Worker<ScheduledReportJobData>(
    'admin',
    async (job) => {
      if (job.name !== 'scheduled-report') return;

      const { reportId } = job.data;

      const report = await prisma.scheduledReport.findUnique({
        where: { id: reportId },
      });

      if (!report || !report.isActive) {
        logger.info('Scheduled report skipped (inactive or deleted)', { reportId });
        return;
      }

      try {
        // Determine date range based on frequency.
        const now = new Date();
        let startDate: Date;

        switch (report.frequency) {
          case 'DAILY': {
            startDate = new Date(now);
            startDate.setUTCDate(startDate.getUTCDate() - 1);
            startDate.setUTCHours(0, 0, 0, 0);
            break;
          }
          case 'WEEKLY': {
            startDate = new Date(now);
            startDate.setUTCDate(startDate.getUTCDate() - 7);
            startDate.setUTCHours(0, 0, 0, 0);
            break;
          }
          case 'MONTHLY': {
            startDate = new Date(now);
            startDate.setUTCMonth(startDate.getUTCMonth() - 1);
            startDate.setUTCHours(0, 0, 0, 0);
            break;
          }
          default:
            startDate = new Date(now);
            startDate.setUTCDate(startDate.getUTCDate() - 7);
            startDate.setUTCHours(0, 0, 0, 0);
        }

        const endDate = new Date(now);
        endDate.setUTCHours(23, 59, 59, 999);

        const filters = report.filters as { service?: string; slack_team_id?: string } | null;

        const csv = await generateReport({
          reportType: report.reportType,
          startDate,
          endDate,
          filters: filters
            ? { service: filters.service ?? null, slackTeamId: filters.slack_team_id ?? null }
            : undefined,
        });

        const dateRange = `${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}`;
        const filename = `${report.reportType.toLowerCase().replace(/_/g, '-')}-${dateRange.replace(/ to /g, '-to-')}.csv`;

        // Upload CSV as a file snippet to Slack.
        await slackClient.filesUploadV2({
          channel_id: report.slackChannelId,
          content: csv,
          filename,
          title: `${report.name} — ${dateRange}`,
          initial_comment: `Scheduled report: *${report.name}* (${report.reportType}, ${report.frequency})\nPeriod: ${dateRange}`,
        });

        await prisma.scheduledReport.update({
          where: { id: reportId },
          data: { lastRunAt: new Date(), lastError: null },
        });

        logger.info('Scheduled report delivered', {
          reportId,
          reportName: report.name,
          channel: report.slackChannelId,
        });
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);

        await prisma.scheduledReport.update({
          where: { id: reportId },
          data: { lastError: errorMsg },
        });

        logger.error('Scheduled report failed', {
          reportId,
          reportName: report.name,
          error: errorMsg,
        });

        throw error;
      }
    },
    {
      connection: { url: config.redis.url },
    },
  );

  worker.on('failed', (job, err) => {
    logger.error('Scheduled report worker failed', {
      jobId: job?.id,
      error: err.message,
    });
  });

  return worker;
}
