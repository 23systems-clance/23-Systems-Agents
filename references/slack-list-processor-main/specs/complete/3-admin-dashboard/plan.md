# Implementation Plan: Backend Admin Dashboard

**Branch**: `3-admin-dashboard` | **Date**: 2026-03-05 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/3-admin-dashboard/spec.md`

## Summary

Build a backend admin dashboard (REST API-only) that provides comprehensive operational visibility into the Slack List Processor service. Surfaces existing ApiUsageLog data through aggregation endpoints for cost tracking and API call browsing, introduces a new database-backed ErrorLog entity for centralized error monitoring with three-state lifecycle (Open → Acknowledged → Resolved), adds per-client usage aggregation derived from Job records, budget threshold alerting via Slack notifications, configurable data retention with automated purging, scheduled report generation via BullMQ repeatable jobs, and CSV export capabilities. All endpoints are secured with per-admin API keys distinct from the enrichment API auth.

## Technical Context

**Language/Version**: TypeScript 5.x (strict mode, ES2022 target) — same as feature 1
**Primary Dependencies**: express ^5.2.1 (existing HTTP server), @prisma/client ^7.4.2 (existing ORM), bullmq ^5.70.1 (existing queue — reused for scheduled reports and retention purge jobs), ioredis ^5.10.0 (existing — reused for rate limiting counters), csv-stringify ^6.6.0 (existing — for CSV export), @slack/bolt ^4.6.0 (existing — for threshold alert notifications)
**Storage**: PostgreSQL (Prisma ORM) — extend existing schema with new models: ErrorLog, AdminUser, BudgetThreshold, ScheduledReport, DailyAggregate, RetentionConfig. Redis — rate limit counters (per-admin sliding window).
**Testing**: Vitest (existing)
**Target Platform**: Node.js 18+ backend service (ECS Fargate) — same process as enrichment service
**Project Type**: Single project — extends existing backend service with new route modules
**Performance Goals**: Aggregation queries < 3s (SC-001), filtered list queries < 2s (SC-002), < 5% impact on enrichment processing (SC-006)
**Constraints**: Per-admin rate limit 100 req/min (FR-026), 5 concurrent admin users (SC-010), API-only (no frontend UI)
**Scale/Scope**: Moderate data volume — thousands of ApiUsageLog rows/day, hundreds of ErrorLog entries/day, ~5-20 client workspaces

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

| Principle | Status | Notes |
|-----------|--------|-------|
| I. CRM-First | DEVIATION | Same deviation as feature 1 — standalone Slack bot service. Dashboard adds admin visibility to the same service. |
| II. Plugin Ecosystem | DEVIATION | Same deviation as feature 1 — not a plugin. Dashboard is an extension of the standalone service. Cost Tracking plugin concept from constitution (Principle II) is implemented here as REST API endpoints rather than a WordPress-style plugin. |
| III. API-First | PASS | All dashboard functionality exposed via REST API before any UI. OpenAPI contracts defined. |
| IV. Client Isolation | PASS | Client data scoped by `slack_team_id`. Admin dashboard provides cross-tenant visibility (appropriate for admin role). Individual client views enforce correct scoping. |
| V. SOC 2 / Audit Logging | PASS | All admin actions (error state changes, threshold config, report exports) are attributed to the authenticated admin and logged. Error resolution audit trail maintained. |
| VI. Cost Tracking | PASS | This feature IS the cost tracking dashboard. Surfaces existing ApiUsageLog data with aggregation, trending, and alerting. |
| VII. Deviation Prevention | PASS | Constitution check performed. Deviations carried forward from feature 1 and documented. |
| VIII. Integration-Centric | PASS | Dashboard reads from existing integration logs (BuiltWith, Apollo, Claude). No new external integrations. |
| IX. Sequence-Driven | N/A | Not applicable (no campaign sequences). |
| X. Enrichment as Foundation | N/A | Dashboard monitors enrichment — does not perform it. |
| XI. Context-First | PASS | Research completed. All spec clarifications resolved. |
| XII. Holistic Awareness | PASS | Dashboard connects to existing Job, ApiUsageLog, AuditLog models. New ErrorLog entity integrates with existing error handling patterns across all services. |
| XIII. Confirmation-Required | PASS | Admin actions (threshold config, error state changes) require explicit API calls. No destructive operations without intent. |
| XIV. UI/UX First | N/A | API-only feature — no frontend UI in scope. |
| XV. Dev Nav Index | N/A | No web UI. |
| XVI. MCP Research | PASS | Research completed for aggregation patterns, rate limiting, and retention strategies. |

## Project Structure

### Documentation (this feature)

```text
specs/3-admin-dashboard/
├── plan.md              # This file
├── research.md          # Phase 0 output - technology decisions
├── data-model.md        # Phase 1 output - database schema extensions
├── quickstart.md        # Phase 1 output - setup guide
├── contracts/
│   └── api-contracts.md # Phase 1 output - REST API contracts
└── tasks.md             # Phase 2 output (/speckit.tasks command)
```

### Source Code (repository root)

```text
src/
├── app.ts                              # Existing - add admin route registration
├── server.ts                           # Existing - mount admin router
├── config/
│   └── index.ts                        # Existing - add admin config vars
├── routes/
│   ├── health.ts                       # Existing
│   ├── jobs.ts                         # Existing
│   ├── webhooks/
│   │   └── apollo.ts                   # Existing
│   └── admin/                          # NEW - Admin dashboard routes
│       ├── index.ts                    # Admin router with auth + rate limit middleware
│       ├── overview.ts                 # GET /api/v1/admin/overview
│       ├── usage.ts                    # GET /api/v1/admin/usage/logs, /usage/trends
│       ├── errors.ts                   # GET/PATCH /api/v1/admin/errors
│       ├── clients.ts                  # GET /api/v1/admin/clients
│       ├── thresholds.ts              # GET/POST/PUT/DELETE /api/v1/admin/thresholds
│       ├── reports.ts                  # POST /api/v1/admin/reports/export, /reports/scheduled
│       └── retention.ts               # GET/PUT /api/v1/admin/retention
├── services/
│   ├── admin/                          # NEW - Admin dashboard services
│   │   ├── aggregation.ts             # Cost/usage aggregation queries
│   │   ├── errorLogger.ts             # Database-backed error logging
│   │   ├── clientInsights.ts          # Per-client metrics computation
│   │   ├── thresholdChecker.ts        # Budget threshold evaluation + alerting
│   │   ├── reportGenerator.ts         # CSV report generation
│   │   └── retentionManager.ts        # Data retention purge logic
│   ├── queue/
│   │   ├── queues.ts                   # Existing - add admin queues
│   │   └── workers/
│   │       ├── scheduledReport.ts     # NEW - Scheduled report generation worker
│   │       ├── retentionPurge.ts      # NEW - Data retention purge worker
│   │       └── dailyAggregate.ts      # NEW - Daily pre-computation worker
│   └── ...                             # Existing services unchanged
├── lib/
│   ├── adminAuth.ts                   # NEW - Admin API key authentication middleware
│   ├── adminRateLimit.ts              # NEW - Per-admin rate limiting middleware
│   ├── apiAuth.ts                      # Existing - enrichment API auth
│   └── ...                             # Existing lib unchanged
└── ...

