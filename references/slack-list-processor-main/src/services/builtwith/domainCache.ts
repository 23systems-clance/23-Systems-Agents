/**
 * Domain-level enrichment cache service (Feature 17).
 *
 * Provides batch lookup, store, hit tracking, config management, and purge
 * operations for cached BuiltWith domain enrichment results.
 *
 * Cache entries are keyed by normalized domain and shared across all
 * workspaces (BuiltWith data is public company data).
 *
 * All operations are wrapped in try/catch — cache failures must never
 * block enrichment.
 */

import { prisma } from '../../models/index.js';
import { normalizeDomain } from '../../lib/domainNormalizer.js';
import logger from '../../lib/logger.js';
import type { DomainEnrichmentResult } from './domainEnricher.js';
import type { DomainEnrichmentCache, CacheConfig } from '@prisma/client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Input for storing a new cache entry. */
export interface CacheStoreInput {
  normalizedDomain: string;
  builtwithResponse: object;
  technologies: object[];
  vertical: string | null;
  trafficRank: number | null;
  techSpendTier: string | null;
  techSpendScore: number | null;
  companyName: string | null;
  locationCountry: string | null;
  locationState: string | null;
  locationCity: string | null;
  isComplete: boolean;
  ttlDays: number;
}

// ---------------------------------------------------------------------------
// Default config fallback
// ---------------------------------------------------------------------------

const DEFAULT_TTL_DAYS = 60;
const DEFAULT_ENABLED = true;

// ---------------------------------------------------------------------------
// Service implementation
// ---------------------------------------------------------------------------

/**
 * Batch lookup cached entries for multiple domains.
 * Returns a Map of normalizedDomain -> DomainEnrichmentCache.
 * Only returns non-expired entries.
 *
 * @param domains - Raw domain strings to look up.
 * @returns Map keyed by normalized domain.
 */
export async function batchLookup(
  domains: string[],
): Promise<Map<string, DomainEnrichmentCache>> {
  const result = new Map<string, DomainEnrichmentCache>();

  try {
    // Normalize all domains and filter nulls.
    const normalizedDomains = domains
      .map((d) => normalizeDomain(d))
      .filter((d): d is string => d !== null);

    if (normalizedDomains.length === 0) return result;

    // Deduplicate.
    const uniqueDomains = [...new Set(normalizedDomains)];

    const entries = await prisma.domainEnrichmentCache.findMany({
      where: {
        normalizedDomain: { in: uniqueDomains },
        expiresAt: { gt: new Date() },
      },
    });

    for (const entry of entries) {
      result.set(entry.normalizedDomain, entry);
    }

    logger.debug('Cache batch lookup complete', {
      requested: uniqueDomains.length,
      found: result.size,
    });
  } catch (err) {
    logger.error('Cache batch lookup failed', {
      error: err instanceof Error ? err.message : String(err),
      domainCount: domains.length,
    });
    // Return empty map — cache failures must not block enrichment.
  }

  return result;
}

/**
 * Store or update a cache entry after a fresh BuiltWith API call.
 * Uses upsert on normalizedDomain.
 *
 * @param input - Cache entry data.
 * @returns The created/updated cache entry, or null on failure.
 */
export async function store(
  input: CacheStoreInput,
): Promise<DomainEnrichmentCache | null> {
  try {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + input.ttlDays * 24 * 60 * 60 * 1000);

    const entry = await prisma.domainEnrichmentCache.upsert({
      where: { normalizedDomain: input.normalizedDomain },
      create: {
        normalizedDomain: input.normalizedDomain,
        builtwithResponse: input.builtwithResponse as object,
        technologies: input.technologies as object[],
        vertical: input.vertical,
        trafficRank: input.trafficRank,
        techSpendTier: input.techSpendTier,
        techSpendScore: input.techSpendScore,
        companyName: input.companyName,
        locationCountry: input.locationCountry,
        locationState: input.locationState,
        locationCity: input.locationCity,
        isComplete: input.isComplete,
        hitCount: 0,
        enrichedAt: now,
        expiresAt,
      },
      update: {
        builtwithResponse: input.builtwithResponse as object,
        technologies: input.technologies as object[],
        vertical: input.vertical,
        trafficRank: input.trafficRank,
        techSpendTier: input.techSpendTier,
        techSpendScore: input.techSpendScore,
        companyName: input.companyName,
        locationCountry: input.locationCountry,
        locationState: input.locationState,
        locationCity: input.locationCity,
        isComplete: input.isComplete,
        hitCount: 0, // Reset hit count on refresh.
        enrichedAt: now,
        expiresAt,
      },
    });

    logger.debug('Cache entry stored', {
      domain: input.normalizedDomain,
      ttlDays: input.ttlDays,
      expiresAt: expiresAt.toISOString(),
    });

    return entry;
  } catch (err) {
    logger.error('Cache store failed', {
      error: err instanceof Error ? err.message : String(err),
      domain: input.normalizedDomain,
    });
    return null;
  }
}

/**
 * Increment hit count for a cached entry.
 * Called when a cache hit is used in enrichment.
 *
 * @param normalizedDomain - The normalized domain key.
 */
