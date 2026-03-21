# Tasks: Slack Agent Integration

**Input**: Design documents from `/specs/5-slack-agent-integration/`
**Prerequisites**: plan.md (required), spec.md (required), research.md, data-model.md, contracts/

**Tests**: Not explicitly requested — test tasks omitted. Validation via deployed ECS (AWS-only deployment model).

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization, directory structure, dependencies, and configuration for agent integration.

- [X] T001 Create directory structure: `src/services/agent/`, `src/services/workspace/`, `src/services/metering/`, `src/services/retention/`, `src/routes/oauth/`
- [X] T002 [P] Add new environment variables to config in `src/config/index.ts`: SLACK_CLIENT_ID, SLACK_CLIENT_SECRET, SLACK_STATE_SECRET, OAUTH_REDIRECT_URI, TOKEN_ENCRYPTION_KEY
- [X] T003 [P] Update `infra/cloudformation.yaml` to add ALL new environment variables and secrets for agent integration: SLACK_CLIENT_ID, SLACK_CLIENT_SECRET, SLACK_STATE_SECRET, TOKEN_ENCRYPTION_KEY, OAUTH_REDIRECT_URI to ECS task definition and parameter store. Follow feature 4 Secrets Manager pattern (valueFrom references) for secret values. Include any security group changes needed for OAuth HTTPS endpoints.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core data models, migrations, token encryption, authorize function, and context store that ALL user stories depend on.

**CRITICAL**: No user story work can begin until this phase is complete.

- [X] T004 Add new Prisma enums (WorkspaceStatus, AgentThreadStatus, ConversationRole, JobSourceInterface) and models (WorkspaceInstallation, AgentThread, ConversationTurn, AgentThreadAudit, AgentThreadJob) to `prisma/schema.prisma` per data-model.md
- [X] T005 Add `sourceInterface` field (JobSourceInterface enum, default TRIGGER) to existing Job model in `prisma/schema.prisma`
- [X] T006 [P] Add `slackTeamId` field (String, indexed) to existing ApiUsageLog model in `prisma/schema.prisma`
- [X] T007 Generate and apply Prisma migration for all schema changes
- [X] T008 [P] Implement AES-256-GCM token encryption utility (encrypt/decrypt functions) in `src/lib/tokenEncryption.ts`
- [X] T009 Implement Prisma-backed InstallationStore (storeInstallation, fetchInstallation, deleteInstallation) with encrypted bot tokens in `src/services/workspace/installationStore.ts` per oauth-install.md contract
- [X] T010 Implement custom authorize function (Redis cache with 1-hour TTL → DB fallback) in `src/services/workspace/authorize.ts` per oauth-install.md contract
- [X] T011 [P] Implement Redis-backed ThreadContextStore (get/set agent thread state with 24-hour TTL) in `src/services/agent/contextStore.ts` per research.md R4 AgentThreadState interface
- [X] T012 [P] Implement Slack admin/owner role checking utility (users.info API → is_admin/is_owner) in `src/lib/agentAuth.ts`
- [X] T013 Create seed script to insert current workspace as WorkspaceInstallation record for backward compatibility in `src/scripts/seedWorkspace.ts`
- [X] T014 Backfill existing ApiUsageLog records with slackTeamId from associated Job records (migration script or Prisma seed)

**Checkpoint**: Foundation ready — all data models, auth, encryption, and context store operational. User story implementation can now begin.

---

## Phase 3: User Story 1 — Conversational Enrichment via Agent Side-Panel (Priority: P1) MVP

**Goal**: Users open the AI agent side-panel, type natural language enrichment requests, and the agent classifies intent, asks clarifying questions, accepts file uploads, and initiates enrichment jobs.

**Independent Test**: Open agent panel → type enrichment request → verify intent classification → upload file → confirm job submission with progress reporting.

### Implementation for User Story 1

