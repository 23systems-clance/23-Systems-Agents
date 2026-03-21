/**
 * Enriches a single domain with technographic and traffic data from the
 * BuiltWith Domain API.
 *
 * Calls the Domain Lookup endpoint (v22), parses the raw response into a
 * normalized {@link DomainEnrichmentResult}, and extracts:
 *   - Technologies (name, tag, categories, detection dates)
 *   - Traffic rank metadata (Quantcast / Majestic)
 *
 * Error domains are returned with an `error` field rather than being silently
 * dropped, so upstream callers always have a 1-to-1 mapping of input rows to
 * result rows.
 */

import { lookupDomain } from './client.js';
import type { BuiltWithTechnology, BuiltWithMeta } from './client.js';
import logger from '../../lib/logger.js';
import { logError } from '../admin/errorLogger.js';

// ---------------------------------------------------------------------------
// Public interfaces
// ---------------------------------------------------------------------------

/** A single normalized technology extracted from a BuiltWith domain profile. */
export interface NormalizedTechnology {
  /** Technology display name (e.g. "Salesforce"). */
  name: string;
  /** BuiltWith internal tag identifier. */
  tag: string;
  /** Category strings assigned by BuiltWith (e.g. ["CRM", "Analytics"]). */
  categories: string[];
  /** When BuiltWith first detected this technology, or null if unavailable. */
  firstDetected: Date | null;
  /** When BuiltWith last detected this technology, or null if unavailable. */
  lastDetected: Date | null;
}

