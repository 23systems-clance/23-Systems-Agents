# Research: Backend Admin Dashboard

**Feature Branch**: `3-admin-dashboard`
**Date**: 2026-03-05

## Research Decisions

### 1. Aggregation Strategy for Cost Trending

**Decision**: Pre-computed daily aggregates stored in a `DailyAggregate` table, computed by a nightly BullMQ repeatable job.

**Rationale**: The ApiUsageLog table will accumulate thousands of rows per day. Querying raw logs for 90+ day trends at daily/weekly/monthly granularity would exceed the 3-second performance target (SC-001). Pre-computed daily aggregates reduce trending queries from scanning millions of rows to scanning ~90-365 rows.

**Alternatives considered**:
- **Raw query with indexes**: Rejected — GROUP BY date on large tables with multiple WHERE clauses is slow even with indexes. PostgreSQL `date_trunc` aggregation on 100K+ rows exceeds 3s.
- **PostgreSQL materialized views**: Rejected — Prisma ORM does not support materialized views natively. Would require raw SQL for creation/refresh, breaking the ORM-first pattern established in feature 1.
- **Redis-based counters (real-time)**: Rejected — adds complexity for write path (every API log must also increment Redis counters). Redis data is ephemeral and not suitable for historical reporting. Would require dual-write synchronization.
- **Application-level caching (in-memory)**: Rejected — loses state on restart. Not suitable for persistent aggregates.

**Implementation**: BullMQ repeatable job runs daily at midnight UTC. Aggregates ApiUsageLog rows from previous day into DailyAggregate rows (one per service per workspace per day). Trending endpoints query DailyAggregate table. Today's partial data is computed on-the-fly from raw ApiUsageLog for the current day and merged with pre-computed aggregates.

---

### 2. Error Logging Architecture

**Decision**: New `ErrorLog` database model with application-level error capture via a `logError()` helper function (similar pattern to existing `logApiUsage()` and `logAudit()`).

**Rationale**: The existing error handling writes to structured JSON logs via `logger.ts` (console/file output). These logs are not queryable via the API, cannot be filtered by the admin dashboard, and don't support lifecycle states (Open/Acknowledged/Resolved). A database-backed error log is needed.

**Alternatives considered**:
- **Parse existing JSON logs**: Rejected — requires log aggregation infrastructure (ELK, Datadog) which is out of scope. Also cannot support lifecycle states or admin attribution.
- **Extend AuditLog**: Rejected — AuditLog is immutable/append-only by design (SOC 2). Error lifecycle requires UPDATE operations (state transitions). Different retention policies needed.
- **External error tracking (Sentry, Bugsnag)**: Rejected — adds external dependency and cost. Dashboard needs to query errors via its own API, not redirect to a third-party UI.

**Implementation**: `logError()` helper called from catch blocks in API clients, queue workers, file parsers, and Slack handlers. Fire-and-forget pattern (same as `logAudit()`). Error categories derived from the call site. Stack traces captured via `Error.stack`. Job context (jobId, userId, channelId, teamId) passed from the calling context.

---

### 3. Admin Authentication

**Decision**: Per-admin API keys stored in an `AdminUser` database table, validated via `X-Admin-Key` header on all `/api/v1/admin/*` routes.

**Rationale**: Individual admin keys provide audit trail (which admin performed which action) without the complexity of session management, OAuth flows, or user registration UI. Aligned with the existing API key pattern (enrichment uses `X-API-Key`).

**Alternatives considered**:
- **Shared admin API key (env var)**: Rejected — no per-admin audit trail. Cannot attribute error resolutions or threshold changes to specific admins.
- **JWT with login**: Rejected — requires login UI, token refresh, session management. Over-engineered for ~5 admin users with no frontend UI.
- **OAuth2 / SSO**: Rejected — massive implementation effort for an API-only dashboard with 5 users. No frontend to display login flows.

**Implementation**: `AdminUser` table stores `api_key` (hashed), `name`, `email`, `is_active`. Keys generated via CLI script or DB seed. Middleware extracts `X-Admin-Key` header, hashes it, looks up in AdminUser table, attaches admin identity to request context.

---

### 4. Rate Limiting Strategy

**Decision**: Redis-based sliding window rate limiter using INCR + EXPIRE, keyed by admin ID. 100 requests/minute per admin.

