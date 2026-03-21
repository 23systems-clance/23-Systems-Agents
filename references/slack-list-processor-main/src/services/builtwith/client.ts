/**
 * BuiltWith API client with retry logic and usage tracking.
 *
 * Wraps three BuiltWith endpoints:
 *   - Domain Lookup (v22) for technographic data
 *   - Company-to-URL (CTU) for resolving company names to domains
 *   - Lists (v4) for searching domains by technology
 *
 * Every method returns an envelope with `data`, `apiCallCount`, and
 * `creditsUsed` so callers can persist usage to ApiUsageLog.
 */

import { config } from '../../config/index.js';
import logger from '../../lib/logger.js';
import { ApiError } from '../../lib/errors.js';
import { logError } from '../admin/errorLogger.js';

// ---------------------------------------------------------------------------
// Response type interfaces
// ---------------------------------------------------------------------------

/** A single technology detected on a domain path. */
export interface BuiltWithTechnology {
  Name: string;
  Tag: string;
  Categories: string[];
  FirstDetected: number;
  LastDetected: number;
}

/** A URL path with its detected technologies. */
export interface BuiltWithPath {
  Url: string;
  Technologies: BuiltWithTechnology[];
}

/** Traffic / ranking metadata returned by the Domain API. */
export interface BuiltWithMeta {
  QRank?: number;
  Majestic?: number;
  ARank?: number;
  Telephones?: string[];
  Emails?: string[];
  Names?: Array<{ Name?: string; Type?: number; Level?: string; Email?: string }>;
  Social?: string[];
  City?: string;
  State?: string;
  Postcode?: string;
  Country?: string;
  CompanyName?: string;
  Vertical?: string;
  /** Catch-all for any additional Meta fields the API returns. */
  [key: string]: unknown;
}

/** Domain attributes (employees, followers, product counts, etc.). */
export interface BuiltWithAttributes {
  MJRank?: number;
  Employees?: number;
  Followers?: number;
  ProductCount?: number;
  /** Catch-all for additional attribute fields. */
  [key: string]: unknown;
}

/** Single result entry inside `Results[]` from the Domain API. */
export interface DomainResultEntry {
  Result: {
    Paths: BuiltWithPath[];
    IsDB?: boolean;
    Spend?: number;
    SpendHistory?: Array<{ D: number; S: number }>;
  };
  Meta: BuiltWithMeta;
  Attributes?: BuiltWithAttributes;
  FirstIndexed?: number;
  LastIndexed?: number;
  SalesRevenue?: number;
  Lookup: string;
}

/** Top-level response from the Domain Lookup API (v22). */
export interface DomainLookupResponse {
  Results: DomainResultEntry[];
  Errors: Array<{ Lookup: string; Message: string }>;
}

/** Response from the CTU (Company-to-URL) API. */
export interface CtuResponse {
  /** Resolved domain/URL string, or empty when no match is found. */
  Result: string;
  /** Error message when the lookup fails. */
  Error?: string;
}

/** A single domain entry returned by the Lists API. */
export interface ListsDomainEntry {
  D: string;   // Domain
  FL: number;  // First live
  LL: number;  // Last live
}

/** Top-level response from the Lists API (v4). */
export interface ListsResponse {
  Results: ListsDomainEntry[];
  Errors: string[];
}

// ---------------------------------------------------------------------------
// API usage envelope returned by every public method
// ---------------------------------------------------------------------------

/** Wrapper returned by every client method for usage tracking. */
export interface ApiCallResult<T> {
  /** Parsed response payload. */
  data: T;
  /** Number of HTTP calls made (including retries that eventually succeeded). */
  apiCallCount: number;
  /** BuiltWith credits consumed by this call. */
  creditsUsed: number;
}

// ---------------------------------------------------------------------------
// Retry helper
// ---------------------------------------------------------------------------

const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 1000;

