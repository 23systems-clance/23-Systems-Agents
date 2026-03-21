# Tasks: Performance Audit & Optimization

**Input**: Design documents from `/specs/30-performance-audit/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/admin-api.md, quickstart.md

**Tests**: Not explicitly requested in the spec. No test tasks generated.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Install new dependencies, create shared utilities, and run database migrations that all user stories depend on.

- [ ] T001 Add `aws-embedded-metrics` and `exceljs` to package.json and run `npm install`
- [ ] T002 [P] Create CloudWatch EMF metrics utility in `src/services/metrics/cloudwatch.ts` — export `emitMetric(namespace, dimensions, metrics, properties)` helper using `createMetricsLogger` from `aws-embedded-metrics` per research.md R2
- [ ] T003 [P] Create shared retry-with-backoff utility in `src/lib/retryHelper.ts` — export `retryWithBackoff<T>(fn, opts: { maxRetries, initialDelay, multiplier })` per research.md R7
- [ ] T004 [P] Add Prisma `$extends` query timing extension to the existing Prisma client in `src/lib/prisma.ts` — log slow queries (>500ms) and emit CloudWatch metric `DbQueryDuration` per research.md R3

**Checkpoint**: Shared utilities ready. No behavior changes yet.

---

## Phase 2: Foundational (Database Indexes)

**Purpose**: Add composite indexes that improve query performance across ALL user stories. Must complete before user story implementation to ensure optimized query paths are available.

**CRITICAL**: No user story work can begin until this phase is complete.

- [ ] T005 Create Prisma migration adding 11 composite indexes per data-model.md: `Job([status,createdAt], [slackTeamId,createdAt], [status,completedAt])`, `ApiUsageLog([service,createdAt], [slackTeamId,createdAt], [responseStatus,createdAt])`, `ErrorLog([category,createdAt], [lifecycleState,createdAt])`, `DomainEnrichmentCache([normalizedDomain,expiresAt])`, `ApolloSearchCache([normalizedDomain,expiresAt])`, `ApolloContactCache([apolloPersonId,hasPhoneData,expiresAt])` in `prisma/schema.prisma`
- [ ] T006 Add `AWS_EMF_ENVIRONMENT`, `AWS_EMF_NAMESPACE`, `AWS_EMF_LOG_GROUP_NAME` environment variables to the ECS task definition in `infra/cloudformation.yml` (or deploy script `.env` input)

**Checkpoint**: Foundation ready — all user stories can now proceed.

---

## Phase 3: User Story 1 — Large Job Processing Without Memory Exhaustion (Priority: P1) MVP

**Goal**: 5,000-row enrichment jobs complete without exceeding 80% memory, using chunked file generation with streaming Excel output and partial result delivery on failure.

**Independent Test**: Submit a 5,000-row combined enrichment job and verify it completes with results delivered to Slack without ECS task restarts or memory warnings in CloudWatch.

### Implementation for User Story 1

- [ ] T007 [US1] Refactor file generation in `src/services/queue/workers/fileGenerationWorker.ts` to use chunked database reads — replace single `findUniqueOrThrow` with `include: { companies, contacts, technologies }` with cursor-based pagination (500 records per chunk) using `prisma.jobCompany.findMany({ where: { jobId }, skip, take: 500, include: { technologies: true, contacts: true } })`
- [ ] T008 [US1] Replace SheetJS XLSX write path in `src/services/fileGeneration/generator.ts` with ExcelJS `stream.xlsx.WorkbookWriter` per research.md R4 — keep SheetJS for file parsing (reading uploads). Implement `generateStreamingXlsx(job, outputPath)` that creates a WorkbookWriter, iterates chunked DB reads, calls `row.commit()` per row, and `worksheet.commit()` / `workbook.commit()` at end
- [ ] T009 [US1] Update CSV generation in `src/services/fileGeneration/generator.ts` to use `csv-stringify` streaming mode with chunked DB reads (same pagination pattern as T007) instead of building full array in memory
- [ ] T010 [US1] Implement partial result delivery (FR-014) in `src/services/queue/workers/fileGenerationWorker.ts` — wrap the chunked generation in try/catch; on failure mid-generation, finalize the partial file (commit what's written), upload to S3, notify user via Slack with message: "Partial results delivered ({N} of {total} companies). File generation encountered an error: {message}"
- [ ] T011 [US1] Add job priority tiers (FR-008) to enrichment queue in `src/services/queue/queues.ts` — when adding jobs, compute priority from `sourceRowCount`: <500 → priority 1, 500-2000 → priority 5, >2000 → priority 10. Update all `enrichmentQueue.add()` call sites (in `src/services/enrichment/` and Slack command handlers) to pass `{ priority }` option
- [ ] T012 [US1] Wrap batch database operations in transactions (FR-007) in enrichment workers (`src/services/queue/workers/enrichmentDispatcher.ts` and related processors) — use `prisma.$transaction(async (tx) => { ... }, { timeout: 30000 })` around `jobCompany.create` + `companyTechnology.createMany` + `jobContact.create/createMany` sequences per research.md R6
- [ ] T013 [US1] Emit CloudWatch metrics from enrichment workers — in `src/services/queue/workers/enrichmentDispatcher.ts`, emit `JobDuration`, `JobsProcessed`, `JobsFailed`, `MemoryUsageMB` (via `process.memoryUsage().rss / 1024 / 1024`) using the utility from T002. Add `FileGenerationDuration` metric in the file generation worker

**Checkpoint**: User Story 1 complete. 5,000-row jobs should process with constant memory usage and deliver results (full or partial).

---

## Phase 4: User Story 2 — Fast Dashboard and API Response Times (Priority: P2)

**Goal**: Admin dashboard pages load within 3 seconds. Error trends use DB-side aggregation instead of loading all records into memory.

**Independent Test**: Load each admin dashboard page (overview, usage trends, error logs, cache stats) and verify all API responses return within 3 seconds.

### Implementation for User Story 2

- [ ] T014 [US2] Replace in-memory error trends aggregation in `src/routes/admin/errors.ts` (`GET /errors/trends`) — replace `findMany()` + JavaScript `Map` grouping with `prisma.$queryRaw` using `date_trunc(${granularity}, "createdAt")` and `GROUP BY category, period` per contracts/admin-api.md
- [ ] T015 [P] [US2] Enforce pagination limits on `GET /api/v1/admin/usage/logs` in `src/routes/admin/usage.ts` — add validation: `limit` min 1, max 100, default 50; reject requests exceeding max with 400 response
- [ ] T016 [P] [US2] Enforce pagination limits on `GET /api/v1/admin/errors` in `src/routes/admin/errors.ts` — same limit enforcement (max 100, default 50)
- [ ] T017 [P] [US2] Enforce pagination limits on `GET /api/v1/admin/cache/entries` in `src/routes/admin/cache.ts` and `GET /api/v1/admin/apollo-cache/search-entries` and `GET /api/v1/admin/apollo-cache/contact-entries` in `src/routes/admin/apolloCache.ts` — max 100, default 50
- [ ] T018 [US2] Emit `DbQueryDuration` CloudWatch metrics for admin API queries — the Prisma extension from T004 handles this automatically; verify slow query logging appears in CloudWatch Logs for admin endpoints

**Checkpoint**: User Story 2 complete. Dashboard loads under 3 seconds with DB-side aggregations.

---

## Phase 5: User Story 3 — Efficient API Credit Usage Through Optimal Caching (Priority: P2)

**Goal**: Cache hit rate reaches 90%+ for repeated domains. Duplicate API calls within a batch are prevented. Cache entries are validated for correctness.

**Independent Test**: Run the same enrichment request twice for the same domain set and verify the second run shows near-100% cache hits with zero additional API credit usage.

### Implementation for User Story 3

- [ ] T019 [US3] Add within-batch domain deduplication (FR-006) in `src/services/queue/workers/enrichmentDispatcher.ts` — before the per-company loop, build a `Set<string>` of unique domains from all job companies; for duplicate domains, reuse the first enrichment result from the in-memory `Map<string, EnrichResult>` that already exists (verify it covers all enrichment types: BuiltWith, Apollo search, Apollo contact)
- [ ] T020 [US3] Add cache validation checks (FR-012) in `src/services/builtwith/domainCache.ts`, `src/services/apollo/searchCache.ts`, and `src/services/apollo/contactCache.ts` — on cache hit, validate that critical fields are present and non-null (e.g., `builtwithResponse` for domain cache, `contacts` array for search cache, `email` for contact cache); if validation fails, treat as cache miss and re-fetch
- [ ] T021 [US3] Add cache effectiveness metrics to `GET /api/v1/admin/cache/metrics` response in `src/routes/admin/cache.ts` — add `systemMetrics.staleCacheEntries` (count of entries past TTL) and `systemMetrics.cacheValidationErrors` (count from T020 tracked via a counter) per contracts/admin-api.md
- [ ] T022 [US3] Emit `CacheHitRate` and `CacheMissCount` CloudWatch metrics per job — in the enrichment workers, after enrichment completes, compute hit rate from `job.cacheHits / (job.cacheHits + job.cacheMisses)` and emit via the utility from T002

**Checkpoint**: User Story 3 complete. Cache validates entries, deduplicates within batches, and reports effectiveness.

---

## Phase 6: User Story 4 — Reliable Error Recovery and Stale Job Cleanup (Priority: P3)

**Goal**: Jobs stuck in PROCESSING state are automatically detected within 30 minutes and marked FAILED with user notification. Slack messages retry with backoff.

**Independent Test**: Verify the stale job detector runs every 5 minutes (check CloudWatch Logs). Simulate a stuck job by checking that jobs in PROCESSING > 30 min are transitioned to FAILED.

### Implementation for User Story 4

- [ ] T023 [US4] Create maintenance queue in `src/services/queue/queues.ts` — add `maintenanceQueue = new Queue('maintenance', { connection, defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 5000 }, removeOnComplete: 100, removeOnFail: 200 } })`
- [ ] T024 [US4] Create stale job detector worker in `src/services/queue/workers/staleJobDetector.ts` — process `detect-stale-jobs` jobs: query `Job.findMany({ where: { status: 'PROCESSING', startedAt: { lt: new Date(Date.now() - thresholdMs) } } })`, for each stale job update status to `FAILED` with errorMessage `"Job timed out after 30 minutes in PROCESSING state (stale job detection)"`, send Slack notification to originating channel, emit `StaleJobsDetected` CloudWatch metric
- [ ] T025 [US4] Register stale job scheduler on app startup — in the queue initialization code (where other workers are registered), call `maintenanceQueue.upsertJobScheduler('stale-job-detector', { every: 300000 }, { name: 'detect-stale-jobs', data: { thresholdMs: 1800000 } })` per research.md R5
- [ ] T026 [US4] Add Slack message retry with backoff (FR-004) to `src/services/slack/enrichmentNotifications.ts` — wrap all `slack.chat.postMessage()` and `slack.filesUploadV2()` calls with `retryWithBackoff()` from T003 (3 retries, 2s initial delay, 2x multiplier). Honor `Retry-After` header on 429 responses
- [ ] T027 [US4] Add Slack message retry to `src/services/upload/slackNotifier.ts` and `src/services/queue/workers/enrichmentProgressNotifier.ts` — same pattern as T026, wrap Slack SDK calls with `retryWithBackoff()`
- [ ] T028 [US4] Emit `SlackDeliveryRetries` and `SlackDeliveryFailures` CloudWatch metrics — in the retry wrapper, increment retry counter on each attempt and emit failure metric when all retries exhausted

**Checkpoint**: User Story 4 complete. Stale jobs auto-cleaned every 5 min. Slack messages retry before failing.

---

## Phase 7: User Story 5 — Database Query Performance at Scale (Priority: P3)

**Goal**: Critical query paths use composite indexes and return results under 200ms at 10x current data volume.

**Independent Test**: Check CloudWatch Logs for slow query warnings (>500ms). Verify no slow queries appear for dashboard endpoints under normal load.

### Implementation for User Story 5

- [ ] T029 [US5] Verify index usage for overview aggregation queries in `src/services/admin/aggregation.ts` — run `EXPLAIN ANALYZE` on the 5 parallel queries (cost aggregation, job status grouping, error counts, provider breakdown, workspace breakdown) against production data via `prisma.$queryRaw`. Confirm all queries use the composite indexes from T005. Log findings
- [ ] T030 [US5] Optimize usage trends query in `src/services/admin/aggregation.ts` `getUsageTrends()` — ensure the hybrid DailyAggregate + today's raw query uses the `[service, createdAt]` and `[slackTeamId, createdAt]` composite indexes. If today's on-the-fly aggregation is slow, add a `GROUP BY` with `date_trunc` in raw SQL instead of in-memory grouping
- [ ] T031 [US5] Optimize cache metrics queries in `src/routes/admin/cache.ts` and `src/routes/admin/apolloCache.ts` — verify `COUNT` and `SUM` queries for 7d/30d reporting use the composite indexes. Replace any sequential queries with `Promise.all()` for parallel execution where not already done
- [ ] T032 [US5] Add `DbQueryDuration` per-endpoint metrics — emit CloudWatch metric with `QueryModel` and `QueryOperation` properties for admin API routes to establish a baseline of query performance post-optimization

**Checkpoint**: User Story 5 complete. All critical queries use indexes and complete under 200ms.

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Final integration, cleanup, and verification across all user stories.

- [ ] T033 Update `infra/cloudformation.yml` (or deploy script) to add `AWS_EMF_ENVIRONMENT`, `AWS_EMF_NAMESPACE`, `AWS_EMF_LOG_GROUP_NAME` environment variables to the ECS task definition if not already done in T006
- [ ] T034 Verify ECS task role has `logs:PutLogEvents` and `logs:CreateLogGroup` permissions for CloudWatch EMF
- [ ] T035 Update spec.md feature branch reference from `24-performance-audit` to `30-performance-audit` in `specs/30-performance-audit/spec.md`
- [ ] T036 Run full enrichment pipeline test: submit a 5,000-row combined enrichment job and verify end-to-end completion with CloudWatch metrics appearing in the `SlackListProcessor` namespace
- [ ] T037 Verify admin dashboard loads all pages within 3-second target after deployment
- [ ] T038 Verify stale job detector appears in CloudWatch Logs running every 5 minutes

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately
- **Foundational (Phase 2)**: Depends on Phase 1 (T001 for deps, T002-T004 for utilities)
- **User Stories (Phase 3-7)**: All depend on Phase 2 completion (indexes must exist)
  - US1 (Phase 3) can start after Phase 2
  - US2 (Phase 4) can start after Phase 2 — independent of US1
  - US3 (Phase 5) can start after Phase 2 — independent of US1, US2
  - US4 (Phase 6) depends on T003 (retry utility from Phase 1) — otherwise independent
  - US5 (Phase 7) depends on Phase 2 (indexes) — otherwise independent
- **Polish (Phase 8)**: Depends on all user stories complete

### User Story Dependencies

```
Phase 1 (Setup) ──→ Phase 2 (Indexes) ──┬──→ Phase 3 (US1: Memory/Files) P1 MVP
                                         ├──→ Phase 4 (US2: Dashboard)    P2
                                         ├──→ Phase 5 (US3: Caching)      P2
                                         ├──→ Phase 6 (US4: Recovery)     P3
                                         └──→ Phase 7 (US5: DB Queries)   P3
                                                        ↓
                                              Phase 8 (Polish)
```

### Within Each User Story

- Refactoring before new features
- Core implementation before metrics emission
- Each story independently testable after its checkpoint

### Parallel Opportunities

- T002, T003, T004 can run in parallel (Phase 1 — different files)
- T015, T016, T017 can run in parallel (Phase 4 — different route files)
- All user stories (Phases 3-7) can run in parallel after Phase 2

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (T001-T004)
2. Complete Phase 2: Foundational indexes (T005-T006)
3. Complete Phase 3: User Story 1 — memory-efficient file generation (T007-T013)
4. **STOP and VALIDATE**: Submit 5,000-row job, verify completion without memory issues
5. Deploy and monitor CloudWatch metrics

### Incremental Delivery

1. Setup + Foundational → Foundation ready
2. Add US1 (P1) → Test 5K-row job → Deploy (MVP!)
3. Add US2 (P2) → Test dashboard speed → Deploy
4. Add US3 (P2) → Test cache hit rates → Deploy
5. Add US4 (P3) → Verify stale detection + Slack retries → Deploy
6. Add US5 (P3) → Verify query performance → Deploy
7. Polish → Final verification → Done
