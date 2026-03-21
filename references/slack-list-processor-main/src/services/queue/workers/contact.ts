/**
 * BullMQ worker for contact enrichment jobs.
 *
 * Processes jobs from the 'enrichment' queue with the name
 * 'contact-enrichment'. For each company in the payload it searches Apollo
 * for decision-maker contacts, creates JobContact records, classifies
 * persona types via AI, resolves timezones, and optionally bulk enriches
 * for phone numbers when the purpose is COLD_CALLING.
 */

import { Worker, Job } from 'bullmq';
import { config } from '../../../config/index.js';
import { prisma } from '../../../models/index.js';
import { searchPeople } from '../../apollo/peopleSearch.js';
import { bulkEnrichPeople } from '../../apollo/bulkEnrich.js';
import { classifyPersonasBatch } from '../../ai/personaClassifier.js';
import { getTimezone } from '../../../data/timezoneMap.js';
import { fileGenerationQueue } from '../queues.js';
import { ApiError } from '../../../lib/errors.js';
import { publishProgress } from '../../agent/taskVisualizer.js';
import logger from '../../../lib/logger.js';
import { trackUsage } from '../../metering/usageTracker.js';
import { deductCredits } from '../../billing/creditManager.js';
import { notifyJobCredits } from '../../billing/billingNotifier.js';
import { computeFilterHash } from '../../../lib/filterHasher.js';
import { getCacheConfig } from '../../../lib/cacheConfig.js';
import { normalizeDomain } from '../../file/domainUtils.js';
import * as searchCacheService from '../../apollo/searchCache.js';
import * as contactCacheService from '../../apollo/contactCache.js';
import type { ContactJobData, FileGenerationData } from '../queues.js';
import { promptContextCache } from '../../cache/promptCache.js';
import type { ApolloContact } from '../../apollo/peopleSearch.js';
import type { ApolloSearchCache, Provider } from '@prisma/client';
import {
  startProgressNotifications,
  stopProgressNotifications,
  sendCompletionNotification,
} from './enrichmentProgressNotifier.js';

// ---------------------------------------------------------------------------
// Worker processor
// ---------------------------------------------------------------------------

/**
 * Processes a single contact enrichment job.
 *
 * Steps per company:
 *   1. Search Apollo for up to 4 senior contacts at the company domain.
 *   2. Create JobContact records with initial enrichmentStatus 'ENRICHED'.
 *   3. Classify persona types via AI batch classification.
 *   4. Resolve timezones from Apollo location data.
 *   5. If purpose is COLD_CALLING, bulk enrich for phone numbers.
 *   6. Otherwise, enqueue file generation directly.
 *   7. Log API usage to ApiUsageLog.
 *
 * @param job - BullMQ job containing {@link ContactJobData}.
 */