tests/
├── unit/
│   └── services/
│       ├── aggregation.test.ts        # NEW
│       ├── thresholdChecker.test.ts   # NEW
│       ├── retentionManager.test.ts   # NEW
│       └── ...                         # Existing tests unchanged
├── integration/
│   ├── adminApi.test.ts               # NEW - Admin endpoint integration tests
│   └── ...                             # Existing tests unchanged
└── contract/
    └── adminContracts.test.ts         # NEW - Admin API contract tests

prisma/
├── schema.prisma                       # Extended with new models
└── migrations/
    └── YYYYMMDD_admin_dashboard/      # NEW migration
```

**Structure Decision**: Extends existing single project (Option 1). Admin dashboard is added as a new route module (`src/routes/admin/`) and service module (`src/services/admin/`) within the same Node.js process. No separate service needed at this scale (~5 concurrent admin users). Admin routes are mounted under `/api/v1/admin/` with separate auth middleware.

## Complexity Tracking

| Deviation | Why Needed | Simpler Alternative Rejected Because |
|-----------|-----------|--------------------------------------|
| Standalone service (inherited from feature 1) | Same justification as feature 1 | N/A |
| Redis dependency for rate limiting | Per-admin sliding window counters need atomic increment + TTL | In-memory Map loses state on restart; PostgreSQL adds latency to every request |
| DailyAggregate pre-computation table | Cost trending queries across months of data would be too slow on raw ApiUsageLog | Querying raw logs for 90+ day ranges at daily granularity exceeds 3s target; materialized views not supported by Prisma |
| Separate admin auth middleware | Admin keys need per-key identity for audit trail | Reusing enrichment X-API-Key has no admin identity; a shared admin key provides no audit trail |
