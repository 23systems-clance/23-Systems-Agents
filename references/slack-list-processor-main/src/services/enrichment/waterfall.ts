/**
 * Waterfall orchestrator for multi-provider enrichment (Feature 27).
 *
 * Core logic for sequential provider fallback:
 * - Email waterfall: Apollo → Wiza → AI Ark
 * - Phone waterfall: Apollo → Wiza → AI Ark
 *
 * Implements FR-001, FR-002, FR-003 (waterfall sequences, stop on success, no double charging).
 */

import { Provider, DataType, AttemptStatus } from '@prisma/client';
import { prisma } from '../../models/index.js';
import logger from '../../lib/logger.js';
import { getProvidersByPriority } from './providerRegistry.js';
import { getCostPerUnit } from './costCalculator.js';
import { getCachedEmail, getCachedPhone, cacheEmailResult, cachePhoneResult } from './cache.js';
import type {
  EnrichmentContact,
  ProviderAttemptResult,
  WaterfallResult,
} from '../../types/providers.js';

/**
 * Enrich contacts using waterfall provider fallback.
 *
 * @param contacts - Contacts to enrich
 * @param dataType - 'EMAIL' or 'PHONE'
 * @param providerEnricher - Function to call provider API
 * @returns Waterfall results for each contact
 */
export async function enrichWithWaterfall<T extends EnrichmentContact>(
  contacts: T[],
  dataType: DataType,
  providerEnricher: (
    contact: T,
    provider: Provider,
  ) => Promise<string | null>,
): Promise<Map<string, WaterfallResult>> {
  const providers = getProvidersByPriority(dataType);
  const results = new Map<string, WaterfallResult>();

  for (const contact of contacts) {
    // Skip contacts with existing data (FR-026)
    if (shouldSkipContact(contact, dataType)) {
      logger.debug('Skipping contact with existing data', {
        contactId: contact.id,
        dataType,
      });
      continue;
    }

    // Check cache first (FR-023)
    const cachedResult = await getCachedResult(contact, dataType);
    if (cachedResult) {
      results.set(contact.id, cachedResult);
      continue;
    }

    // Try providers in waterfall order
    const waterfallResult: WaterfallResult = {
      dataType,
      value: null,
      provider: null,
      attempts: [],
      totalCost: 0,
      success: false,
    };

    for (const provider of providers) {
      const attemptResult = await attemptProviderEnrichment(
        contact,
        provider,
        dataType,
        providerEnricher,
      );

      waterfallResult.attempts.push(attemptResult);

      if (attemptResult.status === 'SUCCESS') {
        waterfallResult.value =
          attemptResult.emailFound ?? attemptResult.phoneFound ?? null;
        waterfallResult.provider = provider;
        waterfallResult.totalCost += attemptResult.cost ?? 0;
        waterfallResult.success = true;

        // Cache the result (FR-015)
        if (dataType === 'EMAIL' && attemptResult.emailFound) {
          await cacheEmailResult(
            contact,
            attemptResult.emailFound,
            provider,
            attemptResult.cost ?? 0,
          );
        } else if (dataType === 'PHONE' && attemptResult.phoneFound) {
          await cachePhoneResult(
            contact,
            attemptResult.phoneFound,
            provider,
            attemptResult.cost ?? 0,
          );
        }

        // Stop on first success (FR-001, FR-002)
        break;
      }

      // Continue to next provider on failure (FR-016)
      logger.debug('Provider attempt failed, continuing waterfall', {
        contactId: contact.id,
        provider,
        dataType,
        status: attemptResult.status,
      });
    }

    results.set(contact.id, waterfallResult);
  }

  return results;
}

/**
 * Attempt enrichment with a single provider.
 */
async function attemptProviderEnrichment<T extends EnrichmentContact>(
  contact: T,
  provider: Provider,
  dataType: DataType,
  providerEnricher: (contact: T, provider: Provider) => Promise<string | null>,
): Promise<ProviderAttemptResult> {
  const startTime = Date.now();

  try {
    const result = await providerEnricher(contact, provider);
    const durationMs = Date.now() - startTime;

    if (result) {
      const cost = await getCostPerUnit(provider, dataType);

      return {
        provider,
        dataType,
        status: 'SUCCESS',
        emailFound: dataType === 'EMAIL' ? result : undefined,
        phoneFound: dataType === 'PHONE' ? result : undefined,
        cost,
        durationMs,
      };
    } else {
      return {
        provider,
        dataType,
        status: 'NO_DATA',
        durationMs,
      };
    }
  } catch (error) {
    const durationMs = Date.now() - startTime;

    logger.warn('Provider enrichment failed', {
      provider,
      dataType,
      error: error instanceof Error ? error.message : String(error),
    });

    return {
      provider,
      dataType,
      status: 'FAILED',
      errorMessage: error instanceof Error ? error.message : String(error),
      durationMs,
    };
  }
}

