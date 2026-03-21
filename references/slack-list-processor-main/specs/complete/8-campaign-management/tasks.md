# Tasks: Campaign Management Enhancements

**Input**: Design documents from `/specs/8-campaign-management/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/campaign-api.md, quickstart.md

**Tests**: Not explicitly requested. Manual verification via deployed ECS service.

**Organization**: Tasks grouped by user story for independent implementation and testing.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2)
- Exact file paths included in all descriptions

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Shared types and services that multiple user stories depend on

- [x] T001 [P] Add `ContactQualityStats` and `ExternalCampaignItem` types to `src/services/campaign/types.ts`
- [x] T002 [P] Add `UpdateCampaignInput` type update to include `clientId` field in `src/services/campaign/types.ts`
- [x] T003 Create `src/lib/clientApiService.ts` with `getDecryptedKey(clientId, platform)` function that fetches ManagedClient and decrypts the requested API key using `decrypt()` from `src/lib/tokenEncryption.ts`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Backend service functions that user story UI depends on

**CRITICAL**: No frontend work can begin until these backend services exist

- [x] T004 Update `validateCampaignForActivation()` in `src/services/campaign/campaignService.ts` to add client assignment check (FR-019) and return individual validation errors as an array
- [x] T005 [P] Update `updateCampaign()` in `src/services/campaign/campaignService.ts` to accept and persist `clientId` field
- [x] T006 [P] Add `getContactQualityStats(campaignId)` function to `src/services/campaign/statsAggregator.ts` - count contacts with `canEmail`, `canCall`, `canLinkedin` true, plus multi-channel (all three true) using `Promise.all()` with Prisma count queries
- [x] T007 [P] Add `deleteCampaign(campaignId)` and `archiveCampaign(campaignId)` functions to `src/services/campaign/campaignService.ts` - hard delete for DRAFT with 0 contacts (cascade delete CampaignBdr and CampaignSequenceStep), ARCHIVED status for all others. For ACTIVE campaigns: remove any queued BullMQ jobs for that campaign and update in-progress CampaignContact statuses to reflect stopped execution (FR-013)
- [x] T008 [P] Add frontend service functions `deleteCampaign`, `archiveCampaign`, `fetchContactQuality`, `fetchExternalCampaigns` to `admin-dashboard/src/services/campaigns.ts`

**Checkpoint**: Backend services ready for all user stories

---

## Phase 3: User Story 1 - Edit Campaign and Assign BDRs (Priority: P1) MVP

**Goal**: Enable campaign editing with BDR assignment so campaigns can be activated without 400 errors

**Independent Test**: Create campaign → open edit dialog → assign BDRs, set all required fields → activate → should succeed

### Implementation for User Story 1

- [x] T009 [US1] Update GET `/campaigns/:id` route in `src/routes/admin/campaigns.ts` to include `client` info (join ManagedClient) and `contactQuality` stats in response
- [x] T010 [US1] Update POST `/campaigns/:id/activate` route in `src/routes/admin/campaigns.ts` to return `validationErrors` array alongside error message
- [x] T011 [US1] Update PATCH `/campaigns/:id` route in `src/routes/admin/campaigns.ts` to accept `clientId` in request body
- [x] T012 [US1] Update `CampaignDetail` and `CampaignListItem` interfaces in `admin-dashboard/src/services/campaigns.ts` to include `client` and `contactQuality` fields
- [x] T013 [US1] Create `admin-dashboard/src/components/campaigns/CampaignEditDialog.tsx` - edit dialog with pre-filled form fields: name, description, channel config, HubSpot list ID, sequence steps. Follow Dialog pattern from `managed-bdrs.tsx`
- [x] T014 [US1] Add BDR multi-select to `CampaignEditDialog.tsx` - fetch active BDRs via `fetchBdrs()` from `admin-dashboard/src/services/bdrs.ts`, display as checkbox list, pre-select currently assigned BDRs
- [x] T015 [US1] Add "Edit" button to campaign detail page header in `admin-dashboard/src/pages/campaign-detail.tsx` - visible only for DRAFT and PAUSED status, opens CampaignEditDialog. If campaign has an active import in progress, disable the Edit button and show tooltip "Campaign is currently importing contacts. Please wait." (check import status from campaign detail response)
- [x] T016 [US1] Wire CampaignEditDialog submit to `updateCampaign()` service call with mutation and cache invalidation in `admin-dashboard/src/pages/campaign-detail.tsx`
- [x] T017 [US1] Update `admin-dashboard/src/pages/campaign-create.tsx` to add BDR multi-select (same pattern as edit dialog) so BDRs can be assigned during creation
- [x] T018 [US1] Display improved activation error messages on campaign detail page - show each validation error as a bullet list instead of single error string

**Checkpoint**: Campaigns can be edited and activated with BDRs assigned. MVP complete.

---

## Phase 4: User Story 2 - Assign Campaigns to Clients (Priority: P1)

**Goal**: Enable client assignment on campaigns and filtering by client on list page

**Independent Test**: Create/edit campaign → select client → save → filter campaign list by client → verify filtering works

### Implementation for User Story 2

- [x] T019 [US2] Add client dropdown to `CampaignEditDialog.tsx` in `admin-dashboard/src/components/campaigns/CampaignEditDialog.tsx` - fetch active clients via `fetchManagedClients()` from `admin-dashboard/src/services/managed-clients.ts`, show as Select dropdown
- [x] T020 [US2] Add client dropdown to `admin-dashboard/src/pages/campaign-create.tsx` - same pattern as edit dialog, optional at creation
- [x] T021 [US2] Update GET `/campaigns` route in `src/routes/admin/campaigns.ts` to accept `clientId` query parameter and filter by it
- [x] T022 [US2] Update `listCampaigns()` in `src/services/campaign/campaignService.ts` to accept `clientId` filter in `CampaignFilters` type
- [x] T023 [US2] Add client filter dropdown to `admin-dashboard/src/pages/campaigns.tsx` - fetch clients via `fetchManagedClients()`, add Select next to status filter, pass `clientId` to `fetchCampaigns()` query params
- [x] T024 [US2] Display assigned client name on campaign detail page in `admin-dashboard/src/pages/campaign-detail.tsx` - show client name badge next to campaign type badge in header
- [x] T025 [US2] Display client name in campaign list items in `admin-dashboard/src/pages/campaigns.tsx` - show under campaign name alongside BDR count

**Checkpoint**: Campaigns organized by client, filterable on list page

---

## Phase 5: User Story 3 - Delete Campaigns (Priority: P2)

**Goal**: Enable campaign deletion (hard delete for DRAFT) and archiving (for other statuses)

**Independent Test**: Create DRAFT campaign → delete → confirm removed. Create ACTIVE campaign → archive → verify ARCHIVED status

### Implementation for User Story 3

- [x] T026 [US3] Add DELETE `/campaigns/:id` route to `src/routes/admin/campaigns.ts` - auto-detect action (hard delete DRAFT with 0 contacts, archive others), return appropriate message
- [x] T027 [US3] Add delete/archive buttons to campaign detail page in `admin-dashboard/src/pages/campaign-detail.tsx` - "Delete" for DRAFT (destructive variant), "Archive" for ACTIVE/PAUSED/COMPLETED
- [x] T028 [US3] Add AlertDialog confirmation for delete/archive in `admin-dashboard/src/pages/campaign-detail.tsx` - follow pattern from `admin-dashboard/src/pages/workflows.tsx`, navigate to campaign list on success

**Checkpoint**: Campaigns can be deleted/archived from the UI

---

## Phase 6: User Story 4 - HubSpot Contact Import Intelligence (Priority: P2)

**Goal**: Display contact quality breakdown (Email, Phone, LinkedIn, Multi-Channel) on campaign detail page

**Independent Test**: Import contacts for a campaign → view detail page → verify quality stats card shows accurate counts

### Implementation for User Story 4

- [x] T029 [US4] Add GET `/campaigns/:id/quality` route to `src/routes/admin/campaigns.ts` - call `getContactQualityStats()` from statsAggregator and return results
- [x] T030 [US4] Add contact quality summary card to `admin-dashboard/src/pages/campaign-detail.tsx` - display Email (verified), Mobile Phone (callable), LinkedIn (available), Multi-Channel Total as stat cards below existing stats row. Use useQuery to fetch from `/campaigns/:id/quality`

**Checkpoint**: Contact quality visible on campaign detail page

---

## Phase 7: User Story 5 - External Campaign Linking via API (Priority: P2)

**Goal**: Fetch available Instantly/HeyReach campaigns via client credentials and select from dropdown

**Independent Test**: Attach client to campaign → click "Fetch Campaigns" → verify dropdown shows campaigns from Instantly/HeyReach

### Implementation for User Story 5

- [x] T031 [P] [US5] Add `listCampaigns(apiKey: string)` function to `src/services/instantly/instantlyClient.ts` - GET `/api/v2/campaigns` with Bearer token, add `InstantlyCampaignListItem` type to `src/services/instantly/types.ts`
- [x] T032 [P] [US5] Add `listCampaigns(apiKey: string)` function to `src/services/heyreach/heyreachClient.ts` - GET `/api/public/campaigns` with X-API-KEY header, add `HeyReachCampaignListItem` type to `src/services/heyreach/types.ts`
- [x] T033 [US5] Add GET `/clients/:clientId/external-campaigns` route to `src/routes/admin/clientManagement.ts` - accept `platform` query param, use `clientApiService.getDecryptedKey()` to get API key, call `listCampaigns()` on appropriate client, return campaign list
- [x] T034 [US5] Add external campaign selection to `CampaignEditDialog.tsx` in `admin-dashboard/src/components/campaigns/CampaignEditDialog.tsx` - when client is selected and has API key, show "Fetch Campaigns" button for Instantly and/or HeyReach. On click, call `fetchExternalCampaigns()` and display results in a Select dropdown. Show manual ID entry fallback on error. Disable channel sections when client has no key for that platform

**Checkpoint**: External campaigns selectable via API instead of manual ID entry

---

## Phase 8: User Story 6 - HubSpot Contact Property Mapping (Priority: P3)

**Goal**: Improve contact import accuracy by checking DNC status and proper property mapping

**Independent Test**: Import contacts with various DNC values → verify canCall is false for DNC true/unknown/null

### Implementation for User Story 6

- [x] T035 [US6] Update `importContactsFromHubSpot()` in `src/services/campaign/contactImport.ts` - add `donotcall` to HubSpot properties fetch, update `canCall` logic: `!!resolvedPhone && String(donotcall).toLowerCase() === 'false'` (only allow calling when DNC is explicitly false; treats true/null/undefined/unknown as "do not call")
- [x] T036 [US6] Update `importContactsFromHubSpot()` in `src/services/campaign/contactImport.ts` - add `hs_email_bounce` to properties fetch to improve `canEmail` accuracy (check for hard bounce indicators beyond just `hs_email_status`)

**Checkpoint**: Contact import uses proper DNC filtering and email bounce detection

---

## Phase 9: Polish & Cross-Cutting Concerns

**Purpose**: Final improvements across all user stories

- [x] T037 Add audit logging for campaign mutations in `src/routes/admin/campaigns.ts` - log delete/archive, edit (field changes, BDR/client assignment changes), and activation operations with action, campaignId, userId, timestamp, and before/after values for edits (SOC 2 compliance)
- [x] T038 [P] On campaign detail page in `admin-dashboard/src/pages/campaign-detail.tsx`, show inactive badge on deactivated BDRs in the BDR list, and show warning badge next to client name if the assigned client is inactive
- [ ] T039 Deploy and run quickstart.md verification steps against ECS environment via `./infra/deploy.sh --update` (BLOCKED: pre-existing DB auth error in syncOnboardingSchedulers - not related to campaign changes)
- [x] T040 Deploy admin dashboard frontend: `cd admin-dashboard && npm run build && aws s3 sync dist/ s3://slkadmin-developerlabs-ai/ --delete && aws cloudfront create-invalidation --distribution-id E30ZVBVU06GFUV --paths "/*"`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies - start immediately
- **Phase 2 (Foundational)**: Depends on Phase 1 types
- **Phase 3 (US1 - Edit/BDRs)**: Depends on Phase 2 backend services
- **Phase 4 (US2 - Clients)**: Depends on Phase 2. Can run in parallel with US1
- **Phase 5 (US3 - Delete)**: Depends on Phase 2 (T007). Can run in parallel with US1/US2
- **Phase 6 (US4 - Quality Stats)**: Depends on Phase 2 (T006). Can run in parallel with US1-US3
- **Phase 7 (US5 - External Linking)**: Depends on Phase 1 (T003) and Phase 4 (client assignment in UI)
- **Phase 8 (US6 - DNC Mapping)**: No story dependencies. Can run anytime after Phase 1
- **Phase 9 (Polish)**: Depends on all stories complete

