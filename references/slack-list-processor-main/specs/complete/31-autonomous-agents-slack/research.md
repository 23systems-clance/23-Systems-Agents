# Research: Autonomous Agents with Slack Admin Interface

**Feature**: 31-autonomous-agents-slack
**Date**: 2026-03-20
**Status**: Complete

## 1. Slack Slash Command Pattern — `/admin` Registration and Routing

### Decision
Register `/admin` via `app.command('/admin', ...)` in Bolt SDK, immediately call `await ack()` within 3 seconds, then parse `command.text` for subcommand routing. Use `respond()` for ephemeral replies under 3 seconds; for long-running lookups, ack with a "Processing..." message and follow up via `client.chat.postEphemeral()`.

### Rationale
The project already has 8 registered slash commands (`/enrich`, `/upload`, `/filter`, `/split`, `/analyze`, `/hubspot`, `/onboard`, `/assign-manager`) all using the identical pattern: `app.command() -> await ack() -> parse subcommand -> respond()`. The `/enrich` command in `src/listeners/commands/enrich.ts` demonstrates the exact pattern needed: ack immediately, split text on whitespace for subcommand routing, and use `respond({ response_type: 'ephemeral' })` for private replies.

The 3-second Slack timeout applies to the HTTP acknowledgment only. Once `ack()` is called, the handler can run for up to 30 minutes (Bolt SDK does not enforce a secondary timeout). For subcommands that require database queries (e.g., `/admin jobs`, `/admin audit`), the lookup completes well within 3 seconds. For subcommands that trigger mutations (e.g., `/admin cancel`), post an interactive confirmation button via `respond()` and handle the click in a separate `app.action()` handler.

### Alternatives Considered
- **Slack Interactivity API (shortcuts/modals)**: More complex, requires manifest changes, overkill for text-based admin commands
- **Multiple commands (`/admin-jobs`, `/admin-cancel`)**: Slack limits apps to 30 commands but more importantly fragments the UX; single `/admin` with subcommands is cleaner
- **Slack Events API instead of commands**: Events API is for messages, not admin commands; no structured input parsing

### Key Implementation Notes
- Authorization check runs after `ack()`: look up `AdminUser` by `command.user_id` via the `slackUserId` field (new column on AdminUser)
- Role check: `VIEWER` gets read-only subcommands (`jobs`, `job`, `audit`, `usage`, `errors`, `workflows`, `workers`); `EDITOR` adds `cancel`; `ADMIN` adds `cache purge`, `config`
- File: `src/listeners/commands/admin.ts` with `registerAdminCommand(app: App)` following existing pattern
- Register in the command index file alongside other commands

## 2. AWS SDK v3 for ECS Operations

### Decision
Install `@aws-sdk/client-ecs` and use `ECSClient` with `RunTaskCommand`, `DescribeTasksCommand`, and `StopTaskCommand` for Infrastructure Maintenance Agent operations. Detect task failures by querying `DescribeTasksCommand` on a scheduled basis (polling) rather than subscribing to EventBridge events.

### Rationale
The project already uses AWS SDK v3 (`@aws-sdk/client-s3` v3.1001.0). Adding `@aws-sdk/client-ecs` follows the same modular client pattern. SDK v3 uses tree-shaking-friendly per-service packages and the `send(Command)` pattern.

Polling via `DescribeTasks` from a SCHEDULED Specialty (every 5 minutes) is simpler than setting up EventBridge rules and SQS/Lambda targets for ECS state change events. The Infrastructure Maintenance Agent already runs on a 5-minute cron; it can call `ListTasks` with `desiredStatus: 'STOPPED'` and then `DescribeTasks` to get stop reasons and exit codes. This avoids new infrastructure (EventBridge rules, SQS queue, IAM permissions for event targets).

ECS `RunTask` requires: cluster ARN, task definition ARN, network configuration (subnets, security groups, assign public IP). These can be read from the existing CloudFormation stack outputs or environment variables already available in the ECS container.

