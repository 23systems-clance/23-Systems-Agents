# Data Model: Backend Admin Dashboard

**Feature Branch**: `3-admin-dashboard`
**Date**: 2026-03-05
**Database**: PostgreSQL (via Prisma ORM)

> This document defines NEW models added for the admin dashboard feature. Existing models (Job, ApiUsageLog, AuditLog, etc.) from feature 1 are referenced but not redefined here. See `specs/1-slack-list-processor/data-model.md` for existing models.

## Entity Relationship Diagram

```
AdminUser (standalone)
ErrorLog (N) >---- (1) Job  (optional - errors may not be job-related)
BudgetThreshold (standalone, scoped by admin)
ScheduledReport (standalone, scoped by admin)
DailyAggregate (standalone, derived from ApiUsageLog)
RetentionConfig (standalone, singleton-like per data type)

Existing references:
  ErrorLog.job_id -> Job.id (optional FK)
  DailyAggregate reads from -> ApiUsageLog (aggregation source)
  BudgetThreshold checks -> ApiUsageLog (threshold evaluation source)
```

## New Entities

### AdminUser

Admin users with individual API keys for dashboard access. Provisioned via DB seed or CLI, not self-service.

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | UUID | PK, auto-generated | Unique admin identifier |
| name | String | NOT NULL | Admin display name |
| email | String | NOT NULL, UNIQUE | Admin email (for identification, not login) |
| api_key_hash | String | NOT NULL, UNIQUE | SHA-256 hash of the admin's API key |
| is_active | Boolean | NOT NULL, default true | Whether the admin can access the dashboard |
| created_at | Timestamp | NOT NULL, auto | Record creation time |
| updated_at | Timestamp | NOT NULL, auto | Last update time |

**Indexes**: `api_key_hash` (UNIQUE), `email` (UNIQUE)

**Notes**:
- API keys are stored as SHA-256 hashes (never plaintext)
- The plaintext key is shown only once at creation time
- Deactivated admins (`is_active = false`) are rejected at auth middleware
- No password or login mechanism — auth is purely API key-based

---

### ErrorLog

Centralized error tracking with lifecycle states. Captures errors from all system components.

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | UUID | PK, auto-generated | Unique error identifier |
| category | Enum | NOT NULL | `API_ERROR`, `QUEUE_ERROR`, `FILE_PROCESSING_ERROR`, `SLACK_ERROR`, `SYSTEM_ERROR` |
| service | String | NOT NULL | Service that generated the error (e.g., "builtwith", "apollo", "queue:technographic", "file:parser") |
| message | Text | NOT NULL | Error message |
| stack_trace | Text | NULLABLE | Full stack trace if available |
| job_id | UUID | NULLABLE, FK -> Job | Associated job (null for non-job errors) |
| slack_user_id | String | NULLABLE | Slack user whose request triggered the error |
| slack_channel_id | String | NULLABLE | Slack channel where the error originated |
| slack_team_id | String | NULLABLE | Slack workspace/team ID |
| metadata | JSONB | NULLABLE | Additional structured context (e.g., endpoint URL, request payload snippet, HTTP status code) |
| lifecycle_state | Enum | NOT NULL, default `OPEN` | `OPEN`, `ACKNOWLEDGED`, `RESOLVED` |
| acknowledged_by | UUID | NULLABLE, FK -> AdminUser | Admin who acknowledged the error |
| acknowledged_at | Timestamp | NULLABLE | When the error was acknowledged |
| resolved_by | UUID | NULLABLE, FK -> AdminUser | Admin who resolved the error |
| resolved_at | Timestamp | NULLABLE | When the error was resolved |
| created_at | Timestamp | NOT NULL, auto | When the error occurred |

**Indexes**: `category`, `service`, `lifecycle_state`, `job_id`, `slack_team_id`, `created_at`

**State Transitions**:
```
OPEN -> ACKNOWLEDGED (by admin)
OPEN -> RESOLVED (by admin, skip acknowledge)
ACKNOWLEDGED -> RESOLVED (by admin)
ACKNOWLEDGED -> OPEN (reopen if needed)
```

**Validation Rules**:
- `acknowledged_by` and `acknowledged_at` MUST be set when transitioning to ACKNOWLEDGED
- `resolved_by` and `resolved_at` MUST be set when transitioning to RESOLVED
- State transitions are logged to AuditLog with the admin's identity

