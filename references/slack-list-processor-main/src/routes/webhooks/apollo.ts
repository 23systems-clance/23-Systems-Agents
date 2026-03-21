/**
 * Apollo.io phone webhook handler (T040).
 *
 * Receives async phone number delivery from Apollo.io after a people/match
 * or bulk_match request with `reveal_phone_number: true`. Validates the
 * webhook secret, updates the JobContact with phone data, and enqueues a
 * 'phones-ready' job when all lookups for a job are complete.
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { config } from '../../config/index.js';
import { prisma } from '../../models/index.js';
import { phoneDataQueue } from '../../services/queue/queues.js';
import logger from '../../lib/logger.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ApolloPhoneNumber {
  type: string;
  number: string;
  status?: string;
}

interface ApolloWebhookBody {
  request_id: string;
  person_id?: string;
  phone_numbers?: ApolloPhoneNumber[];
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const router = Router();

/**
 * POST /api/webhooks/apollo/phone-results
 *
 * Receives phone number results from Apollo.io and:
 * 1. Validates the X-Apollo-Webhook-Secret header.
 * 2. Responds 200 immediately (webhook best practice).
 * 3. Asynchronously processes the phone data.
 */
router.post('/phone-results', (req: Request, res: Response) => {
  // 1. Validate webhook secret
  const secret = req.headers['x-apollo-webhook-secret'] as string | undefined;

  if (secret !== config.apollo.webhookSecret) {
    logger.warn('Apollo webhook: invalid secret', {
      receivedSecret: secret ? '***' : 'missing',
    });
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  // 2. Respond 200 immediately
  res.status(200).json({ received: true });

  // 3. Process asynchronously (fire-and-forget)
  const body = req.body as ApolloWebhookBody;
  processPhoneWebhook(body).catch((err) => {
    logger.error('Failed to process Apollo phone webhook', {
      requestId: body.request_id,
      error: err instanceof Error ? err.message : String(err),
    });
  });
});

// ---------------------------------------------------------------------------
// Processing logic
// ---------------------------------------------------------------------------

/**
 * Processes the incoming Apollo phone webhook payload.
 *
 * Steps:
 * 1. Look up PendingPhoneLookup by request_id.
 * 2. Handle idempotency (skip if already RECEIVED).
 * 3. Filter out mobile phone types (FR-005).
 * 4. Update JobContact with direct_phone and business_phone.
 * 5. Mark lookup as RECEIVED.
 * 6. Check if all lookups for the job are complete -> enqueue 'phones-ready'.
 */
async function processPhoneWebhook(body: ApolloWebhookBody): Promise<void> {
  const { request_id, phone_numbers } = body;

  // DIAGNOSTIC: Log webhook reception
  logger.info('Apollo phone webhook received', {
    requestId: request_id,
    personId: body.person_id,
    phoneCount: phone_numbers?.length ?? 0,
    hasPhones: !!phone_numbers && phone_numbers.length > 0,
  });

  if (!request_id) {
    logger.warn('Apollo webhook: missing request_id');
    return;
  }

  // 1. Look up the pending phone lookup
  const lookup = await prisma.pendingPhoneLookup.findUnique({
    where: { apolloRequestId: request_id },
  });

  if (!lookup) {
    logger.warn('Apollo webhook: no pending lookup found', { requestId: request_id });
    return;
  }

  // 2. Idempotency check -- skip if already received
  if (lookup.status === 'RECEIVED') {
    logger.debug('Apollo webhook: duplicate delivery, skipping', {
      requestId: request_id,
      jobContactId: lookup.jobContactId,
    });
    return;
  }

  // 3. Filter out mobile phone types per FR-005 and extract direct/business phones
  let directPhone: string | null = null;
  let businessPhone: string | null = null;

  if (phone_numbers && phone_numbers.length > 0) {
    for (const phone of phone_numbers) {
      // Skip mobile phone types
      if (phone.type === 'mobile' || phone.type === 'personal_cell') {
        continue;
      }

      if (phone.type === 'direct_dial' && !directPhone) {
        directPhone = phone.number;
      } else if ((phone.type === 'hq' || phone.type === 'company') && !businessPhone) {
        businessPhone = phone.number;
      }
    }
  }

  // 4. Update JobContact with phone data
  await prisma.jobContact.update({
    where: { id: lookup.jobContactId },
    data: {
      directPhone,
      businessPhone,
      phoneReceivedAt: new Date(),
      enrichmentStatus: 'COMPLETE',
    },
  });

  // 5. Mark lookup as RECEIVED and store raw phone data
  await prisma.pendingPhoneLookup.update({
    where: { id: lookup.id },
    data: {
      status: 'RECEIVED',
      receivedAt: new Date(),
      phoneData: phone_numbers ? JSON.parse(JSON.stringify(phone_numbers)) : [],
    },
  });

  logger.info('Apollo phone data processed', {
    requestId: request_id,
    jobContactId: lookup.jobContactId,
    jobId: lookup.jobId,
    directPhone: directPhone ? '***' : null,
    businessPhone: businessPhone ? '***' : null,
  });

  // 6. Check if all lookups for the job are complete
  const pendingCount = await prisma.pendingPhoneLookup.count({
    where: {
      jobId: lookup.jobId,
      status: 'PENDING',
    },
  });

  if (pendingCount === 0) {
    // All phone lookups complete -- enqueue 'phones-ready' job
    await phoneDataQueue.add('phones-ready', {
      jobId: lookup.jobId,
    });

    logger.info('All phone lookups complete, phones-ready job enqueued', {
      jobId: lookup.jobId,
    });
  } else {
    logger.debug('Phone lookups still pending', {
      jobId: lookup.jobId,
      pendingCount,
    });
  }
}

export { router as apolloWebhookRouter };
