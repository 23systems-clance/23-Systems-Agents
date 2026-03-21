# Quickstart: Account-Level Research Cache

**Feature**: 17-account-research-cache
**Date**: 2026-03-11

## What This Feature Does

Adds a persistent domain-level cache for BuiltWith enrichment results. When the system enriches a company list, it checks the cache first. If a domain was enriched within the TTL window (default 60 days), the cached result is reused and no BuiltWith API call is made. This reduces API costs by 25-50% for workspaces that frequently enrich overlapping company lists.

## Key Components

### 1. Database (Prisma)

Two new models in `prisma/schema.prisma`:
- **DomainEnrichmentCache** — stores one row per normalized domain with the full BuiltWith response, tech metadata, and expiry timestamp
- **CacheConfig** — singleton row for global TTL and enabled flag

Three new columns on the existing **Job** model:
- `cacheHits` / `cacheMisses` — per-job cache performance
- `forceRefresh` — whether user disabled caching for this job

### 2. Cache Service (`src/services/builtwith/domainCache.ts`)

Core cache operations:
- `batchLookup(domains)` — single `WHERE IN` query to check cache for all domains in a job
- `store(entry)` — upsert a domain's enrichment result into cache
- `recordHit(domain)` — increment `hitCount` atomically
- `getConfig()` — read TTL and enabled flag
- `purgeExpired()` / `purgeAll()` — delete entries

### 3. Domain Normalizer (`src/lib/domainNormalizer.ts`)

Shared utility used by both the cache service and the enrichment worker:
- Strips protocol, `www.`, trailing slashes, paths
- Lowercases
- Returns consistent cache key

### 4. Worker Integration (`src/services/queue/workers/technographic.ts`)

Modified flow:
1. Extract unique domains from job companies
2. **NEW**: Batch lookup all domains in cache
3. For each company:
   - If domain is in cache (and not force-refresh) → use cached result, increment hitCount
   - If domain is NOT in cache → call BuiltWith API, store result in cache
4. **NEW**: Update Job with cacheHits/cacheMisses counts
5. **NEW**: Include cache stats in Slack job summary message

### 5. Cache Purge Worker (`src/services/queue/workers/cachePurge.ts`)

BullMQ repeatable job:
- Runs daily at 02:00 UTC
- Deletes entries where `expiresAt < NOW()`
- Logs purge count to AuditLog

### 6. Slack UI Toggle (`src/listeners/actions/enrichmentType.ts`)

After the enrichment type selection step:
- Show "Use cached data" checkbox (default: ON)
- Store in conversation state
- Pass `forceRefresh` flag through to BullMQ job data

### 7. Admin Dashboard

**Backend** (`src/routes/admin/cache.ts`):
- `GET /api/admin/cache/metrics` — hit rate, entries, savings
- `GET /api/admin/cache/config` — current TTL, enabled
- `PUT /api/admin/cache/config` — update TTL (30-90 days)
- `POST /api/admin/cache/purge` — purge expired or all entries
- `GET /api/admin/cache/entries` — paginated entry list
- `DELETE /api/admin/cache/entries/:id` — delete single entry

**Frontend** (`admin-dashboard/src/pages/CacheMetrics.tsx`):
- Stats cards: total entries, hit rate, credits saved, cache size
- Config panel: TTL slider, purge button
- Entries table: searchable, sortable, paginated

## Implementation Order

1. **Prisma schema + migration** — add models and columns
2. **Domain normalizer** — shared utility
3. **Cache service** — core CRUD operations
4. **Technographic worker integration** — cache check before API call
5. **Cache purge worker** — daily cleanup job
6. **Slack UI toggle** — force-refresh option in enrichment flow
7. **Admin API routes** — metrics, config, purge endpoints
8. **Admin dashboard UI** — cache metrics page
9. **Tests** — unit tests for cache service and normalizer

## Verification

After deployment:
1. Enrich a list with 100 domains
2. Enrich a second list with 50 overlapping domains
3. Check Slack job summary shows "50 from cache, 50 fresh"
4. Check admin dashboard shows cache entries and hit rate
5. Verify ApiUsageLog only has entries for fresh lookups (not cache hits)
