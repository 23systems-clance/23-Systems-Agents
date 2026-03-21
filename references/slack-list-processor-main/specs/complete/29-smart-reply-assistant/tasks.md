# Tasks: Smart Reply Assistant

**Input**: Design documents from `/specs/29-smart-reply-assistant/`
**Prerequisites**: plan.md, spec.md, data-model.md, contracts/api.yaml, research.md, quickstart.md

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2)
- Includes exact file paths in descriptions

## Path Conventions

- **Backend**: `src/` at repository root (Express + BullMQ)
- **Frontend**: `admin-dashboard/src/` (React + Vite admin dashboard)
- **Schema**: `prisma/schema.prisma`

---

## Phase 1: Setup (Schema Migration)

**Purpose**: Database schema changes required by all downstream features

- [x] T001 Add `SmartReplyDraftStatus` enum (GENERATING, READY, SENT, REJECTED, FAILED) to `prisma/schema.prisma`
- [x] T002 Add 7 smart reply draft fields to `UniboxReply` model in `prisma/schema.prisma`: `draftBody` (Text), `draftStatus` (SmartReplyDraftStatus?), `draftIntent` (String?), `draftGeneratedAt` (DateTime?), `draftTokensUsed` (Int?), `draftCostUsd` (Decimal(10,6)?), `draftError` (Text?), plus `@@index([draftStatus])`
- [x] T003 Add 2 personality fields to `CampaignContact` model in `prisma/schema.prisma`: `personalityData` (JsonB?), `personalityEnrichedAt` (DateTime?)
- [x] T004 Generate and apply Prisma migration: `npx prisma migrate dev --name add-smart-reply-draft-fields`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**CRITICAL**: No user story work can begin until this phase is complete

- [x] T005 Add `smart-reply-generator` prompt to `src/services/ai/defaultPrompts.ts` — Claude Haiku 4.5 Tool Use prompt for combined intent classification + draft generation returning `{ intent, should_reply, draft_body, confidence }`
- [x] T006 Create `src/services/ai/smartReplyGenerator.ts` — AI draft generation service: accepts reply body (truncated to 2,000 chars), campaign context (sequence copy, ICP, meeting link), contact context (name, company, title), and optional personality data; calls Claude Haiku 4.5 via Tool Use; returns intent, should_reply boolean, draft_body (under 150 words), confidence score, and token usage/cost tracking
- [x] T007 Add `smartReplyQueue` to `src/services/queue/queues.ts` — new BullMQ queue named `smart-reply` following existing queue patterns (campaignQueue, hubspotActivitySyncQueue)
- [x] T008 Create `src/services/queue/workers/smartReplyWorker.ts` — BullMQ worker with concurrency 3: receives `{ replyId, tone? }` job data, loads UniboxReply + CampaignContact + Campaign context, calls smartReplyGenerator, updates UniboxReply with draftBody/draftStatus/draftIntent/draftGeneratedAt/draftTokensUsed/draftCostUsd (READY on success, FAILED + draftError on failure)
- [x] T009 Register smart reply worker in `src/app.ts` — add `workers.push(createSmartReplyWorker())` following existing worker registration pattern

**Checkpoint**: Foundation ready — smart reply queue and AI service operational

---

## Phase 3: User Story 1 + User Story 2 — AI-Drafted Reply + Intent Classification (Priority: P1) MVP

**Goal**: When a prospect reply arrives via webhook, the system classifies intent and generates a contextual draft reply. BDRs review, edit, and send drafts from the UniBox.

**Independent Test**: Trigger a reply webhook from Instantly -> verify UniboxReply created with draftStatus=GENERATING -> wait ~10-30s -> verify draftStatus=READY with draftBody and draftIntent populated -> open UniBox in dashboard -> verify draft panel appears -> accept/dismiss draft.

### Implementation

