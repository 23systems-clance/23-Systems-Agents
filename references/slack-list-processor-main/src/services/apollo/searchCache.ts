/**
 * Apollo Search Cache Service.
 *
 * Caches people search results by (normalizedDomain, filterHash) composite key.
 * Shared across all workspaces — search results are not tenant-specific.
 * All operations are wrapped in try/catch — cache failures must never block enrichment.
 */

import { prisma } from '../../models/index.js';
import { getCacheConfig } from '../../lib/cacheConfig.js';
import { normalizeDomain } from '../file/domainUtils.js';
import logger from '../../lib/logger.js';
import type { ApolloSearchCache } from '@prisma/client';
import type { ApolloContact } from './peopleSearch.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Input for storing a search cache entry. */
export interface SearchCacheStoreInput {
  normalizedDomain: string;
  filterHash: string;
  contacts: object[];
  resultCount: number;
  filterSnapshot: object;
  ttlDays: number;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/**
 * Batch lookup cached search results for multiple domains with a single filter hash.
 *
 * @param domains    - Array of raw domain strings (will be normalized).
 * @param filterHash - SHA-256 hash of the filter parameters.
 * @returns Map of normalizedDomain -> ApolloSearchCache for cache hits.
 */
export async function batchLookup(
  domains: string[],
  filterHash: string,
): Promise<Map<string, ApolloSearchCache>> {
  const result = new Map<string, ApolloSearchCache>();

  try {
    // Normalize all domains
    const normalizedDomains = domains
      .map((d) => normalizeDomain(d))
      .filter((d): d is string => d !== null);

    if (normalizedDomains.length === 0) return result;

    const entries = await prisma.apolloSearchCache.findMany({
      where: {
        normalizedDomain: { in: normalizedDomains },
        filterHash,
        expiresAt: { gt: new Date() },
      },
    });

    for (const entry of entries) {
      result.set(entry.normalizedDomain, entry);
    }
  } catch (err) {
    logger.warn('Apollo search cache batchLookup failed', {
      error: err instanceof Error ? err.message : String(err),
      domainCount: domains.length,
    });
  }

  return result;
}

/**
 * Store or update a search cache entry. Upsert on (normalizedDomain, filterHash).
 *
 * @param input - The search result to cache.
 * @returns The created/updated cache entry, or null on failure.
 */
export async function store(input: SearchCacheStoreInput): Promise<ApolloSearchCache | null> {
  try {
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + input.ttlDays);

    return await prisma.apolloSearchCache.upsert({
      where: {
        normalizedDomain_filterHash: {
          normalizedDomain: input.normalizedDomain,
          filterHash: input.filterHash,
        },
      },
      create: {
        normalizedDomain: input.normalizedDomain,
        filterHash: input.filterHash,
        contacts: input.contacts as unknown as import('@prisma/client').Prisma.InputJsonValue,
        resultCount: input.resultCount,
        filterSnapshot: input.filterSnapshot as unknown as import('@prisma/client').Prisma.InputJsonValue,
        searchedAt: new Date(),
        expiresAt,
      },
      update: {
        contacts: input.contacts as unknown as import('@prisma/client').Prisma.InputJsonValue,
        resultCount: input.resultCount,
        filterSnapshot: input.filterSnapshot as unknown as import('@prisma/client').Prisma.InputJsonValue,
        searchedAt: new Date(),
        expiresAt,
        hitCount: 0, // Reset on refresh
      },
    });
  } catch (err) {
    logger.warn('Apollo search cache store failed', {
      error: err instanceof Error ? err.message : String(err),
      domain: input.normalizedDomain,
    });
    return null;
  }
}

/**
 * Increment hit count for a cached search entry.
 *
 * @param normalizedDomain - The normalized domain key.
 * @param filterHash       - The filter hash key.
 */
export async function recordHit(normalizedDomain: string, filterHash: string): Promise<void> {
  try {
    await prisma.apolloSearchCache.update({
      where: {
        normalizedDomain_filterHash: { normalizedDomain, filterHash },
      },
      data: { hitCount: { increment: 1 } },
    });
  } catch (err) {
    logger.debug('Apollo search cache recordHit failed', {
      error: err instanceof Error ? err.message : String(err),
      domain: normalizedDomain,
    });
  }
}

/**
 * Maps a cache entry's contacts JSONB back to ApolloContact[] for downstream processing.
 *
 * @param cacheEntry - The ApolloSearchCache row.
 * @returns Array of ApolloContact matching the interface from peopleSearch.ts.
 */
export function mapCacheEntryToContacts(cacheEntry: ApolloSearchCache): ApolloContact[] {
  const contacts = cacheEntry.contacts as unknown as Array<Record<string, unknown>>;
  if (!Array.isArray(contacts)) return [];

  return contacts.map((c) => ({
    apolloId: (c.apolloId as string) ?? '',
    firstName: (c.firstName as string) ?? '',
    lastNameObfuscated: (c.lastNameObfuscated as string) ?? '',
    fullName: (c.fullName as string) ?? '',
    email: (c.email as string | null) ?? null,
    jobTitle: (c.jobTitle as string | null) ?? null,
    seniorityLevel: (c.seniorityLevel as string | null) ?? null,
    linkedinUrl: (c.linkedinUrl as string | null) ?? null,
    city: (c.city as string | null) ?? null,
    state: (c.state as string | null) ?? null,
    country: (c.country as string | null) ?? null,
    lastRefreshedAt: (c.lastRefreshedAt as string | null) ?? null,
    hasEmail: (c.hasEmail as boolean) ?? false,
    hasCity: (c.hasCity as boolean) ?? false,
    hasState: (c.hasState as boolean) ?? false,
    hasCountry: (c.hasCountry as boolean) ?? false,
    hasDirectPhone: (c.hasDirectPhone as string | null) ?? null,
    organization: (c.organization as ApolloContact['organization']) ?? null,
    rawApiData: (c.rawApiData as Record<string, unknown>) ?? {},
  }));
}

/**
 * Purge all expired search cache entries.
 *
 * @returns Number of entries purged.
 */
export async function purgeExpired(): Promise<number> {
  const result = await prisma.apolloSearchCache.deleteMany({
    where: { expiresAt: { lte: new Date() } },
  });
  return result.count;
}

/**
 * Purge all search cache entries.
 *
 * @returns Number of entries purged.
 */
export async function purgeAll(): Promise<number> {
  const result = await prisma.apolloSearchCache.deleteMany();
  return result.count;
}

/**
 * Gets the search cache TTL from CacheConfig.
 *
 * @returns TTL in days.
 */
export async function getSearchTtlDays(): Promise<number> {
  const config = await getCacheConfig();
  return config.apolloSearchTtlDays;
}
