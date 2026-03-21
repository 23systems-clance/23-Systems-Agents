# API Contract: Workflow CRUD

**Base Path**: `/api/v1/admin/workflows`
**Auth**: Admin auth middleware (existing `adminAuth`)

## Endpoints

### GET / — List Workflows

Lists all workflow templates for a team with their current version info.

**Query Parameters**:
| Param | Type | Required | Notes |
|-------|------|----------|-------|
| teamId | string | Yes | Slack team ID |
| status | string | No | Filter by version status: `DRAFT`, `PUBLISHED`, `ARCHIVED` |

**Response 200**:
```json
{
  "workflows": [
    {
      "id": "uuid",
      "name": "Company Enrichment",
      "description": "Standard company enrichment flow",
      "trigger_type": "FILE_UPLOAD",
      "is_active": true,
      "created_by_user_id": "U12345",
      "created_at": "2026-03-08T00:00:00.000Z",
      "updated_at": "2026-03-08T00:00:00.000Z",
      "current_version": {
        "id": "uuid",
        "version": 2,
        "status": "PUBLISHED",
        "published_at": "2026-03-08T00:00:00.000Z",
        "node_count": 8,
        "edge_count": 7
      },
      "draft_version": null,
      "total_runs": 45,
      "completion_rate": 0.89
    }
  ],
  "total": 1
}
```

### POST / — Create Workflow

Creates a new workflow template with an initial draft version.

**Request Body**:
```json
{
  "slack_team_id": "T12345",
  "name": "My Custom Flow",
  "description": "Optional description",
  "trigger_type": "FILE_UPLOAD",
  "created_by_user_id": "U12345",
  "from_template": "company_enrichment"
}
```

- `from_template` is optional. If provided, the draft version is pre-populated with the template's nodes/edges.

**Response 201**:
```json
{
  "workflow": {
    "id": "uuid",
    "name": "My Custom Flow",
    "trigger_type": "FILE_UPLOAD",
    "is_active": false,
    "created_at": "...",
    "draft_version": {
      "id": "uuid",
      "version": 1,
      "status": "DRAFT",
      "graph": { "nodes": [...], "edges": [...], "viewport": {...} }
    }
  }
}
```

**Error 409**: If `trigger_type` already has an active workflow for this team.

### GET /:workflowId — Get Workflow

Returns a workflow template with its versions.

**Response 200**:
```json
{
  "workflow": {
    "id": "uuid",
    "name": "Company Enrichment",
    "description": "...",
    "trigger_type": "FILE_UPLOAD",
    "is_active": true,
    "created_by_user_id": "U12345",
    "created_at": "...",
    "updated_at": "...",
    "versions": [
      {
        "id": "uuid",
        "version": 2,
        "status": "PUBLISHED",
        "published_at": "...",
        "node_count": 8,
        "edge_count": 7
      },
      {
        "id": "uuid",
        "version": 1,
        "status": "ARCHIVED",
        "published_at": "...",
        "node_count": 6,
        "edge_count": 5
      }
    ]
  }
}
```

### GET /:workflowId/versions/:versionId — Get Version with Graph

Returns a specific version including the full graph (nodes, edges, viewport).

**Response 200**:
```json
{
  "version": {
    "id": "uuid",
    "version": 1,
    "status": "DRAFT",
    "graph": {
      "nodes": [
        {
          "id": "node-1",
          "type": "TRIGGER",
          "label": "File Upload",
          "position": { "x": 250, "y": 0 },
          "config": {
            "type": "TRIGGER",
            "triggerType": "keyword",
            "pattern": "ENRICH"
          }
        }
      ],
      "edges": [
        {
          "id": "edge-1",
          "sourceNodeId": "node-1",
          "targetNodeId": "node-2",
          "label": "Next"
        }
      ],
      "viewport": { "x": 0, "y": 0, "zoom": 1 }
    },
    "published_at": null,
    "created_at": "...",
    "updated_at": "..."
  }
}
```

### PUT /:workflowId/versions/:versionId — Update Draft Version

