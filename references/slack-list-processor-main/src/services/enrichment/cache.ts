/**
 * Enrichment cache utilities for waterfall enrichment (Feature 27).
 *
 * Implements FR-015: Cache enriched data with provider metadata.
 * Uses Redis with 30-day TTL to avoid re-enrichment costs.
 */

import { Redis } from 'ioredis';
import { Provider } from '@prisma/client';
import { config } from '../../config/index.js';
import logger from '../../lib/logger.js';
import type { EnrichmentContact } from '../../types/providers.js';

const redis = new Redis(config.redis.url);

const CACHE_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days

export interface CachedEmailResult {
  email: string;
  provider: Provider;
  cost: number;
  timestamp: number;
  expiresAt: number;
}

interface CachedPhoneResult {
  phone: string;
  type: 'mobile' | 'work' | 'home';
  provider: Provider;
  cost: number;
  timestamp: number;
  expiresAt: number;
}

/**
 * Generate cache key for email enrichment.
 */
function getEmailCacheKey(contact: EnrichmentContact): string {
  const domain = contact.domain || contact.companyName || 'unknown';
  const name = contact.fullName || `${contact.firstName} ${contact.lastName}`.trim() || 'unknown';
  return `enrichment:email:${domain.toLowerCase()}:${name.toLowerCase()}`;
}

/**
 * Generate cache key for phone enrichment.
 */
function getPhoneCacheKey(contact: EnrichmentContact): string {
  const domain = contact.domain || contact.companyName || 'unknown';
  const name = contact.fullName || `${contact.firstName} ${contact.lastName}`.trim() || 'unknown';
  return `enrichment:phone:${domain.toLowerCase()}:${name.toLowerCase()}`;
}

/**
 * Cache email enrichment result.
 *
 * @param contact - Contact information
 * @param email - Email found
 * @param provider - Provider that found the email
 * @param cost - Cost incurred
 */
export async function cacheEmailResult(
  contact: EnrichmentContact,
  email: string,
  provider: Provider,
  cost: number,
): Promise<void> {
  const key = getEmailCacheKey(contact);
  const now = Math.floor(Date.now() / 1000);

  const cachedData: CachedEmailResult = {
    email,
    provider,
    cost,
    timestamp: now,
    expiresAt: now + CACHE_TTL_SECONDS,
  };

  await redis.setex(key, CACHE_TTL_SECONDS, JSON.stringify(cachedData));

  logger.debug('Cached email result', {
    cacheKey: key,
    provider,
    ttl: CACHE_TTL_SECONDS,
  });
}

/**
 * Get cached email if available and fresh.
 *
 * @param contact - Contact information
 * @returns Cached email result or null if not cached/expired
 */
export async function getCachedEmail(
  contact: EnrichmentContact,
): Promise<CachedEmailResult | null> {
  const key = getEmailCacheKey(contact);

  try {
    const cached = await redis.get(key);
    if (!cached) {
      return null;
    }

    const data: CachedEmailResult = JSON.parse(cached);
    const now = Math.floor(Date.now() / 1000);

    // Verify not expired
    if (data.expiresAt < now) {
      logger.debug('Cached email expired', { cacheKey: key });
      await redis.del(key);
      return null;
    }

    logger.debug('Cache hit for email', {
      cacheKey: key,
      provider: data.provider,
      age: now - data.timestamp,
    });

    return data;
  } catch (error) {
    logger.warn('Failed to read email cache', {
      cacheKey: key,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Cache phone enrichment result.
 *
 * @param contact - Contact information
 * @param phone - Phone number found
 * @param provider - Provider that found the phone
 * @param cost - Cost incurred
 * @param type - Phone type (mobile, work, home)
 */
export async function cachePhoneResult(
  contact: EnrichmentContact,
  phone: string,
  provider: Provider,
  cost: number,
  type: 'mobile' | 'work' | 'home' = 'mobile',
): Promise<void> {
  const key = getPhoneCacheKey(contact);
  const now = Math.floor(Date.now() / 1000);

  const cachedData: CachedPhoneResult = {
    phone,
    type,
    provider,
    cost,
    timestamp: now,
    expiresAt: now + CACHE_TTL_SECONDS,
  };

  await redis.setex(key, CACHE_TTL_SECONDS, JSON.stringify(cachedData));

  logger.debug('Cached phone result', {
    cacheKey: key,
    provider,
    ttl: CACHE_TTL_SECONDS,
  });
}

/**
 * Get cached phone if available and fresh.
 *
 * @param contact - Contact information
 * @returns Cached phone result or null if not cached/expired
 */
export async function getCachedPhone(
  contact: EnrichmentContact,
): Promise<CachedPhoneResult | null> {
  const key = getPhoneCacheKey(contact);

  try {
    const cached = await redis.get(key);
    if (!cached) {
      return null;
    }

    const data: CachedPhoneResult = JSON.parse(cached);
    const now = Math.floor(Date.now() / 1000);

    // Verify not expired
    if (data.expiresAt < now) {
      logger.debug('Cached phone expired', { cacheKey: key });
      await redis.del(key);
      return null;
    }

    logger.debug('Cache hit for phone', {
      cacheKey: key,
      provider: data.provider,
      age: now - data.timestamp,
    });

    return data;
  } catch (error) {
    logger.warn('Failed to read phone cache', {
      cacheKey: key,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Batch lookup cached emails for multiple contacts using Redis MGET.
 *
 * More efficient than calling getCachedEmail() per contact for large batches.
 * Returns a map of contactId -> CachedEmailResult for contacts with cache hits.
 *
 * @param contacts - Contacts to check cache for.
 * @returns Map of contactId -> cached email result (only hits included).
 */
export async function getCachedEmailsBatch(
  contacts: EnrichmentContact[],
): Promise<Map<string, CachedEmailResult>> {
  if (contacts.length === 0) return new Map();

  const results = new Map<string, CachedEmailResult>();

  try {
    // Build keys array maintaining order for index correlation
    const keys = contacts.map((c) => getEmailCacheKey(c));

    const cached = await redis.mget(...keys);
    const now = Math.floor(Date.now() / 1000);

    for (let i = 0; i < cached.length; i++) {
      const raw = cached[i];
      if (!raw) continue;

      try {
        const data: CachedEmailResult = JSON.parse(raw);
        if (data.expiresAt >= now) {
          results.set(contacts[i]!.id, data);
        }
      } catch {
        // Skip malformed cache entries
      }
    }

    if (results.size > 0) {
      logger.info('Batch email cache lookup', {
        totalContacts: contacts.length,
        cacheHits: results.size,
        cacheMisses: contacts.length - results.size,
      });
    }
  } catch (error) {
    logger.warn('Batch email cache lookup failed', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return results;
}

/**
 * Invalidate cache for a contact (force refresh).
 *
 * @param contact - Contact information
 */
export async function invalidateContactCache(
  contact: EnrichmentContact,
): Promise<void> {
  const emailKey = getEmailCacheKey(contact);
  const phoneKey = getPhoneCacheKey(contact);

  await Promise.all([redis.del(emailKey), redis.del(phoneKey)]);

  logger.info('Contact cache invalidated', {
    emailKey,
    phoneKey,
  });
}
