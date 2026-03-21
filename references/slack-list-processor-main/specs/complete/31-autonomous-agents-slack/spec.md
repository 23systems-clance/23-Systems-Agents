# Feature Specification: Autonomous Agents with Slack Admin Interface

**Feature Branch**: `25-autonomous-agents-slack`
**Created**: 2026-03-13
**Status**: Draft
**Input**: User description: "Create a feature specification for implementing autonomous agent patterns with Slack admin interface - implement 5 autonomous agents using ThePopeBot-inspired patterns to enhance operational automation in the Slack List Processor with Slack-based admin commands for mobile job monitoring and system management"

## Clarifications

### Session 2026-03-20

- Q: Should spec 31's autonomous agents be built as Platform Agents + Specialties (Feature 39) or standalone BullMQ workers? → A: Platform Agents + Specialties — reuse existing Agent/Specialty/MCP infrastructure with SCHEDULED trigger type, leveraging built-in versioning, execution tracing, credit tracking, and admin UI.
- Q: What are "specialties" and "teams" in the current platform? → A: Specialties replaces Skills (renamed platform concept). Teams is a new concept — a group of agents that collaborate.
- Q: What mechanism should be used for audit trail persistence from ECS containers? → A: Database audit table only (AuditAction table). Drop Git commit requirement; SpecialtyExecution records + AuditAction table provide structured, queryable audit trail without Git-from-container complexity.
- Q: What triggers transition from suggest-only to auto-execute mode? → A: Admin approval rate gate — transition when admin approves >=90% of suggestions over 50+ actions, evaluated per agent independently.
- Q: Confirm Teams = Clusters? → A: Yes. A Team is a cluster of collaborating agents (e.g., "Quality Monitoring" team/cluster = Anomaly Detector + Root Cause Analyzer + Auto-Remediation Executor).

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Admin Job Monitoring via Slack (Priority: P1)

Admins need to monitor, manage, and control enrichment jobs from their mobile devices while away from their desks without accessing the CloudFront admin dashboard.

**Why this priority**: This is the foundation for mobile admin access and enables all subsequent autonomous agent features. Without Slack commands, admins cannot review autonomous agent actions or manually intervene when needed.

**Independent Test**: Can be fully tested by an admin user invoking `/admin jobs`, `/admin job <id>`, and `/admin cancel <id>` commands in Slack and receiving accurate job status, filtering by status type (running, completed, failed), and successfully canceling a running job with confirmation.

**Acceptance Scenarios**:

1. **Given** admin user is authenticated and has ADMIN role, **When** they type `/admin jobs` in Slack, **Then** they receive an ephemeral message listing the 10 most recent enrichment jobs with status, type, and timestamp
2. **Given** admin types `/admin jobs running`, **When** the command is processed, **Then** only jobs with "running" status are displayed
3. **Given** admin types `/admin job 12345`, **When** the job exists, **Then** detailed job information is displayed including progress percentage, current stage, rows processed, and estimated completion time
4. **Given** admin types `/admin cancel 12345`, **When** job is running, **Then** a confirmation button is shown, and upon clicking "Confirm", the job is canceled and status updated
5. **Given** non-admin user types `/admin jobs`, **When** authorization check runs, **Then** ephemeral error message states "You do not have permission to use this command"

---

### User Story 2 - Autonomous Infrastructure Self-Healing (Priority: P2)

The system automatically detects and recovers from transient ECS task failures without requiring manual intervention, reducing operational burden on the admin team.

**Why this priority**: Saves ~4 hours/week of manual infrastructure troubleshooting and prevents service disruptions from transient failures. This is the highest ROI autonomous capability.

**Independent Test**: Can be fully tested by simulating an ECS task failure with a transient error pattern (OOM, network timeout), verifying the agent classifies it correctly (confidence ≥0.85), auto-restarts the task, records the action to AuditAction table, and notifies the admin dashboard with severity "info".

**Acceptance Scenarios**:

