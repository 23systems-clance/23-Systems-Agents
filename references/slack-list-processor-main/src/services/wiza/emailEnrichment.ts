/**
 * Wiza email enrichment for waterfall (Feature 27, US1).
 *
 * Uses Wiza Individual Reveal API with enrichmentLevel: 'partial'.
 * Supports both webhook and polling for results.
 */

import logger from '../../lib/logger.js';
import { individualReveal, waitForReveal } from './client.js';
import type { EnrichmentContact } from '../../types/providers.js';

/**
 * Enrich email using Wiza API.
 *
 * @param contact - Contact to enrich
 * @param callbackUrl - Optional webhook URL for async delivery
 * @returns Email if found, null otherwise
 */
export async function enrichEmailWithWiza(
  contact: EnrichmentContact,
  callbackUrl?: string,
): Promise<string | null> {
  try {
    logger.debug('Attempting Wiza email enrichment', {
      contactId: contact.id,
      domain: contact.domain,
      name: contact.fullName,
    });

    // Start reveal
    const revealResponse = await individualReveal(
      {
        full_name: contact.fullName,
        domain: contact.domain,
        company: contact.companyName,
      },
      'partial', // Email only
      callbackUrl,
    );

    if (revealResponse.status.code !== 200) {
      throw new Error(`Wiza API error: ${revealResponse.status.message}`);
    }

    const revealId = revealResponse.data.id;

    // If webhook provided, return immediately (async delivery)
    if (callbackUrl) {
      logger.info('Wiza reveal started (async)', {
        contactId: contact.id,
        revealId,
      });
      return null; // Will be delivered via webhook
    }

    // Otherwise poll for results
    const completedReveal = await waitForReveal(revealId, 60000);

    if (completedReveal.data.status === 'finished' && completedReveal.data.email) {
      logger.info('Wiza email found', {
        contactId: contact.id,
        email: completedReveal.data.email,
        emailStatus: completedReveal.data.email_status,
      });
      return completedReveal.data.email;
    }

    logger.debug('Wiza did not find email', {
      contactId: contact.id,
      status: completedReveal.data.status,
    });
    return null;
  } catch (error) {
    logger.warn('Wiza email enrichment failed', {
      contactId: contact.id,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error; // Let waterfall handle the failure
  }
}
