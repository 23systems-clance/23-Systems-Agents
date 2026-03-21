/**
 * Apollo phone enrichment for waterfall (Feature 27).
 *
 * Uses Apollo `/v1/people/match` API with `reveal_phone_number: true`
 * to find a person's phone number directly from the match response.
 * Prefers mobile numbers, falls back to work/direct types.
 */

import logger from '../../lib/logger.js';
import { post } from './client.js';
import { ConcurrencyPool } from '../../lib/concurrencyPool.js';
import { apolloConfig } from '../../config/providers.js';
import type { EnrichmentContact } from '../../types/providers.js';

/**
 * Subset of the Apollo people/match response for phone extraction.
 */
interface PeopleMatchPhoneResponse {
  person?: {
    phone_numbers?: Array<{
      raw_number?: string;
      sanitized_number?: string;
      type?: string;
    }>;
  };
}

/**
 * Enrich phone using Apollo people/match API with reveal_phone_number.
 *
 * Matches a person by first_name + last_name + domain (or organization_name)
 * and extracts phone numbers from the response. Prefers mobile type.
 *
 * @param contact - Contact to enrich (needs name + domain or companyName).
 * @returns Phone number if found, null otherwise.
 */
export async function enrichPhoneWithApollo(
  contact: EnrichmentContact,
): Promise<string | null> {
  try {
    if (!contact.domain && !contact.companyName) {
      logger.debug('Apollo phone enrichment skipped: no domain or company', {
        contactId: contact.id,
      });
      return null;
    }

    const contactName = contact.fullName ?? `${contact.firstName ?? ''} ${contact.lastName ?? ''}`.trim();
    if (!contactName) {
      logger.debug('Apollo phone enrichment skipped: no name', {
        contactId: contact.id,
      });
      return null;
    }

    logger.debug('Attempting Apollo phone enrichment via people/match', {
      contactId: contact.id,
      domain: contact.domain,
      name: contactName,
    });

    // Build request body for /v1/people/match with phone reveal
    const body: Record<string, unknown> = {
      reveal_phone_number: true,
    };
    if (contact.firstName) body.first_name = contact.firstName;
    if (contact.lastName) body.last_name = contact.lastName;
    if (contact.domain) body.domain = contact.domain;
    if (contact.companyName) body.organization_name = contact.companyName;
    if (contact.linkedinUrl) body.linkedin_url = contact.linkedinUrl;

    const { data } = await post<PeopleMatchPhoneResponse>('/v1/people/match', body);

    const phones = data.person?.phone_numbers;
    if (phones && phones.length > 0) {
      // Prefer mobile type, fall back to first available
      const mobile = phones.find((p) => p.type === 'mobile');
      const best = mobile ?? phones[0]!;
      const number = best.sanitized_number ?? best.raw_number;

      if (number) {
        logger.info('Apollo phone found via people/match', {
          contactId: contact.id,
          type: best.type,
          phoneCount: phones.length,
        });
        return number;
      }
    }

    logger.debug('Apollo did not find phone via people/match', {
      contactId: contact.id,
    });
    return null;
  } catch (error) {
    logger.warn('Apollo phone enrichment failed', {
      contactId: contact.id,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error; // Let waterfall handle the failure
  }
}

/**
 * Batch enrich phones via concurrent Apollo people/match calls.
 *
 * Uses ConcurrencyPool to run multiple people/match requests in parallel
 * while respecting Apollo's rate limit (10 RPS from provider config).
 *
 * @param contacts - Contacts to enrich.
 * @param onProgress - Optional progress callback.
 * @returns Map of contactId -> phone (null for not found).
 */
export async function enrichPhonesWithApolloBatch(
  contacts: EnrichmentContact[],
  onProgress?: (completed: number, total: number) => void,
): Promise<Map<string, string | null>> {
  const results = new Map<string, string | null>();
  if (contacts.length === 0) return results;

  const pool = new ConcurrencyPool({
    maxConcurrent: apolloConfig.rateLimit.requestsPerSecond,
    maxPerSecond: apolloConfig.rateLimit.requestsPerSecond,
    name: 'apollo-phone',
  });

  const tasks = contacts.map((contact) => async () => {
    const phone = await enrichPhoneWithApollo(contact);
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
