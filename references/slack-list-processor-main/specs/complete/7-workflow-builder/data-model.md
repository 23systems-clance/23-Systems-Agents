# Data Model: Visual Workflow Builder

**Feature**: 7-workflow-builder
**Date**: 2026-03-08

## Entity Relationship Diagram

```
WorkflowTemplate 1──* WorkflowVersion 1──* WorkflowExecution
```

## Entities

### WorkflowTemplate

The top-level workflow entity representing a named workflow "blueprint." Owns all versions.

| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| id | UUID | PK, auto-generated | |
| slackTeamId | String | Required, indexed | Tenant isolation |
| name | String | Required | Display name |
| description | String? | Optional, Text | |
| triggerType | WorkflowTriggerType | Required | `FILE_UPLOAD`, `KEYWORD`, `SLASH_COMMAND`, `MANUAL` |
| isActive | Boolean | Default false | Whether a published version exists |
| createdByUserId | String | Required | Slack user ID of creator |
| createdAt | DateTime | auto | |
| updatedAt | DateTime | auto | |

**Unique Constraints**: `(slackTeamId, triggerType)` when `isActive = true` (enforced in application logic, not DB — because only one active workflow per trigger type)

**Indexes**: `(slackTeamId)`, `(slackTeamId, triggerType)`

### WorkflowVersion

A point-in-time snapshot of a workflow's graph configuration. Each edit+publish creates a new version.

| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| id | UUID | PK, auto-generated | |
| templateId | UUID | FK → WorkflowTemplate | |
| version | Int | Required, default 1 | Incremented per publish |
| status | WorkflowVersionStatus | Required | `DRAFT`, `PUBLISHED`, `ARCHIVED` |
| graph | Json (JSONB) | Required | Full `{ nodes, edges, viewport }` |
| publishedAt | DateTime? | Set on publish | |
| publishedByUserId | String? | Slack user ID | |
| createdAt | DateTime | auto | |
| updatedAt | DateTime | auto | |

**Unique Constraints**: `(templateId, version)`

**Indexes**: `(templateId, status)`, `(templateId, version)`

**Graph JSON Schema**:
```typescript
interface WorkflowGraph {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  viewport?: { x: number; y: number; zoom: number };
}

interface WorkflowNode {
  id: string;
  type: WorkflowNodeType;
  label: string;
  position: { x: number; y: number };
  config: NodeConfig;
}

interface WorkflowEdge {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
  sourceHandle?: string;
  condition?: EdgeCondition;
  label?: string;
}
```

### WorkflowExecution

A single run of a workflow by a Slack user. Pinned to a specific version via FK.

| Field | Type | Constraints | Notes |
|-------|------|-------------|-------|
| id | UUID | PK, auto-generated | |
| versionId | UUID | FK → WorkflowVersion | Pinned to the version that was active at start |
| slackTeamId | String | Required | |
| slackUserId | String | Required | |
| slackChannelId | String | Required | |
| slackThreadTs | String? | Optional | Thread timestamp |
| status | WorkflowExecutionStatus | Required | See state machine below |
| currentNodeId | String? | Nullable | null when completed |
| context | Json (JSONB) | Default `{}` | Accumulated data from user inputs |
| nodeHistory | Json (JSONB) | Default `[]` | Array of `NodeHistoryEntry` |
| errorMessage | String? | Text | |
| expiresAt | DateTime | Required | Set to now + 1 hour on creation |
| startedAt | DateTime | auto | |
| completedAt | DateTime? | Set on completion | |
| createdAt | DateTime | auto | |
| updatedAt | DateTime | auto | |

**Indexes**: `(slackTeamId, slackUserId)`, `(slackChannelId, slackThreadTs)`, `(status)`, `(expiresAt)`, `(versionId)`

**Node History Entry**:
```typescript
interface NodeHistoryEntry {
  nodeId: string;
  nodeType: string;
  enteredAt: string;   // ISO timestamp
  exitedAt?: string;   // ISO timestamp
  output?: unknown;    // Node-specific output data
  userInput?: unknown; // User interaction data (button value, form data)
}
```

## Enums

### WorkflowTriggerType
```
FILE_UPLOAD    — Triggered when a file is uploaded
KEYWORD        — Triggered by a keyword match
SLASH_COMMAND  — Triggered by a slash command
MANUAL         — Triggered manually via admin action
```

