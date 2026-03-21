# Tasks: BDR Manager Agent

**Input**: Design documents from `/specs/6-bdr-manager-agent/`
**Prerequisites**: plan.md (required), spec.md (required for user stories)

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Database models, configuration, external API clients, and shared utilities

- [X] T001 Add BDR Manager configuration to src/config/index.ts (HubSpot, Instantly, HeyReach API keys, bdrManager schedule settings)
- [X] T002 Create Campaign and related Prisma models in prisma/schema.prisma (Campaign, CampaignSequenceStep, CampaignContact, CampaignContactStepExecution, CampaignBdr, WebhookEvent, UniboxReply, DailyBdrActivity, EodReport)
- [X] T003 Create ManagedClient, Bdr, and BdrClient Prisma models in prisma/schema.prisma
- [X] T004 Create EnrichmentPreset Prisma model in prisma/schema.prisma
- [X] T005 Run Prisma migrations for all new models (prisma/migrations/)
- [X] T006 [P] Create campaign TypeScript interfaces and types in src/services/campaign/types.ts
- [X] T007 [P] Create campaign validators (LinkedIn URL validation) in src/services/campaign/validators.ts
- [X] T008 [P] Create BDR authentication middleware (magic link auth) in src/lib/bdrAuth.ts
- [X] T009 [P] Create token encryption utility for client API keys in src/lib/tokenEncryption.ts

**Checkpoint**: Database schema ready, shared types and utilities in place

---

## Phase 2: Foundational (External API Clients)

**Purpose**: External API integrations that all campaign features depend on

**CRITICAL**: These clients must be complete before campaign services can function

- [X] T010 [P] Create HubSpot API client with contact list import, rate limiting, and circuit breaker in src/services/hubspot/hubspotClient.ts
- [X] T011 [P] Create Instantly.ai API client with email campaign management, UniBox replies, reply-to-email, rate limiting, and circuit breaker in src/services/instantly/instantlyClient.ts
- [X] T012 [P] Create HeyReach API client with LinkedIn campaign management, conversation retrieval, rate limiting, and circuit breaker in src/services/heyreach/heyreachClient.ts

**Checkpoint**: External API clients ready — campaign services can now be built

---

## Phase 3: User Story 1 — Campaign Creation & Configuration (Priority: P1)

**Goal**: Enable campaign CRUD with sequence templates, asset validation, and lifecycle management

**Independent Test**: Create a campaign via API with all required fields, verify persistence, validate activation prerequisites

### Implementation for User Story 1

- [X] T013 [US1] Implement campaign CRUD service (create, update, list, getDetail) in src/services/campaign/campaignService.ts
- [X] T014 [US1] Implement campaign validation for activation (required fields by campaign type) in src/services/campaign/campaignService.ts
- [X] T015 [US1] Implement campaign lifecycle transitions (activate, pause, resume) in src/services/campaign/campaignService.ts
- [X] T016 [US1] Create campaign REST API routes (POST, GET, GET/:id, PATCH/:id, POST/:id/activate, POST/:id/pause, POST/:id/resume) in src/routes/campaigns.ts
- [X] T017 [US1] Mount campaign API routes with API key auth in src/server.ts

**Checkpoint**: Campaigns can be created, configured, validated, and activated via API

---

## Phase 4: User Story 2 — HubSpot List Import & Contact Validation (Priority: P1)

**Goal**: Import contacts from HubSpot lists on campaign activation with skip logic for missing data

**Independent Test**: Activate a campaign with a HubSpot list containing contacts with varying data completeness, verify capability flags and skip logic

### Implementation for User Story 2

- [X] T018 [US2] Implement contact import service with HubSpot list fetching, capability flag assignment (canEmail, canCall, canLinkedin), and phone fallback logic in src/services/campaign/contactImport.ts
- [X] T019 [US2] Create campaign-import BullMQ job handler in src/services/queue/workers/campaignDispatcher.ts
- [X] T020 [US2] Register campaign queue and campaign-import job type in src/services/queue/queues.ts

**Checkpoint**: Campaign activation triggers HubSpot import with validated contact data

---

## Phase 5: User Story 3 — Sequence Execution Engine (Priority: P1)

**Goal**: Orchestrate multi-channel outreach sequences with webhook-driven progression

**Independent Test**: Activate a campaign, verify email steps trigger Instantly, LinkedIn steps trigger HeyReach, phone steps surface as tasks, and webhooks advance contacts

### Implementation for User Story 3

