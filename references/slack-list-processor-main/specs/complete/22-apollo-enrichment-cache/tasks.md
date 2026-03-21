# Tasks: Apollo Enrichment Cache

**Input**: Design documents from `/specs/22-apollo-enrichment-cache/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/api-contracts.md, quickstart.md
**Hard Dependency**: Feature 17 (Account-Level Research Cache) must be deployed first.

**Organization**: Tasks grouped by user story. US1 and US2 are both P1 but have a sequential dependency (search cache feeds contact cache). US3 depends on both.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story (US1, US2, US3)
- Exact file paths included in all descriptions

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Prisma schema changes, shared utilities, and configuration

- [x] T001 Add ApolloSearchCache and ApolloContactCache models to prisma/schema.prisma per data-model.md. Add apolloSearchTtlDays and apolloContactTtlDays columns to existing CacheConfig model. Add apolloSearchCacheHits, apolloSearchCacheMisses, apolloContactCacheHits, apolloContactCacheMisses columns to existing Job model. Run prisma db push to apply.
- [x] T002 [P] Create filter hasher utility in src/lib/filterHasher.ts. Implement computeFilterHash(filters: ApolloContactFilters): string function. Sort each filter array (personSeniorities, personTitles, personDepartments, personFunctions) alphabetically, join with "|", concatenate groups with "::" delimiter, append perPage, then SHA-256 hash. Return 64-character hex string. Import ApolloContactFilters from src/types/enrichmentFilters.ts. Use Node.js built-in crypto module.
- [x] T003 [P] Update CacheConfig seed (in prisma/seed.ts or migration) to include default Apollo TTL values: apolloSearchTtlDays: 14, apolloContactTtlDays: 30. Ensure idempotent — if CacheConfig row already exists (from Feature 17), update it to add the new fields.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core cache services that all user stories depend on

**CRITICAL**: No user story work can begin until this phase is complete

- [x] T004 [P] Create ApolloSearchCacheService in src/services/apollo/searchCache.ts. Implement the full service interface per contracts/api-contracts.md: batchLookup(domains, filterHash) using Prisma findMany with WHERE (normalizedDomain IN (...) AND filterHash = ? AND expiresAt > now()); store(entry) using Prisma upsert on (normalizedDomain, filterHash) composite unique with expiresAt = now + ttlDays; recordHit(normalizedDomain, filterHash) using Prisma update to increment hitCount atomically; purgeExpired() and purgeAll(). Use normalizeDomain() from src/lib/domainNormalizer.ts (Feature 17). Read TTL from CacheConfig via getConfig(). Wrap all operations in try/catch — cache failures must never block enrichment.
- [x] T005 [P] Create ApolloContactCacheService in src/services/apollo/contactCache.ts. Implement the full service interface per contracts/api-contracts.md: batchLookup(personIds, requirePhone) using Prisma findMany with WHERE apolloPersonId IN (...) AND expiresAt > now() — when requirePhone is true, also filter by hasPhoneData = true; store(entry) using Prisma upsert on apolloPersonId with expiresAt = now + ttlDays; recordHit(apolloPersonId) increment hitCount; purgeExpired() and purgeAll(). Read TTL from CacheConfig. Wrap all operations in try/catch.

**Checkpoint**: Foundation ready — both cache services available for worker integration

---

## Phase 3: User Story 1 — People Search Cache Across Jobs (Priority: P1) MVP

**Goal**: Contact/combined enrichment workers check search cache before calling Apollo searchPeople. Cache hits skip the API call and use cached contact list. Job summary includes search cache statistics.

**Independent Test**: Enrich a list with 100 companies, then enrich a second list with 50 overlapping companies using the same filters. Verify only 50 Apollo people search calls are made for the second job and Slack summary shows "50 from search cache."

### Implementation for User Story 1

- [x] T006 [US1] Modify contact enrichment worker in src/services/queue/workers/contact.ts. At the start of processing (before the per-company loop), add search cache integration: (1) Compute filterHash from the job's contactFilters using computeFilterHash() from src/lib/filterHasher.ts. (2) Read CacheConfig to check if cache is enabled. (3) If enabled and job.forceRefresh is false, call apolloSearchCacheService.batchLookup(allDomains, filterHash) to pre-load cached search results into a Map<string, ApolloSearchCache>. (4) In the per-company loop, before calling searchPeople(): check if normalizedDomain exists in the search cache Map. On cache hit: extract cached contacts array, call apolloSearchCacheService.recordHit(), increment local searchCacheHits counter, skip the searchPeople API call. On cache miss: call searchPeople() as before, then call apolloSearchCacheService.store() with the result, increment local searchCacheMisses counter. (5) After all companies processed, update Job record with apolloSearchCacheHits and apolloSearchCacheMisses via prisma.job.update().
- [x] T007 [US1] Create a helper function in src/services/apollo/searchCache.ts named mapCacheEntryToContacts() that converts the ApolloSearchCache.contacts JSONB array back to an ApolloContact[] array matching the interface returned by searchPeople() in src/services/apollo/peopleSearch.ts. Ensure all fields map correctly so downstream processing (persona classification, bulk enrichment) works identically for cached and fresh contacts.
- [x] T008 [US1] Handle zero-result search caching. In the cache miss branch of T006, after a searchPeople() call returns an empty array, still call apolloSearchCacheService.store() with resultCount: 0 and an empty contacts array. On future cache hit with resultCount: 0, skip the company entirely (no contacts to enrich) — same behavior as a fresh search returning zero results.
- [x] T009 [US1] Modify combined enrichment worker in src/services/queue/workers/combined.ts. Apply the same search cache integration from T006 to Phase B (contact enrichment phase) of the combined worker. The combined worker already runs BuiltWith in Phase A, then Apollo in Phase B. Insert the search cache check at the start of Phase B using the same pattern.
- [x] T010 [US1] Update the Slack job summary message to include Apollo search cache statistics. Find the job completion message builder and add: "{totalCompanies} companies searched ({searchCacheHits} from cache, {searchCacheMisses} fresh searches)" when searchCacheHits > 0.
- [x] T011 [US1] Handle cache service unavailability. Wrap the batchLookup call in T006 with try/catch. If the cache query fails, log a warning and proceed with an empty Map — all companies treated as cache misses. Enrichment must never fail because of cache issues.

**Checkpoint**: Search cache works end-to-end. Enrichment jobs automatically cache and reuse Apollo search results.

---

## Phase 4: User Story 2 — Contact Enrichment Cache Across Jobs (Priority: P1)

**Goal**: After search results are resolved (cached or fresh), the worker checks the contact cache before sending contacts to bulk enrichment. Cache hits skip the credit-consuming API call. Phone-aware cache miss logic ensures contacts are re-enriched when phones are needed but not cached.

**Independent Test**: Enrich a list where bulk enrichment returns contact "john@acme.com" (person ID: abc123). Enrich a second list also containing acme.com. Verify the second job reuses cached enrichment data and does not consume an Apollo credit for that contact.

### Implementation for User Story 2

- [x] T012 [US2] Modify contact enrichment worker in src/services/queue/workers/contact.ts. After search results are resolved for all companies (from cache or fresh API), collect all unique apolloPersonId values from the search results. Determine if the current job requires phone reveal (purpose === 'COLD_CALLING' || purpose === 'ALL'). Call apolloContactCacheService.batchLookup(allPersonIds, requirePhone) to pre-load cached enrichment data into a Map<string, ApolloContactCache>. Before adding a contact to the bulk enrichment batch: check if their apolloPersonId exists in the contact cache Map. On cache hit: map cached data to JobContact fields (name, email, title, seniority, linkedin, timezone, phone if available), call apolloContactCacheService.recordHit(), increment local contactCacheHits counter, skip adding to bulk enrichment batch. On cache miss: include in bulk enrichment batch as before. After bulk enrichment returns, call apolloContactCacheService.store() for each newly enriched contact with hasPhoneData set based on whether phone reveal was requested and phones were returned. Update Job with apolloContactCacheHits and apolloContactCacheMisses.
- [x] T013 [US2] Create a helper function in src/services/apollo/contactCache.ts named mapCacheEntryToJobContact() that converts an ApolloContactCache row to the fields needed for a JobContact record (fullName, firstName, lastName, email, jobTitle, seniorityLevel, linkedinUrl, timezoneUtc, timezoneLabel, directPhone, businessPhone, apolloPersonId, apolloMetadata). Ensure downstream processing (persona classification, file generation) works identically for cached and fresh contacts.
- [x] T014 [US2] Implement phone-aware cache miss logic per research R5. In the batchLookup call from T012: when requirePhone is true, the service filters by hasPhoneData = true. Contacts cached WITHOUT phone data will not appear in results when phones are needed, causing a natural cache miss. After re-enrichment with phone reveal, the store() upsert updates the existing cache entry to hasPhoneData: true with phone numbers included. A contact cached WITH phone data satisfies all requests.
- [x] T015 [US2] Apply the same contact cache integration from T012 to the combined worker in src/services/queue/workers/combined.ts Phase B. Use the same pattern: collect person IDs after search resolution, batch lookup contact cache, filter bulk enrichment batch, cache new results.
- [x] T016 [US2] Ensure cache hits do NOT create ApiUsageLog entries for bulk enrichment (FR-015). Verify that trackUsage() for the 'BulkEnrich' endpoint is called with the REDUCED contact count (only contacts that were actually sent to Apollo, not cached ones). The existing trackUsage call should naturally use the actual batch size, but verify creditsConsumed reflects only fresh enrichments.
- [x] T017 [US2] Update the Slack job summary message to include Apollo contact cache statistics. Add: "{totalContacts} contacts enriched ({contactCacheHits} from cache, {contactCacheMisses} fresh, ~{creditsSaved} credits saved)" when contactCacheHits > 0.

**Checkpoint**: Both cache tiers work end-to-end. Enrichment jobs save Apollo credits by reusing cached contact enrichment data.

---

## Phase 5: User Story 3 — Apollo Cache Metrics and Admin Controls (Priority: P2)

**Goal**: Admin dashboard shows Apollo cache performance metrics and allows TTL configuration and cache purging for both search and contact caches independently.

**Independent Test**: Navigate to admin dashboard cache page. Verify Apollo search cache and contact cache metrics are displayed. Change TTLs and verify persistence. Purge each cache and verify entries removed.

### Backend (Admin API)

- [x] T018 [P] [US3] Create Apollo cache admin routes. Either extend src/routes/admin/cache.ts or create src/routes/admin/apolloCache.ts (following Feature 17 patterns). Implement 7 endpoints per contracts/api-contracts.md: GET /apollo/metrics (aggregate hit rates from Job apolloSearch/ContactCacheHits/Misses by period, count entries, compute cache size, top domains/contacts by hitCount, estimatedCreditsSaved from contact cache hits); GET /apollo/config (read apolloSearchTtlDays and apolloContactTtlDays from CacheConfig); PUT /apollo/config (validate search TTL 7-30, contact TTL 14-60, update CacheConfig, AuditLog entry); POST /apollo/purge (accept target: search/contact/both and mode: all/expired, call appropriate service purge methods, AuditLog entry); GET /apollo/search-entries (paginated list with search/sort); GET /apollo/contact-entries (paginated list with search/sort and hasPhoneData filter); DELETE /apollo/entries/:id (delete by ID with type param, AuditLog entry). Apply adminAuth and adminRateLimit.
- [x] T019 [US3] Register Apollo cache routes in src/routes/admin/index.ts. Mount at appropriate path under the existing admin router, following the pattern used for other admin route modules.

### Extend Cache Purge Worker

- [x] T020 [P] [US3] Extend the Feature 17 cache purge worker in src/services/queue/workers/cachePurge.ts. Add calls to apolloSearchCacheService.purgeExpired() and apolloContactCacheService.purgeExpired() alongside the existing DomainEnrichmentCache purge. Log purge counts for all three caches. Update AuditLog metadata to include apolloSearchPurged and apolloContactPurged counts.

### Frontend (Admin Dashboard)

- [x] T021 [P] [US3] Create ApolloCacheStatsCard component in admin-dashboard/src/components/cache/ApolloCacheStatsCard.tsx. Display two sections (search cache, contact cache) with: entries count, hit rate (7d/30d), and for contact cache: estimated credits saved, cost saved (USD), phone data breakdown. Fetch from GET /api/admin/cache/apollo/metrics.
- [x] T022 [P] [US3] Create ApolloCacheConfigPanel component in admin-dashboard/src/components/cache/ApolloCacheConfigPanel.tsx. Display: search TTL slider (7-30 days), contact TTL slider (14-60 days), Save button calling PUT /api/admin/cache/apollo/config. Include "Purge Search Cache" and "Purge Contact Cache" buttons with confirmation dialogs calling POST /apollo/purge with appropriate target.
- [x] T023 [US3] Extend the CacheMetrics page in admin-dashboard/src/pages/CacheMetrics.tsx. Add Apollo sections below the BuiltWith section (from Feature 17): ApolloCacheStatsCard and ApolloCacheConfigPanel. Optionally add tabbed entry browsers for search and contact cache entries using GET /apollo/search-entries and /apollo/contact-entries.

**Checkpoint**: Admins can view Apollo cache metrics, configure TTLs independently, and purge each cache from the dashboard.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Edge cases, force-refresh integration, and deployment verification

- [x] T024 [P] Verify force-refresh toggle integration. The Feature 17 "Use cached data" toggle sets forceRefresh on the Job record. Confirm that when forceRefresh is true: (1) search cache batchLookup is skipped (all companies get fresh searches), (2) contact cache batchLookup is skipped (all contacts get fresh enrichment), (3) fresh results are still stored in both caches, (4) all Job cache counters reflect 0 hits. Update worker logic if needed.
- [x] T025 [P] Verify audit logging for all admin Apollo cache operations. Confirm PUT /apollo/config, POST /apollo/purge, and DELETE /apollo/entries/:id all create AuditLog entries with correct action names, metadata, and timestamps per Constitution Principle V.
- [x] T026 Run quickstart.md verification steps: (1) Deploy to ECS. (2) Enrich a list with 100 companies. (3) Enrich a second list with 50 overlapping companies (same filters). (4) Verify Slack summary shows search cache hits and contact cache hits. (5) Verify admin dashboard shows Apollo cache entries, hit rates, and credits saved. (6) Enrich a list requiring phones — verify phone-aware cache miss works. (7) Verify ApiUsageLog credits reflect only fresh enrichments.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies within this feature — but requires Feature 17 deployed (CacheConfig, Job cache fields, domainNormalizer exist)
- **Phase 2 (Foundational)**: Depends on T001 (Prisma schema) and T002 (filter hasher)
- **Phase 3 (US1 — Search Cache)**: Depends on Phase 2 (T004 search cache service)
- **Phase 4 (US2 — Contact Cache)**: Depends on Phase 3 (T006 search cache worker integration provides person IDs for contact cache lookup) AND Phase 2 (T005 contact cache service)
- **Phase 5 (US3 — Admin Dashboard)**: Backend (T018-T020) depends on Phase 2. Frontend (T021-T023) depends on backend. Can start backend in parallel with US1/US2.
- **Phase 6 (Polish)**: Depends on all user stories being complete

### User Story Dependencies

- **US1 (P1 — Search Cache)**: Depends only on foundational services (Phase 2). Independent of US2/US3.
- **US2 (P1 — Contact Cache)**: Depends on US1 (search results provide person IDs for contact cache lookup). The two-phase batch approach requires search results first.
- **US3 (P2 — Admin Dashboard)**: Backend depends only on Phase 2. Frontend depends on backend. Can develop backend in parallel with US1/US2.

### Within Each User Story

- Cache service before worker integration
- Worker integration before Slack message updates
- Backend routes before frontend components

### Parallel Opportunities

- **Phase 1**: T002 (filter hasher) and T003 (seed config) can run in parallel after T001
- **Phase 2**: T004 (search cache service) and T005 (contact cache service) can run in parallel
- **Phase 3 + Phase 5 backend**: US1 worker integration and US3 admin API routes can proceed in parallel
- **Phase 5**: T018 (API routes), T020 (purge worker), T021 (stats card), T022 (config panel) all parallelizable
- **Phase 6**: T024 and T025 can run in parallel

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (T001-T003)
2. Complete Phase 2: Foundational services (T004-T005)
3. Complete Phase 3: US1 search cache (T006-T011)
4. **STOP and VALIDATE**: Deploy, enrich two overlapping lists, verify search cache hits in Slack summary
5. This delivers time savings and rate-limit relief (search is free but throttled)

### Incremental Delivery

1. Setup + Foundational → Cache services ready
2. US1 (search cache) → Deploy → Validate time savings (MVP!)
3. US2 (contact cache) → Deploy → Validate Apollo credit savings (primary cost savings!)
4. US3 (admin dashboard) → Deploy → Admins monitor and configure caches
5. Polish → Deploy → Force-refresh verified, audit logging confirmed
