/**
 * AI Ark phone enrichment for waterfall (Feature 27, US3).
 *
 * Uses AI Ark Mobile Phone Finder API for synchronous phone lookup.
 * Supports batch processing via ConcurrencyPool.
 */

import logger from '../../lib/logger.js';
import { mobilePhoneFinder } from './client.js';
import { ConcurrencyPool } from '../../lib/concurrencyPool.js';
import { aiArkConfig } from '../../config/providers.js';
import type { EnrichmentContact } from '../../types/providers.js';

/**
 * Enrich a single contact's phone using AI Ark Mobile Phone Finder.
 *
 * @param contact - Contact to enrich.
 * @returns Phone number if found, null otherwise.
 */
export async function enrichPhoneWithAIArk(
  contact: EnrichmentContact,
): Promise<string | null> {
  try {
    if (!contact.linkedinUrl && !contact.domain) {
      logger.debug('AI Ark phone: skipping, no LinkedIn URL or domain', {
        contactId: contact.id,
      });
      return null;
    }

    logger.debug('Attempting AI Ark phone enrichment', {
      contactId: contact.id,
      linkedinUrl: contact.linkedinUrl,
      domain: contact.domain,
    });

    // Build full name for AI Ark 'name' field (domain+name search)
    const name =
      contact.firstName && contact.lastName
        ? `${contact.firstName} ${contact.lastName}`
        : contact.fullName || undefined;

    const result = await mobilePhoneFinder({
      linkedin: contact.linkedinUrl,
      domain: contact.domain,
      name,
    });

    if (result.phone_number) {
      logger.info('AI Ark phone found', {
        contactId: contact.id,
        type: result.type,
        confidence: result.confidence_score,
      });
      return result.phone_number;
    }

    logger.debug('AI Ark did not find phone', {
      contactId: contact.id,
      error: result.error,
    });
    return null;
  } catch (error) {
    logger.warn('AI Ark phone enrichment failed', {
      contactId: contact.id,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Batch enrich phones via concurrent AI Ark Mobile Phone Finder calls.
 *
 * @param contacts - Contacts to enrich.
 * @param onProgress - Optional progress callback.
 * @returns Map of contactId -> phone (null for not found).
 */
export async function enrichPhonesWithAIArkBatch(
  contacts: EnrichmentContact[],
  onProgress?: (completed: number, total: number) => void,
): Promise<Map<string, string | null>> {
  const results = new Map<string, string | null>();
  if (contacts.length === 0) return results;

  const pool = new ConcurrencyPool({
    maxConcurrent: 5,
    maxPerSecond: aiArkConfig.rateLimit.requestsPerSecond,
    name: 'aiark-phone',
  });

  const tasks = contacts.map((contact) => async () => {
    const phone = await enrichPhoneWithAIArk(contact);
    return { contactId: contact.id, phone };
  });

  const poolResults = await pool.executeAll(tasks, onProgress);

  for (const taskResult of poolResults) {
    const contact = contacts[taskResult.index]!;
    if (taskResult.result) {
      results.set(contact.id, taskResult.result.phone);
    } else {
      results.set(contact.id, null);
    }
  }

  return results;
}