---

### BudgetThreshold

Configurable spending limits with monthly reset and Slack alerting.

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | UUID | PK, auto-generated | Unique threshold identifier |
| name | String | NOT NULL | Human-readable threshold name (e.g., "Monthly Total", "Apollo Limit") |
| threshold_amount_usd | Decimal | NOT NULL | Spend limit in USD |
| provider_scope | Enum | NULLABLE | `BUILTWITH`, `APOLLO`, `AI_ORCHESTRATOR`, or NULL for overall total |
| slack_channel_id | String | NOT NULL | Slack channel to send alert notifications |
| is_active | Boolean | NOT NULL, default true | Whether this threshold is being monitored |
| last_triggered_at | Timestamp | NULLABLE | When the threshold was last triggered |
| last_triggered_month | String | NULLABLE | Month key (e.g., "2026-03") to prevent duplicate alerts within same month |
| created_by | UUID | NOT NULL, FK -> AdminUser | Admin who created this threshold |
| created_at | Timestamp | NOT NULL, auto | |
| updated_at | Timestamp | NOT NULL, auto | |

**Indexes**: `is_active`, `provider_scope`, `created_by`

**Validation Rules**:
- `threshold_amount_usd` must be > 0
- `last_triggered_month` is compared to current month (`YYYY-MM` format) to suppress duplicates (FR-023)
- When month changes, threshold can fire again (monthly reset)
- NULL `provider_scope` means threshold applies to total spend across all providers

---

### ScheduledReport

Configuration for recurring automated reports delivered to Slack.

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | UUID | PK, auto-generated | Unique report config identifier |
| name | String | NOT NULL | Human-readable report name |
| report_type | Enum | NOT NULL | `COST_SUMMARY`, `USAGE_BREAKDOWN`, `CLIENT_REPORT`, `ERROR_SUMMARY` |
| frequency | Enum | NOT NULL | `DAILY`, `WEEKLY`, `MONTHLY` |
| slack_channel_id | String | NOT NULL | Delivery target Slack channel |
| filters | JSONB | NULLABLE | Optional filters (date range offset, provider, team_id, etc.) |
| bullmq_job_key | String | NULLABLE | BullMQ repeatable job key for cancellation |
| is_active | Boolean | NOT NULL, default true | Whether this schedule is active |
| last_run_at | Timestamp | NULLABLE | When the report last ran successfully |
| last_error | Text | NULLABLE | Error message from last failed run |
| created_by | UUID | NOT NULL, FK -> AdminUser | Admin who configured this report |
| created_at | Timestamp | NOT NULL, auto | |
| updated_at | Timestamp | NOT NULL, auto | |

**Indexes**: `is_active`, `frequency`, `created_by`

---

### DailyAggregate

Pre-computed daily cost and usage aggregates for fast trending queries.

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | UUID | PK, auto-generated | |
| date | Date | NOT NULL | The day these metrics cover |
| service | Enum | NOT NULL | `BUILTWITH`, `APOLLO`, `AI_ORCHESTRATOR` |
| slack_team_id | String | NOT NULL | Workspace these metrics are scoped to |
| total_requests | Integer | NOT NULL, default 0 | Total API calls made |
| total_cost_usd | Decimal | NOT NULL, default 0 | Total estimated cost in USD |
| total_tokens_input | Integer | NOT NULL, default 0 | Total LLM input tokens (AI_ORCHESTRATOR only) |
| total_tokens_output | Integer | NOT NULL, default 0 | Total LLM output tokens (AI_ORCHESTRATOR only) |
| total_credits_consumed | Decimal | NOT NULL, default 0 | Total vendor credits consumed |
| error_count | Integer | NOT NULL, default 0 | Number of failed API calls (response_status >= 400) |
| avg_duration_ms | Integer | NULLABLE | Average request duration in ms |
| created_at | Timestamp | NOT NULL, auto | When this aggregate was computed |

**Indexes**: `date`, `service`, `slack_team_id`
**Unique**: `(date, service, slack_team_id)` — one row per day per service per workspace

**Notes**:
- Computed nightly by the daily aggregation worker
- Today's data is computed on-the-fly from raw ApiUsageLog and merged at query time
- Permanent retention (not subject to data retention purge)