- [X] T021 [P] [US3] Create email step executor (fires via Instantly API) in src/services/campaign/executors/emailExecutor.ts
- [X] T022 [P] [US3] Create LinkedIn step executor (fires via HeyReach API) in src/services/campaign/executors/linkedinExecutor.ts
- [X] T023 [P] [US3] Create phone call step executor (creates manual task) in src/services/campaign/executors/callExecutor.ts
- [X] T024 [US3] Implement sequence engine with step execution, contact advancement, skip logic, and completion handling in src/services/campaign/sequenceEngine.ts
- [X] T025 [US3] Create campaign-sequence BullMQ job handler in src/services/queue/workers/campaignDispatcher.ts
- [X] T026 [P] [US3] Create Instantly.ai webhook handler (email_sent, reply_received, email_bounced) with deduplication in src/routes/webhooks/instantly.ts
- [X] T027 [P] [US3] Create HeyReach webhook handler (CONNECTION_REQUEST_SENT, MESSAGE_SENT, MESSAGE_REPLY_RECEIVED) with deduplication in src/routes/webhooks/heyreach.ts
- [X] T028 [US3] Mount webhook routes in src/server.ts
- [X] T029 [US3] Implement stuck step detector (flag contacts waiting >N hours for webhook) in src/services/campaign/stuckStepDetector.ts
- [X] T030 [US3] Register campaign-stuck-check repeating job (hourly) in src/services/queue/queues.ts
- [X] T031 [US3] Implement activity tracker (update DailyBdrActivity counters on each action) in src/services/campaign/activityTracker.ts

**Checkpoint**: Full sequence lifecycle works — automated steps fire, webhooks advance, stuck steps detected

---

## Phase 6: User Story 4 — Daily BDR Slack DM Briefing (Priority: P1)

**Goal**: Send daily morning Slack DM to each BDR with task summary and link to web UI

**Independent Test**: Configure a BDR with active campaigns, verify daily DM arrives with accurate counts and working link

### Implementation for User Story 4

- [X] T032 [US4] Implement daily briefing DM sender (aggregate pending calls, waiting webhooks, unread replies per campaign per BDR) in src/services/campaign/dailyDm.ts
- [X] T033 [US4] Register campaign-daily-dm repeating job (configurable morning hour) in src/services/queue/queues.ts

**Checkpoint**: BDRs receive morning DMs with task counts and web UI link

---

## Phase 7: User Story 5 — Web Task UI: Call List & UniBox (Priority: P1)

**Goal**: Provide BDR web interface with unified inbox (email + LinkedIn replies) and call lists with HubSpot links

**Independent Test**: Access web UI as BDR, verify UniBox shows replies and call list shows contacts with HubSpot links

### Backend API for User Story 5

- [X] T034 [US5] Create BDR router with magic link auth middleware in src/routes/bdr/index.ts
- [X] T035 [P] [US5] Create BDR tasks endpoint (GET /tasks — task counts per campaign) in src/routes/bdr/tasks.ts
- [X] T036 [P] [US5] Create BDR calls endpoints (GET /calls/:campaignId — call list, POST /calls/:contactId/complete — mark call complete) in src/routes/bdr/calls.ts
- [X] T037 [P] [US5] Create BDR unibox endpoints (GET /unibox — unified inbox, POST /unibox/:replyId/respond — reply via Instantly, PATCH /unibox/:replyId/read — mark read) in src/routes/bdr/unibox.ts
- [X] T038 [US5] Implement UniBox service (query replies, mark read, reply-to-email via Instantly API) in src/services/campaign/unibox.ts
- [X] T039 [US5] Mount BDR routes with auth in src/server.ts

### Frontend for User Story 5

- [X] T040 [P] [US5] Create BDR task overview page in admin-dashboard/src/pages/bdr/tasks.tsx
- [X] T041 [P] [US5] Create BDR call list page with HubSpot contact links in admin-dashboard/src/pages/bdr/calls.tsx
- [X] T042 [P] [US5] Create BDR unified inbox page (email + LinkedIn replies) in admin-dashboard/src/pages/bdr/unibox.tsx
- [X] T043 [P] [US5] Create BDR API service clients in admin-dashboard/src/services/bdr-calls.ts, bdr-tasks.ts, bdr-unibox.ts
- [X] T044 [US5] Create BDR auth hook for magic link authentication in admin-dashboard/src/hooks/useBdrAuth.ts
- [X] T045 [US5] Add BDR routes to admin-dashboard/src/router.tsx

**Checkpoint**: BDRs can access web UI, view call lists, mark calls complete, and manage UniBox replies

---

## Phase 8: User Story 6 — Daily Stats & End-of-Day Report (Priority: P2)

