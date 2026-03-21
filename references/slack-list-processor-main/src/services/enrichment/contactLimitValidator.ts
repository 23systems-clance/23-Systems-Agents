/**
 * Contact limit validation for waterfall enrichment (Feature 27).
 *
 * Enforces FR-025: Maximum 2,000 contacts per waterfall enrichment job
 * to prevent excessive API calls (worst case: 2,000 × 3 providers = 6,000 calls).
 */

import { config } from '../../config/index.js';
import logger from '../../lib/logger.js';

/**
 * Maximum contacts allowed per waterfall enrichment job.
 * Configured via MAX_CONTACTS_PER_JOB environment variable.
 */
const MAX_CONTACTS_PER_JOB = parseInt(process.env.MAX_CONTACTS_PER_JOB || '2000', 10);

export class ContactLimitError extends Error {
  constructor(
    public contactCount: number,
    public maxAllowed: number,
  ) {
    super(
      `Contact limit exceeded: ${contactCount} contacts provided, maximum allowed is ${maxAllowed}`,
    );
    this.name = 'ContactLimitError';
  }
}

/**
 * Validates that contact count does not exceed maximum allowed for waterfall enrichment.
 *
 * @param contactCount - Number of contacts in the enrichment job
 * @throws {ContactLimitError} If contact count exceeds MAX_CONTACTS_PER_JOB
 */
export function validateContactLimit(contactCount: number): void {
  if (contactCount > MAX_CONTACTS_PER_JOB) {
    logger.warn('Contact limit exceeded', {
      contactCount,
      maxAllowed: MAX_CONTACTS_PER_JOB,
      excess: contactCount - MAX_CONTACTS_PER_JOB,
    });

    throw new ContactLimitError(contactCount, MAX_CONTACTS_PER_JOB);
  }

  logger.info('Contact limit validation passed', {
    contactCount,
    maxAllowed: MAX_CONTACTS_PER_JOB,
    utilization: Math.round((contactCount / MAX_CONTACTS_PER_JOB) * 100),
  });
}

/**
 * Gets the current maximum contact limit.
 *
 * @returns The maximum number of contacts allowed per job
 */
export function getContactLimit(): number {
  return MAX_CONTACTS_PER_JOB;
}

/**
 * Checks if a contact count is within limits without throwing.
 *
 * @param contactCount - Number of contacts to check
 * @returns true if within limits, false otherwise
 */
export function isWithinContactLimit(contactCount: number): boolean {
  return contactCount <= MAX_CONTACTS_PER_JOB;
}
