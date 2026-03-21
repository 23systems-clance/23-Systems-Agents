# API Contracts: Performance Audit & Optimization

**Feature**: 30-performance-audit
**Date**: 2026-03-17

## Overview

No new API endpoints are introduced. This document specifies changes to existing admin dashboard API endpoint behavior for performance optimization.

## Modified Endpoints

### GET /api/v1/admin/errors/trends

**Current behavior**: Loads ALL errors in date range into memory, then groups via JavaScript `Map<group, Map<period, count>>`.

**New behavior**: Database-side aggregation using `GROUP BY` with composite indexes.

**Request** (unchanged):
```
GET /api/v1/admin/errors/trends?startDate=2026-01-01&endDate=2026-03-17&granularity=daily&groupBy=category
```

**Response** (unchanged — same shape, faster):
```json
{
  "trends": [
    {
      "group": "API_ERROR",
      "data": [
        { "period": "2026-03-01", "count": 15 },
        { "period": "2026-03-02", "count": 8 }
      ]
    }
  ],
  "granularity": "daily",
  "startDate": "2026-01-01",
  "endDate": "2026-03-17"
}
```

**Performance target**: < 2 seconds for 10,000+ error records (currently unbounded due to in-memory load).

**Implementation**: Replace `findMany()` + JS grouping with Prisma `$queryRaw` using `date_trunc()` and `GROUP BY`.

---

### GET /api/v1/admin/usage/logs

**Current behavior**: Paginated, but no enforced maximum page size.

**New behavior**: Enforce maximum page size of 100 records. Default page size of 50.

**Request**:
```
GET /api/v1/admin/usage/logs?limit=50&offset=0&startDate=2026-01-01&endDate=2026-03-17
```

**Validation change**:
- `limit`: min 1, max 100 (previously unbounded)
- `offset`: min 0 (unchanged)

---

### GET /api/v1/admin/overview

**Current behavior**: Runs 5+ parallel aggregation queries.

**New behavior**: Same queries with composite index support. No API contract change.

**Performance target**: < 3 seconds total response time.

---

### GET /api/v1/admin/cache/metrics

**New fields added to response** (additive — non-breaking):

```json
{
  "domainCache": {
    "totalEntries": 1500,
    "activeEntries": 1200,
    "expiredEntries": 300,
    "hitRate7d": 0.87,
    "hitRate30d": 0.92,
    "estimatedCreditsSaved7d": 450,
    "estimatedCreditsSaved30d": 1800,
    "cacheSize": "12 MB",
    "topDomains": [...]
  },
  "systemMetrics": {
    "staleCacheEntries": 45,
    "cacheValidationErrors": 0
  }
}
```

**New field**: `systemMetrics.staleCacheEntries` — count of entries past TTL but not yet purged.
**New field**: `systemMetrics.cacheValidationErrors` — count of entries that failed integrity checks.

---

## New Internal Contracts (Not API — Worker Communication)

### Stale Job Detection (BullMQ Job)

**Queue**: `maintenance`
**Job Name**: `detect-stale-jobs`
**Schedule**: Every 5 minutes via `upsertJobScheduler`

**Job Data**:
```typescript
interface StaleJobDetectorData {
  thresholdMs: number; // default: 1_800_000 (30 minutes)
}
```

**Behavior**:
1. Query `Job` where `status = 'PROCESSING'` AND `startedAt < NOW() - thresholdMs`
2. For each stale job:
   - Update status to `FAILED`
   - Set `errorMessage` to `"Job timed out after 30 minutes in PROCESSING state (stale job detection)"`
   - Send Slack notification to originating channel
3. Emit CloudWatch metric: `StaleJobsDetected` (count)

---

### CloudWatch Metrics Namespace

**Namespace**: `SlackListProcessor`

**Dimensions**:
| Dimension | Values |
|-----------|--------|
| Service | `Enrichment`, `FileGeneration`, `Cache`, `AdminAPI`, `SlackDelivery` |
| JobType | `TECHNOGRAPHIC`, `CONTACT`, `COMBINED`, `TECH_REPORT` |

**Metrics Emitted**:

| Metric Name | Unit | Service | Description |
|-------------|------|---------|-------------|
| JobDuration | Milliseconds | Enrichment | Total enrichment job processing time |
| JobsProcessed | Count | Enrichment | Jobs completed (success or failure) |
| JobsFailed | Count | Enrichment | Jobs that ended in FAILED status |
| StaleJobsDetected | Count | Enrichment | Jobs detected as stale per sweep |
| MemoryUsageMB | Megabytes | Enrichment | Process RSS memory during job processing |
| FileGenerationDuration | Milliseconds | FileGeneration | Time to generate output file |
| CacheHitRate | Percent | Cache | Domain cache hit rate per job |
| CacheMissCount | Count | Cache | Cache misses per job |
| ApiCallDuration | Milliseconds | Enrichment | Per-call latency to external APIs |
| DbQueryDuration | Milliseconds | AdminAPI | Prisma query execution time (slow queries > 500ms) |
| SlackDeliveryRetries | Count | SlackDelivery | Retry count for message delivery |
| SlackDeliveryFailures | Count | SlackDelivery | Permanent delivery failures |

**Properties** (high-cardinality, not dimensions):
- `JobId`: UUID of the enrichment job
- `SlackTeamId`: Workspace identifier
- `QueryModel`: Prisma model name (for DB query metrics)
- `QueryOperation`: Prisma operation (findMany, aggregate, etc.)
