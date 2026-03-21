# Research: Account-Level Research Cache

**Feature**: 17-account-research-cache
**Date**: 2026-03-11

## R1: Domain Normalization Strategy

**Decision**: Normalize domains by lowercasing, stripping protocol, `www.` prefix, trailing slashes, and path segments. Keep the root domain + TLD only.

**Rationale**: The technographic worker already lowercases domains for the in-memory cache (`domainKey = domain.toLowerCase()`). Extending this to a persistent cache requires consistent normalization. BuiltWith API accepts bare domains (e.g., `acme.com`) and returns the same data regardless of subdomain or protocol variation.

**Normalization rules**:
1. Remove protocol (`https://`, `http://`)
2. Remove `www.` prefix
3. Lowercase the entire string
4. Remove trailing slashes and path segments
5. Remove port numbers
6. Handle edge cases: IP addresses (skip caching), empty strings (skip), internationalized domain names (punycode normalize)

**Alternatives considered**:
- Full URL caching (rejected: same domain has infinite URL variants)
- Subdomain-aware caching (rejected: BuiltWith returns root domain data regardless)
- Using a library like `psl` for public suffix list parsing (deferred: adds dependency for edge case benefit; simple regex sufficient for 99% of cases)

## R2: Cache Storage Strategy

**Decision**: PostgreSQL table via Prisma with JSONB column for the full BuiltWith API response.

**Rationale**:
- The existing codebase uses PostgreSQL (RDS) for all persistent data and Redis (ElastiCache) for ephemeral data (queues, sessions, conversation state)
- Cache entries contain large JSONB payloads (full BuiltWith API response with technologies, metadata, etc.) — not suitable for Redis value size limits and memory cost
- PostgreSQL supports efficient JSONB indexing and querying
- Cache entries must survive ECS task restarts and Redis evictions
- The existing `TechReportCache` model demonstrates the pattern for DB-backed caching

**Alternatives considered**:
- Redis cache (rejected: large payloads, memory cost at scale, eviction risk, no JSONB query)
- Separate caching service/DynamoDB (rejected: adds infrastructure complexity; RDS has ample capacity)
- Filesystem cache (rejected: ECS Fargate has ephemeral storage)

## R3: Cache Lookup Performance

**Decision**: Batch cache lookups using `WHERE normalizedDomain IN (...)` query before processing companies, rather than individual lookups per domain.

**Rationale**:
- A 5,000-row file may have 2,000-3,000 unique domains
- Individual `SELECT` per domain would mean 2,000-3,000 DB roundtrips adding 200-300ms+ overhead
- A single `IN` query retrieves all cached entries in one roundtrip (<50ms for 5,000 keys with index)
- The technographic worker already extracts unique domains before processing
- Batch result is loaded into an in-memory Map for O(1) lookups during per-company processing

**Alternatives considered**:
- Individual lookups with connection pooling (rejected: still N roundtrips)
- Redis-based lookup cache on top of PostgreSQL (rejected: unnecessary complexity; single PG query is fast enough)
- Pre-warming cache into Redis on worker start (rejected: Redis memory, staleness concerns)

## R4: Concurrent Write Handling

**Decision**: Upsert (INSERT ... ON CONFLICT DO UPDATE) strategy. Last write wins.

**Rationale**:
- Two enrichment jobs may process the same domain simultaneously
- Both jobs call BuiltWith and get the same data (or nearly identical if timing differs slightly)
- Upsert on `normalizedDomain` unique constraint ensures no duplicate entries
- The "last write wins" approach is acceptable because both writes contain valid, recent data
- Prisma supports `upsert()` natively with `where` + `create` + `update` blocks

**Alternatives considered**:
- Row-level locking (rejected: adds contention for no meaningful benefit)
- Queue-level dedup to prevent concurrent enrichment of same domain (rejected: complex orchestration across jobs)
- Application-level distributed lock via Redis (rejected: over-engineering for this use case)

## R5: Cache Metrics Collection

**Decision**: Track cache hits/misses per enrichment job via dedicated counters in the Job record, plus aggregate metrics computed from DomainEnrichmentCache table metadata.

**Rationale**:
- Per-job metrics (hits, misses) are needed for the job summary message in Slack (FR-016)
- Aggregate metrics (total entries, hit rate, estimated savings) are computed on-demand for the admin dashboard (FR-017)
- "Estimated credits saved" = sum of all cache hits across jobs × 1 credit per hit (BuiltWith charges 1 credit per domain lookup)
- A `hitCount` column on the cache entry tracks how many times each entry was reused

**Alternatives considered**:
- Separate metrics table (rejected: adds write overhead per cache hit; existing ApiUsageLog already tracks fresh calls)
- Redis counters for real-time metrics (rejected: ephemeral; dashboard queries can compute from DB)

## R6: Slack UI Integration for Force-Refresh

**Decision**: Add a checkbox/toggle to the enrichment type confirmation step (in `enrichmentType.ts` handler) that defaults to "Use cached data: ON". Users can uncheck to force fresh lookups.

**Rationale**:
- The enrichment flow already has multiple decision points (list type → enrichment type → purpose → filters → co-sell)
- Adding the cache toggle at the enrichment type confirmation step (early in the flow) avoids adding another step
- Default ON maximizes cache usage (cost savings)
- The toggle value is stored in the Redis conversation state and passed through to the BullMQ job data

**Alternatives considered**:
- Separate modal for cache settings (rejected: adds friction to the flow)
- Per-domain force-refresh (rejected: spec says per-job setting)
- Always use cache with no toggle (rejected: spec requires force-refresh option)

## R7: Admin Dashboard Cache Page

**Decision**: Add a new "Cache" page to the admin dashboard with two sections: Metrics and Configuration.

**Rationale**:
- Follows existing admin dashboard patterns (e.g., Usage page, Billing page)
- Metrics section shows: total entries, hit rate (7/30 days), estimated credits saved, cache size
- Configuration section shows: TTL setting (slider 30-90 days), Purge All button with confirmation
- Backend API endpoints follow existing REST patterns in `src/routes/admin/`

**Alternatives considered**:
- Embedding cache metrics in the existing Usage page (rejected: cache is a distinct concern with its own configuration)
- CLI-only cache management (rejected: spec requires admin dashboard UI)

## R8: Cache Purge Worker

**Decision**: BullMQ repeatable job running daily at 02:00 UTC to delete expired entries.

**Rationale**:
- Follows existing pattern: `registerAdminRepeatableJobs()` already schedules `dailyAggregate` and `retentionPurge` workers
- Daily purge is sufficient since TTL is measured in days (30-90)
- Uses `DELETE FROM domain_enrichment_cache WHERE expires_at < NOW()` via Prisma
- Logs purge count to AuditLog for SOC 2 compliance

**Alternatives considered**:
- PostgreSQL `pg_cron` extension (rejected: adds PG dependency outside Prisma control)
- On-read expiry (lazy deletion) (rejected: stale entries accumulate, cache size grows unbounded)
- Hourly purge (rejected: unnecessary frequency for day-level TTL)
