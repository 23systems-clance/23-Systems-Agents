# Data Model: Autonomous Agents with Slack Admin Interface

**Feature**: 31-autonomous-agents-slack
**Date**: 2026-03-20
**Depends On**: Feature 39 (Vertical Pack Platform) models

## New Enums

```prisma
// ---------------------------------------------------------------------------
// Autonomous Agents Enums (Feature 31)
// ---------------------------------------------------------------------------

enum TeamStatus {
  ACTIVE
  INACTIVE
}

// Shared severity enum used by AuditAction and SystemEvent
enum Severity {
  INFO
  WARNING
  HIGH
  CRITICAL
}

enum AuditOutcome {
  AUTO_EXECUTED
  SUGGESTED
  APPROVED
  REJECTED
  ESCALATED
}

enum ConflictOutcome {
  AUTO_MERGED
  APPROVED
  REJECTED
  ESCALATED
}

enum PendingActionStatus {
  PENDING
  APPROVED
  REJECTED
  EXPIRED
}
```

## Extended Existing Models

### AdminUser (add field)

Link Slack user IDs to admin accounts for `/admin` command authorization (FR-002, FR-003).

```prisma
// Add to existing AdminUser model:
slackUserId  String?  @unique @map("slack_user_id")
```

The current AdminUser model in the schema:

```prisma
model AdminUser {
  id           String    @id @default(uuid()) @db.Uuid
  name         String
  email        String    @unique
  username     String?   @unique
  passwordHash String?   @map("password_hash")
  apiKeyHash   String?   @unique @map("api_key_hash")
  role         AdminRole @default(VIEWER)
  isActive     Boolean   @default(true) @map("is_active")
  createdAt    DateTime  @default(now()) @map("created_at")
  updatedAt    DateTime  @updatedAt @map("updated_at")

  // Existing relations omitted for brevity

  // NEW field
  slackUserId  String?   @unique @map("slack_user_id")

  // NEW relations (Feature 31)
  auditActions       AuditAction[]
  conflictDecisions  ConflictDecision[]

  @@map("admin_users")
}
```

**Note**: The `AdminRole` enum currently defines `ADMIN` and `VIEWER`. The spec references an `EDITOR` role (FR-004) for mid-tier access (can cancel jobs but not purge cache). This requires adding `EDITOR` to the `AdminRole` enum:

```prisma
enum AdminRole {
  ADMIN
  EDITOR   // NEW - can cancel jobs, view audit trail
  VIEWER
}
```

### Agent (add fields)

Extend the existing Agent model (Feature 39) with autonomous agent metadata for suggest-only mode gating and operational tracking (FR-062, FR-064, FR-064a, FR-064b).

```prisma
// Add to existing Agent model:
suggestOnlyMode       Boolean   @default(true) @map("suggest_only_mode")
suggestOnlyApprovals  Int       @default(0) @map("suggest_only_approvals")
suggestOnlyRejections Int       @default(0) @map("suggest_only_rejections")
lastRunAt             DateTime? @map("last_run_at")
actionsToday          Int       @default(0) @map("actions_today")

// NEW relations (Feature 31)
teamAgents            TeamAgent[]
```