- [x] T010 [US1] Modify Instantly webhook handler in `src/routes/webhooks/instantly.ts` — after creating UniboxReply for `reply_received` events, set draftStatus=GENERATING and enqueue job to smartReplyQueue with `{ replyId }`. Draft generation must not block webhook response (FR-010).
- [x] T011 [P] [US1] Modify UniBox GET endpoint in `src/routes/bdr/unibox.ts` — extend response to include draft fields per reply: `draftBody`, `draftStatus`, `draftIntent`, `draftGeneratedAt`, `draftError` (add to Prisma select)
- [x] T012 [P] [US1] Add `PATCH /api/v1/bdr/unibox/:replyId/draft/accept` endpoint in `src/routes/bdr/unibox.ts` — accepts optional `body` (edited draft text), sends reply via existing Instantly reply mechanism, sets draftStatus=SENT. If `body` omitted, sends original draftBody. Include structured audit log entry (who, what, when) per Constitution V.
- [x] T013 [P] [US1] Add `PATCH /api/v1/bdr/unibox/:replyId/draft/dismiss` endpoint in `src/routes/bdr/unibox.ts` — sets draftStatus=REJECTED, returns success. Include structured audit log entry (who, what, when) per Constitution V.
- [x] T014 [P] [US1] Update frontend types and API functions in `admin-dashboard/src/services/bdr-unibox.ts` — add SmartReplyDraftStatus type, draft fields to UniboxReply interface, acceptDraft(), dismissDraft() API functions
- [x] T015 [US1] Create `admin-dashboard/src/components/bdr/SmartReplyDraft.tsx` — draft review panel component: shows draftBody with intent badge, "Accept & Send" button (with inline edit capability), "Dismiss" button, loading state for GENERATING, error state for FAILED with retry, hidden when no draft
- [x] T016 [US1] Integrate SmartReplyDraft panel into `admin-dashboard/src/pages/bdr/unibox.tsx` — render SmartReplyDraft component in the reply detail panel, pass draft data and action handlers

**Checkpoint**: US1 + US2 fully functional — drafts auto-generate on reply, BDRs can accept/dismiss

---

## Phase 4: User Story 3 — Regenerate Draft with Different Tone (Priority: P2)

**Goal**: BDRs can regenerate a draft with a specified tone (professional, casual, assertive, empathetic).

**Independent Test**: Open a reply with a READY draft -> click "Regenerate" -> select "casual" tone -> verify draft status changes to GENERATING -> wait -> verify new draft with casual tone replaces the old one.

### Implementation

- [x] T017 [US3] Add `POST /api/v1/bdr/unibox/:replyId/draft/regenerate` endpoint in `src/routes/bdr/unibox.ts` — accepts `{ tone }` body (professional|casual|assertive|empathetic), validates draft exists, sets draftStatus=GENERATING, enqueues job to smartReplyQueue with `{ replyId, tone }`, returns `{ success: true, jobId }`. Include structured audit log entry (who, what, when) per Constitution V.
- [x] T018 [US3] Update smartReplyWorker in `src/services/queue/workers/smartReplyWorker.ts` — handle optional `tone` parameter in job data, pass tone to smartReplyGenerator to modify prompt instructions
- [x] T019 [US3] Update smartReplyGenerator in `src/services/ai/smartReplyGenerator.ts` — accept optional `tone` parameter, adjust prompt instructions to match requested tone
- [x] T020 [US3] Add `regenerateDraft(replyId, tone)` API function to `admin-dashboard/src/services/bdr-unibox.ts`
- [x] T021 [US3] Add tone selector and "Regenerate" button to `admin-dashboard/src/components/bdr/SmartReplyDraft.tsx` — dropdown/chips for 4 tone options, triggers regeneration, shows loading state during GENERATING

**Checkpoint**: US3 complete — BDRs can regenerate drafts with different tones

---

## Phase 5: User Story 4 — On-Demand Personality Enrichment (Priority: P2)

**Goal**: BDRs can trigger AI Ark personality enrichment for a specific contact via dashboard button or Slack command. Data is stored on CampaignContact and cached in PersonalityAnalysis.

