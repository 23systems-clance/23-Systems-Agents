# Tasks: Pre-Enrichment Lead Quality Gating

**Input**: Design documents from `/specs/16-lead-quality-gating/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: Not explicitly requested in spec. Test tasks omitted. Integration verification via deployed ECS environment.

**Organization**: Tasks grouped by user story for independent implementation and testing.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)
- Exact file paths included in descriptions

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Prisma schema migration and shared types/utilities

- [x] T001 Add `QualityGateConfig` model and extend `Job` model with `qualityGateResult` and `qualityGateConfigSnapshot` JSONB fields in `prisma/schema.prisma`
- [x] T002 Run Prisma migration to apply schema changes: `npx prisma migrate dev --name add-quality-gate`
- [x] T003 Create shared types file with `QualityGateResult`, `QualityGateConfigSnapshot`, `FilterReason`, and `FilteredRow` interfaces in `src/services/qualityGate/types.ts`
- [x] T004 [P] Add `stripSubdomain()` function to `src/services/file/domainUtils.ts` that extracts root domain from subdomains (e.g., `marketing.competitor.com` → `competitor.com`)
- [x] T005 [P] Add `isPersonalDomain()` function to `src/services/file/domainUtils.ts` that checks a domain against the default personal email list (gmail.com, yahoo.com, hotmail.com, outlook.com, aol.com, icloud.com, live.com, msn.com, me.com, protonmail.com, ymail.com, mail.com)
- [x] T006 [P] Extend `parseFile()` in `src/services/file/parser.ts` to detect email column using keywords ("email", "e-mail", "email_address", "contact_email") and return `emailColumn` in the `ParsedFile` result

**Checkpoint**: Schema migrated, types defined, domain utils extended, email column detection ready.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Quality gate config loading and default constants — required before any filter can run

**CRITICAL**: No user story work can begin until this phase is complete.

- [x] T007 Create quality gate defaults constant (`DEFAULT_QUALITY_GATE_CONFIG`) with all filter flags and the 12-domain personal email list in `src/services/qualityGate/config.ts`
- [x] T008 Implement `loadQualityGateConfig(clientId: string)` in `src/services/qualityGate/config.ts` that loads workspace `QualityGateConfig` from DB via Prisma, merges with global defaults, computes `effectivePersonalDomains` (defaults + overrides - allow list), and returns the merged config. Returns defaults when no DB record exists.
- [x] T009 Implement `snapshotConfig(config)` in `src/services/qualityGate/config.ts` that creates a JSON-serializable snapshot of the effective config for storage in `Job.qualityGateConfigSnapshot`

**Checkpoint**: Config system ready — filters can load workspace-specific or default settings.

---

## Phase 3: User Story 1 — Automatic Quality Filtering Before Enrichment (Priority: P1) MVP

**Goal**: Automatically filter out low-quality rows from uploaded lists before consuming API credits. Post a filtering summary to Slack with a downloadable CSV of rejected rows.

**Independent Test**: Upload a CSV with a mix of valid business emails, personal emails, known competitor domains, and rows with missing company data. Verify only valid rows proceed to enrichment and a filtering summary is displayed.

### Implementation for User Story 1

- [x] T010 [P] [US1] Implement `filterPersonalEmails(rows, emailColumn, personalDomains)` in `src/services/qualityGate/filters/personalEmail.ts` — filters rows where the email column domain matches the effective personal domain list. Returns `{passed: Row[], filtered: FilteredRow[]}` with reason `Personal email domain ({domain})`. Skips gracefully if no email column detected.
- [x] T011 [P] [US1] Implement `filterMissingCompany(rows, domainColumn, companyColumn)` in `src/services/qualityGate/filters/missingCompany.ts` — filters rows where company name is empty/null AND domain column is empty/null (no resolvable domain). Returns `{passed, filtered}` with reason `Missing company name and domain`. Rows with a valid business domain but no company name pass through (domain can be used for resolution).
- [x] T012 [P] [US1] Implement `filterSuppressionDomains(rows, emailColumn, domainColumn, suppressionList)` in `src/services/qualityGate/filters/suppression.ts` — filters rows whose email domain or website domain matches the workspace suppression list after normalization (lowercase + `stripSubdomain()`). Returns `{passed, filtered}` with reason `Suppression list match ({domain})`.
- [x] T013 [P] [US1] Implement `filterDuplicateEmails(rows, emailColumn)` in `src/services/qualityGate/filters/duplicateEmail.ts` — detects exact email duplicates (case-insensitive), keeps first occurrence, filters subsequent. Returns `{passed, filtered}` with reason `Duplicate email (row {N})` where N is the row index of the first occurrence.
- [x] T014 [US1] Implement `runQualityGate(rows, headers, columns, config)` orchestrator in `src/services/qualityGate/qualityGate.ts` — chains filters in order: personalEmail → missingCompany → suppression → duplicateEmail. Each filter operates on the `passed` output of the previous. Aggregates all filtered rows with reasons. Returns `QualityGateResult` with totalRows, passedRows, filteredRows, filterBreakdown (count per reason), and processingTimeMs. Handles edge case: all rows filtered (passedRows = 0).
- [x] T015 [US1] Implement `generateFilteredCsv(filteredRows, originalHeaders)` in `src/services/qualityGate/filteredCsv.ts` — generates a CSV buffer from filtered rows preserving original columns and appending a `Filter Reason` column. Uses `csv-stringify`. UTF-8 with BOM for Excel compatibility. Uploads to S3 at key `jobs/{jobId}/filtered-rows.csv` using existing `uploadFile()` from `src/lib/storage.ts`. Returns the S3 key and presigned URL (7-day expiry).
- [x] T016 [US1] Implement `buildFilteringSummaryBlocks(result: QualityGateResult)` in `src/services/qualityGate/qualityGate.ts` — generates Slack Block Kit blocks for the filtering summary message. Includes: header line ("Quality check: X of Y rows passed. Z filtered."), breakdown lines per non-zero filter reason, and a "Download filtered rows" button linking to the presigned URL. Returns null when filteredRows === 0 (FR-010: no noise for clean files). Handles all-rows-filtered case with distinct message.
- [x] T017 [US1] Integrate quality gate into `src/listeners/events/message.ts` — after `parseFile()` completes and before `JobCompany` creation / `enrichmentQueue.add()`: load config via `loadQualityGateConfig()`, call `runQualityGate()`, store result in `Job.qualityGateResult` and snapshot in `Job.qualityGateConfigSnapshot`, generate filtered CSV if needed, post Slack summary if filteredRows > 0, create `JobCompany` records only for passed rows. If all rows filtered: mark job COMPLETED with 0 companies, post "all filtered" message, do NOT enqueue BullMQ job.
- [x] T018 [US1] Integrate quality gate into `src/listeners/actions/purposeSelection.ts` — same pattern as T017 for contact-only enrichment flows that go through purpose selection. Call `runQualityGate()` before `JobCompany` creation and `enrichmentQueue.add('contact-enrichment', ...)`.

**Checkpoint**: Upload a CSV with personal emails, missing data, and valid rows. Verify: filtering summary appears in Slack, filtered rows CSV downloadable, only clean rows enqueued for enrichment, job record has qualityGateResult populated. Clean file uploads produce zero noise.

---

## Phase 4: User Story 2 — Configurable Quality Gate Rules (Priority: P2)

**Goal**: Administrators can configure quality gate rules per workspace — toggle filters, manage suppression lists, override personal domain settings.

**Independent Test**: Configure a workspace to allow personal email domains, upload a CSV with gmail addresses, verify they pass through to enrichment.

### Implementation for User Story 2

- [x] T019 [P] [US2] Implement CRUD routes in `src/routes/admin/qualityGateConfig.ts` with audit logging for all mutations (SOC 2 compliance — log create, update, reset-to-defaults operations following existing admin route audit patterns):
  - `GET /api/v1/admin/quality-gate-config/defaults` — returns global defaults and default personal domain list
  - `GET /api/v1/admin/quality-gate-config/:clientId` — returns workspace config (or defaults with `isCustom: false`)
  - `PUT /api/v1/admin/quality-gate-config/:clientId` — upsert workspace config with domain validation (each domain entry must contain `.`, no protocol/paths; max 500 suppression, 100 overrides, 50 allow)
  - `DELETE /api/v1/admin/quality-gate-config/:clientId` — reset to defaults by deleting custom config record
- [x] T020 [US2] Register quality gate config routes in `src/routes/admin/index.ts` — import and mount `qualityGateConfigRouter` at `/quality-gate-config`
- [x] T021 [P] [US2] Create admin dashboard API client in `admin-dashboard/src/services/qualityGateConfig.ts` — functions: `getConfig(clientId)`, `getDefaults()`, `updateConfig(clientId, data)`, `resetConfig(clientId)` calling the backend endpoints
- [x] T022 [US2] Build quality gate settings UI component in `admin-dashboard/src/components/clients/QualityGateSettings.tsx` — renders inside client detail page with: toggle switches for each filter (reject personal emails, reject missing company, reject duplicates, deduplicate domains), editable suppression domain list (add/remove domains), editable personal domain overrides (add/remove), editable allow list (add/remove), computed display of effective personal domains, "Reset to defaults" button. Follows existing admin dashboard component patterns (React, Tailwind, existing form conventions).
- [x] T023 [US2] Integrate `QualityGateSettings` into the client detail page — add as new tab or section alongside existing workspace settings in the client detail view

**Checkpoint**: Open admin dashboard → navigate to client detail → configure quality gate: turn off personal email filter → upload CSV with gmail addresses via Slack → verify gmail rows pass through. Re-enable filter → upload again → verify gmail rows filtered. Add domain to suppression list → upload → verify blocked. Reset to defaults → verify defaults restored.

---

## Phase 5: User Story 3 — Duplicate Domain Detection (Priority: P2)

**Goal**: Detect and group duplicate domains within a file to avoid redundant BuiltWith lookups. All contacts still get individual Apollo enrichment.

**Independent Test**: Upload a CSV with 20 rows from 5 unique domains. Verify only 5 BuiltWith domain lookups are made while all 20 contacts are enriched.

### Implementation for User Story 3

- [x] T024 [US3] Implement `groupDuplicateDomains(rows, domainColumn)` in `src/services/qualityGate/filters/duplicateDomain.ts` — normalizes all domains (lowercase, strip protocol/www/subdomains via `normalizeDomain()` + `stripSubdomain()`), treats variants like `acme.com`, `www.acme.com`, `ACME.COM` as the same, builds `Map<normalizedDomain, rowIndices[]>`, returns `{uniqueDomains: string[], groups: Map<string, number[]>, duplicateRowCount: number}`.
- [x] T025 [US3] Integrate domain grouping into `runQualityGate()` in `src/services/qualityGate/qualityGate.ts` — after all filters complete, call `groupDuplicateDomains()` on the passed rows. Add `uniqueDomains` and `duplicateDomainRows` to `QualityGateResult`. Include domain dedup info in the Slack summary blocks (e.g., "5 unique domains detected across 453 rows. Technographic enrichment will run for 5 domains.") — only when `duplicateDomainRows > 0`.
- [x] T026 [US3] Modify enrichment job data in `src/listeners/events/message.ts` — pass unique domain list from quality gate result to the BullMQ job payload so the technographic worker can skip redundant BuiltWith lookups. Add a `uniqueDomains` field to the job data alongside the full `companies` array.
- [x] T027 [US3] Modify technographic enrichment worker in `src/services/queue/workers/combined.ts` (and `src/services/queue/workers/technographic.ts` if separate) — when `uniqueDomains` is provided in job data, only call BuiltWith API for unique domains. Share the BuiltWith result across all `JobCompany` records with the same normalized domain. Continue to enrich ALL contacts individually via Apollo.

**Checkpoint**: Upload CSV with 20 rows across 5 domains (include variants like www.acme.com and ACME.COM). Verify: Slack summary shows "5 unique domains detected across 20 rows", only 5 BuiltWith API calls logged in `ApiUsageLog`, all 20 `JobCompany` records enriched with shared tech data, all 20 contacts individually enriched via Apollo.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Job detail UI, API response extensions, and edge case hardening

- [x] T028 Extend job detail view in `admin-dashboard/src/pages/jobs/` to display quality gate results — show total/passed/filtered counts, filter breakdown, link to download filtered CSV, config snapshot used
- [x] T029 Extend job list API response in `src/routes/admin/jobs.ts` to include `qualityGateSummary` (totalRows, passedRows, filteredRows, uniqueDomains) extracted from the JSONB field
- [x] T030 Extend job detail API response in `src/routes/admin/jobs.ts` to include full `qualityGateResult` and `qualityGateConfigSnapshot` fields
- [x] T031 Log quality gate filtering stats in `ApiUsageLog` for the job (FR-017) — record the number of rows filtered, credits saved (avoided API calls), and unique domains detected. Create an `ApiUsageLog` entry with service `QUALITY_GATE` so filtered/dedup counts appear alongside BuiltWith and Apollo usage for each job.
- [x] T032 Integrate quality gate into workflow executor action handlers `src/services/workflow/nodes/actionExecutors/getEmail.ts` and `src/services/workflow/nodes/actionExecutors/getPhone.ts` — these paths enqueue enrichment jobs via `enrichmentQueue.add()` bypassing `message.ts` and `purposeSelection.ts`. Apply the same `runQualityGate()` call before enqueue.
- [x] T033 Build and deploy admin dashboard frontend: `cd admin-dashboard && npm run build && aws s3 sync dist/ s3://slkadmin-developerlabs-ai/ --delete && aws cloudfront create-invalidation --distribution-id E30ZVBVU06GFUV --paths "/*"`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately
- **Foundational (Phase 2)**: Depends on T001-T003 (schema + types)
- **US1 (Phase 3)**: Depends on Phase 2 completion (config system). This is the MVP.
- **US2 (Phase 4)**: Depends on Phase 2 (config system) + US1 (gate must exist to configure). Can start T019-T021 in parallel with US1.
- **US3 (Phase 5)**: Depends on US1 (gate orchestrator must exist). T024 can start in parallel with US1.
- **Polish (Phase 6)**: Depends on US1 minimum; ideally after US2 + US3

