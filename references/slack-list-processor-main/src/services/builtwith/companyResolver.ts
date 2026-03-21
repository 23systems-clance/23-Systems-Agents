/**
 * Resolves a company name to its primary domain via the BuiltWith CTU API.
 *
 * Used when an uploaded list contains company names instead of domains.
 * Returns null (rather than throwing) when the API cannot find a match,
 * so callers can skip unresolvable rows without aborting the entire job.
 */

import { resolveCompanyName } from './client.js';
import logger from '../../lib/logger.js';

/** Result of a company-to-domain resolution attempt. */
export interface CompanyResolutionResult {
  /** The resolved domain, or null if resolution failed. */
  domain: string | null;
  /** Number of BuiltWith credits consumed by this call. */
  creditsUsed: number;
}

/**
 * Attempts to resolve a company name to a domain using the BuiltWith CTU API.
 *
 * On API errors or empty results the function returns `{ domain: null }`
 * instead of throwing, logging a warning for observability.
 *
 * @param companyName - Human-readable company name (e.g. "Acme Corp").
 * @returns The resolved domain or null, plus the credits consumed.
 */
export async function resolveCompanyToDomain(
  companyName: string,
): Promise<CompanyResolutionResult> {
  try {
    const { data, creditsUsed } = await resolveCompanyName(companyName);

    if (!data.Result || data.Error) {
      logger.warn('BuiltWith CTU returned no result for company', {
        companyName,
        error: data.Error,
      });
      return { domain: null, creditsUsed };
    }

    logger.info('Resolved company to domain', {
      companyName,
      domain: data.Result,
    });

    return { domain: data.Result, creditsUsed };
  } catch (err) {
    logger.warn('Failed to resolve company to domain', {
      companyName,
      error: err instanceof Error ? err.message : String(err),
    });
    return { domain: null, creditsUsed: 0 };
  }
}
