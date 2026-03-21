# Quickstart: Backend Admin Dashboard

**Feature Branch**: `3-admin-dashboard`
**Date**: 2026-03-05

## Prerequisites

All prerequisites from feature 1 (Slack List Processor) apply. The admin dashboard extends the existing service.

- **Existing service running**: Feature 1 must be deployed and operational
- **Node.js** >= 18.x
- **Redis** >= 6.x (already required by feature 1)
- **PostgreSQL** >= 14.x (already required by feature 1)
- **No new external API keys needed** — dashboard reads existing data

## 1. Environment Variables (New)

Add the following to your `.env` file:

```env
# Admin Dashboard
ADMIN_RATE_LIMIT_RPM=100          # Requests per minute per admin key (default: 100)
```

Admin API keys are stored in the database (AdminUser table), not in environment variables.

## 2. Database Migration

```bash
# Generate and apply the new migration
npx prisma migrate dev --name admin_dashboard

# Verify new tables exist
npx prisma studio
# Should see: AdminUser, ErrorLog, BudgetThreshold, ScheduledReport, DailyAggregate, RetentionConfig
```

## 3. Seed Admin User

Create your first admin user. The seed script generates a random API key and displays it once:

```bash
npx tsx src/scripts/seedAdmin.ts --name "Your Name" --email "admin@example.com"
```

Expected output:
```
Admin user created:
  Name: Your Name
  Email: admin@example.com
  API Key: adm_a1b2c3d4e5f6... (SAVE THIS — shown only once)
```

## 4. Seed Retention Defaults

```bash
npx tsx src/scripts/seedRetention.ts
```

Creates default retention configs:
| Data Type | Retention |
|-----------|-----------|
| api_usage_logs | 90 days |
| error_logs | 180 days |
| audit_logs | Permanent |
| daily_aggregates | Permanent |

## 5. Verify Admin Access

```bash
# Health check (no auth needed)
curl http://localhost:3000/api/v1/health

# Admin overview (requires admin key)
curl -H "X-Admin-Key: adm_a1b2c3d4e5f6..." http://localhost:3000/api/v1/admin/overview

# Expected: JSON with summary metrics (may be zeros if no enrichment jobs have run yet)
```

## 6. Key Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/v1/admin/overview` | GET | Dashboard summary metrics |
| `/api/v1/admin/usage/trends` | GET | Cost/usage time-series data |
| `/api/v1/admin/usage/logs` | GET | Paginated API call log with filters |
| `/api/v1/admin/errors` | GET | Paginated error log with filters |
| `/api/v1/admin/errors/:id` | GET | Error detail with stack trace |
| `/api/v1/admin/errors/:id` | PATCH | Update error lifecycle state |
| `/api/v1/admin/errors/trends` | GET | Error frequency trends |
| `/api/v1/admin/clients` | GET | Client workspace list with metrics |
| `/api/v1/admin/clients/:team_id` | GET | Per-client detail view |
| `/api/v1/admin/thresholds` | GET/POST | List/create budget thresholds |
| `/api/v1/admin/thresholds/:id` | PUT/DELETE | Update/delete thresholds |
| `/api/v1/admin/reports/export` | POST | On-demand CSV export |
| `/api/v1/admin/reports/scheduled` | GET/POST | List/create scheduled reports |
| `/api/v1/admin/retention` | GET | View retention config |
| `/api/v1/admin/retention/:type` | PUT | Update retention periods |

## 7. Background Workers

The following BullMQ workers run automatically:

| Worker | Schedule | Purpose |
|--------|----------|---------|
| `daily-aggregate` | Daily at 00:30 UTC | Pre-compute cost/usage aggregates |
| `retention-purge` | Daily at 01:00 UTC | Purge expired raw records |
| `scheduled-report` | Per-config (daily/weekly/monthly) | Generate and deliver reports |

Workers start automatically with the main application process. No separate worker process needed.

## 8. Running Tests

```bash
# Run all admin dashboard tests
npx vitest run tests/unit/services/aggregation.test.ts
npx vitest run tests/unit/services/thresholdChecker.test.ts
npx vitest run tests/integration/adminApi.test.ts

# Run all tests
npm test
```

## 9. Architecture Notes

- **No frontend UI** — all dashboard interaction is via REST API. A frontend can be built separately.
- **Same process** — admin routes run in the same Node.js process as the enrichment service.
- **Admin auth is separate** — `X-Admin-Key` header is independent from enrichment `X-API-Key`.
- **Read-heavy** — most endpoints are read-only aggregation queries. Only error state updates, threshold config, and report scheduling perform writes.
- **Threshold alerts are inline** — checked after each API usage log write, not on a polling schedule.
