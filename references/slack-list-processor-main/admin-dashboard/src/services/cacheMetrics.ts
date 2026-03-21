/**
 * Cache metrics admin API service (Feature 17).
 */

import { api } from '@/lib/api-client';

export interface CacheMetricsResponse {
  totalEntries: number;
  activeEntries: number;
  expiredEntries: number;
  hitRate7d: number;
  hitRate30d: number;
  totalHits7d: number;
  totalMisses7d: number;
  totalHits30d: number;
  totalMisses30d: number;
  estimatedCreditsSaved: number;
  estimatedCostSavedUsd: number;
  cacheSizeMb: number;
  topDomains: Array<{ domain: string; hitCount: number }>;
}

export interface CacheConfig {
  id: string;
  ttlDays: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CacheEntry {
  id: string;
  normalizedDomain: string;
  techSpendTier: string | null;
  companyName: string | null;
  technologyCount: number;
  hitCount: number;
  isComplete: boolean;
  enrichedAt: string;
  expiresAt: string;
}

export interface CacheEntriesResponse {
  entries: CacheEntry[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface CachePurgeResponse {
  purgedCount: number;
  mode: 'all' | 'expired';
}

/** Fetch cache performance metrics. */
export async function fetchCacheMetrics(): Promise<CacheMetricsResponse> {
  const { data } = await api.get<CacheMetricsResponse>('/cache/metrics');
  return data;
}

/** Fetch current cache configuration. */
export async function fetchCacheConfig(): Promise<CacheConfig> {
  const { data } = await api.get<CacheConfig>('/cache/config');
  return data;
}

/** Update cache configuration. */
export async function updateCacheConfig(
  input: { ttlDays?: number; enabled?: boolean },
): Promise<CacheConfig> {
  const { data } = await api.put<CacheConfig>('/cache/config', input);
  return data;
}

/** Purge cache entries. */
export async function purgeCache(
  mode: 'all' | 'expired',
): Promise<CachePurgeResponse> {
  const { data } = await api.post<CachePurgeResponse>('/cache/purge', { mode });
  return data;
}

/** Fetch paginated cache entries. */
export async function fetchCacheEntries(
  params: Record<string, string>,
): Promise<CacheEntriesResponse> {
  const { data } = await api.get<CacheEntriesResponse>('/cache/entries', { params });
  return data;
}

/** Delete a single cache entry. */
export async function deleteCacheEntry(
  id: string,
): Promise<{ deleted: boolean; domain: string }> {
  const { data } = await api.delete<{ deleted: boolean; domain: string }>(`/cache/entries/${id}`);
  return data;
}