/**
 * Executes an async function with exponential backoff retry.
 *
 * @param fn - The async operation to attempt.
 * @param label - Human-readable label for log messages.
 * @returns A tuple of `[result, totalAttempts]`.
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  label: string,
): Promise<[T, number]> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const result = await fn();
      return [result, attempt];
    } catch (err) {
      lastError = err;
      if (attempt < MAX_RETRIES) {
        const delayMs = INITIAL_BACKOFF_MS * Math.pow(2, attempt - 1);
        logger.warn(`BuiltWith ${label} attempt ${attempt} failed, retrying in ${delayMs}ms`, {
          attempt,
          delayMs,
          error: err instanceof Error ? err.message : String(err),
        });
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  // All retries exhausted
  const message = lastError instanceof Error ? lastError.message : String(lastError);
  logError({
    category: 'API_ERROR',
    service: 'builtwith',
    message: `BuiltWith ${label} failed after ${MAX_RETRIES} attempts: ${message}`,
    stackTrace: lastError instanceof Error ? lastError.stack : undefined,
  });
  throw new ApiError(
    `BuiltWith ${label} failed after ${MAX_RETRIES} attempts: ${message}`,
    'BuiltWith',
    502,
  );
}

// ---------------------------------------------------------------------------
// Internal HTTP helper
// ---------------------------------------------------------------------------

/**
 * Makes a GET request to the given URL and returns the parsed JSON body.
 *
 * @param url - Fully-qualified URL including query params.
 * @param label - Human-readable label for error messages.
 * @returns Parsed JSON response.
 */
async function fetchJson<T>(url: string, label: string): Promise<T> {
  const response = await fetch(url);

  if (!response.ok) {
    throw new ApiError(
      `BuiltWith ${label} returned HTTP ${response.status}: ${response.statusText}`,
      'BuiltWith',
      response.status,
    );
  }

  return (await response.json()) as T;
}

// ---------------------------------------------------------------------------
// Public client methods
// ---------------------------------------------------------------------------

const BASE_DOMAIN_API = 'https://api.builtwith.com/v22/api.json';
const BASE_CTU_API = 'https://api.builtwith.com/ctu2/api.json';
const BASE_LISTS_API = 'https://api.builtwith.com/lists4/api.json';

/**
 * Looks up full technographic data for a domain via the BuiltWith Domain API v22.
 *
 * @param domain - The domain to look up (e.g. "example.com").
 * @returns Domain tech data including technologies array and traffic rank.
 */
export async function lookupDomain(
  domain: string,
): Promise<ApiCallResult<DomainLookupResponse>> {
  const url = `${BASE_DOMAIN_API}?KEY=${encodeURIComponent(config.builtwith.apiKey)}&LOOKUP=${encodeURIComponent(domain)}`;

  logger.debug('BuiltWith lookupDomain request', { domain });

  const [data, attempts] = await withRetry(
    () => fetchJson<DomainLookupResponse>(url, 'lookupDomain'),
    'lookupDomain',
  );

  logger.info('BuiltWith lookupDomain complete', { domain, attempts });

  return { data, apiCallCount: attempts, creditsUsed: 1 };
}

/**
 * Resolves a company name to a domain via the BuiltWith CTU API.
 *
 * @param companyName - Human-readable company name to resolve.
 * @returns The resolved domain string (in `data.Result`) or an error.
 */
export async function resolveCompanyName(
  companyName: string,
): Promise<ApiCallResult<CtuResponse>> {
  const url = `${BASE_CTU_API}?KEY=${encodeURIComponent(config.builtwith.apiKey)}&COMPANY=${encodeURIComponent(companyName)}`;

  logger.debug('BuiltWith resolveCompanyName request', { companyName });

  const [data, attempts] = await withRetry(
    () => fetchJson<CtuResponse>(url, 'resolveCompanyName'),
    'resolveCompanyName',
  );

  logger.info('BuiltWith resolveCompanyName complete', { companyName, result: data.Result, attempts });

  return { data, apiCallCount: attempts, creditsUsed: 1 };
}

/**
 * Searches for domains using a specific technology via the BuiltWith Lists API.
 *
 * @param tech - Technology name to search for (e.g. "Salesforce").
 * @param filters - Optional filters such as country code.
 * @returns List of domain entries matching the technology.
 */
export async function searchTechnology(
  tech: string,
  filters: { country?: string } = {},
): Promise<ApiCallResult<ListsResponse>> {
  let url = `${BASE_LISTS_API}?KEY=${encodeURIComponent(config.builtwith.apiKey)}&TECH=${encodeURIComponent(tech)}`;

  if (filters.country) {
    url += `&META=${encodeURIComponent(filters.country)}`;
  }

  logger.debug('BuiltWith searchTechnology request', { tech, filters });

  const [data, attempts] = await withRetry(
    () => fetchJson<ListsResponse>(url, 'searchTechnology'),
    'searchTechnology',
  );

  logger.info('BuiltWith searchTechnology complete', {
    tech,
    resultCount: data.Results?.length ?? 0,
    attempts,
  });

  return { data, apiCallCount: attempts, creditsUsed: 1 };
}
