# Feature Specification: Account-Level Research Cache

**Feature Branch**: `17-account-research-cache`
**Created**: 2026-03-10
**Status**: Draft
**Input**: Gap analysis from sales_engineer_agents_framework.md - Section 6.6: "If several contacts come from the same company: research the company once, reuse the account summary across all contacts. This is one of the biggest cost savers."

## Context

The enrichment pipeline currently calls BuiltWith for every domain in every job, even if the same domain was enriched last week for a different client or campaign. Apollo contact searches also repeat company-level lookups. Adding a domain-keyed cache with configurable TTL (30-90 days) means that enrichment results are reused across jobs, across clients, and across time — dramatically reducing API costs without sacrificing data freshness.

## Clarifications

### Session 2026-03-10

- Q: Should the cache be shared across all workspaces or isolated per workspace? -> A: Shared globally. BuiltWith technographic data is not client-specific — it's public company data. Sharing maximizes cache hit rate.
- Q: What should the default cache TTL be? -> A: 60 days. Configurable between 30 and 90 days.
- Q: Should users be able to force a cache refresh? -> A: Yes. A "force refresh" option in the enrichment flow bypasses the cache for that job.
- Q: Should Apollo contact data be cached too? -> A: No, only BuiltWith domain lookups. Apollo contact searches are persona/filter-specific and vary per job. Apollo bulk enrich data is contact-specific, not company-specific.
- Q: How should cache invalidation work? -> A: TTL-based expiry only. No active invalidation needed since tech stacks change slowly.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Automatic Cache Reuse Across Jobs (Priority: P1)

As a BDR manager, I need the system to automatically reuse recent BuiltWith enrichment results for domains that were already enriched, so that I save API credits on repeat lookups.

**Why this priority**: BuiltWith is the most expensive API integration. Caching domain lookups across jobs can reduce BuiltWith API calls by 30-50% in a typical month where multiple lists contain overlapping companies.

**Independent Test**: Enrich a list with 100 domains, then enrich a second list that contains 50 of the same domains plus 50 new ones. Verify that only 50 BuiltWith API calls are made for the second job.

**Acceptance Scenarios**:

1. **Given** domain "acme.com" was enriched 15 days ago (within default 60-day TTL), **When** a new enrichment job includes acme.com, **Then** the cached BuiltWith result is used and no API call is made.
2. **Given** domain "oldco.com" was enriched 75 days ago (outside 60-day TTL), **When** a new enrichment job includes oldco.com, **Then** a fresh BuiltWith API call is made and the cache is updated.
3. **Given** a 500-row file with 200 unique domains, **When** 120 of those domains have valid cached results, **Then** only 80 BuiltWith API calls are made.
4. **Given** cached results are used, **When** the enrichment completes, **Then** the job summary shows: "200 domains enriched (120 from cache, 80 fresh lookups)."
5. **Given** the enrichment results, **When** the user downloads the output file, **Then** there is no difference in data quality or format between cached and fresh results.

---

### User Story 2 - Force Refresh Option (Priority: P2)

As a BDR manager, I need the option to force a cache refresh when I know a company has recently changed its tech stack, so that I get the latest data even if a cached result exists.

**Why this priority**: Occasionally tech stacks change (e.g., after an acquisition or migration). Users need a way to get fresh data without waiting for cache expiry.

**Independent Test**: Enrich a domain that has a cached result, with force-refresh enabled. Verify that a fresh API call is made and the cache is updated.

**Acceptance Scenarios**:

1. **Given** an enrichment flow, **When** the user sees the enrichment confirmation, **Then** a "Use cached data" toggle is shown (default: on). Turning it off forces fresh lookups.
2. **Given** force-refresh is enabled, **When** the enrichment runs, **Then** all BuiltWith API calls are made fresh regardless of cache status.
3. **Given** force-refresh produces new results, **When** the job completes, **Then** the cache is updated with the fresh results and the TTL resets.

---

### User Story 3 - Cache Metrics and Visibility (Priority: P2)

As a platform administrator, I need visibility into cache performance (hit rate, savings, size) so that I can tune the TTL and understand cost savings.

**Why this priority**: Without metrics, administrators cannot quantify the value of caching or detect problems like a cache that's too small or a TTL that's too short.

**Independent Test**: View the admin dashboard cache metrics page after running several enrichment jobs. Verify hit rate, miss rate, estimated savings, and cache size are displayed.

**Acceptance Scenarios**:

1. **Given** the admin dashboard, **When** an administrator navigates to the cache metrics page, **Then** they see: total cache entries, cache hit rate (last 7/30 days), estimated API credits saved, and cache size.
2. **Given** the cache settings page, **When** an administrator changes the TTL from 60 to 30 days, **Then** all entries older than 30 days are eligible for eviction on the next purge cycle.
3. **Given** the cache metrics page, **When** an administrator wants to clear the entire cache, **Then** a "Purge All" button is available with a confirmation prompt.

