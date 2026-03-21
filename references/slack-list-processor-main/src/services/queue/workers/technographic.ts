/**
 * BullMQ worker for technographic enrichment jobs.
 *
 * Processes jobs from the 'enrichment' queue with the name
 * 'technographic-enrichment'. For each company in the payload it resolves
 * domains (when missing), enriches via BuiltWith, extracts cloud providers,
 * scores tech spend, persists results, and then enqueues a file-generation
 * job once all companies have been processed.
 */

import { Worker, Job } from 'bullmq';
import { config } from '../../../config/index.js';
import { prisma } from '../../../models/index.js';
import { enrichDomain } from '../../builtwith/domainEnricher.js';
import { extractCloudProviders } from '../../builtwith/cloudExtractor.js';
import { scoreTechSpend } from '../../builtwith/techSpendScorer.js';
import { resolveCompanyToDomain } from '../../builtwith/companyResolver.js';
import { normalizeDomain } from '../../file/domainUtils.js';
import { normalizeDomain as normalizeDomainForCache } from '../../../lib/domainNormalizer.js';
import * as domainCacheService from '../../builtwith/domainCache.js';
import { enterpriseTechs as enterpriseTechSet } from '../../../data/enterpriseTechs.js';
import { fileGenerationQueue } from '../queues.js';
import { publishProgress } from '../../agent/taskVisualizer.js';
import logger from '../../../lib/logger.js';
import { trackUsage } from '../../metering/usageTracker.js';
import { deductCredits } from '../../billing/creditManager.js';
import { notifyJobCredits } from '../../billing/billingNotifier.js';
import type { TechnographicJobData } from '../queues.js';
import type { FileGenerationData } from '../queues.js';
import type { DomainEnrichmentCache } from '@prisma/client';
import {
  startProgressNotifications,
  stopProgressNotifications,
  sendCompletionNotification,
} from './enrichmentProgressNotifier.js';

// ---------------------------------------------------------------------------
// Worker processor
// ---------------------------------------------------------------------------

/**
 * Processes a single technographic enrichment job.
 *
 * Steps per company:
 *   1. Resolve domain from company name when no domain is provided.
 *   2. Enrich the domain via BuiltWith to obtain technologies + traffic rank.
 *   3. Extract cloud provider information from the technology list.
 *   4. Score the tech spend tier using technologies and traffic rank.
 *   5. Persist CompanyTechnology records and update the JobCompany row.
 *   6. Log API usage to ApiUsageLog.
 *
 * Companies that fail are marked individually as FAILED; remaining
 * companies continue processing.
 *
 * @param job - BullMQ job containing {@link TechnographicJobData}.
 */
