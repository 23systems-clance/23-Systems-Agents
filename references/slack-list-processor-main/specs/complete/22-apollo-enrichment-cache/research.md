# Research: Apollo Enrichment Cache

**Feature**: 22-apollo-enrichment-cache
**Date**: 2026-03-11

## R1: Search Cache Key Design (Domain + Filter Hash)

**Decision**: Composite cache key of `normalizedDomain + filterHash`. The filter hash is a deterministic SHA-256 hash of sorted filter arrays concatenated with delimiters.

**Rationale**:
- Apollo people search (`/api/v1/mixed_people/api_search`) returns different results for different filter combinations (seniority, titles, departments, functions, perPage)
- Two jobs searching the same domain with the same filters get the same results
- Two jobs searching the same domain with different filters must NOT share cache entries
- A deterministic hash ensures order-independent matching: `[vp, director, c_suite]` and `[c_suite, director, vp]` produce the same hash
- SHA-256 is sufficient for uniqueness and produces a fixed-length key

**Hash construction**:
1. Sort each filter array alphabetically
2. Join arrays with `|` separator
3. Concatenate all filter groups with `::` delimiter: `seniorities::titles::departments::functions::perPage`
4. SHA-256 hash the concatenated string
5. Final cache key: `normalizedDomain + filterHash` (unique composite constraint)

**Alternatives considered**:
- Storing full filter arrays as JSONB and querying with containment (rejected: slower lookups, no index efficiency)
- Using only domain as cache key (rejected: different filters return different contacts)
- MD5 hash (rejected: collision-prone; SHA-256 is standard and negligible cost difference)

## R2: Contact Cache Key Design (Apollo Person ID)

**Decision**: Cache key is the Apollo person ID (`apolloPersonId`), a stable unique identifier assigned by Apollo to each individual.

**Rationale**:
- Apollo's bulk_match endpoint returns enriched data keyed by person ID
- The same person ID appears consistently across searches — if "John Doe" at acme.com is found via people search, his person ID is stable across jobs
- Person IDs are globally unique in Apollo's system
- This enables cache hits when the same individual appears across multiple jobs (different clients enriching overlapping companies)

**Alternatives considered**:
- Email-based cache key (rejected: not all contacts have emails from the free search; email can change)
- Name + company composite key (rejected: not unique, name variations, company changes)
- No contact-level caching (rejected: misses the primary cost savings opportunity)

## R3: Search Cache TTL

**Decision**: Default 14 days, configurable 7-30 days.

**Rationale**:
- Apollo refreshes contact data approximately weekly
- 14-day TTL means search results are at most 2 weeks old — acceptable for prospecting
- Shorter than Feature 17's BuiltWith cache (60 days) because people change jobs more frequently than companies change tech stacks
- 7-day minimum ensures we still get cache hits across weekly enrichment runs
- 30-day maximum limits staleness risk

**Alternatives considered**:
- 7-day TTL matching Apollo's refresh cycle (rejected: too short for many use cases; reduces hit rate significantly)
- 30-day TTL matching contact cache (rejected: search results go stale faster; people leave companies)
- No TTL (permanent cache) (rejected: unacceptable staleness for people data)

## R4: Contact Cache TTL

**Decision**: Default 30 days, configurable 14-60 days.

**Rationale**:
- Enriched contact data (email, LinkedIn, title, seniority) changes less frequently than search result membership
- A person's email and LinkedIn URL are relatively stable for 30 days
- This TTL aligns with typical campaign cycles (1-2 month campaigns)
- Longer than search TTL because individual contact attributes change less than which contacts are associated with a company

**Alternatives considered**:
- 14-day TTL matching search cache (rejected: too aggressive for contact details; unnecessary credit spend)
- 60-day TTL matching BuiltWith (rejected: job titles and roles do change monthly)
- Separate TTLs for phone vs. non-phone data (rejected: over-complicates the model for minimal benefit; phone flag handles the cache miss case)

## R5: Phone-Aware Cache Logic

