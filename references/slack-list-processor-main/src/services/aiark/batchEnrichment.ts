/**
 * AI Ark batch email enrichment for waterfall (Feature 27).
 *
 * Uses the AI Ark Email Finder API for batch email enrichment:
 * - POST /v1/people/email-finder - Submit contacts for email lookup
 * - GET /v1/people/email-finder/{trackId}/statistics - Poll for completion
 * - GET /v1/people/email-finder/{trackId}/inquiries - Fetch results
 *
 * Supports up to 10,000 contacts per batch request.
 */

import logger from '../../lib/logger.js';
import { getAuthHeader } from '../../config/providers.js';
import { aiArkConfig } from '../../config/providers.js';
import type { EnrichmentContact } from '../../types/providers.js';

const AI_ARK_BASE_URL = aiArkConfig.api.baseUrl;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 2000;

/** Default timeout for batch job completion polling (2 minutes). */
const DEFAULT_TIMEOUT_MS = 120_000;

/** Polling interval for checking batch job status (5 seconds). */
const POLL_INTERVAL_MS = 5000;

/** Maximum contacts per AI Ark email-finder request. */
const MAX_BATCH_SIZE = 10_000;

interface EmailFinderContact {
  first_name: string;
  last_name: string;
  domain: string;
}

interface EmailFinderSubmitResponse {
  track_id: string;
  status: string;
  total_inquiries: number;
}

interface EmailFinderStatistics {
  track_id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  total_inquiries: number;
  completed_inquiries: number;
  failed_inquiries: number;
}

interface EmailFinderInquiry {
  first_name: string;
  last_name: string;
  domain: string;
  email?: string;
  email_status?: string;
  confidence_score?: number;
}

interface EmailFinderResultsResponse {
  track_id: string;
  inquiries: EmailFinderInquiry[];
  total: number;
  page: number;
  per_page: number;
}

/**
 * Batch enrich emails via AI Ark Email Finder API.
 *
 * Submits all contacts in a single batch request, polls for completion,
 * then fetches results. AI Ark handles the concurrency internally.
 *
 * @param contacts - Contacts to enrich (failures from previous waterfall providers).
 * @param timeoutMs - Max time to wait for batch completion (default 120s).
 * @returns Map of contactId -> email (null for not found).
 */
export async function enrichEmailsWithAIArkBatch(
  contacts: EnrichmentContact[],
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<Map<string, string | null>> {
  const results = new Map<string, string | null>();
  if (contacts.length === 0) return results;

  if (contacts.length > MAX_BATCH_SIZE) {
    logger.warn('AI Ark batch: contact count exceeds max batch size, truncating', {
      contactCount: contacts.length,
      maxBatchSize: MAX_BATCH_SIZE,
    });
  }

  // Build contact-to-key mapping for matching results back to contacts
  const contactKeyMap = new Map<string, string>(); // key -> contactId
  const batchContacts: EmailFinderContact[] = [];

  for (const contact of contacts.slice(0, MAX_BATCH_SIZE)) {
    const firstName = contact.firstName || contact.fullName?.split(' ')[0] || '';
    const lastName = contact.lastName || contact.fullName?.split(' ').slice(1).join(' ') || '';
    const domain = contact.domain || '';

    if (!firstName || !domain) {
      logger.debug('AI Ark batch: skipping contact with missing data', {
        contactId: contact.id,
        hasFirstName: !!firstName,
        hasDomain: !!domain,
      });
      results.set(contact.id, null);
      continue;
    }

    // Key for matching results back to contacts
    const key = `${firstName.toLowerCase()}:${lastName.toLowerCase()}:${domain.toLowerCase()}`;
    contactKeyMap.set(key, contact.id);

    batchContacts.push({
      first_name: firstName,
      last_name: lastName,
      domain,
    });
  }

  if (batchContacts.length === 0) {
    return results;
  }

  try {
    // Step 1: Submit batch
    logger.info('AI Ark batch: submitting email finder request', {
      contactCount: batchContacts.length,
    });

    const submitResponse = await submitEmailFinderBatch(batchContacts);
    const trackId = submitResponse.track_id;

    logger.info('AI Ark batch: submitted successfully', {
      trackId,
      totalInquiries: submitResponse.total_inquiries,
    });

    // Step 2: Poll for completion
    const stats = await pollForCompletion(trackId, timeoutMs);

    if (stats.status === 'failed') {
      logger.error('AI Ark batch: job failed', { trackId, stats });
      // Set all contacts to null
      for (const contact of contacts) {
        if (!results.has(contact.id)) {
          results.set(contact.id, null);
        }
      }
      return results;
    }

    // Step 3: Fetch results
    const inquiries = await fetchAllResults(trackId);

    logger.info('AI Ark batch: results fetched', {
      trackId,
      totalResults: inquiries.length,
      withEmails: inquiries.filter((i) => i.email).length,
    });

    // Step 4: Match results back to contacts
    for (const inquiry of inquiries) {
      const key = `${inquiry.first_name.toLowerCase()}:${inquiry.last_name.toLowerCase()}:${inquiry.domain.toLowerCase()}`;
      const contactId = contactKeyMap.get(key);

      if (contactId) {
        results.set(contactId, inquiry.email || null);
      }
    }

    // Set null for any contacts not in results
    for (const contact of contacts) {
      if (!results.has(contact.id)) {
        results.set(contact.id, null);
      }
    }

    return results;
  } catch (error) {
    logger.error('AI Ark batch: enrichment failed', {
      contactCount: batchContacts.length,
      error: error instanceof Error ? error.message : String(error),
    });

    // Set all contacts to null on failure
    for (const contact of contacts) {
      if (!results.has(contact.id)) {
        results.set(contact.id, null);
      }
    }

    return results;
  }
}

/**
 * Submit contacts for email enrichment via AI Ark Email Finder API.
 *
 * @param contacts - Contacts to submit.
 * @returns Submit response with track_id.
 */
async function submitEmailFinderBatch(
  contacts: EmailFinderContact[],
): Promise<EmailFinderSubmitResponse> {
  const authHeader = getAuthHeader('AI_ARK');

  return await callWithRetry(`${AI_ARK_BASE_URL}/people/email-finder`, {
    method: 'POST',
    headers: {
      [authHeader.name]: authHeader.value,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ contacts }),
  });
}

