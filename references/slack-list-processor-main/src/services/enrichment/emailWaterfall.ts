/**
 * Email waterfall enrichment (Feature 27, US1).
 *
 * Implements FR-001: Email enrichment waterfall Apollo → Wiza → AI Ark.
 * Stops on first success, tracks provider source and costs.
 *
 * Routes to batch mode (batch-per-provider) for > 5 contacts, or
 * sequential per-contact waterfall for <= 5 contacts.
 */

import { Provider } from '@prisma/client';
import logger from '../../lib/logger.js';
import { enrichWithWaterfall, recordProviderAttempt } from './waterfall.js';
import { enrichEmailWithApollo } from '../apollo/emailEnrichment.js';
import { enrichEmailWithWiza } from '../wiza/emailEnrichment.js';
import { enrichEmailWithAIArk } from '../aiark/emailEnrichment.js';
import { enrichEmailsBatchWaterfall } from './batchWaterfall.js';
import type { EnrichmentContact, WaterfallResult } from '../../types/providers.js';

/**
 * Enrich a single contact's email using provider waterfall.
 *
 * Tries providers in sequence: Apollo → Wiza → AI Ark.
 * Stops on first success.
 *
 * @param contact - Contact to enrich
 * @param jobId - Job UUID for attempt tracking
 * @returns Email found and provider source, or null if all providers failed
 */
export async function enrichEmail(
  contact: EnrichmentContact,
  jobId: string,
): Promise<{ email: string; provider: Provider; cost: number } | null> {
  logger.info('Starting email waterfall for contact', {
    contactId: contact.id,
    jobId,
  });

  // Run waterfall
  const results = await enrichWithWaterfall(
    [contact],
    'EMAIL',
    async (c, provider) => {
      return await callProviderForEmail(c, provider);
    },
  );

  const result = results.get(contact.id);
  if (!result) {
    logger.error('No waterfall result for contact', { contactId: contact.id });
    return null;
  }

  // Record all attempts in database (FR-017)
  for (const attempt of result.attempts) {
    await recordProviderAttempt(contact.id, jobId, attempt);
  }

  // Return success result
  if (result.success && result.value && result.provider) {
    logger.info('Email waterfall succeeded', {
      contactId: contact.id,
      provider: result.provider,
      attemptsCount: result.attempts.length,
      cost: result.totalCost,
    });

    return {
      email: result.value,
      provider: result.provider,
      cost: result.totalCost,
    };
  }

  // All providers failed
  logger.warn('Email waterfall exhausted all providers', {
    contactId: contact.id,
    attemptsCount: result.attempts.length,
  });

  return null;
}

/**
 * Call appropriate provider for email enrichment.
 */
async function callProviderForEmail(
  contact: EnrichmentContact,
  provider: Provider,
): Promise<string | null> {
  switch (provider) {
    case 'APOLLO':
      return await enrichEmailWithApollo(contact);
    case 'WIZA':
      return await enrichEmailWithWiza(contact);
    case 'AI_ARK':
      return await enrichEmailWithAIArk(contact);
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}

/** Threshold for switching from sequential to batch waterfall mode. */
const BATCH_THRESHOLD = 5;

/**
 * Batch enrich emails for multiple contacts.
 *
 * Routes based on contact count:
 * - <= 5 contacts: sequential per-contact waterfall (lower overhead)
 * - > 5 contacts: batch-per-provider waterfall (10x faster for large lists)
 *
 * @param contacts - Contacts to enrich.
 * @param jobId - Job UUID.
 * @param onProgress - Optional progress callback for batch mode.
 * @returns Map of contact ID to enrichment result.
 */
export async function enrichEmailsBatch(
  contacts: EnrichmentContact[],
  jobId: string,
  onProgress?: (phase: string, completed: number, total: number) => void,
): Promise<Map<string, { email: string; provider: Provider; cost: number } | null>> {
  if (contacts.length === 0) return new Map();

  // Route to batch mode for larger lists
  if (contacts.length > BATCH_THRESHOLD) {
    logger.info('Routing to batch waterfall mode', {
      jobId,
      contactCount: contacts.length,
    });

    const batchSummary = await enrichEmailsBatchWaterfall(contacts, {
      jobId,
      onProgress,
    });

    // Convert BatchContactResult to the expected return format
    const results = new Map<string, { email: string; provider: Provider; cost: number } | null>();

    for (const [contactId, batchResult] of batchSummary.results) {
      if (batchResult.email && batchResult.provider) {
        results.set(contactId, {
          email: batchResult.email,
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
  logger.info('Using sequential waterfall mode', {
    jobId,
    contactCount: contacts.length,
  });

  const results = new Map<string, { email: string; provider: Provider; cost: number } | null>();

  for (const contact of contacts) {
    const result = await enrichEmail(contact, jobId);
    results.set(contact.id, result);
  }

  return results;
}
