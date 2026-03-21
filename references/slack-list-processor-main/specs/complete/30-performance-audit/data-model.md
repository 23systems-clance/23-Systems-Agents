# Data Model: Performance Audit & Optimization

**Feature**: 30-performance-audit
**Date**: 2026-03-17

## Overview

This feature does not introduce new Prisma models. It adds database indexes to existing models, adds a Prisma query timing extension, and introduces a new BullMQ maintenance queue with a stale job scheduler. No schema migrations alter column definitions — only index additions.

## Schema Changes

### New Composite Indexes

The following indexes address query patterns identified during the audit. Each targets a specific slow query path in dashboard aggregation or enrichment pipeline queries.

#### Job Model

```prisma
model Job {
  // Existing indexes: slackChannelId, slackUserId, status, jobType, createdAt, slackTeamId, clientId

  // NEW: Composite index for dashboard overview query (status + date range filtering)
  @@index([status, createdAt])

  // NEW: Composite index for workspace cost aggregation (joins ApiUsageLog → Job)
  @@index([slackTeamId, createdAt])

  // NEW: Composite index for completed job cache stats aggregation
  @@index([status, completedAt])
}
```

**Justification**: The overview endpoint groups jobs by status within a date range. The workspace cost breakdown joins through Job.slackTeamId. Cache stats aggregate over recently completed jobs.

#### ApiUsageLog Model

```prisma
model ApiUsageLog {
  // Existing indexes: jobId, service, createdAt, slackTeamId

  // NEW: Composite index for cost aggregation (service + date range)
  @@index([service, createdAt])

  // NEW: Composite index for workspace-scoped usage queries
  @@index([slackTeamId, createdAt])

  // NEW: Composite index for error rate queries (status >= 400 within range)
  @@index([responseStatus, createdAt])
}
```

**Justification**: Usage trends aggregate by service and date. Workspace usage filters by team and date. Error rate queries filter by response status.

#### ErrorLog Model

```prisma
model ErrorLog {
  // Existing indexes: category, service, lifecycleState, jobId, slackTeamId, createdAt

  // NEW: Composite index for error trends query (category + date range)
  @@index([category, createdAt])

  // NEW: Composite index for filtered error listing (lifecycleState + date range)
  @@index([lifecycleState, createdAt])
}
```

**Justification**: Error trends currently loads ALL errors into memory for JavaScript-based grouping. With a composite index, the database can perform the grouping directly via `GROUP BY category, date_trunc(...)`.

#### DomainEnrichmentCache Model

```prisma
model DomainEnrichmentCache {
  // Existing indexes: expiresAt, enrichedAt, techSpendTier
  // Existing unique: normalizedDomain

  // NEW: Composite index for active cache entries (non-expired + domain lookup)
  @@index([normalizedDomain, expiresAt])
}
```

**Justification**: Cache lookup queries filter by domain AND check expiration. Composite index avoids index intersection.

#### ApolloSearchCache Model

```prisma
model ApolloSearchCache {
  // Existing indexes: expiresAt, searchedAt
  // Existing unique: [normalizedDomain, filterHash]

  // NEW: Composite index for batch lookup (domain + expiration check)
  @@index([normalizedDomain, expiresAt])
}
```

#### ApolloContactCache Model

```prisma
model ApolloContactCache {
  // Existing indexes: expiresAt, enrichedAt
  // Existing unique: apolloPersonId

  // NEW: Composite index for phone-aware cache lookup
  @@index([apolloPersonId, hasPhoneData, expiresAt])
}
```

**Justification**: Contact cache batch lookup filters by personId, phone availability, and expiration simultaneously.

## Index Migration Summary

| Model | New Index | Target Query |
|-------|-----------|-------------|
| Job | `[status, createdAt]` | Dashboard overview: job counts by status in date range |
| Job | `[slackTeamId, createdAt]` | Workspace cost breakdown |
| Job | `[status, completedAt]` | Cache stats: recently completed jobs |
| ApiUsageLog | `[service, createdAt]` | Usage trends: cost aggregation by service |
| ApiUsageLog | `[slackTeamId, createdAt]` | Workspace-scoped usage queries |
| ApiUsageLog | `[responseStatus, createdAt]` | Error rate calculation |
| ErrorLog | `[category, createdAt]` | Error trends: group by category + period |
| ErrorLog | `[lifecycleState, createdAt]` | Filtered error listing |
| DomainEnrichmentCache | `[normalizedDomain, expiresAt]` | Cache lookup with expiration check |
| ApolloSearchCache | `[normalizedDomain, expiresAt]` | Batch search cache lookup |
| ApolloContactCache | `[apolloPersonId, hasPhoneData, expiresAt]` | Phone-aware contact cache lookup |

**Total: 11 new composite indexes across 6 models.**

## BullMQ Queue Changes

### New: Maintenance Queue

```typescript
// Queue for periodic system maintenance tasks
const maintenanceQueue = new Queue('maintenance', {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: 100,
    removeOnFail: 200,
  },
});
```

### Stale Job Scheduler

```typescript
await maintenanceQueue.upsertJobScheduler(
  'stale-job-detector',
  { every: 5 * 60 * 1000 }, // every 5 minutes
  {
    name: 'detect-stale-jobs',
    data: { thresholdMs: 30 * 60 * 1000 }, // 30-minute timeout
  },
);
```

### Enrichment Queue Priority Update

Existing enrichment queue job options gain a `priority` field based on row count:

| Row Count | Priority Value | Label |
|-----------|---------------|-------|
| < 500 | 1 | High (small job) |
| 500 - 2000 | 5 | Normal (medium job) |
| > 2000 | 10 | Low (large job) |

## State Transitions

### Job Status (updated stale detection)

```
PENDING → PROCESSING → COMPLETED
                    → FAILED (explicit error)
                    → FAILED (stale job timeout: 30 min in PROCESSING)
         PROCESSING → AWAITING_PHONES → COMPLETED
                                      → FAILED
```

No new states. The stale job detector transitions `PROCESSING → FAILED` for jobs exceeding the 30-minute threshold.

## File Generation Changes (No Schema Impact)

File generation switches from SheetJS in-memory buffer to ExcelJS streaming writer. This is a code-only change — no Prisma schema impact. Database reads during file generation will use cursor-based pagination (`findMany` with `skip/take` in chunks of 500) instead of loading all records at once.
