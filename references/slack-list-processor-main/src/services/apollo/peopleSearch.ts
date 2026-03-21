/**
 * Free people search using Apollo.io's mixed_people/api_search endpoint.
 *
 * Finds up to 4 senior decision-maker contacts for a given company,
 * filtered by configurable seniority, title, department, and function filters.
 * Uses `q_organization_name` for accurate company matching.
 * This endpoint consumes zero Apollo credits.
 *
 * Includes a proactive rate limiter (min interval between requests)
 * to stay within Apollo's API limits and avoid 429 blocks.
 */

import { post } from './client.js';
import logger from '../../lib/logger.js';
import type { ApolloContactFilters } from '../../types/enrichmentFilters.js';
import { DEFAULT_APOLLO_FILTERS } from '../../types/enrichmentFilters.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Organization data returned inside each Apollo person record. */
export interface ApolloOrganization {
  name: string | null;
  hasIndustry: boolean;
  hasPhone: boolean;
  hasCity: boolean;
  hasState: boolean;
  hasCountry: boolean;
  hasZipCode: boolean;
  hasRevenue: boolean;
  hasEmployeeCount: boolean;
}

/** A contact returned from Apollo people search (all API fields preserved). */
export interface ApolloContact {
  apolloId: string;
  firstName: string;
  lastNameObfuscated: string;
  fullName: string;
  email: string | null;
  jobTitle: string | null;
  seniorityLevel: string | null;
  linkedinUrl: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  lastRefreshedAt: string | null;
  hasEmail: boolean;
  hasCity: boolean;
  hasState: boolean;
  hasCountry: boolean;
  hasDirectPhone: string | null;
  organization: ApolloOrganization | null;
  /** Full raw API response object for this person (stored as JSON). */
  rawApiData: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Internal types (raw Apollo response shape)
// ---------------------------------------------------------------------------

/** Shape of an organization object inside the Apollo api_search response. */
interface ApolloOrgRaw {
  name?: string;
  has_industry?: boolean;
  has_phone?: boolean;
  has_city?: boolean;
  has_state?: boolean;
  has_country?: boolean;
  has_zip_code?: boolean;
  has_revenue?: boolean;
  has_employee_count?: boolean;
}

/** Shape of a single person entry in the Apollo api_search response. */
interface ApolloPersonRaw {
  id?: string;
  first_name?: string;
  last_name_obfuscated?: string;
  title?: string | null;
  last_refreshed_at?: string;
  has_email?: boolean;
  has_city?: boolean;
  has_state?: boolean;
  has_country?: boolean;
  has_direct_phone?: string;
  organization?: ApolloOrgRaw;
}

/** Top-level shape of the Apollo api_search response. */
interface MixedPeopleSearchResponse {
  total_entries?: number;
  people?: ApolloPersonRaw[];
}

// ---------------------------------------------------------------------------
// Constants & Rate Limiter
// ---------------------------------------------------------------------------

const MAX_CONTACTS = 4;

/**
 * Minimum milliseconds between consecutive Apollo API requests.
 * Apollo limit: 200/min for mixed_people.search.
 * 400ms interval = 150/min (~75% of limit), leaving headroom.
 */
const MIN_REQUEST_INTERVAL_MS = 400;

/** Timestamp of the last Apollo API request (module-level singleton). */
let lastRequestTime = 0;

/**
 * Ensures at least MIN_REQUEST_INTERVAL_MS has elapsed since the last
 * Apollo request before proceeding. This proactive throttle prevents
 * bursts that could trigger rate-limit blocks.
 */
async function waitForRateLimit(): Promise<void> {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < MIN_REQUEST_INTERVAL_MS) {
    const waitMs = MIN_REQUEST_INTERVAL_MS - elapsed;
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
  lastRequestTime = Date.now();
}

// ---------------------------------------------------------------------------
// Public function
// ---------------------------------------------------------------------------

/**
 * Searches Apollo for decision-maker contacts at the given company.
 *
 * Uses `q_organization_name` for accurate company matching (the
 * `organization_domains` parameter does not filter on this endpoint).
 * Returns up to 4 contacts matching the provided filters.
 * Includes proactive rate limiting between requests.
 *
 * @param domain      - Company domain (used as fallback search term).
 * @param companyName - Company name for Apollo search (preferred).
 * @param filters     - Optional Apollo contact filters (defaults to global preset).
 * @returns Array of up to 4 `ApolloContact` records with all API fields.
 */
export async function searchPeople(
  domain: string,
  companyName?: string,
  filters?: ApolloContactFilters,
): Promise<ApolloContact[]> {
  // Use company name for search; fall back to domain without TLD
  const searchTerm = companyName || domain.replace(/\.[^.]+$/, '');

  const effectiveFilters = filters ?? DEFAULT_APOLLO_FILTERS;

  // Proactive rate limiting
  await waitForRateLimit();

  // Build request body with required and optional filters
  const requestBody: Record<string, unknown> = {
    q_organization_name: searchTerm,
    person_seniorities: effectiveFilters.personSeniorities,
    person_locations: ['United States'],
    page: 1,
    per_page: effectiveFilters.perPage,
  };

  if (effectiveFilters.personTitles.length > 0) {
    requestBody.person_titles = effectiveFilters.personTitles;
  }
  if (effectiveFilters.personDepartments.length > 0) {
    requestBody.person_departments = effectiveFilters.personDepartments;
  }
  if (effectiveFilters.personFunctions.length > 0) {
    requestBody.person_functions = effectiveFilters.personFunctions;
  }

  const { data } = await post<MixedPeopleSearchResponse>(
    '/api/v1/mixed_people/api_search',
    requestBody,
  );

  const rawPeople = data.people ?? [];

  // Take the top contacts (Apollo returns by relevance)
  const selected = rawPeople.slice(0, MAX_CONTACTS);

  const contacts: ApolloContact[] = selected.map((p) => {
    const firstName = p.first_name ?? '';
    const lastNameObfuscated = p.last_name_obfuscated ?? '';
    const fullName = [firstName, lastNameObfuscated].filter(Boolean).join(' ');

    const org: ApolloOrganization | null = p.organization
      ? {
          name: p.organization.name ?? null,
          hasIndustry: p.organization.has_industry ?? false,
          hasPhone: p.organization.has_phone ?? false,
          hasCity: p.organization.has_city ?? false,
          hasState: p.organization.has_state ?? false,
          hasCountry: p.organization.has_country ?? false,
          hasZipCode: p.organization.has_zip_code ?? false,
          hasRevenue: p.organization.has_revenue ?? false,
          hasEmployeeCount: p.organization.has_employee_count ?? false,
        }
      : null;

    return {
      apolloId: p.id ?? '',
      firstName,
      lastNameObfuscated,
      fullName,
      email: null, // Not available from api_search endpoint
      jobTitle: p.title ?? null,
      seniorityLevel: null, // Not returned (filtered by request params)
      linkedinUrl: null, // Not available from api_search endpoint
      city: null, // Not available (only has_city flag)
      state: null, // Not available (only has_state flag)
      country: null, // Not available (only has_country flag)
      lastRefreshedAt: p.last_refreshed_at ?? null,
      hasEmail: p.has_email ?? false,
      hasCity: p.has_city ?? false,
      hasState: p.has_state ?? false,
      hasCountry: p.has_country ?? false,
      hasDirectPhone: p.has_direct_phone ?? null,
      organization: org,
      rawApiData: p as unknown as Record<string, unknown>,
    };
  });

  logger.info('Apollo people search complete', {
    searchTerm,
    domain,
    totalEntries: data.total_entries ?? 0,
    rawCount: rawPeople.length,
    returnedCount: contacts.length,
  });

  return contacts;
}