/**
 * Record provider attempt in database for audit and cost tracking.
 *
 * @param contactId - Contact UUID
 * @param jobId - Job UUID
 * @param result - Attempt result
 * @returns Created ProviderAttempt record
 */
export async function recordProviderAttempt(
  contactId: string,
  jobId: string,
  result: ProviderAttemptResult,
): Promise<void> {
  await prisma.providerAttempt.create({
    data: {
      jobId,
      contactId,
      provider: result.provider,
      dataType: result.dataType,
      status: result.status,
      emailFound: result.emailFound,
      phoneFound: result.phoneFound,
      cost: result.cost ?? null,
      creditsConsumed: result.creditsConsumed ?? null,
      errorMessage: result.errorMessage ?? null,
      httpStatus: result.httpStatus ?? null,
      startedAt: new Date(Date.now() - (result.durationMs ?? 0)),
      completedAt: new Date(),
      durationMs: result.durationMs ?? null,
    },
  });

  logger.info('Provider attempt recorded', {
    contactId,
    provider: result.provider,
    dataType: result.dataType,
    status: result.status,
    cost: result.cost,
  });
}

/**
 * Record multiple provider attempts in a single database call.
 *
 * Uses Prisma createMany for efficiency. For batch waterfall enrichment,
 * this replaces per-contact recordProviderAttempt calls, reducing DB
 * round trips from potentially 3,000 to 3.
 *
 * @param attempts - Array of attempt data to record.
 */
export async function recordProviderAttemptsBatch(
  attempts: Array<{
    contactId: string;
    jobId: string;
    result: ProviderAttemptResult;
  }>,
): Promise<void> {
  if (attempts.length === 0) return;

  const now = new Date();
  const data = attempts.map((a) => ({
    jobId: a.jobId,
    contactId: a.contactId,
    provider: a.result.provider,
    dataType: a.result.dataType,
    status: a.result.status,
    emailFound: a.result.emailFound ?? null,
    phoneFound: a.result.phoneFound ?? null,
    cost: a.result.cost ?? null,
    creditsConsumed: a.result.creditsConsumed ?? null,
    errorMessage: a.result.errorMessage ?? null,
    httpStatus: a.result.httpStatus ?? null,
    startedAt: new Date(now.getTime() - (a.result.durationMs ?? 0)),
    completedAt: now,
    durationMs: a.result.durationMs ?? null,
  }));

  await prisma.providerAttempt.createMany({ data });

  logger.info('Provider attempts recorded (batch)', {
    count: attempts.length,
    provider: attempts[0]?.result.provider,
    dataType: attempts[0]?.result.dataType,
  });
}

/**
 * Determine if contact should be skipped (FR-026).
 *
 * Skip if contact already has the data being enriched.
 */
export function shouldSkipContact(
  contact: EnrichmentContact,
  dataType: DataType,
): boolean {
  if (dataType === 'EMAIL') {
    return !!contact.email;
  } else {
    // For phone, check if we have any phone number
    // In production, would check directPhone or businessPhone from JobContact
    return false; // Simplified for base implementation
  }
}

/**
 * Filter contacts to exclude those with existing data.
 *
 * @param contacts - Contacts to filter
 * @param dataType - 'EMAIL' or 'PHONE'
 * @returns Contacts that need enrichment
 */
export function skipExistingData<T extends EnrichmentContact>(
  contacts: T[],
  dataType: DataType,
): T[] {
  const filtered = contacts.filter((c) => !shouldSkipContact(c, dataType));

  const skipped = contacts.length - filtered.length;
  if (skipped > 0) {
    logger.info('Skipped contacts with existing data', {
      dataType,
      skippedCount: skipped,
      remainingCount: filtered.length,
    });
  }

  return filtered;
}

/**
 * Get cached result if available.
 */
async function getCachedResult(
  contact: EnrichmentContact,
  dataType: DataType,
): Promise<WaterfallResult | null> {
  if (dataType === 'EMAIL') {
    const cached = await getCachedEmail(contact);
    if (cached) {
      return {
        dataType: 'EMAIL',
        value: cached.email,
        provider: cached.provider,
        attempts: [],
        totalCost: 0, // Cached, no new cost
        success: true,
      };
    }
  } else {
    const cached = await getCachedPhone(contact);
    if (cached) {
      return {
        dataType: 'PHONE',
        value: cached.phone,
        provider: cached.provider,
        attempts: [],
        totalCost: 0, // Cached, no new cost
        success: true,
      };
    }
  }

  return null;
}
