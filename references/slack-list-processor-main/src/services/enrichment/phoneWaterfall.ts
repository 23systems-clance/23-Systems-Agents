/**
 * Phone waterfall enrichment (Feature 27, US2/US3).
 *
 * Implements FR-002: Phone enrichment waterfall Apollo → Wiza → AI Ark.
 * Stops on first success, tracks provider source and costs.
 *
 * Routes to batch mode (batch-per-provider) for > 5 contacts.
 */

import { Provider } from '@prisma/client';
import logger from '../../lib/logger.js';
import { enrichWithWaterfall, recordProviderAttempt } from './waterfall.js';
import { enrichPhoneWithApollo } from '../apollo/phoneEnrichment.js';
import { enrichPhoneWithWiza } from '../wiza/phoneEnrichment.js';
import { enrichPhoneWithAIArk } from '../aiark/phoneEnrichment.js';
import { enrichPhonesBatchWaterfall } from './batchPhoneWaterfall.js';
import type { EnrichmentContact } from '../../types/providers.js';

/**
 * Enrich a single contact's phone using provider waterfall.
 *
 * Tries providers in sequence: Apollo → Wiza → AI Ark.
 * Stops on first success.
 *
 * @param contact - Contact to enrich.
 * @param jobId - Job UUID for attempt tracking.
 * @returns Phone found and provider source, or null if all providers failed.
 */
export async function enrichPhone(
  contact: EnrichmentContact,
  jobId: string,
): Promise<{ phone: string; provider: Provider; cost: number } | null> {
  logger.info('Starting phone waterfall for contact', {
    contactId: contact.id,
    jobId,
  });

  const results = await enrichWithWaterfall(
    [contact],
    'PHONE',
    async (c, provider) => {
      return await callProviderForPhone(c, provider);
    },
  );

  const result = results.get(contact.id);
  if (!result) {
    logger.error('No phone waterfall result for contact', { contactId: contact.id });
    return null;
  }

  // Record all attempts
  for (const attempt of result.attempts) {
    await recordProviderAttempt(contact.id, jobId, attempt);
  }

  if (result.success && result.value && result.provider) {
    logger.info('Phone waterfall succeeded', {
      contactId: contact.id,
      provider: result.provider,
      attemptsCount: result.attempts.length,
      cost: result.totalCost,
    });

    return {
      phone: result.value,
      provider: result.provider,
      cost: result.totalCost,
    };
  }

  logger.warn('Phone waterfall exhausted all providers', {
    contactId: contact.id,
    attemptsCount: result.attempts.length,
  });

  return null;
}

/**
 * Call appropriate provider for phone enrichment.
 */
async function callProviderForPhone(
  contact: EnrichmentContact,
  provider: Provider,
): Promise<string | null> {
  switch (provider) {
    case 'APOLLO':
      return await enrichPhoneWithApollo(contact);
    case 'WIZA':
      return await enrichPhoneWithWiza(contact);
    case 'AI_ARK':
      return await enrichPhoneWithAIArk(contact);
    default:
      throw new Error(`Provider ${provider} does not support phone enrichment`);
  }
}

/** Threshold for switching from sequential to batch mode. */
const BATCH_THRESHOLD = 5;

/**
 * Batch enrich phones for multiple contacts.
 *
 * Routes based on contact count:
 * - <= 5 contacts: sequential per-contact waterfall
 * - > 5 contacts: batch-per-provider waterfall
 *
 * @param contacts - Contacts to enrich.
 * @param jobId - Job UUID.
 * @param onProgress - Optional progress callback for batch mode.
 * @returns Map of contact ID to enrichment result.
 */
export async function enrichPhonesBatch(
  contacts: EnrichmentContact[],
  jobId: string,
  onProgress?: (phase: string, completed: number, total: number) => void,
): Promise<Map<string, { phone: string; provider: Provider; cost: number } | null>> {
  if (contacts.length === 0) return new Map();

  if (contacts.length > BATCH_THRESHOLD) {
    logger.info('Routing to batch phone waterfall mode', {
      jobId,
      contactCount: contacts.length,
    });

    const batchSummary = await enrichPhonesBatchWaterfall(contacts, {
      jobId,
      onProgress,
    });

    const results = new Map<string, { phone: string; provider: Provider; cost: number } | null>();

    for (const [contactId, batchResult] of batchSummary.results) {
      if (batchResult.phone && batchResult.provider) {
        results.set(contactId, {
          phone: batchResult.phone,
          provider: batchResult.provider,
          cost: batchResult.cost,
        });
      } else {
        results.set(contactId, null);
      }
    }

    return results;
  }

  // Sequential mode for small lists
  logger.info('Using sequential phone waterfall mode', {
    jobId,
    contactCount: contacts.length,
  });

  const results = new Map<string, { phone: string; provider: Provider; cost: number } | null>();

  for (const contact of contacts) {
    const result = await enrichPhone(contact, jobId);
    results.set(contact.id, result);
  }

  return results;
}