- [X] T015 [US1] Implement agent intent classification tool (classify_agent_intent with 13 intents, confidence scoring, extracted params) in `src/services/ai/agentOrchestrator.ts` per agent-intents.md contract
- [X] T016 [P] [US1] Implement intent router (map classified intents to action handlers: enrichment flows, job management, conversation management) in `src/services/agent/intentRouter.ts` per agent-intents.md IntentRouteMap
- [X] T017 [US1] Implement conversation manager (persist turns to DB + Redis, assemble context for classification calls, load last N turns) in `src/services/agent/conversationManager.ts` per research.md R4
- [X] T018 [US1] Register Assistant class with `threadStarted` handler (greeting message + up to 4 suggested prompts) and `userMessage` handler (classify → route → respond) in `src/services/agent/assistant.ts`
- [X] T019 [US1] Implement file upload handling in agent thread — detect file_shared in userMessage, route to existing file validation/parsing pipeline in `src/services/agent/assistant.ts`
- [X] T020 [US1] Implement confidence-based clarification flow: >=0.85 execute, 0.50-0.84 present top interpretations, <0.50 ask open-ended question in `src/services/agent/intentRouter.ts`
- [X] T021 [US1] Implement enrichment flow initiation via agent (startEnrichmentFlow: validate params → submit BullMQ job → create AgentThreadJob link → confirm to user) in `src/services/agent/intentRouter.ts`
- [X] T022 [US1] Set `sourceInterface: 'AGENT'` on jobs created through agent flows in `src/services/agent/intentRouter.ts`
- [X] T023 [US1] Wire Assistant registration into `src/app.ts` — call `app.assistant()` with handlers and custom authorize function

**Checkpoint**: User Story 1 complete — users can conversationally initiate enrichment jobs through the agent side-panel.

---

## Phase 4: User Story 2 — Real-Time Streaming & Task Visualization (Priority: P1)

**Goal**: Agent provides progressive text streaming for LLM responses and visual task cards showing enrichment pipeline progress in real-time.

**Independent Test**: Initiate enrichment via agent → verify streaming text appears progressively → verify task cards show each pipeline step with live status updates.

### Implementation for User Story 2

- [X] T024 [US2] Implement streaming helper (startStream/appendStream/stopStream lifecycle with 100ms/500char flush batching) in `src/services/agent/streamingHelper.ts` per streaming-protocol.md
- [X] T025 [P] [US2] Implement task visualizer (pipeline task card definitions for all enrichment types, plan_update/task_update chunk generation) in `src/services/agent/taskVisualizer.ts` per streaming-protocol.md ENRICHMENT_PIPELINE_TASKS
- [X] T026 [US2] Implement Redis pub/sub bridge — agent subscribes to `agent:progress:{jobId}` channel when job starts, maps AgentProgressEvent to task card updates in `src/services/agent/taskVisualizer.ts`
- [X] T027 [US2] Update enrichment workers (enrichmentDispatcher, fileGeneration) to publish progress events to Redis pub/sub channel `agent:progress:{jobId}` with stage/status/detail in `src/services/queue/workers/enrichmentDispatcher.ts` and `src/services/queue/workers/fileGeneration.ts`
- [X] T028 [US2] Integrate streaming helper into agent LLM responses (intent classification narrative, help text) in `src/services/agent/assistant.ts`
- [X] T029 [US2] Integrate task visualizer into enrichment job flow — startStream with plan on job submit, appendStream on progress, stopStream with summary on complete in `src/services/agent/intentRouter.ts`

**Checkpoint**: User Story 2 complete — streaming text and real-time task cards operational during enrichment jobs.

---

## Phase 5: User Story 3 — Multi-Turn Conversation with Memory (Priority: P1)

**Goal**: Agent maintains conversation context across multiple messages, resolves references to previous actions, and can assemble accumulated parameters from multi-message exchanges.

**Independent Test**: Send 5+ messages in a thread building up enrichment params → say "go ahead" → verify all params correctly assembled and job starts. Ask "filter those results" → verify correct job reference.

### Implementation for User Story 3

- [X] T030 [US3] Extend conversation manager with accumulated parameter tracking (enrichmentParams object built across turns) in `src/services/agent/conversationManager.ts`
- [X] T031 [US3] Implement context reference resolution — "those results", "that job", "the last enrichment" maps to most recent job in thread's jobIds in `src/services/agent/conversationManager.ts`
- [X] T032 [US3] Implement `confirmation` intent handler — assemble all accumulated params from thread state and execute the pending action in `src/services/agent/intentRouter.ts`
- [X] T033 [US3] Implement `clarification` intent handler — update accumulated params with newly provided info, check if all required params present in `src/services/agent/intentRouter.ts`
- [X] T034 [US3] Implement context window management — truncate oldest turns when exceeding 20 turns or 4000 tokens, preserve enrichmentParams and jobIds in `src/services/agent/conversationManager.ts`
- [X] T035 [US3] Implement `filter_results` intent handler — parse filterExpression param, invoke existing filterParser service, apply to most recent job results, return filtered output in `src/services/agent/intentRouter.ts`

