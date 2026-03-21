/**
 * Apollo Contact Cache Service.
 *
 * Caches bulk enrichment results by apolloPersonId.
 * Shared across all workspaces — contact professional data is not tenant-specific.
 * Phone-aware: entries cached without phone data are treated as misses when phones needed.
 * All operations are wrapped in try/catch — cache failures must never block enrichment.
 */

import { prisma } from '../../models/index.js';
import { getCacheConfig } from '../../lib/cacheConfig.js';
import logger from '../../lib/logger.js';
import type { ApolloContactCache } from '@prisma/client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Input for storing a contact cache entry. */
export interface ContactCacheStoreInput {
  apolloPersonId: string;
  fullName: string | null;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  jobTitle: string | null;
  seniorityLevel: string | null;
  linkedinUrl: string | null;
  timezoneUtc: string | null;
  timezoneLabel: string | null;
  hasPhoneData: boolean;
  directPhone: string | null;
  businessPhone: string | null;
  apolloMetadata: object | null;
  ttlDays: number;
}

/** Mapped contact data for creating a JobContact from cache. */
export interface CachedJobContactData {
  fullName: string | null;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  jobTitle: string | null;
  seniorityLevel: string | null;
  linkedinUrl: string | null;
  timezoneUtc: string | null;
  timezoneLabel: string | null;
  directPhone: string | null;
  businessPhone: string | null;
  apolloPersonId: string;
  apolloMetadata: object | null;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/**
 * Batch lookup cached enrichment data for multiple person IDs.
 * When requirePhone is true, only returns entries with hasPhoneData = true.
 *
 * @param personIds    - Array of Apollo person IDs to look up.
 * @param requirePhone - If true, only return entries that have phone data.
 * @returns Map of apolloPersonId -> ApolloContactCache for cache hits.
 */
export async function batchLookup(
  personIds: string[],
  requirePhone: boolean,
): Promise<Map<string, ApolloContactCache>> {
  const result = new Map<string, ApolloContactCache>();

  try {
    const validIds = personIds.filter((id) => id && id.length > 0);
    if (validIds.length === 0) return result;

    const where: Record<string, unknown> = {
      apolloPersonId: { in: validIds },
      expiresAt: { gt: new Date() },
    };

    // Phone-aware filtering: when phones required, only match entries with phone data
    if (requirePhone) {
      where.hasPhoneData = true;
    }

    const entries = await prisma.apolloContactCache.findMany({ where });

    for (const entry of entries) {
      result.set(entry.apolloPersonId, entry);
    }
  } catch (err) {
    logger.warn('Apollo contact cache batchLookup failed', {
      error: err instanceof Error ? err.message : String(err),
      personIdCount: personIds.length,
    });
  }

  return result;
}

/**
 * Store or update a contact cache entry. Upsert on apolloPersonId.
 *
 * @param input - The enrichment data to cache.
 * @returns The created/updated cache entry, or null on failure.
 */
export async function store(input: ContactCacheStoreInput): Promise<ApolloContactCache | null> {
  try {
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + input.ttlDays);

    return await prisma.apolloContactCache.upsert({
      where: { apolloPersonId: input.apolloPersonId },
      create: {
        apolloPersonId: input.apolloPersonId,
        fullName: input.fullName,
        firstName: input.firstName,
        lastName: input.lastName,
        email: input.email,
        jobTitle: input.jobTitle,
        seniorityLevel: input.seniorityLevel,
        linkedinUrl: input.linkedinUrl,
        timezoneUtc: input.timezoneUtc,
        timezoneLabel: input.timezoneLabel,
        hasPhoneData: input.hasPhoneData,
        directPhone: input.directPhone,
        businessPhone: input.businessPhone,
        apolloMetadata: input.apolloMetadata as unknown as import('@prisma/client').Prisma.InputJsonValue ?? undefined,
        enrichedAt: new Date(),
        expiresAt,
      },
      update: {
        fullName: input.fullName,
        firstName: input.firstName,
        lastName: input.lastName,
        email: input.email,
        jobTitle: input.jobTitle,
        seniorityLevel: input.seniorityLevel,
        linkedinUrl: input.linkedinUrl,
        timezoneUtc: input.timezoneUtc,
        timezoneLabel: input.timezoneLabel,
        hasPhoneData: input.hasPhoneData,
        directPhone: input.directPhone,
        businessPhone: input.businessPhone,
        apolloMetadata: input.apolloMetadata as unknown as import('@prisma/client').Prisma.InputJsonValue ?? undefined,
        enrichedAt: new Date(),
        expiresAt,
        hitCount: 0, // Reset on refresh
      },
    });
  } catch (err) {
    logger.warn('Apollo contact cache store failed', {
      error: err instanceof Error ? err.message : String(err),
      apolloPersonId: input.apolloPersonId,
    });
    return null;
  }
}

/**
 * Increment hit count for a cached contact.
 *
 * @param apolloPersonId - The Apollo person ID key.
 */
export async function recordHit(apolloPersonId: string): Promise<void> {
  try {
    await prisma.apolloContactCache.update({
      where: { apolloPersonId },
      data: { hitCount: { increment: 1 } },
    });
  } catch (err) {
    logger.debug('Apollo contact cache recordHit failed', {
      error: err instanceof Error ? err.message : String(err),
      apolloPersonId,
    });
  }
}

/**
 * Maps a contact cache entry to JobContact fields for direct DB insertion.
 *
 * @param entry - The ApolloContactCache row.
 * @returns Object with all fields needed for a JobContact record.
 */
export function mapCacheEntryToJobContact(entry: ApolloContactCache): CachedJobContactData {
  return {
    fullName: entry.fullName,
    firstName: entry.firstName,
    lastName: entry.lastName,
    email: entry.email,
    jobTitle: entry.jobTitle,
    seniorityLevel: entry.seniorityLevel,
    linkedinUrl: entry.linkedinUrl,
    timezoneUtc: entry.timezoneUtc,
    timezoneLabel: entry.timezoneLabel,
    directPhone: entry.directPhone,
    businessPhone: entry.businessPhone,
    apolloPersonId: entry.apolloPersonId,
    apolloMetadata: entry.apolloMetadata as object | null,
  };
}

/**
 * Purge all expired contact cache entries.
 *
 * @returns Number of entries purged.
 */
export async function purgeExpired(): Promise<number> {
  const result = await prisma.apolloContactCache.deleteMany({
    where: { expiresAt: { lte: new Date() } },
  });
  return result.count;
}

/**
 * Purge all contact cache entries.
 *
 * @returns Number of entries purged.
 */
export async function purgeAll(): Promise<number> {
  const result = await prisma.apolloContactCache.deleteMany();
  return result.count;
}

/**
 * Gets the contact cache TTL from CacheConfig.
 *
 * @returns TTL in days.
 */
export async function getContactTtlDays(): Promise<number> {
  const config = await getCacheConfig();
  return config.apolloContactTtlDays;
}
