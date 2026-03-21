/**
 * BullMQ worker for 'tech-report' jobs.
 *
 * Processes jobs from the 'enrichment' queue with the name 'tech-report'.
 * If cached results are available (via `useCachedResult`), loads from
 * TechReportCache and generates the output file directly. Otherwise, calls
 * the BuiltWith Lists API via listsClient, persists results to
 * TechReportCache / TechReportCacheEntry, generates the file, and enqueues
 * a file-generation job for Slack delivery.
 */

import { Worker, Job } from 'bullmq';
import * as crypto from 'node:crypto';
import { config } from '../../../config/index.js';
import { prisma } from '../../../models/index.js';
import { searchTechnologyList } from '../../builtwith/listsClient.js';
import { generateTechReportOutput } from '../../file/generator.js';
import type { TechReportCompanyRecord } from '../../file/generator.js';
import { uploadFile } from '../../../lib/storage.js';
import { fileGenerationQueue } from '../queues.js';
import { publishProgress } from '../../agent/taskVisualizer.js';
import logger from '../../../lib/logger.js';
import { trackUsage } from '../../metering/usageTracker.js';
import { deductCredits } from '../../billing/creditManager.js';
import { notifyJobCredits } from '../../billing/billingNotifier.js';
import type { TechReportJobData, FileGenerationData } from '../queues.js';
import { promptContextCache } from '../../cache/promptCache.js';
import {
  startProgressNotifications,
  stopProgressNotifications,
  sendCompletionNotification,
} from './enrichmentProgressNotifier.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Content-type mapping for S3 uploads. */
const CONTENT_TYPE_MAP: Record<string, string> = {
  CSV: 'text/csv',
  XLSX: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Computes a deterministic SHA-256 hash of the normalised query parameters.
 *
 * The hash is used as a cache key to detect duplicate BuiltWith Lists API
 * queries and avoid redundant API charges (FR-018).
 *
 * @param technology - Technology name to search for.
 * @param filters    - Optional filters (country, stateRegion, companySize, trafficLevel).
 * @returns Hex-encoded SHA-256 hash string.
 */
function computeQueryHash(
  technology: string,
  filters: TechReportJobData['filters'],
): string {
  const normalized = {
    technology: technology.toLowerCase().trim(),
    country: filters.country?.toLowerCase().trim() ?? '',
    stateRegion: filters.stateRegion?.toLowerCase().trim() ?? '',
    companySize: filters.companySize?.toLowerCase().trim() ?? '',
    trafficLevel: filters.trafficLevel?.toLowerCase().trim() ?? '',
  };
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(normalized))
    .digest('hex');
}

/**
 * Maps TechReportCacheEntry records to the TechReportCompanyRecord shape
 * expected by the file generator.
 *
 * Cache entries do not store first/last detected dates, so those fields
 * are set to null.
 *
 * @param entries - Array of cache entry records from the database.
 * @returns Array of TechReportCompanyRecord objects.
 */
function mapCacheEntriesToCompanyRecords(
  entries: Array<{
    domain: string;
    companyName: string | null;
    country: string | null;
    stateRegion: string | null;
    city: string | null;
    trafficRank: number | null;
  }>,
): TechReportCompanyRecord[] {
  return entries.map((entry) => ({
    domain: entry.domain,
    companyName: entry.companyName,
    location: [entry.city, entry.stateRegion, entry.country]
      .filter(Boolean)
      .join(', ') || null,
    trafficRank: entry.trafficRank,
    technologyFirstDetected: null,
    technologyLastDetected: null,
  }));
}

/**
 * Maps ListCompanyEntry results from the BuiltWith Lists API to the
 * TechReportCompanyRecord shape expected by the file generator.
 *
 * @param entries - Array of entries from searchTechnologyList.
 * @returns Array of TechReportCompanyRecord objects.
 */
function mapListEntriesToCompanyRecords(
  entries: Array<{
    domain: string;
    companyName: string | null;
    country: string | null;
    stateRegion: string | null;
    city: string | null;
    trafficRank: number | null;
    technologyFirstDetected: Date | null;
    technologyLastDetected: Date | null;
  }>,
): TechReportCompanyRecord[] {
  return entries.map((entry) => ({
    domain: entry.domain,
    companyName: entry.companyName,
    location: [entry.city, entry.stateRegion, entry.country]
      .filter(Boolean)
      .join(', ') || null,
    trafficRank: entry.trafficRank,
    technologyFirstDetected: entry.technologyFirstDetected,
    technologyLastDetected: entry.technologyLastDetected,
  }));
}

