# API Contracts: Backend Admin Dashboard

**Feature Branch**: `3-admin-dashboard`
**Date**: 2026-03-05
**API Style**: REST API (admin-only, separate from enrichment API)

> All admin endpoints are under `/api/v1/admin/`. Authentication is via `X-Admin-Key` header (per-admin API key). Rate limited to 100 requests/minute per admin key.

---

## Authentication

**Header**: `X-Admin-Key: {admin_api_key}`

**Error Responses**:
- `401 Unauthorized` — Missing or invalid admin key
- `403 Forbidden` — Admin key is valid but admin is deactivated
- `429 Too Many Requests` — Rate limit exceeded (100 req/min per admin)

```json
// 401
{ "error": "unauthorized", "message": "Invalid or missing admin API key" }

// 403
{ "error": "forbidden", "message": "Admin account is deactivated" }

// 429
{ "error": "rate_limited", "message": "Rate limit exceeded. Try again in {seconds}s", "retry_after": 45 }
```

---

## 1. Dashboard Overview

### 1.1 Get Overview Metrics

```
GET /api/v1/admin/overview
```

**Query Parameters**:
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| start_date | ISO date | 30 days ago | Start of date range |
| end_date | ISO date | today | End of date range |

**Response** `200 OK`:
```json
{
  "period": {
    "start_date": "2026-02-03",
    "end_date": "2026-03-05"
  },
  "summary": {
    "total_cost_usd": "1234.56",
    "total_api_calls": 45230,
    "total_tokens_input": 18500000,
    "total_tokens_output": 4200000,
    "active_jobs": 3,
    "completed_jobs": 1847,
    "failed_jobs": 23
  },
  "cost_by_provider": [
    { "service": "BUILTWITH", "cost_usd": "850.00", "percentage": 68.8 },
    { "service": "APOLLO", "cost_usd": "370.00", "percentage": 30.0 },
    { "service": "AI_ORCHESTRATOR", "cost_usd": "14.56", "percentage": 1.2 }
  ],
  "cost_by_workspace": [
    { "slack_team_id": "T12345", "slack_team_name": "Acme Corp", "cost_usd": "900.00" },
    { "slack_team_id": "T67890", "slack_team_name": "Globex", "cost_usd": "334.56" }
  ],
  "open_errors": 12,
  "error_rate_percent": 1.2
}
```

---

## 2. Cost & Usage Trends

### 2.1 Get Usage Trends

```
GET /api/v1/admin/usage/trends
```

**Query Parameters**:
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| start_date | ISO date | 30 days ago | Start of date range |
| end_date | ISO date | today | End of date range |
| granularity | string | `daily` | `daily`, `weekly`, `monthly` |
| service | string | all | Filter by service: `BUILTWITH`, `APOLLO`, `AI_ORCHESTRATOR` |
| slack_team_id | string | all | Filter by workspace |

**Response** `200 OK`:
```json
{
  "granularity": "daily",
  "data_points": [
    {
      "period": "2026-03-01",
      "total_cost_usd": "45.23",
      "total_requests": 1520,
      "total_tokens_input": 620000,
      "total_tokens_output": 155000,
      "total_credits_consumed": "42.0",
      "error_count": 3,
      "avg_duration_ms": 340
    },
    {
      "period": "2026-03-02",
      "total_cost_usd": "38.90",
      "total_requests": 1280,
      "total_tokens_input": 510000,
      "total_tokens_output": 128000,
      "total_credits_consumed": "35.5",
      "error_count": 1,
      "avg_duration_ms": 290
    }
  ]
}
```

---

## 3. API Usage Log

### 3.1 List API Usage Logs

```
GET /api/v1/admin/usage/logs
```

**Query Parameters**:
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| service | string | all | Filter: `BUILTWITH`, `APOLLO`, `AI_ORCHESTRATOR` |
| endpoint | string | - | Filter by endpoint substring |
| slack_user_id | string | - | Filter by Slack user |
| slack_channel_id | string | - | Filter by Slack channel |
| slack_team_id | string | - | Filter by workspace |
| job_id | UUID | - | Filter by specific job |
| status | string | - | Filter: `success` (2xx), `error` (4xx/5xx) |
| start_date | ISO date | 7 days ago | Start of date range |
| end_date | ISO date | today | End of date range |
| sort | string | `created_at:desc` | Sort field and direction |
| limit | integer | 50 | Results per page (1-100) |
| offset | integer | 0 | Pagination offset |