1. **Given** an ECS task stops with "OutOfMemoryError", **When** the Infrastructure Maintenance Agent processes the failure, **Then** it classifies as transient (confidence 0.90), restarts the task, and logs the action
2. **Given** an ECS task stops with exit code 137 (SIGKILL) on first attempt, **When** agent evaluates, **Then** it auto-restarts and creates AuditAction record with action type, confidence, and task metadata
3. **Given** an ECS task stops with code bug pattern (exit code 1, stack trace), **When** agent evaluates with confidence 0.45, **Then** it creates GitHub issue with task ARN, stop reason, CloudWatch log link, and label "infrastructure, auto-generated"
4. **Given** an ECS task has been auto-restarted 3 times, **When** it fails a 4th time, **Then** agent escalates to human via GitHub issue instead of restarting again
5. **Given** Infrastructure Agent restarts a task, **When** action completes, **Then** admin dashboard displays system event with type "infrastructure_auto_heal", severity "info", and metadata including task ARN and stop reason

---

### User Story 3 - Autonomous API Rate Limit Optimization (Priority: P3)

The system continuously monitors API quota usage and automatically adjusts worker concurrency to maximize throughput while avoiding rate limit errors.

**Why this priority**: Saves ~2.5 hours/week of reactive troubleshooting and prevents job delays. Second-highest ROI after infrastructure maintenance.

**Independent Test**: Can be fully tested by monitoring API usage hitting 90% of BuiltWith quota (540/600 requests), verifying the Rate Limit Manager Agent reduces technographic worker concurrency from 5 to 0, pauses for 15 minutes, commits config change to database, and notifies admin dashboard.

**Acceptance Scenarios**:

1. **Given** BuiltWith API quota is at 45% utilization (270/600 requests this hour), **When** Rate Limit Manager runs, **Then** it increases technographic worker concurrency to 10 (confidence 0.95) and commits change
2. **Given** quota reaches 78% utilization, **When** agent evaluates, **Then** it reduces concurrency to 3 (confidence 0.85) to avoid hitting limit
3. **Given** quota exceeds 90% utilization, **When** agent evaluates, **Then** it pauses worker (concurrency 0), schedules resume in 15 minutes, and logs warning severity event
4. **Given** concurrency is adjusted, **When** change is committed, **Then** `workerConfig` table is upserted with new concurrency, timestamp, updatedBy="api-rate-limit-manager", and rationale
5. **Given** agent adjusts concurrency 5 times in 1 hour, **When** pattern is detected, **Then** it escalates to admin with summary of quota fluctuations and suggests investigation

---

### User Story 4 - Admin Audit Trail Visibility (Priority: P4)

Admins can review all autonomous agent actions taken in the past hours/days via Slack command to understand what the system has automated and verify correctness.

**Why this priority**: Provides transparency and accountability for autonomous operations. Critical for building trust in autonomous systems.

**Independent Test**: Can be fully tested by triggering 3 autonomous actions (e.g., ECS restart, concurrency adjustment, GitHub issue creation), then invoking `/admin audit 24` to see all actions from the past 24 hours with timestamps, agent names, actions taken, confidence scores, and links to AuditAction records.

**Acceptance Scenarios**:

1. **Given** Infrastructure Agent restarted ECS task 2 hours ago, **When** admin types `/admin audit 24`, **Then** audit log shows "ECS Task Restart" with task ARN, confidence 0.90, timestamp, and AuditAction record ID
2. **Given** no autonomous actions in past 6 hours, **When** admin types `/admin audit 6`, **Then** message states "No autonomous agent actions in the past 6 hours"
3. **Given** Rate Limit Agent adjusted concurrency 10 times today, **When** admin types `/admin audit today`, **Then** all 10 adjustments are listed with before/after concurrency values and quota utilization percentages
4. **Given** admin types `/admin audit` without hours parameter, **When** command is processed, **Then** default to past 24 hours
5. **Given** audit log has 50+ entries, **When** displayed in Slack, **Then** show first 20 with "Load More" button for pagination

---