### Alternatives Considered
- **EventBridge + SQS for ECS state changes**: Real-time detection but requires new infra (EventBridge rule, SQS queue, IAM policy), additional Prisma/BullMQ consumer; overkill when 5-minute polling suffices
- **CloudWatch Alarms for task count**: Only alerts on task count thresholds, doesn't provide stop reason or exit code classification
- **AWS SDK v2**: Deprecated; project standardized on v3

### Key Implementation Notes
```typescript
import { ECSClient, RunTaskCommand, DescribeTasksCommand, ListTasksCommand } from '@aws-sdk/client-ecs';

const ecs = new ECSClient({ region: process.env.AWS_REGION });

// List recently stopped tasks
const stopped = await ecs.send(new ListTasksCommand({
  cluster: process.env.ECS_CLUSTER_ARN,
  desiredStatus: 'STOPPED',
}));

// Get stop reasons and exit codes
const details = await ecs.send(new DescribeTasksCommand({
  cluster: process.env.ECS_CLUSTER_ARN,
  tasks: stopped.taskArns,
}));

// Restart task with same definition
await ecs.send(new RunTaskCommand({
  cluster: process.env.ECS_CLUSTER_ARN,
  taskDefinition: failedTask.taskDefinitionArn,
  networkConfiguration: failedTask.attachments[0]?.details, // extract from failed task
  launchType: 'FARGATE',
}));
```
- `stoppedReason` field on task detail contains OOM/timeout/signal classification text
- Exit code in `containers[0].exitCode`: 137 = SIGKILL (OOM), 1 = application error, 0 = normal
- IAM task role needs `ecs:RunTask`, `ecs:DescribeTasks`, `ecs:ListTasks`, `ecs:StopTask` permissions

## 3. AWS CloudWatch Logs SDK — FilterLogEvents

### Decision
Install `@aws-sdk/client-cloudwatch-logs` and use `FilterLogEventsCommand` to read ECS container logs programmatically for the Root Cause Analyzer agent.

### Rationale
CloudWatch Logs is the existing log sink for ECS tasks (log group `/ecs/prod-slack-list-processor`). The `FilterLogEvents` API supports: time range filtering (`startTime`/`endTime` as epoch ms), pattern matching (`filterPattern` supports CloudWatch Insights syntax), and pagination via `nextToken`. This allows the Root Cause Analyzer to search for error patterns in the time window surrounding a detected anomaly.

The project logs structured JSON via the `logger` service (winston-based). Error logs include `level: 'error'`, `message`, `service`, `error` fields. The `filterPattern` can use `{ $.level = "error" }` for JSON field matching.

### Alternatives Considered
- **CloudWatch Logs Insights (StartQueryCommand/GetQueryResultsCommand)**: More powerful query language but async (poll for results); adds latency and complexity for simple pattern matching
- **Store logs in PostgreSQL**: Would duplicate CloudWatch storage; logs are already there and searchable
- **Export logs to S3 and parse**: High latency (hours for export); not suitable for near-real-time analysis

### Key Implementation Notes
```typescript
import { CloudWatchLogsClient, FilterLogEventsCommand } from '@aws-sdk/client-cloudwatch-logs';

const logs = new CloudWatchLogsClient({ region: process.env.AWS_REGION });

const response = await logs.send(new FilterLogEventsCommand({
  logGroupName: '/ecs/prod-slack-list-processor',
  startTime: Date.now() - (60 * 60 * 1000), // past 1 hour
  endTime: Date.now(),
  filterPattern: '{ $.level = "error" }',
  limit: 100,
}));

// response.events contains matching log entries with timestamp, message, logStreamName
```
- Pagination: if `response.nextToken` is set, send another request with `nextToken` to get remaining events
- `FilterLogEvents` scans in time order; limit of 10,000 events per call (API hard limit)
- IAM permission needed: `logs:FilterLogEvents` on the log group ARN
- For the Root Cause Analyzer, filter by time window from the anomaly detection (startTime = anomaly detection time minus 30 minutes)