Updates the graph of a draft version. Only DRAFT versions can be updated.

**Request Body**:
```json
{
  "graph": {
    "nodes": [...],
    "edges": [...],
    "viewport": { "x": 0, "y": 0, "zoom": 1 }
  }
}
```

**Response 200**:
```json
{
  "version": {
    "id": "uuid",
    "version": 1,
    "status": "DRAFT",
    "graph": { ... },
    "updated_at": "..."
  }
}
```

**Error 400**: If version is not in DRAFT status.

### PUT /:workflowId/name — Update Workflow Name

**Request Body**:
```json
{
  "name": "New Name",
  "description": "Updated description"
}
```

**Response 200**: Updated workflow object.

### POST /:workflowId/validate — Validate Workflow

Validates the current draft version's graph structure.

**Response 200**:
```json
{
  "valid": true,
  "errors": [],
  "warnings": [
    { "node_id": "node-5", "message": "Delay node has no outgoing connections" }
  ]
}
```

**Response 200** (invalid):
```json
{
  "valid": false,
  "errors": [
    { "message": "Workflow must have exactly one trigger node" },
    { "node_id": "node-3", "message": "Node is not connected to the workflow" },
    { "message": "Circular reference detected involving nodes: node-4, node-5" }
  ],
  "warnings": []
}
```

### POST /:workflowId/publish — Publish Draft Version

Validates and publishes the current draft. Atomically archives the previous published version.

**Request Body**:
```json
{
  "published_by_user_id": "U12345"
}
```

**Response 200**:
```json
{
  "version": {
    "id": "uuid",
    "version": 2,
    "status": "PUBLISHED",
    "published_at": "...",
    "published_by_user_id": "U12345"
  },
  "previous_version_archived": "uuid-of-v1"
}
```

**Error 400**: If validation fails (returns validation errors).
**Error 409**: If another workflow with the same trigger type is already active.

### POST /:workflowId/clone — Clone Workflow

Creates a new workflow template with a draft version copied from the specified workflow's latest published version.

**Request Body**:
```json
{
  "slack_team_id": "T12345",
  "created_by_user_id": "U12345"
}
```

**Response 201**: New workflow with "Copy of [Original Name]".

### POST /:workflowId/archive — Archive Workflow

Archives the workflow (sets published version to ARCHIVED, sets `isActive = false`).

**Response 200**: Updated workflow object.

### POST /:workflowId/edit — Create Draft from Published

Creates a new draft version from the currently published version, allowing edits without disrupting live workflow.

**Response 201**: New draft version with graph copied from published.

### DELETE /:workflowId — Delete Workflow

Deletes a workflow and all its versions. Only allowed if no active executions reference this workflow.

**Response 200**:
```json
{ "message": "Workflow deleted successfully", "workflow_id": "uuid" }
```

**Error 409**: If active executions exist.

### GET /templates — List Templates

Returns available pre-built templates.

**Response 200**:
```json
{
  "templates": [
    {
      "id": "company_enrichment",
      "name": "Company Enrichment",
      "description": "Standard company enrichment flow: file upload → list type → enrichment type → job creation",
      "node_count": 6,
      "preview_image": null
    },
    {
      "id": "contact_enrichment",
      "name": "Contact Enrichment",
      "description": "Contact enrichment flow with purpose selection and filter configuration",
      "node_count": 8
    },
    {
      "id": "combined_enrichment",
      "name": "Combined Enrichment",
      "description": "Full company + contact enrichment flow",
      "node_count": 10
    }
  ]
}
```

### POST /templates — Save Workflow as Template

Saves a published workflow as a reusable custom template.

**Request Body**:
```json
{
  "workflow_id": "uuid",
  "slack_team_id": "T12345"
}
```

**Response 201**:
```json
{
  "template": {
    "id": "custom_my-flow",
    "name": "My Custom Flow",
    "description": "Custom template saved from workflow",
    "node_count": 6,
    "is_custom": true,
    "created_by_user_id": "U12345"
  }
}
```

**Error 400**: If the workflow has no published version.