/** Full enrichment result for a single domain. */
export interface DomainEnrichmentResult {
  /** The domain that was looked up. */
  domain: string;
  /** Deduplicated technologies found across all paths on the domain. */
  technologies: NormalizedTechnology[];
  /** Best available traffic rank (QRank preferred, Majestic fallback). */
  trafficRank: number | null;
  /** Raw traffic rank metadata from the API. */
  meta: { quantcast: number | null; majestic: number | null; arank: number | null };
  /** Telephone numbers found on the website (from API Meta). */
  telephones: string[];
  /** Email addresses found on the website (from API Meta). */
  emails: string[];
  /** Social profile URLs found on the website (from API Meta). */
  social: string[];
  /** Company/person names found on the website (from API Meta). */
  names: string[];
  /** City extracted from website (from API Meta). */
  city: string | null;
  /** State extracted from website (from API Meta). */
  state: string | null;
  /** Zip/Postcode extracted from website (from API Meta). */
  zip: string | null;
  /** Country extracted from website (from API Meta). */
  country: string | null;
  /** Industry vertical (from API Meta). */
  vertical: string | null;
  /** Company name from API Meta (may differ from user-provided name). */
  companyNameFromApi: string | null;
  /** Annual sales revenue (from top-level API response). */
  salesRevenue: number | null;
  /** Technology spend in USD (from Result.Spend). */
  techSpend: number | null;
  /** Employee count (from Attributes). */
  employees: number | null;
  /** Product/SKU count (from Attributes). */
  productCount: number | null;
  /** Social followers count (from Attributes). */
  followers: number | null;
  /** Number of BuiltWith credits consumed by this lookup. */
  creditsUsed: number;
  /** Error message when the lookup failed, otherwise null. */
  error: string | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Converts a BuiltWith epoch timestamp (milliseconds since Unix epoch)
 * to a Date, returning null for falsy / zero values.
 *
 * @param epoch - Millisecond timestamp from the BuiltWith API.
 * @returns Parsed Date or null.
 */
function epochToDate(epoch: number | undefined): Date | null {
  if (!epoch || epoch <= 0) {
    return null;
  }
  return new Date(epoch);
}

/**
 * Resolves the best-available traffic rank from BuiltWith meta.
 *
 * Prefers QRank (Quantcast) when present and non-zero; falls back to Majestic.
 *
 * @param meta - Traffic / ranking metadata from the domain result.
 * @returns Numeric rank or null when neither source provides a value.
 */
function resolveTrafficRank(meta: BuiltWithMeta | undefined): number | null {
  if (meta?.QRank && meta.QRank > 0) {
    return meta.QRank;
  }
  if (meta?.Majestic && meta.Majestic > 0) {
    return meta.Majestic;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Main enrichment function
// ---------------------------------------------------------------------------

/**
 * Enriches a single domain by calling the BuiltWith Domain API and
 * normalizing the response.
 *
 * When the API returns an error entry for the domain (e.g. domain not found,
 * parked, etc.) the result row is still returned with the `error` field
 * populated, so that callers can surface the issue without losing the row.
 *
 * @param domain - The domain to enrich (e.g. "example.com").
 * @returns Structured enrichment data including technologies and traffic rank.
 */
export async function enrichDomain(
  domain: string,
): Promise<DomainEnrichmentResult> {
  const emptyResult: DomainEnrichmentResult = {
    domain,
    technologies: [],
    trafficRank: null,
    meta: { quantcast: null, majestic: null, arank: null },
    telephones: [],
    emails: [],
    social: [],
    names: [],
    city: null,
    state: null,
    zip: null,
    country: null,
    vertical: null,
    companyNameFromApi: null,
    salesRevenue: null,
    techSpend: null,
    employees: null,
    productCount: null,
    followers: null,
    creditsUsed: 0,
    error: null,
  };

  try {
    const { data, creditsUsed } = await lookupDomain(domain);

    // Check for API-level errors first
    const apiError = data.Errors?.find(
      (e) => e.Lookup.toLowerCase() === domain.toLowerCase(),
    );
    if (apiError) {
      logger.warn('BuiltWith returned error for domain', {
        domain,
        message: apiError.Message,
      });
      return { ...emptyResult, creditsUsed, error: apiError.Message };
    }

    // Find the matching result entry
    const entry = data.Results?.find(
      (r) => r.Lookup.toLowerCase() === domain.toLowerCase(),
    );
    if (!entry) {
      logger.warn('BuiltWith returned no result entry for domain', { domain });
      return {
        ...emptyResult,
        creditsUsed,
        error: 'No result entry returned by BuiltWith',
      };
    }

    // Flatten and deduplicate technologies across all paths
    const seenTechs = new Set<string>();
    const technologies: NormalizedTechnology[] = [];

    for (const path of entry.Result.Paths ?? []) {
      for (const tech of path.Technologies ?? []) {
        const key = `${tech.Name}::${tech.Tag}`;
        if (seenTechs.has(key)) {
          continue;
        }
        seenTechs.add(key);
        technologies.push({
          name: tech.Name,
          tag: tech.Tag,
          categories: tech.Categories ?? [],
          firstDetected: epochToDate(tech.FirstDetected),
          lastDetected: epochToDate(tech.LastDetected),
        });
      }
    }

    const meta: DomainEnrichmentResult['meta'] = {
      quantcast: entry.Meta?.QRank ?? null,
      majestic: entry.Meta?.Majestic ?? null,
      arank: entry.Meta?.ARank ?? null,
    };

    const trafficRank = resolveTrafficRank(entry.Meta);

    // Extract additional Meta fields when available.
    const telephones = entry.Meta?.Telephones ?? [];
    const emails = entry.Meta?.Emails ?? [];
    const social = entry.Meta?.Social ?? [];
    const names = (entry.Meta?.Names ?? []).map((n) => n.Name ?? '').filter(Boolean);
    const city = entry.Meta?.City ?? null;
    const state = entry.Meta?.State ?? null;
    const zip = entry.Meta?.Postcode ?? null;
    const country = entry.Meta?.Country ?? null;
    const vertical = entry.Meta?.Vertical ?? null;
    const companyNameFromApi = entry.Meta?.CompanyName ?? null;

    // Extract top-level and Attributes fields.
    const salesRevenue = entry.SalesRevenue ?? null;
    const techSpend = entry.Result.Spend ?? null;
    const employees = entry.Attributes?.Employees ?? null;
    const productCount = entry.Attributes?.ProductCount ?? null;
    const followers = entry.Attributes?.Followers ?? null;

    logger.info('Domain enrichment complete', {
      domain,
      techCount: technologies.length,
      trafficRank,
      vertical,
      employees,
      techSpend,
    });

    return {
      domain,
      technologies,
      trafficRank,
      meta,
      telephones,
      emails,
      social,
      names,
      city,
      state,
      zip,
      country,
      vertical,
      companyNameFromApi,
      salesRevenue,
      techSpend,
      employees,
      productCount,
      followers,
      creditsUsed,
      error: null,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('Domain enrichment failed', { domain, error: message });
    logError({
      category: 'API_ERROR',
      service: 'builtwith',
      message: `Domain enrichment failed for ${domain}: ${message}`,
      stackTrace: err instanceof Error ? err.stack : undefined,
      metadata: { domain },
    });
    return { ...emptyResult, error: message };
  }
}
