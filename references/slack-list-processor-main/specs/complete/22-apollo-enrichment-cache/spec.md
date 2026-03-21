# Feature Specification: Apollo Enrichment Cache

**Feature Branch**: `22-apollo-enrichment-cache`
**Created**: 2026-03-11
**Status**: Draft
**Input**: Cache Apollo company-level metadata and contact lookup results where possible to reduce API costs, similar to the BuiltWith domain cache but scoped to what's cacheable given Apollo's persona/filter-specific queries.

## Context

The enrichment pipeline makes two categories of Apollo API calls per job: (1) people search to find decision makers at a company, and (2) bulk enrichment to reveal full contact details (email, LinkedIn, phone). When multiple enrichment jobs target overlapping companies with the same filter criteria, the people search returns identical results — but today each job repeats the search. Bulk enrichment is even more expensive at 1-2 credits per contact, and when the same individual appears across multiple jobs, the system pays to enrich them again.

Adding two cache layers — a search results cache keyed by domain + filter combination, and a contact enrichment cache keyed by individual person identifier — can significantly reduce Apollo API costs and rate-limit pressure without sacrificing data freshness.

**Relationship to Feature 17**: Feature 17 (Account-Level Research Cache) caches BuiltWith domain lookups. This feature applies the same pattern to Apollo, but with two distinct cache tiers reflecting Apollo's data structure: company-level search results and individual contact enrichment data.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - People Search Cache Across Jobs (Priority: P1)

As a BDR manager, I need the system to automatically reuse recent Apollo people search results for companies that were already searched with the same filters, so that enrichment jobs run faster and stay within Apollo's rate limits.

**Why this priority**: People search is free (0 credits) but rate-limited to 200 requests/minute with a 400ms throttle between calls. A 1,000-company list takes 6.5+ minutes just for people search throttling. Caching eliminates redundant searches, cutting enrichment time for overlapping lists dramatically. It also reduces the risk of hitting Apollo rate limits during high-volume periods.

**Independent Test**: Enrich a list with 100 companies using default seniority filters. Then enrich a second list with 50 of the same companies plus 50 new ones using the same filters. Verify that only 50 Apollo people search calls are made for the second job and the other 50 use cached results.

**Acceptance Scenarios**:

1. **Given** company "acme.com" was searched with filters [c_suite, vp, director] 10 days ago (within default 14-day TTL), **When** a new job searches acme.com with the same filters, **Then** the cached search results are used and no Apollo API call is made.
2. **Given** company "acme.com" was searched with filters [c_suite, vp, director], **When** a new job searches acme.com with different filters [manager, senior], **Then** a fresh Apollo search is made (different cache key).
3. **Given** a 500-company list where 300 companies have valid cached search results matching the current filters, **When** the enrichment runs, **Then** only 200 Apollo people search calls are made.
4. **Given** cached search results are used, **When** the enrichment completes, **Then** the job summary shows: "500 companies searched (300 from cache, 200 fresh searches)."
5. **Given** the cached search results, **When** the contacts are passed to bulk enrichment, **Then** the contact data quality is identical to a fresh search.

---

### User Story 2 - Contact Enrichment Cache Across Jobs (Priority: P1)

As a BDR manager, I need the system to automatically reuse recent Apollo bulk enrichment results for contacts that were already enriched, so that I save Apollo credits when the same person appears in multiple enrichment jobs.

**Why this priority**: Bulk enrichment costs 1 credit per contact (2 credits if phone reveal is included). When the same decision maker (e.g., the CTO of a Fortune 500 company) appears across multiple client lists, the system currently pays to enrich them each time. Caching by person identifier eliminates this redundancy. This is the primary cost savings opportunity.

**Independent Test**: Enrich a list where bulk enrichment returns contact "john.doe@acme.com" (Apollo person ID: abc123). Then enrich a second list that also contains acme.com and produces the same contact. Verify that the second job reuses the cached enrichment data and does not consume an Apollo credit for that contact.

**Acceptance Scenarios**:

1. **Given** contact with person ID "abc123" was enriched 10 days ago (within default 30-day TTL), **When** a new job's search results include the same person ID, **Then** the cached enrichment data is used and no bulk enrichment credit is consumed.
2. **Given** 50 contacts found via people search, **When** 20 of those contacts have valid cached enrichment data, **Then** only 30 contacts are sent to bulk enrichment, saving 30 credits (or 60 if phone reveal).
3. **Given** cached enrichment data is used, **When** the user downloads the output file, **Then** there is no difference in data quality between cached and freshly enriched contacts.
4. **Given** cached contacts, **When** the enrichment completes, **Then** the job summary shows: "50 contacts enriched (20 from cache, 30 fresh lookups)."
5. **Given** a contact was cached WITHOUT phone data, **When** a new job requests phone reveal for that contact, **Then** the system makes a fresh bulk enrichment call with phone reveal (cache miss for phone-inclusive enrichment).

---

### User Story 3 - Apollo Cache Metrics and Admin Controls (Priority: P2)

As a platform administrator, I need visibility into Apollo cache performance and the ability to configure TTL and purge entries, so that I can monitor cost savings and tune the cache.

**Why this priority**: Without metrics, administrators cannot quantify Apollo credit savings or detect stale data issues. This story extends the admin dashboard (or integrates with Feature 17's cache dashboard) to cover Apollo caches.

**Independent Test**: View the admin dashboard after running several enrichment jobs. Verify Apollo search cache and contact cache metrics (hit rate, entries, estimated credits saved) are displayed. Change TTL and verify it persists. Purge cache and verify entries are removed.

**Acceptance Scenarios**:

1. **Given** the admin dashboard, **When** an administrator navigates to the Apollo cache section, **Then** they see: search cache entries, contact cache entries, search cache hit rate, contact cache hit rate, estimated Apollo credits saved, and cache sizes.
2. **Given** the cache settings, **When** an administrator changes the search cache TTL from 14 to 7 days, **Then** entries older than 7 days are eligible for eviction on the next purge cycle.
3. **Given** the cache settings, **When** an administrator changes the contact cache TTL from 30 to 14 days, **Then** entries older than 14 days are eligible for eviction on the next purge cycle.
4. **Given** the admin dashboard, **When** an administrator clicks "Purge All" for either cache, **Then** all entries in that cache are removed with a confirmation prompt.

---

### Edge Cases

- What happens when the Apollo API is unavailable? The enrichment pipeline falls back to making fresh API calls as it does today. Cache misses should never block enrichment.
- What happens when a cached person search returns contacts that no longer work at the company? The search cache TTL (14 days) limits staleness. Apollo refreshes contact data weekly, so a 14-day window means data is at most 2 weeks old — acceptable for prospecting.
- What happens when a cached contact's enrichment data is outdated (e.g., changed job title)? The contact enrichment cache TTL (30 days) handles this. Force-refresh can be used for immediate re-enrichment.
- What happens when the same domain is searched with many different filter combinations? Each unique filter combination creates a separate cache entry. In practice, most workspaces use 1-3 enrichment presets, so the cache key space is bounded.
- What happens when a cached search result found 0 contacts for a domain? Zero-result searches are cached to avoid redundant calls to Apollo for domains with no matching contacts. These entries use the same TTL.
- What happens when a contact was cached without phone data and a new job needs phones? This is a cache miss for the phone-inclusive variant. The system makes a fresh bulk enrichment call with phone reveal enabled and caches the result with the phone-inclusive flag.
- What happens when two jobs simultaneously enrich the same company? Same as Feature 17 — last write wins via upsert. Both jobs produce valid results.

## Requirements _(mandatory)_

### Functional Requirements

**Search Cache**
- **FR-001**: System MUST maintain a cache of Apollo people search results keyed by normalized domain plus filter combination, with configurable TTL (default: 14 days, range: 7-30 days).
- **FR-002**: Cache entries MUST store: normalized domain, filter hash (seniority + titles + departments + functions), full list of returned contacts (person IDs, names, job titles), result count, search timestamp, expiry timestamp.
- **FR-003**: The search cache MUST be shared across all workspaces (Apollo contact data for a given company + filter combo is not tenant-specific).
- **FR-004**: Before making an Apollo people search call, the enrichment worker MUST check the search cache using the normalized domain and current filter combination.
- **FR-005**: On search cache hit, the worker MUST use the cached contact list without making an Apollo API call.
- **FR-006**: On search cache miss, the worker MUST make a fresh Apollo search and store the result in the cache.
- **FR-007**: Zero-result searches (domain has no matching contacts) MUST be cached to prevent redundant future searches.

**Contact Enrichment Cache**
- **FR-008**: System MUST maintain a cache of Apollo bulk enrichment results keyed by person identifier, with configurable TTL (default: 30 days, range: 14-60 days).
- **FR-009**: Contact cache entries MUST store: person identifier, full enrichment response (name, email, title, seniority, LinkedIn URL, timezone), whether phone data is included, phone numbers (if revealed), enrichment timestamp, expiry timestamp.
- **FR-010**: The contact enrichment cache MUST be shared across all workspaces.
- **FR-011**: Before sending a contact to bulk enrichment, the worker MUST check the contact cache using the person identifier.
- **FR-012**: On contact cache hit, the worker MUST use the cached enrichment data without consuming an Apollo credit.
- **FR-013**: On contact cache miss, the worker MUST include the contact in the bulk enrichment batch and cache the result.
- **FR-014**: If a cached contact does NOT have phone data but the current job requires phone reveal, the system MUST treat it as a cache miss and re-enrich with phone reveal.
- **FR-015**: Cache hits MUST NOT count toward the workspace's Apollo API usage for billing purposes.

**Force Refresh**
- **FR-016**: The existing "Use cached data" toggle (from Feature 17) MUST also apply to Apollo caches. When force-refresh is enabled, both Apollo caches are bypassed.

**Cache Maintenance**
- **FR-017**: A scheduled job MUST run daily to purge expired entries from both caches.
- **FR-018**: Administrators MUST be able to manually purge each Apollo cache independently via the admin dashboard.
- **FR-019**: Administrators MUST be able to configure TTL for each cache independently via the admin dashboard.

**Metrics**
- **FR-020**: System MUST track Apollo search cache hits and misses per enrichment job.
- **FR-021**: System MUST track Apollo contact cache hits and misses per enrichment job.
- **FR-022**: The job summary MUST include Apollo cache statistics (companies from search cache, contacts from enrichment cache, credits saved).
- **FR-023**: The admin dashboard MUST display Apollo cache metrics: entries per cache, hit rates, estimated credits saved.

### Key Entities

- **ApolloSearchCache**: A cached people search result for a normalized domain + filter combination. Contains: normalizedDomain, filterHash (deterministic hash of seniority + titles + departments + functions + perPage), contacts (list of person IDs, names, titles from search), resultCount, searchedAt, expiresAt, hitCount.
- **ApolloContactCache**: A cached bulk enrichment result for an individual contact. Contains: apolloPersonId (unique key), fullName, email, jobTitle, seniorityLevel, linkedinUrl, timezoneUtc, timezoneLabel, hasPhoneData (boolean flag), directPhone, businessPhone, enrichedAt, expiresAt, hitCount.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: Contact enrichment cache reduces Apollo bulk enrichment credits by at least 15% within the first 30 days of deployment (measured across all workspaces).
- **SC-002**: Search cache reduces Apollo people search API calls by at least 25% within the first 30 days, directly reducing enrichment job duration.
- **SC-003**: Cache lookup adds less than 100ms total overhead per enrichment job (batch lookup for all domains/contacts combined).
- **SC-004**: Cached results produce identical output quality compared to fresh API calls (zero data degradation).
- **SC-005**: Apollo cache metrics are available in the admin dashboard within 24 hours of deployment.
- **SC-006**: Enrichment jobs with high cache overlap complete at least 30% faster than equivalent uncached jobs (due to reduced API throttling wait time).

## Assumptions

- The people search cache uses a composite key of normalized domain + deterministic filter hash. Two jobs with the same domain but different filters produce different cache entries.
- The contact enrichment cache is keyed by Apollo person ID, which is a stable unique identifier for individuals across all Apollo API calls.
- Phone data inclusion is a flag on the contact cache entry. A cache entry WITHOUT phone data does not satisfy a request that requires phone reveal — this triggers a fresh enrichment.
- Both caches are stored in the same persistent storage as the BuiltWith cache (Feature 17) for consistency.
- Search cache TTL is shorter (14 days) than contact cache TTL (30 days) because people change companies more frequently than their contact details change.
- The "Use cached data" toggle from Feature 17 applies globally to all cache layers (BuiltWith + Apollo). There is no per-service cache toggle.
- Apollo's api_search endpoint is free (0 credits), so the search cache primarily saves time and rate-limit headroom, not money. The contact enrichment cache is where real credit savings occur.
- The filter hash is computed deterministically: filter arrays are sorted alphabetically before hashing so that [vp, director, c_suite] and [c_suite, director, vp] produce the same hash.