**Independent Test**: Navigate to contact detail page -> click "Enrich" for a contact with LinkedIn URL -> verify personality data appears within 10 seconds. Also: run `/enrich personality <contactId>` in Slack -> verify confirmation message.

### Implementation

- [x] T022 [US4] Add `POST /api/v1/bdr/personality/:contactId/enrich` endpoint in `src/routes/bdr/personality.ts` — JSON enrichment endpoint: validates contact has both a non-null email address and LinkedIn URL (FR-013), checks existing personality data (skip if exists unless `force=true`), calls existing `personalityAnalysis()` function, stores result in both PersonalityAnalysis cache and CampaignContact.personalityData/personalityEnrichedAt, returns `{ success, archetype, enrichedAt }` or `{ skipped, reason, archetype }`. Include structured audit log entry (who, what, when) per Constitution V.
- [x] T023 [US4] Add `personality` subcommand to `/enrich` command in `src/listeners/commands/enrich.ts` — accepts contactId (UUID) or search term (name/email), looks up contact, validates LinkedIn URL, calls `personalityAnalysis()`, posts Slack message with archetype, communication style, and "View Contact Profile" button linking to dashboard
- [x] T024 [P] [US4] Add enrichment trigger button and API function to frontend — add `enrichContact(contactId, force?)` to `admin-dashboard/src/services/contact-detail.ts` (created in US5, or create stub here)

**Checkpoint**: US4 complete — on-demand enrichment works via dashboard and Slack

---

## Phase 6: User Story 7 — Export Personality Data to CRM (Priority: P2)

**Goal**: Admins can push personality data to HubSpot and export as CSV for campaign contacts.

**Independent Test**: Click "Push to HubSpot" for a campaign with enriched contacts -> verify custom properties created in HubSpot + values written. Click "Export CSV" -> verify CSV download with all personality fields.

### Implementation

- [x] T025 [US7] Create `src/services/campaign/personalityCrmSync.ts` — HubSpot personality push service: idempotently creates 16 custom properties with `aiark_` prefix (archetype, 4 DISC scores, 5 OCEAN scores, communication_types, communication_adjectives, key_traits_risk, key_traits_decision_drivers, email_tone, email_length), then writes values to HubSpot contacts. Returns summary `{ total, synced, skipped, failed, errors }`. Skips contacts without personality data (FR-026).
- [x] T026 [US7] Add HubSpot custom property creation methods to `src/services/hubspot/hubspotClient.ts` — `ensureCustomProperties(properties[])` using HubSpot Properties API, checks existence first (FR-025 idempotent)
- [x] T027 [US7] Add `POST /api/v1/admin/campaigns/:campaignId/personality/push-crm` endpoint in `src/routes/admin/campaigns.ts` — calls personalityCrmSync, returns sync summary
- [x] T028 [US7] Add `GET /api/v1/admin/campaigns/:campaignId/personality/export-csv` endpoint in `src/routes/admin/campaigns.ts` — queries campaign contacts with personalityData, streams CSV with columns: firstName, lastName, email, companyName, jobTitle, linkedinUrl, archetype, disc_dominance, disc_influence, disc_steadiness, disc_calculativeness, ocean_openness, ocean_conscientiousness, ocean_extraversion, ocean_agreeableness, ocean_emotional_stability, communication_types, communication_adjectives, what_to_say, what_to_avoid, key_traits_risk, key_traits_decision_drivers, email_tone, email_length
- [x] T029 [P] [US7] Add "Push to HubSpot" and "Export CSV" buttons to campaign management UI in campaign detail page (`admin-dashboard/src/pages/admin/campaign-detail.tsx` or equivalent existing campaign management page) — calls push-crm and export-csv endpoints, shows sync summary/progress for HubSpot, triggers CSV download for export

**Checkpoint**: US7 complete — personality data exportable to HubSpot CRM and CSV

---

## Phase 7: User Story 5 — Contact Details Page with Personality Visualization (Priority: P3)

**Goal**: BDRs can view a rich contact profile with personality visualization (DISC, OCEAN, archetype, communication guidance) and conversation history.