**Checkpoint**: User Story 3 complete — multi-turn conversations work with memory, reference resolution, and result filtering.

---

## Phase 6: User Story 4 — Channel Context Awareness (Priority: P2)

**Goal**: Agent knows which channel the user is viewing and tailors suggested prompts and enables channel-scoped queries.

**Independent Test**: Open agent from different channels → verify suggested prompts change. Ask "jobs in this channel" → verify correct results.

### Implementation for User Story 4

- [X] T036 [US4] Implement `threadContextChanged` handler — receive channel context updates (channelId, channelName), persist to AgentThread and Redis state in `src/services/agent/assistant.ts`
- [X] T037 [US4] Implement channel-aware suggested prompts logic — generate dynamic prompts based on viewingChannelId/Name (e.g., "Find contacts for companies discussed in #sales") in `src/services/agent/assistant.ts`
- [X] T038 [US4] Implement channel-scoped job queries — filter job history by originating channel when user asks "jobs in this channel" in `src/services/agent/intentRouter.ts`

**Checkpoint**: User Story 4 complete — agent is context-aware of the user's current channel.

---

## Phase 7: User Story 5 — Job Status & History via Agent (Priority: P2)

**Goal**: Users ask the agent about running jobs, cancel jobs, view history, and download results via natural language.

**Independent Test**: Ask "what's running?" → verify active jobs listed. Ask "stop job X" → verify cancellation. Ask "my last 5 enrichments" → verify history table. Ask "download results" → verify file shared.

### Implementation for User Story 5

- [X] T039 [P] [US5] Implement `job_status` intent handler — query active jobs for user/workspace, format as summary with job ID, type, progress %, ETA in `src/services/agent/intentRouter.ts`
- [X] T040 [P] [US5] Implement `job_cancel` intent handler — validate job ownership, check cancellable state, cancel BullMQ job, confirm to user in `src/services/agent/intentRouter.ts`
- [X] T041 [P] [US5] Implement `job_history` intent handler — query recent jobs with type, status, row counts, completion time, format as summary table in `src/services/agent/intentRouter.ts`
- [X] T042 [US5] Implement `job_download` intent handler — retrieve output file from S3, share in agent thread via files.uploadV2 in `src/services/agent/intentRouter.ts`

**Checkpoint**: User Story 5 complete — full job management through conversational interface.

---

## Phase 8: User Story 6 — Tech Reports via Agent (Priority: P2)

**Goal**: Users request technology reports conversationally, with support for follow-up comparisons and cached report detection.

**Independent Test**: Ask "generate a Salesforce report" → verify report job starts and narrative streams. Ask "what about HubSpot?" → verify follow-up generates without re-specifying source.

### Implementation for User Story 6

- [X] T043 [US6] Implement `tech_report` intent handler — extract technology param, initiate tech report job via existing pipeline, stream narrative response in `src/services/agent/intentRouter.ts`
- [X] T044 [US6] Implement follow-up report support — detect "what about X?" pattern after a tech report, reuse source data reference from thread context in `src/services/agent/intentRouter.ts`
- [X] T045 [US6] Implement cached report detection — check if recent report exists for requested technology, prompt user to use cached or regenerate in `src/services/agent/intentRouter.ts`

**Checkpoint**: User Story 6 complete — tech reports accessible through conversational interface with follow-up support.

---

## Phase 9: User Story 7 — Per-Workspace Usage Metering & Billing (Priority: P3)

**Goal**: Track API usage per workspace, enforce configurable dollar-amount caps with optional per-service guardrails, and expose usage summaries to workspace admins and system operators.

**Independent Test**: Run enrichments from workspace → verify usage logged with correct team ID. Set low dollar cap → verify new jobs blocked at limit. Ask "show our usage" → verify breakdown displayed.

