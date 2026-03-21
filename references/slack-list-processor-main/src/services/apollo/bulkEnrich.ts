/**
 * Bulk people enrichment via Apollo.io's bulk_match and people/match endpoints.
 *
 * Two enrichment paths:
 * 1. Contacts WITH emails → batched via `/v1/people/bulk_match` (10 per call)
 * 2. Contacts with ONLY Apollo person IDs → individual `/v1/people/match`
 *    calls via ConcurrencyPool (bulk_match doesn't support ID-only matching)
 *
 * Each person costs 1 Apollo credit. Returns full contact data
 * (real names, emails, LinkedIn URLs, organization info) and
 * persists enrichment results back to JobContact records.
 *
 * When `revealPhone` is true, phone reveal is requested and
 * `PendingPhoneLookup` records are created for webhook correlation.
 *
 * Partial failures within a batch are handled gracefully -- contacts
 * that fail do not block the rest of the batch.
 */

import { randomUUID } from 'node:crypto';
import { post } from './client.js';
import { config } from '../../config/index.js';
import { prisma } from '../../models/index.js';
import { getTimezone } from '../../data/timezoneMap.js';
import { ConcurrencyPool } from '../../lib/concurrencyPool.js';
import { apolloConfig } from '../../config/providers.js';
import logger from '../../lib/logger.js';

// ---------------------------------------------------------------------------
// Internal types (raw Apollo response shape)
// ---------------------------------------------------------------------------

/** Organization data inside a bulk_match person record. */
interface BulkMatchOrganization {
  name?: string;
  website_url?: string;
}

/** A single match result inside the bulk_match response. */
interface BulkMatchEntry {
  id?: string;
  request_id?: string;
  first_name?: string;
  last_name?: string;
  name?: string;
  email?: string;
  title?: string;
  seniority?: string;
  linkedin_url?: string;
  city?: string;
  state?: string;
  country?: string;
  organization?: BulkMatchOrganization;
  phone_numbers?: Array<{ raw_number?: string; sanitized_number?: string; type?: string }>;
  error?: string;
}

/** Top-level shape of the Apollo people/bulk_match response. */
interface BulkMatchResponse {
  matches?: BulkMatchEntry[];
}