export async function processContactJob(
  job: Job<ContactJobData>,
): Promise<void> {
  const { jobId, companies, purpose, skipInitialStages } = job.data;
  const jobLogger = logger.withContext({ jobId });

  // Fetch slackTeamId, enrichmentMode, and credit rate snapshot for usage tracking and billing
  const jobRecord = await prisma.job.findUniqueOrThrow({
    where: { id: jobId },
    select: { slackTeamId: true, creditRateSnapshot: true, enrichmentMode: true },
  });
  const slackTeamId = jobRecord.slackTeamId;
  const enrichmentMode = jobRecord.enrichmentMode;

  jobLogger.info('Contact enrichment started', {
    companyCount: companies.length,
    purpose,
    skipInitialStages,
    enrichmentMode,
  });

  // Mark the DB job as PROCESSING
  const dbJob = await prisma.job.update({
    where: { id: jobId },
    data: { status: 'PROCESSING', startedAt: new Date() },
    select: { slackChannelId: true, slackThreadTs: true, slackTeamId: true, slackUserId: true },
  });

  // Start progress notifications (initial + periodic every 60s)
  await startProgressNotifications({
    jobId,
    channelId: dbJob.slackChannelId,
    threadTs: dbJob.slackThreadTs,
    companyCount: companies.length,
    jobType: 'contact',
  });

  // Notify agent of parse/validate completion and search start
  // (Skip if already published by caller, e.g., tech report chain with quality gate)
  if (!skipInitialStages) {
    await publishProgress({ jobId, stage: 'parse', status: 'complete' });
    await publishProgress({ jobId, stage: 'validate', status: 'complete' });
  }
  await publishProgress({ jobId, stage: 'apollo_search', status: 'in_progress', detail: `Searching ${companies.length} companies` });

  let totalContactsFound = 0;
  let failedCount = 0;
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

  // ---------------------------------------------------------------------------
  // Search cache pre-load: batch lookup cached search results for all domains
  // ---------------------------------------------------------------------------
  const effectiveFilters = job.data.contactFilters ?? (await import('../../../types/enrichmentFilters.js')).DEFAULT_APOLLO_FILTERS;
  const filterHash = computeFilterHash(effectiveFilters);
  let searchCacheMap = new Map<string, ApolloSearchCache>();
  let cacheEnabled = false;
  let searchTtlDays = 14;

  try {
    const cacheConfig = await getCacheConfig();
    cacheEnabled = cacheConfig.enabled;
    searchTtlDays = cacheConfig.apolloSearchTtlDays;

    if (cacheEnabled) {
      const allDomains = companies.map((c) => c.domain).filter(Boolean);
      searchCacheMap = await searchCacheService.batchLookup(allDomains, filterHash);
      if (searchCacheMap.size > 0) {
        jobLogger.info('Search cache pre-loaded', {
          cachedDomains: searchCacheMap.size,
          totalDomains: allDomains.length,
        });
      }
    }
  } catch (err) {
    jobLogger.warn('Search cache pre-load failed, proceeding without cache', {
      error: err instanceof Error ? err.message : String(err),
    });
    searchCacheMap = new Map();
  }

  // ---------------------------------------------------------------------------
  // Phase 1: Search people and create JobContact records per company
  // ---------------------------------------------------------------------------
  for (let i = 0; i < companies.length; i++) {
    // Check for cancellation before each company.
    const currentJobStatus = await prisma.job.findUnique({
      where: { id: jobId },
      select: { status: true },
    });
    if (currentJobStatus?.status === 'CANCELLED') {
      jobLogger.info('Job cancelled by user, stopping processing', {
        processedSoFar: totalContactsFound,
      });
      stopProgressNotifications(jobId);
      break;
    }

    const company = companies[i]!;

    try {
      let contacts: ApolloContact[];
      const normalized = normalizeDomain(company.domain);

      // Check search cache first
      const cacheEntry = normalized ? searchCacheMap.get(normalized) : undefined;

      if (cacheEntry) {
        // Cache HIT — use cached contacts
        contacts = searchCacheService.mapCacheEntryToContacts(cacheEntry);
        await searchCacheService.recordHit(cacheEntry.normalizedDomain, cacheEntry.filterHash);
        searchCacheHits++;

        jobLogger.debug('Search cache hit', {
          domain: company.domain,
          cachedContacts: contacts.length,
        });
      } else {
        // Cache MISS — call Apollo API
        contacts = await searchPeople(company.domain, company.companyName, job.data.contactFilters);
        totalPeopleSearchCalls++;
        searchCacheMisses++;

        // Store result in cache (including zero-result searches)
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
          domain: company.domain,
          jobCompanyId: company.jobCompanyId,
        });
        await updateProgress(job, i + 1, companies.length);
        continue;
      }

      // Step 2: Create JobContact records
      for (const contact of contacts) {
        // api_search returns first_name + last_name_obfuscated separately
        const firstName = contact.firstName || null;
        const lastName = contact.lastNameObfuscated || null;
        // All results are filtered by seniority params, so default to true
        const isDecisionMaker = true;

        // Step 4: Resolve timezone from Apollo location data
        const tz = getTimezone(contact.state, contact.country);

        const created = await prisma.jobContact.create({
          data: {
            jobId,
            jobCompanyId: company.jobCompanyId,
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
        domain: company.domain,
        contactCount: contacts.length,
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);

      // Detect Apollo daily rate limit exhaustion (429) and abort the job
      if (err instanceof ApiError && err.statusCode === 429 && err.serviceName === 'Apollo') {
        jobLogger.error('Apollo API rate limit exhausted, aborting job', {
          error: errorMessage,
        });

        await prisma.job.update({
          where: { id: jobId },
          data: {
            status: 'FAILED',
            errorMessage: 'Apollo API daily rate limit reached. Please try again tomorrow.',
            contactsFound: totalContactsFound,
            companiesFailed: failedCount,
          },
        });

        // T027: Invalidate prompt context cache on contact job failure
        await promptContextCache.invalidate(dbJob.slackTeamId, dbJob.slackUserId);

        throw err; // Re-throw to mark the BullMQ job as failed
      }

      jobLogger.error('Failed to search contacts for company', {
        domain: company.domain,
        jobCompanyId: company.jobCompanyId,
        error: errorMessage,
      });

      failedCount++;
    }

    // Update BullMQ job progress
    await updateProgress(job, i + 1, companies.length);
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
  await publishProgress({ jobId, stage: 'apollo_search', status: 'complete', detail: `${totalContactsFound} contacts found${searchCacheHits > 0 ? ` (${searchCacheHits} from cache)` : ''}` });
  await publishProgress({ jobId, stage: 'persona', status: 'in_progress' });

  // ---------------------------------------------------------------------------
  // Phase 2: Batch classify persona types
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

  // ---------------------------------------------------------------------------
  // Feature 27: Route to waterfall enrichment after Phase 1 (search) and
  // Phase 2 (persona). Contacts must exist in the DB before the waterfall
  // functions can query and enrich them.
  // ---------------------------------------------------------------------------
  if (enrichmentMode === 'EMAIL_ONLY' || enrichmentMode === 'PHONE_ONLY' || enrichmentMode === 'ALL') {
    stopProgressNotifications(jobId);

    if (enrichmentMode === 'EMAIL_ONLY') {
      await processEmailOnlyEnrichment(job, jobRecord);
    } else if (enrichmentMode === 'PHONE_ONLY') {
      await processPhoneOnlyEnrichment(job, jobRecord);
    } else {
      await processCombinedEnrichment(job, jobRecord);
    }

    // Waterfall functions handle job status, file generation, and DNC gate.
    // Send completion notification only if job finished (not awaiting DNC).
    const finalJob = await prisma.job.findUnique({
      where: { id: jobId },
      select: { status: true, contactsFound: true },
    });
    if (finalJob?.status === 'COMPLETED') {
      await sendCompletionNotification(
        { jobId, channelId: dbJob.slackChannelId, threadTs: dbJob.slackThreadTs },
        companies.length - failedCount,
        failedCount,
        false,
      );
    }

    jobLogger.info('Waterfall enrichment routing complete', {
      enrichmentMode,
      finalStatus: finalJob?.status,
    });
    return;
  }

  // ---------------------------------------------------------------------------
  // Phase 3 (legacy): Bulk enrichment to get full contact data (email, linkedin,
  //   seniority, location). Always run because the free api_search endpoint
  //   only returns names, titles, and Apollo IDs.
  //   - Phone reveal is conditional: COLD_CALLING or ALL only.
  //   - Contact cache: check for cached enrichment data before calling Apollo.
  // ---------------------------------------------------------------------------
  const needsBulkEnrich = allCreatedContacts.length > 0;
  const needsPhones = purpose === 'COLD_CALLING' || purpose === 'ALL';
  let contactCacheHits = 0;
  let contactCacheMisses = 0;

  // DIAGNOSTIC: Log phone enrichment decision
  jobLogger.info('Phone enrichment decision', {
    purpose,
    needsPhones,
    purposeType: typeof purpose,
    purposeMatch: {
      isColdCalling: purpose === 'COLD_CALLING',
      isAll: purpose === 'ALL',
      isEmailing: purpose === 'EMAILING',
      isJustAList: purpose === 'JUST_A_LIST',
      isLinkedIn: purpose === 'LINKEDIN',
    },
  });

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
          jobLogger.info('Contact cache pre-loaded', {
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
            enrichmentStatus: needsPhones && !cached.hasPhoneData ? 'ENRICHED' : 'ENRICHED',
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
        // DIAGNOSTIC: Log bulk enrichment call with phone reveal flag
        jobLogger.info('Calling bulkEnrichPeople', {
          contactCount: contactsForEnrich.length,
          needsPhones,
          purpose,
          willRevealPhones: needsPhones,
        });

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

        if (needsPhones) {
          // DIAGNOSTIC: Confirm phone enrichment branch is entered
          jobLogger.info('ENTERING phone enrichment flow', {
            purpose,
            needsPhones,
            freshContactCount: contactsForEnrich.length,
            enrichResultRequestIds: enrichResult.requestIds.length,
          });

          // Update enrichment status to PHONE_PENDING only for freshly enriched contacts
          const freshContactIds = contactsForEnrich.map((c) => c.jobContactId);
          await prisma.jobContact.updateMany({
            where: {
              jobId,
              id: { in: freshContactIds },
            },
            data: { enrichmentStatus: 'PHONE_PENDING' },
          });

          // Update job status to AWAITING_PHONES but DON'T block file generation
          // Emails are already available from bulk enrichment - deliver them now
          // Phones will update the file later when webhooks arrive
          await prisma.job.update({
            where: { id: jobId },
            data: {
              status: 'AWAITING_PHONES',
              contactsFound: totalContactsFound,
              companiesFailed: failedCount,
              apolloContactCacheHits: contactCacheHits,
              apolloContactCacheMisses: contactCacheMisses,
            },
          });

          jobLogger.info('Phone enrichment submitted, generating file with emails now', {
            contactsSubmitted: contactsForEnrich.length,
            requestIds: enrichResult.requestIds.length,
            creditsUsed: enrichResult.creditsUsed,
            contactCacheHits,
            note: 'Phones will update file later when webhooks arrive',
          });

          // Enqueue file generation immediately with emails
          // Phone data will trigger a file regeneration when webhooks arrive
          await enqueueFileGeneration(jobId, jobLogger);
        } else {
          // No phone reveal -- enqueue file generation directly
          await prisma.job.update({
            where: { id: jobId },
            data: {
              contactsFound: totalContactsFound,
              companiesFailed: failedCount,
              apolloContactCacheHits: contactCacheHits,
              apolloContactCacheMisses: contactCacheMisses,
            },
          });

          await enqueueFileGeneration(jobId, jobLogger);
        }
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        jobLogger.error('Bulk enrichment failed', { error: errorMessage });

        // Fall through to file generation even if enrichment fails
        await prisma.job.update({
          where: { id: jobId },
          data: {
            contactsFound: totalContactsFound,
            companiesFailed: failedCount,
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
          contactsFound: totalContactsFound,
          companiesFailed: failedCount,
          apolloContactCacheHits: contactCacheHits,
          apolloContactCacheMisses: 0,
        },
      });

      if (needsPhones && contactIdsFromCache.length > 0) {
        // Cache hits with phone data are already complete; enqueue file generation
        await enqueueFileGeneration(jobId, jobLogger);
      } else {
        await enqueueFileGeneration(jobId, jobLogger);
      }

      jobLogger.info('All contacts served from cache, skipping bulk enrichment', {
        contactCacheHits,
      });
    }
  } else {
    // No contacts found -- generate file directly
    await prisma.job.update({
      where: { id: jobId },
      data: {
        contactsFound: totalContactsFound,
        companiesFailed: failedCount,
      },
    });

    await enqueueFileGeneration(jobId, jobLogger);
  }

  // Send completion notification and stop periodic notifications
  await sendCompletionNotification(
    {
      jobId,
      channelId: dbJob.slackChannelId,
      threadTs: dbJob.slackThreadTs,
    },
    companies.length - failedCount, // successful companies
    failedCount,
    needsPhones, // Indicate if phones are pending async delivery
  );

  // Deduct billing credits based on rate snapshot
  if (jobRecord.creditRateSnapshot) {
    const snapshot = jobRecord.creditRateSnapshot as Record<string, number>;
    const searchCost = snapshot.apolloPeopleSearch ?? 0;
    const enrichCost = snapshot.apolloBulkEnrich ?? 0;
    const companiesSearched = companies.length - failedCount;
    let totalBillingCredits = companiesSearched * searchCost;
    if (needsPhones && totalContactsFound > 0) {
      totalBillingCredits += totalContactsFound * enrichCost;
    }
    if (totalBillingCredits > 0) {
      const deductResult = await deductCredits(
        slackTeamId,
        totalBillingCredits,
        jobId,
        `Contact enrichment: ${companiesSearched} companies, ${totalContactsFound} contacts`,
      );
      if (deductResult) {
        const dbJobForNotify = await prisma.job.findUnique({
          where: { id: jobId },
          select: { slackChannelId: true, slackThreadTs: true, slackTeamId: true, slackUserId: true },
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

  jobLogger.info('Contact enrichment processing complete', {
    totalContactsFound,
    failedCount,
    needsPhones,
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Updates the BullMQ job progress as a percentage (0-100).
 *
 * @param job     - The active BullMQ job instance.
 * @param current - Number of companies processed so far.
 * @param total   - Total number of companies in the batch.
 */
async function updateProgress(
  job: Job<ContactJobData>,
  current: number,
  total: number,
): Promise<void> {
  const percent = Math.round((current / total) * 100);
  await job.updateProgress(percent);
}

/**
 * Fetches the job's Slack context and enqueues a file generation job.
 *
 * @param jobId     - Parent job UUID.
 * @param jobLogger - Logger with job context.
 */
async function enqueueFileGeneration(
  jobId: string,
  jobLogger: import('../../../lib/logger.js').Logger,
): Promise<void> {
  const dbJob = await prisma.job.findUniqueOrThrow({
    where: { id: jobId },
    select: {
      slackChannelId: true,
      slackThreadTs: true,
      sourceFileType: true,
      status: true,
    },
  });

  // -----------------------------------------------------------------------
  // Quality gate check: DNC scrub (phones) and email verification (emails)
  // These gates insert interactive Slack prompts before file generation.
  // Skip gate checks if the job is already past these stages (e.g. coming
  // from the DNC or email-verify workers after the user made their choice).
  // -----------------------------------------------------------------------
  const skipGates = dbJob.status === 'COMPLETED'
    || dbJob.status === 'AWAITING_DNC_DECISION'
    || dbJob.status === 'AWAITING_EMAIL_VERIFICATION';

  if (!skipGates) {
    // DNC gate: if phones found and DNC API key configured
    if (config.dncscrub.apiKey) {
      const phoneCount = await prisma.jobContact.count({
        where: { jobId, directPhone: { not: null } },
      });

      if (phoneCount > 0) {
        const { WebClient } = await import('@slack/web-api');
        const { buildDncScrubDecisionBlocks } = await import('../../../listeners/actions/dncScrub.js');
        const slackClient = new WebClient(config.slack.botToken);

        await slackClient.chat.postMessage({
          channel: dbJob.slackChannelId,
          thread_ts: dbJob.slackThreadTs,
          text: `Phone enrichment complete! ${phoneCount} phone numbers found. Would you like to scrub against the DNC registry?`,
          blocks: buildDncScrubDecisionBlocks(jobId, phoneCount),
        });

        await prisma.job.update({
          where: { id: jobId },
          data: { status: 'AWAITING_DNC_DECISION' },
        });

        jobLogger.info('DNC gate triggered before file generation', { jobId, phoneCount });
        return; // Worker exits -- DNC button handler takes over
      }
    }

    // Email verification gate: if emails found and Findymail API key configured
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

        jobLogger.info('Email verification gate triggered before file generation', { jobId, emailCount });
        return; // Worker exits -- email verify button handler takes over
      }
    }
  }

  // No gates triggered or gates already processed -- enqueue file generation
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
// Feature 27: Email-only enrichment using waterfall
// ---------------------------------------------------------------------------

/**
 * Process EMAIL_ONLY enrichment mode using multi-provider waterfall.
 *
 * Uses Apollo → Wiza → AI Ark waterfall for email enrichment only.
 * Updates JobContact records with emails, provider sources, and costs.
 */
async function processEmailOnlyEnrichment(
  job: Job<ContactJobData>,
  jobRecord: { slackTeamId: string; creditRateSnapshot: unknown },
): Promise<void> {
  const { jobId, companies } = job.data;
  const jobLogger = logger.withContext({ jobId });

  jobLogger.info('EMAIL_ONLY enrichment started', {
    companyCount: companies.length,
  });

  // Import email waterfall (batch-aware)
  const { enrichEmailsBatch } = await import('../../../services/enrichment/emailWaterfall.js');

  // Mark job as PROCESSING
  const dbJob = await prisma.job.update({
    where: { id: jobId },
    data: { status: 'PROCESSING', startedAt: new Date() },
    select: { slackChannelId: true, slackThreadTs: true, slackTeamId: true, slackUserId: true },
  });

  await publishProgress({ jobId, stage: 'email_waterfall', status: 'in_progress', detail: `Enriching emails for ${companies.length} companies` });

  let totalEmailsFound = 0;
  let totalCost = 0;
  const providersUsed = new Set<string>();

  // Collect all contacts across all companies for batch enrichment
  const allContacts: Array<{
    id: string;
    firstName?: string;
    lastName?: string;
    email?: string;
    domain?: string;
    companyName?: string;
    jobCompanyId: string;
  }> = [];

  for (const company of companies) {
    const contacts = await prisma.jobContact.findMany({
      where: {
        jobId,
        jobCompanyId: company.jobCompanyId,
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        jobCompanyId: true,
      },
    });

    for (const contact of contacts) {
      allContacts.push({
        id: contact.id,
        firstName: contact.firstName ?? undefined,
        lastName: contact.lastName ?? undefined,
        email: contact.email ?? undefined,
        domain: company.domain ?? undefined,
        companyName: company.companyName ?? undefined,
        jobCompanyId: company.jobCompanyId,
      });
    }
  }

  // Filter contacts that need email enrichment (skip those with existing emails)
  const contactsToEnrich = allContacts.filter((c) => !c.email);

  jobLogger.info('Contacts collected for batch email enrichment', {
    totalContacts: allContacts.length,
    toEnrich: contactsToEnrich.length,
    skipped: allContacts.length - contactsToEnrich.length,
  });

  // Run batch waterfall (auto-routes: > 5 contacts = batch mode, <= 5 = sequential)
  const results = await enrichEmailsBatch(
    contactsToEnrich.map((c) => ({
      id: c.id,
      firstName: c.firstName,
      lastName: c.lastName,
      domain: c.domain,
      companyName: c.companyName,
    })),
    jobId,
    (phase, completed, total) => {
      const pct = Math.round((completed / total) * 100);
      jobLogger.info(`Email waterfall progress: ${phase}`, { completed, total, pct });
      job.updateProgress(pct).catch(() => {});
    },
  );

  // Update JobContact records with results
  for (const [contactId, result] of results.entries()) {
    if (result) {
      await prisma.jobContact.update({
        where: { id: contactId },
        data: {
          email: result.email,
          emailSource: result.provider,
          emailCost: result.cost,
          enrichmentStatus: 'ENRICHED',
          enrichmentAttempts: { increment: 1 },
        },
      });

      totalEmailsFound++;
      totalCost += result.cost;
      providersUsed.add(result.provider);
    } else {
      await prisma.jobContact.update({
        where: { id: contactId },
        data: {
          enrichmentAttempts: { increment: 1 },
        },
      });
    }
  }

  // Mark companies as enriched
  const companyIds = new Set(allContacts.map((c) => c.jobCompanyId));
  for (const companyId of companyIds) {
    await prisma.jobCompany.update({
      where: { id: companyId },
      data: { enrichmentStatus: 'SUCCESS' },
    });
  }

  await publishProgress({ jobId, stage: 'email_waterfall', status: 'complete', detail: `Found ${totalEmailsFound} emails` });

  // Invalidate prompt context cache
  await promptContextCache.invalidate(dbJob.slackTeamId, dbJob.slackUserId);

  // Update job stats then let enqueueFileGeneration handle quality gates (DNC + email verification)
  await prisma.job.update({
    where: { id: jobId },
    data: {
      contactsFound: totalEmailsFound,
      companiesProcessed: companies.length,
      totalCost,
      providersUsed: Array.from(providersUsed),
    },
  });

  await enqueueFileGeneration(jobId, jobLogger);

  jobLogger.info('EMAIL_ONLY enrichment processing complete', {
    totalEmailsFound,
    totalCost,
    providersUsed: Array.from(providersUsed),
  });
}

// ---------------------------------------------------------------------------
// Feature 27: Phone-only enrichment using waterfall
// ---------------------------------------------------------------------------

/**
 * Process PHONE_ONLY enrichment mode using Wiza → AI Ark waterfall.
 *
 * Collects all contacts across companies, runs phone batch waterfall,
 * and updates JobContact records with phone data and provider source.
 */
async function processPhoneOnlyEnrichment(
  job: Job<ContactJobData>,
  jobRecord: { slackTeamId: string; creditRateSnapshot: unknown },
): Promise<void> {
  const { jobId, companies } = job.data;
  const jobLogger = logger.withContext({ jobId });

  jobLogger.info('PHONE_ONLY enrichment started', {
    companyCount: companies.length,
  });

  const { enrichPhonesBatch } = await import('../../../services/enrichment/phoneWaterfall.js');
  const { evaluatePhoneQualityGate } = await import('../../../services/enrichment/phoneQualityGate.js');

  const dbJob = await prisma.job.update({
    where: { id: jobId },
    data: { status: 'PROCESSING', startedAt: new Date() },
    select: { slackChannelId: true, slackThreadTs: true, slackTeamId: true, slackUserId: true },
  });

  await publishProgress({ jobId, stage: 'phone_waterfall', status: 'in_progress', detail: `Enriching phones for ${companies.length} companies` });

  let totalPhonesFound = 0;
  let totalCost = 0;
  const providersUsed = new Set<string>();

  // Collect all contacts across all companies (include apolloMetadata for quality gate)
  const allContacts: Array<{
    id: string;
    firstName?: string;
    lastName?: string;
    fullName?: string;
    domain?: string;
    companyName?: string;
    linkedinUrl?: string;
    jobCompanyId: string;
    apolloMetadata?: Record<string, unknown> | null;
  }> = [];

  for (const company of companies) {
    const contacts = await prisma.jobContact.findMany({
      where: { jobId, jobCompanyId: company.jobCompanyId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        fullName: true,
        directPhone: true,
        linkedinUrl: true,
        jobCompanyId: true,
        apolloMetadata: true,
      },
    });

    for (const contact of contacts) {
      allContacts.push({
        id: contact.id,
        firstName: contact.firstName ?? undefined,
        lastName: contact.lastName ?? undefined,
        fullName: contact.fullName ?? undefined,
        domain: company.domain ?? undefined,
        companyName: company.companyName ?? undefined,
        linkedinUrl: contact.linkedinUrl ?? undefined,
        jobCompanyId: company.jobCompanyId,
        apolloMetadata: contact.apolloMetadata as Record<string, unknown> | null,
      });
    }
  }

  // ── Quality gate: filter out contacts in DNC states ──────────────
  const gateResult = await evaluatePhoneQualityGate(
    allContacts.map((c) => ({ id: c.id, apolloMetadata: c.apolloMetadata })),
    jobId,
  );

  const allowedIds = new Set(gateResult.allowed);
  // Include unknown-state contacts in enrichment (only block DNC states)
  const unknownIds = new Set(gateResult.unknown);
  const contactsToEnrich = allContacts.filter(
    (c) => allowedIds.has(c.id) || unknownIds.has(c.id),
  );

  jobLogger.info('Phone quality gate applied', {
    totalContacts: allContacts.length,
    allowed: gateResult.allowed.length,
    blocked: gateResult.blocked.length,
    unknown: gateResult.unknown.length,
    toEnrich: contactsToEnrich.length,
  });

  if (contactsToEnrich.length === 0) {
    jobLogger.info('No contacts eligible for phone enrichment after quality gate');
  }

  // Only enrich contacts that passed the quality gate
  const results = contactsToEnrich.length > 0
    ? await enrichPhonesBatch(
        contactsToEnrich.map((c) => ({
          id: c.id,
          firstName: c.firstName,
          lastName: c.lastName,
          fullName: c.fullName,
          domain: c.domain,
          companyName: c.companyName,
          linkedinUrl: c.linkedinUrl,
        })),
        jobId,
        (phase, completed, total) => {
          const pct = Math.round((completed / total) * 100);
          jobLogger.info(`Phone waterfall progress: ${phase}`, { completed, total, pct });
          job.updateProgress(pct).catch(() => {});
        },
      )
    : new Map<string, { phone: string; provider: Provider; cost: number } | null>();

  // Update JobContact records with phone results
  for (const [contactId, result] of results.entries()) {
    if (result) {
      await prisma.jobContact.update({
        where: { id: contactId },
        data: {
          directPhone: result.phone,
          phoneSource: result.provider,
          phoneCost: result.cost,
          enrichmentAttempts: { increment: 1 },
        },
      });

      totalPhonesFound++;
      totalCost += result.cost;
      providersUsed.add(result.provider);
    } else {
      await prisma.jobContact.update({
        where: { id: contactId },
        data: { enrichmentAttempts: { increment: 1 } },
      });
    }
  }

  // Mark companies as enriched
  const companyIds = new Set(allContacts.map((c) => c.jobCompanyId));
  for (const companyId of companyIds) {
    await prisma.jobCompany.update({
      where: { id: companyId },
      data: { enrichmentStatus: 'SUCCESS' },
    });
  }

  await publishProgress({ jobId, stage: 'phone_waterfall', status: 'complete', detail: `Found ${totalPhonesFound} phones` });

  await promptContextCache.invalidate(dbJob.slackTeamId, dbJob.slackUserId);

  // DNC scrub gate: if API key is configured and phones were found, prompt user
  if (config.dncscrub.apiKey && totalPhonesFound > 0) {
    const { WebClient } = await import('@slack/web-api');
    const { buildDncScrubDecisionBlocks } = await import('../../../listeners/actions/dncScrub.js');
    const slackClient = new WebClient(config.slack.botToken);

    await slackClient.chat.postMessage({
      channel: dbJob.slackChannelId,
      thread_ts: dbJob.slackThreadTs,
      text: `Phone enrichment complete! ${totalPhonesFound} phone numbers found. Would you like to scrub against the DNC registry?`,
      blocks: buildDncScrubDecisionBlocks(jobId, totalPhonesFound),
    });

    await prisma.job.update({
      where: { id: jobId },
      data: {
        status: 'AWAITING_DNC_DECISION',
        contactsFound: totalPhonesFound,
        companiesProcessed: companies.length,
        totalCost,
        providersUsed: Array.from(providersUsed),
      },
    });

    jobLogger.info('PHONE_ONLY enrichment awaiting DNC decision', {
      totalPhonesFound,
      totalCost,
      providersUsed: Array.from(providersUsed),
    });
    return; // Worker exits -- button handler takes over
  }

  // No DNC key or no phones found -- complete and generate file
  await prisma.job.update({
    where: { id: jobId },
    data: {
      status: 'COMPLETED',
      completedAt: new Date(),
      contactsFound: totalPhonesFound,
      companiesProcessed: companies.length,
      totalCost,
      providersUsed: Array.from(providersUsed),
    },
  });

  await enqueueFileGeneration(jobId, jobLogger);

  jobLogger.info('PHONE_ONLY enrichment completed', {
    totalPhonesFound,
    totalCost,
    providersUsed: Array.from(providersUsed),
  });
}

// ---------------------------------------------------------------------------
// Feature 27: Combined enrichment (Email + Phone)
// ---------------------------------------------------------------------------

/**
 * Process ALL enrichment mode: emails first, then phones.
 *
 * Runs email waterfall (Apollo → Wiza → AI Ark) synchronously,
 * then phone waterfall (Wiza → AI Ark) for all contacts.
 * Generates file after both complete.
 */
async function processCombinedEnrichment(
  job: Job<ContactJobData>,
  jobRecord: { slackTeamId: string; creditRateSnapshot: unknown },
): Promise<void> {
  const { jobId, companies } = job.data;
  const jobLogger = logger.withContext({ jobId });

  jobLogger.info('COMBINED (ALL) enrichment started', {
    companyCount: companies.length,
  });

  const { enrichEmailsBatch } = await import('../../../services/enrichment/emailWaterfall.js');
  const { enrichPhonesBatch } = await import('../../../services/enrichment/phoneWaterfall.js');
  const { evaluatePhoneQualityGate } = await import('../../../services/enrichment/phoneQualityGate.js');

  const dbJob = await prisma.job.update({
    where: { id: jobId },
    data: { status: 'PROCESSING', startedAt: new Date() },
    select: { slackChannelId: true, slackThreadTs: true, slackTeamId: true, slackUserId: true },
  });

  let totalEmailsFound = 0;
  let totalPhonesFound = 0;
  let totalCost = 0;
  const providersUsed = new Set<string>();

  // Collect all contacts across all companies
  const allContacts: Array<{
    id: string;
    firstName?: string;
    lastName?: string;
    fullName?: string;
    email?: string;
    domain?: string;
    companyName?: string;
    linkedinUrl?: string;
    jobCompanyId: string;
  }> = [];

  for (const company of companies) {
    const contacts = await prisma.jobContact.findMany({
      where: { jobId, jobCompanyId: company.jobCompanyId },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        fullName: true,
        email: true,
        linkedinUrl: true,
        jobCompanyId: true,
      },
    });

    for (const contact of contacts) {
      allContacts.push({
        id: contact.id,
        firstName: contact.firstName ?? undefined,
        lastName: contact.lastName ?? undefined,
        fullName: contact.fullName ?? undefined,
        email: contact.email ?? undefined,
        domain: company.domain ?? undefined,
        companyName: company.companyName ?? undefined,
        linkedinUrl: contact.linkedinUrl ?? undefined,
        jobCompanyId: company.jobCompanyId,
      });
    }
  }

  // ── Phase 1: Email enrichment ─────────────────────────────────
  await publishProgress({ jobId, stage: 'email_waterfall', status: 'in_progress', detail: `Enriching emails for ${allContacts.length} contacts` });

  const contactsNeedingEmail = allContacts.filter((c) => !c.email);

  jobLogger.info('Combined enrichment: email phase', {
    totalContacts: allContacts.length,
    needingEmail: contactsNeedingEmail.length,
  });

  if (contactsNeedingEmail.length > 0) {
    const emailResults = await enrichEmailsBatch(
      contactsNeedingEmail.map((c) => ({
        id: c.id,
        firstName: c.firstName,
        lastName: c.lastName,
        domain: c.domain,
        companyName: c.companyName,
        linkedinUrl: c.linkedinUrl,
      })),
      jobId,
      (phase, completed, total) => {
        jobLogger.info(`Email phase progress: ${phase}`, { completed, total });
        job.updateProgress(Math.round((completed / total) * 50)).catch(() => {}); // 0-50%
      },
    );

    for (const [contactId, result] of emailResults.entries()) {
      if (result) {
        await prisma.jobContact.update({
          where: { id: contactId },
          data: {
            email: result.email,
            emailSource: result.provider,
            emailCost: result.cost,
            enrichmentStatus: 'ENRICHED',
            enrichmentAttempts: { increment: 1 },
          },
        });

        totalEmailsFound++;
        totalCost += result.cost;
        providersUsed.add(result.provider);
      }
    }
  }

  await publishProgress({ jobId, stage: 'email_waterfall', status: 'complete', detail: `Found ${totalEmailsFound} emails` });

  // ── Quality gate: re-fetch apolloMetadata (populated by Apollo email enrichment) ──
  const contactsWithMeta = await prisma.jobContact.findMany({
    where: { jobId },
    select: { id: true, apolloMetadata: true },
  });

  const gateResult = await evaluatePhoneQualityGate(
    contactsWithMeta.map((c) => ({
      id: c.id,
      apolloMetadata: c.apolloMetadata as Record<string, unknown> | null,
    })),
    jobId,
  );

  const allowedForPhone = new Set([...gateResult.allowed, ...gateResult.unknown]);

  jobLogger.info('Combined enrichment: quality gate applied', {
    allowed: gateResult.allowed.length,
    blocked: gateResult.blocked.length,
    unknown: gateResult.unknown.length,
    toEnrich: allowedForPhone.size,
  });

  // ── Phase 2: Phone enrichment (only contacts that passed quality gate) ──
  const phoneEligible = allContacts.filter((c) => allowedForPhone.has(c.id));

  await publishProgress({ jobId, stage: 'phone_waterfall', status: 'in_progress', detail: `Enriching phones for ${phoneEligible.length} contacts (${gateResult.blocked.length} blocked by DNC)` });

  jobLogger.info('Combined enrichment: phone phase', {
    totalContacts: allContacts.length,
    eligible: phoneEligible.length,
    blockedByDnc: gateResult.blocked.length,
  });

  const phoneResults = phoneEligible.length > 0
    ? await enrichPhonesBatch(
        phoneEligible.map((c) => ({
          id: c.id,
          firstName: c.firstName,
          lastName: c.lastName,
          fullName: c.fullName,
          domain: c.domain,
          companyName: c.companyName,
          linkedinUrl: c.linkedinUrl,
        })),
        jobId,
        (phase, completed, total) => {
          jobLogger.info(`Phone phase progress: ${phase}`, { completed, total });
          job.updateProgress(50 + Math.round((completed / total) * 50)).catch(() => {}); // 50-100%
        },
      )
    : new Map<string, { phone: string; provider: Provider; cost: number } | null>();

  for (const [contactId, result] of phoneResults.entries()) {
    if (result) {
      await prisma.jobContact.update({
        where: { id: contactId },
        data: {
          directPhone: result.phone,
          phoneSource: result.provider,
          phoneCost: result.cost,
          enrichmentAttempts: { increment: 1 },
        },
      });

      totalPhonesFound++;
      totalCost += result.cost;
      providersUsed.add(result.provider);
    }
  }

  await publishProgress({ jobId, stage: 'phone_waterfall', status: 'complete', detail: `Found ${totalPhonesFound} phones` });

  // ── Finalize ──────────────────────────────────────────────────
  const companyIds = new Set(allContacts.map((c) => c.jobCompanyId));
  for (const companyId of companyIds) {
    await prisma.jobCompany.update({
      where: { id: companyId },
      data: { enrichmentStatus: 'SUCCESS' },
    });
  }

  await promptContextCache.invalidate(dbJob.slackTeamId, dbJob.slackUserId);

  // Update job stats then let enqueueFileGeneration handle quality gates (DNC + email verification)
  await prisma.job.update({
    where: { id: jobId },
    data: {
      contactsFound: totalEmailsFound + totalPhonesFound,
      companiesProcessed: companies.length,
      totalCost,
      providersUsed: Array.from(providersUsed),
    },
  });

  await enqueueFileGeneration(jobId, jobLogger);

  jobLogger.info('COMBINED (ALL) enrichment processing complete', {
    totalEmailsFound,
    totalPhonesFound,
    totalCost,
    providersUsed: Array.from(providersUsed),
  });
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Creates and returns a BullMQ Worker that listens on the 'enrichment' queue
 * for jobs named 'contact-enrichment'.
 *
 * The worker uses the Redis connection URL from the application config.
 *
 * @returns A configured BullMQ {@link Worker} instance.
 */
export function createContactWorker(): Worker {
  const worker = new Worker<ContactJobData>(
    'enrichment',
    async (job: Job<ContactJobData>) => {
      if (job.name !== 'contact-enrichment') {
        logger.debug('Skipping non-contact job on enrichment queue', {
          jobName: job.name,
        });
        return;
      }

      await processContactJob(job);
    },
    {
      connection: { url: config.redis.url },
      concurrency: 1,
    },
  );

  worker.on('completed', (job: Job<ContactJobData>) => {
    logger.info('Contact enrichment job completed', {
      bullmqJobId: job.id,
      jobId: job.data.jobId,
    });
  });

  worker.on('failed', (job: Job<ContactJobData> | undefined, err: Error) => {
    logger.error('Contact enrichment job failed', {
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
