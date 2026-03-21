# Tasks: Visual Workflow Builder

**Input**: Design documents from `/specs/7-workflow-builder/`
**Prerequisites**: plan.md, spec.md, data-model.md, contracts/ (workflow-crud.md, workflow-execution.md, workflow-analytics.md), research.md, quickstart.md

**Organization**: Tasks grouped by user story. P1 stories (US6, US5, US1) form the MVP. P2 (US2, US3) and P3 (US4) are incremental additions.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story (US1-US6)
- Exact file paths included

---

## Phase 1: Setup

**Purpose**: Install dependencies, create database schema, run migration

- [x] T001 Install @xyflow/react dependency in admin-dashboard/package.json
- [x] T002 Add workflow enums and models to prisma/schema.prisma per data-model.md (WorkflowTriggerType, WorkflowVersionStatus, WorkflowExecutionStatus, WorkflowNodeType enums; WorkflowTemplate, WorkflowVersion, WorkflowExecution models with all indexes)
- [x] T003 Generate and run Prisma migration for workflow tables

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared types, validator, and queue infrastructure that ALL user stories depend on

- [x] T004 Create workflow TypeScript types in src/services/workflow/types.ts (WorkflowGraph, WorkflowNode, WorkflowEdge, all 8 NodeConfig interfaces, EdgeCondition, NodeHistoryEntry per data-model.md)
- [x] T005 [P] Create workflow graph validator in src/services/workflow/workflowValidator.ts (cycle detection via Kahn's algorithm, disconnected node check, single trigger validation, completeness validation, trigger conflict check — returns `{ valid, errors[], warnings[] }` per workflow-crud.md POST /:workflowId/validate contract)
- [x] T006 [P] Extend BullMQ queue setup in src/services/queue/queues.ts — add `workflow` queue and repeatable job for expiry scanning (every 5 minutes, per research.md decision R-006)

**Checkpoint**: Foundation ready — user story implementation can begin

---

## Phase 3: User Story 6 — Backend API for Workflow CRUD and Execution (Priority: P1) MVP

**Goal**: Backend REST API + execution engine that both frontend and Slack bot consume. This is the foundation layer — nothing else works without it.

**Independent Test**: Call API endpoints via curl to create a workflow, add nodes, publish, start an execution, advance through nodes, and query analytics.

### Implementation

- [x] T007 [US6] Create workflow CRUD service in src/services/workflow/workflowService.ts — implements: createWorkflow, getWorkflow, listWorkflows, updateDraftVersion, updateWorkflowName, validateWorkflow (delegates to validator), publishVersion (atomic: draft→PUBLISHED, old published→ARCHIVED, set isActive), cloneWorkflow, archiveWorkflow, createDraftFromPublished, deleteWorkflow (reject if active executions), getVersion. All operations scoped by slackTeamId. Uses Prisma transactions for publish. Calls logAudit() for all mutations.
- [x] T008 [US6] Create workflow execution engine in src/services/workflow/workflowEngine.ts — implements: startExecution (find active workflow for trigger type, create execution record, resolve first node), advanceExecution (record node history, traverse edges, resolve next node via edge conditions), resumeWithInput (update context with user input, reset expiresAt to now + 1 hour, advance to next node), findActiveExecution (by channel + threadTs), cancelExecution, expireStaleExecutions (query WAITING_INPUT/WAITING_DELAY where expiresAt < now). Auto-advance logic: process TRIGGER/MESSAGE/CONDITION/ACTION nodes synchronously, pause at BUTTON_CHOICE/FORM_MODAL (set WAITING_INPUT) and DELAY (set WAITING_DELAY, schedule BullMQ delayed job). Version-pinned: execution FK to versionId.
- [x] T009 [P] [US6] Create default workflow templates in src/services/workflow/workflowTemplates.ts — define 3 templates per spec FR-021: companyEnrichment (trigger→list type buttons→enrichment type buttons→purpose selection→job creation), contactEnrichment (trigger→list type→purpose→filter config modal→job creation), combinedEnrichment (trigger→list type→condition branch→company or contact sub-flows→job creation). Each template returns `{ id, name, description, nodeCount, graph: WorkflowGraph }`.
- [x] T010 [US6] Create admin workflow routes in src/routes/admin/workflows.ts — implements all endpoints per workflow-crud.md contract: GET / (list workflows with current version + stats), POST / (create, optional from_template), GET /:workflowId, GET /:workflowId/versions/:versionId, PUT /:workflowId/versions/:versionId (update draft graph), PUT /:workflowId/name, POST /:workflowId/validate, POST /:workflowId/publish, POST /:workflowId/clone, POST /:workflowId/archive, POST /:workflowId/edit (create draft from published), DELETE /:workflowId, GET /templates. Plus execution endpoints per workflow-execution.md: GET /:workflowId/executions, GET /executions/:executionId, POST /executions/:executionId/cancel. All use existing adminAuth middleware, require teamId query param.
- [x] T011 [US6] Register workflow routes in src/routes/admin/index.ts — mount `/api/v1/admin/workflows` with adminAuth middleware

**Checkpoint**: Backend API fully functional. Can create, edit, publish, and execute workflows via curl.

---

## Phase 4: User Story 5 — Runtime Workflow Execution in Slack (Priority: P1) MVP

**Goal**: Slack bot integrates with the workflow engine to drive interactive enrichment flows. File upload triggers workflow execution; button clicks advance the flow.

**Independent Test**: Publish a template workflow, upload a CSV in Slack, click through each step, verify enrichment job is created.

**Dependencies**: Requires Phase 3 (US6) backend API + engine

### Implementation

- [x] T012 [US5] Create Slack Block Kit renderer in src/services/workflow/workflowSlackRenderer.ts — converts each node type's config to Slack Block Kit message payloads: TRIGGER (no render, entry point), MESSAGE (section blocks with mrkdwn), BUTTON_CHOICE (section + actions block with buttons, action_id format `wf:{executionId}:{nodeId}:{buttonId}`), FORM_MODAL (modal view with input blocks, callback_id format `wf-form:{executionId}:{nodeId}`), ENRICHMENT (status message "Starting enrichment..."), CONDITION (no render, auto-advance), ACTION (status message), DELAY (status message "Processing, please wait..."). Supports `{{variable}}` interpolation from execution context.
- [x] T013 [US5] Create Slack workflow action handler in src/listeners/actions/workflowAction.ts — register action listener matching regex `/^wf:/` for button clicks: parse `wf:{executionId}:{nodeId}:{buttonId}` from action_id, call workflowEngine.resumeWithInput(), render next node via workflowSlackRenderer, post/update Slack message. Register view_submission listener matching callback_id regex `/^wf-form:/` for modal submissions: parse `wf-form:{executionId}:{nodeId}`, extract form values, call resumeWithInput(). Handle errors with user-friendly Slack message + "Retry" button. Handle expired execution with "This workflow has expired" message.
- [x] T014 [US5] Integrate workflow engine into file upload handler in src/listeners/events/message.ts — before existing enrichment flow logic, call workflowEngine.startExecution({ triggerType: 'FILE_UPLOAD', slackTeamId, slackUserId, slackChannelId, slackThreadTs, initialContext: { fileId, fileName } }). If startExecution returns non-null, render first node via workflowSlackRenderer and post to Slack (new workflow path). If returns null, fall back to existing legacy flow (FR-045). Register workflow action handlers in the app setup.
- [x] T015 [US5] Create BullMQ workflow worker in src/services/queue/workers/workflowWorker.ts — processes: (1) delay completion jobs (resume execution after delay duration), (2) expiry scanning (repeatable every 5 min, calls workflowEngine.expireStaleExecutions, posts "expired" Slack message to affected users). Register worker in src/services/queue/queues.ts.

**Checkpoint**: Full Slack integration works end-to-end. File upload → workflow-driven interactive flow → enrichment job created.

---

## Phase 5: User Story 1 — Build Enrichment Workflow from Template (Priority: P1) MVP

**Goal**: Admin dashboard UI for loading a template onto the canvas, tweaking it, and publishing. First frontend phase.

**Independent Test**: Open builder, load a template, edit a button label, publish, upload file in Slack to verify customized flow renders.

**Dependencies**: Requires Phase 3 (US6) backend API

### Implementation

- [x] T016 [US1] Create frontend API client in admin-dashboard/src/services/workflows.ts — TanStack Query hooks + axios calls for all workflow-crud.md endpoints: useWorkflows (GET /), useWorkflow (GET /:id), useWorkflowVersion (GET /:id/versions/:vid), useCreateWorkflow (POST /), useUpdateDraftVersion (PUT /:id/versions/:vid), usePublishWorkflow (POST /:id/publish), useCloneWorkflow (POST /:id/clone), useArchiveWorkflow (POST /:id/archive), useCreateDraftFromPublished (POST /:id/edit), useDeleteWorkflow (DELETE /:id), useTemplates (GET /templates), useValidateWorkflow (POST /:id/validate). Plus execution hooks: useExecutions (GET /:id/executions), useExecution (GET /executions/:id).
- [x] T017 [P] [US1] Create custom React Flow node components in admin-dashboard/src/components/workflow/nodes/ — one component per node type: TriggerNode.tsx (shows trigger type icon + label), MessageNode.tsx (shows message text preview), ButtonChoiceNode.tsx (shows button labels with one output handle per button), FormModalNode.tsx (shows field count + modal title), EnrichmentNode.tsx (shows enrichment type badge), ConditionNode.tsx (shows condition field + multiple output handles), ActionNode.tsx (shows action type), DelayNode.tsx (shows duration). All nodes use Radix/shadcn styling, show selected state, have input/output Handle components from @xyflow/react.
- [x] T018 [P] [US1] Create conditional edge component in admin-dashboard/src/components/workflow/edges/ConditionalEdge.tsx — custom edge that renders edge label (button choice name, condition value) on the connection line, uses @xyflow/react BaseEdge + EdgeLabelRenderer
- [x] T019 [US1] Create WorkflowCanvas component in admin-dashboard/src/components/workflow/WorkflowCanvas.tsx — wraps ReactFlow with: custom node types registered, custom edge types registered, ReactFlow Provider, canvas controls (zoom, fit-to-screen via Controls component), MiniMap component, Background component (dots pattern). Accepts `graph: WorkflowGraph` prop, converts to ReactFlow nodes/edges format. Emits onChange when graph is modified. Handles node selection (sets selectedNodeId state for config panel).
- [x] T020 [US1] Create TemplateLibrary component in admin-dashboard/src/components/workflow/TemplateLibrary.tsx — Dialog/modal listing available templates from GET /templates API. Each template shows name, description, node count. On select: calls POST / with `from_template` param, navigates to builder with new workflow loaded on canvas.
- [x] T021 [US1] Create workflow builder page in admin-dashboard/src/pages/workflow-builder.tsx — route: `/workflows/:workflowId/edit`. Loads workflow version graph via API, renders WorkflowCanvas. Top bar: workflow name (editable), version status badge, "Save Draft" button (calls PUT /:id/versions/:vid), "Publish" button (calls POST /:id/publish with confirmation dialog). Shows TemplateLibrary dialog when creating new workflow. Handles unsaved changes warning.
- [x] T022 [US1] Add workflow routes to admin-dashboard/src/router.tsx — add routes: `/workflows` (list page, Phase 7), `/workflows/new` (template selection → create → redirect to builder), `/workflows/:workflowId/edit` (builder page), `/workflows/:workflowId/analytics` (analytics page, Phase 8). Add "Workflows" link to sidebar in admin-dashboard/src/components/layout/AppSidebar.tsx.

**Checkpoint**: Admins can load a template, see the visual flow, edit nodes, save drafts, and publish workflows from the dashboard.

---

## Phase 6: User Story 2 — Create Custom Workflow from Scratch (Priority: P2)

**Goal**: Full drag-and-drop builder experience: node palette, configuration panel, custom connections, validation, Slack preview.

**Independent Test**: Create a 3-node flow (Trigger → Message → Action) from scratch, save, publish, trigger from Slack.

**Dependencies**: Requires Phase 5 (US1) — extends existing canvas components

### Implementation

- [x] T023 [US2] Create NodePalette component in admin-dashboard/src/components/workflow/NodePalette.tsx — left sidebar listing all 8 node types with icons, grouped by category (Triggers, Interactions, Logic, Actions). Each item is draggable (HTML5 drag and drop or @xyflow's useDnD). On drop onto canvas: creates new node of that type at drop position with default config, opens NodeConfigPanel. Styled with shadcn/ui Card components.
- [x] T024 [US2] Create NodeConfigPanel component in admin-dashboard/src/components/workflow/NodeConfigPanel.tsx — right sidebar panel that opens when a node is selected on canvas. Renders node-type-specific configuration form using react-hook-form + zod validation: TriggerNode (trigger type select, pattern/command input), MessageNode (text textarea, ephemeral toggle), ButtonChoiceNode (dynamic button list: add/remove buttons, label/value/style inputs), FormModalNode (dynamic field list: add/remove fields, type/label/required/placeholder inputs), EnrichmentNode (enrichment type select, source variable, purpose select), ConditionNode (evaluation field input), ActionNode (action type select, params key-value editor), DelayNode (duration number input). Save button updates node config in graph state.
- [x] T025 [US2] Create SlackPreview component in admin-dashboard/src/components/workflow/SlackPreview.tsx — renders a Slack-like Block Kit preview for MESSAGE and BUTTON_CHOICE nodes. Shows how the node's config will appear in Slack: message text with mrkdwn formatting, button layout, modal preview. Uses a Slack-themed CSS styling (white background, Slack font approximation). Integrated into NodeConfigPanel as a "Preview" tab.
- [x] T026 [US2] Create WorkflowValidation component in admin-dashboard/src/components/workflow/WorkflowValidation.tsx — validation results panel. Calls POST /:workflowId/validate API. Displays errors (red, with clickable node references that select the node on canvas) and warnings (yellow). Shows validation status badge (valid/invalid) in the top bar. Highlights invalid nodes on canvas with red border via ReactFlow node styling.
- [x] T027 [US2] Add undo/redo and auto-layout to WorkflowCanvas — implement undo/redo stack for graph changes (node add/remove/move, edge add/remove, config changes) with Ctrl+Z / Ctrl+Shift+Z keyboard shortcuts. Add auto-layout button that arranges nodes in a top-down DAG layout using a simple layered algorithm (topological sort + layer assignment + x-positioning). Add fit-to-screen button.
- [x] T028 [US2] Integrate NodePalette and NodeConfigPanel into workflow-builder.tsx page — update layout to three-column: NodePalette (left, collapsible) | WorkflowCanvas (center) | NodeConfigPanel (right, shows on node selection). Add "Validate" button to top bar. Wire up drag-and-drop from palette to canvas.

**Checkpoint**: Admins can create fully custom workflows from an empty canvas using drag-and-drop.

---

## Phase 7: User Story 3 — Manage Workflow Lifecycle (Priority: P2)

**Goal**: Workflow list page with status, metrics, and lifecycle actions (clone, archive, edit, version management).

**Independent Test**: Create a workflow, publish it, edit it, verify new draft version is created while original stays active.

**Dependencies**: Requires Phase 5 (US1) frontend client + routes

### Implementation

- [x] T029 [US3] Create workflows list page in admin-dashboard/src/pages/workflows.tsx — route: `/workflows`. Data table (shadcn/ui Table) showing all workflows for the team: name, trigger type badge, status badge (Draft/Active/Archived), current version number, total runs, completion rate %, last modified date. Row actions dropdown: "Edit" (navigates to builder), "Clone" (calls clone API, navigates to new workflow builder), "Archive" (confirmation dialog, calls archive API), "Delete" (confirmation dialog, calls delete API). "New Workflow" button opens TemplateLibrary dialog or "Start from Scratch" option. Uses useWorkflows() hook with status filter tabs (All, Active, Draft, Archived).
- [x] T030 [US3] Add version management UI to workflow-builder.tsx — version history sidebar/dropdown showing all versions with number, status, published date. "Restore" action on archived versions (creates new draft from that version). Version comparison indicator: "You are editing draft v3, active version is v2". Publish confirmation shows "This will replace the currently active version (v2)".
- [x] T030b [US3] Implement "Save as Template" feature (FR-023) — backend: add POST /templates endpoint to src/routes/admin/workflows.ts that deep-copies a published workflow's graph into a custom template entry (stored alongside built-in templates in workflowTemplates.ts or a new DB table). Frontend: add "Save as Template" action to workflow-builder.tsx top bar (only visible for published workflows). Custom templates appear in TemplateLibrary alongside built-in ones, marked with `is_custom: true`.

**Checkpoint**: Full lifecycle management — admins can browse, create, clone, edit, version, archive, delete workflows, and save them as reusable templates.

---

## Phase 8: User Story 4 — Monitor Workflow Execution Analytics (Priority: P3)

**Goal**: Analytics dashboard showing execution metrics, funnel visualization, and per-node statistics.

**Independent Test**: Run a workflow 5+ times in Slack, view analytics page, confirm metrics match actual interactions.

**Dependencies**: Requires Phase 3 (US6) backend API, Phase 4 (US5) for execution data

### Implementation

- [x] T031 [US4] Add analytics endpoints to src/routes/admin/workflows.ts — implement 3 endpoints per workflow-analytics.md contract: GET /:workflowId/analytics (aggregate metrics: total runs, completed, failed, expired, cancelled, completion rate, avg/median duration, daily runs array for period), GET /:workflowId/analytics/funnel (step-by-step funnel: reached/completed/drop-off counts per node from nodeHistory JSONB), GET /:workflowId/analytics/nodes/:nodeId (per-node metrics: reached, completed, avg time, choice distribution for BUTTON_CHOICE nodes). All computed on-read from WorkflowExecution.nodeHistory using Prisma raw SQL with PostgreSQL JSONB operators. Support period filter (7d, 30d, 90d, all).
- [x] T032 [P] [US4] Create frontend analytics API hooks — add to admin-dashboard/src/services/workflows.ts: useWorkflowAnalytics(workflowId, period), useWorkflowFunnel(workflowId, versionId?, period), useNodeAnalytics(workflowId, nodeId, period).
- [x] T033 [US4] Create workflow analytics page in admin-dashboard/src/pages/workflow-analytics.tsx — route: `/workflows/:workflowId/analytics`. Summary cards (total runs, completion rate, avg duration, active executions). Daily runs chart (Recharts BarChart, stacked completed/failed). Funnel visualization (horizontal bar chart or stepped funnel showing drop-off at each node). Period selector (7d, 30d, 90d, all). Node detail panel: click a node in the funnel to see per-node metrics + choice distribution pie chart for BUTTON_CHOICE nodes. Execution list table below analytics (recent executions with status, user, duration, link to detail).

**Checkpoint**: Admins can monitor workflow performance with actionable metrics and funnel analysis.

---

## Phase 9: Polish & Cross-Cutting Concerns

**Purpose**: Error handling, edge cases, performance, and final validation

- [x] T034 Handle edge cases in workflowEngine.ts — expired execution button clicks (return friendly "expired" message per edge case spec), mid-flow version publish (in-progress executions stay on their pinned version), no matching workflow fallback (return null, legacy flow handles), concurrent execution prevention (one active execution per user per workflow)
- [x] T035 [P] Add audit logging for all workflow operations — verify logAudit() calls in workflowService.ts for create, update, publish, clone, archive, delete operations with full context (workflowId, versionId, userId, teamId)
- [x] T036 [P] Run quickstart.md test scenarios — manually verify all 6 scenarios: template load+publish, custom build, version management, Slack execution end-to-end, analytics verification, legacy fallback
- [x] T037 Performance validation — verify SC-009 (API < 500ms) and SC-010 (canvas renders 50 nodes without lag). Add JSONB indexes if analytics queries are slow.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies — start immediately
- **Phase 2 (Foundational)**: Depends on Phase 1 (Prisma schema must exist for types)
- **Phase 3 (US6 Backend API)**: Depends on Phase 2 (needs types + validator)
- **Phase 4 (US5 Slack Runtime)**: Depends on Phase 3 (needs engine + service)
- **Phase 5 (US1 Template UI)**: Depends on Phase 3 (needs API endpoints)
- **Phase 6 (US2 Custom Builder)**: Depends on Phase 5 (extends canvas components)
- **Phase 7 (US3 Lifecycle)**: Depends on Phase 5 (needs frontend client + routes)
- **Phase 8 (US4 Analytics)**: Depends on Phase 3 (needs backend) + Phase 4 (needs execution data)
- **Phase 9 (Polish)**: Depends on all prior phases

### User Story Dependencies

- **US6 (Backend API, P1)**: Foundation — no story dependencies, only Phase 2
- **US5 (Slack Runtime, P1)**: Depends on US6 (calls engine/service)
- **US1 (Template UI, P1)**: Depends on US6 (calls API endpoints), independent of US5
- **US2 (Custom Builder, P2)**: Depends on US1 (extends canvas components)
- **US3 (Lifecycle, P2)**: Depends on US1 (uses frontend client), independent of US2
- **US4 (Analytics, P3)**: Depends on US6 (API), benefits from US5 data but can develop against test data

### Parallel Opportunities per Phase

**Phase 2**: T005 (validator) and T006 (queue setup) can run in parallel
**Phase 3**: T009 (templates) can run in parallel with T007/T008
**Phase 5**: T017 (node components) and T018 (edge component) can run in parallel with each other
**Phase 8**: T032 (analytics hooks) can run in parallel with T031 (analytics endpoints)

---

## Implementation Strategy

### MVP First (Phases 1-5: US6 + US5 + US1)

1. Complete Phase 1: Setup (deps + schema + migration)
2. Complete Phase 2: Foundational (types, validator, queue)
3. Complete Phase 3: US6 Backend API (service, engine, templates, routes)
4. Complete Phase 4: US5 Slack Runtime (renderer, action handler, message.ts integration, worker)
5. Complete Phase 5: US1 Template Builder UI (API client, nodes, canvas, template library, builder page)
6. **STOP and VALIDATE**: Test end-to-end — load template in dashboard, publish, trigger from Slack, verify full flow

### Incremental Delivery

1. Phases 1-5 → MVP (template-based workflows work end-to-end)
2. Phase 6 → Custom builder (full drag-and-drop creation)
3. Phase 7 → Lifecycle management (list page, versioning, clone/archive)
4. Phase 8 → Analytics (metrics, funnel, node stats)
5. Phase 9 → Polish (edge cases, performance, audit)

### Total Task Count

| Phase | Tasks | Stories |
|-------|-------|---------|
| Phase 1: Setup | 3 | — |
| Phase 2: Foundational | 3 | — |
| Phase 3: US6 Backend API | 5 | US6 |
| Phase 4: US5 Slack Runtime | 4 | US5 |
| Phase 5: US1 Template UI | 7 | US1 |
| Phase 6: US2 Custom Builder | 6 | US2 |
| Phase 7: US3 Lifecycle | 3 | US3 |
| Phase 8: US4 Analytics | 3 | US4 |
| Phase 9: Polish | 4 | — |
| **Total** | **38** | |