/** Top-level shape of the Apollo people/match (single-person) response. */
interface PeopleMatchResponse {
  person?: BulkMatchEntry;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum contacts per Apollo bulk_match API call. */
const BATCH_SIZE = 10;

/** How long to wait for the async phone webhook before considering it timed out. */
const PHONE_LOOKUP_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Input contact descriptor passed by the caller. */
interface ContactInput {
  /** Apollo person ID (from api_search) -- used for people/match lookup. */
  apolloPersonId?: string;
  /** Email address -- used for bulk_match when available. */
  email?: string;
  jobContactId: string;
}

/** Options for bulk enrichment. */
interface BulkEnrichOptions {
  /** Whether to request phone number reveal (costs +1 credit/contact). */
  revealPhone?: boolean;
}

/**
 * Applies enrichment data from an Apollo match result to a JobContact record.
 *
 * Shared by both bulk_match and people/match paths to ensure consistent
 * data mapping regardless of which endpoint returned the data.
 *
 * @param match     - Apollo person data (same shape from both endpoints).
 * @param contact   - The contact input with jobContactId for DB update.
 * @param jobId     - Parent job UUID for logging.
 * @param revealPhone - Whether phone reveal was requested.
 * @returns Object with requestId and pending phone record (if applicable).
 */
async function applyMatchToContact(
  match: BulkMatchEntry,
  contact: ContactInput,
  jobId: string,
  revealPhone: boolean,
): Promise<{
  requestId: string;
  pendingRecord?: {
    apolloRequestId: string;
    jobContactId: string;
    jobId: string;
    status: 'PENDING';
    expiresAt: Date;
  };
}> {
  const requestId = match.request_id ?? randomUUID();

  // Build update payload from match data
  const updateData: Record<string, unknown> = {};

  if (match.first_name) updateData.firstName = match.first_name;
  if (match.last_name) updateData.lastName = match.last_name;
  if (match.name) updateData.fullName = match.name;
  if (match.email) updateData.email = match.email;
  if (match.title) updateData.jobTitle = match.title;
  if (match.seniority) updateData.seniorityLevel = match.seniority;
  if (match.linkedin_url) updateData.linkedinUrl = match.linkedin_url;
  if (match.id) updateData.apolloPersonId = match.id;

  // Extract phone numbers from immediate response
  if (match.phone_numbers?.length) {
    const mobile = match.phone_numbers.find((p) => p.type === 'mobile');
    const direct = mobile ?? match.phone_numbers[0];
    if (direct?.sanitized_number || direct?.raw_number) {
      updateData.directPhone = direct.sanitized_number ?? direct.raw_number;
      updateData.phoneSource = 'APOLLO';
    }
    const work = match.phone_numbers.find(
      (p) => p.type === 'work' || p.type === 'work_direct',
    );
    if (work && (work.sanitized_number || work.raw_number)) {
      updateData.businessPhone = work.sanitized_number ?? work.raw_number;
    }

    logger.info('Phone numbers extracted from Apollo response', {
      jobId,
      contactId: contact.jobContactId,
      phoneCount: match.phone_numbers.length,
      types: match.phone_numbers.map((p) => p.type).filter(Boolean),
    });
  }

  // Store the full match response as apolloMetadata for extra fields
  updateData.apolloMetadata = match as unknown as import('@prisma/client').Prisma.InputJsonValue;

  // Re-compute timezone from enriched location data (free search has no location)
  if (match.state || match.country) {
    const tz = getTimezone(match.state ?? null, match.country ?? null);
    updateData.timezoneUtc = tz.utcOffset;
    updateData.timezoneLabel = tz.label;
  }

  if (Object.keys(updateData).length > 0) {
    await prisma.jobContact.update({
      where: { id: contact.jobContactId },
      data: updateData,
    });
  }

  // Create PendingPhoneLookup when phone reveal was requested
  let pendingRecord: {
    apolloRequestId: string;
    jobContactId: string;
    jobId: string;
    status: 'PENDING';
    expiresAt: Date;
  } | undefined;

  if (revealPhone) {
    const expiresAt = new Date(Date.now() + PHONE_LOOKUP_TTL_MS);
    pendingRecord = {
      apolloRequestId: requestId,
      jobContactId: contact.jobContactId,
      jobId,
      status: 'PENDING' as const,
      expiresAt,
    };
  }

  return { requestId, pendingRecord };
}

/**
 * Processes a batch of contacts WITH emails via Apollo bulk_match.
 *
 * @param batch   - Contacts in this batch (must have email).
 * @param jobId   - Parent job UUID.
 * @param options - Enrichment options (revealPhone, etc.).
 * @returns Object with request IDs and credits used for this batch.
 */
async function processBatch(
  batch: ContactInput[],
  jobId: string,
  options: BulkEnrichOptions = {},
): Promise<{ requestIds: string[]; creditsUsed: number }> {
  const { revealPhone = false } = options;

  // Build details from email (bulk_match's supported matching field)
  const details = batch.map((c) => {
    if (c.email) return { email: c.email };
    return { email: '' }; // should not happen; filtered upstream
  });

  // Build the request body. Only include phone reveal + webhook when requested.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const requestBody: Record<string, any> = { details };

  if (revealPhone) {
    // Ensure HTTPS — Apollo requires a valid HTTPS webhook URL
    const baseUrl = config.webhookBaseUrl.replace(/^http:\/\//, 'https://');
    const webhookUrl = `${baseUrl}/api/webhooks/apollo/phone-results`;
    requestBody.reveal_phone_number = true;
    requestBody.webhook_url = webhookUrl;
  }

  logger.info('Apollo bulk_match request', {
    jobId,
    batchSize: batch.length,
    revealPhone,
  });

  const { data, creditsUsed } = await post<BulkMatchResponse>(
    '/v1/people/bulk_match',
    requestBody,
  );

  logger.info('Apollo bulk_match response received', {
    jobId,
    matchesCount: data.matches?.length ?? 0,
    creditsUsed,
  });

  const matches = data.matches ?? [];
  const requestIds: string[] = [];
  let batchCredits = creditsUsed;
  const pendingRecords: Array<{
    apolloRequestId: string;
    jobContactId: string;
    jobId: string;
    status: 'PENDING';
    expiresAt: Date;
  }> = [];

  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];

    // Skip entries that Apollo flagged as errors
    if (match?.error) {
      const associatedContact = batch[i];
      logger.warn('Apollo bulk_match entry failed', {
        identifier: associatedContact?.apolloPersonId ?? associatedContact?.email ?? match.email,
        error: match.error,
        jobId,
      });
      continue;
    }

    const associatedContact = batch[i];
    if (!associatedContact || !match) continue;

    const result = await applyMatchToContact(match, associatedContact, jobId, revealPhone);
    requestIds.push(result.requestId);
    if (result.pendingRecord) pendingRecords.push(result.pendingRecord);
  }