## 4. GitHub Issue Creation — Octokit REST API

### Decision
Install `@octokit/rest` (not the full `octokit` meta-package) for creating GitHub issues from the Infrastructure Agent and Quality Monitor. Use personal access token (PAT) authentication stored as an environment variable.

### Rationale
The project repository is `github.com/developerlabsai/slack-list-processor`. Issue creation requires: `POST /repos/{owner}/{repo}/issues` with title, body, labels, and optional assignees. `@octokit/rest` is the official GitHub REST client, minimal footprint (~150KB), and provides typed methods. The project already uses the `developerlabsai` GitHub account.

A fine-grained PAT scoped to the single repository with `issues: write` permission is the simplest auth mechanism from an ECS container. No need for GitHub App installation flow.

### Alternatives Considered
- **`octokit` meta-package**: Includes GraphQL, webhooks, auth strategies; unnecessary bulk for issue creation only
- **Raw `fetch()` to GitHub API**: Works but loses TypeScript types, retry logic, and rate limit handling that Octokit provides
- **GitHub CLI (`gh issue create`)**: Requires `gh` binary installed in Docker image; not a Node.js API
- **GitHub App authentication**: More secure (no long-lived PAT) but requires app installation, JWT signing, and installation token exchange; overkill for a single repo

### Key Implementation Notes
```typescript
import { Octokit } from '@octokit/rest';

const octokit = new Octokit({ auth: process.env.GITHUB_PAT });

await octokit.issues.create({
  owner: 'developerlabsai',
  repo: 'slack-list-processor',
  title: `[Auto] ECS Task Failure: ${taskArn}`,
  body: `## Task Details\n- **ARN**: ${taskArn}\n- **Stop Reason**: ${stopReason}\n- **Exit Code**: ${exitCode}\n- **CloudWatch Logs**: ${logLink}\n\n## Agent Analysis\n${analysis}`,
  labels: ['infrastructure', 'auto-generated'],
});
```
- Environment variable: `GITHUB_PAT` with `repo` scope (or fine-grained with `issues: write`)
- Rate limit: 5,000 requests/hour for authenticated requests; more than sufficient
- Retry: Octokit has built-in retry via `@octokit/plugin-retry` (optional add-on if needed)

## 5. Statistical Testing Library — Campaign Optimizer A/B Testing

### Decision
Use `simple-statistics` for chi-square testing and statistical significance calculations. It provides `chiSquaredGoodnessOfFit` and basic statistical functions (mean, standard deviation, z-score) needed for time-of-day optimization and A/B test evaluation.

### Rationale
The Campaign Optimizer needs two statistical capabilities: (1) chi-square goodness-of-fit test for comparing response rates across time-of-day buckets, and (2) two-proportion z-test for A/B test winner determination at p<0.05.

`simple-statistics` is zero-dependency, TypeScript-friendly (ships `.d.ts`), actively maintained, and covers both needs. It provides `chiSquaredGoodnessOfFit` directly and the building blocks for two-proportion z-tests (normal CDF via `cumulativeStdNormalProbability`). Package size is ~40KB minified.

### Alternatives Considered
- **`jstat`**: More comprehensive (distributions, regression, ANOVA) but larger (~200KB), last npm publish was older, TypeScript types via DefinitelyTyped only
- **Custom implementation**: Chi-square and z-test formulas are straightforward (~50 lines each), but using a tested library avoids edge-case bugs in statistical computation
- **`scipy` via Python subprocess**: The project is Node.js/TypeScript only; shelling out to Python adds complexity and a runtime dependency

### Key Implementation Notes
```typescript
import { chiSquaredGoodnessOfFit, cumulativeStdNormalProbability } from 'simple-statistics';