---

### Edge Cases

- What happens when the cache database is unavailable? The enrichment pipeline falls back to making fresh API calls for all domains. Cache misses should never block enrichment.
- What happens when a cached result has incomplete data (API returned partial response)? Partial results are still cached but marked as incomplete. If encountered during a future job, the system makes a fresh API call to try to get complete data.
- What happens when domain normalization produces a cache hit but the original file had a different domain variant? The cache key is the normalized domain, so www.acme.com, acme.com, and ACME.COM all share the same cache entry.
- What happens when the cache grows very large (100k+ domains)? PostgreSQL handles this volume easily. A periodic cleanup job removes expired entries.
- What happens when a domain was cached but the company no longer exists? The cached result will eventually expire by TTL. Force-refresh can be used for immediate re-check.

## Requirements _(mandatory)_

### Functional Requirements

**Cache Storage**
- **FR-001**: System MUST maintain a domain-keyed cache of BuiltWith enrichment results with configurable TTL (default: 60 days, range: 30-90 days).
- **FR-002**: Cache entries MUST store: normalized domain, full BuiltWith API response (technologies, vertical, traffic rank, tech spend tier), enrichment timestamp, expiry timestamp.
- **FR-003**: The cache MUST be shared across all workspaces (BuiltWith data is not tenant-specific).
- **FR-004**: Domain keys MUST be normalized before cache lookup (lowercase, strip protocol, www, subdomains, trailing slashes).

**Cache Integration**
- **FR-005**: The enrichment worker MUST check the cache before making a BuiltWith API call for each domain.
- **FR-006**: On cache hit (entry exists and is not expired), the worker MUST use the cached result without making an API call.
- **FR-007**: On cache miss or expired entry, the worker MUST make a fresh API call and update the cache.
- **FR-008**: Cache hits MUST NOT count toward the workspace's BuiltWith API usage for billing purposes.
- **FR-009**: Cache misses (fresh API calls) MUST be logged to ApiUsageLog as normal.

**Force Refresh**
- **FR-010**: The enrichment flow MUST offer a "Use cached data" toggle (default: on) that allows users to force fresh lookups.
- **FR-011**: When force-refresh is enabled, the system MUST bypass the cache for all domains in that job and update the cache with fresh results.

**Cache Maintenance**
- **FR-012**: A scheduled job MUST run daily to purge expired cache entries.
- **FR-013**: Administrators MUST be able to manually purge the entire cache via the admin dashboard.
- **FR-014**: Administrators MUST be able to configure the cache TTL via the admin dashboard settings page.

**Metrics**
- **FR-015**: System MUST track cache hit and miss counts per enrichment job.
- **FR-016**: The job summary MUST include cache statistics (domains from cache vs. fresh lookups).
- **FR-017**: The admin dashboard MUST display cache metrics: total entries, hit rate, estimated credits saved, cache size.

### Key Entities

- **DomainEnrichmentCache**: A cached BuiltWith result for a single normalized domain. Contains: normalizedDomain (unique key), builtwithResponse (JSONB - full API response), technologies (JSONB array), vertical, trafficRank, techSpendTier, enrichedAt (timestamp), expiresAt (timestamp), hitCount (integer, incremented on each cache hit).
- **CacheConfig**: Global cache settings. Contains: ttlDays (integer, default 60), enabled (boolean, default true), maxEntries (integer, optional cap).

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: Cache reduces BuiltWith API calls by at least 25% within the first 30 days of deployment (measured across all workspaces).
- **SC-002**: Cache lookup adds less than 50ms overhead per domain to the enrichment pipeline.
- **SC-003**: Cached results produce identical output quality compared to fresh API calls (zero data degradation).
- **SC-004**: Cache hit/miss metrics are available in the admin dashboard within 24 hours of deployment.
- **SC-005**: Expired cache entries are purged within 24 hours of expiration.
- **SC-006**: Force-refresh successfully bypasses cache and updates entries for 100% of requested domains.

## Assumptions

- Only BuiltWith domain lookups are cached. Apollo contact searches are not cached because they are filtered by persona, title, and other job-specific parameters.
- The cache is stored in PostgreSQL (not Redis) because cache entries are large (full API response JSONB) and need to survive Redis restarts.
- The existing TechReportCache pattern provides a reference implementation but serves a different purpose (report results, not individual domain lookups).
- Cache entries are immutable once written — updates create a new entry with a refreshed timestamp. The old entry is overwritten.
- Force-refresh is a per-job setting, not per-domain. When enabled, ALL domains in the job are freshly looked up.
- The cache does not require authentication since BuiltWith data is not tenant-specific.