### WorkflowVersionStatus
```
DRAFT      — Being edited, not yet live
PUBLISHED  — Active version serving triggers
ARCHIVED   — Previously published, superseded
```

### WorkflowExecutionStatus
```
ACTIVE          — Processing nodes automatically
WAITING_INPUT   — Paused at BUTTON_CHOICE or FORM_MODAL
WAITING_DELAY   — Paused at DELAY node (BullMQ job scheduled)
COMPLETED       — Reached terminal node
FAILED          — Unrecoverable error
EXPIRED         — 1-hour TTL exceeded
CANCELLED       — User or admin cancelled
```

### WorkflowNodeType
```
TRIGGER        — Entry point (file upload, keyword, slash command)
MESSAGE        — Posts a Slack message
BUTTON_CHOICE  — Presents buttons, branches on selection
FORM_MODAL     — Opens a Slack modal form
ENRICHMENT     — Runs an enrichment job
CONDITION      — Evaluates context data, branches
ACTION         — Performs a system operation
DELAY          — Pauses execution for a duration
```

## State Transitions

### WorkflowVersionStatus

```
DRAFT → PUBLISHED (on publish)
PUBLISHED → ARCHIVED (when new version published)
ARCHIVED → DRAFT (on restore/clone)
```

### WorkflowExecutionStatus

```
                    ┌─────────────────┐
                    │     ACTIVE      │
                    └───┬───┬───┬─────┘
                        │   │   │
              ┌─────────┘   │   └──────────┐
              ▼             ▼              ▼
     ┌────────────┐  ┌──────────┐  ┌───────────┐
     │ WAITING_   │  │COMPLETED │  │  FAILED   │
     │ INPUT      │  └──────────┘  └───────────┘
     └─────┬──────┘
           │ (user input received)
           ▼
     ┌──────────┐
     │  ACTIVE  │  (resumes processing)
     └──────────┘

     WAITING_INPUT ──→ EXPIRED (after 1 hour)
     WAITING_DELAY ──→ ACTIVE (BullMQ job fires)
     WAITING_DELAY ──→ EXPIRED (after 1 hour)
     Any non-terminal ──→ CANCELLED (admin action)
```

## Node Configuration Schemas

### TriggerNodeConfig
```typescript
{
  type: 'TRIGGER';
  triggerType: 'file_upload' | 'keyword' | 'slash_command' | 'manual';
  pattern?: string;     // For keyword: regex or exact match
  command?: string;     // For slash_command
}
```

### MessageNodeConfig
```typescript
{
  type: 'MESSAGE';
  text: string;         // Fallback text
  blocks: object[];     // Slack Block Kit blocks (supports {{variable}} interpolation)
  ephemeral?: boolean;  // Only visible to user
}
```

### ButtonChoiceNodeConfig
```typescript
{
  type: 'BUTTON_CHOICE';
  prompt: string;
  buttons: Array<{
    id: string;         // Matches edge sourceHandle
    label: string;
    style?: 'primary' | 'danger';
    value: string;      // Stored in execution context
  }>;
  outputVariable: string; // Context key for selected value
}
```

### FormModalNodeConfig
```typescript
{
  type: 'FORM_MODAL';
  title: string;
  fields: Array<{
    id: string;
    label: string;
    type: 'text' | 'textarea' | 'select' | 'multi_select' | 'number' | 'date' | 'checkbox';
    required?: boolean;
    placeholder?: string;
    options?: Array<{ label: string; value: string }>;
  }>;
  submitLabel?: string;
  outputMapping: Record<string, string>; // field ID → context variable
}
```

### EnrichmentNodeConfig
```typescript
{
  type: 'ENRICHMENT';
  enrichmentType: 'technographic' | 'contact' | 'combined';
  fileSourceVariable: string;     // Context key holding file ID
  purpose?: 'COLD_CALLING' | 'EMAILING' | 'JUST_A_LIST' | 'LINKEDIN';
  outputJobIdVariable: string;    // Context key for resulting job ID
}
```

