/**
 * AI Ark email enrichment for waterfall (Feature 27, US1).
 *
 * Uses AI Ark Export Email API for batch email enrichment.
 * Note: AI Ark email API not fully documented, using best-effort implementation.
 */

import logger from '../../lib/logger.js';
import { getAuthHeader } from '../../config/providers.js';
import type { EnrichmentContact } from '../../types/providers.js';

const AI_ARK_BASE_URL = 'https://api.ai-ark.com/api/developer-portal/v1';

/**
 * Enrich email using AI Ark API.
 *
 * @param contact - Contact to enrich
 * @returns Email if found, null otherwise
 */
export async function enrichEmailWithAIArk(
  contact: EnrichmentContact,
): Promise<string | null> {
  try {
    logger.debug('Attempting AI Ark email enrichment', {
      contactId: contact.id,
      linkedinUrl: contact.linkedinUrl,
    });

    // AI Ark email enrichment requires LinkedIn URL or detailed contact info
    if (!contact.linkedinUrl && !contact.domain) {
      logger.debug('AI Ark requires LinkedIn URL or domain, skipping', {
        contactId: contact.id,
      });
      return null;
    }

    const authHeader = getAuthHeader('AI_ARK');

    // Use export-email endpoint (async, requires webhook or polling)
    // For MVP, we'll use a simplified approach
    // In production, this would use webhook delivery similar to phone enrichment

    logger.warn('AI Ark email enrichment not yet fully implemented', {
      contactId: contact.id,
      note: 'Requires webhook setup or track_id polling - placeholder returns null',
    });

    // TODO: Implement full AI Ark email enrichment with webhook support
    // For now, return null to fall through waterfall gracefully
    return null;
  } catch (error) {
    logger.warn('AI Ark email enrichment failed', {
      contactId: contact.id,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
