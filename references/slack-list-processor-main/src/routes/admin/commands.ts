/**
 * Admin commands REST API routes.
 *
 * Mirrors the Slack `/admin` subcommands as REST endpoints for the admin dashboard.
 *
 * GET  /commands/jobs            — List enrichment jobs with optional status filter, pagination.
 * GET  /commands/jobs/:jobId     — Get single job details.
 * POST /commands/jobs/:jobId/cancel — Cancel a running job.
 * GET  /commands/usage           — Get API usage statistics (daily/weekly).
 * GET  /commands/errors          — Get recent errors.
 * GET  /commands/workflows       — Get active job workflows with progress.
 * GET  /commands/workers         — Get BullMQ queue stats and worker configs.
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../models/index.js';
import logger from '../../lib/logger.js';
import {
  enrichmentQueue,
  phoneDataQueue,
  fileGenerationQueue,
  analysisQueue,
  emailEnrichmentQueue,
  adminQueue,
  campaignQueue,
} from '../../services/queue/queues.js';

const log = logger.withContext({ service: 'adminCommandsApi' });

export const adminCommandsRouter = Router();

// ---------------------------------------------------------------------------
// GET /jobs — List enrichment jobs with optional status filter, pagination.
// ---------------------------------------------------------------------------

adminCommandsRouter.get('/jobs', async (req: Request, res: Response) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
    const offset = Math.max(Number(req.query.offset) || 0, 0);

    const where: Prisma.JobWhereInput = {};

    if (req.query.status) where.status = req.query.status as Prisma.EnumJobStatusFilter;
    if (req.query.job_type) where.jobType = req.query.job_type as Prisma.EnumJobTypeFilter;
    if (req.query.slack_team_id) where.slackTeamId = req.query.slack_team_id as string;

    const [jobs, total] = await Promise.all([
      prisma.job.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
        select: {
          id: true,
          jobType: true,
          status: true,
          progress: true,
          sourceFileName: true,
          sourceRowCount: true,
          companiesProcessed: true,
          contactsFound: true,
          slackUserId: true,
          slackTeamId: true,
          slackChannelName: true,
          errorMessage: true,
          createdAt: true,
          startedAt: true,
          completedAt: true,
        },
      }),
      prisma.job.count({ where }),
    ]);

    res.json({
      jobs: jobs.map((j) => ({
        id: j.id,
        job_type: j.jobType,
        status: j.status,
        progress: j.progress,
        source_file_name: j.sourceFileName,
        source_row_count: j.sourceRowCount,
        companies_processed: j.companiesProcessed,
        contacts_found: j.contactsFound,
        slack_user_id: j.slackUserId,
        slack_team_id: j.slackTeamId,
        slack_channel_name: j.slackChannelName,
        error_message: j.errorMessage,
        created_at: j.createdAt,
        started_at: j.startedAt,
        completed_at: j.completedAt,
      })),
      total,
      limit,
      offset,
    });
  } catch (err) {
    log.error('Failed to list jobs via commands API', { error: err });
    res.status(500).json({ error: 'internal_error', message: 'An unexpected error occurred' });
  }
});

// ---------------------------------------------------------------------------
// GET /jobs/:jobId — Get single job details.
// ---------------------------------------------------------------------------

adminCommandsRouter.get('/jobs/:jobId', async (req: Request, res: Response) => {
  try {
    const jobId = req.params['jobId'] as string;

    const job = await prisma.job.findUnique({
      where: { id: jobId },
      include: {
        apiUsageLogs: {
          select: {
            service: true,
            endpoint: true,
            estimatedCostUsd: true,
            creditsConsumed: true,
            durationMs: true,
            createdAt: true,
          },
        },
      },
    });

    if (!job) {
      res.status(404).json({ error: 'not_found', message: 'Job not found' });
      return;
    }

    let totalApiCostUsd = 0;
    for (const l of job.apiUsageLogs) {
      totalApiCostUsd += parseFloat(l.estimatedCostUsd?.toString() ?? '0');
    }

    res.json({
      id: job.id,
      job_type: job.jobType,
      status: job.status,
      progress: job.progress,
      source_file_name: job.sourceFileName,
      source_row_count: job.sourceRowCount,
      companies_processed: job.companiesProcessed,
      companies_failed: job.companiesFailed,
      contacts_found: job.contactsFound,
      error_message: job.errorMessage,
      slack_user_id: job.slackUserId,
      slack_team_id: job.slackTeamId,
      slack_channel_id: job.slackChannelId,
      slack_channel_name: job.slackChannelName,
      bullmq_job_id: job.bullmqJobId,
      purpose: job.purpose,
      total_api_cost_usd: totalApiCostUsd.toFixed(6),
      api_usage_logs: job.apiUsageLogs.map((l) => ({
        service: l.service,
        endpoint: l.endpoint,
        estimated_cost_usd: l.estimatedCostUsd?.toString() ?? '0',
        credits_consumed: l.creditsConsumed?.toString() ?? '0',
        duration_ms: l.durationMs,
        created_at: l.createdAt,
      })),
      created_at: job.createdAt,
      started_at: job.startedAt,
      completed_at: job.completedAt,
      updated_at: job.updatedAt,
    });
  } catch (err) {
    log.error('Failed to get job detail via commands API', { error: err });
    res.status(500).json({ error: 'internal_error', message: 'An unexpected error occurred' });
  }
});

// ---------------------------------------------------------------------------
// POST /jobs/:jobId/cancel — Cancel a running job.
// ---------------------------------------------------------------------------

adminCommandsRouter.post('/jobs/:jobId/cancel', async (req: Request, res: Response) => {
  try {
    const jobId = req.params['jobId'] as string;

    const job = await prisma.job.findUnique({
      where: { id: jobId },
      select: { id: true, status: true, bullmqJobId: true },
    });

    if (!job) {
      res.status(404).json({ error: 'not_found', message: 'Job not found' });
      return;
    }

    const cancelableStatuses = ['PENDING', 'PROCESSING', 'AWAITING_PHONES', 'AWAITING_DNC_DECISION', 'AWAITING_EMAIL_VERIFICATION'];
    if (!cancelableStatuses.includes(job.status)) {
      res.status(400).json({
        error: 'invalid_state',
        message: `Job is in ${job.status} state and cannot be cancelled`,
      });
      return;
    }

    await prisma.job.update({
      where: { id: jobId },
      data: {
        status: 'CANCELLED',
        completedAt: new Date(),
        errorMessage: 'Cancelled via admin commands API',
      },
    });

    // Attempt to remove from BullMQ queue if it has a queue job ID.
    if (job.bullmqJobId) {
      try {
        const bullJob = await enrichmentQueue.getJob(job.bullmqJobId);
        if (bullJob) {
          await bullJob.remove();
        }
      } catch {
        // Best effort -- the BullMQ job may already be completed or removed.
      }
    }

    log.info('Job cancelled via admin commands API', { jobId });

    res.json({
      id: jobId,
      status: 'CANCELLED',
      message: 'Job cancelled successfully',
    });
  } catch (err) {
    log.error('Failed to cancel job via commands API', { error: err });
    res.status(500).json({ error: 'internal_error', message: 'An unexpected error occurred' });
  }
});

// ---------------------------------------------------------------------------
// GET /usage — Get API usage statistics (daily/weekly).
// ---------------------------------------------------------------------------

adminCommandsRouter.get('/usage', async (req: Request, res: Response) => {
  try {
    const period = (req.query.period as string) || 'daily';

    const now = new Date();
    let startDate: Date;
    if (period === 'weekly') {
      startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    } else {
      // daily -- last 24 hours
      startDate = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    }

    const [usageLogs, totalCost, serviceBreakdown] = await Promise.all([
      prisma.apiUsageLog.count({
        where: { createdAt: { gte: startDate } },
      }),
      prisma.apiUsageLog.aggregate({
        where: { createdAt: { gte: startDate } },
        _sum: { estimatedCostUsd: true, creditsConsumed: true },
      }),
      prisma.apiUsageLog.groupBy({
        by: ['service'],
        where: { createdAt: { gte: startDate } },
        _count: true,
        _sum: { estimatedCostUsd: true, creditsConsumed: true },
      }),
    ]);

    res.json({
      period,
      start_date: startDate.toISOString(),
      end_date: now.toISOString(),
      total_requests: usageLogs,
      total_cost_usd: totalCost._sum.estimatedCostUsd?.toString() ?? '0',
      total_credits_consumed: totalCost._sum.creditsConsumed?.toString() ?? '0',
      by_service: serviceBreakdown.map((s) => ({
        service: s.service,
        request_count: s._count,
        cost_usd: s._sum.estimatedCostUsd?.toString() ?? '0',
        credits_consumed: s._sum.creditsConsumed?.toString() ?? '0',
      })),
    });
  } catch (err) {
    log.error('Failed to get usage stats via commands API', { error: err });
    res.status(500).json({ error: 'internal_error', message: 'An unexpected error occurred' });
  }
});

// ---------------------------------------------------------------------------
// GET /errors — Get recent errors.
// ---------------------------------------------------------------------------

adminCommandsRouter.get('/errors', async (req: Request, res: Response) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit) || 25, 1), 100);
    const hoursBack = Math.max(Number(req.query.hours) || 24, 1);

    const since = new Date(Date.now() - hoursBack * 60 * 60 * 1000);

    const where: Prisma.ErrorLogWhereInput = {
      createdAt: { gte: since },
    };

    if (req.query.category) where.category = req.query.category as Prisma.EnumErrorCategoryFilter;
    if (req.query.service) where.service = req.query.service as string;

    const [errors, total] = await Promise.all([
      prisma.errorLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        select: {
          id: true,
          category: true,
          service: true,
          message: true,
          lifecycleState: true,
          jobId: true,
          slackTeamId: true,
          createdAt: true,
        },
      }),
      prisma.errorLog.count({ where }),
    ]);

    res.json({
      errors: errors.map((e) => ({
        id: e.id,
        category: e.category,
        service: e.service,
        message: e.message,
        lifecycle_state: e.lifecycleState,
        job_id: e.jobId,
        slack_team_id: e.slackTeamId,
        created_at: e.createdAt,
      })),
      total,
      limit,
      hours: hoursBack,
    });
  } catch (err) {
    log.error('Failed to get errors via commands API', { error: err });
    res.status(500).json({ error: 'internal_error', message: 'An unexpected error occurred' });
  }
});

// ---------------------------------------------------------------------------
// GET /workflows — Get active job workflows with progress.
// ---------------------------------------------------------------------------

adminCommandsRouter.get('/workflows', async (req: Request, res: Response) => {
  try {
    const activeJobs = await prisma.job.findMany({
      where: {
        status: { in: ['PENDING', 'PROCESSING', 'AWAITING_PHONES', 'AWAITING_DNC_DECISION', 'AWAITING_EMAIL_VERIFICATION'] },
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        jobType: true,
        status: true,
        progress: true,
        sourceFileName: true,
        sourceRowCount: true,
        companiesProcessed: true,
        contactsFound: true,
        slackUserId: true,
        slackTeamId: true,
        slackChannelName: true,
        bullmqJobId: true,
        createdAt: true,
        startedAt: true,
      },
    });

    res.json({
      active_jobs: activeJobs.map((j) => ({
        id: j.id,
        job_type: j.jobType,
        status: j.status,
        progress: j.progress,
        source_file_name: j.sourceFileName,
        source_row_count: j.sourceRowCount,
        companies_processed: j.companiesProcessed,
        contacts_found: j.contactsFound,
        slack_user_id: j.slackUserId,
        slack_team_id: j.slackTeamId,
        slack_channel_name: j.slackChannelName,
        bullmq_job_id: j.bullmqJobId,
        created_at: j.createdAt,
        started_at: j.startedAt,
      })),
      total: activeJobs.length,
    });
  } catch (err) {
    log.error('Failed to get active workflows via commands API', { error: err });
    res.status(500).json({ error: 'internal_error', message: 'An unexpected error occurred' });
  }
});

// ---------------------------------------------------------------------------
// GET /workers — Get BullMQ queue stats and worker configs.
// ---------------------------------------------------------------------------

adminCommandsRouter.get('/workers', async (req: Request, res: Response) => {
  try {
    const queues = [
      { name: 'enrichment', queue: enrichmentQueue },
      { name: 'phone-data', queue: phoneDataQueue },
      { name: 'file-generation', queue: fileGenerationQueue },
      { name: 'analysis', queue: analysisQueue },
      { name: 'email-enrichment', queue: emailEnrichmentQueue },
      { name: 'admin', queue: adminQueue },
      { name: 'campaign', queue: campaignQueue },
    ];

    const [queueStats, workerConfigs] = await Promise.all([
      Promise.all(
        queues.map(async ({ name, queue }) => {
          const counts = await queue.getJobCounts('active', 'waiting', 'completed', 'failed', 'delayed');
          return {
            name,
            active: counts.active ?? 0,
            waiting: counts.waiting ?? 0,
            completed: counts.completed ?? 0,
            failed: counts.failed ?? 0,
            delayed: counts.delayed ?? 0,
          };
        }),
      ),
      prisma.workerConfig.findMany({
        orderBy: { workerName: 'asc' },
        select: {
          workerName: true,
          concurrency: true,
          updatedAt: true,
          updatedBy: true,
          reason: true,
        },
      }),
    ]);

    res.json({
      queues: queueStats,
      worker_configs: workerConfigs.map((wc) => ({
        worker_name: wc.workerName,
        concurrency: wc.concurrency,
        updated_at: wc.updatedAt,
        updated_by: wc.updatedBy,
        reason: wc.reason,
      })),
    });
  } catch (err) {
    log.error('Failed to get worker stats via commands API', { error: err });
    res.status(500).json({ error: 'internal_error', message: 'An unexpected error occurred' });
  }
});