**Rationale**: Redis is already a dependency (BullMQ, conversation state). Sliding window provides fair rate limiting. In-memory alternatives lose state on restart.

**Alternatives considered**:
- **In-memory rate limiter (Map)**: Rejected — loses state on process restart. In a multi-process deployment (future), wouldn't share state across instances.
- **express-rate-limit with memory store**: Same limitation as above.
- **Database-based**: Rejected — adds write latency to every request for rate limit checking.

**Implementation**: Redis key pattern `ratelimit:admin:{adminId}:{minuteBucket}`. INCR on each request, EXPIRE after 60s. If count > 100, return 429 Too Many Requests. Lightweight — single Redis round-trip per request.

---

### 5. Data Retention & Purge Strategy

**Decision**: BullMQ repeatable job runs daily, queries for records older than configured retention period, deletes in batches.

**Rationale**: Batch deletion prevents long-running transactions that could lock tables and impact enrichment processing. BullMQ repeatable jobs are already the established pattern for scheduled work.

**Alternatives considered**:
- **PostgreSQL partitioning by date**: Rejected — Prisma does not support table partitioning natively. Would require raw SQL and break ORM patterns.
- **TTL at database level**: Rejected — PostgreSQL does not support row-level TTL (unlike DynamoDB or Cassandra).
- **Soft delete (mark as expired)**: Rejected — doesn't reduce storage. The point of retention is to reclaim space.

**Implementation**: `RetentionConfig` stored in database (data type → retention days). Purge worker runs nightly after daily aggregation (to ensure aggregates are computed before raw data is deleted). Deletes in batches of 1,000 rows with a short sleep between batches to avoid lock contention. Logs purge results to AuditLog.

---

### 6. Scheduled Report Delivery

**Decision**: BullMQ repeatable jobs with cron patterns. Report generation produces CSV, uploads to S3, posts download link to configured Slack channel.

**Rationale**: BullMQ repeatable jobs are the established pattern for scheduled work in this project. S3 + Slack delivery reuses existing file delivery infrastructure from feature 1.

**Alternatives considered**:
- **node-cron**: Rejected — in-process scheduler. BullMQ repeatable jobs persist across restarts, provide retry logic, and are already a dependency.
- **External scheduler (CloudWatch Events)**: Rejected — adds AWS dependency for scheduling. BullMQ handles this natively.

**Implementation**: `ScheduledReport` table stores report config (type, frequency, Slack channel, filters). BullMQ repeatable job checks for due reports, generates CSV via existing `csv-stringify`, uploads to S3, posts to Slack channel via `@slack/bolt` `chat.postMessage`.

---

### 7. Budget Threshold Checking

**Decision**: Check thresholds after each API usage log write. Sum current month's spend and compare against configured thresholds.

**Rationale**: Checking after each API usage log ensures near-real-time alerting without a separate polling job. The query (SUM of estimated_cost_usd WHERE created_at >= month start) is fast with the existing `created_at` index on ApiUsageLog.

**Alternatives considered**:
- **Periodic polling job (every 5 min)**: Rejected — delays alerting by up to 5 minutes. More complex than inline check.
- **Redis counter incremented on each log write**: Rejected — Redis counter could drift from DB reality. Requires reconciliation logic.
- **Trigger/stored procedure**: Rejected — Prisma does not support database triggers. Would break ORM patterns.

**Implementation**: After `logApiUsage()` succeeds, call `checkThresholds(jobId)`. This queries current month's total spend (optionally per-provider), compares against active thresholds. If any threshold is crossed and not yet triggered this month, sends Slack notification and marks threshold as triggered. Query is a single indexed aggregation (~1ms).

---

### 8. CSV Export Strategy

**Decision**: Server-side CSV generation using existing `csv-stringify` dependency. Return as direct download for on-demand exports, upload to S3 for scheduled reports.

**Rationale**: `csv-stringify` is already a project dependency. No new dependencies needed. Direct streaming for on-demand requests keeps memory usage low.

**Alternatives considered**:
- **XLSX export**: Deferred — CSV covers the primary use case. XLSX export can be added later if needed (xlsx dependency already exists from feature 1).
- **Client-side generation**: N/A — API-only, no frontend.

**Implementation**: On-demand exports stream CSV directly in the HTTP response with `Content-Disposition: attachment`. Scheduled reports generate CSV to a temporary buffer, upload to S3, and include the pre-signed download URL in the Slack message.