**Response** `200 OK`:
```json
{
  "logs": [
    {
      "id": "uuid",
      "service": "APOLLO",
      "endpoint": "/v1/people/match",
      "response_status": 200,
      "duration_ms": 450,
      "credits_consumed": "1.0",
      "tokens_input": null,
      "tokens_output": null,
      "estimated_cost_usd": "0.05",
      "created_at": "2026-03-05T14:30:00Z",
      "job": {
        "id": "job-uuid",
        "job_type": "CONTACT",
        "slack_user_id": "U12345",
        "slack_channel_id": "C67890",
        "slack_channel_name": "sales-team",
        "slack_team_id": "T12345"
      }
    }
  ],
  "total": 45230,
  "limit": 50,
  "offset": 0
}
```

---

## 4. Error Log

### 4.1 List Errors

```
GET /api/v1/admin/errors
```

**Query Parameters**:
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| category | string | all | Filter: `API_ERROR`, `QUEUE_ERROR`, `FILE_PROCESSING_ERROR`, `SLACK_ERROR`, `SYSTEM_ERROR` |
| service | string | - | Filter by service name |
| lifecycle_state | string | all | Filter: `OPEN`, `ACKNOWLEDGED`, `RESOLVED` |
| slack_team_id | string | - | Filter by workspace |
| job_id | UUID | - | Filter by job |
| start_date | ISO date | 7 days ago | Start of date range |
| end_date | ISO date | today | End of date range |
| sort | string | `created_at:desc` | Sort field and direction |
| limit | integer | 50 | Results per page (1-100) |
| offset | integer | 0 | Pagination offset |

**Response** `200 OK`:
```json
{
  "errors": [
    {
      "id": "uuid",
      "category": "API_ERROR",
      "service": "builtwith",
      "message": "429 Too Many Requests: Rate limit exceeded",
      "lifecycle_state": "OPEN",
      "job_id": "job-uuid",
      "slack_user_id": "U12345",
      "slack_channel_id": "C67890",
      "slack_team_id": "T12345",
      "created_at": "2026-03-05T14:30:00Z",
      "acknowledged_by": null,
      "acknowledged_at": null,
      "resolved_by": null,
      "resolved_at": null
    }
  ],
  "total": 156,
  "limit": 50,
  "offset": 0
}
```

### 4.2 Get Error Detail

```
GET /api/v1/admin/errors/:id
```

**Response** `200 OK`:
```json
{
  "id": "uuid",
  "category": "API_ERROR",
  "service": "builtwith",
  "message": "429 Too Many Requests: Rate limit exceeded",
  "stack_trace": "Error: 429 Too Many Requests\n    at BuiltWithClient.request ...",
  "metadata": {
    "endpoint": "https://api.builtwith.com/v22/api.json",
    "http_status": 429,
    "retry_after": 60
  },
  "lifecycle_state": "OPEN",
  "job_id": "job-uuid",
  "slack_user_id": "U12345",
  "slack_channel_id": "C67890",
  "slack_team_id": "T12345",
  "created_at": "2026-03-05T14:30:00Z",
  "acknowledged_by": null,
  "acknowledged_at": null,
  "resolved_by": null,
  "resolved_at": null,
  "job": {
    "id": "job-uuid",
    "job_type": "TECHNOGRAPHIC",
    "status": "PROCESSING",
    "source_file_name": "companies.csv",
    "slack_user_id": "U12345",
    "slack_channel_name": "sales-team"
  }
}
```

### 4.3 Update Error Lifecycle State

```
PATCH /api/v1/admin/errors/:id
```

**Request Body**:
```json
{
  "lifecycle_state": "ACKNOWLEDGED"
}
```

Valid transitions: `OPEN` → `ACKNOWLEDGED`, `OPEN` → `RESOLVED`, `ACKNOWLEDGED` → `RESOLVED`, `ACKNOWLEDGED` → `OPEN`

**Response** `200 OK`:
```json
{
  "id": "uuid",
  "lifecycle_state": "ACKNOWLEDGED",
  "acknowledged_by": { "id": "admin-uuid", "name": "John Admin" },
  "acknowledged_at": "2026-03-05T15:00:00Z"
}
```

**Error Responses**:
- `400 Bad Request` — Invalid state transition
- `404 Not Found` — Error not found

### 4.4 Get Error Trends

```
GET /api/v1/admin/errors/trends
```

**Query Parameters**:
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| start_date | ISO date | 30 days ago | Start of date range |
| end_date | ISO date | today | End of date range |
| granularity | string | `daily` | `daily`, `weekly`, `monthly` |
| group_by | string | `category` | `category`, `service` |

**Response** `200 OK`:
```json
{
  "granularity": "daily",
  "groups": [
    {
      "group": "API_ERROR",
      "data_points": [
        { "period": "2026-03-01", "count": 5 },
        { "period": "2026-03-02", "count": 2 }
      ]
    },
    {
      "group": "QUEUE_ERROR",
      "data_points": [
        { "period": "2026-03-01", "count": 1 },
        { "period": "2026-03-02", "count": 0 }
      ]
    }
  ]
}
```