**Goal**: Track daily activity stats and send EOD Slack DM with auto-generated or prompted reports

**Independent Test**: Run a day of campaign activity, verify EOD report contains accurate statistics

### Implementation for User Story 6

- [X] T046 [US6] Create BDR stats endpoint (GET /stats — daily activity by campaign) in src/routes/bdr/stats.ts
- [X] T047 [US6] Create BDR EOD notes submission endpoint (POST /stats/eod-notes) in src/routes/bdr/stats.ts
- [X] T048 [US6] Implement EOD report sender (aggregate stats, include optional BDR notes, send Slack DM) in src/services/campaign/eodReport.ts
- [X] T049 [US6] Register campaign-eod-report repeating job (configurable evening hour) in src/services/queue/queues.ts
- [X] T050 [P] [US6] Create BDR stats dashboard page in admin-dashboard/src/pages/bdr/stats.tsx

**Checkpoint**: Daily stats tracked, EOD reports sent via Slack DM

---

## Phase 9: User Story 7 — Campaign Management & Monitoring (Priority: P2)

**Goal**: Admin dashboard for campaign performance metrics, pause/resume, and sequence funnel visualization

**Independent Test**: View active campaign dashboard with accurate metrics across all sequence steps

### Implementation for User Story 7

- [X] T051 [US7] Implement campaign stats aggregator (contact counts, completion rates, step funnel) in src/services/campaign/statsAggregator.ts
- [X] T052 [US7] Create admin campaign list endpoint (GET /campaigns — with filters) in src/routes/admin/campaigns.ts
- [X] T053 [US7] Create admin campaign detail endpoint (GET /campaigns/:id — with stats and funnel) in src/routes/admin/campaigns.ts
- [X] T054 [US7] Create admin campaign contacts endpoint (GET /campaigns/:id/contacts) in src/routes/admin/campaigns.ts
- [X] T055 [US7] Create admin BDR activity endpoint (GET /bdr-activity) in src/routes/admin/campaigns.ts
- [X] T056 [US7] Create admin EOD reports endpoint (GET /eod-reports) in src/routes/admin/campaigns.ts
- [X] T057 [US7] Mount campaign admin routes in src/routes/admin/index.ts
- [X] T058 [P] [US7] Create campaign list page in admin-dashboard/src/pages/campaigns.tsx
- [X] T059 [P] [US7] Create campaign detail/metrics page in admin-dashboard/src/pages/campaign-detail.tsx
- [X] T060 [P] [US7] Create BDR activity summary page in admin-dashboard/src/pages/bdr-activity.tsx
- [X] T061 [P] [US7] Create campaign API service client in admin-dashboard/src/services/campaigns.ts
- [X] T062 [US7] Add campaign and BDR activity routes to admin-dashboard/src/router.tsx

**Checkpoint**: Managers can monitor campaigns, view metrics, pause/resume from dashboard

---

## Phase 10: User Story 8 — Campaign API for External Integration (Priority: P2)

**Goal**: Full REST API enabling external applications to manage campaigns programmatically

**Independent Test**: Send complete campaign payload via API POST, verify creation, contact import, and sequence start

### Implementation for User Story 8

- [X] T063 [US8] Ensure campaign API supports autoActivate flag (create + activate in one call) in src/routes/campaigns.ts
- [X] T064 [US8] Ensure campaign API returns field-level validation errors (400 response) in src/routes/campaigns.ts

**Checkpoint**: External applications can create, manage, and monitor campaigns via API

---

## Phase 11: Admin Management (Cross-Cutting)

**Purpose**: Admin UI for BDR management, client management, and enrichment presets

- [X] T065 [P] Create BDR CRUD admin API endpoints in src/routes/admin/bdrManagement.ts
- [X] T066 [P] Create client management admin API endpoints in src/routes/admin/clientManagement.ts
- [X] T067 [P] Create enrichment preset management endpoints in src/routes/admin/enrichmentPresets.ts
- [X] T068 [P] Create enrichment preset Slack action handlers in src/listeners/actions/enrichmentPresetBlocks.ts and src/listeners/actions/enrichmentPresetSelection.ts
- [X] T069 Mount BDR, client, and enrichment preset admin routes in src/routes/admin/index.ts
- [X] T070 [P] Create BDR management admin page in admin-dashboard/src/pages/managed-bdrs.tsx
- [X] T071 [P] Create client management admin page in admin-dashboard/src/pages/managed-clients.tsx
- [X] T072 [P] Create enrichment preset management page in admin-dashboard/src/pages/enrichment.tsx
- [X] T073 [P] Create admin API service clients (bdrs.ts, managed-clients.ts, enrichment-presets.ts) in admin-dashboard/src/services/
- [X] T074 Add management page routes to admin-dashboard/src/router.tsx

