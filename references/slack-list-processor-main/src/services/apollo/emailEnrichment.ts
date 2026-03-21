/**
 * Apollo email enrichment for waterfall (Feature 27, US1).
 *
 * Uses Apollo `/v1/people/match` API to find a person by name + domain
 * and return their email. This is the same endpoint used by peopleEnrich.ts
 * for phone reveals, but here we only need the email from the match response.
 */

import logger from '../../lib/logger.js';
import { post } from './client.js';
import { ConcurrencyPool } from '../../lib/concurrencyPool.js';
import { apolloConfig } from '../../config/providers.js';
import type { EnrichmentContact } from '../../types/providers.js';

/**
 * Subset of the Apollo people/match response we need for email extraction.
 */
interface PeopleMatchResponse {
  person?: {
    email?: string;
    first_name?: string;
    last_name?: string;
  };
}

/**
 * Enrich email using Apollo people/match API.
 *
 * Matches a person by first_name + last_name + domain (or organization_name)
 * and returns the email from the matched profile.
 *
 * @param contact - Contact to enrich (needs name + domain or companyName)
 * @returns Email if found, null otherwise
 */
export async function enrichEmailWithApollo(
  contact: EnrichmentContact,
): Promise<string | null> {
  try {
    if (!contact.domain && !contact.companyName) {
      logger.debug('Apollo email enrichment skipped: no domain or company', {
        contactId: contact.id,
      });
      return null;
    }

    const contactName = contact.fullName ?? `${contact.firstName ?? ''} ${contact.lastName ?? ''}`.trim();
    if (!contactName) {
      logger.debug('Apollo email enrichment skipped: no name', {
        contactId: contact.id,
      });
      return null;
    }

    logger.debug('Attempting Apollo email enrichment via people/match', {
      contactId: contact.id,
      domain: contact.domain,
      name: contactName,
    });

    // Build request body for /v1/people/match
    const body: Record<string, unknown> = {};
    if (contact.firstName) body.first_name = contact.firstName;
    if (contact.lastName) body.last_name = contact.lastName;
    if (contact.domain) body.domain = contact.domain;
    if (contact.companyName) body.organization_name = contact.companyName;
    if (contact.linkedinUrl) body.linkedin_url = contact.linkedinUrl;

    const { data } = await post<PeopleMatchResponse>('/v1/people/match', body);

    if (data.person?.email) {
      logger.info('Apollo email found via people/match', {
        contactId: contact.id,
        email: data.person.email,
      });
      return data.person.email;
    }

    logger.debug('Apollo did not find email via people/match', {
      contactId: contact.id,
    });
    return null;
  } catch (error) {
    logger.warn('Apollo email enrichment failed', {
      contactId: contact.id,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error; // Let waterfall handle the failure
  }
}

/**
 * Batch enrich emails via concurrent Apollo people/match calls.
 *
 * Uses ConcurrencyPool to run multiple people/match requests in parallel
 * while respecting Apollo's rate limit (10 RPS from provider config).
 *
 * @param contacts - Contacts to enrich.
 * @param onProgress - Optional progress callback.
 * @returns Map of contactId -> email (null for not found).
 */
export async function enrichEmailsWithApolloBatch(
  contacts: EnrichmentContact[],
  onProgress?: (completed: number, total: number) => void,
): Promise<Map<string, string | null>> {
  const results = new Map<string, string | null>();
  if (contacts.length === 0) return results;

  const pool = new ConcurrencyPool({
    maxConcurrent: apolloConfig.rateLimit.requestsPerSecond,
    maxPerSecond: apolloConfig.rateLimit.requestsPerSecond,
    name: 'apollo-email',
  });

  const tasks = contacts.map((contact) => async () => {
    const email = await enrichEmailWithApollo(contact);
    return { contactId: contact.id, email };
  });

  const poolResults = await pool.executeAll(tasks, onProgress);

  for (const taskResult of poolResults) {
    const contact = contacts[taskResult.index]!;
    if (taskResult.result) {
      results.set(contact.id, taskResult.result.email);
    } else {
      results.set(contact.id, null);
    }
  }

  return results;
}