---

## 5. Clients

### 5.1 List Clients

```
GET /api/v1/admin/clients
```

**Query Parameters**:
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| start_date | ISO date | 30 days ago | Date range for metrics |
| end_date | ISO date | today | Date range for metrics |
| sort | string | `total_cost:desc` | Sort: `total_cost`, `total_jobs`, `error_rate`, `last_active` |
| limit | integer | 50 | Results per page |
| offset | integer | 0 | Pagination offset |

**Response** `200 OK`:
```json
{
  "clients": [
    {
      "slack_team_id": "T12345",
      "slack_team_name": "Acme Corp",
      "total_jobs": 247,
      "total_api_calls": 12450,
      "total_cost_usd": "900.00",
      "error_rate_percent": 2.4,
      "last_active_at": "2026-03-05T14:00:00Z"
    }
  ],
  "total": 5,
  "limit": 50,
  "offset": 0
}
```

### 5.2 Get Client Detail

```
GET /api/v1/admin/clients/:slack_team_id
```

**Query Parameters**:
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| start_date | ISO date | 30 days ago | Date range for metrics |
| end_date | ISO date | today | Date range for metrics |

**Response** `200 OK`:
```json
{
  "slack_team_id": "T12345",
  "slack_team_name": "Acme Corp",
  "summary": {
    "total_jobs": 247,
    "total_api_calls": 12450,
    "total_cost_usd": "900.00",
    "error_rate_percent": 2.4,
    "last_active_at": "2026-03-05T14:00:00Z"
  },
  "cost_by_provider": [
    { "service": "BUILTWITH", "cost_usd": "620.00" },
    { "service": "APOLLO", "cost_usd": "270.00" },
    { "service": "AI_ORCHESTRATOR", "cost_usd": "10.00" }
  ],
  "top_users": [
    { "slack_user_id": "U12345", "display_name": "Jane Doe", "total_jobs": 150, "total_cost_usd": "540.00" },
    { "slack_user_id": "U67890", "display_name": "Bob Smith", "total_jobs": 97, "total_cost_usd": "360.00" }
  ],
  "recent_jobs": [
    {
      "id": "job-uuid",
      "job_type": "COMBINED",
      "status": "COMPLETED",
      "source_file_name": "leads.csv",
      "source_row_count": 100,
      "created_at": "2026-03-05T10:00:00Z"
    }
  ]
}
```

---

## 6. Budget Thresholds

### 6.1 List Thresholds

```
GET /api/v1/admin/thresholds
```

**Response** `200 OK`:
```json
{
  "thresholds": [
    {
      "id": "uuid",
      "name": "Monthly Total",
      "threshold_amount_usd": "500.00",
      "provider_scope": null,
      "slack_channel_id": "C-ADMIN",
      "is_active": true,
      "last_triggered_at": "2026-02-15T08:30:00Z",
      "last_triggered_month": "2026-02",
      "current_month_spend_usd": "234.50",
      "created_by": { "id": "admin-uuid", "name": "John Admin" }
    }
  ]
}
```

### 6.2 Create Threshold

```
POST /api/v1/admin/thresholds
```

**Request Body**:
```json
{
  "name": "Apollo Monthly Limit",
  "threshold_amount_usd": 200.00,
  "provider_scope": "APOLLO",
  "slack_channel_id": "C-ADMIN"
}
```

**Response** `201 Created`:
```json
{
  "id": "uuid",
  "name": "Apollo Monthly Limit",
  "threshold_amount_usd": "200.00",
  "provider_scope": "APOLLO",
  "slack_channel_id": "C-ADMIN",
  "is_active": true,
  "created_by": { "id": "admin-uuid", "name": "John Admin" },
  "created_at": "2026-03-05T15:00:00Z"
}
```

### 6.3 Update Threshold

```
PUT /api/v1/admin/thresholds/:id
```

**Request Body**:
```json
{
  "threshold_amount_usd": 300.00,
  "is_active": true
}
```

**Response** `200 OK`: Updated threshold object.

### 6.4 Delete Threshold

```
DELETE /api/v1/admin/thresholds/:id
```

**Response** `204 No Content`

---

## 7. Reports

### 7.1 Export Report (On-Demand)

```
POST /api/v1/admin/reports/export
```

**Request Body**:
```json
{
  "report_type": "COST_SUMMARY",
  "start_date": "2026-02-01",
  "end_date": "2026-02-28",
  "filters": {
    "service": "APOLLO",
    "slack_team_id": "T12345"
  }
}
```

