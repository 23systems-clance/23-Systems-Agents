# Tasks: Workflow Channel Scoping

**Input**: Design documents from `/specs/21-workflow-channel-scoping/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/api-contracts.md, quickstart.md

**Tests**: Not explicitly requested. Manual verification via deployed ECS service per quickstart.md.

**Organization**: Tasks grouped by user story. US1 and US5 are P1 (MVP). US2/US3 are P2. US4 is P3.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story (US1-US5)
- Exact file paths included

---

## Phase 1: Setup (Schema Changes)

**Purpose**: Database schema changes that all subsequent phases depend on

- [x] T001 Add `clientId` nullable FK field and `client` relation to WorkflowTemplate model in `prisma/schema.prisma` — add `@@index([clientId])` and `@@index([slackTeamId, triggerType, clientId])` indexes, add `channelMappings WorkflowChannelMapping[]` relation
- [x] T002 Add new `WorkflowChannelMapping` model to `prisma/schema.prisma` with fields: `id`, `templateId` (FK), `slackChannelId`, `slackTeamId`, `triggerType` (WorkflowTriggerType enum), `createdByUserId`, `createdAt` — with `@@unique([slackTeamId, slackChannelId, triggerType])`, `@@index([templateId])`, `@@index([slackTeamId, slackChannelId])`, `onDelete: Cascade` on template relation
- [x] T003 Add `workflows WorkflowTemplate[]` reverse relation to `ManagedClient` model in `prisma/schema.prisma`

**Checkpoint**: Schema ready. Push to GitHub triggers ECS deploy which runs `prisma db push` on startup. Existing workflows get `clientId = NULL` automatically (team-level fallbacks, zero behavior change).

---

## Phase 2: Foundational (Core Resolution Logic)

**Purpose**: The 3-tier workflow resolution engine — MUST be complete before any user story delivers value

**CRITICAL**: No user story work can begin until this phase is complete

- [x] T004 Implement `resolveWorkflowTemplate()` function in `src/services/workflow/workflowEngine.ts` — accepts `{ triggerType, slackTeamId, slackChannelId }`, returns matching WorkflowTemplate with latest PUBLISHED version or null. Implements 3-tier cascade: (1) lookup WorkflowChannelMapping by `(teamId, channelId, triggerType)` → get template, (2) lookup ChannelClientMapping by `(teamId, channelId)` → get clientId → find template by `(teamId, triggerType, clientId)`, (3) fallback find template by `(teamId, triggerType, clientId: null)`. Log resolved tier and templateId at info level. Store `resolvedTier` (1/2/3) in returned context for observability.
- [x] T005 Update `startExecution()` in `src/services/workflow/workflowEngine.ts` to call `resolveWorkflowTemplate()` instead of the existing inline `prisma.workflowTemplate.findFirst()` query. Pass `slackChannelId` from params. Merge `resolvedTier` into `initialContext` for execution record.

**Checkpoint**: Foundation ready. Existing workflows still work via tier-3 fallback. Upload a file → same workflow fires (regression verified).

---

## Phase 3: User Story 1 — Assign Workflow to Client (Priority: P1) MVP

**Goal**: Admins can assign a workflow to a client. Client-specific workflows run when files are uploaded in that client's channels.

**Independent Test**: Assign workflow to client via API → upload file in client's channel → correct workflow executes.

### Backend Service Layer

- [x] T006 [US1] Update `createWorkflow()` in `src/services/workflow/workflowService.ts` to accept optional `clientId` parameter and pass it to `prisma.workflowTemplate.create()`
- [x] T007 [US1] Update `listWorkflows()` in `src/services/workflow/workflowService.ts` to: (a) include `client: { select: { id: true, name: true } }` in query, (b) accept optional `clientId` filter param, (c) return `clientId` and `clientName` in mapped response
- [x] T008 [US1] Update `getWorkflow()` in `src/services/workflow/workflowService.ts` to include `client: { select: { id: true, name: true } }` and `channelMappings: true` in the Prisma query
- [x] T009 [US1] Update `publishVersion()` in `src/services/workflow/workflowService.ts` to: (a) scope conflict check by `clientId` (same triggerType AND same clientId, including both null), (b) when conflict found, auto-deactivate existing workflow (`isActive: false`) instead of throwing error, (c) return `deactivatedWorkflow: { id, name }` in response, (d) call `logAudit()` with action `workflow.auto_deactivated` for the deactivated workflow

### Backend API Routes

- [x] T010 [US1] Add `PUT /:workflowId/client` endpoint in `src/routes/admin/workflows.ts` — accepts `{ client_id }` body (null to remove), updates WorkflowTemplate.clientId, returns `{ workflow: { id, client_id, client_name } }`, calls `logAudit()` with `workflow.client_assigned` or `workflow.client_removed`
- [x] T011 [US1] Update `POST /` (create workflow) in `src/routes/admin/workflows.ts` to accept optional `client_id` in request body and pass to `createWorkflow()`
- [x] T012 [US1] Update `GET /` (list workflows) in `src/routes/admin/workflows.ts` to: (a) read `clientId` from query params, (b) pass to `listWorkflows()`, (c) include `client_id` and `client_name` in response transform
- [x] T013 [US1] Update `GET /:workflowId` (detail) in `src/routes/admin/workflows.ts` to include `client_id`, `client_name`, and `channel_mappings` (with resolved channel names) in response
- [x] T014 [US1] Update `POST /:workflowId/publish` in `src/routes/admin/workflows.ts` to include `deactivated_workflow` in response when a conflict was auto-deactivated

### Channel Mapping API Routes (needed by Scope Panel in Phase 4)

- [x] T015 [US1] Add `GET /:workflowId/channels` endpoint in `src/routes/admin/workflows.ts` — returns `{ mappings: [...] }` with resolved channel names via Slack API
- [x] T016 [US1] Add `POST /:workflowId/channels` endpoint in `src/routes/admin/workflows.ts` — accepts `{ slack_channel_id, slack_team_id, created_by_user_id }`, auto-sets `triggerType` from the workflow's trigger type, validates teamId match, returns 409 if channel already mapped for this trigger type, calls `logAudit()` with `workflow.channel_mapped`
- [x] T017 [US1] Add `DELETE /:workflowId/channels/:mappingId` endpoint in `src/routes/admin/workflows.ts` — deletes mapping, returns `{ deleted: true }`, calls `logAudit()` with `workflow.channel_unmapped`

**Checkpoint**: US1 backend + channel CRUD complete. `PUT /workflows/:id/client` assigns a client. `GET /workflows` returns `client_id/client_name`. Channel mapping CRUD works. Publishing auto-deactivates conflicts. Tier-1 and tier-2 resolution work end-to-end.

---

## Phase 4: User Story 5 — Scope Configuration in Builder (Priority: P1) MVP

**Goal**: Admins can configure client assignment and channel overrides in the workflow builder UI.

**Independent Test**: Open builder → scope panel → assign client → add channel overrides → save → verify persistence.

**Depends on**: Phase 3 (US1 backend APIs must exist)

### Frontend Types & Services

- [x] T018 [P] [US5] Extend `WorkflowListItem` and `WorkflowDetail` types in `admin-dashboard/src/types/api.ts` to include `client_id: string | null`, `client_name: string | null`, and `channel_mappings: Array<{ id, slack_channel_id, slack_team_id, trigger_type, channel_name }>`
- [x] T019 [P] [US5] Add API functions in `admin-dashboard/src/services/workflows.ts`: `updateWorkflowClient(workflowId, clientId)`, `fetchWorkflowChannels(workflowId)`, `addWorkflowChannel(workflowId, slackChannelId, slackTeamId)`, `removeWorkflowChannel(workflowId, mappingId)`

### Frontend Component

- [x] T020 [US5] Create `WorkflowScopePanel.tsx` component in `admin-dashboard/src/components/workflow/` — collapsible panel with: (a) client dropdown using `fetchManagedClients()` for options, showing current assignment or "Team Default", (b) channel overrides section listing current `channel_mappings` with remove buttons, (c) "Add Channel" button using existing `SlackChannelPicker` component pattern, (d) calls `updateWorkflowClient()` on client change, `addWorkflowChannel()`/`removeWorkflowChannel()` on channel add/remove, (e) uses React Query mutations with optimistic updates, (f) handles 409 conflict response on `addWorkflowChannel()` by showing inline error "This channel already has a workflow mapped for this trigger type"
- [x] T021 [US5] Integrate `WorkflowScopePanel` into `admin-dashboard/src/pages/workflow-builder.tsx` — render in right sidebar when no node is selected (alongside or replacing the empty state), pass `workflowId` and `teamId` as props

**Checkpoint**: US5 complete. Admins can assign clients and map channels directly in the builder. Changes persist via API.

---

## Phase 5: User Story 3 — Workflows in Client Detail Page (Priority: P2)

**Goal**: Client detail page shows all workflows assigned to that client.

**Independent Test**: Navigate to client detail → see associated workflows → click to navigate to builder.

**Depends on**: Phase 3 (US1 — workflows must have clientId)

### Backend

- [x] T022 [US3] Update `GET /clients/:id` handler in `src/routes/admin/clientManagement.ts` to query `prisma.workflowTemplate.findMany({ where: { clientId: id } })` with select for `id`, `name`, `triggerType`, `isActive`, `createdAt`, and latest published version. Add `workflows` array to response.

### Frontend

- [x] T023 [P] [US3] Update `ManagedClientDetail` type in `admin-dashboard/src/services/managed-clients.ts` (or `types/api.ts`) to include `workflows: Array<{ id, name, trigger_type, is_active, current_version, published_at, created_at }>`
- [x] T024 [US3] Add "Associated Workflows" card to client detail view in `admin-dashboard/src/pages/managed-clients.tsx` — render after existing sections (channels, campaigns), show table with columns: Name, Trigger Type (badge), Version, Status. Click row navigates to `/workflows/:id/edit`. Show empty state when no workflows. Use Workflow icon from lucide-react.

**Checkpoint**: US3 complete. Client detail shows workflows. Clicking navigates to builder.

---

## Phase 6: User Story 4 — Client Column & Filter on Workflow List (Priority: P3)

**Goal**: Workflow list page shows client name per workflow and supports filtering by client.

**Independent Test**: View workflow list → see client column → filter by client → only matching workflows shown.

**Depends on**: Phase 3 (US1 — backend returns client fields)

- [x] T025 [US4] Add "Client" column to workflow table in `admin-dashboard/src/pages/workflows.tsx` — display `client_name` as a Badge variant="outline" or "Team Default" as muted text for null
- [x] T026 [US4] Add client filter dropdown to `admin-dashboard/src/pages/workflows.tsx` — fetch client list via `fetchManagedClients()`, add a Select/Combobox above or alongside existing status filter tabs, pass selected `clientId` as query param to `fetchWorkflows()`

**Checkpoint**: US4 complete. All admin visibility features done.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Final verification and edge case handling

- [x] T027 Verify cascade delete behavior — schema verified: `onDelete: Cascade` on `WorkflowChannelMapping.template`
- [x] T028 Verify SetNull behavior — schema verified: `onDelete: SetNull` on `WorkflowTemplate.client`
- [x] T029 Verify tier fallthrough — code verified: `resolveWorkflowTemplate()` checks `isActive` + published version at each tier
- [ ] T030 Verify client remapping — requires runtime E2E test on deployed environment
- [x] T031 Verify no-tier-match fallback — code verified: `resolveWorkflowTemplate()` returns `null` → `startExecution()` returns `null` → legacy flow
- [ ] T032 Run full E2E verification per quickstart.md — requires deployed environment
- [ ] T033 Deploy admin dashboard frontend: `cd admin-dashboard && npm run build && aws s3 sync dist/ s3://slkadmin-developerlabs-ai/ --delete && aws cloudfront create-invalidation --distribution-id E30ZVBVU06GFUV --paths "/*"`

