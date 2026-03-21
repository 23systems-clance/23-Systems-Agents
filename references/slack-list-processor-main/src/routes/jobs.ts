/**
 * Job management REST API endpoints (T062).
 *
 * Provides read-only access to enrichment job history, detail, and
 * result file download. All endpoints require API key authentication
 * (mounted behind apiKeyAuth middleware in server.ts).
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { prisma, Prisma } from '../models/index.js';
import { getPresignedUrl } from '../lib/storage.js';
import logger from '../lib/logger.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Job with included API usage logs from Prisma include. */
type JobWithUsageLogs = Prisma.JobGetPayload<{
  include: { apiUsageLogs: true };
}>;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum number of jobs returned per page. */
const MAX_PAGE_LIMIT = 100;

/** Default number of jobs returned per page. */
const DEFAULT_PAGE_LIMIT = 20;

/** Default page number. */
const DEFAULT_PAGE = 1;

/** Pre-signed URL expiry for result file downloads (1 hour). */
const DOWNLOAD_URL_EXPIRY_SECONDS = 3600;

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const router = Router();

/**
 * GET /api/v1/jobs
 *
 * Lists jobs with optional filters and cursor-based pagination.
 *
 * Query params:
 *   - status       Filter by JobStatus enum value
 *   - job_type     Filter by JobType enum value
 *   - slack_user_id  Filter by Slack user ID
 *   - channel_id   Filter by Slack channel ID
 *   - page         Page number (default 1)
 *   - limit        Results per page (default 20, max 100)
 *
 * Returns:
 *   { jobs: Job[], pagination: { page, limit, total, totalPages } }
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const {
      status,
      job_type,
      slack_user_id,
      channel_id,
      page: pageParam,
      limit: limitParam,
    } = req.query;

    // Parse pagination params with defaults and bounds.
    const page = Math.max(Number(pageParam) || DEFAULT_PAGE, 1);
    const limit = Math.min(
      Math.max(Number(limitParam) || DEFAULT_PAGE_LIMIT, 1),
      MAX_PAGE_LIMIT,
    );
    const skip = (page - 1) * limit;

    // Build the Prisma where clause from query filters.
    const where: Record<string, unknown> = {};

    if (status && typeof status === 'string') {
      where.status = status;
    }
    if (job_type && typeof job_type === 'string') {
      where.jobType = job_type;
    }
    if (slack_user_id && typeof slack_user_id === 'string') {
      where.slackUserId = slack_user_id;
    }
    if (channel_id && typeof channel_id === 'string') {
      where.slackChannelId = channel_id;
    }

    // Execute count and find in parallel for efficiency.
    const [total, jobs] = await Promise.all([
      prisma.job.count({ where }),
      prisma.job.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
    ]);

    const totalPages = Math.ceil(total / limit);

    res.status(200).json({
      jobs,
      pagination: {
        page,
        limit,
        total,
        totalPages,
      },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('Failed to list jobs', { error: errorMessage });
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/v1/jobs/:id
 *
 * Returns full job detail with aggregated API usage statistics.
 *
 * Path params:
 *   - id   The job UUID
 *
 * Returns:
 *   { job: Job & { apiUsageStats: { totalRequests, totalCredits, totalCostUsd } } }
 */
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const jobId = req.params.id as string;

    const job: JobWithUsageLogs | null = await prisma.job.findUnique({
      where: { id: jobId },
      include: {
        apiUsageLogs: true,
      },
    });

    if (!job) {
      res.status(404).json({ error: 'Job not found' });
      return;
    }

    // Aggregate API usage statistics from the included logs.
    const apiUsageStats = {
      totalRequests: job.apiUsageLogs.reduce(
        (sum: number, log) => sum + log.requestCount,
        0,
      ),
      totalCredits: job.apiUsageLogs.reduce(
        (sum: number, log) => sum + (log.creditsConsumed ? Number(log.creditsConsumed) : 0),
        0,
      ),
      totalCostUsd: job.apiUsageLogs.reduce(
        (sum: number, log) => sum + (log.estimatedCostUsd ? Number(log.estimatedCostUsd) : 0),
        0,
      ),
    };

    // Separate apiUsageLogs from the response and attach aggregated stats.
    const { apiUsageLogs, ...jobData } = job;

    res.status(200).json({
      job: {
        ...jobData,
        apiUsageStats,
        apiUsageLogs,
      },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('Failed to get job detail', {
      jobId: req.params.id,
      error: errorMessage,
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/v1/jobs/:id/result
 *
 * Generates a pre-signed S3 URL for the job result file and redirects
 * the client to download it.
 *
 * Path params:
 *   - id   The job UUID
 *
 * Returns:
 *   302 redirect to pre-signed S3 URL, or 404 if no result file exists.
 */
router.get('/:id/result', async (req: Request, res: Response) => {
  try {
    const jobId = req.params.id as string;

    const job = await prisma.job.findUnique({
      where: { id: jobId },
      select: {
        id: true,
        resultFileUrl: true,
        resultFileName: true,
      },
    });

    if (!job) {
      res.status(404).json({ error: 'Job not found' });
      return;
    }

    if (!job.resultFileUrl) {
      res.status(404).json({ error: 'No result file available for this job' });
      return;
    }

    // Generate a pre-signed download URL and redirect the client.
    const presignedUrl = await getPresignedUrl(
      job.resultFileUrl,
      DOWNLOAD_URL_EXPIRY_SECONDS,
    );

    logger.info('Result file download initiated', {
      jobId,
      resultFileUrl: job.resultFileUrl,
    });

    res.redirect(302, presignedUrl);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('Failed to generate result download URL', {
      jobId: req.params.id,
      error: errorMessage,
    });
    res.status(500).json({ error: 'Internal server error' });
  }
});

export { router as jobsRouter };