### Implementation for User Story 7

- [X] T046 [US7] Implement usage tracker service — log API calls with slackTeamId, service, tokens, estimatedCostUsd; integrate with existing ApiUsageLog pattern in `src/services/metering/usageTracker.ts`
- [X] T047 [US7] Implement limit enforcer — check monthly dollar-amount cap (primary) and optional per-service call count limits (secondary) from WorkspaceInstallation settings before job submission in `src/services/metering/limitEnforcer.ts`
- [X] T048 [US7] Implement usage reporter — aggregate DailyAggregate by slackTeamId for current billing period, format breakdown by service with costs in `src/services/metering/usageReporter.ts`
- [X] T049 [US7] Implement `usage_query` intent handler — check admin role via agentAuth, call usageReporter, stream formatted summary in `src/services/agent/intentRouter.ts`
- [X] T050 [US7] Expose cross-workspace usage aggregation API endpoint at GET /admin/api/usage/workspaces for feature 3 admin dashboard consumption in `src/routes/admin/usage.ts`
- [X] T051 [US7] Implement 80% and 100% usage threshold notifications — send Slack DM to workspace admins when limits approached/reached in `src/services/metering/limitEnforcer.ts`
- [X] T052 [US7] Integrate limit enforcer check into job submission flow — block new enrichment jobs when any limit reached, inform user via agent in `src/services/agent/intentRouter.ts`

**Checkpoint**: User Story 7 complete — per-workspace metering with enforced limits, admin usage visibility, and cross-workspace API for operator dashboard.

---

## Phase 10: User Story 8 — Public Distribution & Client Onboarding (Priority: P3)

**Goal**: Clients install the agent in their workspace via OAuth install link. New installs trigger an onboarding experience. Uninstalls are handled gracefully.

**Independent Test**: Click install link → complete OAuth → verify WorkspaceInstallation created. Open agent in new workspace → verify onboarding greeting. Uninstall → verify status updated and 90-day purge scheduled.

### Implementation for User Story 8

- [X] T053 [P] [US8] Implement GET /slack/install endpoint — generate CSRF state, redirect to Slack OAuth authorize URL with scopes in `src/routes/oauth/install.ts` per oauth-install.md
- [X] T054 [P] [US8] Implement GET /slack/oauth_redirect endpoint — validate CSRF state, exchange code for tokens, create WorkspaceInstallation, cache bot token in `src/routes/oauth/callback.ts` per oauth-install.md
- [X] T055 [US8] Wire OAuth routes into Express server in `src/server.ts` and register session middleware for CSRF state
- [X] T056 [US8] Implement onboarding flow — detect first-run (onboardingComplete=false), show welcome message with capabilities and guided setup in `src/services/workspace/onboarding.ts`
- [X] T057 [US8] Integrate onboarding check into Assistant threadStarted handler — trigger onboarding for new workspaces in `src/services/agent/assistant.ts`
- [X] T058 [US8] Implement `app_uninstalled` event handler — update WorkspaceInstallation status to UNINSTALLED, set purgeAfter, invalidate Redis cache, cancel running jobs in `src/listeners/events/appUninstalled.ts` per oauth-install.md
- [X] T059 [US8] Register app_uninstalled event listener in `src/app.ts`
- [X] T060 [P] [US8] Create install success and error HTML response pages for OAuth callback in `src/routes/oauth/callback.ts`

**Checkpoint**: User Story 8 complete — public distribution with OAuth install, onboarding, and graceful uninstall handling.

---

## Phase 11: Data Retention & Audit (Cross-Cutting)

**Purpose**: Implement scheduled workers for conversation purge (7-day) and workspace disposal (90-day), plus data export capability.