**Checkpoint**: Full admin UI for managing BDRs, clients, and enrichment presets

---

## Phase 12: Polish & Cross-Cutting Concerns

**Purpose**: Integration wiring, type safety, and deployment readiness

- [X] T075 Register campaign dispatcher worker in src/app.ts
- [X] T076 Update admin-dashboard/src/components/layout/AppSidebar.tsx with campaign and BDR navigation links
- [X] T077 Update admin-dashboard/src/lib/query-keys.ts with campaign and BDR query keys
- [X] T078 Update admin-dashboard/src/types/api.ts with campaign and BDR response types
- [X] T079 Verify TypeScript compilation passes (npx tsc --noEmit)
- [X] T080 Update CloudFormation template with new environment variables in infra/cloudformation.yaml
- [X] T081 Update deploy script with new env vars in infra/deploy.sh

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately
- **Foundational (Phase 2)**: Depends on Phase 1 (models + config must exist)
- **US1 Campaign Creation (Phase 3)**: Depends on Phase 1 (models + types)
- **US2 Contact Import (Phase 4)**: Depends on Phase 2 (HubSpot client) + Phase 3 (campaign service)
- **US3 Sequence Engine (Phase 5)**: Depends on Phase 2 (Instantly + HeyReach clients) + Phase 4 (contacts imported)
- **US4 Daily DM (Phase 6)**: Depends on Phase 5 (sequence state needed for task counts)
- **US5 Web Task UI (Phase 7)**: Depends on Phase 5 (sequence engine) — can parallel with Phase 6
- **US6 EOD Reports (Phase 8)**: Depends on Phase 5 (activity tracker) — can parallel with Phase 7
- **US7 Campaign Monitoring (Phase 9)**: Depends on Phase 5 (stats aggregator) — can parallel with Phase 7-8
- **US8 Campaign API (Phase 10)**: Mostly done in Phase 3; final validation pass
- **Admin Management (Phase 11)**: Can run in parallel with any user story phase
- **Polish (Phase 12)**: Depends on all phases complete

### Parallel Opportunities

- T006, T007, T008, T009 can all run in parallel (Phase 1)
- T010, T011, T012 can all run in parallel (Phase 2)
- T021, T022, T023 can all run in parallel (executors)
- T026, T027 can run in parallel (webhook handlers)
- T035, T036, T037 can run in parallel (BDR API endpoints)
- T040, T041, T042, T043 can run in parallel (BDR frontend pages)
- T058, T059, T060, T061 can run in parallel (admin frontend pages)
- T065, T066, T067, T070, T071, T072, T073 can run in parallel (admin management)
- Phases 6, 7, 8, 9 can run in parallel after Phase 5

---

## Implementation Strategy

### MVP First (User Stories 1-3)

1. Complete Phase 1: Setup (models, config, types)
2. Complete Phase 2: External API clients
3. Complete Phase 3: Campaign CRUD
4. Complete Phase 4: Contact import
5. Complete Phase 5: Sequence engine + webhooks
6. **STOP and VALIDATE**: Verify campaigns activate, sequences fire, webhooks advance

### Incremental Delivery

1. MVP → Campaign creation + contact import + sequence engine
2. Add Daily DMs + Web Task UI → BDR daily workflow functional
3. Add EOD Reports + Campaign Monitoring → Manager visibility
4. Add External API enhancements + Admin Management → Full platform
5. Polish → Deployment readiness

### Summary

- **Total tasks**: 81
- **Phase 1 (Setup)**: 9 tasks
- **Phase 2 (Foundational)**: 3 tasks
- **Phase 3 (US1 - Campaign Creation)**: 5 tasks
- **Phase 4 (US2 - Contact Import)**: 3 tasks
- **Phase 5 (US3 - Sequence Engine)**: 11 tasks
- **Phase 6 (US4 - Daily DM)**: 2 tasks
- **Phase 7 (US5 - Web Task UI)**: 12 tasks
- **Phase 8 (US6 - EOD Reports)**: 5 tasks
- **Phase 9 (US7 - Campaign Monitoring)**: 12 tasks
- **Phase 10 (US8 - External API)**: 2 tasks
- **Phase 11 (Admin Management)**: 10 tasks
- **Phase 12 (Polish)**: 7 tasks
- **Parallel opportunities**: 15+ groups of parallelizable tasks