export async function recordHit(normalizedDomain: string): Promise<void> {
  try {
    await prisma.domainEnrichmentCache.update({
      where: { normalizedDomain },
      data: { hitCount: { increment: 1 } },
    });
  } catch (err) {
    // Non-critical — log and continue.
    logger.warn('Cache recordHit failed', {
      error: err instanceof Error ? err.message : String(err),
      domain: normalizedDomain,
    });
  }
}

/**
 * Get current cache config (TTL, enabled flag).
 * Returns defaults if no config row exists.
 */
export async function getConfig(): Promise<CacheConfig> {
  try {
    const config = await prisma.cacheConfig.findFirst();
    if (config) return config;

    // Seed default config row (idempotent).
    const defaultConfig = await prisma.cacheConfig.create({
      data: {
        ttlDays: DEFAULT_TTL_DAYS,
        enabled: DEFAULT_ENABLED,
      },
    });
    logger.info('Cache config seeded with defaults', {
      ttlDays: DEFAULT_TTL_DAYS,
      enabled: DEFAULT_ENABLED,
    });
    return defaultConfig;
  } catch (err) {
    logger.error('Cache getConfig failed, using defaults', {
      error: err instanceof Error ? err.message : String(err),
    });
    // Return a synthetic default config object.
    return {
      id: 'default',
      ttlDays: DEFAULT_TTL_DAYS,
      enabled: DEFAULT_ENABLED,
      apolloSearchTtlDays: 14,
      apolloContactTtlDays: 30,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }
}

/**
 * Purge expired entries. Returns count of deleted entries.
 */
export async function purgeExpired(): Promise<number> {
  try {
    const result = await prisma.domainEnrichmentCache.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    logger.info('Cache purge expired complete', { purgedCount: result.count });
    return result.count;
  } catch (err) {
    logger.error('Cache purgeExpired failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return 0;
  }
}

/**
 * Purge all entries. Returns count of deleted entries.
 */
export async function purgeAll(): Promise<number> {
  try {
    const result = await prisma.domainEnrichmentCache.deleteMany();
    logger.info('Cache purge all complete', { purgedCount: result.count });
    return result.count;
  } catch (err) {
    logger.error('Cache purgeAll failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Helper: map cache entry to DomainEnrichmentResult (T006)
// ---------------------------------------------------------------------------

/**
 * Converts a DomainEnrichmentCache row to a DomainEnrichmentResult object
 * matching the interface from domainEnricher.ts.
 *
 * Used by the technographic worker to treat cached entries identically
 * to fresh API results.
 *
 * @param entry - A cached domain enrichment record.
 * @returns A DomainEnrichmentResult with creditsUsed: 0.
 */
export function mapCacheEntryToEnrichResult(
  entry: DomainEnrichmentCache,
): DomainEnrichmentResult {
  // Parse the stored builtwithResponse for meta fields not stored separately.
  const response = entry.builtwithResponse as Record<string, unknown>;
  const resultEntry = (response as { Results?: Array<{ Result?: { Paths?: Array<{ Technologies?: Array<{ Name: string; Tag: string; Categories?: string[]; FirstDetected?: number; LastDetected?: number }> }> }; Meta?: Record<string, unknown>; SalesRevenue?: number; Attributes?: Record<string, unknown> }> })?.Results?.[0];
  const meta = resultEntry?.Meta as Record<string, unknown> | undefined;
  const attributes = resultEntry?.Attributes as Record<string, unknown> | undefined;

  // Parse technologies from stored JSONB array.
  const techs = (entry.technologies as Array<{
    name: string;
    tag: string;
    categories?: string[];
    firstDetected?: string | null;
    lastDetected?: string | null;
  }>) ?? [];

  return {
    domain: entry.normalizedDomain,
    technologies: techs.map((t) => ({
      name: t.name,
      tag: t.tag,
      categories: t.categories ?? [],
      firstDetected: t.firstDetected ? new Date(t.firstDetected) : null,
      lastDetected: t.lastDetected ? new Date(t.lastDetected) : null,
    })),
    trafficRank: entry.trafficRank,
    meta: {
      quantcast: (meta?.QRank as number) ?? null,
      majestic: (meta?.Majestic as number) ?? null,
      arank: (meta?.ARank as number) ?? null,
    },
    telephones: (meta?.Telephones as string[]) ?? [],
    emails: (meta?.Emails as string[]) ?? [],
    social: (meta?.Social as string[]) ?? [],
    names: ((meta?.Names as Array<{ Name?: string }>) ?? [])
      .map((n) => n.Name ?? '')
      .filter(Boolean),
    city: entry.locationCity,
    state: entry.locationState,
    zip: (meta?.Postcode as string) ?? null,
    country: entry.locationCountry,
    vertical: entry.vertical,
    companyNameFromApi: entry.companyName,
    salesRevenue: (resultEntry?.SalesRevenue as number) ?? null,
    techSpend: (resultEntry?.Result as { Spend?: number })?.Spend ?? null,
    employees: (attributes?.Employees as number) ?? null,
    productCount: (attributes?.ProductCount as number) ?? null,
    followers: (attributes?.Followers as number) ?? null,
    creditsUsed: 0,
    error: null,
  };
}