// ---------------------------------------------------------------------------
// Worker processor
// ---------------------------------------------------------------------------

/**
 * Processes a single tech-report job.
 *
 * If `useCachedResult` is set in the job data, loads results from the
 * TechReportCache and generates the output file directly. Otherwise,
 * calls the BuiltWith Lists API, caches the results, generates the file,
 * uploads to S3, and enqueues a file-generation job for Slack delivery.
 *
 * @param job - BullMQ job containing {@link TechReportJobData}.
 */
export async function processTechReport(
  job: Job<TechReportJobData>,
): Promise<void> {
  const { jobId, technology, filters, requestedCount, useCachedResult } = job.data;
  const jobLogger = logger.withContext({ jobId });

  jobLogger.info('Tech report processing started', {
    technology,
    filters,
    requestedCount: requestedCount ?? null,
    useCachedResult: useCachedResult ?? null,
  });

  // -------------------------------------------------------------------------
  // Step 1: Load the Job record and mark as PROCESSING
  // -------------------------------------------------------------------------
  const dbJob = await prisma.job.findUniqueOrThrow({
    where: { id: jobId },
    select: {
      slackChannelId: true,
      slackThreadTs: true,
      slackUserId: true,
      slackTeamId: true,
      creditRateSnapshot: true,
    },
  });

  await prisma.job.update({
    where: { id: jobId },
    data: { status: 'PROCESSING', startedAt: new Date() },
  });

  // Start progress notifications (initial + periodic every 60s)
  // For tech reports, use requestedCount or default estimate
  const estimatedCount = requestedCount ?? 1000;
  await startProgressNotifications({
    jobId,
    channelId: dbJob.slackChannelId,
    threadTs: dbJob.slackThreadTs,
    companyCount: estimatedCount,
    jobType: 'tech_report',
  });

  let s3Key: string;
  let resultCount: number;

  if (useCachedResult) {
    // -----------------------------------------------------------------------
    // Path A: Use cached results
    // -----------------------------------------------------------------------
    jobLogger.info('Using cached tech report results', {
      cacheId: useCachedResult,
    });

    // Notify agent: query stage complete (instant for cached)
    await publishProgress({ jobId, stage: 'query', status: 'complete' });

    const cache = await prisma.techReportCache.findUniqueOrThrow({
      where: { id: useCachedResult },
      include: { entries: true },
    });

    const allCacheEntries = requestedCount && requestedCount > 0
      ? cache.entries.slice(0, requestedCount)
      : cache.entries;
    const companyRecords = mapCacheEntriesToCompanyRecords(allCacheEntries);
    resultCount = companyRecords.length;

    // Notify agent: generating output
    await publishProgress({ jobId, stage: 'narrative', status: 'in_progress' });

    // Generate output file (default to CSV for tech reports)
    const outputFormat = 'CSV' as const;
    const fileBuffer = generateTechReportOutput({
      companies: companyRecords,
      outputFormat,
    });

    const fileExtension = 'csv';
    s3Key = `tech-reports/${jobId}.${fileExtension}`;
    const contentType = CONTENT_TYPE_MAP[outputFormat] ?? 'application/octet-stream';

    await uploadFile(s3Key, fileBuffer, contentType);
    jobLogger.info('Tech report file uploaded to S3 (from cache)', {
      s3Key,
      sizeBytes: fileBuffer.length,
      resultCount,
    });

    // Update job with result info
    await prisma.job.update({
      where: { id: jobId },
      data: {
        resultFileUrl: s3Key,
        resultFileName: `tech-report-${technology.toLowerCase().replace(/\s+/g, '-')}-${jobId.slice(0, 8)}.${fileExtension}`,
        companiesProcessed: resultCount,
        status: 'COMPLETED',
        completedAt: new Date(),
      },
    });

    // T027: Invalidate prompt context cache on tech report completion
    await promptContextCache.invalidate(dbJob.slackTeamId, dbJob.slackUserId);

    // Send completion notification and stop periodic notifications
    await sendCompletionNotification(
      {
        jobId,
        channelId: dbJob.slackChannelId,
        threadTs: dbJob.slackThreadTs,
      },
      resultCount,
      0, // no failed count for cached results
    );

    // Enqueue file-generation job for Slack delivery
    const fileJobData: FileGenerationData = {
      jobId,
      outputFormat,
      channelId: dbJob.slackChannelId,
      threadTs: dbJob.slackThreadTs,
    };

    await fileGenerationQueue.add('generate-result-file', fileJobData);
    jobLogger.info('File generation job enqueued (cached path)', { jobId });

    // Notify agent: final stage complete
    await publishProgress({ jobId, stage: 'narrative', status: 'complete' });
  } else {
    // -----------------------------------------------------------------------
    // Path B: Call BuiltWith Lists API
    // -----------------------------------------------------------------------
    jobLogger.info('Calling BuiltWith Lists API', { technology, filters });

    // Notify agent: querying data
    await publishProgress({ jobId, stage: 'query', status: 'in_progress' });

    const startTime = Date.now();
    const searchResult = await searchTechnologyList({
      technology,
      jobId,
      filters,
    });
    const durationMs = Date.now() - startTime;

    // Apply requested count limit (e.g. user asked for "100 companies")
    if (requestedCount && requestedCount > 0 && searchResult.entries.length > requestedCount) {
      jobLogger.info('Truncating results to requested count', {
        apiCount: searchResult.entries.length,
        requestedCount,
      });
      searchResult.entries = searchResult.entries.slice(0, requestedCount);
    }

    resultCount = searchResult.entries.length;

    jobLogger.info('BuiltWith Lists API returned', {
      totalCount: searchResult.totalCount,
      resultCount,
      creditsUsed: searchResult.creditsUsed,
      durationMs,
    });

    // Notify agent: query complete
    await publishProgress({ jobId, stage: 'query', status: 'complete', detail: `${resultCount} companies found` });

    // Log API usage
    try {
      await trackUsage({
        jobId,
        slackTeamId: dbJob.slackTeamId,
        service: 'BUILTWITH',
        endpoint: 'Lists',
        requestCount: 1,
        creditsConsumed: searchResult.creditsUsed,
        estimatedCostUsd: searchResult.creditsUsed * config.builtwith.costPerCredit,
        durationMs,
      });
    } catch (err) {
      jobLogger.error('Failed to log API usage', {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // Map entries to company records for file generation
    const companyRecords = mapListEntriesToCompanyRecords(searchResult.entries);

    // Notify agent: generating output
    await publishProgress({ jobId, stage: 'narrative', status: 'in_progress' });

    // Generate output file
    const outputFormat = 'CSV' as const;
    const fileBuffer = generateTechReportOutput({
      companies: companyRecords,
      outputFormat,
    });

    const fileExtension = 'csv';
    s3Key = `tech-reports/${jobId}.${fileExtension}`;
    const contentType = CONTENT_TYPE_MAP[outputFormat] ?? 'application/octet-stream';

    await uploadFile(s3Key, fileBuffer, contentType);
    jobLogger.info('Tech report file uploaded to S3', {
      s3Key,
      sizeBytes: fileBuffer.length,
      resultCount,
    });

    // -------------------------------------------------------------------
    // Cache the results for future queries
    // -------------------------------------------------------------------
    const queryHash = computeQueryHash(technology, filters);

    const cache = await prisma.techReportCache.upsert({
      where: { queryHash },
      update: {
        resultCount,
        resultFileUrl: s3Key,
        requestedByUserId: dbJob.slackUserId,
        requestedInChannel: dbJob.slackChannelId,
      },
      create: {
        queryHash,
        technology,
        country: filters.country ?? null,
        stateRegion: filters.stateRegion ?? null,
        companySize: filters.companySize ?? null,
        trafficLevel: filters.trafficLevel ?? null,
        resultCount,
        resultFileUrl: s3Key,
        requestedByUserId: dbJob.slackUserId,
        requestedInChannel: dbJob.slackChannelId,
      },
    });

    // Delete old cache entries before persisting new ones (handles both updates and retries)
    await prisma.techReportCacheEntry.deleteMany({
      where: { cacheId: cache.id },
    });

    // Persist individual cache entries
    if (searchResult.entries.length > 0) {
      await prisma.techReportCacheEntry.createMany({
        data: searchResult.entries.map((entry) => ({
          cacheId: cache.id,
          domain: entry.domain,
          companyName: entry.companyName,
          country: entry.country,
          stateRegion: entry.stateRegion,
          city: entry.city,
          trafficRank: entry.trafficRank,
          technologyDetected: entry.technologyDetected,
        })),
      });
    }

    jobLogger.info('Tech report cache created', {
      cacheId: cache.id,
      queryHash,
      entryCount: searchResult.entries.length,
    });

    // Update job with result info
    await prisma.job.update({
      where: { id: jobId },
      data: {
        resultFileUrl: s3Key,
        resultFileName: `tech-report-${technology.toLowerCase().replace(/\s+/g, '-')}-${jobId.slice(0, 8)}.${fileExtension}`,
        companiesProcessed: resultCount,
        status: 'COMPLETED',
        completedAt: new Date(),
      },
    });

    // T027: Invalidate prompt context cache on tech report completion
    await promptContextCache.invalidate(dbJob.slackTeamId, dbJob.slackUserId);

    // Send completion notification and stop periodic notifications
    await sendCompletionNotification(
      {
        jobId,
        channelId: dbJob.slackChannelId,
        threadTs: dbJob.slackThreadTs,
      },
      resultCount,
      0, // no failed count for tech reports
    );

    // Enqueue file-generation job for Slack delivery
    const fileJobData: FileGenerationData = {
      jobId,
      outputFormat,
      channelId: dbJob.slackChannelId,
      threadTs: dbJob.slackThreadTs,
    };

    await fileGenerationQueue.add('generate-result-file', fileJobData);
    jobLogger.info('File generation job enqueued', { jobId });

    // Notify agent: final stage complete
    await publishProgress({ jobId, stage: 'narrative', status: 'complete' });
  }

  // Deduct billing credits for fresh tech report queries (not cached)
  if (!useCachedResult && dbJob.creditRateSnapshot && resultCount > 0) {
    const snapshot = dbJob.creditRateSnapshot as Record<string, number>;
    const bwCost = snapshot.builtWithCtuLookup ?? 0;
    const totalBillingCredits = resultCount * bwCost;
    if (totalBillingCredits > 0) {
      const deductResult = await deductCredits(
        dbJob.slackTeamId,
        totalBillingCredits,
        jobId,
        `Tech report (${technology}): ${resultCount} companies`,
      );
      if (deductResult) {
        await notifyJobCredits(
          dbJob.slackChannelId,
          dbJob.slackThreadTs,
          totalBillingCredits,
          deductResult.newBalance,
          deductResult.isOverage ? Math.abs(deductResult.newBalance) : undefined,
        );
      }
    }
  }

  jobLogger.info('Tech report processing complete', {
    s3Key,
    resultCount,
  });
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Creates and returns a BullMQ Worker that listens on the 'enrichment'
 * queue for jobs named 'tech-report'.
 *
 * The worker uses the Redis connection URL from the application config
 * and processes one job at a time (concurrency: 1).
 *
 * @returns A configured BullMQ {@link Worker} instance.
 */
export function createTechReportWorker(): Worker {
  const worker = new Worker<TechReportJobData>(
    'enrichment',
    async (job: Job<TechReportJobData>) => {
      if (job.name !== 'tech-report') {
        logger.debug('Skipping non-tech-report job on enrichment queue', {
          jobName: job.name,
        });
        return;
      }

      await processTechReport(job);
    },
    {
      connection: { url: config.redis.url },
      concurrency: 1,
    },
  );

  worker.on('completed', (job: Job<TechReportJobData>) => {
    logger.info('Tech report job completed', {
      bullmqJobId: job.id,
      jobId: job.data.jobId,
    });
  });

  worker.on('failed', (job: Job<TechReportJobData> | undefined, err: Error) => {
    logger.error('Tech report job failed', {
      bullmqJobId: job?.id,
      jobId: job?.data.jobId,
      error: err.message,
    });

    // Attempt to mark the job as FAILED in the database
    if (job?.data.jobId) {
      // Stop progress notifications on failure
      stopProgressNotifications(job.data.jobId);

      prisma.job
        .update({
          where: { id: job.data.jobId },
          data: {
            status: 'FAILED',
            errorMessage: `Tech report failed: ${err.message}`,
            completedAt: new Date(),
          },
        })
        .then(updatedJob => {
          // T027: Invalidate prompt context cache on tech report failure
          return promptContextCache.invalidate(updatedJob.slackTeamId, updatedJob.slackUserId);
        })
        .catch((updateErr: unknown) => {
          logger.error('Failed to update job status after tech report failure', {
            jobId: job.data.jobId,
            error:
              updateErr instanceof Error
                ? updateErr.message
                : String(updateErr),
          });
        });
    }
  });

  return worker;
}
