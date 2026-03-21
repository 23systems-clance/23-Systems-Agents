# Tasks: Vertical Pack Platform

**Input**: Design documents from `/specs/39-vertical-pack-platform/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: Not explicitly requested. Test tasks are omitted.

**Organization**: Tasks grouped by user story. US1 and US2 are both P1 and can run in parallel. US3 depends on US1+US2. US4 depends on US3. US5 depends on US4. US6 can start after US3.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story (US1–US6)
- Paths use existing project structure: `src/` (backend), `admin-dashboard/src/` (frontend)

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Create shared types and Prisma schema for all platform models in a single migration

- [x] T001 Create shared platform TypeScript types in `src/lib/platform/types.ts` defining interfaces for Agent, AgentVersion, McpServer, McpTool, Skill, VerticalPack, PackSubscription, SkillExecution, AgentInvocation, and all enum types matching data-model.md
- [x] T002 Add all new enums to `prisma/schema.prisma`: AgentStatus, McpServerStatus, McpAuthType, SkillStatus, SkillTriggerType, SkillDeliveryChannel, PackStatus, PackCategory, PackTier, SubscriptionStatus, SkillExecutionStatus per data-model.md
- [x] T003 Add all new models to `prisma/schema.prisma`: Agent, AgentVersion, McpServer, McpTool, McpByokCredential, Skill, VerticalPack, PackSkill, PackSubscription, PackCreditTransaction, SkillExecution, AgentInvocation per data-model.md
- [x] T004 Add daily spend limit fields to WorkspaceInstallation model in `prisma/schema.prisma`: dailySpendLimitUsd, dailySpendUsedUsd, dailySpendResetAt per data-model.md
- [x] T005 Generate and apply Prisma migration for all new platform models

**Checkpoint**: Schema ready, shared types available — foundational services can now be built

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**Warning**: No user story work can begin until this phase is complete

- [x] T006 Create BullMQ queue definition for `skill-execution` queue in `src/services/queue/queues.ts` (or equivalent queue config file) with job type definitions for skill execution jobs
- [x] T007 Create spend limiter service in `src/services/platform/spendLimiter.ts` implementing per-workspace daily spend limit check and increment — reads dailySpendLimitUsd/dailySpendUsedUsd from WorkspaceInstallation, returns allow/block decision (FR-025)
- [x] T008 Create BullMQ repeatable job for daily spend reset in `src/services/queue/workers/dailySpendReset.ts` — resets dailySpendUsedUsd to 0 for all workspaces at midnight UTC
- [x] T009 [P] Create admin dashboard route stubs for platform navigation in `admin-dashboard/src/App.tsx` (or router config): add sidebar items for Agent Registry, MCP Servers, Skills, Packs, Execution Logs under a "Platform" section

**Checkpoint**: Foundation ready — user story implementation can now begin

---

## Phase 3: User Story 1 — Admin Registers and Manages Agents (Priority: P1) MVP

**Goal**: Admins can create, test, version, and publish AI agents via the admin dashboard and API.

**Independent Test**: Create an agent in the admin UI, invoke it with sample input in sandbox mode, verify structured output. Publish it and confirm it's available for skill assignment.

### Implementation for User Story 1

- [x] T010 [US1] Create agent registry service in `src/services/platform/agentRegistry.ts` implementing: createAgent (with initial DRAFT AgentVersion), getAgent, listAgents, updateAgent (creates new version if PUBLISHED), deleteAgent. Map to Agent + AgentVersion Prisma models.
- [x] T011 [US1] Add agent versioning logic to `src/services/platform/agentRegistry.ts`: publishAgent (sets current version PUBLISHED, agent status PUBLISHED), deprecateAgent (sets status DEPRECATED, warns if active skills reference it), getVersionHistory. Ensure published versions are immutable (FR-002).
- [x] T012 [US1] Create agent invoker service in `src/services/platform/agentInvoker.ts` implementing: invokeAgent(agentVersionId, input) — loads AgentVersion, builds Anthropic message with system prompt + tools, enforces maxTokens cap (FR-005a), calls @anthropic-ai/sdk, returns structured output with token counts and cost. Use existing costCalculator.ts pattern.
- [x] T013 [US1] Add agent sandbox test mode to `src/services/platform/agentInvoker.ts`: testAgent(agentId, input, versionId?) — invokes agent without credit deduction, returns output + tokens + cost + duration for sandbox display (FR-003).
- [x] T014 [P] [US1] Create admin agent CRUD API routes in `src/routes/admin/agents.ts`: GET /api/admin/agents (list with status filter + pagination), POST /api/admin/agents (create), GET /api/admin/agents/:agentId (detail with versions), PUT /api/admin/agents/:agentId (update), POST /api/admin/agents/:agentId/test (sandbox test), POST /api/admin/agents/:agentId/publish, POST /api/admin/agents/:agentId/deprecate per contracts/agents-api.yaml.
- [x] T015 [US1] Register agent admin routes in `src/routes/admin/index.ts` and ensure admin auth middleware is applied
- [x] T016 [P] [US1] Create Agent Registry list page in `admin-dashboard/src/pages/AgentRegistry.tsx` — table showing name, status, model, current version, total invocations, avg cost. Filter by status. Create button links to AgentDetail.
- [x] T017 [P] [US1] Create Agent Detail page in `admin-dashboard/src/pages/AgentDetail.tsx` — form for name, slug, description, model selector, system prompt editor, max tokens, credit cost, input/output schema JSON editors, tool multi-select. Version history sidebar. Publish/deprecate buttons.
- [x] T018 [US1] Create Agent Sandbox test component in `admin-dashboard/src/components/platform/AgentSandbox.tsx` — JSON input editor, "Run Test" button, output display with token count, cost, and latency metrics. Embed in AgentDetail page.

**Checkpoint**: Agent Registry fully functional — admins can create, test, version, and publish agents

---

## Phase 4: User Story 2 — Admin Registers MCP Server Connections (Priority: P1)

**Goal**: Admins can register external services as MCP servers, define tools, monitor health, and enable BYOK.

**Independent Test**: Register Apollo API as an MCP server, add the people_search tool, run a health check, verify HEALTHY status. Set BYOK enabled and provide a workspace API key.

**Note**: This phase can run in parallel with Phase 3 (US1) as they share no file dependencies.

### Implementation for User Story 2

- [x] T019 [P] [US2] Create MCP server registry service in `src/services/platform/mcpServerRegistry.ts` implementing: createServer, getServer, listServers, updateServer, deleteServer. Handle credential encryption using existing pattern from ManagedClient API key storage.
- [x] T020 [US2] Add MCP tool management to `src/services/platform/mcpServerRegistry.ts`: addTool, updateTool, removeTool, listToolsForServer. Tools stored in McpTool model with server FK.
- [x] T021 [US2] Create MCP health check service in `src/services/platform/mcpServerRegistry.ts`: runHealthCheck(serverId) — makes a lightweight request to baseUrl, updates McpServer status to HEALTHY/ERROR with lastHealthCheck timestamp and lastHealthError. Support per-authType request construction.
- [x] T022 [US2] Create BullMQ repeatable job for periodic MCP health checks in `src/services/queue/workers/mcpHealthCheck.ts` — runs every 5 minutes, checks all registered MCP servers, updates statuses, triggers admin notification on ERROR transition (FR-008).
- [x] T023 [US2] Create BYOK credential management in `src/services/platform/mcpServerRegistry.ts`: setByokCredentials(serverId, slackTeamId, credentials) — encrypts and stores in McpByokCredential, validateByokCredentials — tests workspace key against server (FR-009). Invalid keys set isValid=false and notify admin.
- [x] T024 [P] [US2] Create admin MCP server CRUD API routes in `src/routes/admin/mcpServers.ts`: GET /api/admin/mcp-servers (list), POST /api/admin/mcp-servers (create), GET /api/admin/mcp-servers/:serverId (detail with tools), PUT /api/admin/mcp-servers/:serverId (update), POST /api/admin/mcp-servers/:serverId/health (trigger health check), GET /api/admin/mcp-servers/:serverId/tools (list tools), POST /api/admin/mcp-servers/:serverId/tools (add tool) per contracts/mcp-servers-api.yaml.
- [x] T025 [US2] Create client BYOK API route in `src/routes/client/mcpServers.ts`: PUT /api/client/mcp-servers/:serverId/byok — workspace admin sets their own API key for a BYOK-enabled server per contracts/mcp-servers-api.yaml.
- [x] T026 [US2] Register MCP server admin routes in `src/routes/admin/index.ts` and client BYOK routes in `src/routes/client/index.ts`
- [x] T027 [P] [US2] Create MCP Servers list page in `admin-dashboard/src/pages/McpServers.tsx` — table showing name, provider, status (color-coded), BYOK badge, tool count, last health check. Register button.
- [x] T028 [P] [US2] Create MCP Server Detail page in `admin-dashboard/src/pages/McpServerDetail.tsx` — form for name, slug, provider, baseUrl, auth type, credentials (masked), BYOK toggle, rate limit. Tools section with add/edit/remove. Health check button with status indicator.

**Checkpoint**: MCP Server Registry fully functional — admins can register servers, manage tools, monitor health, enable BYOK

---

## Phase 5: User Story 3 — Admin Creates and Publishes Skills (Priority: P2)

**Goal**: Admins compose skills from agents + MCP tools, define triggers and delivery, test end-to-end, and publish for pack inclusion.

**Independent Test**: Create a skill combining an agent with an MCP tool, trigger a test execution, verify the full pipeline trace (trigger → agent → tool → output delivery).

**Dependencies**: Requires US1 (agents) + US2 (MCP servers) to be complete.

### Implementation for User Story 3

- [x] T029 [US3] Create MCP tool runner service in `src/services/platform/mcpToolRunner.ts` implementing: invokeTool(toolId, input, slackTeamId?) — loads McpTool + McpServer, resolves credentials (BYOK if available, else platform), constructs HTTP request per authType, enforces server rate limit (FR-010), returns output. Handle errors gracefully with retry support.
- [x] T030 [US3] Create skill composer service in `src/services/platform/skillComposer.ts` implementing: createSkill (validates agent exists + is PUBLISHED, validates MCP tools exist, pins agentVersionId), getSkill, listSkills, updateSkill, publishSkill, deprecateSkill. Validate all referenced MCP tools are from registered servers at creation time (edge case 6).
- [x] T031 [US3] Add agent version check to `src/services/platform/skillComposer.ts`: checkAgentVersionUpgrade(skillId) — compares skill's pinned agentVersionId against latest PUBLISHED version of the agent, returns updateAvailable boolean (FR-011a).
- [x] T032 [US3] Create skill executor service in `src/services/platform/skillExecutor.ts` implementing the full execution pipeline: validate input → check spend limit (spendLimiter) → invoke agent (agentInvoker) → run MCP tool calls (mcpToolRunner) → format output → deliver to channels (MVP: Slack thread + webhook only; email/CRM/file deferred per FR-013) → log execution trace → publish chain event if configured (FR-012, FR-013, FR-021). Create SkillExecution + AgentInvocation records.
- [x] T033 [US3] Create skill execution BullMQ worker in `src/services/queue/workers/skillExecutionWorker.ts` — processes jobs from skill-execution queue, calls skillExecutor.execute(), handles retries per skill retryPolicy config (FR-024), updates SkillExecution status on completion/failure.
- [x] T034 [US3] Add skill chaining support to `src/services/platform/skillExecutor.ts`: on successful completion, if skill has chainEventName, enqueue downstream skills with triggerType=EVENT that match the event name as new BullMQ jobs (research.md section 8).
- [x] T071 [US3] Add scheduled skill trigger management to `src/services/platform/skillComposer.ts`: when a skill with triggerType=SCHEDULE is published, register a BullMQ repeatable job with the skill's schedule config (cron expression); when deprecated/deleted, remove the repeatable job. The repeatable job enqueues skill execution jobs on the `skill-execution` queue (FR-012).
- [x] T035 [P] [US3] Create admin skill CRUD API routes in `src/routes/admin/skills.ts`: GET /api/admin/skills (list with filters), POST /api/admin/skills (create), GET /api/admin/skills/:skillId (detail with stats), PUT /api/admin/skills/:skillId (update), POST /api/admin/skills/:skillId/test (sandbox test), POST /api/admin/skills/:skillId/publish, GET /api/admin/skills/:skillId/version-check per contracts/skills-api.yaml.
- [x] T036 [US3] Create client skill invocation API route in `src/routes/client/skills.ts`: POST /api/client/skills/:skillId/invoke — validates workspace has pack subscription containing this skill, runs spend limit check, enqueues skill execution job, returns 202 with executionId. Returns 402 if insufficient credits, 429 if spend limit reached.
- [x] T037 [US3] Register skill admin routes in `src/routes/admin/index.ts` and client skill routes in `src/routes/client/index.ts`
- [x] T038 [P] [US3] Create Skill Composer page in `admin-dashboard/src/pages/SkillComposer.tsx` — form for name, slug, description, agent selector (shows only PUBLISHED agents with version picker), MCP tool multi-select (grouped by server), trigger type selector with config, delivery channel multi-select, credit cost, retry policy config, chain event name.
- [x] T039 [P] [US3] Create Skill Detail page in `admin-dashboard/src/pages/SkillDetail.tsx` — skill configuration view, version upgrade notification banner (if agent has newer version), execution history table, publish/deprecate actions.
- [x] T040 [US3] Create Skill Test Runner component in `admin-dashboard/src/components/platform/SkillTestRunner.tsx` — JSON input editor, "Run Test" button, execution trace display showing each step (trigger → agent invocation → tool calls → output delivery) with timing and costs. Embed in SkillComposer page.

**Checkpoint**: Skills fully functional — admins can compose, test, and publish skills. Client workspaces can invoke skills via API (credit checking deferred to US4).

---

## Phase 6: User Story 4 — Admin Bundles Skills into Vertical Packs (Priority: P2)

**Goal**: Admins create vertical packs bundling skills with pricing and credit allocation. Workspaces subscribe to packs and get isolated credits.

**Independent Test**: Create a pack with 2 skills, publish it, subscribe a test workspace, invoke a skill, verify credits deducted from pack subscription.

**Dependencies**: Requires US3 (skills) to be complete.

### Implementation for User Story 4

- [x] T041 [US4] Create pack manager service in `src/services/platform/packManager.ts` implementing: createPack, getPack, listPacks, updatePack, publishPack, deprecatePack, assignSkills(packId, skillIds), removeSkills. Enforce that only PUBLISHED skills can be assigned (FR-016).
- [x] T042 [US4] Create pack subscription service in `src/services/platform/packManager.ts` (extend): subscribeToPack(packId, slackTeamId) — creates PackSubscription with creditsIncluded from pack definition, creates Stripe subscription if paid tier, handles lifecycle (upgrade, downgrade, cancel, renewal) (FR-020).
- [x] T043 [US4] Create credit gate service in `src/services/platform/creditGate.ts` implementing: checkCredits(skillId, slackTeamId) — finds all active PackSubscriptions for workspace that include this skill, selects the one with most remaining credits (FR-016a), returns packSubscriptionId + allow/deny. deductCredits(packSubscriptionId, amount, executionId) — creates PackCreditTransaction, increments creditsUsed. Handle overage (FR-019).
- [x] T044 [US4] Integrate credit gate into skill executor: update `src/services/platform/skillExecutor.ts` to call creditGate.checkCredits before execution and creditGate.deductCredits after successful completion (FR-014). Update client invoke route in `src/routes/client/skills.ts` to return 402 on insufficient credits.
- [x] T045 [P] [US4] Create admin pack CRUD API routes in `src/routes/admin/packs.ts`: GET /api/admin/packs (list), POST /api/admin/packs (create), GET /api/admin/packs/:packId (detail with skills + analytics), PUT /api/admin/packs/:packId (update), POST /api/admin/packs/:packId/publish, PUT /api/admin/packs/:packId/skills (assign skills) per contracts/packs-api.yaml.
- [x] T046 [US4] Create client pack catalog + subscription API routes in `src/routes/client/packs.ts`: GET /api/client/packs (browse catalog with isSubscribed flag), POST /api/client/packs/:packId/subscribe, GET /api/client/subscriptions (list active), POST /api/client/subscriptions/:subscriptionId/cancel per contracts/packs-api.yaml.
- [x] T047 [US4] Register pack admin routes in `src/routes/admin/index.ts` and client pack routes in `src/routes/client/index.ts`
- [x] T048 [P] [US4] Create Pack Manager page in `admin-dashboard/src/pages/PackManager.tsx` — table showing name, category, tier, status, skill count, subscriber count, MRR. Filter by category/status. Create button.
- [x] T049 [P] [US4] Create Pack Detail page in `admin-dashboard/src/pages/PackDetail.tsx` — form for name, slug, description, category, tier, monthly price, credits included, overage rate, Stripe price ID. Skill assignment panel with drag-to-reorder. Subscriber list. Publish/deprecate actions.
- [x] T050 [US4] Create Pack Catalog page in `admin-dashboard/src/pages/PackCatalog.tsx` — client-facing catalog showing published packs with name, description, skills included, pricing, "Subscribe" button. Show active subscriptions with credit usage bars.
- [x] T051 [US4] Create Credit Usage Chart component in `admin-dashboard/src/components/platform/CreditUsageChart.tsx` — visual bar/donut chart showing credits used vs included per pack subscription. Reuse in PackDetail (admin) and PackCatalog (client).

**Checkpoint**: Packs fully functional — admins can bundle skills into packs, workspaces can subscribe, credits are isolated per pack, multi-pack skill routing works.

---

## Phase 7: User Story 5 — Enrichment Pipeline Migrated to Pack #1 (Priority: P3)

**Goal**: Existing enrichment pipeline refactored to run through the platform's skill execution engine. Existing workspaces migrated seamlessly to the Enrichment Pack.

**Independent Test**: Run the same enrichment workflows (file upload, single contact lookup, tech report) through the new architecture and compare results with current implementation. Zero user-facing changes.

**Dependencies**: Requires US4 (packs) to be complete.

### Implementation for User Story 5

- [x] T052 [US5] Create data migration script in `prisma/migrations/` (or `src/scripts/migrateEnrichment.ts`): create Agent records for existing AI functions (intent classifier, document classifier, opportunity scorer, report analyzer) with system prompts extracted from current service files (FR-026).
- [x] T053 [US5] Extend migration script to create McpServer records for existing integrations: Apollo (contact/people search), BuiltWith (domain enrichment), Findymail (email verification), Wiza (email enrichment) with their current baseUrls, auth types, and tool definitions.
- [x] T054 [US5] Extend migration script to create Skill records composing the enrichment agents + MCP tools: file-enrichment skill, tech-stack-lookup skill, contact-enrichment skill, email-verification skill. Set triggers to match current invocation patterns.
- [x] T055 [US5] Extend migration script to create the Enrichment Pack (VerticalPack) bundling all enrichment skills with category=SALES, tier matching current subscription tiers.
- [x] T056 [US5] Create credit migration script in `src/scripts/migrateEnrichmentCredits.ts`: for each workspace with a BillingProfile, create a PackSubscription to the Enrichment Pack with creditsIncluded set to monthlyAllowance and creditsUsed calculated from current period usage (FR-027).
- [x] T057 [US5] Update enrichment dispatcher in `src/services/queue/workers/enrichmentDispatcher.ts` to optionally route through skill execution engine: add feature flag check — when enabled, enrichment jobs invoke the corresponding enrichment skill instead of calling services directly. Ensure identical output format.

**Checkpoint**: Enrichment pipeline runs through the platform. Existing workspaces migrated. BYOK workspaces use their own keys. No user-facing changes.

---

## Phase 8: User Story 6 — Skill Execution Logging and Analytics (Priority: P3)

**Goal**: Comprehensive execution logs and aggregate analytics for all skill executions across the platform.

**Independent Test**: Run several skill executions, verify logs capture full traces, verify aggregate metrics match individual execution records.

**Dependencies**: Execution log APIs (T058–T060) require US3 (skill execution creates the traces) and can start after US3. Pack analytics and workspace analytics within T058 require US4 (PackSubscription data). Execution trace UI (T061–T062) can start after US3. Platform analytics dashboard (T063) requires US4.

### Implementation for User Story 6

- [x] T058 [P] [US6] Create execution log and analytics API routes in `src/routes/admin/executions.ts`: GET /api/admin/executions (list with filters: skillId, slackTeamId, status, date range, pagination), GET /api/admin/executions/:executionId (full trace with agent invocations + tool calls), GET /api/admin/analytics/skills (aggregate per skill), GET /api/admin/analytics/packs (aggregate per pack), GET /api/admin/analytics/workspaces (aggregate per workspace) per contracts/executions-api.yaml.
- [x] T059 [US6] Create client usage API routes in `src/routes/client/usage.ts`: GET /api/client/usage (workspace usage dashboard: subscriptions, daily spend, recent executions), GET /api/client/executions (workspace execution history with pagination) per contracts/executions-api.yaml.
- [x] T060 [US6] Register execution/analytics admin routes in `src/routes/admin/index.ts` and client usage routes in `src/routes/client/index.ts`
- [x] T061 [P] [US6] Create Execution Logs page in `admin-dashboard/src/pages/ExecutionLogs.tsx` — filterable table showing skill name, workspace, status (color-coded), trigger type, credits cost, duration, timestamp. Click row to expand full trace.
- [x] T062 [P] [US6] Create Execution Trace viewer component in `admin-dashboard/src/components/platform/ExecutionTrace.tsx` — timeline view showing: trigger source → agent invocation(s) with tokens/cost → MCP tool calls with request/response → output delivery → credit deduction. Error highlighting for failed steps.
- [x] T063 [US6] Add analytics dashboard section to existing admin overview or create new page in `admin-dashboard/src/pages/PlatformAnalytics.tsx` — charts for: executions over time (per skill), success rate trends, credit consumption by pack, top skills by usage, workspace spending, daily cost trends.

**Checkpoint**: Full observability — admins see every execution trace, aggregate analytics per skill/pack/workspace. Workspaces see their own usage and credits.

---

## Phase 9: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

- [x] T064 Validate all admin routes have proper admin authentication middleware applied in `src/routes/admin/index.ts`
- [x] T065 Validate all client routes have proper workspace authentication (session-based) applied in `src/routes/client/index.ts`
- [x] T066 [P] Add input validation (Zod schemas or equivalent) for all platform API request bodies across agent, MCP server, skill, and pack routes
- [x] T067 [P] Add comprehensive error handling and structured error responses to all platform API routes following existing project error patterns in `src/services/admin/errorLogger.ts`
- [x] T068 Review and validate credential encryption for MCP server credentials and BYOK credentials — ensure at-rest encryption per FR-007
- [x] T069 Run quickstart.md smoke test checklist against deployed environment to verify all 14 verification items pass
- [x] T070 Build and deploy admin dashboard frontend: `cd admin-dashboard && npm run build`, sync to S3, invalidate CloudFront
- [x] T072 Add audit logging middleware for all admin platform routes in `src/routes/admin/index.ts`: log who created/edited/deleted each platform entity (agent, MCP server, skill, pack) with before/after values to an AuditLog or structured log entry per Constitution Principle V
- [x] T073 [P] Validate WCAG 2.1 AA accessibility for all new platform dashboard pages: keyboard navigation, ARIA labels, color contrast, focus management per Constitution Principle XIV

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately
- **Foundational (Phase 2)**: Depends on Phase 1 (Prisma migration applied)
- **US1 Agent Registry (Phase 3)**: Depends on Phase 2 — can start immediately after
- **US2 MCP Server Registry (Phase 4)**: Depends on Phase 2 — can run **in parallel** with Phase 3
- **US3 Skills (Phase 5)**: Depends on Phase 3 (US1) AND Phase 4 (US2) — both must complete
- **US4 Vertical Packs (Phase 6)**: Depends on Phase 5 (US3)
- **US5 Enrichment Migration (Phase 7)**: Depends on Phase 6 (US4)
- **US6 Execution Logging (Phase 8)**: Execution log routes + trace UI depend on Phase 5 (US3); pack/workspace analytics depend on Phase 6 (US4). Can start partially after US3, fully after US4.
- **Polish (Phase 9)**: Depends on all desired user stories being complete

### User Story Dependencies

```text
Phase 1 → Phase 2 → ┬─ US1 (Phase 3) ─┬─ US3 (Phase 5) → US4 (Phase 6) → US5 (Phase 7)
                     │                  │
                     └─ US2 (Phase 4) ──┘
                                        └─ US6 (Phase 8) [parallel with US4/US5]