- [X] T061 Implement conversation purge logic — find threads with turns older than 7 days, generate AgentThreadAudit summary (turn count, intents, jobs, token totals), delete purged turns, update thread status in `src/services/retention/conversationPurge.ts`
- [X] T062 Implement workspace disposal logic — find WorkspaceInstallations with purgeAfter < now, permanently delete workspace-scoped operational data (jobs, contacts, companies, files, agent threads, conversation turns) in `src/services/retention/workspaceDisposal.ts`. MUST NOT delete audit summaries (AgentThreadAudit) or API usage logs (ApiUsageLog, DailyAggregate) — these are retained for 1 year minimum per SOC 2 (see T062b)
- [X] T062b Implement audit/usage log deferred disposal — scheduled worker finds audit summaries and usage logs for uninstalled workspaces older than 1 year post-uninstall, permanently deletes them in `src/services/retention/workspaceDisposal.ts`
- [X] T063 [P] Implement data exporter — export workspace data (enrichment results, job history, usage records) as JSON/CSV archive to S3 for client download in `src/services/retention/dataExporter.ts`
- [X] T064 Register conversation purge as scheduled BullMQ cron job (daily 02:00 UTC) in `src/services/queue/workers/conversationPurge.ts` wrapper and `src/services/queue/queues.ts`
- [X] T065 Register workspace disposal as scheduled BullMQ cron job (daily 03:00 UTC) in `src/services/queue/workers/workspaceDisposal.ts` wrapper and `src/services/queue/queues.ts`
- [X] T066 Implement data export trigger — admin-requested via agent (`/export` or natural language) or automated on uninstall in `src/services/agent/intentRouter.ts`

**Checkpoint**: Data retention complete — 7-day purge with audit summaries, 90-day disposal, and data export operational.

---

## Phase 12: Polish & Cross-Cutting Concerns

**Purpose**: Error handling, rate limiting, backward compatibility verification, and deployment updates.

- [X] T067 Add error handling for streaming failures — graceful stopStream on error, post error message with retry offer in `src/services/agent/streamingHelper.ts`
- [X] T068 [P] Add exponential backoff for Slack API rate limits (startStream/appendStream/stopStream) in `src/services/agent/streamingHelper.ts`
- [X] T069 [P] Verify backward compatibility — confirm all existing trigger-based flows (file_shared, slash commands, action handlers) remain unchanged after agent integration (FR-030, FR-031)
- [X] T069b [P] Add Redis unavailability fallback in `src/services/agent/contextStore.ts` — wrap Redis get/set in try-catch, on failure return null context so agent operates in stateless single-turn mode. Log degradation warning. Agent should inform user that context memory is temporarily unavailable.
- [X] T070 Update `infra/deploy.sh` with new environment variables for OAuth and encryption — ensure Secrets Manager secret is updated with new keys, all CF parameters passed in both initial and update modes
- [X] T071 [US7] Implement workspace settings management via agent — `settings_update` intent handler allowing Slack admins to configure monthly spending cap, per-service limits (maxBuiltwithLookups, maxApolloCredits, maxAiTokens), and default enrichment parameters via conversational interface in `src/services/agent/intentRouter.ts`. Verify admin role via agentAuth before allowing changes.
- [X] T072 [P] Implement workspace settings management via admin API — GET/PUT /admin/api/workspaces/:teamId/settings endpoint for system operators to configure any workspace's settings in `src/routes/admin/workspaceSettings.ts`
- [X] T073 Run quickstart.md validation flow — complete all 6 setup steps and verify end-to-end functionality

---

## Phase 13: Observability & Success Criteria Validation

**Purpose**: Add monitoring and measurement capabilities to validate success criteria that have measurable thresholds.

- [X] T074 [P] Add intent classification accuracy logging — log each classification result (intent, confidence, user-confirmed-correct) to a dedicated table or structured log for measuring SC-002 (85% accuracy target) in `src/services/ai/agentOrchestrator.ts`
- [X] T075 [P] Add agent response time instrumentation — measure and log time from user message receipt to first streaming chunk delivery for SC-003 (<2s target) and task card update latency for SC-004 (<5s target) in `src/services/agent/assistant.ts`
- [X] T076 [P] Add concurrent conversation gauge metric — track active agent thread count via Redis INCR/DECR on thread start/end, expose via health endpoint or CloudWatch custom metric for SC-005 (50 concurrent target) in `src/services/agent/contextStore.ts`
- [X] T077 Add usage metering accuracy validation — compare DailyAggregate sums against raw ApiUsageLog counts for SC-009 (1% accuracy target), log discrepancies in `src/services/metering/usageReporter.ts`

**Checkpoint**: Observability in place — key success criteria are measurable via logs and metrics.

---

## Dependencies & Execution Order

### Cross-Feature Dependency