export async function processTechnographicJob(
  job: Job<TechnographicJobData>,
): Promise<void> {
  const { jobId, companies, uniqueDomains } = job.data;
  const jobLogger = logger.withContext({ jobId });

  jobLogger.info('Technographic enrichment started', {
    companyCount: companies.length,
    uniqueDomainCount: uniqueDomains?.length,
  });

  // Fetch slackTeamId and credit rate snapshot for usage tracking and billing
  const jobRecord = await prisma.job.findUniqueOrThrow({
    where: { id: jobId },
    select: { slackTeamId: true, creditRateSnapshot: true },
  });
  const slackTeamId = jobRecord.slackTeamId;

  // Mark the DB job as PROCESSING
  const dbJob = await prisma.job.update({
    where: { id: jobId },
    data: { status: 'PROCESSING', startedAt: new Date() },
    select: { slackChannelId: true, slackThreadTs: true },
  });

  // Start progress notifications (initial + periodic every 60s)
  await startProgressNotifications({
    jobId,
    channelId: dbJob.slackChannelId,
    threadTs: dbJob.slackThreadTs,
    companyCount: companies.length,
    jobType: 'technographic',
  });

  // Notify agent of parse/validate completion (instant for technographic)
  await publishProgress({ jobId, stage: 'parse', status: 'complete' });
  await publishProgress({ jobId, stage: 'validate', status: 'complete' });
  await publishProgress({ jobId, stage: 'builtwith', status: 'in_progress', detail: `Processing ${companies.length} companies` });

  let processedCount = 0;
  let failedCount = 0;
  let totalCreditsUsed = 0;
  let totalApiCalls = 0;
  let cacheHits = 0;
  let cacheMisses = 0;

  const errorMessages: string[] = [];

  // Build a set of unique domains for fast lookup (US3 domain dedup).
  // When uniqueDomains is provided, we cache BuiltWith results by domain
  // so we only call the API once per unique domain.
  const uniqueDomainSet = uniqueDomains ? new Set(uniqueDomains.map(d => d.toLowerCase())) : null;
  const domainCache = new Map<string, Awaited<ReturnType<typeof enrichDomain>>>();

  // ---------------------------------------------------------------------------
  // Persistent domain cache integration (Feature 17)
  // ---------------------------------------------------------------------------
  const cacheConfig = await domainCacheService.getConfig();
  const forceRefresh = job.data.forceRefresh ?? false;

  // Pre-load cached entries for all domains in this job.
  let persistentCacheMap = new Map<string, DomainEnrichmentCache>();
  if (cacheConfig.enabled && !forceRefresh) {
    try {
      const allDomains = companies
        .map((c) => c.domain)
        .filter((d): d is string => !!d);
      persistentCacheMap = await domainCacheService.batchLookup(allDomains);
      jobLogger.info('Persistent cache pre-loaded', {
        requestedDomains: allDomains.length,
        cacheEntriesFound: persistentCacheMap.size,
      });
    } catch (err) {
      jobLogger.warn('Persistent cache pre-load failed, proceeding without cache', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  for (let i = 0; i < companies.length; i++) {
    // Check for cancellation before each company.
    const currentJobStatus = await prisma.job.findUnique({
      where: { id: jobId },
      select: { status: true },
    });
    if (currentJobStatus?.status === 'CANCELLED') {
      jobLogger.info('Job cancelled by user, stopping processing', {
        processedSoFar: processedCount,
        totalCompanies: companies.length,
      });
      stopProgressNotifications(jobId);
      break;
    }

    const company = companies[i]!;

    // Find the corresponding JobCompany record
    const jobCompany = await prisma.jobCompany.findUnique({
      where: {
        jobId_rowIndex: { jobId, rowIndex: company.rowIndex },
      },
    });

    if (!jobCompany) {
      jobLogger.warn('JobCompany record not found, skipping', {
        rowIndex: company.rowIndex,
      });
      failedCount++;
      errorMessages.push('JobCompany record not found');
      await updateProgress(job, i + 1, companies.length);
      continue;
    }

    try {
      // -----------------------------------------------------------------
      // Step 1: Resolve domain if missing (with normalization)
      // -----------------------------------------------------------------
      let domain = normalizeDomain(company.domain) ?? null;

      if (!domain && company.companyName) {
        const resolution = await resolveCompanyToDomain(company.companyName);
        domain = resolution.domain;
        totalCreditsUsed += resolution.creditsUsed;
        totalApiCalls++;

        await trackUsage({
          jobId,
          slackTeamId,
          service: 'BUILTWITH',
          endpoint: 'CTU',
          requestCount: 1,
          creditsConsumed: resolution.creditsUsed,
          estimatedCostUsd: resolution.creditsUsed * config.builtwith.costPerCredit,
        });
      }

      if (!domain) {
        jobLogger.warn('No domain available for company, marking FAILED', {
          rowIndex: company.rowIndex,
          companyName: company.companyName,
        });

        await prisma.jobCompany.update({
          where: { id: jobCompany.id },
          data: {
            enrichmentStatus: 'FAILED',
            errorMessage: 'Could not resolve domain',
          },
        });

        failedCount++;
        await updateProgress(job, i + 1, companies.length);
        continue;
      }

      // -----------------------------------------------------------------
      // Step 2: Enrich domain via BuiltWith (with persistent + in-memory cache)
      // -----------------------------------------------------------------
      const domainKey = domain.toLowerCase();
      const normalizedCacheKey = normalizeDomainForCache(domain);
      let enrichResult = domainCache.get(domainKey);
      let usedPersistentCache = false;

      if (!enrichResult && normalizedCacheKey && !forceRefresh) {
        // Check persistent domain enrichment cache (Feature 17).
        const cachedEntry = persistentCacheMap.get(normalizedCacheKey);
        if (cachedEntry && cachedEntry.isComplete) {
          enrichResult = domainCacheService.mapCacheEntryToEnrichResult(cachedEntry);
          usedPersistentCache = true;
          cacheHits++;
          // Record hit asynchronously — non-blocking.
          domainCacheService.recordHit(normalizedCacheKey).catch(() => {});
          jobLogger.debug('Using persistent cached result for domain', {
            rowIndex: company.rowIndex,
            domain,
            hitCount: cachedEntry.hitCount,
          });
          // Also set in-memory cache for domain dedup within this job.
          if (uniqueDomainSet) {
            domainCache.set(domainKey, enrichResult);
          }
        }
      }

      if (!enrichResult) {
        // Check in-memory domain dedup cache (existing behaviour).
        enrichResult = domainCache.get(domainKey);
      }

      if (!enrichResult) {
        // Cache miss — call BuiltWith API.
        enrichResult = await enrichDomain(domain);
        totalCreditsUsed += enrichResult.creditsUsed;
        totalApiCalls += 1;
        cacheMisses++;

        await trackUsage({
          jobId,
          slackTeamId,
          service: 'BUILTWITH',
          endpoint: 'DomainLookup',
          requestCount: 1,
          creditsConsumed: enrichResult.creditsUsed,
          estimatedCostUsd: enrichResult.creditsUsed * config.builtwith.costPerCredit,
        });

        // Cache the result in-memory if domain dedup is active.
        if (uniqueDomainSet) {
          domainCache.set(domainKey, enrichResult);
        }
      } else if (!usedPersistentCache) {
        jobLogger.debug('Using in-memory cached BuiltWith result for domain', {
          rowIndex: company.rowIndex,
          domain,
        });
      }

      // -----------------------------------------------------------------
      // Step 3: Extract cloud providers
      // -----------------------------------------------------------------
      const rawTechs = enrichResult.technologies.map((t) => ({
        Name: t.name,
        Tag: t.tag,
        Categories: t.categories,
      }));
      const cloudProviders = extractCloudProviders(rawTechs);

      // -----------------------------------------------------------------
      // Step 4: Score tech spend
      // -----------------------------------------------------------------
      const spendResult = scoreTechSpend(rawTechs, enrichResult.trafficRank);

      // -----------------------------------------------------------------
      // Step 4b: Store fresh result in persistent cache (Feature 17)
      // -----------------------------------------------------------------
      if (!usedPersistentCache && normalizedCacheKey && !enrichResult.error) {
        domainCacheService.store({
          normalizedDomain: normalizedCacheKey,
          builtwithResponse: {
            Results: [{
              Lookup: domain,
              Result: {
                Paths: enrichResult.technologies.map((t) => ({
                  Technologies: [{
                    Name: t.name, Tag: t.tag, Categories: t.categories,
                    FirstDetected: t.firstDetected?.getTime() ?? 0,
                    LastDetected: t.lastDetected?.getTime() ?? 0,
                  }],
                })),
                Spend: enrichResult.techSpend,
              },
              Meta: {
                QRank: enrichResult.meta.quantcast, Majestic: enrichResult.meta.majestic,
                ARank: enrichResult.meta.arank, Telephones: enrichResult.telephones,
                Emails: enrichResult.emails, Social: enrichResult.social,
                Names: enrichResult.names.map((n) => ({ Name: n })),
                City: enrichResult.city, State: enrichResult.state,
                Postcode: enrichResult.zip, Country: enrichResult.country,
                Vertical: enrichResult.vertical, CompanyName: enrichResult.companyNameFromApi,
              },
              SalesRevenue: enrichResult.salesRevenue,
              Attributes: {
                Employees: enrichResult.employees,
                ProductCount: enrichResult.productCount,
                Followers: enrichResult.followers,
              },
            }],
          },
          technologies: enrichResult.technologies.map((t) => ({
            name: t.name, tag: t.tag, categories: t.categories,
            firstDetected: t.firstDetected?.toISOString() ?? null,
            lastDetected: t.lastDetected?.toISOString() ?? null,
          })),
          vertical: enrichResult.vertical,
          trafficRank: enrichResult.trafficRank,
          techSpendTier: spendResult.tier,
          techSpendScore: spendResult.score,
          companyName: enrichResult.companyNameFromApi,
          locationCountry: enrichResult.country,
          locationState: enrichResult.state,
          locationCity: enrichResult.city,
          isComplete: true,
          ttlDays: cacheConfig.ttlDays,
        }).catch((err) => {
          jobLogger.warn('Failed to store domain in persistent cache', {
            domain, error: err instanceof Error ? err.message : String(err),
          });
        });
      }

      // -----------------------------------------------------------------
      // Step 5: Persist CompanyTechnology records (bulk create)
      // -----------------------------------------------------------------
      if (enrichResult.technologies.length > 0) {
        await prisma.companyTechnology.createMany({
          data: enrichResult.technologies.map((tech) => ({
            jobCompanyId: jobCompany.id,
            name: tech.name,
            tag: tech.tag ?? null,
            categories: tech.categories ?? [],
            firstDetected: tech.firstDetected ?? null,
            lastDetected: tech.lastDetected ?? null,
            isEnterprise: enterpriseTechSet.has(tech.name),
          })),
        });
      }

      // -----------------------------------------------------------------
      // Step 6: Update JobCompany record with enrichment results
      // -----------------------------------------------------------------
      await prisma.jobCompany.update({
        where: { id: jobCompany.id },
        data: {
          resolvedDomain: domain,
          cloudProviderPrimary: cloudProviders.primaryProvider,
          cloudProvidersAll: cloudProviders.allProviders.join(', '),
          techSpendTier: spendResult.tier,
          techSpendScore: spendResult.score,
          technologyCount: enrichResult.technologies.length,
          enterpriseTechCount: enrichResult.technologies.filter(
            (t) => enterpriseTechSet.has(t.name),
          ).length,
          trafficRank: enrichResult.trafficRank ?? null,
          telephones: enrichResult.telephones,
          emails: enrichResult.emails,
          socialProfiles: enrichResult.social,
          metaNames: enrichResult.names,
          locationCity: enrichResult.city ?? undefined,
          locationState: enrichResult.state ?? undefined,
          locationCountry: enrichResult.country ?? undefined,
          locationZip: enrichResult.zip ?? undefined,
          vertical: enrichResult.vertical ?? undefined,
          companyNameFromApi: enrichResult.companyNameFromApi ?? undefined,
          salesRevenue: enrichResult.salesRevenue ?? undefined,
          techSpendUsd: enrichResult.techSpend ?? undefined,
          employeeCount: enrichResult.employees ?? undefined,
          productCount: enrichResult.productCount ?? undefined,
          followers: enrichResult.followers ?? undefined,
          enrichmentStatus: enrichResult.error ? 'FAILED' : 'SUCCESS',
          errorMessage: enrichResult.error ?? undefined,
        },
      });

      processedCount++;

      jobLogger.debug('Company enriched successfully', {
        rowIndex: company.rowIndex,
        domain,
        technologyCount: enrichResult.technologies.length,
        techSpendTier: spendResult.tier,
        fromCache: domainCache.has(domainKey) && domainCache.get(domainKey) === enrichResult,
      });
    } catch (err) {
      // Mark the individual company as FAILED but continue with the rest
      const errorMessage = err instanceof Error ? err.message : String(err);

      jobLogger.error('Failed to enrich company', {
        rowIndex: company.rowIndex,
        domain: company.domain,
        companyName: company.companyName,
        error: errorMessage,
      });

      await prisma.jobCompany.update({
        where: { id: jobCompany.id },
        data: {
          enrichmentStatus: 'FAILED',
          errorMessage,
        },
      });

      failedCount++;
      errorMessages.push(errorMessage);
    }

    // Update BullMQ job progress
    await updateProgress(job, i + 1, companies.length);
  }

  // ---------------------------------------------------------------------------
  // Update job-level aggregates
  // ---------------------------------------------------------------------------
  // Re-check if job was cancelled.
  const finalJobStatus = await prisma.job.findUnique({
    where: { id: jobId },
    select: { status: true },
  });
  const wasCancelled = finalJobStatus?.status === 'CANCELLED';

  if (!wasCancelled) {
    await prisma.job.update({
      where: { id: jobId },
      data: {
        companiesProcessed: processedCount,
        companiesFailed: failedCount,
        cacheHits,
        cacheMisses,
      },
    });
  }

  // Notify agent of BuiltWith and classify completion
  await publishProgress({ jobId, stage: 'builtwith', status: 'complete', detail: `${processedCount} companies enriched` });
  await publishProgress({ jobId, stage: 'classify', status: 'complete' });

  // Deduct billing credits based on rate snapshot
  if (!wasCancelled && processedCount > 0 && jobRecord.creditRateSnapshot) {
    const snapshot = jobRecord.creditRateSnapshot as Record<string, number>;
    const effectiveCost = snapshot.builtWithCtuLookup ?? 0;
    const totalBillingCredits = processedCount * effectiveCost;
    if (totalBillingCredits > 0) {
      const deductResult = await deductCredits(
        slackTeamId,
        totalBillingCredits,
        jobId,
        `Technographic enrichment: ${processedCount} companies`,
      );
      if (deductResult) {
        const dbJobForNotify = await prisma.job.findUnique({
          where: { id: jobId },
          select: { slackChannelId: true, slackThreadTs: true },
        });
        if (dbJobForNotify) {
          await notifyJobCredits(
            dbJobForNotify.slackChannelId,
            dbJobForNotify.slackThreadTs,
            totalBillingCredits,
            deductResult.newBalance,
            deductResult.isOverage ? Math.abs(deductResult.newBalance) : undefined,
          );
        }
      }
    }
  }

  jobLogger.info('Technographic enrichment complete', {
    processedCount,
    failedCount,
    totalCreditsUsed,
    totalApiCalls,
    cacheHits,
    cacheMisses,
    forceRefresh,
    wasCancelled,
  });

  // ---------------------------------------------------------------------------
  // Store error summary on Job record for the file generation worker to post
  // ---------------------------------------------------------------------------
  const dbJobForFileGen = await prisma.job.findUniqueOrThrow({
    where: { id: jobId },
    select: {
      slackChannelId: true,
      slackThreadTs: true,
      sourceFileType: true,
    },
  });

  // Send completion notification and stop periodic notifications
  await sendCompletionNotification(
    {
      jobId,
      channelId: dbJobForFileGen.slackChannelId,
      threadTs: dbJobForFileGen.slackThreadTs,
    },
    processedCount,
    failedCount,
  );

  if (failedCount > 0 && !wasCancelled) {
    const errorCounts = new Map<string, number>();
    for (const msg of errorMessages) {
      errorCounts.set(msg, (errorCounts.get(msg) ?? 0) + 1);
    }
    const errorLines = Array.from(errorCounts.entries())
      .map(([msg, count]) => `- ${msg} (${count} ${count === 1 ? 'company' : 'companies'})`)
      .join('\n');

    await prisma.job.update({
      where: { id: jobId },
      data: {
        errorMessage: `${failedCount}/${companies.length} companies failed:\n${errorLines}`,
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Enqueue file generation job (even for cancelled/partial results)
  // ---------------------------------------------------------------------------
  if (processedCount > 0) {
    const fileJobData: FileGenerationData = {
      jobId,
      outputFormat: dbJobForFileGen.sourceFileType === 'XLSX' ? 'XLSX' : 'CSV',
      channelId: dbJobForFileGen.slackChannelId,
      threadTs: dbJobForFileGen.slackThreadTs,
    };

    await fileGenerationQueue.add('generate-result-file', fileJobData);

    jobLogger.info('File generation job enqueued', { jobId });

    // Notify agent of final stage completion
    await publishProgress({ jobId, stage: 'generate', status: 'complete' });
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Updates the BullMQ job progress as a percentage (0-100).
 *
 * @param job       - The active BullMQ job instance.
 * @param current   - Number of companies processed so far.
 * @param total     - Total number of companies in the batch.
 */
async function updateProgress(
  job: Job<TechnographicJobData>,
  current: number,
  total: number,
): Promise<void> {
  const percent = Math.round((current / total) * 100);
  await job.updateProgress(percent);
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Creates and returns a BullMQ Worker that listens on the 'enrichment' queue
 * for jobs named 'technographic-enrichment'.
 *
 * The worker uses the Redis connection URL from the application config.
 *
 * @returns A configured BullMQ {@link Worker} instance.
 */
export function createTechnographicWorker(): Worker {
  const worker = new Worker<TechnographicJobData>(
    'enrichment',
    async (job: Job<TechnographicJobData>) => {
      if (job.name !== 'technographic-enrichment') {
        logger.debug('Skipping non-technographic job on enrichment queue', {
          jobName: job.name,
        });
        return;
      }

      await processTechnographicJob(job);
    },
    {
      connection: { url: config.redis.url },
      concurrency: 1,
    },
  );

  worker.on('completed', (job: Job<TechnographicJobData>) => {
    logger.info('Technographic enrichment job completed', {
      bullmqJobId: job.id,
      jobId: job.data.jobId,
    });
  });

  worker.on('failed', (job: Job<TechnographicJobData> | undefined, err: Error) => {
    logger.error('Technographic enrichment job failed', {
      bullmqJobId: job?.id,
      jobId: job?.data.jobId,
      error: err.message,
    });

    // Stop progress notifications on failure
    if (job?.data.jobId) {
      stopProgressNotifications(job.data.jobId);
    }
  });

  return worker;
}