### User Story Dependencies

```
Phase 1 (Setup) ──> Phase 2 (Foundational) ──┬──> US1 (Edit/BDRs) ──> MVP!
                                              ├──> US2 (Clients) ──┬──> US5 (External Linking)
                                              ├──> US3 (Delete)    │
                                              ├──> US4 (Quality)   │
                                              └──> US6 (DNC)       │
                                                                   └──> Phase 9 (Polish)
```

### Parallel Opportunities

**Phase 1**: T001 and T002 can run in parallel (same file, different sections)
**Phase 2**: T004-T008 can all run in parallel (different files)
**Phase 3-8**: US1 through US4 and US6 can start in parallel after Phase 2
**US5**: Must wait for US2 client UI to be in place
**Within US5**: T031 and T032 can run in parallel (different API clients)

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (T001-T003)
2. Complete Phase 2: Foundational (T004-T008)
3. Complete Phase 3: US1 - Edit Campaign and Assign BDRs (T009-T018)
4. **STOP and VALIDATE**: Create campaign, edit, assign BDRs, activate - no 400 error
5. Deploy if ready

### Incremental Delivery

1. Setup + Foundational → Foundation ready
2. US1 (Edit/BDRs) → Campaigns can be activated (MVP!)
3. US2 (Clients) → Campaigns organized by client
4. US3 (Delete) → Cleanup unwanted campaigns
5. US4 (Quality Stats) → See contact reachability breakdown
6. US5 (External Linking) → Select Instantly/HeyReach campaigns from dropdown
7. US6 (DNC Mapping) → Improved import accuracy
8. Polish (T037-T040) → Audit logging, edge case badges, deploy everything