// A/B test: two-proportion z-test
function abTestSignificance(
  conversionsA: number, samplesA: number,
  conversionsB: number, samplesB: number,
): { zScore: number; pValue: number; significant: boolean } {
  const pA = conversionsA / samplesA;
  const pB = conversionsB / samplesB;
  const pPool = (conversionsA + conversionsB) / (samplesA + samplesB);
  const se = Math.sqrt(pPool * (1 - pPool) * (1 / samplesA + 1 / samplesB));
  const z = (pA - pB) / se;
  const pValue = 2 * (1 - cumulativeStdNormalProbability(Math.abs(z)));
  return { zScore: z, pValue, significant: pValue < 0.05 };
}
```
- Minimum sample size per variant: 100 sends (per FR-050)
- Time-of-day optimization: group sends by hour bucket, chi-square test across buckets
- Confidence mapping: statistical p<0.05 maps to agent confidence >= 0.85 for auto-execution

## 6. String Similarity for CRM Conflicts

### Decision
Use `fastest-levenshtein` for edit distance computation combined with the existing `jaro-winkler` package (already in `package.json`) for name matching. Use Jaro-Winkler as primary similarity metric for company names and contact names; use Levenshtein distance as secondary metric for domain/email comparison.

### Rationale
The project already depends on `jaro-winkler` v0.2.8 (used for existing deduplication logic). Jaro-Winkler is optimal for short strings like company names and person names because it favors prefix matches ("Acme Inc" vs "Acme Inc." scores 0.97+). `fastest-levenshtein` is the fastest Levenshtein implementation on npm (benchmarked at 2-3x faster than alternatives), zero-dependency, and useful for domain/email exact-edit-distance comparisons.

The CRM Conflict Resolver's weighted feature scoring uses multiple similarity signals: email similarity (exact/Levenshtein), company name (Jaro-Winkler), phone match (exact), domain match (exact/normalized), title similarity (Jaro-Winkler). The final confidence score is a weighted sum of these features.

### Alternatives Considered
- **`string-similarity` (Dice coefficient)**: Dice works well for longer strings but underperforms Jaro-Winkler on short names; also less maintained
- **`fuzzball` (Python fuzzywuzzy port)**: Feature-rich (token sort ratio, partial ratio) but 5x larger than fastest-levenshtein, includes `difflib` port; overkill when Jaro-Winkler + Levenshtein cover the use case
- **`fastest-levenshtein` only (no Jaro-Winkler)**: Levenshtein alone does not handle prefix-matching well for company names ("Acme Corporation" vs "Acme Corp" gets penalized heavily)

### Key Implementation Notes
```typescript
import { distance as levenshtein } from 'fastest-levenshtein';
import jaroWinkler from 'jaro-winkler';