---

## Dependencies & Execution Order

### Phase Dependencies

```
Phase 1 (Schema)
  └── Phase 2 (Resolution Engine) ← BLOCKS ALL
        ├── Phase 3 (US1: Client Assignment + Channel CRUD) ← MVP backend
        │     ├── Phase 4 (US5: Scope Panel) ← MVP frontend
        │     ├── Phase 5 (US3: Client Detail Workflows)
        │     └── Phase 6 (US4: List Page Column/Filter)
        └── Phase 7 (Polish) ← after all stories
```

### User Story Dependencies

- **US1 (P1)**: Depends on Phase 2 only. No other story dependencies. **Start here.** Includes channel CRUD APIs (needed by US5 scope panel).
- **US5 (P1)**: Depends on US1 backend (Phase 3, including channel CRUD). Can start as soon as Phase 3 APIs are deployed.
- **US2 (P2)**: Backend channel CRUD APIs are delivered in Phase 3 (T015-T017). Frontend handled by US5's WorkflowScopePanel. No separate phase needed.
- **US3 (P2)**: Depends on US1 (needs clientId on workflows). Backend + frontend independent of other stories.
- **US4 (P3)**: Depends on US1 (needs client fields in list response). Pure frontend work.

### Parallel Opportunities

- **T001, T002, T003**: All schema changes in same file — run sequentially
- **T018, T019**: Frontend types and services can run in parallel (different files)
- **T023, T024**: US3 type update and card component are sequential (type needed first), but T023 can parallel with T022
- **T025, T026**: US4 column and filter are in same file — run sequentially
- **Phase 5 (US3) and Phase 6 (US4)**: Can run in parallel after Phase 3

---

## Implementation Strategy

### MVP First (US1 + US2 + US5)

1. Complete Phase 1: Schema changes (T001-T003)
2. Complete Phase 2: Resolution engine (T004-T005)
3. Complete Phase 3: US1 backend — client assignment + channel CRUD APIs (T006-T017)
4. **VALIDATE**: Existing workflows still work. Client assignment and channel mappings work via API.
5. Complete Phase 4: US5 frontend — scope panel in builder (T018-T021)
6. **VALIDATE**: Full MVP — admins can assign workflows to clients and map channels via builder.
7. Deploy and demo.

### Incremental Delivery

1. **Deploy 1 (MVP)**: Schema + Resolution + US1 + US2 (channel CRUD) + US5 → Client-scoped workflows and channel overrides work end-to-end
2. **Deploy 2**: US3 + US4 → Full admin visibility (client detail workflows + list page column/filter)
3. **Deploy 3**: Polish + E2E verification → Production-ready