### User Story Dependencies

- **US1 (P1)**: Can start after Phase 2. No dependencies on other stories. **This is the MVP.**
- **US2 (P2)**: API routes (T019) can start in parallel with US1. UI (T022) can start in parallel. Integration testing requires US1 complete.
- **US3 (P2)**: Domain grouping logic (T024) can start in parallel with US1. Worker modification (T027) requires US1 complete.

### Within Each User Story

- Filter modules (T010-T013) can all run in parallel (different files)
- Orchestrator (T014) depends on all filter modules
- CSV generation (T015) can parallel with orchestrator
- Slack blocks (T016) depends on orchestrator types
- Pipeline integration (T017-T018) depends on orchestrator + CSV + Slack blocks

### Parallel Opportunities

**Phase 1**: T004, T005, T006 can all run in parallel (different files, no dependencies)
**Phase 3 (US1)**: T010, T011, T012, T013 can all run in parallel (separate filter modules)
**Phase 4 (US2)**: T019, T021 can run in parallel (backend routes + frontend service)
**Cross-story**: T019 (US2 API), T024 (US3 domain grouping) can start alongside US1 implementation

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (schema, types, utils) — ~T001-T006
2. Complete Phase 2: Foundational (config loading) — ~T007-T009
3. Complete Phase 3: User Story 1 (filters + gate + integration) — ~T010-T018
4. **STOP and VALIDATE**: Deploy to ECS, upload test CSVs, verify filtering works with global defaults
5. This alone delivers the primary value: reduced API spend from junk row filtering

### Incremental Delivery

1. Setup + Foundational → Config system ready
2. Add US1 → Test independently → Deploy (MVP — API cost savings live)
3. Add US2 → Test independently → Deploy (per-workspace customization)
4. Add US3 → Test independently → Deploy (domain dedup savings)
5. Add Polish → Deploy (admin visibility, edge cases)
6. Each story adds value without breaking previous stories