**Response** `200 OK`:
- `Content-Type: text/csv`
- `Content-Disposition: attachment; filename="cost-summary-2026-02-01-to-2026-02-28.csv"`
- Body: CSV data stream

### 7.2 List Scheduled Reports

```
GET /api/v1/admin/reports/scheduled
```

**Response** `200 OK`:
```json
{
  "reports": [
    {
      "id": "uuid",
      "name": "Weekly Cost Summary",
      "report_type": "COST_SUMMARY",
      "frequency": "WEEKLY",
      "slack_channel_id": "C-REPORTS",
      "filters": null,
      "is_active": true,
      "last_run_at": "2026-03-03T00:00:00Z",
      "last_error": null,
      "created_by": { "id": "admin-uuid", "name": "John Admin" }
    }
  ]
}
```

### 7.3 Create Scheduled Report

```
POST /api/v1/admin/reports/scheduled
```

**Request Body**:
```json
{
  "name": "Weekly Cost Summary",
  "report_type": "COST_SUMMARY",
  "frequency": "WEEKLY",
  "slack_channel_id": "C-REPORTS",
  "filters": {
    "service": null,
    "slack_team_id": null
  }
}
```

**Response** `201 Created`: Scheduled report object.

### 7.4 Update Scheduled Report

```
PUT /api/v1/admin/reports/scheduled/:id
```

**Response** `200 OK`: Updated report object.

### 7.5 Delete Scheduled Report

```
DELETE /api/v1/admin/reports/scheduled/:id
```

**Response** `204 No Content`

---

## 8. Retention Configuration

### 8.1 Get Retention Config

```
GET /api/v1/admin/retention
```

**Response** `200 OK`:
```json
{
  "configs": [
    { "data_type": "api_usage_logs", "retention_days": 90, "last_purged_at": "2026-03-05T02:00:00Z" },
    { "data_type": "error_logs", "retention_days": 180, "last_purged_at": "2026-03-05T02:00:00Z" },
    { "data_type": "audit_logs", "retention_days": 0, "last_purged_at": null, "locked": true },
    { "data_type": "daily_aggregates", "retention_days": 0, "last_purged_at": null, "locked": true }
  ]
}
```

### 8.2 Update Retention Config

```
PUT /api/v1/admin/retention/:data_type
```

**Request Body**:
```json
{
  "retention_days": 120
}
```

**Validation**:
- `audit_logs` and `daily_aggregates` are locked (cannot change from 0)
- Minimum 30 days for purgeable types
- Returns `400 Bad Request` if violating constraints

**Response** `200 OK`:
```json
{
  "data_type": "api_usage_logs",
  "retention_days": 120,
  "updated_by": { "id": "admin-uuid", "name": "John Admin" },
  "updated_at": "2026-03-05T15:00:00Z"
}
```

---

## 9. BullMQ Job Definitions (Internal)

### 9.1 Queue: `admin`

#### `daily-aggregate`
```typescript
// Repeatable: runs daily at 00:30 UTC
interface DailyAggregateJobData {
  date: string; // ISO date to aggregate (yesterday)
}
```

#### `retention-purge`
```typescript
// Repeatable: runs daily at 01:00 UTC (after aggregation)
interface RetentionPurgeJobData {
  data_type: string; // Which data type to purge
}
```

#### `scheduled-report`
```typescript
// Repeatable: varies per report config (daily/weekly/monthly)
interface ScheduledReportJobData {
  reportId: string; // ScheduledReport ID
}
```

#### `threshold-check` (inline — not queued)
```typescript
// Called directly after logApiUsage() success — NOT a BullMQ job.
// Listed here for documentation completeness only.
interface ThresholdCheckData {
  jobId: string; // Job that triggered the check
  service: 'BUILTWITH' | 'APOLLO' | 'AI_ORCHESTRATOR';
  costUsd: number; // Cost of the triggering API call
}
```

---

## 10. Common Response Patterns

### Pagination
All list endpoints return:
```json
{
  "<items>": [...],
  "total": 1234,
  "limit": 50,
  "offset": 0
}
```

### Error Responses
```json
// 400 Bad Request
{ "error": "bad_request", "message": "Specific validation error", "details": { ... } }

// 404 Not Found
{ "error": "not_found", "message": "Resource not found" }

// 500 Internal Server Error
{ "error": "internal_error", "message": "An unexpected error occurred" }
```

### Date Parameters
- All date parameters accept ISO 8601 format: `YYYY-MM-DD`
- Date ranges are inclusive of both start and end dates
- Timestamps in responses use ISO 8601 with UTC timezone: `YYYY-MM-DDTHH:mm:ssZ`
