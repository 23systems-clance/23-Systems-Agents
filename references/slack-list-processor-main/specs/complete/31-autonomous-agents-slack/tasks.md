# Tasks: Autonomous Agents with Slack Admin Interface

**Input**: Design documents from `/specs/31-autonomous-agents-slack/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Prisma schema changes, dependency installation, and shared type definitions

- [x] T001 Update prisma/schema.prisma: add new enums — TeamStatus (ACTIVE, INACTIVE), Severity (INFO, WARNING, HIGH, CRITICAL) shared by AuditAction and SystemEvent, AuditOutcome (AUTO_EXECUTED, SUGGESTED, APPROVED, REJECTED, ESCALATED), ConflictOutcome (AUTO_MERGED, APPROVED, REJECTED, ESCALATED), PendingActionStatus (PENDING, APPROVED, REJECTED, EXPIRED)
- [x] T002 Update prisma/schema.prisma: add EDITOR value to existing AdminRole enum (between ADMIN and VIEWER)
- [x] T003 Update prisma/schema.prisma: add `slackUserId String? @unique @map("slack_user_id")` to AdminUser model; add relations to AuditAction[] and ConflictDecision[]
- [x] T004 Update prisma/schema.prisma: add autonomous fields to Agent model — suggestOnlyMode Boolean @default(true), suggestOnlyApprovals Int @default(0), suggestOnlyRejections Int @default(0), lastRunAt DateTime?, actionsToday Int @default(0); add TeamAgent[] relation
- [x] T005 Update prisma/schema.prisma: create Team model (id uuid, name, slug unique, description text, status TeamStatus, timestamps) and TeamAgent junction model (id uuid, teamId, agentId, sortOrder int) with @@unique([teamId, agentId]) and indexes per data-model.md
- [x] T006 Update prisma/schema.prisma: create AuditAction model (id uuid, agentName, action, confidence float, severity AuditSeverity, metadata jsonb, specialtyExecutionId uuid optional FK to SkillExecution, outcome AuditOutcome, adminUserId uuid optional FK to AdminUser, timestamp) with indexes on [agentName,timestamp], [timestamp], [outcome,timestamp], [severity,timestamp] per data-model.md
- [x] T007 Update prisma/schema.prisma: create WorkerConfig model (id uuid, workerName unique, concurrency int, updatedAt, updatedBy string, reason text) with index on workerName per data-model.md
- [x] T008 Update prisma/schema.prisma: create SystemEvent model (id uuid, type string, severity EventSeverity, message text, metadata jsonb, agentName optional, acknowledged boolean default false, acknowledgedBy optional, acknowledgedAt optional, timestamp) with indexes on [type,timestamp], [severity,timestamp], [acknowledged,timestamp] per data-model.md
- [x] T009 Update prisma/schema.prisma: create CampaignMetrics model (id uuid, campaignId, sendHour int, openRate float, responseRate float, sendCount int, abTestVariant optional, lastUpdated) with @@unique([campaignId,sendHour,abTestVariant]) and index on campaignId per data-model.md
- [x] T010 Update prisma/schema.prisma: create ConflictDecision model (id uuid, conflictId, confidence float, features jsonb, outcome ConflictOutcome, adminUserId optional FK to AdminUser, metadata optional jsonb, timestamp) with indexes on [outcome,timestamp], [conflictId] per data-model.md
- [x] T011 Update prisma/schema.prisma: create PendingAction model (id uuid, agentName string, action string, confidence float, metadata jsonb, specialtyExecutionId uuid optional FK to SkillExecution, status PendingActionStatus default PENDING, reviewedBy string optional, reviewedAt DateTime optional, createdAt default now()) with index on [status,createdAt] per research.md §9
- [x] T012 Add AWAITING_APPROVAL to SkillExecutionStatus enum in prisma/schema.prisma (new status for suggest-only mode gating per research.md §9)
- [x] T013 Generate and apply Prisma migration for all schema changes above
- [x] T014 [P] Install npm dependencies: @aws-sdk/client-ecs @aws-sdk/client-cloudwatch-logs @octokit/rest simple-statistics fastest-levenshtein
- [x] T015 [P] Create autonomous domain type definitions in src/lib/autonomous/types.ts: AutonomousAgentOutput interface ({ confidence: number, action: string, rationale: string, data: any }), ConfidenceThresholds type, AdminSubcommand type union, SystemEventTypes constants, AuditActionTypes constants, agent name constants for all 7 agents

**Checkpoint**: Database schema ready, dependencies installed, types defined

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core services and infrastructure that ALL user stories depend on

**CRITICAL**: No user story work can begin until this phase is complete

- [x] T016 [P] Implement AuditAction recorder service in src/services/autonomous/auditRecorder.ts: recordAction(agentName, action, confidence, severity, outcome, metadata, specialtyExecutionId?, adminUserId?) → creates AuditAction record; getRecentActions(hours, filters?) → queries with pagination; uses Prisma client
- [x] T017 [P] Implement SystemEvent emitter service in src/services/autonomous/systemEventEmitter.ts: emitEvent(type, severity, message, metadata, agentName?) → creates SystemEvent record; getEvents(filters) → queries with pagination; acknowledgeEvent(id, acknowledgedBy) → marks event acknowledged
- [x] T018 [P] Implement confidence gate service in src/services/autonomous/confidenceGate.ts: evaluateAction(agent, output) → returns { decision: 'auto_execute' | 'suggest' | 'escalate' } based on confidence thresholds (>=0.85 auto, 0.50-0.84 suggest, <0.50 escalate) and agent.suggestOnlyMode flag; thresholds configurable per agent via metadata.autoThreshold/suggestThreshold per research.md §10
- [x] T019 [P] Implement suggest-only mode manager in src/services/autonomous/suggestOnlyManager.ts: createPendingAction(agent, output, executionId) → creates PendingAction record + posts Slack Approve/Reject buttons to admin channel; processApproval(pendingActionId, adminUserId) → updates PendingAction, increments agent.suggestOnlyApprovals, enqueues action execution; processRejection(pendingActionId, adminUserId, reason) → updates PendingAction, increments agent.suggestOnlyRejections; checkGraduation(agent) → evaluates >=90% approval over 50+ actions, sets suggestOnlyMode=false if met (FR-064a, FR-064b)
- [x] T020 [P] Implement Team/Cluster manager service in src/services/autonomous/teamManager.ts: createTeam(name, slug, description, agentIds?) → creates Team + TeamAgent records; updateTeam(teamId, data) → updates Team, replaces TeamAgent membership; getTeam(teamId) → returns team with agents; listTeams(filters?) → returns all teams with agent counts; deleteTeam(teamId) → cascading delete
- [x] T021 [P] Implement ECS operations MCP tool in src/services/autonomous/tools/ecsOperations.ts: listStoppedTasks(cluster) → ECS ListTasksCommand with desiredStatus STOPPED; describeTaskDetails(cluster, taskArns) → DescribeTasksCommand with stop reason and exit codes; restartTask(cluster, taskDefinitionArn, networkConfig) → RunTaskCommand with FARGATE launch type; classifyFailure(stopReason, exitCode) → returns { type: 'transient' | 'code_bug', confidence: number } per research.md §2
- [x] T022 [P] Implement CloudWatch logs tool in src/services/autonomous/tools/cloudWatchLogs.ts: queryErrorLogs(logGroupName, startTime, endTime, filterPattern?) → FilterLogEventsCommand with JSON pattern matching; parseLogEntries(events) → extracts structured error data from winston JSON logs; getLogLink(logGroupName, logStreamName, timestamp) → generates CloudWatch console deep link per research.md §3
- [x] T023 [P] Implement GitHub issues tool in src/services/autonomous/tools/githubIssues.ts: createIssue(title, body, labels, assignees?) → Octokit issues.create with owner=developerlabsai, repo=slack-list-processor; builds formatted issue body with agent analysis, task details, and CloudWatch log links; uses GITHUB_PAT env var per research.md §4
- [x] T024 [P] Implement statistical testing utilities in src/services/autonomous/tools/statisticalTests.ts: abTestSignificance(conversionsA, samplesA, conversionsB, samplesB) → two-proportion z-test returning {zScore, pValue, significant}; chiSquareTimeOfDay(hourlyData) → chi-square goodness of fit for send time optimization; uses simple-statistics library per research.md §5
- [x] T025 Implement admin authorization middleware in src/slack/middleware/adminAuth.ts: lookupAdminUser(slackUserId) → queries AdminUser by slackUserId field; checkRole(adminUser, requiredRole) → validates ADMIN > EDITOR > VIEWER hierarchy; returns typed AdminUser or sends ephemeral error "You do not have permission to use this command"; handle edge case where AdminUser already has a different slackUserId (log previous ID in AuditAction before overwrite) (FR-002, FR-003, FR-004)
- [x] T026 Implement SCHEDULED specialty sync at startup in src/services/platform/scheduledSpecialtySync.ts: syncScheduledSpecialties() → queries all PUBLISHED Skills with triggerType=SCHEDULED, registers BullMQ repeatable jobs via upsertJobScheduler for each with cron from triggerConfig.cronPattern; call at app startup alongside existing register*RepeatableJobs; removeScheduler(specialtyId) when DEPRECATED per research.md §7
- [x] T026a [P] Implement shared retry utility in src/services/autonomous/tools/retryWithBackoff.ts: retryWithBackoff(fn, maxAttempts=3, baseDelay=1000) → executes fn with exponential backoff (1s, 2s, 4s); on all attempts exhausted, emits SystemEvent with severity=HIGH and returns error for escalation; used by all autonomous agents for AWS API calls (FR-065)
- [x] T027 [P] Create barrel export in src/services/autonomous/index.ts: re-export all services (auditRecorder, systemEventEmitter, confidenceGate, suggestOnlyManager, teamManager) and tools (ecsOperations, cloudWatchLogs, githubIssues, statisticalTests)
- [x] T028 Register suggest-only Slack action handlers in src/listeners/actions/agentApproval.ts: app.action('agent_action_approve_*') → calls suggestOnlyManager.processApproval; app.action('agent_action_reject_*') → calls suggestOnlyManager.processRejection; updates original Slack message to show outcome; follows existing graduationReview.ts button pattern per research.md §9
- [x] T029 Integrate confidence gate into skill executor: update src/services/platform/skillExecutor.ts to check agent.suggestOnlyMode after agent invocation — if suggestOnly and output.confidence >= thresholds, call suggestOnlyManager.createPendingAction and mark execution as AWAITING_APPROVAL; always call auditRecorder.recordAction for every autonomous agent execution per research.md §9 and §10

**Checkpoint**: Foundation ready — all core services, tools, and middleware in place. User story implementation can now begin.

---

## Phase 3: User Story 1 — Admin Job Monitoring via Slack (Priority: P1)

**Goal**: Admins can monitor, manage, and control enrichment jobs from Slack via `/admin` slash command

**Independent Test**: Invoke `/admin jobs`, `/admin job <id>`, `/admin cancel <id>` in Slack — verify job list with status filtering, detailed job info, and job cancellation with confirmation button. Non-admin users get "You do not have permission" error.

### Implementation

- [x] T030 [US1] Create /admin slash command handler and subcommand router in src/listeners/commands/admin.ts: register app.command('/admin', ...), ack immediately, parse command.text for subcommand routing (jobs, job, cancel, usage, errors, workflows, workers, cache, config, audit, help), call adminAuth middleware for authorization, dispatch to subcommand handlers; follow existing enrich.ts command pattern (FR-001, FR-005)
- [x] T031 [US1] Register admin command in src/listeners/commands/index.ts: add registerAdminCommand(app) call following existing command registration pattern
- [x] T032 [US1] Implement `/admin jobs [status]` subcommand in src/listeners/commands/admin.ts: query enrichment jobs from database filtered by optional status param (running, completed, failed), format as Slack blocks with job summary (id, user, file, status, rows, timestamps), paginate with default 10 items, send ephemeral response (FR-006)
- [x] T033 [US1] Implement `/admin job <id>` subcommand in src/listeners/commands/admin.ts: query single job by ID with full details (progress %, current stage, rows processed/failed, credits used, error summary), format as detailed Slack blocks, handle not-found case (FR-007)
- [x] T034 [US1] Implement `/admin cancel <id>` subcommand in src/listeners/commands/admin.ts: verify job is running/pending, display confirmation button via respond(), require EDITOR or ADMIN role; register app.action('admin_cancel_confirm_*') handler that cancels BullMQ job and updates database status to cancelled (FR-008)
- [x] T035 [P] [US1] Implement `/admin usage [daily|weekly]` subcommand in src/listeners/commands/admin.ts: aggregate API usage from apiUsage table by provider (BuiltWith, Apollo), include Claude token costs from AgentInvocation, format as Slack blocks with usage bars (FR-009)
- [x] T036 [P] [US1] Implement `/admin errors [count]` subcommand in src/listeners/commands/admin.ts: query recent errors from job records and system logs, group by severity and source, format as Slack blocks with error details (FR-010)
- [x] T037 [P] [US1] Implement `/admin workflows` subcommand in src/listeners/commands/admin.ts: query active enrichment jobs with step-level progress (file_parsing, builtwith_lookup, apollo_enrichment, persona_classification, file_generation), format as Slack blocks with progress bars (FR-011)
- [x] T038 [P] [US1] Implement `/admin workers` subcommand in src/listeners/commands/admin.ts: query BullMQ queue stats (waiting, active, completed, failed, delayed) and WorkerConfig for concurrency settings, format as Slack blocks with worker status indicators (FR-014)
- [x] T039 [US1] Implement `/admin cache purge [scope]` subcommand in src/listeners/commands/admin.ts: require ADMIN role, show confirmation button, register app.action('admin_cache_purge_confirm') handler that clears Redis cache keys by scope (all, builtwith, apollo), return purge count (FR-012)
- [x] T040 [US1] Implement `/admin config [section]` subcommand in src/listeners/commands/admin.ts: require ADMIN role for PUT, VIEWER+ for GET; display current config values for section (enrichment, api_limits, slack, system); support interactive modal for config updates via app.view() handler (FR-013)
- [x] T041 [US1] Implement `/admin help` subcommand in src/listeners/commands/admin.ts: return ephemeral message listing all available subcommands with descriptions and role requirements
- [x] T042 [US1] Log all /admin command executions via auditRecorder in src/listeners/commands/admin.ts: after each subcommand completes, call auditRecorder.recordAction with agentName='admin-command', action=subcommand, adminUserId (FR-016)
- [x] T043 [P] [US1] Create admin commands REST API routes in src/routes/admin/commands.ts: implement GET /api/v1/admin/jobs, GET /api/v1/admin/jobs/:jobId, POST /api/v1/admin/jobs/:jobId/cancel, GET /api/v1/admin/usage, GET /api/v1/admin/errors, GET /api/v1/admin/workflows, GET /api/v1/admin/workers, POST /api/v1/admin/cache/purge, GET/PUT /api/v1/admin/config/:section per admin-commands-api.yaml contract; share service logic with Slack command handlers
- [x] T044 [US1] Register admin command routes in src/routes/admin/index.ts or src/server.ts: mount /api/v1/admin/* routes with existing admin auth middleware

**Checkpoint**: `/admin` commands fully functional in Slack. Admins can monitor jobs, view usage, cancel jobs, purge cache, and manage config from mobile.

---

## Phase 4: User Story 2 — Autonomous Infrastructure Self-Healing (Priority: P2)

**Goal**: System automatically detects and recovers from transient ECS task failures without manual intervention

**Independent Test**: Simulate an ECS task failure (OOM pattern), verify the agent classifies it correctly (confidence >=0.85), auto-restarts the task (or suggests in suggest-only mode), records AuditAction, and creates SystemEvent with type "infrastructure_auto_heal".

### Implementation

- [x] T045 [US2] Implement Infrastructure Maintenance Agent in src/services/autonomous/agents/infrastructureMaintenance.ts: create Platform Agent handler that runs on SCHEDULED trigger (every 5 min); calls ecsOperations.listStoppedTasks to find recently stopped tasks, calls describeTaskDetails for stop reasons and exit codes, calls classifyFailure to categorize each as transient or code bug (FR-017, FR-018)
- [x] T046 [US2] Implement transient failure auto-restart logic in src/services/autonomous/agents/infrastructureMaintenance.ts: for transient failures (OOM, network timeout, exit codes >=128) with confidence >=0.85, call ecsOperations.restartTask with same task definition and network config; track restart count per task ARN, enforce max 3 restarts (FR-019)
- [x] T047 [US2] Implement code bug escalation in src/services/autonomous/agents/infrastructureMaintenance.ts: for code bug failures (exit code 1, stack trace) with confidence <0.50, call githubIssues.createIssue with task ARN, stop reason, exit code, CloudWatch log link from cloudWatchLogs.getLogLink, and labels ['infrastructure', 'auto-generated'] (FR-020)
- [x] T048 [US2] Implement escalation after 3 failed restarts in src/services/autonomous/agents/infrastructureMaintenance.ts: track restart attempts per task definition in Redis or metadata; on 4th failure, escalate to GitHub issue instead of restarting; include all 3 previous restart timestamps and outcomes in issue body (FR-019 edge case)
- [x] T049 [US2] Integrate Infrastructure Agent with audit and event recording: after each action, call auditRecorder.recordAction with agentName='infrastructure-maintenance', action type, confidence, metadata (task ARN, stop reason, exit code); call systemEventEmitter.emitEvent with type 'infrastructure_auto_heal' or 'infrastructure_escalation' (FR-021, FR-022)
- [x] T050 [US2] Implement kill switch check for Infrastructure Agent: read AUTONOMOUS_AGENTS_ENABLED env var and agent-specific config from database; if disabled, log action as "would restart" in AuditAction with outcome=SUGGESTED but do NOT execute restart (FR-023)
- [x] T051 [US2] Seed Infrastructure Maintenance Platform Agent record: create seed script or migration seed in prisma/seed.ts to create Agent with name='Infrastructure Maintenance', create associated Skill (Specialty) with triggerType=SCHEDULED, triggerConfig={ cronPattern: '*/5 * * * *' }, status=DRAFT; set suggestOnlyMode=true

**Checkpoint**: Infrastructure Maintenance Agent detects ECS failures, classifies them, auto-restarts transient failures, and escalates code bugs to GitHub issues.

---

## Phase 5: User Story 3 — Autonomous API Rate Limit Optimization (Priority: P3)

**Goal**: System continuously monitors API quota usage and automatically adjusts worker concurrency to prevent rate limit errors

**Independent Test**: Verify the agent reads API usage at 90% quota, reduces technographic worker concurrency to 0, schedules resume in 15 minutes, upserts WorkerConfig, and logs the adjustment.

### Implementation

- [x] T052 [US3] Implement API Rate Limit Manager Agent in src/services/autonomous/agents/apiRateLimitManager.ts: create Platform Agent handler on SCHEDULED trigger (every 5 min); query apiUsage table aggregated by provider (BuiltWith, Apollo.io) to calculate hourly quota utilization percentage (FR-024, FR-025)
- [x] T053 [US3] Implement concurrency adjustment logic in src/services/autonomous/agents/apiRateLimitManager.ts: calculate optimal concurrency based on utilization thresholds (<50%→10, 50-75%→5, 75-90%→3, >90%→0); compare against current WorkerConfig value; if changed, upsert WorkerConfig with new concurrency, updatedBy='api-rate-limit-manager', and rationale string (FR-026, FR-027)
- [x] T054 [US3] Implement worker pause and auto-resume in src/services/autonomous/agents/apiRateLimitManager.ts: when concurrency set to 0, schedule a BullMQ delayed job (15 min delay) that restores previous concurrency; store previous value in WorkerConfig.reason or metadata for restoration (FR-028)
- [x] T055 [US3] Implement quota fluctuation escalation in src/services/autonomous/agents/apiRateLimitManager.ts: track adjustment count per hour in Redis counter; if 5+ adjustments within 1 hour, emit SystemEvent with severity=HIGH and message summarizing quota fluctuations, do not auto-adjust further until admin reviews (FR-031)
- [x] T056 [US3] Integrate Rate Limit Agent with audit and event recording: after each concurrency change, call auditRecorder.recordAction with before/after concurrency values and quota utilization %; call systemEventEmitter.emitEvent with type='worker_config_update', severity=WARNING if paused else INFO (FR-029, FR-030)
- [x] T057 [US3] Seed API Rate Limit Manager Platform Agent record: create Agent with name='API Rate Limit Manager', create Skill (Specialty) with triggerType=SCHEDULED, triggerConfig={ cronPattern: '*/5 * * * *' }, status=DRAFT; set suggestOnlyMode=true

**Checkpoint**: API Rate Limit Manager monitors quota usage, adjusts concurrency, pauses workers when needed, and escalates fluctuations.

---

## Phase 6: User Story 4 — Admin Audit Trail Visibility (Priority: P4)

**Goal**: Admins can review all autonomous agent actions via Slack command and admin dashboard to verify correctness and build trust

**Independent Test**: After triggering 3 autonomous actions (ECS restart, concurrency adjustment, GitHub issue), invoke `/admin audit 24` and verify all actions appear with timestamps, agent names, confidence scores, and outcomes.

### Implementation

- [x] T058 [US4] Implement `/admin audit [hours]` subcommand in src/listeners/commands/admin.ts: query AuditAction records from past N hours (default 24), format as Slack blocks showing agentName, action, confidence, outcome, timestamp; paginate with first 20 items and "Load More" button; handle "today" alias; handle empty result set with "No autonomous agent actions" message (FR-015)
- [x] T059 [US4] Register /admin audit Load More action handler in src/listeners/actions/adminAudit.ts: app.action('admin_audit_load_more') → fetch next page of AuditAction records, update original message with appended results
- [x] T060 [P] [US4] Create audit trail REST API routes in src/routes/admin/autonomous.ts: implement GET /api/v1/admin/autonomous/audit with query params (agentName, severity, outcome, startDate, endDate, page, limit) per autonomous-agents-api.yaml contract; returns paginated AuditActionRecord list
- [x] T061 [P] [US4] Create autonomous agents REST API routes in src/routes/admin/autonomous.ts: implement GET /api/v1/admin/autonomous/agents (list with filters), GET /api/v1/admin/autonomous/agents/:agentId (detail with recent executions and pending actions), PUT /api/v1/admin/autonomous/agents/:agentId/mode (toggle suggest/auto), POST approve/:auditActionId, POST reject/:auditActionId per autonomous-agents-api.yaml contract
- [x] T062 [P] [US4] Create Team CRUD REST API routes in src/routes/admin/teams.ts: implement GET /api/v1/admin/autonomous/teams (list), POST (create), GET /:teamId (detail with member agents), PUT /:teamId (update) per autonomous-agents-api.yaml contract
- [x] T063 [P] [US4] Create system events REST API routes in src/routes/admin/autonomous.ts: implement GET /api/v1/admin/autonomous/events with query params (type, severity, startDate, endDate, page, limit) per autonomous-agents-api.yaml contract
- [x] T064 [P] [US4] Create dashboard aggregation REST API route in src/routes/admin/autonomous.ts: implement GET /api/v1/admin/autonomous/dashboard returning summary (agent counts, pending actions, actions last 24h), agent list, recent actions, alerts, teams per autonomous-agents-api.yaml contract
- [x] T065 [US4] Register autonomous agent and team routes in src/routes/admin/index.ts or src/server.ts: mount /api/v1/admin/autonomous/* and /api/v1/admin/autonomous/teams/* routes with existing admin auth middleware

**Checkpoint**: Audit trail visible via `/admin audit` in Slack and via dashboard REST APIs. All autonomous agent management APIs operational.

---

## Phase 7: User Story 5 — Autonomous Data Quality Monitoring (Priority: P5)

**Goal**: System proactively detects anomalies in enrichment job performance, investigates root causes, and applies fixes or escalates

**Independent Test**: Simulate >5% failure rate in hourly jobs, verify Anomaly Detector triggers Root Cause Analyzer via chain event, Root Cause Analyzer classifies error pattern from CloudWatch logs, and Auto-Remediation creates GitHub issue for unknown pattern.

### Implementation

- [x] T066 [US5] Implement Anomaly Detector Agent in src/services/autonomous/agents/anomalyDetector.ts: create Platform Agent handler on SCHEDULED trigger (every 15 min); query dailyAggregate or job tables for hourly completion rates; detect anomalies when >5% failure rate, <20% match percentage, or >30min avg duration; output anomaly details with confidence score (FR-032, FR-033)
- [x] T067 [US5] Configure Anomaly Detector chain event: set chainEventName='anomaly.detected' on the Anomaly Detector Specialty so that on completion with anomaly found, publishChainEvent triggers downstream Root Cause Analyzer (FR-034)
- [x] T068 [US5] Implement Root Cause Analyzer Agent in src/services/autonomous/agents/rootCauseAnalyzer.ts: create Platform Agent handler on EVENT trigger (eventName='anomaly.detected'); receive anomaly details from chain input; call cloudWatchLogs.queryErrorLogs for the anomaly time window; classify error patterns (API timeout, invalid domain, quota exceeded, data quality issue); output classification with affected job IDs and error counts (FR-035, FR-036)
- [x] T069 [US5] Configure Root Cause Analyzer chain event: set chainEventName='rootcause.classified' on the RCA Specialty so completion triggers downstream Auto-Remediation Executor (FR-037)
- [x] T070 [US5] Implement Auto-Remediation Executor Agent in src/services/autonomous/agents/autoRemediationExecutor.ts: create Platform Agent handler on EVENT trigger (eventName='rootcause.classified'); receive classification from chain input; maintain known fix knowledge base as a map in src/services/autonomous/agents/remediationRules.ts (e.g., 'builtwith_timeout' → adjust retry backoff config) (FR-038)
- [x] T071 [US5] Implement remediation execution logic in src/services/autonomous/agents/autoRemediationExecutor.ts: for known issues with confidence >=0.85, apply fix (update config, adjust validation rules) and record change to AuditAction; for unknown issues with confidence <0.50, call githubIssues.createIssue with error pattern, affected jobs, and suggested investigation steps (FR-039, FR-040, FR-041)
- [x] T072 [US5] Create remediation rules knowledge base in src/services/autonomous/agents/remediationRules.ts: export a map of known error patterns to remediation actions — e.g., { pattern: 'builtwith_timeout', action: 'adjust_retry_backoff', config: { from: 5000, to: 10000 } }; initially seed with 3-5 known patterns from existing operational experience
- [x] T073 [US5] Seed Quality Monitoring cluster: create 3 Agent records (Anomaly Detector, Root Cause Analyzer, Auto-Remediation Executor) with associated Skills (Specialties); set triggerType and chainEventName for each; create Team record name='Quality Monitoring', slug='quality-monitoring'; create TeamAgent records linking all 3 agents with sortOrder 0,1,2
- [x] T074 [US5] Integrate all Quality Monitoring agents with audit and event recording: each agent calls auditRecorder.recordAction and systemEventEmitter.emitEvent with type='quality_auto_remediation' and severity based on fix confidence

**Checkpoint**: Quality Monitoring cluster operational. Anomaly detection chains to root cause analysis chains to auto-remediation. GitHub issues created for unknown patterns.

---

## Phase 8: User Story 6 — Autonomous Campaign Optimization (Priority: P6)

**Goal**: System analyzes campaign DM performance and automatically adjusts send schedules and runs A/B tests to maximize engagement

**Independent Test**: Verify agent aggregates DM open rates by send hour over past 30 days, identifies 11 AM as optimal with statistical significance (p<0.05), and updates campaign schedule.

### Implementation

- [x] T075 [US6] Implement Campaign Optimizer Agent in src/services/autonomous/agents/campaignOptimizer.ts: create Platform Agent handler on SCHEDULED trigger (daily at 6 AM UTC); aggregate campaign DM open rates and response rates from CampaignMetrics table grouped by sendHour for past 30 days; require minimum 100 sends per time slot (FR-042, FR-043)
- [x] T076 [US6] Implement send time optimization logic in src/services/autonomous/agents/campaignOptimizer.ts: calculate engagement score per hour slot; use statisticalTests.chiSquareTimeOfDay to identify optimal send time with p<0.05; if optimal time differs from current schedule and confidence >=0.85, update campaign cron pattern via upsertJobScheduler (FR-044, FR-045)
- [x] T077 [US6] Implement A/B testing framework in src/services/autonomous/agents/campaignOptimizer.ts: randomly assign 50% of sends to variant A and 50% to variant B; track results in CampaignMetrics with abTestVariant field; after minimum 100 sends per variant, use statisticalTests.abTestSignificance to calculate winner; persist winning template selection to campaign configuration record in database (FR-046, FR-047, FR-048)
- [x] T078 [US6] Implement insufficient data deferral in src/services/autonomous/agents/campaignOptimizer.ts: if <100 sends total or confidence <0.70, log decision as "insufficient data" in AuditAction with outcome=SUGGESTED and defer optimization; continue A/B test until 200 sends or confidence >0.85 (FR-050)
- [x] T079 [US6] Implement EOD report logic in src/services/autonomous/agents/campaignOptimizer.ts: monitor campaign job completion times; when 95% of daily jobs complete, emit SystemEvent with EOD summary instead of fixed-time reporting (FR-049)
- [x] T080 [US6] Seed Campaign Optimizer Platform Agent record: create Agent with name='Campaign Optimizer', create Skill (Specialty) with triggerType=SCHEDULED, triggerConfig={ cronPattern: '0 6 * * *', timezone: 'UTC' }, status=DRAFT; set suggestOnlyMode=true
- [x] T081 [US6] Integrate Campaign Optimizer with audit and event recording: record all optimization decisions (send time changes, A/B test results, deferrals) to AuditAction; emit SystemEvents for schedule changes

**Checkpoint**: Campaign Optimizer analyzes send times, runs A/B tests, and adjusts schedules based on statistical significance.

---

## Phase 9: User Story 7 — Autonomous CRM Conflict Resolution (Priority: P7)

**Goal**: System automatically resolves HubSpot contact sync conflicts using confidence scoring, reducing manual review burden

**Independent Test**: Flag 10 HubSpot contacts with conflicts (duplicate emails, mismatched company names), verify agent scores each, auto-merges high-confidence (>=0.85), suggests medium-confidence to admin (0.50-0.84), and escalates low-confidence (<0.50).

### Implementation

- [x] T082 [US7] Implement CRM Conflict Resolver Agent in src/services/autonomous/agents/crmConflictResolver.ts: create Platform Agent handler on EVENT trigger (eventName='hubspot.sync.conflict'); receive conflict details from hubspotImportWorker chain event (FR-051)
- [x] T083 [US7] Implement confidence scoring in src/services/autonomous/agents/crmConflictResolver.ts: weighted feature scoring using email similarity (weight 0.30, via fastest-levenshtein), company name similarity (weight 0.25, via jaro-winkler with normalization stripping Inc/LLC/Corp/Ltd), domain match (weight 0.20, exact after normalization), phone match (weight 0.15, exact), title similarity (weight 0.10, via jaro-winkler); return weighted sum as confidence score (FR-052)
- [x] T084 [US7] Implement confidence-based merge decisions in src/services/autonomous/agents/crmConflictResolver.ts: confidence >=0.85 → auto-merge (update primary, archive duplicate, record ConflictDecision with outcome=AUTO_MERGED); 0.50-0.84 → post Slack notification with Approve/Reject buttons; <0.50 → escalate to admin dashboard with full details (FR-053, FR-054, FR-055)
- [x] T085 [US7] Implement admin feedback learning loop in src/services/autonomous/agents/crmConflictResolver.ts: on admin approve/reject, record ConflictDecision; every 10 feedback events, recalculate feature weights using simple gradient descent on admin decisions to minimize prediction error; persist updated weights to database (Agent metadata or dedicated config record) (FR-056, FR-057)
- [x] T086 [US7] Implement auto-merge safety valve in src/services/autonomous/agents/crmConflictResolver.ts: track rejection rate over rolling 100 decisions; if rejection rate exceeds 30%, disable auto-merge (set suggestOnlyMode=true), emit SystemEvent with severity=HIGH alerting admin (FR-058)
- [x] T087 [US7] Publish hubspot.sync.conflict chain event from hubspotImportWorker: update src/workers/hubspotImportWorker.ts (or relevant worker) to call publishChainEvent('hubspot.sync.conflict', conflictData) when a sync conflict is detected, providing the conflict details as chain payload
- [x] T088 [US7] Seed CRM Conflict Resolver Platform Agent record: create Agent with name='CRM Conflict Resolver', create Skill (Specialty) with triggerType=EVENT, triggerConfig={ eventName: 'hubspot.sync.conflict' }, status=DRAFT; set suggestOnlyMode=true
- [x] T089 [US7] Create conflict rules utility in src/integrations/hubspot/conflictRules.ts: export default feature weights object { email: 0.30, companyName: 0.25, domain: 0.20, phone: 0.15, title: 0.10 } and company name normalization function; these are initial defaults — the learning loop persists updated weights to database (Agent metadata), which takes precedence over file defaults at runtime

**Checkpoint**: CRM Conflict Resolver processes HubSpot sync conflicts, auto-merges high-confidence matches, learns from admin feedback, and disables auto-merge if rejection rate too high.

---

## Phase 10: Admin Dashboard Frontend

**Goal**: Visual interface for monitoring autonomous agents, managing teams, reviewing audit trail, and tracking suggest-only mode progress

**Independent Test**: Navigate to admin dashboard autonomous agents section, verify agent list shows all 7 agents with status and suggest-only progress, team view shows Quality Monitoring cluster, and audit trail is filterable.

### Implementation

- [x] T090 [P] Create Autonomous Agent list page in admin-dashboard/src/pages/autonomous/AgentList.tsx: fetch from GET /api/v1/admin/autonomous/agents; display table with name, status, mode (suggest_only/auto_execute), last execution, pending actions count, success rate; add filters for status and mode; show suggest-only progress bar (e.g., "42/50 reviewed, 95% approval") per FR-064b
- [x] T091 [P] Create Autonomous Agent detail page in admin-dashboard/src/pages/autonomous/AgentDetail.tsx: fetch from GET /api/v1/admin/autonomous/agents/:agentId; display agent config, execution stats (total, success rate, avg duration, last 24h), recent executions list, pending audit actions with Approve/Reject buttons; toggle mode via PUT /mode endpoint
- [x] T092 [P] Create Team list page in admin-dashboard/src/pages/autonomous/TeamList.tsx: fetch from GET /api/v1/admin/autonomous/teams; display table with team name, agent count, active agents, pending actions; link to team detail
- [x] T093 [P] Create Team detail page in admin-dashboard/src/pages/autonomous/TeamDetail.tsx: fetch from GET /api/v1/admin/autonomous/teams/:teamId; display team info, member agents with status and mode, edit team membership via PUT endpoint
- [x] T094 [P] Create Audit Trail page in admin-dashboard/src/pages/autonomous/AuditTrail.tsx: fetch from GET /api/v1/admin/autonomous/audit; display paginated table with agentName, action, confidence, severity, outcome, timestamp; add filters for agent, severity, outcome, date range per FR-063
- [x] T095 [P] Create System Events page in admin-dashboard/src/pages/autonomous/SystemEvents.tsx: fetch from GET /api/v1/admin/autonomous/events; display paginated event feed with type, severity, message, agent, timestamp; add acknowledge button per event
- [x] T096 Create Autonomous Dashboard overview page in admin-dashboard/src/pages/autonomous/Dashboard.tsx: fetch from GET /api/v1/admin/autonomous/dashboard; display summary cards (total agents, active, pending actions, actions last 24h), agent status grid, recent actions list, alerts feed, team overview
- [x] T097 Add navigation links for autonomous agent pages in admin-dashboard/src/components/Sidebar.tsx or navigation component: add "Autonomous Agents" section with links to Dashboard, Agents, Teams, Audit Trail, System Events

**Checkpoint**: Admin dashboard fully functional with autonomous agent monitoring, team management, audit trail browsing, and system event tracking.

---

## Phase 11: Polish & Cross-Cutting Concerns

**Purpose**: Integration testing, Socket Mode validation, and production readiness

- [x] T098 Verify Socket Mode coexistence: confirm /admin commands and all autonomous agent scheduled/event executions work on single Socket Mode connection without event splitting or "No file found" errors in CloudWatch logs (SC-010)
- [x] T099 Implement daily actionsToday counter reset: add BullMQ repeatable job (midnight UTC) that resets Agent.actionsToday to 0 for all agents; register in startup alongside existing repeatable jobs
- [x] T100 Add AUTONOMOUS_AGENTS_ENABLED master kill switch check: in syncScheduledSpecialties and confidence gate, check env var before registering schedulers or executing actions; if false, log but do not execute (FR-023)
- [x] T101 Run quickstart.md verification checklist against staging environment: validate all deployment steps and verification items including Slack commands, authorization, all 7 agents, suggest-only mode, audit trail, Socket Mode, and budget constraints
- [x] T102 Update environment variable documentation: add GITHUB_PAT and AUTONOMOUS_AGENTS_ENABLED to .env.example and Docker Compose staging config; document required IAM permissions (ecs:RunTask, ecs:DescribeTasks, ecs:ListTasks, ecs:StopTask, logs:FilterLogEvents)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately
- **Foundational (Phase 2)**: Depends on Phase 1 (schema + deps) — BLOCKS all user stories
- **US1 (Phase 3)**: Depends on Phase 2 (auth middleware, audit recorder)
- **US2 (Phase 4)**: Depends on Phase 2 (ECS tools, audit recorder, confidence gate, suggest-only manager)
- **US3 (Phase 5)**: Depends on Phase 2 (audit recorder, confidence gate) — can run parallel with US2
- **US4 (Phase 6)**: Depends on Phase 2 (audit REST APIs) — can run parallel with US2/US3; benefits from US2/US3 generating audit data
- **US5 (Phase 7)**: Depends on Phase 2 (chain events, CloudWatch tools, GitHub tools, audit recorder)
- **US6 (Phase 8)**: Depends on Phase 2 (statistical tests, audit recorder) — can run parallel with US2-US5
- **US7 (Phase 9)**: Depends on Phase 2 (suggest-only manager, audit recorder) — can run parallel with US2-US6
- **Dashboard (Phase 10)**: Depends on Phase 6 (REST APIs must exist) — can run parallel with agent implementation
- **Polish (Phase 11)**: Depends on all previous phases completing

### User Story Dependencies

- **US1 (P1)**: Independent — first story to implement; provides /admin command framework used by US4
- **US2 (P2)**: Independent of other stories — uses ECS tools from Phase 2
- **US3 (P3)**: Independent of other stories — uses WorkerConfig model from Phase 1
- **US4 (P4)**: Depends on US1 (/admin command framework for /admin audit subcommand); REST APIs independent
- **US5 (P5)**: Independent — 3 agents chained via existing Feature 39 chain event mechanism
- **US6 (P6)**: Independent — uses CampaignMetrics model and statistical utilities
- **US7 (P7)**: Independent — needs hubspotImportWorker to publish chain event (T087)

### Within Each User Story

- Seed agent records before testing agent execution
- Core agent logic before edge cases (escalation, safety valves)
- Agent implementation before audit/event integration
- All backend before frontend (Phase 10 last)

### Parallel Opportunities

**Phase 1**: T014 (deps) and T015 (types) can run parallel with schema tasks
**Phase 2**: T016-T024 (all services and tools) can run in parallel — different files with no interdependencies
**Phase 3**: T035-T038 (usage, errors, workflows, workers) can run parallel — independent subcommands
**Phase 4-9**: User stories US2-US7 can run in parallel after Phase 2 completes (different agent files)
**Phase 10**: All dashboard pages (T090-T096) can run in parallel — independent React components

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (schema + deps)
2. Complete Phase 2: Foundational (core services)
3. Complete Phase 3: User Story 1 (admin commands)
4. **STOP and VALIDATE**: Test `/admin jobs`, `/admin cancel`, `/admin usage` in Slack
5. Deploy to staging via CI/CD push to `develop` branch

### Incremental Delivery

1. Setup + Foundational → Foundation ready
2. Add US1 (Admin Commands) → Test in Slack → Deploy (MVP!)
3. Add US2 + US3 (Infra + Rate Limit Agents) → Test agent execution → Deploy
4. Add US4 (Audit Trail) → Test `/admin audit` and dashboard APIs → Deploy
5. Add US5 (Quality Monitoring Cluster) → Test chain events → Deploy
6. Add US6 + US7 (Campaign + CRM Agents) → Test optimization + conflicts → Deploy
7. Add Phase 10 (Dashboard Frontend) → Test all pages → Deploy
8. Run Phase 11 (Polish) → Full verification against quickstart.md → Production deploy

### Task Metrics

- **Total tasks**: 103
- **Phase 1 (Setup)**: 15 tasks
- **Phase 2 (Foundational)**: 15 tasks
- **US1 (Admin Commands)**: 15 tasks
- **US2 (Infrastructure)**: 7 tasks
- **US3 (Rate Limit)**: 6 tasks
- **US4 (Audit Trail)**: 8 tasks
- **US5 (Quality Cluster)**: 9 tasks
- **US6 (Campaign)**: 7 tasks
- **US7 (CRM Conflicts)**: 8 tasks
- **Dashboard Frontend**: 8 tasks
- **Polish**: 5 tasks
- **Parallel opportunities**: 43 tasks marked [P]
