# Tasks: Backend Admin Dashboard

**Input**: Design documents from `/specs/3-admin-dashboard/`
**Prerequisites**: plan.md (required), spec.md (required), research.md, data-model.md, contracts/api-contracts.md, quickstart.md

**Tests**: Not explicitly requested — test tasks omitted. Add tests per story as needed.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Prisma schema extension and configuration for all admin dashboard entities

- [x] T001 Extend Prisma schema with AdminUser, ErrorLog, BudgetThreshold, ScheduledReport, DailyAggregate, RetentionConfig models and ErrorCategory, ErrorLifecycleState, ReportType, ReportFrequency enums in prisma/schema.prisma
- [x] T002 Generate and apply Prisma migration (`npx prisma migrate dev --name admin_dashboard`)
- [x] T003 [P] Add ADMIN_RATE_LIMIT_RPM environment variable to src/config/index.ts

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Admin auth, rate limiting, error logging helper, seed scripts, and admin queue — MUST be complete before ANY user story

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [x] T004 [P] Implement admin API key authentication middleware (extract X-Admin-Key header, SHA-256 hash, lookup AdminUser, attach admin identity to request, reject inactive admins) in src/lib/adminAuth.ts
- [x] T005 [P] Implement Redis sliding-window per-admin rate limiter middleware (INCR + EXPIRE on `ratelimit:admin:{adminId}:{minuteBucket}`, 100 req/min from config, return 429 with retry_after) in src/lib/adminRateLimit.ts
- [x] T006 [P] Implement database-backed error logger helper function `logError()` (fire-and-forget pattern matching existing `logAudit()`, accepts category, service, message, stack_trace, job context, metadata) in src/services/admin/errorLogger.ts
- [x] T007 [P] Create admin user seed script (generate random API key with `adm_` prefix, SHA-256 hash for storage, display plaintext once, accept --name and --email CLI args) in src/scripts/seedAdmin.ts
- [x] T008 [P] Create retention config seed script (insert default retention periods: api_usage_logs 90d, error_logs 180d, audit_logs 0/permanent, daily_aggregates 0/permanent) in src/scripts/seedRetention.ts
- [x] T009 [P] Register admin BullMQ queue and add repeatable job definitions (daily-aggregate at 00:30 UTC, retention-purge at 01:00 UTC) in src/services/queue/queues.ts
- [x] T010 Create admin router index with adminAuth and adminRateLimit middleware applied to all child routes in src/routes/admin/index.ts
- [x] T011 Mount admin router under `/api/v1/admin/` in src/app.ts

**Checkpoint**: Foundation ready — admin auth works, rate limiting active, error logger available, admin queue registered. User story implementation can now begin.

---

## Phase 3: User Story 1 — Cost & Usage Overview Dashboard (Priority: P1) 🎯 MVP

**Goal**: Admin users can view total system cost, cost breakdowns by provider/workspace, and time-series cost/usage trends at daily/weekly/monthly granularity.

**Independent Test**: Authenticate with admin key → `GET /api/v1/admin/overview` returns summary metrics → `GET /api/v1/admin/usage/trends?granularity=daily` returns time-series data points. Verify costs sum correctly against raw ApiUsageLog records.

### Implementation for User Story 1