- **Feature 4 (Infra Hardening)**: Should be deployed before Phase 10 (US8 OAuth). HTTPS/TLS is required for OAuth redirect URI. Secrets Manager pattern (feature 4 US1) should be followed for new secrets in T003. Auto-scaling (feature 4 US4) supports SC-005 concurrent conversation target. WAF (feature 4 US6) protects public OAuth endpoints.

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion — BLOCKS all user stories
- **User Stories (Phases 3-10)**: All depend on Foundational phase completion
  - P1 stories (US1, US2, US3) should be completed in order: US1 → US2 → US3
  - P2 stories (US4, US5, US6) can proceed in parallel after US1 is complete
  - P3 stories (US7, US8) can proceed in parallel after foundational phase
  - **US8 (Phase 10)**: Additionally depends on Feature 4 (Infra Hardening) for HTTPS and Secrets Manager
- **Data Retention (Phase 11)**: Depends on foundational models (Phase 2) — can proceed in parallel with user stories
- **Polish (Phase 12)**: Depends on all desired user stories being complete
- **Observability (Phase 13)**: Depends on US1 and US7 being complete — can proceed in parallel with Data Retention and Polish

### User Story Dependencies

- **US1 (P1)**: Depends on Phase 2 only — no other story dependencies. **This is the MVP.**
- **US2 (P1)**: Depends on US1 (needs assistant + intent router to attach streaming to)
- **US3 (P1)**: Depends on US1 (extends conversation manager from US1)
- **US4 (P2)**: Depends on US1 (extends assistant threadContextChanged handler)
- **US5 (P2)**: Depends on US1 (extends intent router with job management handlers)
- **US6 (P2)**: Depends on US1 (extends intent router with tech report handler)
- **US7 (P3)**: Depends on Phase 2 + US1 (metering integrates into job submission flow)
- **US8 (P3)**: Depends on Phase 2 (OAuth uses InstallationStore + authorize). Can start in parallel with US1.

### Within Each User Story

- Models before services
- Services before handlers
- Core implementation before integration
- Story complete before moving to next priority

### Parallel Opportunities

**Phase 2 (Foundational)**:
- T008 (encryption), T011 (context store), T012 (auth utility) can run in parallel
- T009 (InstallationStore) and T010 (authorize) must be sequential (authorize depends on store)

**Phase 3 (US1)**:
- T015 (agent orchestrator) and T016 (intent router) can run in parallel
- T018 (assistant registration) depends on T015, T016, T017

**Phase 7-8 (US5, US6)**:
- T039, T040, T041 (job status/cancel/history handlers) can all run in parallel

**Phase 10 (US8)**:
- T053 (install endpoint) and T054 (callback endpoint) can run in parallel

**Cross-Phase**:
- US8 (OAuth/Distribution) can proceed in parallel with US1-US6 since it primarily touches separate files (routes/oauth/, workspace/)
- Phase 11 (Data Retention) can proceed in parallel with US4-US8 since it touches separate files (retention/, queue/workers/)

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL — blocks all stories)
3. Complete Phase 3: User Story 1 — Conversational Enrichment
4. **STOP and VALIDATE**: Deploy to ECS, test agent side-panel end-to-end
5. Agent can classify intent, accept files, and initiate enrichment jobs conversationally

### Incremental Delivery

1. **Setup + Foundational** → Foundation ready
2. **Add US1** → Conversational enrichment works → Deploy (MVP!)
3. **Add US2** → Streaming + task cards → Deploy (visual upgrade)
4. **Add US3** → Multi-turn memory → Deploy (conversational intelligence)
5. **Add US4 + US5 + US6** → Channel context, job management, tech reports → Deploy (feature complete for P2)
6. **Add US7 + US8** → Metering + public distribution → Deploy (commercial readiness)
7. **Add Data Retention + Polish** → SOC 2 compliance, error handling → Deploy (production hardened)
8. **Add Observability** → Success criteria measurement → Deploy (measurable)

### Suggested MVP Scope

**Phase 1 + Phase 2 + Phase 3 (US1)** = 23 tasks

This delivers the core value: a working conversational agent that can classify enrichment intent, accept file uploads, and submit jobs — replacing the rigid trigger-based flow with natural language interaction.
