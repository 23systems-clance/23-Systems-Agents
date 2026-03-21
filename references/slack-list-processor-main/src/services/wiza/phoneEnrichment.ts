/**
 * Wiza phone enrichment for waterfall (Feature 27, US3).
 *
 * Uses Wiza Individual Reveal API with enrichmentLevel: 'phone'.
 * Polls for results with 90-second timeout (phone reveals take longer).
 */

import logger from '../../lib/logger.js';
import { individualReveal, waitForReveal } from './client.js';
import { ConcurrencyPool } from '../../lib/concurrencyPool.js';
import { wizaConfig } from '../../config/providers.js';
import type { EnrichmentContact } from '../../types/providers.js';

/** Phone reveal polling timeout (90 seconds - longer than email). */
const PHONE_REVEAL_TIMEOUT_MS = 90_000;

/**
 * Enrich a single contact's phone using Wiza API.
 *
 * @param contact - Contact to enrich.
 * @returns Phone number if found, null otherwise.
 */
export async function enrichPhoneWithWiza(
  contact: EnrichmentContact,
): Promise<string | null> {
  try {
    logger.debug('Attempting Wiza phone enrichment', {
      contactId: contact.id,
      domain: contact.domain,
      name: contact.fullName,
    });

    const revealResponse = await individualReveal(
      {
        full_name: contact.fullName,
        domain: contact.domain,
        company: contact.companyName,
      },
      'phone',
    );

    if (revealResponse.status.code !== 200) {
      throw new Error(`Wiza API error: ${revealResponse.status.message}`);
    }

    const revealId = revealResponse.data.id;

    // Poll for phone results (longer timeout than email)
    const completedReveal = await waitForReveal(revealId, PHONE_REVEAL_TIMEOUT_MS);

    if (completedReveal.data.status === 'finished') {
      // Check for mobile phone first, then any phone
      const mobilePhone = completedReveal.data.mobile_phone;
      if (mobilePhone) {
        logger.info('Wiza mobile phone found', {
          contactId: contact.id,
          phoneStatus: completedReveal.data.phone_status,
        });
        return mobilePhone;
      }

      // Check phones array for mobile type
      const phones = completedReveal.data.phones;
      if (phones && phones.length > 0) {
        const mobile = phones.find((p) => p.type === 'mobile');
        if (mobile) {
          logger.info('Wiza phone found (from phones array)', {
            contactId: contact.id,
            type: mobile.type,
          });
          return mobile.number;
        }

        // Fall back to first available phone
        logger.info('Wiza phone found (non-mobile)', {
          contactId: contact.id,
          type: phones[0]!.type,
        });
        return phones[0]!.number;
      }
    }

    logger.debug('Wiza did not find phone', {
      contactId: contact.id,
      status: completedReveal.data.status,
      phoneStatus: completedReveal.data.phone_status,
    });
    return null;
  } catch (error) {
    logger.warn('Wiza phone enrichment failed', {
      contactId: contact.id,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Batch enrich phones via concurrent Wiza individual reveals.
 *
 * Uses ConcurrencyPool with rate limiting. Each reveal uses
 * enrichment_level 'phone' and polls for result (90s timeout).
 *
 * @param contacts - Contacts to enrich.
 * @param onProgress - Optional progress callback.
 * @returns Map of contactId -> phone (null for not found).
 */
export async function enrichPhonesWithWizaBatch(
  contacts: EnrichmentContact[],
  onProgress?: (completed: number, total: number) => void,
): Promise<Map<string, string | null>> {
  const results = new Map<string, string | null>();
  if (contacts.length === 0) return results;

  const pool = new ConcurrencyPool({
    maxConcurrent: 5,
    maxPerSecond: wizaConfig.rateLimit.requestsPerSecond,
    name: 'wiza-phone',
  });

  const tasks = contacts.map((contact) => async () => {
    const phone = await enrichPhoneWithWiza(contact);
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
