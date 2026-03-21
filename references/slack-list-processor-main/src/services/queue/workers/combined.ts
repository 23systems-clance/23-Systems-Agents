/**
 * BullMQ worker for combined enrichment jobs.
 *
 * Processes jobs from the 'enrichment' queue with the name
 * 'combined-enrichment'. Runs both technographic enrichment AND contact
 * enrichment on a company list, then enqueues file generation.
 *
 * Phase A: Technographic Enrichment
 *   - Resolve domains, enrich via BuiltWith, extract cloud providers,
 *     score tech spend, persist CompanyTechnology records.
 *
 * Phase B: Contact Enrichment
 *   - Search Apollo for contacts, create JobContact records, classify
 *     persona types via AI, optionally bulk enrich for phone numbers.
 */

import { Worker, Job } from 'bullmq';
import { config } from '../../../config/index.js';
import { prisma } from '../../../models/index.js';
import { enrichDomain } from '../../builtwith/domainEnricher.js';
import { extractCloudProviders } from '../../builtwith/cloudExtractor.js';
import { scoreTechSpend } from '../../builtwith/techSpendScorer.js';
import { resolveCompanyToDomain } from '../../builtwith/companyResolver.js';
import { normalizeDomain } from '../../file/domainUtils.js';
import { enterpriseTechs as enterpriseTechSet } from '../../../data/enterpriseTechs.js';
import { ApiError } from '../../../lib/errors.js';
import { searchPeople } from '../../apollo/peopleSearch.js';
import { bulkEnrichPeople } from '../../apollo/bulkEnrich.js';
import { classifyPersonasBatch } from '../../ai/personaClassifier.js';
import { getTimezone } from '../../../data/timezoneMap.js';
import { fileGenerationQueue } from '../queues.js';
import { publishProgress } from '../../agent/taskVisualizer.js';
import logger from '../../../lib/logger.js';
import type { Logger } from '../../../lib/logger.js';
import { trackUsage } from '../../metering/usageTracker.js';
import { deductCredits } from '../../billing/creditManager.js';
import { notifyJobCredits } from '../../billing/billingNotifier.js';
import { computeFilterHash } from '../../../lib/filterHasher.js';
import { getCacheConfig } from '../../../lib/cacheConfig.js';
import * as searchCacheService from '../../apollo/searchCache.js';
import * as contactCacheService from '../../apollo/contactCache.js';
import { normalizeDomain as normalizeDomainForCache } from '../../../lib/domainNormalizer.js';
import * as domainCacheService from '../../builtwith/domainCache.js';
import type { DomainEnrichmentCache } from '@prisma/client';
import type { CombinedJobData, FileGenerationData } from '../queues.js';
import type { ApolloContact } from '../../apollo/peopleSearch.js';
import type { ApolloSearchCache } from '@prisma/client';
import { promptContextCache } from '../../cache/promptCache.js';
import { cascadePhoneWaterfall } from '../../enrichment/cascadePhones.js';
import { runPostEmailPipeline } from './postEnrichmentPipeline.js';
import {
  startProgressNotifications,
  stopProgressNotifications,
  sendCompletionNotification,
} from './enrichmentProgressNotifier.js';

// ---------------------------------------------------------------------------
// Worker processor
// ---------------------------------------------------------------------------

/**
 * Processes a single combined enrichment job.
 *
 * Runs technographic enrichment on all companies first, then runs contact
 * enrichment on all companies. After both phases complete, enqueues a
 * file-generation job.
 *
 * Individual company failures are logged and skipped; remaining companies
 * continue processing.
 *
 * @param job - BullMQ job containing {@link CombinedJobData}.
 */
