# Quickstart: Apollo Enrichment Cache

**Feature**: 22-apollo-enrichment-cache
**Date**: 2026-03-11
**Prerequisite**: Feature 17 (Account-Level Research Cache) must be deployed first.

## What This Feature Does

Adds two persistent cache tiers for Apollo enrichment:
1. **Search Cache** — caches people search results by domain + filter combo (saves time and rate limits)
2. **Contact Cache** — caches bulk enrichment results by person ID (saves 1-2 Apollo credits per cached contact)

## Key Components

### 1. Database (Prisma)

Two new models:
- **ApolloSearchCache** — one row per (normalizedDomain, filterHash) with cached contact list
- **ApolloContactCache** — one row per apolloPersonId with enrichment data + phone flag

Extended models:
- **CacheConfig** — adds `apolloSearchTtlDays` (default 14) and `apolloContactTtlDays` (default 30)
- **Job** — adds 4 Apollo cache counter columns

### 2. Filter Hasher (`src/lib/filterHasher.ts`)

Computes deterministic SHA-256 hash from Apollo filter parameters (seniorities, titles, departments, functions, perPage). Sorts arrays alphabetically before hashing so filter order doesn't matter.

### 3. Search Cache Service (`src/services/apollo/searchCache.ts`)

- `batchLookup(domains, filterHash)` — single query for all domains with matching filter hash
- `store(entry)` — upsert on (normalizedDomain, filterHash)
- `recordHit()` — increment hitCount

### 4. Contact Cache Service (`src/services/apollo/contactCache.ts`)

- `batchLookup(personIds, requirePhone)` — single query; filters by `hasPhoneData` when phones required
- `store(entry)` — upsert on apolloPersonId
- `recordHit()` — increment hitCount

### 5. Worker Integration

**Contact worker** (`src/services/queue/workers/contact.ts`) — modified flow:
1. Compute filter hash from job's contact filters
2. **NEW**: Batch lookup search cache for all companies
3. Per company: if search cache hit → use cached contacts; if miss → call Apollo searchPeople, cache result
4. Collect all person IDs from search results (cached + fresh)
5. **NEW**: Batch lookup contact cache for all person IDs (phone-aware)
6. Per contact: if contact cache hit → use cached enrichment; if miss → include in bulk enrichment batch, cache result
7. Update Job with all 4 Apollo cache counters
8. Include Apollo cache stats in Slack job summary

**Combined worker** (`src/services/queue/workers/combined.ts`) — same integration in Phase B.

### 6. Cache Purge (extends Feature 17)

Feature 17's daily purge worker extended to also delete expired `ApolloSearchCache` and `ApolloContactCache` entries.

### 7. Admin Dashboard

**Backend** — extends `src/routes/admin/cache.ts` with Apollo sub-routes:
- `GET /api/admin/cache/apollo/metrics`
- `GET/PUT /api/admin/cache/apollo/config`
- `POST /api/admin/cache/apollo/purge`
- `GET /api/admin/cache/apollo/search-entries`
- `GET /api/admin/cache/apollo/contact-entries`
- `DELETE /api/admin/cache/apollo/entries/:id`

**Frontend** — extends `admin-dashboard/src/pages/CacheMetrics.tsx` with:
- Apollo search cache stats card
- Apollo contact cache stats card (with credits saved)
- Apollo TTL configuration panel (search + contact separately)
- Purge buttons for each cache

## Implementation Order

1. **Prisma schema + migration** — new models, extended CacheConfig and Job
2. **Filter hasher utility** — deterministic hash function
3. **Search cache service** — CRUD operations
4. **Contact cache service** — CRUD operations with phone-aware logic
5. **Contact worker integration** — two-phase cache check (search then contact)
6. **Combined worker integration** — same pattern in Phase B
7. **Extend cache purge worker** — add Apollo tables to daily purge
8. **Admin API routes** — Apollo-specific metrics, config, purge
9. **Admin dashboard UI** — extend cache metrics page with Apollo sections

## Verification

After deployment:
1. Enrich a list with 100 companies using default seniority filters
2. Enrich a second list with 50 overlapping companies using the same filters
3. Verify Slack summary shows "50 companies from search cache" and contact cache hits
4. Verify ApiUsageLog shows 0 credits for search calls and reduced credits for contact enrichment
5. Check admin dashboard shows Apollo cache entries, hit rates, and credits saved
6. Change contact TTL in admin dashboard and verify it persists
7. Enrich a list requiring phones — verify contacts cached without phones are re-enriched
