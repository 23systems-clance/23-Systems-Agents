# API Contracts: Account-Level Research Cache

**Feature**: 17-account-research-cache
**Date**: 2026-03-11
**Base Path**: `/api/admin/cache`

All endpoints require `adminAuth` middleware (same as existing admin routes).

---

## GET /api/admin/cache/metrics

Returns cache performance metrics for the admin dashboard.

**Query Parameters**:

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| period | string | No | "30d" | Time window for hit rate: "7d" or "30d" |

**Response 200**:

```json
{
  "totalEntries": 12847,
  "activeEntries": 11203,
  "expiredEntries": 1644,
  "hitRate7d": 0.42,
  "hitRate30d": 0.38,
  "totalHits7d": 1580,
  "totalMisses7d": 2180,
  "totalHits30d": 5200,
  "totalMisses30d": 8500,
  "estimatedCreditsSaved": 5200,
  "estimatedCostSavedUsd": 260.00,
  "cacheSizeMb": 45.2,
  "topDomains": [
    { "domain": "salesforce.com", "hitCount": 47 },
    { "domain": "microsoft.com", "hitCount": 38 },
    { "domain": "oracle.com", "hitCount": 31 }
  ]
}
```

**Metric calculations**:
- `hitRate{N}d`: `SUM(job.cacheHits) / (SUM(job.cacheHits) + SUM(job.cacheMisses))` for jobs completed in the last N days
- `estimatedCreditsSaved`: `SUM(job.cacheHits)` for jobs in the period (1 credit per cached domain)
- `estimatedCostSavedUsd`: `estimatedCreditsSaved × config.builtwith.costPerCredit`
- `cacheSizeMb`: `pg_total_relation_size('domain_enrichment_cache') / 1024 / 1024`
- `topDomains`: Top 10 entries by `hitCount` descending

---

## GET /api/admin/cache/config

Returns current cache configuration.

**Response 200**:

```json
{
  "id": "uuid",
  "ttlDays": 60,
  "enabled": true,
  "updatedAt": "2026-03-10T12:00:00Z"
}
```

---

## PUT /api/admin/cache/config

Updates cache configuration. Logs change to AuditLog.

**Request Body**:

```json
{
  "ttlDays": 45,
  "enabled": true
}
```

**Validation**:
- `ttlDays`: integer, min 30, max 90
- `enabled`: boolean

**Response 200**:

```json
{
  "id": "uuid",
  "ttlDays": 45,
  "enabled": true,
  "updatedAt": "2026-03-11T14:30:00Z"
}
```

**Side effects**:
- Creates AuditLog entry: `{ action: "CACHE_CONFIG_UPDATED", metadata: { oldTtlDays, newTtlDays, oldEnabled, newEnabled } }`
- When TTL is reduced, existing entries are NOT immediately purged. The daily purge worker will clean them up using the new TTL for the `expiresAt` comparison. Entries that were already stored with a longer TTL will be re-evaluated on next cache hit.

---

## POST /api/admin/cache/purge

Purges all cache entries or expired entries only. Logs action to AuditLog.

**Request Body**:

```json
{
  "mode": "all"
}
```

**Validation**:
- `mode`: "all" (purge everything) or "expired" (purge only expired entries)

**Response 200**:

```json
{
  "purgedCount": 12847,
  "mode": "all"
}
```

**Side effects**:
- Creates AuditLog entry: `{ action: "CACHE_PURGED", metadata: { mode, purgedCount, adminUserId } }`

---

## GET /api/admin/cache/entries

Lists cache entries with pagination and search. For debugging and visibility.

**Query Parameters**:

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| page | number | No | 1 | Page number |
| limit | number | No | 50 | Entries per page (max 100) |
| search | string | No | - | Filter by domain (partial match) |
| sortBy | string | No | "enrichedAt" | Sort field: "enrichedAt", "hitCount", "expiresAt" |
| sortOrder | string | No | "desc" | Sort direction: "asc" or "desc" |

**Response 200**:

```json
{
  "entries": [
    {
      "id": "uuid",
      "normalizedDomain": "acme.com",
      "techSpendTier": "HIGH",
      "companyName": "Acme Corp",
      "technologyCount": 47,
      "hitCount": 12,
      "isComplete": true,
      "enrichedAt": "2026-02-15T10:00:00Z",
      "expiresAt": "2026-04-16T10:00:00Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 50,
    "total": 12847,
    "totalPages": 257
  }
}
```

**Notes**:
- Does NOT return `builtwithResponse` (too large for list view)
- `technologyCount` is derived from `technologies` JSONB array length

---

## DELETE /api/admin/cache/entries/:id

Deletes a single cache entry by ID. For manual cache management.

**Response 200**:

```json
{
  "deleted": true,
  "domain": "acme.com"
}
```

**Side effects**:
- Creates AuditLog entry: `{ action: "CACHE_ENTRY_DELETED", metadata: { domain, adminUserId } }`

---

## Internal Service Interface (not HTTP)

### DomainCacheService

Used internally by the technographic worker. Not exposed as HTTP endpoints.

```typescript
interface DomainCacheService {
  /**
   * Batch lookup cached entries for multiple domains.
   * Returns a Map of normalizedDomain → DomainEnrichmentCache.
   * Only returns non-expired entries.
   */
  batchLookup(domains: string[]): Promise<Map<string, DomainEnrichmentCache>>;

  /**
   * Store or update a cache entry after a fresh BuiltWith API call.
   * Uses upsert on normalizedDomain.
   */
  store(entry: CacheStoreInput): Promise<DomainEnrichmentCache>;

  /**
   * Increment hit count for a cached entry.
   * Called when cache hit is used in enrichment.
   */
  recordHit(normalizedDomain: string): Promise<void>;

  /**
   * Get current cache config (TTL, enabled flag).
   * Returns defaults if no config row exists.
   */
  getConfig(): Promise<CacheConfig>;

  /**
   * Purge expired entries. Returns count of deleted entries.
   */
  purgeExpired(): Promise<number>;

  /**
   * Purge all entries. Returns count of deleted entries.
   */
  purgeAll(): Promise<number>;
}

interface CacheStoreInput {
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
```
