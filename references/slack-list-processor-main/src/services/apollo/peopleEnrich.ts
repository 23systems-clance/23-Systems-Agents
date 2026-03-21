/**
 * Single-person enrichment for phone number reveal via Apollo.io.
 *
 * POSTs to `/v1/people/match` with `reveal_phone_number: true` and a
 * webhook URL so Apollo delivers phone data asynchronously.  A
 * `PendingPhoneLookup` row is persisted to correlate the future webhook
 * callback with the originating job contact.
 *
 * Costs 1 Apollo credit per call.
 */

import { randomUUID } from 'node:crypto';
import { post } from './client.js';
import { config } from '../../config/index.js';
import { prisma } from '../../models/index.js';
import logger from '../../lib/logger.js';

// ---------------------------------------------------------------------------
// Internal types (raw Apollo response shape)
// ---------------------------------------------------------------------------

/** Subset of the Apollo people/match response we care about. */
interface PeopleMatchResponse {
  request_id?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** How long to wait for the async phone webhook before considering it timed out. */
const PHONE_LOOKUP_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// ---------------------------------------------------------------------------
// Public function
// ---------------------------------------------------------------------------

/**
 * Enriches a single person by email to reveal their phone number.
 *
 * Apollo returns phone data asynchronously via webhook, so this function
 * creates a `PendingPhoneLookup` record that the webhook handler will
 * later resolve.
 *
 * @param email - The contact's email address.
 * @param jobContactId - UUID of the associated `JobContact` row.
 * @param jobId - UUID of the parent `Job`.
 * @returns The Apollo request ID and credits consumed (1).
 */
export async function enrichPerson(
  email: string,
  jobContactId: string,
  jobId: string,
): Promise<{ requestId: string; creditsUsed: number }> {
  // Ensure HTTPS — Apollo requires a valid HTTPS webhook URL
  const baseUrl = config.webhookBaseUrl.replace(/^http:\/\//, 'https://');
  const webhookUrl = `${baseUrl}/api/webhooks/apollo/phone-results`;

  const { data, creditsUsed } = await post<PeopleMatchResponse>(
    '/v1/people/match',
    {
      email,
      reveal_phone_number: true,
      webhook_url: webhookUrl,
    },
  );

  const requestId = data.request_id ?? randomUUID();

  await prisma.pendingPhoneLookup.create({
    data: {
      apolloRequestId: requestId,
      jobContactId,
      jobId,
      status: 'PENDING',
      expiresAt: new Date(Date.now() + PHONE_LOOKUP_TTL_MS),
    },
  });

  logger.info('Apollo person enrichment submitted', {
    email,
    requestId,
    jobContactId,
    jobId,
    creditsUsed: creditsUsed || 1,
  });

  return { requestId, creditsUsed: creditsUsed || 1 };
}
