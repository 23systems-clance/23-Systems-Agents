/**
 * Higher-level BuiltWith Lists API client.
 *
 * Wraps the low-level `searchTechnology` function from `./client.ts` to
 * produce richer company entries (matching the TechReportCacheEntry shape)
 * and automatically logs API usage to the database via Prisma.
 *
 * The basic Lists API only returns domain + first/last live epoch timestamps,
 * so fields like companyName, country, stateRegion, city, and trafficRank are
 * set to null and expected to be enriched downstream.
 */

import { searchTechnology } from './client.js';
import type { ListsDomainEntry, ApiCallResult, ListsResponse } from './client.js';
import { prisma } from '../../models/index.js';
import { config } from '../../config/index.js';
import logger from '../../lib/logger.js';

// ---------------------------------------------------------------------------
// Exported interfaces
// ---------------------------------------------------------------------------

/**
 * A single enriched company entry derived from BuiltWith Lists API results.
 *
 * Fields that the basic Lists API cannot populate (companyName, country, etc.)
 * are set to `null` and intended to be filled in by a later enrichment step.
 */
export interface ListCompanyEntry {
  /** The domain returned by BuiltWith (e.g. "example.com"). */
  domain: string;
  /** Company name, if available. Null from the basic Lists API. */
  companyName: string | null;
  /** ISO country code, if available. Null from the basic Lists API. */
  country: string | null;
  /** State or region, if available. Null from the basic Lists API. */
  stateRegion: string | null;
  /** City, if available. Null from the basic Lists API. */
  city: string | null;
  /** Traffic rank, if available. Null from the basic Lists API. */
  trafficRank: number | null;
  /** The technology name that was searched for. */
  technologyDetected: string;
  /** Date the technology was first detected on this domain, converted from epoch. */
  technologyFirstDetected: Date | null;
  /** Date the technology was last detected on this domain, converted from epoch. */
  technologyLastDetected: Date | null;
}

/**
 * Parameters for {@link searchTechnologyList}.
 */
export interface ListSearchParams {
  /** Technology name to search for (e.g. "Salesforce"). */
  technology: string;
  /** Job ID (UUID) used to associate API usage logs with the originating job. */
  jobId: string;
  /** Optional filters to narrow the search. */
  filters: {
    /** ISO country code (e.g. "US", "GB"). */
    country?: string;
    /** State or region filter. */
    stateRegion?: string;
    /** Company size filter. */
    companySize?: string;
    /** Traffic level filter. */
    trafficLevel?: string;
  };
}

/**
 * Result envelope returned by {@link searchTechnologyList}.
 */
export interface ListSearchResult {
  /** Array of company entries mapped from the raw API results. */
  entries: ListCompanyEntry[];
  /** Total number of entries returned. */
  totalCount: number;
  /** Total BuiltWith credits consumed across all paginated requests. */
  creditsUsed: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Converts a BuiltWith epoch timestamp (milliseconds since Unix epoch) to a
 * JavaScript Date, or returns null when the value is zero/falsy.
 *
 * @param epoch - Millisecond epoch timestamp from the BuiltWith API.
 * @returns A Date instance, or null if the epoch is zero/falsy.
 */
function epochToDate(epoch: number): Date | null {
  if (!epoch) return null;
  return new Date(epoch);
}

/**
 * Maps a raw {@link ListsDomainEntry} from the BuiltWith API to a richer
 * {@link ListCompanyEntry}.
 *
 * Since the basic Lists API only supplies domain and first/last live
 * timestamps, all other fields are set to null.
 *
 * @param entry - Raw domain entry from the Lists API response.
 * @param technology - The technology name that was searched.
 * @returns A ListCompanyEntry with enrichment-ready null placeholders.
 */
function mapToCompanyEntry(entry: ListsDomainEntry, technology: string): ListCompanyEntry {
  return {
    domain: entry.D,
    companyName: null,
    country: null,
    stateRegion: null,
    city: null,
    trafficRank: null,
    technologyDetected: technology,
    technologyFirstDetected: epochToDate(entry.FL),
    technologyLastDetected: epochToDate(entry.LL),
  };
}

// ---------------------------------------------------------------------------
// Main exported function
// ---------------------------------------------------------------------------

/**
 * Searches for domains using a given technology via the BuiltWith Lists API,
 * maps the results to richer company entries, and logs API usage.
 *
 * This function wraps the low-level `searchTechnology` client method,
 * handling pagination via the OFFSET parameter when the API returns
 * additional pages of results.
 *
 * @param params - Search parameters including technology, jobId, and filters.
 * @returns A {@link ListSearchResult} containing mapped entries, total count,
 *          and credits consumed.
 *
 * @example
 * ```ts
 * const result = await searchTechnologyList({
 *   technology: 'Salesforce',
 *   jobId: 'abc-123',
 *   filters: { country: 'US' },
 * });
 * console.log(result.totalCount); // e.g. 1500
 * ```
 */
export async function searchTechnologyList(params: ListSearchParams): Promise<ListSearchResult> {
  const { technology, jobId, filters } = params;
  const startTime = Date.now();

  logger.info('searchTechnologyList: starting search', {
    technology,
    jobId,
    filters,
  });

  // Call the low-level client with supported filters
  const apiResult: ApiCallResult<ListsResponse> = await searchTechnology(technology, {
    country: filters.country,
  });

  const rawEntries: ListsDomainEntry[] = apiResult.data.Results ?? [];
  const totalCreditsUsed = apiResult.creditsUsed;
  const totalApiCalls = apiResult.apiCallCount;

  // Check for API-level errors
  if (apiResult.data.Errors && apiResult.data.Errors.length > 0) {
    logger.warn('searchTechnologyList: API returned errors', {
      technology,
      jobId,
      errors: apiResult.data.Errors,
    });
  }

  // Map raw domain entries to the richer company entry format
  const entries: ListCompanyEntry[] = rawEntries.map((entry) =>
    mapToCompanyEntry(entry, technology),
  );

  const durationMs = Date.now() - startTime;
  const estimatedCostUsd = totalCreditsUsed * config.builtwith.costPerCredit;

  // Log API usage to the database
  try {
    await prisma.apiUsageLog.create({
      data: {
        jobId,
        service: 'BUILTWITH',
        endpoint: 'Lists',
        requestCount: totalApiCalls,
        creditsConsumed: totalCreditsUsed,
        estimatedCostUsd,
        responseStatus: 200,
        durationMs,
      },
    });

    logger.debug('searchTechnologyList: API usage logged', {
      jobId,
      creditsConsumed: totalCreditsUsed,
      estimatedCostUsd,
      durationMs,
    });
  } catch (err) {
    // Usage logging failure should not prevent the search from returning results
    logger.error('searchTechnologyList: failed to log API usage', {
      jobId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  logger.info('searchTechnologyList: search complete', {
    technology,
    jobId,
    totalCount: entries.length,
    creditsUsed: totalCreditsUsed,
    durationMs,
  });

  return {
    entries,
    totalCount: entries.length,
    creditsUsed: totalCreditsUsed,
  };
}