  // Bulk-insert pending phone lookup records (only when revealPhone is true)
  if (pendingRecords.length > 0) {
    await prisma.pendingPhoneLookup.createMany({ data: pendingRecords });
  }

  // Default to 1 credit per successfully submitted person when header missing
  if (batchCredits === 0) {
    batchCredits = requestIds.length;
  }

  logger.info('Apollo bulk_match batch complete', {
    jobId,
    batchSize: batch.length,
    successCount: requestIds.length,
    creditsUsed: batchCredits,
    revealPhone,
  });

  return { requestIds, creditsUsed: batchCredits };
}

/**
 * Enriches contacts that have an Apollo person ID but no email via
 * individual `/v1/people/match` calls.
 *
 * Uses ConcurrencyPool for rate-limited parallel execution (10 RPS).
 * The people/match endpoint supports `{ id: apolloPersonId }` matching,
 * which bulk_match does not support.
 *
 * @param contacts    - Contacts with apolloPersonId (no email).
 * @param jobId       - Parent job UUID.
 * @param options     - Enrichment options (revealPhone, etc.).
 * @returns Aggregated request IDs and total credits consumed.
 */
async function processIdOnlyContacts(
  contacts: ContactInput[],
  jobId: string,
  options: BulkEnrichOptions = {},
): Promise<{ requestIds: string[]; creditsUsed: number }> {
  const { revealPhone = false } = options;
  const allRequestIds: string[] = [];
  let totalCredits = 0;
  const pendingRecords: Array<{
    apolloRequestId: string;
    jobContactId: string;
    jobId: string;
    status: 'PENDING';
    expiresAt: Date;
  }> = [];

  logger.info('Apollo people/match enrichment starting for ID-only contacts', {
    jobId,
    contactCount: contacts.length,
    revealPhone,
  });

  const pool = new ConcurrencyPool({
    maxConcurrent: apolloConfig.rateLimit.requestsPerSecond,
    maxPerSecond: apolloConfig.rateLimit.requestsPerSecond,
    name: 'apollo-people-match',
  });

  const tasks = contacts.map((contact) => async () => {
    // Build people/match request with Apollo person ID
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body: Record<string, any> = {
      id: contact.apolloPersonId,
    };

    if (revealPhone) {
      const baseUrl = config.webhookBaseUrl.replace(/^http:\/\//, 'https://');
      body.reveal_phone_number = true;
      body.webhook_url = `${baseUrl}/api/webhooks/apollo/phone-results`;
    }

    const { data, creditsUsed } = await post<PeopleMatchResponse>(
      '/v1/people/match',
      body,
    );

    return { person: data.person ?? null, creditsUsed };
  });

  const results = await pool.executeAll(tasks);

  for (let i = 0; i < results.length; i++) {
    const taskResult = results[i]!;
    const contact = contacts[i]!;

    if (taskResult.error) {
      logger.warn('Apollo people/match failed for contact', {
        jobId,
        apolloPersonId: contact.apolloPersonId,
        error: taskResult.error.message,
      });
      continue;
    }

    const person = taskResult.result?.person;
    if (!person) {
      logger.debug('Apollo people/match returned no person', {
        jobId,
        apolloPersonId: contact.apolloPersonId,
      });
      continue;
    }

    totalCredits += taskResult.result?.creditsUsed ?? 1;

    const applied = await applyMatchToContact(person, contact, jobId, revealPhone);
    allRequestIds.push(applied.requestId);
    if (applied.pendingRecord) pendingRecords.push(applied.pendingRecord);
  }

  // Bulk-insert pending phone lookup records
  if (pendingRecords.length > 0) {
    await prisma.pendingPhoneLookup.createMany({ data: pendingRecords });
  }

  const successCount = allRequestIds.length;
  const failedCount = contacts.length - successCount;

  logger.info('Apollo people/match enrichment complete', {
    jobId,
    total: contacts.length,
    successCount,
    failedCount,
    creditsUsed: totalCredits,
  });

  return { requestIds: allRequestIds, creditsUsed: totalCredits };
}

// ---------------------------------------------------------------------------
// Public function
// ---------------------------------------------------------------------------

/**
 * Enriches multiple contacts via Apollo.
 *
 * Routes contacts to the appropriate endpoint:
 * - Contacts with emails → batched `/v1/people/bulk_match` (10 per call)
 * - Contacts with only Apollo IDs → individual `/v1/people/match` calls
 *   via ConcurrencyPool (bulk_match doesn't support ID-only matching)
 *
 * Full enrichment data (real names, emails, LinkedIn URLs, organization)
 * is persisted back to the corresponding JobContact records.
 *
 * When `revealPhone` is true, phone number reveal is requested (+1 credit
 * per contact) and `PendingPhoneLookup` rows are created for webhook
 * correlation.
 *
 * Partial failures are logged and skipped -- they do not cause the
 * entire operation to fail.
 *
 * @param contacts    - Array of contacts to enrich. Each must have `jobContactId`
 *                       plus either `apolloPersonId` or `email` for matching.
 * @param jobId       - UUID of the parent `Job`.
 * @param revealPhone - Whether to request phone number reveal (default false).
 * @returns Aggregated request IDs and total credits consumed.
 */
export async function bulkEnrichPeople(
  contacts: Array<{ apolloPersonId?: string; email?: string; jobContactId: string }>,
  jobId: string,
  revealPhone: boolean = false,
): Promise<{ requestIds: string[]; creditsUsed: number }> {
  const allRequestIds: string[] = [];
  let totalCredits = 0;

  // Split contacts into two groups based on available matching data
  const emailContacts = contacts.filter((c) => c.email);
  const idOnlyContacts = contacts.filter((c) => !c.email && c.apolloPersonId);

  logger.info('Apollo enrichment routing', {
    jobId,
    totalContacts: contacts.length,
    emailContacts: emailContacts.length,
    idOnlyContacts: idOnlyContacts.length,
    revealPhone,
  });

  // Path 1: Contacts with emails → batched bulk_match
  if (emailContacts.length > 0) {
    for (let offset = 0; offset < emailContacts.length; offset += BATCH_SIZE) {
      const batch = emailContacts.slice(offset, offset + BATCH_SIZE);
      const result = await processBatch(batch, jobId, { revealPhone });
      allRequestIds.push(...result.requestIds);
      totalCredits += result.creditsUsed;
    }
  }

  // Path 2: Contacts with only Apollo person IDs → individual people/match
  if (idOnlyContacts.length > 0) {
    const result = await processIdOnlyContacts(idOnlyContacts, jobId, { revealPhone });
    allRequestIds.push(...result.requestIds);
    totalCredits += result.creditsUsed;
  }

  logger.info('Apollo bulk enrichment complete', {
    jobId,
    totalContacts: contacts.length,
    totalRequestIds: allRequestIds.length,
    totalCredits,
    revealPhone,
  });

  return { requestIds: allRequestIds, creditsUsed: totalCredits };
}
