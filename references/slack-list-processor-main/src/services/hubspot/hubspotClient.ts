/**
 * HubSpot API client for fetching contacts from lists.
 *
 * Uses HubSpot CRM API v3 with private app access token authentication.
 * Handles pagination and rate limiting with exponential backoff.
 */

import { config } from '../../config/index.js';
import { CircuitBreaker } from '../../lib/circuitBreaker.js';
import logger from '../../lib/logger.js';
import type {
  HubSpotContact,
  HubSpotPaginatedResponse,
  HubSpotListMembershipsResponse,
} from './types.js';

const BASE_URL = 'https://api.hubapi.com';

/** Contact properties to fetch from HubSpot. */
const CONTACT_PROPERTIES = [
  'firstname',
  'lastname',
  'email',
  'mobilephone',
  'phone',
  'hs_linkedin_url',
  'company',
  'jobtitle',
  'hs_email_status',
  'hs_email_bounce',
  'donotcall',
].join(',');

const circuitBreaker = new CircuitBreaker({
  name: 'HubSpot',
  failureThreshold: 5,
  resetTimeoutMs: 60_000,
});

/**
 * Makes an authenticated request to the HubSpot API.
 * Handles 429 rate limiting with retry.
 */
async function hubspotFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const url = `${BASE_URL}${path}`;

  return circuitBreaker.execute(async () => {
    let attempts = 0;
    const maxAttempts = 3;

    while (attempts < maxAttempts) {
      const response = await fetch(url, {
        ...options,
        headers: {
          Authorization: `Bearer ${config.hubspot.apiKey}`,
          'Content-Type': 'application/json',
          ...options?.headers,
        },
      });

      if (response.status === 429) {
        attempts++;
        const retryAfter = response.headers.get('Retry-After');
        const delay = retryAfter ? Number(retryAfter) * 1000 : 1000 * Math.pow(2, attempts);
        logger.warn('HubSpot rate limited, retrying', { attempts, delay });
        await sleep(delay);
        continue;
      }

      if (!response.ok) {
        const body = await response.text();
        throw new Error(`HubSpot API error ${response.status}: ${body}`);
      }

      return (await response.json()) as T;
    }

    throw new Error('HubSpot API: max retry attempts exceeded');
  });
}

/**
 * Fetches all contact IDs from a HubSpot list using the Lists API.
 * Handles pagination via the `after` cursor.
 */
async function getListMemberIds(listId: string): Promise<string[]> {
  const memberIds: string[] = [];
  let after: string | undefined;

  do {
    const query = after ? `?after=${after}` : '';
    const response = await hubspotFetch<HubSpotListMembershipsResponse>(
      `/crm/v3/lists/${listId}/memberships/join-order${query}`,
    );

    for (const member of response.results) {
      memberIds.push(member.recordId);
    }

    after = response.paging?.next?.after;
  } while (after);

  logger.info('Fetched HubSpot list member IDs', { listId, count: memberIds.length });
  return memberIds;
}

/**
 * Fetches contact details by IDs in batches of 100 (HubSpot batch limit).
 */
async function getContactsByIds(contactIds: string[]): Promise<HubSpotContact[]> {
  const contacts: HubSpotContact[] = [];
  const batchSize = 100;

  for (let i = 0; i < contactIds.length; i += batchSize) {
    const batch = contactIds.slice(i, i + batchSize);

    const response = await hubspotFetch<HubSpotPaginatedResponse<HubSpotContact>>(
      '/crm/v3/objects/contacts/batch/read',
      {
        method: 'POST',
        body: JSON.stringify({
          properties: CONTACT_PROPERTIES.split(','),
          inputs: batch.map((id) => ({ id })),
        }),
      },
    );

    contacts.push(...response.results);

    logger.debug('Fetched HubSpot contact batch', {
      batchIndex: Math.floor(i / batchSize) + 1,
      batchSize: response.results.length,
      total: contacts.length,
    });
  }

  return contacts;
}

/**
 * Fetches all contacts from a HubSpot list by list ID.
 *
 * 1. Gets all member contact IDs via the Lists API
 * 2. Batch-fetches contact details with required properties
 *
 * @param listId - HubSpot list ID (ILS list ID)
 * @returns Array of HubSpot contacts with properties
 */
export async function getContactsFromList(listId: string): Promise<HubSpotContact[]> {
  logger.info('Importing contacts from HubSpot list', { listId });

  const memberIds = await getListMemberIds(listId);

  if (memberIds.length === 0) {
    logger.warn('HubSpot list is empty', { listId });
    return [];
  }

  const contacts = await getContactsByIds(memberIds);

  logger.info('HubSpot contact import complete', {
    listId,
    memberIds: memberIds.length,
    contactsFetched: contacts.length,
  });

  return contacts;
}

/**
 * Fetches a single contact by HubSpot contact ID.
 */
export async function getContact(contactId: string): Promise<HubSpotContact> {
  return hubspotFetch<HubSpotContact>(
    `/crm/v3/objects/contacts/${contactId}?properties=${CONTACT_PROPERTIES}`,
  );
}

/**
 * Builds a direct link to a HubSpot contact record.
 *
 * @param hubspotContactId - HubSpot contact ID
 * @param portalId - HubSpot portal ID (per-client). Falls back to global config if not provided.
 */
export function buildHubSpotContactLink(hubspotContactId: string, portalId?: string): string {
  const portal = portalId || config.hubspot.portalId;
  return `https://app.hubspot.com/contacts/${portal}/contact/${hubspotContactId}`;
}

/**
 * Searches for existing contacts by email addresses using the CRM search API.
 * Used by identity resolution to find duplicates before sync.
 *
 * @param emails - Array of email addresses to search for.
 * @returns Array of matching HubSpot contacts.
 */