---

### RetentionConfig

Per-data-type retention periods. Admin-configurable.

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | UUID | PK, auto-generated | |
| data_type | String | NOT NULL, UNIQUE | Identifier: `api_usage_logs`, `error_logs`, `audit_logs`, `daily_aggregates` |
| retention_days | Integer | NOT NULL | Number of days to keep raw records. 0 = permanent (no purge). |
| last_purged_at | Timestamp | NULLABLE | When the last purge ran for this data type |
| updated_by | UUID | NULLABLE, FK -> AdminUser | Admin who last changed this config |
| created_at | Timestamp | NOT NULL, auto | |
| updated_at | Timestamp | NOT NULL, auto | |

**Indexes**: `data_type` (UNIQUE)

**Default Values** (seeded):
| Data Type | Default Retention |
|-----------|------------------|
| `api_usage_logs` | 90 days |
| `error_logs` | 180 days |
| `audit_logs` | 0 (permanent — SOC 2 requirement) |
| `daily_aggregates` | 0 (permanent) |

**Validation Rules**:
- `audit_logs` retention cannot be changed from 0 (permanent) — enforced at application level per Constitution Principle V
- `daily_aggregates` retention cannot be changed from 0 — these are needed for historical trending after raw logs are purged
- Minimum retention_days for purgeable types: 30 days

---

## New Enums

### ErrorCategory
```
API_ERROR               - External API call failure (BuiltWith, Apollo, Claude)
QUEUE_ERROR             - BullMQ worker failure, stall, timeout
FILE_PROCESSING_ERROR   - CSV/XLSX parsing, validation, or generation failure
SLACK_ERROR             - Slack API failure (message send, file upload)
SYSTEM_ERROR            - Uncategorized / infrastructure errors
```

### ErrorLifecycleState
```
OPEN                    - Error detected, not yet reviewed
ACKNOWLEDGED            - An admin has seen the error and is investigating
RESOLVED                - Error has been addressed or dismissed
```

### ReportType
```
COST_SUMMARY            - Total costs by provider, trending
USAGE_BREAKDOWN         - API calls by type, endpoint, user
CLIENT_REPORT           - Per-client usage and cost summary
ERROR_SUMMARY           - Error counts by category, service, resolution
```

### ReportFrequency
```
DAILY
WEEKLY
MONTHLY
```

## Schema Extensions to Existing Models

### ApiUsageLog (existing — no schema change)

No changes to the ApiUsageLog schema. The dashboard reads existing fields:
- `service`, `endpoint`, `estimated_cost_usd`, `tokens_input`, `tokens_output`, `credits_consumed`, `response_status`, `duration_ms`, `created_at`
- Joined with `Job` for: `slack_user_id`, `slack_channel_id`, `slack_channel_name`, `slack_team_id`, `job_type`

### Job (existing — no schema change)

No changes. Dashboard queries use existing indexes on `slack_team_id`, `slack_user_id`, `status`, `created_at`.

### AuditLog (existing — extend action types)

No schema change. New audit action types added at application level:
- `error_acknowledged` — admin acknowledged an error
- `error_resolved` — admin resolved an error
- `threshold_created` — admin created a budget threshold
- `threshold_updated` — admin modified a budget threshold
- `threshold_triggered` — system triggered a budget alert
- `report_exported` — admin exported a report
- `report_scheduled` — admin configured a scheduled report
- `retention_updated` — admin changed retention config
- `admin_authenticated` — admin successfully authenticated

## Data Retention

| Data Type | Default Retention | Configurable | Notes |
|-----------|------------------|--------------|-------|
| ApiUsageLog (raw) | 90 days | Yes | Raw records purged; DailyAggregate preserves trending data |
| ErrorLog | 180 days | Yes | Resolved errors purged first; open errors preserved regardless of age |
| AuditLog | Permanent | No | SOC 2 requirement (Constitution Principle V) |
| DailyAggregate | Permanent | No | Required for historical trending after raw log purge |
| BudgetThreshold | Permanent | No | Configuration data, minimal volume |
| ScheduledReport | Permanent | No | Configuration data, minimal volume |
| AdminUser | Permanent | No | Configuration data, minimal volume |
| RetentionConfig | Permanent | No | Configuration data, singleton per type |