**Independent Test**: Navigate to `/contacts/:contactId` -> verify contact info, personality bar charts, archetype badge, communication guidance, and conversation timeline. Test with and without personality data.

### Implementation

- [x] T030 [US5] Create `GET /api/v1/admin/contacts/:contactId` endpoint in `src/routes/admin/contacts.ts` — returns contact info, campaign context, personality data (from CampaignContact.personalityData), and conversation history (UniboxReplies + step executions in chronological order)
- [x] T031 [P] [US5] Create `admin-dashboard/src/services/contact-detail.ts` — API service with `getContactDetail(contactId)` function, TypeScript interfaces for ContactDetail response (contact, campaign, personality, conversationHistory)
- [x] T032 [US5] Create `admin-dashboard/src/pages/contact-detail.tsx` — contact details page: contact info header, personality visualization section (DISC horizontal bar charts, OCEAN horizontal bar charts, archetype badge, communication adjectives, "what to say"/"what to avoid" lists, key decision traits, email approach guide), conversation history timeline, "Enrich" button (calls US4 endpoint). Personality sections hidden when no data (FR-019).
- [x] T033 [US5] Add `/contacts/:contactId` route to `admin-dashboard/src/router.tsx`
- [x] T034 [US5] Add contact name link in `admin-dashboard/src/pages/bdr/unibox.tsx` — clicking a contact name navigates to `/contacts/:contactId` (FR-021)

**Checkpoint**: US5 complete — contact details page with full personality visualization

---

## Phase 8: User Story 6 — Slack Notifications with Contact Profile Link (Priority: P3)

**Goal**: When a reply arrives, Slack DMs are sent to assigned BDRs and a notification is posted to the campaign's originating channel, both with reply preview, personality summary, and dashboard link.

**Independent Test**: Trigger a reply webhook for a campaign with assigned BDRs -> verify DM sent to each BDR + message posted to campaign channel with reply preview, intent badge, personality archetype (if available), and "View Contact Profile" button.

### Implementation

- [x] T034a [US6] Verify BDR assignment UI exists for campaigns — check if admin dashboard already has a multi-select for assigning BDRs to campaigns via `CampaignBdr` junction table. If missing, add BDR assignment multi-select component to the campaign detail/edit page in `admin-dashboard/src/` with API endpoint in `src/routes/admin/campaigns.ts` (FR-022a)
- [x] T035 [US6] Add Slack notification logic to `src/routes/webhooks/instantly.ts` — after creating UniboxReply and enqueuing smart reply job: (1) query CampaignBdr for all assigned BDRs, DM each with reply preview (first 200 chars), intent badge, personality archetype + communication style (if available), "View Contact Profile" button (dashboard URL), and "Open UniBox" button; (2) post same content to campaign.slackChannelId if set (FR-023). Skip DMs if no BDRs assigned (FR-022). Skip channel notification if no slackChannelId.
- [x] T036 [US6] Update Slack notification content after draft is ready — enhance the notification posted in T035 to include the classified intent once the smart reply worker completes (consider: post initial notification on webhook receipt with reply preview, then update/post follow-up when draft completes with intent classification)

**Checkpoint**: US6 complete — BDRs receive Slack DMs and channel notifications for replies

---

## Phase 9: Polish & Cross-Cutting Concerns

**Purpose**: Enhancements that span multiple user stories