function conflictConfidence(local: Contact, remote: Contact): number {
  const weights = {
    email: 0.30,
    companyName: 0.25,
    domain: 0.20,
    phone: 0.15,
    title: 0.10,
  };

  const emailScore = local.email === remote.email ? 1.0
    : 1 - (levenshtein(local.email, remote.email) / Math.max(local.email.length, remote.email.length));
  const companyScore = jaroWinkler(normalize(local.company), normalize(remote.company));
  // ... weighted sum
  return Object.entries(weights).reduce((sum, [key, weight]) => sum + scores[key] * weight, 0);
}
```
- Normalize company names before comparison: strip "Inc", "LLC", "Corp", "Ltd", trailing periods, extra whitespace
- Threshold mapping: >= 0.85 auto-merge, 0.50-0.84 suggest, < 0.50 escalate (per FR-060)
- Learning loop: store admin approve/reject decisions in `ConflictDecision` table; adjust weights via gradient descent every 10 feedback events (per FR-056)

## 7. Scheduled Specialty Execution — BullMQ Repeatable Jobs

### Decision
Map the Feature 39 `SkillTriggerType.SCHEDULED` to BullMQ `upsertJobScheduler()` calls at application startup. Each PUBLISHED Specialty with `triggerType: SCHEDULED` gets a repeatable job registered on the `skill-execution` queue using the cron pattern from `triggerConfig.cronPattern`.

### Rationale
The project already registers repeatable jobs via `upsertJobScheduler()` in 7 places: `registerCampaignRepeatableJobs`, `registerAdminRepeatableJobs`, `registerRetentionRepeatableJobs`, `registerWorkflowRepeatableJobs`, `registerOnboardingRepeatableJobs`, `registerDialerCallbackRepeatableJobs`, `registerBillingRepeatableJobs`, and `registerPlatformRepeatableJobs`. The pattern is established: call `queue.upsertJobScheduler(schedulerId, { pattern: cronString }, { name, data })` at startup.

The `skillExecutionWorker.ts` already handles the case where `executionId` is not provided in job data (scheduled skills that don't have a pre-created execution record) -- it creates the `SkillExecution` record inline with `triggerType: 'SCHEDULED'`.

The missing piece is a startup function that queries all PUBLISHED Specialties with `triggerType: SCHEDULED` and registers their cron patterns as BullMQ job schedulers. This is identical to `syncOnboardingSchedulers()` which queries active enrollments and registers per-enrollment cron jobs.

### Alternatives Considered
- **Node-cron or cron package**: Would duplicate BullMQ's scheduler; BullMQ repeatable jobs already handle cron, persistence across restarts, and deduplication
- **AWS EventBridge Scheduler**: External to the application; adds AWS dependency and deployment complexity for something BullMQ handles natively
- **Manual registration per agent**: Hard-codes agent schedules; dynamic registration from database is more flexible for the admin dashboard to modify schedules

### Key Implementation Notes
```typescript
// New function in queues.ts
export async function syncScheduledSpecialties(): Promise<void> {
  const { prisma } = await import('../../models/index.js');
  const scheduled = await prisma.skill.findMany({
    where: { status: 'PUBLISHED', triggerType: 'SCHEDULED' },
    select: { id: true, name: true, triggerConfig: true },
  });

  for (const specialty of scheduled) {
    const config = specialty.triggerConfig as { cronPattern: string; timezone?: string } | null;
    if (!config?.cronPattern) continue;

    await skillExecutionQueue.upsertJobScheduler(
      `specialty-scheduled-${specialty.id}`,
      { pattern: config.cronPattern, tz: config.timezone },
      {
        name: 'skill-execution',
        data: {
          executionId: '', // Worker creates execution record
          skillId: specialty.id,
          slackTeamId: 'system', // System-initiated
        },
      },
    );
  }
  logger.info('Synced scheduled specialty jobs', { count: scheduled.length });
}
```
- Call `syncScheduledSpecialties()` at app startup alongside other `register*RepeatableJobs()` calls
- When admin updates a Specialty's cron via the dashboard, call `upsertJobScheduler()` again to update the schedule
- When a Specialty is DEPRECATED, call `skillExecutionQueue.removeJobScheduler()` to stop the repeatable job
- Agent schedules from spec: Infrastructure Maintenance (every 5 min), Rate Limit Manager (every 5 min), Anomaly Detector (hourly), Campaign Optimizer (daily)

## 8. Event-Driven Specialty Chaining — chainEventName

### Decision
Use the existing `publishChainEvent()` function in `skillExecutor.ts` (T034) for inter-agent triggering. The Quality Monitoring team's chain (Anomaly Detector -> Root Cause Analyzer -> Auto-Remediation Executor) maps directly to `chainEventName` on each Specialty.

### Rationale
The chain event mechanism is already built and deployed in `src/services/platform/skillExecutor.ts` (lines 274-322). When a Specialty completes and has a `chainEventName` set, `publishChainEvent()` queries for all PUBLISHED Specialties with `triggerType: EVENT` where `triggerConfig.eventName` matches the chain event name, creates `SkillExecution` records, and enqueues them on the `skill-execution` queue.

The Quality Monitoring chain maps as follows:
1. **Anomaly Detector** (SCHEDULED, hourly): `chainEventName: "anomaly.detected"` -- publishes when anomaly found
2. **Root Cause Analyzer** (EVENT): `triggerConfig: { eventName: "anomaly.detected" }`, `chainEventName: "rootcause.classified"` -- publishes classification result
3. **Auto-Remediation Executor** (EVENT): `triggerConfig: { eventName: "rootcause.classified" }` -- terminal node, no chain event

The chain payload flows through `{ chainEvent: eventName, payload: agentOutput }` in the `input` field of each downstream SkillExecution. Each agent in the chain receives the previous agent's output as its input.

### Alternatives Considered
- **Direct BullMQ job creation (bypassing platform)**: Loses credit tracking, execution tracing, and spend limit enforcement
- **Redis Pub/Sub for event propagation**: Loses at-least-once delivery guarantee; BullMQ queue is already persistent
- **Dedicated event bus (EventEmitter or custom)**: Would not persist across process restarts; BullMQ jobs survive container replacement

### Key Implementation Notes
- No new code needed for the chaining mechanism itself; it is already implemented
- Specialty seed data must set `chainEventName` and `triggerConfig.eventName` correctly for each agent in the chain
- The CRM Conflict Resolver uses a different pattern: `triggerType: EVENT` with `triggerConfig.eventName: "hubspot.sync.conflict"` -- the `hubspotImportWorker` needs to publish this event when it detects a conflict
- Event publication from non-platform code (e.g., `hubspotImportWorker`) requires calling `publishChainEvent()` or directly enqueuing a skill-execution job with the event payload
- Chain depth is unlimited but each step is independent (own credit deduction, own execution record)

## 9. Suggest-Only Mode Implementation — Approval Gate Pattern

### Decision
Implement suggest-only mode as a database-driven flag on the Agent record (`suggestOnly: boolean`) combined with a `PendingAction` table. When `suggestOnly` is true, the agent outputs its decision but does NOT execute it. Instead, a `PendingAction` record is created and a Slack notification with Approve/Reject buttons is sent to the admin channel. The `app.action()` handler for approval resumes execution; rejection discards it.

### Rationale
The project already has multiple approve/reject button patterns in Slack action handlers: `graduationReview.ts` (approve/extend/reject graduation), `hubspotImport.ts` (approve/reject import), `creditPreview.ts` (confirm/cancel purchase). The pattern is established: post a Slack message with interactive buttons, each button's `action_id` maps to an `app.action()` handler that processes the decision.

The key insight is that suggest-only mode does NOT pause a running execution mid-pipeline. Instead, the agent completes its analysis phase (produces decision + confidence), but the execution phase is gated. The `skillExecutor.ts` checks the `suggestOnly` flag after agent invocation: if true and confidence < auto-execute threshold, it creates the PendingAction and marks the SkillExecution as `AWAITING_APPROVAL` (new status). When the admin clicks Approve, a new skill execution job is enqueued to perform the actual action.

### Alternatives Considered
- **BullMQ delayed job with approval trigger**: Overcomplicated; would need custom event system to "release" a delayed job
- **Pause/resume execution via Redis lock**: Fragile; process restarts lose the paused state
- **Two-phase execution (analyze separately, then execute)**: This IS the chosen approach, just described more precisely -- the agent invocation is phase 1 (produces recommendation), the action execution is phase 2 (triggered by approval)
- **Slack modal for approval details**: Buttons are simpler and support mobile; modals require the user to be on desktop Slack

### Key Implementation Notes
```typescript
// In skillExecutor.ts, after agent invocation:
if (agent.suggestOnly && agentResult.confidence < AUTO_EXECUTE_THRESHOLD) {
  const pending = await prisma.pendingAction.create({
    data: {
      agentName: agent.name,
      action: agentResult.recommendedAction,
      confidence: agentResult.confidence,
      metadata: agentResult.output,
      specialtyExecutionId: input.executionId,
      status: 'PENDING',
    },
  });

  // Post Slack notification with Approve/Reject buttons
  await slackClient.chat.postMessage({
    channel: ADMIN_CHANNEL_ID,
    blocks: buildApprovalBlocks(pending, agent, agentResult),
  });

  await markExecution(input.executionId, 'AWAITING_APPROVAL', agentResult.output, 0, durationMs);
  return; // Do not execute action
}
```
- New `SkillExecutionStatus` value: `AWAITING_APPROVAL`
- New table: `PendingAction` (id, agentName, action, confidence, metadata, specialtyExecutionId, status, reviewedBy, reviewedAt, createdAt)
- Button action IDs: `agent_action_approve_{pendingActionId}`, `agent_action_reject_{pendingActionId}`
- On approve: create new SkillExecution to perform the actual action (e.g., restart ECS task, merge CRM records)
- On reject: update PendingAction status to REJECTED, mark original SkillExecution as CANCELLED
- Track approval/rejection counts per agent for auto-execute threshold calculation (FR-064a)

## 10. Confidence-Based Execution Framework

### Decision
Agents output a structured response containing `{ confidence: number, action: string, rationale: string, data: any }`. The skill executor reads the confidence score and branches:
- `confidence >= 0.85`: Auto-execute the action (if not in suggest-only mode)
- `0.50 <= confidence < 0.85`: Create PendingAction and suggest to admin
- `confidence < 0.50`: Escalate (create GitHub issue or admin notification, do not execute)

### Rationale
The three-tier confidence model (auto / suggest / escalate) is defined in FR-060 and maps to all 5 autonomous agents. The confidence score is the agent's self-assessed certainty about its recommended action. This is NOT a separate ML model -- the LLM agent produces the confidence score as part of its structured output via the `outputSchema` defined in the Agent record.

The Anthropic SDK already supports structured output via tool use. Each agent's system prompt instructs it to return a JSON object with `confidence` as a required field. The `agentInvoker.ts` validates the output against the agent's `outputSchema` (from AgentVersion).

The thresholds (0.85, 0.50) are configurable per agent via the `agentConfig` table or Agent metadata, allowing tuning as the system learns. For example, if an agent consistently gets rejections at 0.85, the threshold can be raised to 0.90.

### Alternatives Considered
- **Binary auto/manual only (no suggest tier)**: Loses the valuable middle ground where agents can propose actions for admin review; reduces learning opportunities
- **Separate confidence model (ML classifier on top of agent output)**: Adds complexity; the LLM is already calibrated to express uncertainty in its responses
- **Fixed thresholds with no per-agent tuning**: Would not accommodate agents with different risk profiles (infrastructure restart vs CRM merge have different risk tolerances)
- **Confidence from token probabilities (logprobs)**: Anthropic API does not expose token-level logprobs; confidence must be an explicit output field

### Key Implementation Notes
```typescript
// Agent output schema (defined in AgentVersion.outputSchema)
const autonomousAgentOutputSchema = {
  type: 'object',
  required: ['confidence', 'action', 'rationale'],
  properties: {
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    action: { type: 'string', enum: ['restart_task', 'create_issue', 'adjust_concurrency', 'merge_records', 'no_action'] },
    rationale: { type: 'string' },
    data: { type: 'object' }, // Action-specific payload
  },
};

// In skillExecutor.ts execution pipeline
const AUTO_THRESHOLD = agent.metadata?.autoThreshold ?? 0.85;
const SUGGEST_THRESHOLD = agent.metadata?.suggestThreshold ?? 0.50;

if (output.confidence >= AUTO_THRESHOLD && !agent.suggestOnly) {
  await performAction(output.action, output.data);
} else if (output.confidence >= SUGGEST_THRESHOLD) {
  await createPendingAction(output, executionId);
} else {
  await escalateToHuman(output, executionId);
}
```
- Confidence is recorded in both `AgentInvocation.output` (raw) and `AuditAction.confidence` (denormalized for querying)
- The `/admin audit` command displays confidence scores in the audit trail
- Auto-execute transition (FR-064a): when an agent in suggest-only mode accumulates 50+ reviewed actions with >= 90% approval rate, system sets `suggestOnly = false` and notifies admin
- Per-agent threshold override: stored in Agent metadata JSON field, editable via admin dashboard