```

- **US1 (P1)**: No story dependencies — starts after Foundational
- **US2 (P1)**: No story dependencies — starts after Foundational, parallel with US1
- **US3 (P2)**: Depends on US1 + US2 (needs published agents + registered MCP servers)
- **US4 (P2)**: Depends on US3 (needs published skills to bundle into packs)
- **US5 (P3)**: Depends on US4 (needs pack infrastructure for migration)
- **US6 (P3)**: Execution logs depend on US3 (needs execution traces); pack/workspace analytics depend on US4 (needs PackSubscription data)

### Within Each User Story

- Services before routes
- Routes before frontend pages
- Core functionality before integration features

### Parallel Opportunities

- **Phase 1**: T002, T003, T004 can run in parallel (different schema sections)
- **Phase 2**: T007, T008, T009 can run in parallel (different files)
- **Phase 3 + Phase 4**: US1 and US2 can run entirely in parallel (no shared files)
- **Within US1**: T014 (routes) parallel with T016, T017 (frontend pages)
- **Within US2**: T024 (routes) parallel with T027, T028 (frontend pages)
- **Within US3**: T035 (routes) parallel with T038, T039 (frontend pages)
- **Within US4**: T045 (routes) parallel with T048, T049 (frontend pages)
- **Phase 8**: Can run in parallel with Phases 6–7

---

## Implementation Strategy

### MVP First (User Stories 1 + 2 Only)

1. Complete Phase 1: Setup (T001–T005)
2. Complete Phase 2: Foundational (T006–T009)
3. Complete Phase 3: US1 Agent Registry (T010–T018)
4. Complete Phase 4: US2 MCP Server Registry (T019–T028) — parallel with Phase 3
5. **STOP and VALIDATE**: Verify agents can be created/tested/published and MCP servers can be registered/health-checked
6. Deploy and demo

### Full Platform (All User Stories)

1. Setup + Foundational → Foundation ready
2. US1 + US2 in parallel → Primitives ready → Deploy/Demo
3. US3 Skills → Skills composable and executable → Deploy/Demo
4. US4 Packs + US6 Analytics in parallel → Commercial platform ready → Deploy/Demo
5. US5 Migration → Enrichment on platform → Deploy/Demo
6. Polish → Production hardened → Final deploy

### Task Counts

| Phase | Story | Tasks | Parallel Tasks |
|-------|-------|-------|----------------|
| Phase 1 | Setup | 5 | 3 |
| Phase 2 | Foundational | 4 | 2 |
| Phase 3 | US1 - Agent Registry | 9 | 3 |
| Phase 4 | US2 - MCP Server Registry | 10 | 3 |
| Phase 5 | US3 - Skills | 13 | 3 |
| Phase 6 | US4 - Vertical Packs | 11 | 3 |
| Phase 7 | US5 - Enrichment Migration | 6 | 0 |
| Phase 8 | US6 - Execution Logging | 6 | 3 |
| Phase 9 | Polish | 9 | 3 |
| **Total** | | **73** | **24** |