### User Story 5 - Autonomous Data Quality Monitoring (Priority: P5)

The system proactively detects anomalies in enrichment job performance (failure rates, match percentages, duration) and automatically investigates root causes and applies fixes when possible.

**Why this priority**: Detects data quality issues 2-4 hours faster than manual review, preventing bad data from reaching customers.

**Independent Test**: Can be fully tested by simulating an anomaly (e.g., inject 10% failure rate in BuiltWith API responses for 1 hour), verifying Anomaly Detector triggers root cause analysis, Root Cause Analyzer classifies error pattern, and Auto-Remediation Executor creates GitHub issue for unknown pattern.

**Acceptance Scenarios**:

1. **Given** hourly job completion rate drops to 88% (>5% failure threshold), **When** Anomaly Detector runs, **Then** it triggers Root Cause Analyzer with anomaly details
2. **Given** Root Cause Analyzer reads CloudWatch logs and finds "BuiltWith API Timeout" pattern, **When** classification runs, **Then** it records classification to the AuditAction table with error type, count, and affected job IDs in metadata
3. **Given** error is known issue (API timeout with retry logic already exists), **When** Auto-Remediation Executor runs, **Then** it adjusts retry backoff from 5s to 10s via WorkerConfig/database update and records the change to AuditAction table
4. **Given** error is unknown issue, **When** Auto-Remediation evaluates with confidence <0.50, **Then** it creates GitHub issue with error pattern, affected job IDs, suggested investigation steps, and assigns to team
5. **Given** anomaly is detected, **When** remediation completes, **Then** admin dashboard displays event with type "quality_auto_remediation", severity based on fix success, and metadata with anomaly details

---

### User Story 6 - Autonomous Campaign Optimization (Priority: P6)

The system analyzes campaign DM open rates by time-of-day and automatically adjusts send schedules to maximize engagement, and runs A/B tests on messaging templates.

**Why this priority**: Improves campaign engagement by 15-20% without manual optimization effort.

**Independent Test**: Can be fully tested by running a campaign with 200 DMs sent at various times (9 AM, 11 AM, 2 PM), verifying Campaign Optimizer detects 11 AM has 35% higher open rate, automatically updates cron schedule to 11 AM, and commits change to database.

**Acceptance Scenarios**:

1. **Given** campaign DMs sent at 9 AM have 22% open rate and 11 AM have 30% open rate (after 100+ sends), **When** Campaign Optimizer analyzes, **Then** it updates campaign send time to 11 AM with confidence 0.88
2. **Given** Campaign Optimizer starts A/B test with 2 message templates, **When** 100 sends complete (50 per variant), **Then** it calculates winner based on response rate and persists winning template selection to the database (campaign configuration record)
3. **Given** current send time is 9 AM and analysis shows no significant difference across times, **When** optimizer evaluates with confidence <0.70, **Then** it does NOT change schedule and logs low-confidence decision
4. **Given** campaign jobs complete at varying times (some at 3 PM, some at 5 PM), **When** optimizer monitors, **Then** it sends EOD report when 95% of jobs complete instead of at fixed time
5. **Given** A/B test shows variant B has 5% higher response rate (not statistically significant), **When** optimizer evaluates, **Then** it continues test until 200 sends or confidence >0.85, whichever comes first

---

### User Story 7 - Autonomous CRM Conflict Resolution (Priority: P7)

The system automatically resolves HubSpot contact sync conflicts using ML-based confidence scoring, reducing manual review burden for admins.

**Why this priority**: Saves ~2 hours/week on manual CRM data reconciliation. Lower priority as it affects CRM data quality, not core enrichment operations.

**Independent Test**: Can be fully tested by flagging 10 HubSpot contacts with conflicts (duplicate emails, mismatched company names), verifying CRM Conflict Resolver scores each conflict, auto-merges high-confidence matches (≥0.85), suggests medium-confidence merges to admin (0.50-0.84), and escalates low-confidence conflicts (<0.50) with context.

**Acceptance Scenarios**:

1. **Given** HubSpot import flags contact "john@acme.com" with company "Acme Inc" vs "Acme Inc.", **When** CRM Conflict Resolver evaluates, **Then** it scores confidence 0.92 and auto-merges records
2. **Given** conflict has confidence 0.67 (company name "Acme Corp" vs "Acme Corporation"), **When** agent evaluates, **Then** it creates admin notification with suggested merge and "Approve/Reject" buttons
3. **Given** admin approves suggested merge, **When** approval is processed, **Then** agent learns from decision (updates confidence model weights) and persists updated weights to the database
4. **Given** conflict has confidence 0.42 (completely different company names), **When** agent evaluates, **Then** it escalates to admin dashboard with full contact details and requests manual review
5. **Given** agent processes 100 conflicts and admin rejects 15 auto-merge suggestions, **When** learning loop runs, **Then** confidence threshold is adjusted (e.g., from 0.85 to 0.88) to reduce false positives

---

### Edge Cases

- What happens when admin uses `/admin cancel` on a job that just completed naturally? → Display "Job already completed" message instead of cancellation confirmation
- How does system handle Slack command timeout (3-second ack limit)? → Immediately acknowledge with "Processing..." then update via thread message when data is ready
- What happens when Infrastructure Agent tries to restart a task but AWS API is unavailable? → Retry with exponential backoff (3 attempts), then escalate to GitHub issue if all fail
- How does Rate Limit Manager handle multiple API providers (BuiltWith, Apollo.io) with different quotas? → Monitor each provider separately with independent concurrency configs per worker type
- What happens when admin with VIEWER role tries `/admin cancel`? → Display "This action requires ADMIN or EDITOR role. You have VIEWER access."
- How does system handle conflicting autonomous actions (e.g., Quality Monitor wants to increase concurrency while Rate Limit Manager wants to decrease)? → Rate Limit Manager takes precedence (quota protection is higher priority), logs conflict in audit trail
- What happens when database write fails during audit trail creation? → Log error to CloudWatch, retry once, create system event in admin dashboard with severity "high", continue agent operation (don't block on audit failure)
- How does Campaign Optimizer handle campaigns with <100 sends (insufficient data for A/B test)? → Log "insufficient data" and defer optimization until threshold reached
- What happens when CRM Conflict Resolver learning loop detects accuracy dropping below 70%? → Disable auto-merge mode, switch to suggest-only mode, alert admin via Slack
- How does system handle admin linking Slack user ID when AdminUser already has a different Slack ID? → Prompt admin to confirm overwrite, log previous ID in audit trail
- What happens when autonomous agent is disabled via kill switch mid-execution? → Complete current job cycle, mark status as "paused", do not start new jobs until re-enabled
- How does system handle Slack rate limits when posting many audit trail messages? → Batch messages into single formatted response, paginate if >20 items

## Requirements _(mandatory)_

### Functional Requirements

#### Slack Admin Commands

- **FR-001**: System MUST provide `/admin` slash command registered in Slack workspace that acknowledges within 3 seconds and routes subcommands
- **FR-002**: System MUST link Slack user IDs to AdminUser table records via `slackUserId` field for authorization
- **FR-003**: System MUST verify admin authorization for every `/admin` command by looking up `AdminUser` record by Slack user ID
- **FR-004**: System MUST enforce role-based access control where VIEWER role has read-only access, EDITOR can cancel jobs, and ADMIN can purge cache and modify configs
- **FR-005**: System MUST send ephemeral responses (private to user) for all `/admin` command outputs
- **FR-006**: `/admin jobs [status]` MUST list recent enrichment jobs filtered by status (running, completed, failed) with pagination support (default 20 items)
- **FR-007**: `/admin job <id>` MUST display detailed job information including progress percentage, current stage, rows processed, estimated completion time, and error messages if failed
- **FR-008**: `/admin cancel <id>` MUST display confirmation button before canceling job, then update job status to "canceled" in database and stop BullMQ worker processing
- **FR-009**: `/admin usage [daily|weekly]` MUST display API quota consumption (BuiltWith, Apollo.io) and credit usage aggregated by timeframe
- **FR-010**: `/admin errors [count]` MUST display recent error summary with severity, count, affected jobs, and timestamps (default last 10 errors, maximum 50)
- **FR-011**: `/admin workflows` MUST list active workflow definitions with execution counts, success rates, and last run timestamps
- **FR-012**: `/admin cache purge [domain|apollo|all]` MUST display confirmation before purging cache, then clear specified cache type and return purge count
- **FR-013**: `/admin config [presets|thresholds]` MUST display current enrichment configurations with option to update via interactive modal
- **FR-014**: `/admin workers` MUST display real-time worker status including queue depth, active jobs, concurrency setting, and error rate per worker type
- **FR-015**: `/admin audit [hours]` MUST display autonomous agent actions from past N hours (default 24) with timestamps, agent names, actions, confidence scores, and AuditAction record links
- **FR-016**: System MUST log all `/admin` command executions to audit log with user ID, command, timestamp, and outcome

#### Infrastructure Maintenance Agent

- **FR-017**: System MUST create a Platform Agent named "Infrastructure Maintenance" with a SCHEDULED Specialty that monitors ECS task failures via CloudWatch events (using Feature 39 Agent/Specialty infrastructure)
- **FR-018**: Agent MUST classify ECS task failures as transient (OOM, network timeout, exit codes <128) or code bugs using pattern matching
- **FR-019**: For transient failures with confidence ≥0.85, agent MUST auto-restart ECS task using same task definition and network configuration (max 3 restart attempts per task)
- **FR-020**: For code bug failures with confidence <0.50, agent MUST create GitHub issue with task ARN, stop reason, exit code, CloudWatch log link, and labels "infrastructure, auto-generated"
- **FR-021**: Agent MUST record all actions to AuditAction table with timestamp, action type, confidence, metadata, agentName, and specialtyExecutionId
- **FR-022**: Agent MUST create system event in `systemEvent` table with type "infrastructure_auto_heal" or "infrastructure_escalation", severity based on confidence, and relevant metadata
- **FR-023**: Agent MUST respect kill switch — global via `AUTONOMOUS_AGENTS_ENABLED` environment variable, per-agent via Agent.status (DEPRECATED disables) and Agent.metadata config — if disabled, log action as "would restart" but do not execute

#### API Rate Limit Manager Agent

- **FR-024**: System MUST create a Platform Agent named "API Rate Limit Manager" with a SCHEDULED Specialty (every 5 minutes) that monitors API quota usage (using Feature 39 Agent/Specialty infrastructure)
- **FR-025**: Agent MUST aggregate API usage from `apiUsage` table grouped by provider (BuiltWith, Apollo.io) and calculate hourly quota utilization
- **FR-026**: Agent MUST calculate optimal worker concurrency based on quota utilization thresholds: <50% → 10, 50-75% → 5, 75-90% → 3, >90% → 0
- **FR-027**: Agent MUST upsert `workerConfig` table with new concurrency value, timestamp, updatedBy="api-rate-limit-manager", and rationale string
- **FR-028**: When setting concurrency to 0 (pause), agent MUST schedule worker resume job after 15 minutes
- **FR-029**: Agent MUST record concurrency changes to AuditAction table with before/after values and quota utilization percentage
- **FR-030**: Agent MUST create system event with type "worker_config_update", severity "warning" if paused else "info", and metadata with quota details
- **FR-031**: If agent detects quota fluctuation >20% within 1 hour (5+ adjustments), it MUST escalate pattern to admin dashboard for investigation

#### Quality Monitoring Agent Cluster

- **FR-032**: System MUST create three Platform Agents with chained SCHEDULED/EVENT Specialties: "Anomaly Detector", "Root Cause Analyzer", "Auto-Remediation Executor" (using Feature 39 Agent/Specialty infrastructure with chainEventName for inter-agent triggering; these 3 agents form a "Quality Monitoring" Team)
- **FR-032a**: The Quality Monitoring Agent Cluster MUST be represented as a Team entity, grouping the 3 agents for coordinated execution, shared context, and unified status visibility in the admin dashboard
- **FR-033**: Anomaly Detector (running every 15 minutes) MUST analyze the most recent 1-hour window of job completion rates from `dailyAggregate` and detect anomalies: >5% failure rate, <20% match percentage, >30min avg duration
- **FR-034**: When anomaly detected, Anomaly Detector MUST trigger Root Cause Analyzer by creating job in `root-cause-analysis` queue with anomaly details
- **FR-035**: Root Cause Analyzer MUST read CloudWatch logs using AWS SDK, pattern-match error messages, and classify: API timeout, invalid domain, quota exceeded, data quality issue
- **FR-036**: Root Cause Analyzer MUST record classification to AuditAction table with error type, count, affected job IDs, timestamps
- **FR-037**: Root Cause Analyzer MUST trigger Auto-Remediation Executor by creating job in `auto-remediation` queue with classification results
- **FR-038**: Auto-Remediation Executor MUST maintain knowledge base of known fixes (e.g., "BuiltWith timeout → adjust retry backoff") in `src/services/agents/remediationRules.ts`
- **FR-039**: For known issues with confidence ≥0.85, Auto-Remediation MUST apply fix (adjust config, update validation rules) and record change to AuditAction table
- **FR-040**: For unknown issues with confidence <0.50, Auto-Remediation MUST create GitHub issue with error pattern, affected jobs, suggested investigation, and team assignment
- **FR-041**: Auto-Remediation MUST update admin dashboard with system event type "quality_auto_remediation", severity based on fix success, and metadata

#### Campaign Optimization Agent

- **FR-042**: System MUST create a Platform Agent named "Campaign Optimizer" with a SCHEDULED Specialty (daily) that analyzes campaign performance (using Feature 39 Agent/Specialty infrastructure)
- **FR-043**: Agent MUST aggregate campaign DM open rates and response rates grouped by send time-of-day from past 30 days (minimum 100 sends per time slot)
- **FR-044**: Agent MUST calculate engagement score per time slot and identify optimal send time with statistical significance (p<0.05, confidence ≥0.85)
- **FR-045**: If optimal time differs from current schedule, agent MUST update campaign `upsertJobScheduler` cron pattern to new time and commit change to database
- **FR-046**: Agent MUST implement A/B testing framework that randomly assigns 50% of sends to variant A and 50% to variant B for template experiments
- **FR-047**: After minimum 100 sends, agent MUST calculate winner based on response rate difference and statistical significance
- **FR-048**: Agent MUST persist winning template selection to the database (campaign configuration record) and update campaign to use winning variant
- **FR-049**: Agent MUST monitor campaign job completion times and send EOD report when 95% of daily jobs complete (not at fixed time)
- **FR-050**: Agent MUST respect minimum data thresholds - if <100 sends or confidence <0.70, log decision as "insufficient data" and defer optimization

#### CRM Conflict Resolution Agent

- **FR-051**: System MUST create a Platform Agent named "CRM Conflict Resolver" with an EVENT Specialty triggered by HubSpot sync conflicts from `hubspotImportWorker` (using Feature 39 Agent/Specialty infrastructure)
- **FR-052**: Agent MUST implement ML-based confidence scoring using features: email similarity, company name edit distance, phone number match, domain match, contact title similarity
- **FR-053**: For conflicts with confidence ≥0.85, agent MUST auto-merge records by updating primary contact and archiving duplicate
- **FR-054**: For conflicts with confidence 0.50-0.84, agent MUST create admin notification in Slack with conflict details and "Approve/Reject" buttons
- **FR-055**: For conflicts with confidence <0.50, agent MUST escalate to admin dashboard with full contact details and request manual review
- **FR-056**: When admin approves or rejects suggested merge, agent MUST update confidence model weights using supervised learning (gradient descent on feedback)
- **FR-057**: Agent MUST persist updated merge logic weights to the database (Agent metadata or dedicated config record) after every 10 admin feedback events
- **FR-058**: If admin rejection rate exceeds 30% over 100 decisions, agent MUST disable auto-merge mode and switch to suggest-only mode
- **FR-059**: Agent MUST log all merge decisions to audit trail with confidence score, features used, and outcome (auto, approved, rejected, escalated)

#### General Agent Requirements

- **FR-060**: All autonomous agents MUST implement confidence-based execution: ≥0.85 auto-execute, 0.50-0.84 suggest to admin, <0.50 escalate to human
- **FR-061**: All autonomous agents MUST log actions via SpecialtyExecution and AgentInvocation records (Feature 39 execution tracing); additionally record critical actions to AuditAction table with agent name, action, confidence score, and rationale
- **FR-062**: All autonomous agents MUST respect the platform Agent status lifecycle — setting an Agent to DEPRECATED disables execution; additionally support a "suggest-only" mode flag on the Agent record for granular control
- **FR-063**: System MUST leverage the existing platform agent status dashboard (Feature 39) augmented with: last run time, success rate, average confidence, and actions taken in past 24 hours for autonomous agents
- **FR-064**: All autonomous agents MUST implement "suggest-only" mode override where auto-execute is disabled and all actions require admin approval (used for initial rollout), controlled via Agent record metadata
- **FR-064a**: An agent MUST automatically transition from suggest-only to auto-execute mode when admin approval rate reaches >=90% over a minimum of 50 suggested actions, evaluated independently per agent
- **FR-064b**: System MUST track approval/rejection counts per agent in suggest-only mode and display progress toward auto-execute threshold in the admin dashboard (e.g., "42/50 actions reviewed, 95% approval rate")
- **FR-065**: All autonomous agents MUST handle AWS API failures gracefully with exponential backoff retry (3 attempts max) and escalation to admin if all fail

### Key Entities

- **AdminUser**: Represents admin users with fields: id, email, slackUserId (newly added), role (ADMIN, EDITOR, VIEWER), isActive, createdAt
- **Agent** (existing platform model): Extended for autonomous agents — each autonomous agent is a Platform Agent record with status lifecycle (DRAFT → TESTING → PUBLISHED → DEPRECATED), modelId, toolIds, creditCost, inputSchema, outputSchema
- **AgentVersion** (existing platform model): Immutable snapshots of agent configuration; autonomous agent Specialties pin to specific versions
- **Specialty** (existing platform model, formerly "Skill"): Each autonomous agent has an associated Specialty with triggerType SCHEDULED or EVENT, deliveryChannels, mcpToolIds, retryPolicy, and chainEventName for inter-agent orchestration
- **SpecialtyExecution** (existing platform model, formerly "SkillExecution"): Tracks every autonomous agent run with status, input/output, creditsCost, executionTrace, startedAt/completedAt
- **Team** (new model, also referred to as "Cluster"): A named group of collaborating agents that work together on a domain (e.g., "Quality Monitoring" team/cluster contains Anomaly Detector, Root Cause Analyzer, Auto-Remediation Executor). Fields: id, name, slug, description, agentIds (array), status
- **AgentInvocation** (existing platform model): Tracks individual LLM calls within each execution with tokens, cost, duration, toolCallsMade
- **WorkerConfig**: Worker concurrency settings with fields: workerName (unique), concurrency (number), updatedAt, updatedBy (string), reason (string - rationale for change)
- **SystemEvent**: Log of system events with fields: type (string), severity ("info" | "warning" | "high" | "critical"), message, metadata (JSON), timestamp
- **AuditAction** (new model): Database audit trail for all autonomous agent actions with fields: id, agentName, action, confidence, metadata (JSON), specialtyExecutionId, severity, timestamp
- **CampaignMetrics**: Campaign performance data with fields: campaignId, sendTime (hour of day), openRate, responseRate, sendCount, lastUpdated
- **ConflictDecision**: CRM conflict resolution feedback with fields: conflictId, confidence, features (JSON), outcome ("auto" | "approved" | "rejected" | "escalated"), adminUserId, timestamp

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: All 5 autonomous agents operational with <0.1% error rate measured over 7-day period
- **SC-002**: Admin commands respond within 5 seconds for 95% of requests (from Slack command invocation to response display)
- **SC-003**: Autonomous actions logged to AuditAction table with 100% coverage (no action taken without corresponding record)
- **SC-004**: Time savings validated at ≥8 hours/week reduction in manual operations (measured by admin time tracking before/after)
- **SC-005**: Infrastructure Agent achieves ≥90% success rate in auto-restarting transient failures without manual intervention
- **SC-006**: Rate Limit Manager prevents API rate limit errors with 0 quota exceeded incidents over 30-day period
- **SC-007**: Campaign engagement improves by ≥10% measured by open rate and response rate after optimization is active for 30 days
- **SC-008**: Quality Monitoring Agent detects anomalies within 15 minutes of occurrence with <5% false positive rate
- **SC-009**: CRM Conflict Resolver auto-merges ≥70% of conflicts with <5% admin rejection rate (indicating high accuracy)
- **SC-010**: Zero Socket Mode connection conflicts - all Slack commands and autonomous agents coexist without event splitting or dropped messages
- **SC-011**: Admin dashboard displays real-time agent activity with <60 second latency from action to dashboard update
- **SC-012**: Only authorized admin users can access `/admin` commands - 0 unauthorized access attempts succeed
- **SC-013**: Suggest-only mode successfully gates all autonomous actions during initial rollout with 100% admin review; agents transition to auto-execute only after >=90% approval rate over 50+ actions per agent
- **SC-014**: AWS cost increase stays within $30-50/month budget for autonomous agent workload (measured by CloudWatch metrics and billing)

## Assumptions

- AdminUser table already exists with role-based access control; only adding `slackUserId` field
- Slack workspace has existing Bolt app installed with Socket Mode enabled
- CloudWatch events for ECS task state changes are already configured and accessible
- GitHub API token with repo write access is available for creating issues and committing
- AWS SDK credentials have permissions for ECS (RunTask, DescribeTasks) and CloudWatch Logs (FilterLogEvents)
- Feature 39 Vertical Pack Platform is deployed with Agent, Specialty, MCP Server, and execution infrastructure
- BullMQ queue infrastructure (Redis connection, worker registry) is already set up (used by Feature 39 Specialty executor)
- AuditAction database table will be created via Prisma migration for structured audit trail
- Admin dashboard backend exposes REST API for creating system events
- HubSpot import worker already flags conflicts in a standard format (conflict records in database table)
- Campaign performance metrics are tracked in database with send times, open rates, response rates
- Statistical significance testing can use industry-standard methods (chi-square test, p<0.05 threshold)
- ML-based confidence scoring for CRM conflicts can use simple weighted feature scoring initially (not deep learning) with gradient descent for learning
- Slack user IDs can be reliably obtained from command.user_id field in Bolt SDK
- Database (PostgreSQL) is accessible from ECS container environment for audit writes
- Initial "suggest-only" mode transitions to auto-execute per agent when >=90% admin approval rate over 50+ actions is reached (no fixed time limit)

## Out of Scope

- Building a separate ThePopeBot deployment or Docker-based agent framework (using Feature 39 Platform Agents + Specialties instead)
- Telegram bot interface (using Slack commands only per updated requirements)
- Deep learning models for CRM conflict resolution (using simpler ML scoring initially)
- Real-time streaming of agent actions to Slack (batch updates via `/admin audit` command sufficient)
- Multi-workspace Slack app installation (single workspace only for this feature)
- Automated rollback of autonomous agent actions (admin can manually review and reverse via dashboard)
- Integration with external monitoring tools like Datadog or New Relic (CloudWatch and admin dashboard sufficient)
- Natural language processing for Slack command parsing (strict subcommand syntax required)
- Mobile-native app for admin dashboard (Slack commands provide mobile access)