export async function processCombinedEnrichment(
  job: Job<CombinedJobData>,
): Promise<void> {
  const { jobId, companies, purpose, uniqueDomains, forceRefresh } = job.data;
  const jobLogger = logger.withContext({ jobId });

  // Fetch slackTeamId and credit rate snapshot for usage tracking and billing
  const jobRecord = await prisma.job.findUniqueOrThrow({
    where: { id: jobId },
    select: { slackTeamId: true, slackUserId: true, creditRateSnapshot: true },
  });
  const slackTeamId = jobRecord.slackTeamId;

  jobLogger.info('Combined enrichment started', {
    companyCount: companies.length,
    purpose,
    uniqueDomainCount: uniqueDomains?.length,
    forceRefresh: !!forceRefresh,
  });

  // Mark the DB job as PROCESSING
  const dbJob = await prisma.job.update({
    where: { id: jobId },
    data: { status: 'PROCESSING', startedAt: new Date() },
    select: { slackChannelId: true, slackThreadTs: true },
  });

  // Start progress notifications (initial + periodic every 60s)
  const needsPhonesForEstimate = purpose === 'COLD_CALLING' || purpose === 'ALL';
  await startProgressNotifications({
    jobId,
    channelId: dbJob.slackChannelId,
    threadTs: dbJob.slackThreadTs,
    companyCount: companies.length,
    jobType: 'combined',
    needsPhones: needsPhonesForEstimate,
  });

  // Notify agent of parse/validate completion
  await publishProgress({ jobId, stage: 'parse', status: 'complete' });
  await publishProgress({ jobId, stage: 'validate', status: 'complete' });
  await publishProgress({ jobId, stage: 'builtwith', status: 'in_progress', detail: `Processing ${companies.length} companies` });

  // =========================================================================
  // Phase A: Technographic Enrichment
  // =========================================================================
  jobLogger.info('Phase A: Technographic enrichment starting');

  let techProcessedCount = 0;
  let techFailedCount = 0;
  let totalCreditsUsed = 0;
  let totalApiCalls = 0;
  let cacheHits = 0;
  let cacheMisses = 0;

  /** Maps rowIndex -> jobCompanyId for use in Phase B. */
  const rowToJobCompanyId = new Map<number, string>();

  // Domain dedup cache (US3): cache BuiltWith results by domain key
  const domainCache = new Map<string, Awaited<ReturnType<typeof enrichDomain>>>();

  // ---------------------------------------------------------------------------
  // Persistent cache pre-loading (Feature 17)
  // ---------------------------------------------------------------------------
  let persistentCacheMap = new Map<string, DomainEnrichmentCache>();
  let cacheConfig = { ttlDays: 60, enabled: true, apolloSearchTtlDays: 14, apolloContactTtlDays: 30, id: '', createdAt: new Date(), updatedAt: new Date() };
  try {
    cacheConfig = await domainCacheService.getConfig();
    if (cacheConfig.enabled && !forceRefresh) {
      const allDomains = companies
        .map((c) => normalizeDomainForCache(c.domain))
        .filter((d): d is string => d !== null);
      if (allDomains.length > 0) {
        persistentCacheMap = await domainCacheService.batchLookup(allDomains);
        jobLogger.info('Persistent cache pre-loaded for combined Phase A', {
          queriedDomains: allDomains.length,
          cacheHits: persistentCacheMap.size,
        });
      }
    }
  } catch (err) {
    jobLogger.warn('Persistent cache pre-load failed, proceeding without cache', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  let wasCancelled = false;

  for (let i = 0; i < companies.length; i++) {
    // Check for cancellation before each company.
    const currentJobStatus = await prisma.job.findUnique({
      where: { id: jobId },
      select: { status: true },
    });
    if (currentJobStatus?.status === 'CANCELLED') {
      jobLogger.info('Job cancelled by user, stopping Phase A', {
        processedSoFar: techProcessedCount,
      });
      stopProgressNotifications(jobId);
      wasCancelled = true;
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
      jobLogger.warn('JobCompany record not found, skipping technographic', {
        rowIndex: company.rowIndex,
      });
      techFailedCount++;
      await updateProgress(job, i + 1, companies.length * 2);
      continue;
    }

    rowToJobCompanyId.set(company.rowIndex, jobCompany.id);

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

        techFailedCount++;
        await updateProgress(job, i + 1, companies.length * 2);
        continue;
      }

      // -----------------------------------------------------------------
      // Step 2: Enrich domain via BuiltWith (persistent cache → dedup → API)
      // -----------------------------------------------------------------
      const domainKey = domain.toLowerCase();
      let enrichResult = domainCache.get(domainKey);
      let usedPersistentCache = false;

      if (!enrichResult) {
        // Check persistent cache (Feature 17)
        const normalizedForCache = normalizeDomainForCache(domain);
        const cachedEntry = normalizedForCache ? persistentCacheMap.get(normalizedForCache) : undefined;

        if (cachedEntry && cachedEntry.isComplete) {
          enrichResult = domainCacheService.mapCacheEntryToEnrichResult(cachedEntry);
          usedPersistentCache = true;
          cacheHits++;
          try { await domainCacheService.recordHit(normalizedForCache!); } catch { /* ignore */ }
          jobLogger.debug('Using persistent cached result for domain', {
            rowIndex: company.rowIndex,
            domain,
          });
        } else {
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
        }

        // Cache in dedup map if domain dedup is active
        if (uniqueDomains) {
          domainCache.set(domainKey, enrichResult);
        }
      } else {
        jobLogger.debug('Using dedup cached BuiltWith result for domain', {
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
      // Step 4b: Store in persistent cache (Feature 17) — after scoring
      // -----------------------------------------------------------------
      if (!usedPersistentCache) {
        const cacheNormDomain = normalizeDomainForCache(domain);
        if (cacheNormDomain) {
          domainCacheService.store({
            normalizedDomain: cacheNormDomain,
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
      }

      // -----------------------------------------------------------------
      // Step 5: Persist CompanyTechnology records
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

      techProcessedCount++;

      jobLogger.debug('Technographic enrichment complete for company', {
        rowIndex: company.rowIndex,
        domain,
        technologyCount: enrichResult.technologies.length,
        techSpendTier: spendResult.tier,
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);

      jobLogger.error('Technographic enrichment failed for company', {
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

      techFailedCount++;
    }

    // Update BullMQ job progress (Phase A uses first half of progress bar)
    await updateProgress(job, i + 1, companies.length * 2);
  }

  jobLogger.info('Phase A: Technographic enrichment complete', {
    techProcessedCount,
    techFailedCount,
    totalCreditsUsed,
    totalApiCalls,
    cacheHits,
    cacheMisses,
  });

  // Update job with cache statistics (Feature 17)
  await prisma.job.update({
    where: { id: jobId },
    data: { cacheHits, cacheMisses },
  });

  // Notify agent of BuiltWith and classify completion
  await publishProgress({ jobId, stage: 'builtwith', status: 'complete', detail: `${techProcessedCount} companies enriched` });
  await publishProgress({ jobId, stage: 'classify', status: 'complete' });
  await publishProgress({ jobId, stage: 'apollo_search', status: 'in_progress' });

  // =========================================================================
  // Phase B: Contact Enrichment (skip if cancelled)
  // =========================================================================
  let totalContactsFound = 0;
  let contactFailedCount = 0;
  let totalPeopleSearchCalls = 0;
  let searchCacheHits = 0;
  let searchCacheMisses = 0;

  // Accumulate all created contacts for batch operations later
  const allCreatedContacts: Array<{
    contactId: string;
    apolloPersonId: string;
    email: string;
    jobTitle: string | null;
    index: number;
  }> = [];

  // Search cache pre-load for Phase B
  const effectiveFilters = job.data.contactFilters ?? (await import('../../../types/enrichmentFilters.js')).DEFAULT_APOLLO_FILTERS;
  const filterHash = computeFilterHash(effectiveFilters);
  let searchCacheMap = new Map<string, ApolloSearchCache>();
  let cacheEnabled = false;
  let searchTtlDays = 14;

  if (!wasCancelled) {
    jobLogger.info('Phase B: Contact enrichment starting');

    try {
      const cacheConfig = await getCacheConfig();
      cacheEnabled = cacheConfig.enabled;
      searchTtlDays = cacheConfig.apolloSearchTtlDays;

      if (cacheEnabled) {
        const allDomains = companies
          .map((c) => c.domain)
          .filter((d): d is string => !!d);
        searchCacheMap = await searchCacheService.batchLookup(allDomains, filterHash);
        if (searchCacheMap.size > 0) {
          jobLogger.info('Search cache pre-loaded for Phase B', {
            cachedDomains: searchCacheMap.size,
          });
        }
      }
    } catch (err) {
      jobLogger.warn('Search cache pre-load failed, proceeding without cache', {
        error: err instanceof Error ? err.message : String(err),
      });
      searchCacheMap = new Map();
    }
  }

  for (let i = 0; i < companies.length && !wasCancelled; i++) {
    // Check for cancellation before each company.
    const phaseB_status = await prisma.job.findUnique({
      where: { id: jobId },
      select: { status: true },
    });
    if (phaseB_status?.status === 'CANCELLED') {
      jobLogger.info('Job cancelled by user, stopping Phase B');
      stopProgressNotifications(jobId);
      wasCancelled = true;
      break;
    }

    const company = companies[i]!;

    // Resolve the domain -- use the resolved domain from the JobCompany record
    // if the original was missing
    const jobCompanyId = rowToJobCompanyId.get(company.rowIndex);
    if (!jobCompanyId) {
      jobLogger.debug('No JobCompany ID for contact enrichment, skipping', {
        rowIndex: company.rowIndex,
      });
      await updateProgress(
        job,
        companies.length + i + 1,
        companies.length * 2,
      );
      continue;
    }

    // Look up the JobCompany to get the resolved domain
    const jobCompany = await prisma.jobCompany.findUnique({
      where: { id: jobCompanyId },
      select: { resolvedDomain: true, enrichmentStatus: true },
    });

    const domain = jobCompany?.resolvedDomain ?? company.domain ?? null;

    if (!domain) {
      jobLogger.debug('No domain available for contact enrichment, skipping', {
        rowIndex: company.rowIndex,
      });
      await updateProgress(
        job,
        companies.length + i + 1,
        companies.length * 2,
      );
      continue;
    }

    try {
      let contacts: ApolloContact[];
      const normalized = normalizeDomain(domain);

      // Check search cache first
      const cacheEntry = normalized ? searchCacheMap.get(normalized) : undefined;

      if (cacheEntry) {
        // Cache HIT
        contacts = searchCacheService.mapCacheEntryToContacts(cacheEntry);
        await searchCacheService.recordHit(cacheEntry.normalizedDomain, cacheEntry.filterHash);
        searchCacheHits++;
      } else {
        // Cache MISS — call Apollo API
        contacts = await searchPeople(domain, company.companyName, job.data.contactFilters);
        totalPeopleSearchCalls++;
        searchCacheMisses++;

        // Store in cache
        if (cacheEnabled && normalized) {
          const contactsForCache = contacts.map((c) => ({
            apolloId: c.apolloId,
            firstName: c.firstName,
            lastNameObfuscated: c.lastNameObfuscated,
            fullName: c.fullName,
            email: c.email,
            jobTitle: c.jobTitle,
            seniorityLevel: c.seniorityLevel,
            linkedinUrl: c.linkedinUrl,
            hasEmail: c.hasEmail,
            hasDirectPhone: c.hasDirectPhone,
            rawApiData: c.rawApiData,
          }));

          await searchCacheService.store({
            normalizedDomain: normalized,
            filterHash,
            contacts: contactsForCache,
            resultCount: contacts.length,
            filterSnapshot: effectiveFilters as unknown as object,
            ttlDays: searchTtlDays,
          });
        }
      }

      if (contacts.length === 0) {
        jobLogger.debug('No contacts found for domain', {
          domain,
          jobCompanyId,
        });
        await updateProgress(
          job,
          companies.length + i + 1,
          companies.length * 2,
        );
        continue;
      }

      // Step 2: Create JobContact records
      for (const contact of contacts) {
        // api_search returns first_name + last_name_obfuscated separately
        const firstName = contact.firstName || null;
        const lastName = contact.lastNameObfuscated || null;
        // All results are filtered by seniority params, so default to true
        const isDecisionMaker = true;

        // Resolve timezone from Apollo location data
        const tz = getTimezone(contact.state, contact.country);

        const created = await prisma.jobContact.create({
          data: {
            jobId,
            jobCompanyId,
            fullName: contact.fullName || null,
            firstName,
            lastName,
            email: contact.email,
            jobTitle: contact.jobTitle,
            seniorityLevel: contact.seniorityLevel,
            linkedinUrl: contact.linkedinUrl,
            apolloPersonId: contact.apolloId || null,
            isDecisionMaker,
            enrichmentStatus: 'ENRICHED',
            personaType: 'NON_LEADER', // placeholder; updated in batch classification
            timezoneUtc: tz.utcOffset,
            timezoneLabel: tz.label,
            apolloMetadata: contact.rawApiData as unknown as import('@prisma/client').Prisma.InputJsonValue,
          },
        });

        const contactIndex = allCreatedContacts.length;
        allCreatedContacts.push({
          contactId: created.id,
          apolloPersonId: contact.apolloId || '',
          email: contact.email ?? '',
          jobTitle: contact.jobTitle,
          index: contactIndex,
        });

        totalContactsFound++;
      }

      jobLogger.debug('Contacts created for company', {
        domain,
        contactCount: contacts.length,
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);

      // Detect Apollo daily rate limit exhaustion (429) and abort the job
      if (err instanceof ApiError && err.statusCode === 429 && err.serviceName === 'Apollo') {
        jobLogger.error('Apollo API rate limit exhausted, aborting job', {
          error: errorMessage,
        });

        stopProgressNotifications(jobId);

        await prisma.job.update({
          where: { id: jobId },
          data: {
            status: 'FAILED',
            errorMessage: 'Apollo API daily rate limit reached. Please try again tomorrow.',
            companiesProcessed: techProcessedCount,
            companiesFailed: techFailedCount + contactFailedCount,
            contactsFound: totalContactsFound,
          },
        });

        // T027: Invalidate prompt context cache on combined job failure
        await promptContextCache.invalidate(jobRecord.slackTeamId, jobRecord.slackUserId);

        throw err; // Re-throw to mark the BullMQ job as failed
      }

      jobLogger.error('Contact enrichment failed for company', {
        domain,
        jobCompanyId,
        error: errorMessage,
      });

      contactFailedCount++;
    }

    // Update BullMQ job progress (Phase B uses second half of progress bar)
    await updateProgress(
      job,
      companies.length + i + 1,
      companies.length * 2,
    );
  }

  // Log PeopleSearch API usage (only for actual API calls, not cache hits)
  if (totalPeopleSearchCalls > 0) {
    await trackUsage({
      jobId,
      slackTeamId,
      service: 'APOLLO',
      endpoint: 'PeopleSearch',
      requestCount: totalPeopleSearchCalls,
      creditsConsumed: 0,
      estimatedCostUsd: 0,
    });
  }

  // Update Job with Apollo search cache statistics
  if (searchCacheHits > 0 || searchCacheMisses > 0) {
    await prisma.job.update({
      where: { id: jobId },
      data: {
        apolloSearchCacheHits: searchCacheHits,
        apolloSearchCacheMisses: searchCacheMisses,
      },
    });
  }

  // Notify agent of search completion and persona start
  await publishProgress({ jobId, stage: 'apollo_search', status: 'complete', detail: `${totalContactsFound} contacts found` });
  await publishProgress({ jobId, stage: 'persona', status: 'in_progress' });

  // ---------------------------------------------------------------------------
  // Phase B.2: Batch classify persona types
  // ---------------------------------------------------------------------------
  if (allCreatedContacts.length > 0) {
    const titlesForClassification = allCreatedContacts
      .filter((c) => c.jobTitle)
      .map((c) => ({
        index: c.index,
        jobTitle: c.jobTitle!,
      }));

    if (titlesForClassification.length > 0) {
      try {
        const classifications = await classifyPersonasBatch(titlesForClassification, jobId, slackTeamId);

        // Build a map of index -> personaType for fast lookup
        const classificationMap = new Map<number, string>();
        for (const cls of classifications) {
          classificationMap.set(cls.index, cls.personaType);
        }

        // Update each contact's persona type in the database
        for (const contact of allCreatedContacts) {
          const personaType = classificationMap.get(contact.index);
          if (personaType) {
            await prisma.jobContact.update({
              where: { id: contact.contactId },
              data: { personaType: personaType as import('@prisma/client').PersonaType },
            });
          }
        }

        jobLogger.info('Persona classification complete', {
          classifiedCount: classifications.length,
        });
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        jobLogger.error('Batch persona classification failed', {
          error: errorMessage,
        });
        // Contacts retain NON_LEADER default; not a fatal error
      }
    }
  }

  // Notify agent of persona completion
  await publishProgress({ jobId, stage: 'persona', status: 'complete' });

  jobLogger.info('Phase B: Contact enrichment complete', {
    totalContactsFound,
    contactFailedCount,
    totalPeopleSearchCalls,
  });

  // =========================================================================
  // Phase B.3: Bulk enrichment to get full contact data (email, linkedin,
  //   seniority, location). Always run because the free api_search endpoint
  //   only returns names, titles, and Apollo IDs.
  //   - Phone reveal is conditional: COLD_CALLING or ALL only.
  //   - Contact cache: check for cached enrichment data before calling Apollo.
  // =========================================================================
  const totalFailedCount = techFailedCount + contactFailedCount;
  const needsBulkEnrich = allCreatedContacts.length > 0;
  // Request phone reveal from Apollo when purpose requires phones.
  // Phone numbers are now extracted directly from the bulk_match response
  // (no longer reliant on the async webhook).
  const needsPhones = purpose === 'COLD_CALLING' || purpose === 'ALL';
  let contactCacheHits = 0;
  let contactCacheMisses = 0;

  if (needsBulkEnrich && allCreatedContacts.length > 0) {
    // --- Contact cache lookup ---
    let contactCacheMap = new Map<string, import('@prisma/client').ApolloContactCache>();
    let contactTtlDays = 30;

    if (cacheEnabled) {
      try {
        const cacheConfig = await getCacheConfig();
        contactTtlDays = cacheConfig.apolloContactTtlDays;

        const allPersonIds = allCreatedContacts
          .map((c) => c.apolloPersonId)
          .filter((id) => id && id.length > 0);
        contactCacheMap = await contactCacheService.batchLookup(allPersonIds, needsPhones);

        if (contactCacheMap.size > 0) {
          jobLogger.info('Contact cache pre-loaded for Phase B.3', {
            cachedContacts: contactCacheMap.size,
            totalContacts: allPersonIds.length,
            requirePhone: needsPhones,
          });
        }
      } catch (err) {
        jobLogger.warn('Contact cache pre-load failed, proceeding without cache', {
          error: err instanceof Error ? err.message : String(err),
        });
        contactCacheMap = new Map();
      }
    }

    // Process cache hits: update JobContact with cached data, skip bulk enrichment
    const contactIdsFromCache: string[] = [];
    for (const contact of allCreatedContacts) {
      if (!contact.apolloPersonId) continue;
      const cached = contactCacheMap.get(contact.apolloPersonId);
      if (cached) {
        const mapped = contactCacheService.mapCacheEntryToJobContact(cached);
        await prisma.jobContact.update({
          where: { id: contact.contactId },
          data: {
            fullName: mapped.fullName,
            firstName: mapped.firstName,
            lastName: mapped.lastName,
            email: mapped.email,
            jobTitle: mapped.jobTitle,
            seniorityLevel: mapped.seniorityLevel,
            linkedinUrl: mapped.linkedinUrl,
            timezoneUtc: mapped.timezoneUtc,
            timezoneLabel: mapped.timezoneLabel,
            directPhone: mapped.directPhone,
            businessPhone: mapped.businessPhone,
            apolloMetadata: mapped.apolloMetadata as unknown as import('@prisma/client').Prisma.InputJsonValue ?? undefined,
            enrichmentStatus: 'ENRICHED',
          },
        });
        await contactCacheService.recordHit(contact.apolloPersonId);
        contactIdsFromCache.push(contact.contactId);
        contactCacheHits++;
      }
    }

    // Filter out cache hits from bulk enrichment batch
    const contactsForEnrich = allCreatedContacts
      .filter((c) => !contactIdsFromCache.includes(c.contactId))
      .filter((c) => c.apolloPersonId || c.email)
      .map((c) => ({
        apolloPersonId: c.apolloPersonId || undefined,
        email: c.email || undefined,
        jobContactId: c.contactId,
      }));
    contactCacheMisses = contactsForEnrich.length;

    if (contactsForEnrich.length > 0) {
      try {
        const enrichResult = await bulkEnrichPeople(contactsForEnrich, jobId, needsPhones);

        // Log BulkEnrich API usage (only for contacts actually sent to API)
        await trackUsage({
          jobId,
          slackTeamId,
          service: 'APOLLO',
          endpoint: 'BulkEnrich',
          requestCount: Math.ceil(contactsForEnrich.length / 10),
          creditsConsumed: enrichResult.creditsUsed,
          estimatedCostUsd: enrichResult.creditsUsed * config.apollo.costPerCredit,
        });

        // Cache newly enriched contacts
        if (cacheEnabled) {
          for (const contact of contactsForEnrich) {
            const dbContact = await prisma.jobContact.findUnique({
              where: { id: contact.jobContactId },
              select: {
                apolloPersonId: true, fullName: true, firstName: true, lastName: true,
                email: true, jobTitle: true, seniorityLevel: true, linkedinUrl: true,
                timezoneUtc: true, timezoneLabel: true, directPhone: true, businessPhone: true,
                apolloMetadata: true,
              },
            });
            if (dbContact?.apolloPersonId) {
              await contactCacheService.store({
                apolloPersonId: dbContact.apolloPersonId,
                fullName: dbContact.fullName, firstName: dbContact.firstName,
                lastName: dbContact.lastName, email: dbContact.email,
                jobTitle: dbContact.jobTitle, seniorityLevel: dbContact.seniorityLevel,
                linkedinUrl: dbContact.linkedinUrl, timezoneUtc: dbContact.timezoneUtc,
                timezoneLabel: dbContact.timezoneLabel,
                hasPhoneData: needsPhones && !!(dbContact.directPhone || dbContact.businessPhone),
                directPhone: dbContact.directPhone, businessPhone: dbContact.businessPhone,
                apolloMetadata: dbContact.apolloMetadata as object | null,
                ttlDays: contactTtlDays,
              });
            }
          }
        }

        await prisma.job.update({
          where: { id: jobId },
          data: {
            companiesProcessed: techProcessedCount,
            companiesFailed: totalFailedCount,
            contactsFound: totalContactsFound,
            apolloContactCacheHits: contactCacheHits,
            apolloContactCacheMisses: contactCacheMisses,
          },
        });

        await enqueueFileGeneration(jobId, jobLogger);
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        jobLogger.error('Bulk enrichment failed', { error: errorMessage });

        // Fall through to file generation even if enrichment fails
        await prisma.job.update({
          where: { id: jobId },
          data: {
            companiesProcessed: techProcessedCount,
            companiesFailed: totalFailedCount,
            contactsFound: totalContactsFound,
            apolloContactCacheHits: contactCacheHits,
            apolloContactCacheMisses: contactCacheMisses,
          },
        });

        await enqueueFileGeneration(jobId, jobLogger);
      }
    } else {
      // All contacts served from cache — no bulk enrichment needed
      await prisma.job.update({
        where: { id: jobId },
        data: {
          companiesProcessed: techProcessedCount,
          companiesFailed: totalFailedCount,
          contactsFound: totalContactsFound,
          apolloContactCacheHits: contactCacheHits,
          apolloContactCacheMisses: 0,
        },
      });

      await enqueueFileGeneration(jobId, jobLogger);

      jobLogger.info('All contacts served from cache, skipping bulk enrichment', {
        contactCacheHits,
      });
    }
  } else {
    // No contacts found -- generate file directly
    await prisma.job.update({
      where: { id: jobId },
      data: {
        companiesProcessed: techProcessedCount,
        companiesFailed: totalFailedCount,
        contactsFound: totalContactsFound,
      },
    });

    await enqueueFileGeneration(jobId, jobLogger);
  }

  // ---------------------------------------------------------------------------
  // Post-enrichment housekeeping (notification + billing).
  // Wrapped in try-catch so failures here do NOT crash the job. The actual
  // enrichment data is already persisted; a notification/billing glitch must
  // not trigger a BullMQ retry that re-processes every company.
  // ---------------------------------------------------------------------------
  try {
    // Send completion notification and stop periodic notifications
    await sendCompletionNotification(
      {
        jobId,
        channelId: dbJob.slackChannelId,
        threadTs: dbJob.slackThreadTs,
      },
      techProcessedCount,
      totalFailedCount,
    );
  } catch (err) {
    jobLogger.error('Failed to send completion notification', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  try {
    // Deduct billing credits for both technographic and contact operations
    if (jobRecord.creditRateSnapshot) {
      const snapshot = jobRecord.creditRateSnapshot as Record<string, number>;
      const bwCost = snapshot.builtWithCtuLookup ?? 0;
      const searchCost = snapshot.apolloPeopleSearch ?? 0;
      const enrichCost = snapshot.apolloBulkEnrich ?? 0;
      let totalBillingCredits = techProcessedCount * bwCost;
      const contactsSearched = companies.length - contactFailedCount;
      totalBillingCredits += contactsSearched * searchCost;
      if (needsPhones && totalContactsFound > 0) {
        totalBillingCredits += totalContactsFound * enrichCost;
      }
      if (totalBillingCredits > 0) {
        const deductResult = await deductCredits(
          slackTeamId,
          totalBillingCredits,
          jobId,
          `Combined enrichment: ${techProcessedCount} tech, ${totalContactsFound} contacts`,
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
  } catch (err) {
    jobLogger.error('Failed to deduct billing credits', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  jobLogger.info('Combined enrichment processing complete', {
    techProcessedCount,
    techFailedCount,
    totalContactsFound,
    contactFailedCount,
    needsPhones,
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Updates the BullMQ job progress as a percentage (0-100).
 *
 * Progress spans both phases: Phase A (technographic) occupies the first half,
 * Phase B (contacts) occupies the second half.
 *
 * @param job     - The active BullMQ job instance.
 * @param current - Number of steps completed so far (across both phases).
 * @param total   - Total number of steps (companies * 2).
 */
async function updateProgress(
  job: Job<CombinedJobData>,
  current: number,
  total: number,
): Promise<void> {
  const percent = Math.round((current / total) * 100);
  await job.updateProgress(percent);
}

/**
 * Fetches the job's Slack context and runs the post-enrichment pipeline.
 *
 * Correct flow order:
 * 1. Email verification gate (Findymail) — verify emails first
 * 2. Phone waterfall cascade (Wiza -> AI Ark) — find missing phones
 * 3. DNC gate — scrub phones
 * 4. File generation
 *
 * Steps 2-4 are handled by runPostEmailPipeline (shared module) after
 * email verification completes/skips, or inline here when no gate fires.
 *
 * @param jobId     - Parent job UUID.
 * @param jobLogger - Logger with job context.
 */
async function enqueueFileGeneration(
  jobId: string,
  jobLogger: Logger,
): Promise<void> {
  const dbJob = await prisma.job.findUniqueOrThrow({
    where: { id: jobId },
    select: {
      slackChannelId: true,
      slackThreadTs: true,
      sourceFileType: true,
      purpose: true,
      status: true,
    },
  });

  // -----------------------------------------------------------------------
  // Quality gate check: email verification FIRST, then phone cascade + DNC.
  // Skip gate checks if the job is already past these stages (e.g. coming
  // from a gate worker after the user made their choice).
  // -----------------------------------------------------------------------
  const skipGates = dbJob.status === 'COMPLETED'
    || dbJob.status === 'AWAITING_DNC_DECISION'
    || dbJob.status === 'AWAITING_EMAIL_VERIFICATION';

  if (!skipGates) {
    // 1. Email verification gate: if emails found and Findymail API key configured
    //    After verification completes/skips, the email verification handler calls
    //    runPostEmailPipeline which runs phone cascade -> DNC -> file gen.
    if (config.findymail.apiKey) {
      const emailCount = await prisma.jobContact.count({
        where: { jobId, email: { not: null } },
      });

      if (emailCount > 0) {
        const { WebClient } = await import('@slack/web-api');
        const { buildEmailVerificationDecisionBlocks } = await import('../../../listeners/actions/emailVerification.js');
        const slackClient = new WebClient(config.slack.botToken);

        await slackClient.chat.postMessage({
          channel: dbJob.slackChannelId,
          thread_ts: dbJob.slackThreadTs,
          text: `Email enrichment complete! ${emailCount} emails found. Would you like to verify these emails via Findymail?`,
          blocks: buildEmailVerificationDecisionBlocks(jobId, emailCount),
        });

        await prisma.job.update({
          where: { id: jobId },
          data: { status: 'AWAITING_EMAIL_VERIFICATION' },
        });

        jobLogger.info('Email verification gate triggered', { jobId, emailCount });
        return; // Email verify button handler takes over -> runPostEmailPipeline
      }
    }

    // 2-4. No email verification gate — run the rest of the pipeline inline:
    //      phone cascade -> DNC gate -> file generation.
    await runPostEmailPipeline(jobId, dbJob.slackChannelId, dbJob.slackThreadTs);
    return;
  }

  // Gates already processed — enqueue file generation directly
  const fileJobData: FileGenerationData = {
    jobId,
    outputFormat: dbJob.sourceFileType === 'XLSX' ? 'XLSX' : 'CSV',
    channelId: dbJob.slackChannelId,
    threadTs: dbJob.slackThreadTs,
  };

  await fileGenerationQueue.add('generate-result-file', fileJobData);

  jobLogger.info('File generation job enqueued', { jobId });

  // Notify agent of final stage completion
  await publishProgress({ jobId, stage: 'generate', status: 'complete' });
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Creates and returns a BullMQ Worker that listens on the 'enrichment' queue
 * for jobs named 'combined-enrichment'.
 *
 * The worker uses the Redis connection URL from the application config.
 * Concurrency is set to 1 to ensure sequential processing.
 *
 * @returns A configured BullMQ {@link Worker} instance.
 */
export function createCombinedWorker(): Worker {
  const worker = new Worker<CombinedJobData>(
    'enrichment',
    async (job: Job<CombinedJobData>) => {
      if (job.name !== 'combined-enrichment') {
        logger.debug('Skipping non-combined job on enrichment queue', {
          jobName: job.name,
        });
        return;
      }

      await processCombinedEnrichment(job);
    },
    {
      connection: { url: config.redis.url },
      concurrency: 1,
    },
  );

  worker.on('completed', (job: Job<CombinedJobData>) => {
    logger.info('Combined enrichment job completed', {
      bullmqJobId: job.id,
      jobId: job.data.jobId,
    });
  });

  worker.on('failed', async (job: Job<CombinedJobData> | undefined, err: Error) => {
    logger.error('Combined enrichment job failed', {
      bullmqJobId: job?.id,
      jobId: job?.data.jobId,
      error: err.message,
    });

    // Stop progress notifications on failure
    if (job?.data.jobId) {
      stopProgressNotifications(job.data.jobId);
    }

    // Update job status to FAILED in the database
    if (job?.data.jobId) {
      try {
        const updatedJob = await prisma.job.update({
          where: { id: job.data.jobId },
          data: { status: 'FAILED' },
        });
        // T027: Invalidate prompt context cache on combined job failure
        await promptContextCache.invalidate(updatedJob.slackTeamId, updatedJob.slackUserId);
      } catch (updateErr) {
        logger.error('Failed to mark job as FAILED in database', {
          jobId: job.data.jobId,
          error: updateErr instanceof Error ? updateErr.message : String(updateErr),
        });
      }
    }
  });

  return worker;
}