- [x] T012 [US1] Implement aggregation service with methods for: overview summary (total cost, calls, tokens, jobs by date range), cost-by-provider breakdown, cost-by-workspace breakdown, time-series trending (daily/weekly/monthly granularity), and today's on-the-fly merge from raw ApiUsageLog with pre-computed DailyAggregate data in src/services/admin/aggregation.ts
- [x] T013 [P] [US1] Implement GET /api/v1/admin/overview endpoint (start_date/end_date query params, returns summary, cost_by_provider, cost_by_workspace, open_errors, error_rate) in src/routes/admin/overview.ts
- [x] T014 [P] [US1] Implement GET /api/v1/admin/usage/trends endpoint (start_date, end_date, granularity, service, slack_team_id query params, returns data_points array) in src/routes/admin/usage.ts
- [x] T015 [P] [US1] Implement daily aggregate BullMQ worker (runs at 00:30 UTC, aggregates previous day's ApiUsageLog into DailyAggregate rows per service per workspace, upsert on unique constraint) in src/services/queue/workers/dailyAggregate.ts

**Checkpoint**: US1 complete — admin can view cost overview and trending. This is the MVP deliverable.

---

## Phase 4: User Story 2 — API Call Request Log & Search (Priority: P1)

**Goal**: Admin users can browse a paginated log of all API calls and filter by any combination of: provider, endpoint, Slack user, Slack channel, workspace, job ID, date range, and response status.

**Independent Test**: `GET /api/v1/admin/usage/logs?service=APOLLO&slack_team_id=T12345&start_date=2026-03-01` returns paginated, filtered API call records with job context joined.

### Implementation for User Story 2

- [x] T016 [US2] Implement GET /api/v1/admin/usage/logs endpoint with multi-filter support (service, endpoint, slack_user_id, slack_channel_id, slack_team_id, job_id, status, start_date, end_date, sort, limit, offset), Prisma query with dynamic WHERE clauses, and Job relation join for Slack context in src/routes/admin/usage.ts

**Checkpoint**: US1 + US2 complete — full cost visibility and API call search/filtering operational.

---

## Phase 5: User Story 3 — Error Monitoring & Diagnostics (Priority: P2)

**Goal**: Centralized error log with categorization, stack traces, job context, three-state lifecycle (Open → Acknowledged → Resolved), and error frequency trending. Errors captured from all system components via logError() helper.

**Independent Test**: Trigger errors in the system → `GET /api/v1/admin/errors` shows categorized entries → `GET /api/v1/admin/errors/:id` shows full detail with stack trace → `PATCH /api/v1/admin/errors/:id` transitions lifecycle state → `GET /api/v1/admin/errors/trends` shows frequency data.

### Implementation for User Story 3

- [x] T017 [US3] Implement GET /api/v1/admin/errors list endpoint with filters (category, service, lifecycle_state, slack_team_id, job_id, start_date, end_date, sort, limit, offset) and pagination in src/routes/admin/errors.ts
- [x] T018 [US3] Implement GET /api/v1/admin/errors/:id detail endpoint with stack_trace, metadata, and joined Job context in src/routes/admin/errors.ts
- [x] T019 [US3] Implement PATCH /api/v1/admin/errors/:id lifecycle state transition endpoint (validate allowed transitions, set acknowledged_by/at or resolved_by/at, log to AuditLog via logAudit with error_acknowledged/error_resolved action) in src/routes/admin/errors.ts
- [x] T020 [US3] Implement GET /api/v1/admin/errors/trends frequency endpoint (group_by category or service, daily/weekly/monthly granularity) in src/routes/admin/errors.ts
- [x] T021 [US3] Integrate logError() calls into existing error handling: BuiltWith client catch blocks, Apollo client catch blocks, Claude/AI orchestrator catch blocks, BullMQ worker error handlers, file parser error handlers, and Slack message delivery failures

**Checkpoint**: US3 complete — centralized error monitoring with lifecycle management operational.

---

## Phase 6: User Story 4 — Client Management & Per-Client Insights (Priority: P2)

**Goal**: Admin users can view all client workspaces with aggregated metrics and drill into per-client detail showing job history, cost breakdown by provider, and top users.

**Independent Test**: `GET /api/v1/admin/clients?sort=total_cost:desc` returns ranked workspace list → `GET /api/v1/admin/clients/:slack_team_id` returns per-client detail with cost_by_provider, top_users, and recent_jobs.

### Implementation for User Story 4

- [x] T022 [US4] Implement client insights service with methods for: client list aggregation (total jobs, cost, API calls, error rate, last active per workspace), per-client detail (cost by provider, top users by job count and cost, recent jobs), derived from Job + ApiUsageLog tables in src/services/admin/clientInsights.ts
- [x] T023 [US4] Implement GET /api/v1/admin/clients list endpoint with sort (total_cost, total_jobs, error_rate, last_active), pagination, and date range filtering in src/routes/admin/clients.ts
- [x] T024 [US4] Implement GET /api/v1/admin/clients/:slack_team_id detail endpoint with summary, cost_by_provider, top_users, and recent_jobs in src/routes/admin/clients.ts

**Checkpoint**: US4 complete — client-level visibility operational.

---

## Phase 7: User Story 5 — Budget Threshold Alerts (Priority: P2)

**Goal**: Admins configure monthly spend thresholds (overall or per-provider), system sends Slack notification when threshold is crossed, suppresses duplicates within same month, resets monthly.

**Independent Test**: `POST /api/v1/admin/thresholds` creates threshold → simulate API usage that exceeds threshold → verify Slack notification delivered → verify duplicate suppression within same month.

### Implementation for User Story 5

- [x] T025 [US5] Implement threshold checker service with methods for: summing current month spend (overall and per-provider from ApiUsageLog), evaluating active thresholds, sending Slack notification via @slack/bolt chat.postMessage, marking threshold as triggered with last_triggered_month, and suppressing same-month duplicates in src/services/admin/thresholdChecker.ts
- [x] T026 [US5] Implement budget threshold CRUD endpoints (GET list with current_month_spend, POST create with validation and logAudit threshold_created, PUT update with logAudit threshold_updated, DELETE) in src/routes/admin/thresholds.ts
- [x] T027 [US5] Integrate threshold checking after logApiUsage() success — call checkThresholds() with service and cost context as fire-and-forget (inline function call, not queued) in src/lib/apiUsageLogger.ts

**Checkpoint**: US5 complete — proactive budget alerting operational.

---

## Phase 8: User Story 6 — Exportable Reports & Scheduled Delivery (Priority: P3)

**Goal**: On-demand CSV export for any dashboard data, scheduled recurring reports delivered to Slack channels, and configurable data retention with automated purging.

**Independent Test**: `POST /api/v1/admin/reports/export` streams CSV download → `POST /api/v1/admin/reports/scheduled` creates recurring report → verify BullMQ repeatable job registered → `GET /api/v1/admin/retention` shows config → `PUT /api/v1/admin/retention/api_usage_logs` updates retention period.

### Implementation for User Story 6

- [x] T028 [P] [US6] Implement report generator service with CSV generation methods for report types: COST_SUMMARY, USAGE_BREAKDOWN, CLIENT_REPORT, ERROR_SUMMARY using csv-stringify, with date range and filter support in src/services/admin/reportGenerator.ts
- [x] T029 [P] [US6] Implement retention manager service with batch purge logic (query records older than retention_days, delete in 1000-row batches with sleep between batches, respect locked types audit_logs and daily_aggregates, preserve OPEN ErrorLog entries regardless of age — only purge RESOLVED errors, update last_purged_at) in src/services/admin/retentionManager.ts
- [x] T030 [US6] Implement POST /api/v1/admin/reports/export on-demand CSV export endpoint (stream CSV in response with Content-Disposition header, support report_type, date range, and filters, logAudit report_exported) in src/routes/admin/reports.ts
- [x] T031 [US6] Implement scheduled report CRUD endpoints (GET list, POST create with BullMQ repeatable job registration and logAudit report_scheduled, PUT update, DELETE with BullMQ job cancellation) in src/routes/admin/reports.ts
- [x] T032 [P] [US6] Implement GET /api/v1/admin/retention list and PUT /api/v1/admin/retention/:data_type update endpoints (enforce locked types, minimum 30-day validation, admin attribution, logAudit retention_updated) in src/routes/admin/retention.ts
- [x] T033 [US6] Implement scheduled report BullMQ worker (load report config, generate CSV via reportGenerator, upload to S3, post download link to Slack channel, update last_run_at or last_error) in src/services/queue/workers/scheduledReport.ts
- [x] T034 [US6] Implement retention purge BullMQ worker (runs at 01:00 UTC after daily aggregation, iterate RetentionConfig entries, call retentionManager for each purgeable type, log results to AuditLog) in src/services/queue/workers/retentionPurge.ts

**Checkpoint**: US6 complete — full reporting, scheduled delivery, and data lifecycle management operational.

---

## Phase 9: Polish & Cross-Cutting Concerns

**Purpose**: Audit trail completeness, end-to-end validation, and regression check

- [x] T035 [P] Verify audit logging completeness across all admin write operations (error_acknowledged, error_resolved, threshold_created, threshold_updated, threshold_triggered, report_exported, report_scheduled, retention_updated, admin_authenticated) — logAudit calls should already be inline from Phases 3-8; this task validates none were missed
- [x] T036 [P] Validate seed scripts and quickstart.md workflow end-to-end (seedAdmin.ts, seedRetention.ts, health check, admin overview call)
- [x] T037 Run full test suite and verify no regressions to enrichment processing performance

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately
- **Foundational (Phase 2)**: Depends on Phase 1 (T001-T002 for Prisma models) — BLOCKS all user stories
- **User Stories (Phase 3-8)**: All depend on Foundational phase completion
  - US1 and US2 (both P1) can proceed in parallel or sequentially
  - US3, US4, US5 (all P2) can proceed in parallel — they are independent of each other
  - US6 (P3) can start after Foundational but benefits from US1 aggregation service
- **Polish (Phase 9)**: Depends on all desired user stories being complete

### User Story Dependencies

- **US1 (P1)**: Can start after Foundational — no dependencies on other stories
- **US2 (P1)**: Can start after Foundational — adds to usage.ts file created in US1 (T014), so best done after US1
- **US3 (P2)**: Can start after Foundational — independent of US1/US2 (errorLogger helper already in Phase 2)
- **US4 (P2)**: Can start after Foundational — queries existing Job/ApiUsageLog, no new entities
- **US5 (P2)**: Can start after Foundational — independent. Integration with apiUsageLogger (T027) is self-contained
- **US6 (P3)**: Can start after Foundational — report generator reuses aggregation patterns but doesn't depend on US1 service directly

### Within Each User Story

- Services before route endpoints
- Route endpoints before integration tasks
- Core read endpoints before write/mutation endpoints
- All endpoints before cross-system integration

### Parallel Opportunities

**Phase 2 (Foundational)**:
- T004, T005, T006, T007, T008, T009 can all run in parallel (different files)
- T010 depends on T004 + T005 (wires both as middleware)
- T011 depends on T010

**Phase 3 (US1)**:
- T012 (aggregation service) must complete first
- T013 (overview.ts), T014 (usage.ts), T015 (worker) can all run in parallel after T012

**Phase 5-7 (P2 stories)**:
- US3 (Phase 5), US4 (Phase 6), and US5 (Phase 7) are fully independent and can be worked on in parallel by different team members

**Phase 8 (US6)**:
- T028 (reportGenerator) and T029 (retentionManager) can run in parallel
- T032 (retention.ts) can run in parallel with T030/T031 (reports.ts) — different files
- T033 and T034 (workers) can run in parallel — different files

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (T001-T003)
2. Complete Phase 2: Foundational (T004-T011)
3. Complete Phase 3: User Story 1 — Cost & Usage Overview (T012-T015)
4. **STOP and VALIDATE**: Admin can authenticate, view cost summary, and see trending data
5. Deploy/demo if ready — immediate cost visibility value

### Incremental Delivery

1. **Setup + Foundational** → Foundation ready (T001-T011)
2. **Add US1** → Cost overview operational → Deploy/Demo (MVP!)
3. **Add US2** → Full API call search → Deploy/Demo
4. **Add US3** → Error monitoring → Deploy/Demo
5. **Add US4** → Client insights → Deploy/Demo
6. **Add US5** → Budget alerts → Deploy/Demo
7. **Add US6** → Reports + retention → Deploy/Demo
8. **Polish** → Audit completeness, validation → Final release
