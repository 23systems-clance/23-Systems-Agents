/**
 * CacheConfig singleton accessor.
 *
 * Ensures exactly one CacheConfig row exists in the database with
 * default Apollo TTL values. Uses upsert-on-read pattern so the
 * config is lazily created on first access without a separate seed step.
 */

import { prisma } from '../models/index.js';
import type { CacheConfig } from '@prisma/client';

/** Default Apollo cache TTL values. */
const DEFAULTS = {
  enabled: true,
  apolloSearchTtlDays: 14,
  apolloContactTtlDays: 30,
} as const;

/**
 * Returns the CacheConfig singleton, creating it with defaults if missing.
 *
 * @returns The CacheConfig record.
 */
export async function getCacheConfig(): Promise<CacheConfig> {
  // Try to read existing config first (fast path)
  const existing = await prisma.cacheConfig.findFirst();
  if (existing) return existing;

  // No config exists — create with defaults (idempotent via findFirst retry)
  try {
    return await prisma.cacheConfig.create({
      data: DEFAULTS,
    });
  } catch {
    // Race condition: another process created it — just read it
    const retry = await prisma.cacheConfig.findFirst();
    if (retry) return retry;
    throw new Error('Failed to create or read CacheConfig singleton');
  }
}
