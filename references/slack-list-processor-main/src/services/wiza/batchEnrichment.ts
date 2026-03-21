/**
 * Wiza batch email enrichment for waterfall (Feature 27).
 *
 * Uses concurrent individual reveals with ConcurrencyPool to process
 * multiple contacts in parallel while respecting Wiza rate limits.
 * Each contact starts an individual reveal with enrichment_level 'partial'
 * (email only) and polls for the result.
 */

import logger from '../../lib/logger.js';
import { ConcurrencyPool } from '../../lib/concurrencyPool.js';
import { wizaConfig } from '../../config/providers.js';
import { individualReveal, waitForReveal } from './client.js';
import type { EnrichmentContact } from '../../types/providers.js';

/** Max concurrent Wiza reveals (conservative to stay within queue depth). */
const MAX_CONCURRENT = 5;

/** Timeout per individual reveal poll in ms. */
const REVEAL_TIMEOUT_MS = 60000;

/**
 * Batch enrich emails via concurrent Wiza individual reveals.
 *
 * Runs multiple reveal requests in parallel using ConcurrencyPool
 * with rate limiting. Each reveal starts with enrichment_level 'partial'
 * (email only) and polls for the result with a 60-second timeout.
 *
 * @param contacts - Contacts to enrich (Apollo failures in waterfall).
 * @param onProgress - Optional progress callback.
 * @returns Map of contactId -> email (null for not found).
 */
export async function enrichEmailsWithWizaBatch(
  contacts: EnrichmentContact[],
  onProgress?: (completed: number, total: number) => void,
): Promise<Map<string, string | null>> {
  const results = new Map<string, string | null>();
  if (contacts.length === 0) return results;

  const pool = new ConcurrencyPool({
    maxConcurrent: MAX_CONCURRENT,
    maxPerSecond: wizaConfig.rateLimit.requestsPerSecond,
    name: 'wiza-email',
  });

  const tasks = contacts.map((contact) => async () => {
    return await enrichSingleWithWiza(contact);
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

/**
 * Enrich a single contact's email via Wiza individual reveal.
 *
 * @param contact - Contact to enrich.
 * @returns Object with contactId and email, or null email if not found.
 */
async function enrichSingleWithWiza(
  contact: EnrichmentContact,
): Promise<{ contactId: string; email: string | null }> {
  try {
    logger.debug('Wiza batch: starting reveal', { contactId: contact.id });

    const revealResponse = await individualReveal(
      {
        full_name: contact.fullName,
        domain: contact.domain,
        company: contact.companyName,
      },
      'partial', // Email only
    );

    if (revealResponse.status.code !== 200) {
      logger.warn('Wiza reveal failed', {
        contactId: contact.id,
        statusCode: revealResponse.status.code,
        message: revealResponse.status.message,
      });
      return { contactId: contact.id, email: null };
    }

    const revealId = revealResponse.data.id;

    // Poll for result
    const completed = await waitForReveal(revealId, REVEAL_TIMEOUT_MS);

    if (completed.data.status === 'finished' && completed.data.email) {
      logger.debug('Wiza batch: email found', {
        contactId: contact.id,
        email: completed.data.email,
        emailStatus: completed.data.email_status,
      });
      return { contactId: contact.id, email: completed.data.email };
    }

    return { contactId: contact.id, email: null };
  } catch (error) {
    logger.warn('Wiza batch: reveal failed', {
      contactId: contact.id,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error; // Let ConcurrencyPool handle retry
  }
}