export async function searchContactsByEmail(emails: string[]): Promise<HubSpotContact[]> {
  if (emails.length === 0) return [];

  const contacts: HubSpotContact[] = [];
  const batchSize = 50; // CRM search supports up to 100 filters, use 50 for safety

  for (let i = 0; i < emails.length; i += batchSize) {
    const batch = emails.slice(i, i + batchSize);
    const response = await hubspotFetch<HubSpotPaginatedResponse<HubSpotContact>>(
      '/crm/v3/objects/contacts/search',
      {
        method: 'POST',
        body: JSON.stringify({
          filterGroups: batch.map((email) => ({
            filters: [{ propertyName: 'email', operator: 'EQ', value: email }],
          })),
          properties: CONTACT_PROPERTIES.split(','),
          limit: 100,
        }),
      },
    );
    contacts.push(...response.results);
  }

  logger.info('HubSpot contact search by email complete', { searched: emails.length, found: contacts.length });
  return contacts;
}

/**
 * Searches for companies by domain using the CRM search API.
 *
 * @param domains - Array of company domains to search for.
 * @returns Array of matching company records.
 */
export async function searchCompaniesByDomain(
  domains: string[],
): Promise<Array<{ id: string; properties: Record<string, string> }>> {
  if (domains.length === 0) return [];

  const companies: Array<{ id: string; properties: Record<string, string> }> = [];
  const batchSize = 50;

  for (let i = 0; i < domains.length; i += batchSize) {
    const batch = domains.slice(i, i + batchSize);
    const response = await hubspotFetch<HubSpotPaginatedResponse<{ id: string; properties: Record<string, string> }>>(
      '/crm/v3/objects/companies/search',
      {
        method: 'POST',
        body: JSON.stringify({
          filterGroups: batch.map((domain) => ({
            filters: [{ propertyName: 'domain', operator: 'EQ', value: domain }],
          })),
          properties: ['name', 'domain', 'website'],
          limit: 100,
        }),
      },
    );
    companies.push(...response.results);
  }

  logger.info('HubSpot company search by domain complete', { searched: domains.length, found: companies.length });
  return companies;
}

/**
 * Batch-creates contacts in HubSpot (max 100 per batch).
 *
 * @param contacts - Array of property objects to create as contacts.
 * @returns Array of created contact records.
 */
export async function batchCreateContacts(
  contacts: Record<string, unknown>[],
): Promise<HubSpotContact[]> {
  const created: HubSpotContact[] = [];
  const batchSize = 100;

  for (let i = 0; i < contacts.length; i += batchSize) {
    const batch = contacts.slice(i, i + batchSize);
    const response = await hubspotFetch<HubSpotPaginatedResponse<HubSpotContact>>(
      '/crm/v3/objects/contacts/batch/create',
      {
        method: 'POST',
        body: JSON.stringify({
          inputs: batch.map((properties) => ({ properties })),
        }),
      },
    );
    created.push(...response.results);

    logger.debug('HubSpot batch create contacts', {
      batchIndex: Math.floor(i / batchSize) + 1,
      batchSize: response.results.length,
    });
  }

  logger.info('HubSpot batch contact creation complete', { requested: contacts.length, created: created.length });
  return created;
}

/**
 * Batch-updates existing contacts in HubSpot by ID (max 100 per batch).
 *
 * @param updates - Array of { hubspotId, data } pairs.
 * @returns Array of updated contact records.
 */
export async function batchUpdateContacts(
  updates: Array<{ hubspotId: string; data: Record<string, unknown> }>,
): Promise<HubSpotContact[]> {
  const updated: HubSpotContact[] = [];
  const batchSize = 100;

  for (let i = 0; i < updates.length; i += batchSize) {
    const batch = updates.slice(i, i + batchSize);
    const response = await hubspotFetch<HubSpotPaginatedResponse<HubSpotContact>>(
      '/crm/v3/objects/contacts/batch/update',
      {
        method: 'POST',
        body: JSON.stringify({
          inputs: batch.map((u) => ({ id: u.hubspotId, properties: u.data })),
        }),
      },
    );
    updated.push(...response.results);

    logger.debug('HubSpot batch update contacts', {
      batchIndex: Math.floor(i / batchSize) + 1,
      batchSize: response.results.length,
    });
  }

  logger.info('HubSpot batch contact update complete', { requested: updates.length, updated: updated.length });
  return updated;
}

/**
 * Idempotently ensures custom contact properties exist in HubSpot.
 * Checks for existence first, creates only missing ones.
 *
 * @param properties - Array of property definitions to ensure exist.
 */
export async function ensureCustomProperties(
  properties: Array<{ name: string; label: string; type: string; fieldType: string; groupName: string }>,
): Promise<void> {
  // Get existing properties
  const existing = await hubspotFetch<{ results: Array<{ name: string }> }>(
    '/crm/v3/properties/contacts',
    { method: 'GET' },
  );

  const existingNames = new Set(existing.results.map((p) => p.name));
  const missing = properties.filter((p) => !existingNames.has(p.name));

  for (const prop of missing) {
    try {
      await hubspotFetch('/crm/v3/properties/contacts', {
        method: 'POST',
        body: JSON.stringify(prop),
      });
      logger.debug('HubSpot custom property created', { name: prop.name });
    } catch (err) {
      // Property might have been created between check and create
      logger.warn('Failed to create HubSpot property (may already exist)', {
        name: prop.name,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (missing.length > 0) {
    logger.info('HubSpot custom properties ensured', { created: missing.length, total: properties.length });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
