# API Contract: Workflow Execution

**Base Path**: `/api/v1/admin/workflows`
**Auth**: Admin auth middleware for admin endpoints; Slack bot auth for runtime endpoints.

## Admin Endpoints

### GET /:workflowId/executions — List Executions

Lists executions for a workflow with optional filters.

**Query Parameters**:
| Param | Type | Required | Notes |
|-------|------|----------|-------|
| teamId | string | Yes | Slack team ID |
| status | string | No | Filter: `ACTIVE`, `WAITING_INPUT`, `COMPLETED`, `FAILED`, `EXPIRED` |
| limit | number | No | Default 50, max 100 |
| offset | number | No | Default 0 |

**Response 200**:
```json
{
  "executions": [
    {
      "id": "uuid",
      "version_id": "uuid",
      "version_number": 2,
      "slack_user_id": "U12345",
      "slack_channel_id": "C12345",
      "status": "COMPLETED",
      "current_node_id": null,
      "node_history_count": 6,
      "started_at": "2026-03-08T10:00:00.000Z",
      "completed_at": "2026-03-08T10:05:00.000Z",
      "duration_seconds": 300
    }
  ],
  "total": 45,
  "limit": 50,
  "offset": 0
}
```

### GET /executions/:executionId — Get Execution Detail

Returns full execution detail including node history.

**Response 200**:
```json
{
  "execution": {
    "id": "uuid",
    "version_id": "uuid",
    "slack_team_id": "T12345",
    "slack_user_id": "U12345",
    "slack_channel_id": "C12345",
    "slack_thread_ts": "1709884800.000100",
    "status": "COMPLETED",
    "current_node_id": null,
    "context": {
      "fileId": "F12345",
      "listType": "company",
      "enrichmentType": "technographic",
      "jobId": "uuid"
    },
    "node_history": [
      {
        "node_id": "node-1",
        "node_type": "TRIGGER",
        "entered_at": "2026-03-08T10:00:00.000Z",
        "exited_at": "2026-03-08T10:00:01.000Z"
      },
      {
        "node_id": "node-2",
        "node_type": "BUTTON_CHOICE",
        "entered_at": "2026-03-08T10:00:01.000Z",
        "exited_at": "2026-03-08T10:02:30.000Z",
        "user_input": { "listType": "company" }
      }
    ],
    "error_message": null,
    "expires_at": "2026-03-08T11:00:00.000Z",
    "started_at": "2026-03-08T10:00:00.000Z",
    "completed_at": "2026-03-08T10:05:00.000Z"
  }
}
```

### POST /executions/:executionId/cancel — Cancel Execution

Cancels an in-progress execution.

**Response 200**:
```json
{
  "execution": {
    "id": "uuid",
    "status": "CANCELLED"
  }
}
```

**Error 400**: If execution is already in a terminal state.

## Runtime Endpoints (Internal — called by Slack bot)

These are internal service methods, not HTTP endpoints. The Slack bot calls them directly via imported functions.

### workflowEngine.startExecution()

```typescript
async startExecution(params: {
  triggerType: WorkflowTriggerType;
  slackTeamId: string;
  slackUserId: string;
  slackChannelId: string;
  slackThreadTs?: string;
  initialContext?: Record<string, unknown>;
}): Promise<{
  execution: WorkflowExecution;
  firstNode: WorkflowNode;
  slackMessage?: { text: string; blocks: object[] };
} | null>
```

Returns `null` if no active workflow matches the trigger type (caller falls back to legacy flow).

### workflowEngine.resumeWithInput()

```typescript
async resumeWithInput(
  executionId: string,
  input: Record<string, unknown>,
  selectedHandle?: string,
): Promise<{
  nextNode?: WorkflowNode;
  slackMessage?: { text: string; blocks: object[] };
  completed: boolean;
}>
```

Called when a Slack action handler receives user input (button click, form submit).

### workflowEngine.findActiveExecution()

```typescript
async findActiveExecution(
  slackChannelId: string,
  slackThreadTs: string,
): Promise<WorkflowExecution | null>
```

Finds an in-progress execution for a given channel/thread (for resumption).

## Slack Action Routing

### Action ID Format

```
wf:{executionId}:{nodeId}:{buttonId}
```

**Example**: `wf:abc123:node-5:btn-company`

### Registered Slack Listeners

| Pattern | Handler | Notes |
|---------|---------|-------|
| `/^wf:/` | `workflowAction.ts` | Routes button clicks to `resumeWithInput` |
| `view_submission` (callback_id: `/^wf-form:/`) | `workflowAction.ts` | Routes form submissions |

### Callback ID Format (for modals)

```
wf-form:{executionId}:{nodeId}
```
