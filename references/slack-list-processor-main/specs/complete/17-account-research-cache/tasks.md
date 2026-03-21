# Tasks: Account-Level Research Cache

**Input**: Design documents from `/specs/17-account-research-cache/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/api-contracts.md, quickstart.md

**Organization**: Tasks grouped by user story. Each story is independently testable after foundational phase.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story (US1, US2, US3)
- Exact file paths included in all descriptions

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Prisma schema changes, shared utilities, and core cache service

- [X] T001 Add DomainEnrichmentCache and CacheConfig models to prisma/schema.prisma per data-model.md. Add cacheHits, cacheMisses, forceRefresh columns to existing Job model. Run prisma db push to apply.
- [X] T002 [P] Create domain normalizer utility in src/lib/domainNormalizer.ts. Implement normalizeDomain() function: strip protocol, remove www prefix, lowercase, remove trailing slashes/paths/port. Return null for IP addresses and empty strings. Export as named function.
- [X] T003 [P] Seed default CacheConfig row (ttlDays: 60, enabled: true) in prisma/seed.ts or via a migration script. Ensure idempotent (skip if row exists).

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core cache service that all user stories depend on

**CRITICAL**: No user story work can begin until this phase is complete

- [X] T004 Create DomainCacheService in src/services/builtwith/domainCache.ts. Implement the full internal service interface per contracts/api-contracts.md: batchLookup(domains) using Prisma findMany with WHERE normalizedDomain IN (...) and expiresAt > now(); store(entry) using Prisma upsert on normalizedDomain with expiresAt = now + ttlDays; recordHit(domain) using Prisma update to increment hitCount atomically; getConfig() returning CacheConfig singleton with fallback defaults (ttlDays: 60, enabled: true); purgeExpired() using Prisma deleteMany where expiresAt < now(); purgeAll() using Prisma deleteMany with no filter. Use normalizeDomain() from src/lib/domainNormalizer.ts for all domain key operations. Wrap all operations in try/catch — cache failures must never block enrichment.

**Checkpoint**: Foundation ready — cache service available for worker integration

---

## Phase 3: User Story 1 — Automatic Cache Reuse Across Jobs (Priority: P1) MVP

**Goal**: Enrichment worker checks cache before calling BuiltWith API. Cache hits skip API call, cache misses store results for future reuse. Job summary includes cache statistics.

**Independent Test**: Enrich a list with 100 domains, then enrich a second list with 50 overlapping + 50 new domains. Verify only 50 BuiltWith API calls are made for the second job and Slack summary shows "50 from cache, 50 fresh."

### Implementation for User Story 1

- [X] T005 [US1] Modify technographic worker in src/services/queue/workers/technographic.ts. After extracting unique domains (existing uniqueDomainSet logic around line 88), add cache integration: (1) Call domainCacheService.getConfig() to check if cache is enabled and get TTL. (2) If enabled and job.forceRefresh is false, call domainCacheService.batchLookup(allDomains) to pre-load cached entries into a Map. (3) In the per-company loop (around line 169), before calling enrichDomain(): check if normalizedDomain exists in the batch cache Map. On cache hit: use cached result to populate enrichResult fields (technologies, trafficRank, vertical, etc.), call domainCacheService.recordHit(domain), increment a local cacheHits counter, skip the BuiltWith API call and trackUsage call. On cache miss: call enrichDomain() as before, then call domainCacheService.store() with the full result, increment a local cacheMisses counter. (4) After all companies processed, update Job record with cacheHits and cacheMisses counts via prisma.job.update().
- [X] T006 [US1] Create a helper function in src/services/builtwith/domainCache.ts named mapCacheEntryToEnrichResult() that converts a DomainEnrichmentCache row to a DomainEnrichmentResult object (matching the interface from src/services/builtwith/domainEnricher.ts). Map fields: technologies (parse JSONB), trafficRank, vertical, companyName → companyNameFromApi, location fields, techSpendTier/Score, and set creditsUsed: 0, error: null.
- [X] T007 [US1] Update the Slack job summary message to include cache statistics. Find the job completion message builder (in the technographic worker or file generation worker) and add a line: "{totalDomains} domains enriched ({cacheHits} from cache, {cacheMisses} fresh lookups)" when cacheHits > 0. If cacheHits is 0, omit the cache line to avoid confusion on first runs before cache is populated.
- [X] T008 [US1] Ensure cache hits do NOT create ApiUsageLog entries (FR-008). Verify that trackUsage() is only called on cache misses (fresh BuiltWith API calls). The existing trackUsage call in technographic.ts lines 178-186 should be inside the cache-miss branch only.
- [X] T009 [US1] Handle edge case: incomplete cached entries (isComplete: false). In the cache hit branch of T005, check if entry.isComplete is false. If so, treat as a cache miss — make a fresh API call and update the cache with the new (hopefully complete) result.
- [X] T010 [US1] Handle edge case: cache service unavailable. Wrap the batchLookup call in T005 with a try/catch. If the cache query fails (DB error, timeout), log a warning and proceed with an empty cache Map — all domains will be treated as cache misses. Enrichment must never fail because of cache issues.

**Checkpoint**: At this point, cache reuse works end-to-end. Enrichment jobs automatically cache and reuse BuiltWith results. Slack summary shows cache stats.

---

## Phase 4: User Story 2 — Force Refresh Option (Priority: P2)

**Goal**: Users can disable cache for a specific enrichment job via a Slack UI toggle. When force-refresh is enabled, all domains get fresh BuiltWith lookups and the cache is updated with new results.

**Independent Test**: Enrich a domain that has a cached result with force-refresh enabled. Verify a fresh API call is made, the cache entry is updated with new data, and the TTL resets.

### Implementation for User Story 2

- [X] T011 [US2] Add "Use cached data" toggle to the Slack enrichment confirmation flow in src/listeners/actions/enrichmentType.ts. After the enrichment type buttons (technographic/contacts/combined), add an accessory checkbox element using Slack Block Kit. Block ID: "cache_toggle", action ID: "toggle_cache_usage". Default: checked (use cache). Label: "Use cached data (saves API credits)". Register the action handler to store the toggle value in conversation state via setConversation().
- [X] T012 [US2] Update conversation state type in src/services/state/conversationStore.ts (or wherever ConversationState is defined) to include a new optional field: forceRefresh?: boolean (default: false). Set forceRefresh = true when the user unchecks the cache toggle.
- [X] T013 [US2] Pass forceRefresh from conversation state through to the BullMQ job data. In the job creation code (where enrichmentQueue.add() is called — likely in src/listeners/events/message.ts handleTechnographicFlow or similar), read conversation.forceRefresh and include it in the job data. Also set it on the Job record via prisma.job.create/update.
- [X] T014 [US2] Update TechnographicJobData interface in src/services/queue/queues.ts to include optional forceRefresh?: boolean field.
- [X] T015 [US2] Wire force-refresh into the technographic worker logic from T005. In the cache integration block: if job data has forceRefresh: true, skip the batchLookup entirely (treat all domains as cache misses). After each fresh enrichDomain() call, still call domainCacheService.store() so the cache is updated with the latest data even on force-refresh. Set job.cacheMisses = total unique domains, job.cacheHits = 0.

**Checkpoint**: At this point, users can toggle cache usage per job. Force-refresh bypasses cache and updates entries with fresh data.

---

## Phase 5: User Story 3 — Cache Metrics and Visibility (Priority: P2)

**Goal**: Admin dashboard shows cache performance metrics and allows TTL configuration and cache purging.

**Independent Test**: Navigate to admin dashboard cache page. Verify hit rate, entry count, estimated savings, and cache size are displayed. Change TTL and verify it persists. Purge cache and verify entries are removed.

### Backend (Admin API)

- [X] T016 [P] [US3] Create admin cache routes in src/routes/admin/cache.ts. Implement 6 endpoints per contracts/api-contracts.md: GET /metrics (compute hit rates from Job cacheHits/cacheMisses aggregated by time window, total entries via count, cache size via pg_total_relation_size, top domains by hitCount); GET /config (read CacheConfig singleton); PUT /config (validate ttlDays 30-90, update CacheConfig, create AuditLog entry); POST /purge (accept mode "all" or "expired", call domainCacheService.purgeAll or purgeExpired, create AuditLog entry); GET /entries (paginated list with search/sort, exclude builtwithResponse from response, derive technologyCount from JSONB array length); DELETE /entries/:id (delete by ID, create AuditLog entry). Apply adminAuth and adminRateLimit middleware.
- [X] T017 [US3] Register cache routes in src/routes/admin/index.ts. Add import for cache routes and mount at /cache path (following existing pattern for other admin route modules like /usage, /billing, etc.).

### Cache Purge Worker

- [X] T018 [P] [US3] Create cache purge worker in src/services/queue/workers/cachePurge.ts. Follow existing worker pattern (e.g., retentionPurge.ts). Processor calls domainCacheService.purgeExpired(), logs purged count via logger.info, creates AuditLog entry with action "CACHE_AUTO_PURGE" and metadata { purgedCount }. Export createCachePurgeWorker() factory function.
- [X] T019 [US3] Register the cache purge repeatable job. In src/services/queue/queues.ts (or wherever registerAdminRepeatableJobs is defined), add a repeatable job for cache purge: queue name "enrichment" or new queue, job name "cache-purge", cron "0 2 * * *" (daily at 02:00 UTC). Call createCachePurgeWorker() in src/app.ts alongside existing worker registrations.

### Frontend (Admin Dashboard)

- [X] T020 [P] [US3] Create CacheStatsCard component in admin-dashboard/src/components/cache/CacheStatsCard.tsx. Display: total entries, active entries, hit rate (7d/30d as percentages), estimated credits saved, estimated cost saved (USD), cache size (MB), top 10 domains by hit count. Fetch data from GET /api/admin/cache/metrics. Follow existing dashboard card patterns (e.g., usage stats cards).
- [X] T021 [P] [US3] Create CacheConfigPanel component in admin-dashboard/src/components/cache/CacheConfigPanel.tsx. Display: TTL slider (range 30-90, step 1, current value), enabled toggle, "Save" button calling PUT /api/admin/cache/config. Include "Purge Expired" and "Purge All" buttons with confirmation dialogs calling POST /api/admin/cache/purge with appropriate mode. Follow existing settings panel patterns.
- [X] T022 [US3] Create CacheMetrics page in admin-dashboard/src/pages/CacheMetrics.tsx. Compose CacheStatsCard and CacheConfigPanel into a full page. Add optional CacheEntriesTable section showing paginated entries from GET /api/admin/cache/entries with search, sort, and delete actions. Add page to admin dashboard router/navigation (sidebar link).

**Checkpoint**: At this point, admins can view cache metrics, configure TTL, and purge cache entries from the dashboard.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Edge cases, audit logging, and deployment verification

- [X] T023 [P] Add audit logging for all admin cache operations. Verify that PUT /config, POST /purge, and DELETE /entries/:id all create AuditLog entries with correct action names, metadata (including adminUserId), and timestamps per Constitution Principle V.
- [ ] T024 [P] Add cache-related metrics to the existing admin overview/usage pages if applicable. Consider adding a "Cache Savings" summary card to the main admin overview page showing credits saved this month.
- [ ] T025 Run quickstart.md verification steps: (1) Deploy to ECS. (2) Enrich a list with 100 domains. (3) Enrich a second list with 50 overlapping domains. (4) Verify Slack summary shows cache stats. (5) Verify admin dashboard cache page shows entries and hit rate. (6) Verify ApiUsageLog only has fresh lookup entries.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies — start immediately
- **Phase 2 (Foundational)**: Depends on T001 (Prisma schema) and T002 (normalizer)
- **Phase 3 (US1)**: Depends on Phase 2 (cache service) — MVP delivery
- **Phase 4 (US2)**: Depends on T005 (worker cache integration from US1)
- **Phase 5 (US3)**: Depends on Phase 2 (cache service). Backend routes (T016-T019) can run in parallel with US1/US2. Frontend (T020-T022) depends on backend routes.
- **Phase 6 (Polish)**: Depends on all user stories being complete

### User Story Dependencies

- **US1 (P1)**: Depends only on foundational cache service (Phase 2). No other story dependencies.
- **US2 (P2)**: Depends on US1 (T005 worker integration). The force-refresh toggle modifies the same worker flow.
- **US3 (P2)**: Backend routes depend only on Phase 2 (cache service). Frontend depends on backend routes. Can be developed in parallel with US1/US2 for the backend portion.

### Within Each User Story

- Models/schema before services
- Services before worker integration
- Worker integration before UI changes
- Backend before frontend (for US3)

### Parallel Opportunities

- **Phase 1**: T002 (normalizer) and T003 (seed config) can run in parallel after T001
- **Phase 3 + Phase 5 backend**: US1 worker integration and US3 admin API routes can proceed in parallel (both depend on Phase 2 only)
- **Phase 5**: T016 (API routes), T018 (purge worker), T020 (stats card), T021 (config panel) can all run in parallel
- **Phase 6**: T023 and T024 can run in parallel

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (T001-T003)
2. Complete Phase 2: Foundational cache service (T004)
3. Complete Phase 3: US1 worker integration (T005-T010)
4. **STOP and VALIDATE**: Deploy to ECS, enrich two overlapping lists, verify cache hits in Slack summary
5. This alone delivers the primary cost savings (25-50% BuiltWith API reduction)

### Incremental Delivery

1. Setup + Foundational → Cache service ready
2. US1 (cache reuse) → Deploy → Validate savings (MVP!)
3. US2 (force-refresh toggle) → Deploy → Users can bypass cache when needed
4. US3 (admin dashboard) → Deploy → Admins can monitor and configure cache
5. Polish → Deploy → Audit logging verified, overview integration