- [x] T037 [P] Add file attachment support to reply endpoints in `src/routes/bdr/unibox.ts` — configure multer middleware (memory storage) for `POST /:replyId/respond` and `PATCH /:replyId/draft/accept` endpoints. Max 5 files, 10MB each, PDF/DOCX/XLSX/PNG/JPG/GIF only. Forward attachments to Instantly API (FR-010c).
- [x] T038 [P] Add file upload UI to SmartReplyDraft and manual reply components in `admin-dashboard/src/components/bdr/SmartReplyDraft.tsx` and `admin-dashboard/src/pages/bdr/unibox.tsx` — file picker, attachment preview, multipart/form-data submission
- [x] T038a [P] Add draft acceptance/dismissal metrics to admin dashboard — query UniboxReply draftStatus counts (SENT vs REJECTED) for SC-002/SC-004 measurement, display in campaign or admin overview page in `admin-dashboard/src/`
- [x] T039 Deploy frontend: `cd admin-dashboard && npm run build && aws s3 sync dist/ s3://slkadmin-developerlabs-ai/ --delete && aws cloudfront create-invalidation --distribution-id E30ZVBVU06GFUV --paths "/*"`
- [x] T040 Run quickstart.md verification checklist against deployed ECS service

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately
- **Foundational (Phase 2)**: Depends on Phase 1 (schema migration) — BLOCKS all user stories
- **US1+US2 (Phase 3)**: Depends on Phase 2 — MVP delivery
- **US3 (Phase 4)**: Depends on Phase 2 (worker/generator) — can start after Phase 2, independent of Phase 3
- **US4 (Phase 5)**: Depends on Phase 1 (personalityData field on CampaignContact) — independent of US1-US3
- **US7 (Phase 6)**: Depends on US4 being available (enriched contacts needed) — can start in parallel with implementation but needs enriched data to test
- **US5 (Phase 7)**: Depends on Phase 1 (schema) — independent of other stories but enhanced by US4 personality data
- **US6 (Phase 8)**: Depends on Phase 2 (webhook modification in US1 can be extended) — independent but benefits from US5 contact page for links
- **Polish (Phase 9)**: Can start after Phase 3 (attachment support extends existing endpoints)

### User Story Dependencies

```
Phase 1 (Setup)
    │
    ▼
Phase 2 (Foundational)
    │
    ├──► Phase 3: US1+US2 (P1, MVP) ──► Phase 4: US3 (P2)
    │
    ├──► Phase 5: US4 (P2) ──► Phase 6: US7 (P2)
    │
    ├──► Phase 7: US5 (P3)
    │
    └──► Phase 8: US6 (P3)

All ──► Phase 9: Polish
```

### Within Each User Story

- Schema/models before services
- Services before API endpoints
- API endpoints before frontend
- Backend complete before frontend integration

### Parallel Opportunities

- **Phase 1**: T001-T003 can run in parallel (different schema sections), T004 sequential after
- **Phase 2**: T005-T008 are sequential (each builds on prior), T009 depends on T008
- **Phase 3**: T011, T012, T013, T014 can run in parallel (different endpoints/files), T015-T016 sequential (component then integration)
- **Phase 4**: T017-T019 sequential (endpoint -> worker -> generator), T020-T021 parallel with each other after backend
- **Phase 5**: T022-T023 parallel (different files), T024 parallel
- **Phase 6**: T025-T026 sequential, T027-T028 parallel after T025-T026, T029 after backend
- **Phase 7**: T030-T031 parallel, T032 after both, T033-T034 parallel after T032
- **Phase 8**: T035-T036 sequential
- **Phase 9**: T037-T038 parallel, T039-T040 sequential after all

---

## Implementation Strategy

### MVP First (US1 + US2 Only)

1. Complete Phase 1: Setup (schema migration)
2. Complete Phase 2: Foundational (queue, AI service, worker)
3. Complete Phase 3: US1 + US2 (webhook -> draft -> UniBox panel)
4. **STOP and VALIDATE**: Test smart reply drafting end-to-end via quickstart checklist
5. Deploy and demo

### Incremental Delivery

1. Setup + Foundational -> Foundation ready
2. US1 + US2 -> Smart reply drafting MVP -> Deploy (Phase 3)
3. US3 -> Tone regeneration -> Deploy (Phase 4)
4. US4 -> On-demand enrichment -> Deploy (Phase 5)
5. US7 -> CRM export + CSV -> Deploy (Phase 6)
6. US5 -> Contact details page -> Deploy (Phase 7)
7. US6 -> Slack notifications -> Deploy (Phase 8)
8. Polish -> File attachments, final validation -> Deploy (Phase 9)

Each phase adds value without breaking previous phases.