**Decision**: Contact cache entries have a `hasPhoneData` boolean flag. A cache entry WITHOUT phone data is treated as a miss when the current job requires phone reveal.

**Rationale**:
- Phone reveal costs an additional credit per contact in bulk enrichment
- A contact enriched without phone reveal has useful data (email, LinkedIn, title) but lacks phone numbers
- If a subsequent job needs phones, we must re-enrich to get phone data
- After re-enrichment with phones, the cache entry is updated to include phone data (`hasPhoneData: true`)
- A cache entry WITH phone data satisfies ALL requests (phone and non-phone), since it's a superset

**Cache hit matrix**:

| Cached State | Job Needs Phones | Result |
|-------------|-----------------|--------|
| hasPhoneData: true | Yes | HIT — use cached data with phones |
| hasPhoneData: true | No | HIT — use cached data (ignore phone fields) |
| hasPhoneData: false | No | HIT — use cached data without phones |
| hasPhoneData: false | Yes | MISS — re-enrich with phone reveal, update cache |

**Alternatives considered**:
- Separate cache entries for phone/non-phone (rejected: doubles cache entries, most contacts converge to phone-inclusive over time)
- Always enrich with phone reveal (rejected: wastes credits when phones not needed)

## R6: Feature 17 Integration

**Decision**: Extend Feature 17's infrastructure rather than duplicate it.

**Rationale**:
- Feature 17 establishes: domain normalizer, force-refresh toggle, admin cache routes pattern, cache purge worker pattern, CacheConfig model, Job cache fields
- Feature 22 adds: filterHasher utility, two new cache models, two new cache services, extensions to the admin API and dashboard
- The CacheConfig singleton from Feature 17 is extended with `apolloSearchTtlDays` and `apolloContactTtlDays` fields
- The cache purge daily worker from Feature 17 is extended to also purge Apollo cache entries
- The admin cache routes are extended with Apollo-specific metrics and config endpoints
- The force-refresh toggle already sets `forceRefresh` on the Job record — both Apollo and BuiltWith workers read this flag

**Alternatives considered**:
- Separate CacheConfig model for Apollo (rejected: unnecessary table proliferation; single config singleton is simpler)
- Separate purge worker for Apollo caches (rejected: follows same daily schedule; one worker can purge all cache tables)
- Independent admin page for Apollo cache (rejected: unified cache dashboard with tabs/sections is better UX)

## R7: Batch Lookup Strategy

**Decision**: Batch lookups for both cache tiers at the start of each job, loaded into in-memory Maps for O(1) access during processing.

**Rationale**:
- Search cache: single `WHERE (normalizedDomain, filterHash) IN (...)` query for all companies in the job
- Contact cache: after search results are resolved (cached or fresh), collect all Apollo person IDs, then single `WHERE apolloPersonId IN (...)` query
- Both queries execute in <50ms with proper indexes
- Results loaded into `Map<string, ApolloSearchCache>` and `Map<string, ApolloContactCache>` for per-company/per-contact lookup during processing
- This two-phase batch approach avoids N individual queries

**Alternatives considered**:
- Individual lookups per domain/contact (rejected: 1000+ DB roundtrips per job)
- Pre-warming both caches together (rejected: contact cache lookup depends on knowing person IDs from search results first — sequential dependency)

## R8: Admin Dashboard Integration

**Decision**: Extend the Feature 17 cache metrics page with Apollo-specific sections rather than creating a separate page.

**Rationale**:
- Feature 17 creates a "Cache" page in the admin dashboard with BuiltWith metrics and config
- Feature 22 adds two Apollo sections to the same page: search cache metrics/config and contact cache metrics/config
- Consistent UX: administrators see all cache metrics in one place
- Backend: extend `GET /api/admin/cache/metrics` to include Apollo metrics, or add `/api/admin/cache/apollo/metrics` as a sub-resource

**Alternatives considered**:
- Separate "Apollo Cache" admin page (rejected: fragmenting cache management across pages is poor UX)
- Embedding in the existing Usage page (rejected: cache has its own configuration needs beyond usage viewing)