**Suggest-only mode logic**: When `suggestOnlyMode = true`, all agent actions with confidence >= 0.85 are recorded as `SUGGESTED` (not `AUTO_EXECUTED`) and require admin approval. The agent transitions to `suggestOnlyMode = false` when `suggestOnlyApprovals >= 45` out of `suggestOnlyApprovals + suggestOnlyRejections >= 50` (i.e., >= 90% approval rate over 50+ actions). See [State Transitions](#state-transitions) section.

## Extended Existing Enums

### SkillExecutionStatus (add value)

Add a new status for suggest-only mode gating. When an autonomous agent produces a recommendation but is in suggest-only mode, the execution is marked as awaiting admin review (FR-064, research.md §9).

```prisma
// Add to existing SkillExecutionStatus enum:
AWAITING_APPROVAL   // NEW - execution paused pending admin Approve/Reject
```

## New Models

### PendingAction

Represents an autonomous agent's recommended action awaiting admin approval. Created when an agent in suggest-only mode produces a recommendation with confidence >= 0.50. The admin approves or rejects via Slack buttons or the admin dashboard (research.md §9, FR-064).

```prisma
model PendingAction {
  id                    String              @id @default(uuid()) @db.Uuid
  agentName             String              @map("agent_name")
  action                String                                         // Recommended action (e.g., "restart_task", "merge_records")
  confidence            Float
  metadata              Json                @db.JsonB                  // Action-specific payload (task ARN, contact details, etc.)
  specialtyExecutionId  String?             @map("specialty_execution_id") @db.Uuid
  status                PendingActionStatus @default(PENDING)
  reviewedBy            String?             @map("reviewed_by")        // Admin Slack user ID or email
  reviewedAt            DateTime?           @map("reviewed_at")
  createdAt             DateTime            @default(now()) @map("created_at")

  // Relations
  specialtyExecution    SkillExecution?     @relation(fields: [specialtyExecutionId], references: [id])

  @@index([status, createdAt])
  @@index([agentName, status])
  @@map("pending_actions")
}
```

**Lifecycle**: PENDING → APPROVED (admin clicks Approve → action executes) or REJECTED (admin clicks Reject → action discarded) or EXPIRED (TTL exceeded without review). See [State Transitions](#pending-action-lifecycle) section.

### Team

A named group of collaborating agents (also referred to as "Cluster"). Agents within a Team coordinate on a shared domain via chained Specialty events (FR-032a).

Example: The "Quality Monitoring" Team contains the Anomaly Detector, Root Cause Analyzer, and Auto-Remediation Executor agents.

```prisma
model Team {
  id          String     @id @default(uuid()) @db.Uuid
  name        String
  slug        String     @unique
  description String?    @db.Text
  status      TeamStatus @default(ACTIVE)
  createdAt   DateTime   @default(now()) @map("created_at")
  updatedAt   DateTime   @updatedAt @map("updated_at")

  // Relations
  teamAgents  TeamAgent[]

  @@index([status])
  @@map("teams")
}
```

### TeamAgent

Many-to-many junction between Teams and Agents. Includes sort order for defining agent sequence within a Team (e.g., Anomaly Detector runs before Root Cause Analyzer).

```prisma
model TeamAgent {
  id        String @id @default(uuid()) @db.Uuid
  teamId    String @map("team_id") @db.Uuid
  agentId   String @map("agent_id") @db.Uuid
  sortOrder Int    @default(0) @map("sort_order")

  // Relations
  team  Team  @relation(fields: [teamId], references: [id], onDelete: Cascade)
  agent Agent @relation(fields: [agentId], references: [id], onDelete: Cascade)

  @@unique([teamId, agentId])
  @@index([teamId])
  @@index([agentId])
  @@map("team_agents")
}
```

### AuditAction

Database audit trail for all autonomous agent actions. Every action taken by an autonomous agent -- whether auto-executed, suggested, approved, rejected, or escalated -- is recorded here (FR-021, FR-029, FR-036, FR-059, FR-061).

```prisma
model AuditAction {
  id                    String              @id @default(uuid()) @db.Uuid
  agentName             String              @map("agent_name")
  action                String                                         // e.g., "ecs_task_restart", "concurrency_update", "github_issue_created"
  confidence            Float
  severity              Severity
  metadata              Json                @db.JsonB                  // Action-specific data (task ARN, before/after values, etc.)
  specialtyExecutionId  String?             @map("specialty_execution_id") @db.Uuid
  outcome               AuditOutcome
  adminUserId           String?             @map("admin_user_id") @db.Uuid  // Set when admin approves/rejects
  timestamp             DateTime            @default(now())

  // Relations
  specialtyExecution    SkillExecution?     @relation(fields: [specialtyExecutionId], references: [id])
  adminUser             AdminUser?          @relation(fields: [adminUserId], references: [id])

  @@index([agentName, timestamp])
  @@index([timestamp])
  @@index([outcome, timestamp])
  @@index([severity, timestamp])
  @@map("audit_actions")
}
```

**Note on naming**: The `specialtyExecutionId` references the `SkillExecution` model (which is being renamed to `SpecialtyExecution` at the application layer; the database table remains `skill_executions` per Feature 39).

### WorkerConfig

Stores per-worker concurrency settings managed by the API Rate Limit Manager Agent (FR-027). Each worker type (e.g., `technographic-worker`, `contact-worker`) has an independent concurrency configuration.

```prisma
model WorkerConfig {
  id          String   @id @default(uuid()) @db.Uuid
  workerName  String   @unique @map("worker_name")
  concurrency Int
  updatedAt   DateTime @updatedAt @map("updated_at")
  updatedBy   String   @map("updated_by")              // Agent name or admin email
  reason      String   @db.Text                         // Rationale for the change (e.g., "Quota at 92%, pausing worker")

  @@index([workerName])
  @@map("worker_configs")
}
```

### SystemEvent

Log of system-level events generated by autonomous agents for visibility in the admin dashboard (FR-022, FR-030, FR-041). Supports acknowledgment workflow for admins to mark events as reviewed.

```prisma
model SystemEvent {
  id             String        @id @default(uuid()) @db.Uuid
  type           String                                            // e.g., "infrastructure_auto_heal", "worker_config_update", "quality_auto_remediation"
  severity       Severity
  message        String        @db.Text
  metadata       Json          @db.JsonB                           // Event-specific details (task ARN, quota %, affected jobs, etc.)
  agentName      String?       @map("agent_name")
  acknowledged   Boolean       @default(false)
  acknowledgedBy String?       @map("acknowledged_by")             // Admin email or user ID
  acknowledgedAt DateTime?     @map("acknowledged_at")
  timestamp      DateTime      @default(now())

  @@index([type, timestamp])
  @@index([severity, timestamp])
  @@index([acknowledged, timestamp])
  @@map("system_events")
}
```

### CampaignMetrics

Aggregated campaign performance data used by the Campaign Optimization Agent to determine optimal send times and A/B test results (FR-043, FR-044, FR-046).

```prisma
model CampaignMetrics {
  id           String   @id @default(uuid()) @db.Uuid
  campaignId   String   @map("campaign_id")
  sendHour     Int                                          // 0-23, hour of day (UTC)
  openRate     Float    @map("open_rate")
  responseRate Float    @map("response_rate")
  sendCount    Int      @map("send_count")
  abTestVariant String? @map("ab_test_variant")             // "A" or "B", null if not in A/B test
  lastUpdated  DateTime @updatedAt @map("last_updated")

  @@unique([campaignId, sendHour, abTestVariant])
  @@index([campaignId])
  @@map("campaign_metrics")
}
```

### ConflictDecision

Records CRM conflict resolution decisions made by the CRM Conflict Resolver Agent, including admin feedback used for supervised learning to improve confidence scoring (FR-056, FR-059).

```prisma
model ConflictDecision {
  id          String          @id @default(uuid()) @db.Uuid
  conflictId  String          @map("conflict_id")              // Reference to the HubSpot conflict record
  confidence  Float
  features    Json            @db.JsonB                        // Similarity scores used: { emailSimilarity, companyEditDistance, phoneMatch, domainMatch, titleSimilarity }
  outcome     ConflictOutcome
  adminUserId String?         @map("admin_user_id") @db.Uuid  // Set when admin approves/rejects
  metadata    Json?           @db.JsonB                        // Contact details, merge result, etc.
  timestamp   DateTime        @default(now())

  // Relations
  adminUser   AdminUser?      @relation(fields: [adminUserId], references: [id])

  @@index([outcome, timestamp])
  @@index([conflictId])
  @@map("conflict_decisions")
}
```

## Entity Relationships

```
EXISTING (Feature 39) ─────────────────────────────────────────────

Agent 1──* AgentVersion
Agent 1──* Skill (Specialty)
AgentVersion 1──* Skill (pinned version)
AgentVersion 1──* AgentInvocation
Skill (Specialty) 1──* SkillExecution (SpecialtyExecution)
SkillExecution 1──* AgentInvocation

NEW (Feature 31) ──────────────────────────────────────────────────

Team 1──* TeamAgent *──1 Agent
  (A Team groups multiple Agents; an Agent can belong to multiple Teams)

Agent ──── suggestOnlyMode, suggestOnlyApprovals, suggestOnlyRejections
  (Extended fields for autonomous agent gating)

AdminUser ──── slackUserId
  (Extended field for Slack command authorization)

AuditAction *──1 SkillExecution (SpecialtyExecution)  [optional]
AuditAction *──1 AdminUser                            [optional, for approvals/rejections]

ConflictDecision *──1 AdminUser                       [optional, for approvals/rejections]

PendingAction *──1 SkillExecution (SpecialtyExecution)  [optional]

WorkerConfig (standalone, no FK relations)
SystemEvent  (standalone, no FK relations)
CampaignMetrics (standalone, no FK relations)

CROSS-FEATURE REFERENCES ──────────────────────────────────────────

AuditAction.specialtyExecutionId → SkillExecution.id (Feature 39)
Agent.suggestOnlyMode fields → Agent model (Feature 39)
AdminUser.slackUserId → AdminUser model (Feature 3)
```

### Visual Diagram

```
┌──────────────────────────────────────────────────────────────────┐
│                        TEAM LAYER                                │
│                                                                  │
│  ┌──────────┐     ┌───────────┐     ┌──────────┐                │
│  │   Team   │──*──│ TeamAgent │──*──│  Agent   │                │
│  │          │     │ (junction)│     │(Feature39│                │
│  │ name     │     │ sortOrder │     │+new flds)│                │
│  │ slug     │     └───────────┘     │          │                │
│  │ status   │                       │ suggest- │                │
│  └──────────┘                       │ OnlyMode │                │
│                                     │ lastRunAt│                │
│                                     └────┬─────┘                │
│                                          │                       │
│                                          │ 1..* (via Feature 39) │
│                                          ▼                       │
│                                   ┌──────────────┐              │
│                                   │    Skill     │              │
│                                   │ (Specialty)  │              │
│                                   │ triggerType:  │              │
│                                   │  SCHEDULED/  │              │
│                                   │  EVENT       │              │
│                                   └──────┬───────┘              │
│                                          │ 1..*                  │
│                                          ▼                       │
│                                   ┌──────────────┐              │
│                                   │SkillExecution│              │
│                                   │(SpecialtyExec│              │
│                                   │   ution)     │              │
│                                   └──────┬───────┘              │
└──────────────────────────────────────────│────────────────────────┘
                                           │
           ┌───────────────────────────────┤
           │                               │
           ▼                               ▼
    ┌──────────────┐               ┌──────────────────┐
    │AgentInvocation│              │   AuditAction    │
    │ (Feature 39) │               │                  │
    │ tokens, cost │               │ agentName        │
    │ duration     │               │ action           │
    └──────────────┘               │ confidence       │
                                   │ severity         │
                                   │ outcome          │
                                   │ metadata (JSON)  │
                                   └────────┬─────────┘
                                            │ *..1 (optional)
                                            ▼
                                     ┌─────────────┐
                                     │  AdminUser  │
                                     │ (extended)  │
                                     │             │
                                     │ + slackUserId│
                                     └──────┬──────┘
                                            │ *..1 (optional)
                                            ▼
                                   ┌──────────────────┐
                                   │ConflictDecision  │
                                   │                  │
                                   │ conflictId       │
                                   │ confidence       │
                                   │ features (JSON)  │
                                   │ outcome          │
                                   └──────────────────┘

    ┌──────────────┐     ┌──────────────┐     ┌──────────────────┐
    │ WorkerConfig │     │ SystemEvent  │     │ CampaignMetrics  │
    │              │     │              │     │                  │
    │ workerName   │     │ type         │     │ campaignId       │
    │ concurrency  │     │ severity     │     │ sendHour         │
    │ updatedBy    │     │ message      │     │ openRate         │
    │ reason       │     │ agentName    │     │ responseRate     │
    │              │     │ acknowledged │     │ sendCount        │
    └──────────────┘     └──────────────┘     │ abTestVariant    │
                                              └──────────────────┘
```

## State Transitions

### Agent Suggest-Only Mode

Controls whether an autonomous agent auto-executes actions or requires admin approval.

```
SUGGEST_ONLY (suggestOnlyMode = true)
    │
    │  Agent takes action with confidence >= 0.85
    │  → Records AuditAction with outcome = SUGGESTED
    │  → Notifies admin via Slack with Approve/Reject buttons
    │
    ├── Admin clicks "Approve"
    │   → AuditAction.outcome updated to APPROVED
    │   → Agent.suggestOnlyApprovals incremented
    │   → Action executed
    │
    ├── Admin clicks "Reject"
    │   → AuditAction.outcome updated to REJECTED
    │   → Agent.suggestOnlyRejections incremented
    │   → Action NOT executed
    │
    │  [Evaluation after each approval/rejection]:
    │  totalReviewed = suggestOnlyApprovals + suggestOnlyRejections
    │  approvalRate = suggestOnlyApprovals / totalReviewed
    │
    │  IF totalReviewed >= 50 AND approvalRate >= 0.90:
    │
    ▼
AUTO_EXECUTE (suggestOnlyMode = false)
    │
    │  Agent takes action with confidence >= 0.85
    │  → Records AuditAction with outcome = AUTO_EXECUTED
    │  → Action executed immediately
    │  → Admin notified via SystemEvent (no approval required)
    │
    │  [Revert condition]:
    │  IF admin rejection rate exceeds 30% over last 100 decisions
    │  (tracked per agent via rolling window on AuditAction records):
    │
    ▼
SUGGEST_ONLY (suggestOnlyMode = true, counters reset)
```

### AuditAction Outcome Flow

```
Agent evaluates action
    │
    ├── confidence >= 0.85 AND suggestOnlyMode = false
    │   → outcome = AUTO_EXECUTED (action runs immediately)
    │
    ├── confidence >= 0.85 AND suggestOnlyMode = true
    │   → outcome = SUGGESTED (awaits admin review)
    │   ├── Admin approves → outcome = APPROVED
    │   └── Admin rejects  → outcome = REJECTED
    │
    ├── confidence 0.50 - 0.84
    │   → outcome = SUGGESTED (always requires admin review)
    │   ├── Admin approves → outcome = APPROVED
    │   └── Admin rejects  → outcome = REJECTED
    │
    └── confidence < 0.50
        → outcome = ESCALATED (human intervention required)
```

### PendingAction Lifecycle

Controls the lifecycle of a suggested action awaiting admin review.

```
PENDING (status = PENDING)
    │
    ├── Admin clicks "Approve" (via Slack button or dashboard)
    │   → status = APPROVED
    │   → reviewedBy = admin Slack user ID
    │   → reviewedAt = now()
    │   → New SkillExecution enqueued to perform the action
    │   → Agent.suggestOnlyApprovals incremented
    │
    ├── Admin clicks "Reject" (via Slack button or dashboard)
    │   → status = REJECTED
    │   → reviewedBy = admin Slack user ID
    │   → reviewedAt = now()
    │   → Original SkillExecution marked as CANCELLED
    │   → Agent.suggestOnlyRejections incremented
    │
    └── TTL exceeded (no admin review within configurable window)
        → status = EXPIRED
        → Original SkillExecution marked as CANCELLED
```

### SystemEvent Acknowledgment

```
UNACKNOWLEDGED (acknowledged = false)
    │
    │  Admin reviews event in dashboard or via /admin command
    │
    ▼
ACKNOWLEDGED (acknowledged = true, acknowledgedBy set, acknowledgedAt set)
```

### ConflictDecision Outcome Flow

```
CRM Conflict Resolver evaluates conflict
    │
    ├── confidence >= 0.85 AND suggestOnlyMode = false
    │   → outcome = AUTO_MERGED (records merged automatically)
    │
    ├── confidence 0.50 - 0.84
    │   → Slack notification with Approve/Reject buttons
    │   ├── Admin approves → outcome = APPROVED (merge executed)
    │   └── Admin rejects  → outcome = REJECTED (no merge)
    │
    └── confidence < 0.50
        → outcome = ESCALATED (full manual review required)
```

## Indexes and Performance Considerations

### Query Patterns

| Query | Table | Index Used |
|-------|-------|------------|
| `/admin audit 24` (recent agent actions) | AuditAction | `@@index([timestamp])` |
| Audit by agent name + time range | AuditAction | `@@index([agentName, timestamp])` |
| Filter audit by outcome | AuditAction | `@@index([outcome, timestamp])` |
| Filter audit by severity | AuditAction | `@@index([severity, timestamp])` |
| Dashboard unacknowledged events | SystemEvent | `@@index([acknowledged, timestamp])` |
| Events by type | SystemEvent | `@@index([type, timestamp])` |
| Events by severity | SystemEvent | `@@index([severity, timestamp])` |
| Worker config lookup | WorkerConfig | `@@index([workerName])` (unique) |
| Campaign metrics by campaign | CampaignMetrics | `@@index([campaignId])` |
| Conflict decisions by outcome | ConflictDecision | `@@index([outcome, timestamp])` |
| Active teams | Team | `@@index([status])` |

### Data Volume Estimates

| Table | Growth Rate | Retention |
|-------|-------------|-----------|
| AuditAction | ~50-200 rows/day (across all agents) | Permanent |
| SystemEvent | ~10-50 rows/day | Permanent |
| WorkerConfig | ~5-20 updates/day (upserts, not inserts) | Current state only (single row per worker) |
| CampaignMetrics | ~24 rows/campaign/day (one per hour) | Rolling 90-day window |
| ConflictDecision | ~5-20 rows/day | Permanent |
| TeamAgent | Static (changes only when teams are reconfigured) | Permanent |
| PendingAction | ~10-50 rows/day (most resolved within hours) | Permanent (historical record) |
| Team | Static (handful of teams) | Permanent |

## Migration Notes

### Prisma Migration Steps

1. Add new enums: `TeamStatus`, `Severity` (shared by AuditAction and SystemEvent), `AuditOutcome`, `ConflictOutcome`, `PendingActionStatus`
1a. Add `AWAITING_APPROVAL` value to existing `SkillExecutionStatus` enum
2. Add `EDITOR` value to existing `AdminRole` enum
3. Add `slackUserId` field to `AdminUser` model
4. Add `suggestOnlyMode`, `suggestOnlyApprovals`, `suggestOnlyRejections`, `lastRunAt`, `actionsToday` fields to `Agent` model
5. Create `Team` table
6. Create `TeamAgent` junction table
7. Create `AuditAction` table
8. Create `WorkerConfig` table
9. Create `SystemEvent` table
10. Create `CampaignMetrics` table
11. Create `ConflictDecision` table
12. Create `PendingAction` table

### Backward Compatibility

- All new fields on existing models use `@default()` values, so existing rows are unaffected
- `slackUserId` is nullable (`String?`), so existing AdminUser records do not require updates
- `suggestOnlyMode` defaults to `true`, so all existing agents start in suggest-only mode (safe default)
- `actionsToday` defaults to `0` and is reset daily by a scheduled job
- The new `EDITOR` role value in `AdminRole` does not affect existing `ADMIN` and `VIEWER` records

### Seed Data

The following Teams and TeamAgents should be seeded after migration:

```
Team: "Quality Monitoring" (slug: "quality-monitoring")
  └── TeamAgent: Anomaly Detector (sortOrder: 0)
  └── TeamAgent: Root Cause Analyzer (sortOrder: 1)
  └── TeamAgent: Auto-Remediation Executor (sortOrder: 2)
```

All other agents (Infrastructure Maintenance, API Rate Limit Manager, Campaign Optimizer, CRM Conflict Resolver) operate independently and do not require Team assignment.