### ConditionNodeConfig
```typescript
{
  type: 'CONDITION';
  evaluationField: string;  // Context key to evaluate
  description?: string;     // Display label in builder
}
// Note: Actual conditions are on the outgoing edges (EdgeCondition)
```

### ActionNodeConfig
```typescript
{
  type: 'ACTION';
  actionType: string;                    // Registered action handler name
  params: Record<string, unknown>;       // Supports {{variable}} interpolation
  outputVariable?: string;               // Context key for result
}
```

### DelayNodeConfig
```typescript
{
  type: 'DELAY';
  durationSeconds: number;
  durationVariable?: string;  // Optional dynamic duration from context
}
```

### EdgeCondition
```typescript
{
  field: string;
  operator: 'equals' | 'not_equals' | 'contains' | 'greater_than' | 'less_than' | 'is_empty' | 'is_not_empty' | 'regex' | 'default';
  value?: string | number | boolean;
}
```

## Prisma Schema Addition

```prisma
// --- Enums ---

enum WorkflowTriggerType {
  FILE_UPLOAD
  KEYWORD
  SLASH_COMMAND
  MANUAL
}

enum WorkflowVersionStatus {
  DRAFT
  PUBLISHED
  ARCHIVED
}

enum WorkflowExecutionStatus {
  ACTIVE
  WAITING_INPUT
  WAITING_DELAY
  COMPLETED
  FAILED
  EXPIRED
  CANCELLED
}

enum WorkflowNodeType {
  TRIGGER
  MESSAGE
  BUTTON_CHOICE
  FORM_MODAL
  ENRICHMENT
  CONDITION
  ACTION
  DELAY
}

// --- Models ---

model WorkflowTemplate {
  id              String              @id @default(uuid()) @db.Uuid
  slackTeamId     String              @map("slack_team_id")
  name            String
  description     String?             @db.Text
  triggerType     WorkflowTriggerType @map("trigger_type")
  isActive        Boolean             @default(false) @map("is_active")
  createdByUserId String              @map("created_by_user_id")
  createdAt       DateTime            @default(now()) @map("created_at")
  updatedAt       DateTime            @updatedAt @map("updated_at")

  versions WorkflowVersion[]

  @@index([slackTeamId])
  @@index([slackTeamId, triggerType])
  @@map("workflow_templates")
}

model WorkflowVersion {
  id                String                @id @default(uuid()) @db.Uuid
  templateId        String                @map("template_id") @db.Uuid
  version           Int                   @default(1)
  status            WorkflowVersionStatus @default(DRAFT)
  graph             Json                  @db.JsonB
  publishedAt       DateTime?             @map("published_at")
  publishedByUserId String?               @map("published_by_user_id")
  createdAt         DateTime              @default(now()) @map("created_at")
  updatedAt         DateTime              @updatedAt @map("updated_at")

  template   WorkflowTemplate    @relation(fields: [templateId], references: [id], onDelete: Cascade)
  executions WorkflowExecution[]

  @@unique([templateId, version])
  @@index([templateId, status])
  @@map("workflow_versions")
}

model WorkflowExecution {
  id             String                  @id @default(uuid()) @db.Uuid
  versionId      String                  @map("version_id") @db.Uuid
  slackTeamId    String                  @map("slack_team_id")
  slackUserId    String                  @map("slack_user_id")
  slackChannelId String                  @map("slack_channel_id")
  slackThreadTs  String?                 @map("slack_thread_ts")
  status         WorkflowExecutionStatus @default(ACTIVE)
  currentNodeId  String?                 @map("current_node_id")
  context        Json                    @default("{}") @db.JsonB
  nodeHistory    Json                    @default("[]") @db.JsonB
  errorMessage   String?                 @map("error_message") @db.Text
  expiresAt      DateTime                @map("expires_at")
  startedAt      DateTime                @default(now()) @map("started_at")
  completedAt    DateTime?               @map("completed_at")
  createdAt      DateTime                @default(now()) @map("created_at")
  updatedAt      DateTime                @updatedAt @map("updated_at")

  version WorkflowVersion @relation(fields: [versionId], references: [id])

  @@index([slackTeamId, slackUserId])
  @@index([slackChannelId, slackThreadTs])
  @@index([status])
  @@index([expiresAt])
  @@index([versionId])
  @@map("workflow_executions")
}
```
