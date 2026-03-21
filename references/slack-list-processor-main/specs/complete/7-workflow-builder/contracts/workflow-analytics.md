# API Contract: Workflow Analytics

**Base Path**: `/api/v1/admin/workflows`
**Auth**: Admin auth middleware

## Endpoints

### GET /:workflowId/analytics — Workflow Analytics

Returns aggregate execution metrics for a workflow.

**Query Parameters**:
| Param | Type | Required | Notes |
|-------|------|----------|-------|
| teamId | string | Yes | Slack team ID |
| period | string | No | `7d`, `30d`, `90d`, `all` (default: `30d`) |

**Response 200**:
```json
{
  "analytics": {
    "workflow_id": "uuid",
    "workflow_name": "Company Enrichment",
    "period": "30d",
    "summary": {
      "total_runs": 145,
      "completed": 129,
      "failed": 5,
      "expired": 8,
      "cancelled": 3,
      "active": 0,
      "completion_rate": 0.89,
      "average_duration_seconds": 180,
      "median_duration_seconds": 120
    },
    "daily_runs": [
      { "date": "2026-03-01", "runs": 5, "completed": 4, "failed": 1 },
      { "date": "2026-03-02", "runs": 8, "completed": 7, "failed": 0 }
    ]
  }
}
```

### GET /:workflowId/analytics/funnel — Funnel Analytics

Returns step-by-step execution counts and drop-off percentages.

**Query Parameters**:
| Param | Type | Required | Notes |
|-------|------|----------|-------|
| teamId | string | Yes | Slack team ID |
| versionId | string | No | Filter by specific version |
| period | string | No | `7d`, `30d`, `90d`, `all` (default: `30d`) |

**Response 200**:
```json
{
  "funnel": {
    "workflow_id": "uuid",
    "version_id": "uuid",
    "total_starts": 145,
    "steps": [
      {
        "node_id": "node-1",
        "node_type": "TRIGGER",
        "node_label": "File Upload",
        "reached_count": 145,
        "completed_count": 145,
        "drop_off_count": 0,
        "drop_off_rate": 0.0
      },
      {
        "node_id": "node-2",
        "node_type": "BUTTON_CHOICE",
        "node_label": "Select List Type",
        "reached_count": 145,
        "completed_count": 138,
        "drop_off_count": 7,
        "drop_off_rate": 0.048
      },
      {
        "node_id": "node-3",
        "node_type": "BUTTON_CHOICE",
        "node_label": "Enrichment Type",
        "reached_count": 138,
        "completed_count": 132,
        "drop_off_count": 6,
        "drop_off_rate": 0.043
      }
    ]
  }
}
```

### GET /:workflowId/analytics/nodes/:nodeId — Per-Node Analytics

Returns detailed metrics for a specific node, including choice distribution for BUTTON_CHOICE nodes.

**Query Parameters**:
| Param | Type | Required | Notes |
|-------|------|----------|-------|
| teamId | string | Yes | Slack team ID |
| period | string | No | Default `30d` |

**Response 200** (for BUTTON_CHOICE node):
```json
{
  "node_analytics": {
    "node_id": "node-2",
    "node_type": "BUTTON_CHOICE",
    "node_label": "Select List Type",
    "total_reached": 145,
    "total_completed": 138,
    "average_time_seconds": 15,
    "choice_distribution": [
      { "button_id": "btn-company", "label": "Company List", "count": 95, "percentage": 0.689 },
      { "button_id": "btn-contact", "label": "Contact List", "count": 43, "percentage": 0.312 }
    ]
  }
}
```

**Response 200** (for non-choice node):
```json
{
  "node_analytics": {
    "node_id": "node-5",
    "node_type": "ENRICHMENT",
    "node_label": "Run Enrichment",
    "total_reached": 132,
    "total_completed": 129,
    "total_failed": 3,
    "average_time_seconds": 45
  }
}
```

## Analytics Computation

Analytics are computed from `WorkflowExecution.nodeHistory` JSONB arrays. Queries use PostgreSQL JSONB operators to extract and aggregate node history entries.

**Note**: Analytics are eventually consistent (computed on-read, not pre-aggregated). For the expected scale (< 1000 executions per workflow), this is performant without materialized views.
