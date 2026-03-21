# API Contracts: Workflow Channel Scoping

**Feature**: 21-workflow-channel-scoping
**Date**: 2026-03-11
**Base Path**: `/api/v1/admin`

## Modified Endpoints

### GET /workflows

List workflows with new `client_id`, `client_name` fields and optional `clientId` filter.

**Query Parameters** (additions):
- `clientId` (string, optional): Filter workflows by client ID. Pass `"null"` for team-level fallbacks only.

**Response** (additions to each workflow object):
```json
{
  "workflows": [
    {
      "id": "uuid",
      "name": "Acme Enrichment",
      "trigger_type": "FILE_UPLOAD",
      "is_active": true,
      "client_id": "uuid-or-null",
      "client_name": "Acme Inc",
      "current_version": { "...existing fields..." },
      "total_executions": 42,
      "completion_rate": 0.85,
      "created_at": "2026-03-11T00:00:00Z"
    }
  ],
  "total": 1
}
```

### POST /workflows

Create workflow with optional client assignment.

**Request Body** (additions):
```json
{
  "slack_team_id": "T12345",
  "name": "Acme Enrichment",
  "trigger_type": "FILE_UPLOAD",
  "created_by_user_id": "U67890",
  "client_id": "uuid-or-null"
}
```

**Response**: Same as existing, plus `client_id` and `client_name`.

### GET /workflows/:workflowId

Get workflow detail with client info and channel mappings.

**Response** (additions):
```json
{
  "workflow": {
    "...existing fields...",
    "client_id": "uuid-or-null",
    "client_name": "Acme Inc",
    "channel_mappings": [
      {
        "id": "mapping-uuid",
        "slack_channel_id": "C12345",
        "slack_team_id": "T12345",
        "trigger_type": "FILE_UPLOAD",
        "channel_name": "#acme-vip"
      }
    ]
  }
}
```

### POST /workflows/:workflowId/publish

Publish workflow. Auto-deactivates conflicting workflow (same triggerType + clientId).

**Response** (additions):
```json
{
  "...existing fields...",
  "deactivated_workflow": {
    "id": "uuid",
    "name": "Old Acme Workflow"
  }
}
```

`deactivated_workflow` is `null` if no conflict was resolved.

## New Endpoints

### PUT /workflows/:workflowId/client

Assign or remove client from workflow.

**Request Body**:
```json
{
  "client_id": "uuid-or-null"
}
```

**Response** (200):
```json
{
  "workflow": {
    "id": "uuid",
    "client_id": "uuid-or-null",
    "client_name": "Acme Inc"
  }
}
```

**Errors**:
- `404`: Workflow not found
- `400`: Invalid client_id

### GET /workflows/:workflowId/channels

List channel mappings for a workflow.

**Response** (200):
```json
{
  "mappings": [
    {
      "id": "mapping-uuid",
      "slack_channel_id": "C12345",
      "slack_team_id": "T12345",
      "trigger_type": "FILE_UPLOAD",
      "channel_name": "#acme-vip",
      "created_by_user_id": "admin",
      "created_at": "2026-03-11T00:00:00Z"
    }
  ]
}
```

### POST /workflows/:workflowId/channels

Map a channel to this workflow (channel-level override).

**Request Body**:
```json
{
  "slack_channel_id": "C12345",
  "slack_team_id": "T12345",
  "created_by_user_id": "admin"
}
```

**Response** (201):
```json
{
  "mapping": {
    "id": "mapping-uuid",
    "slack_channel_id": "C12345",
    "slack_team_id": "T12345",
    "trigger_type": "FILE_UPLOAD",
    "channel_name": "#acme-vip",
    "created_by_user_id": "admin",
    "created_at": "2026-03-11T00:00:00Z"
  }
}
```

**Notes**:
- `trigger_type` is automatically set from the workflow's trigger type
- If the channel already has a mapping for this trigger type, returns `409 Conflict` with the existing mapping's workflow ID

**Errors**:
- `404`: Workflow not found
- `409`: Channel already mapped for this trigger type (`{ error: "channel_already_mapped", existing_workflow_id: "uuid" }`)

### DELETE /workflows/:workflowId/channels/:mappingId

Remove a channel mapping from a workflow.

**Response** (200):
```json
{ "deleted": true }
```

**Errors**:
- `404`: Mapping not found

## Modified Client Endpoint

### GET /clients/:id

Include associated workflows in client detail response.

**Response** (additions):
```json
{
  "...existing fields...",
  "workflows": [
    {
      "id": "uuid",
      "name": "Acme Enrichment",
      "trigger_type": "FILE_UPLOAD",
      "is_active": true,
      "current_version": 3,
      "published_at": "2026-03-10T00:00:00Z",
      "created_at": "2026-03-01T00:00:00Z"
    }
  ]
}
```

## Audit Logging

All new/modified mutation endpoints MUST call `logAudit()`:

| Endpoint | Action | Target Type |
|----------|--------|-------------|
| PUT /workflows/:id/client | `workflow.client_assigned` or `workflow.client_removed` | `workflow_template` |
| POST /workflows/:id/channels | `workflow.channel_mapped` | `workflow_channel_mapping` |
| DELETE /workflows/:id/channels/:mid | `workflow.channel_unmapped` | `workflow_channel_mapping` |
| POST /workflows/:id/publish (deactivation) | `workflow.auto_deactivated` | `workflow_template` |