/**
 * Poll for batch job completion.
 *
 * @param trackId - Batch job tracking ID.
 * @param timeoutMs - Maximum time to wait.
 * @returns Final statistics when completed or timeout reached.
 */
async function pollForCompletion(
  trackId: string,
  timeoutMs: number,
): Promise<EmailFinderStatistics> {
  const authHeader = getAuthHeader('AI_ARK');
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    const stats: EmailFinderStatistics = await callWithRetry(
      `${AI_ARK_BASE_URL}/people/email-finder/${trackId}/statistics`,
      {
        method: 'GET',
        headers: {
          [authHeader.name]: authHeader.value,
          'Content-Type': 'application/json',
        },
      },
    );

    logger.debug('AI Ark batch: polling status', {
      trackId,
      status: stats.status,
      completed: stats.completed_inquiries,
      total: stats.total_inquiries,
    });

    if (stats.status === 'completed' || stats.status === 'failed') {
      return stats;
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  logger.warn('AI Ark batch: polling timed out', { trackId, timeoutMs });

  // Return last known state on timeout
  return {
    track_id: trackId,
    status: 'failed',
    total_inquiries: 0,
    completed_inquiries: 0,
    failed_inquiries: 0,
  };
}

/**
 * Fetch all results from a completed batch job with pagination.
 *
 * @param trackId - Batch job tracking ID.
 * @returns All inquiry results.
 */
async function fetchAllResults(trackId: string): Promise<EmailFinderInquiry[]> {
  const authHeader = getAuthHeader('AI_ARK');
  const allInquiries: EmailFinderInquiry[] = [];
  let page = 1;
  const perPage = 100;

  while (true) {
    const response: EmailFinderResultsResponse = await callWithRetry(
      `${AI_ARK_BASE_URL}/people/email-finder/${trackId}/inquiries?page=${page}&per_page=${perPage}`,
      {
        method: 'GET',
        headers: {
          [authHeader.name]: authHeader.value,
          'Content-Type': 'application/json',
        },
      },
    );

    allInquiries.push(...response.inquiries);

    if (allInquiries.length >= response.total || response.inquiries.length < perPage) {
      break;
    }

    page++;
  }

  return allInquiries;
}

/**
 * Call AI Ark API with exponential backoff retry for rate limits and server errors.
 *
 * @param url - API endpoint URL.
 * @param options - Fetch options.
 * @param attempt - Current attempt number.
 * @returns Parsed JSON response.
 */
async function callWithRetry(
  url: string,
  options: RequestInit,
  attempt: number = 1,
): Promise<any> {
  try {
    const response = await fetch(url, options);

    if (response.status === 429) {
      if (attempt >= MAX_RETRIES) {
        throw new Error(`AI Ark rate limit exceeded after ${MAX_RETRIES} retries`);
      }

      const delay = Math.pow(2, attempt - 1) * RETRY_DELAY_MS;
      logger.warn('AI Ark batch: rate limit hit, retrying', { attempt, delayMs: delay });
      await new Promise((resolve) => setTimeout(resolve, delay));
      return await callWithRetry(url, options, attempt + 1);
    }

    if (response.status >= 500) {
      if (attempt >= MAX_RETRIES) {
        throw new Error(`AI Ark server error (${response.status}) after ${MAX_RETRIES} retries`);
      }

      const delay = Math.pow(2, attempt - 1) * RETRY_DELAY_MS;
      logger.warn('AI Ark batch: server error, retrying', {
        status: response.status,
        attempt,
        delayMs: delay,
      });
      await new Promise((resolve) => setTimeout(resolve, delay));
      return await callWithRetry(url, options, attempt + 1);
    }

    if (!response.ok) {
      const errorBody = await response.json().catch(() => null);
      throw new Error(
        `AI Ark API error: ${response.status} ${response.statusText} - ${JSON.stringify(errorBody)}`,
      );
    }

    return await response.json();
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.includes('rate limit') || error.message.includes('server error'))
    ) {
      throw error;
    }

    if (attempt < MAX_RETRIES && error instanceof TypeError) {
      // Network error, retry
      const delay = Math.pow(2, attempt - 1) * RETRY_DELAY_MS;
      logger.warn('AI Ark batch: network error, retrying', { attempt, delayMs: delay });
      await new Promise((resolve) => setTimeout(resolve, delay));
      return await callWithRetry(url, options, attempt + 1);
    }

    throw error;
  }
}
