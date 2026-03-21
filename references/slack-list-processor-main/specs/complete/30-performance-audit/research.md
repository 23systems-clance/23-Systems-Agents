# Research: Performance Audit & Optimization

**Feature**: 30-performance-audit
**Date**: 2026-03-17

## R1: BullMQ Job Priority

**Decision**: Use BullMQ's built-in `opts.priority` on the existing enrichment queue. Map row-count tiers: small (<500) = priority 1, medium (500-2000) = priority 5, large (2000+) = priority 10.

**Rationale**: BullMQ supports priority values 1 (highest) to 2,097,152 (lowest) natively via Redis sorted sets. Works on the same queue — no separate queues needed. Within the same priority tier, jobs are FIFO.

**Gotcha**: Jobs added **without** a priority get processed **before** all prioritized jobs. All jobs must explicitly set priority for consistent ordering.

**Alternatives Considered**:
- Separate queues per size tier: More control but adds operational complexity (multiple workers, monitoring). Rejected — overkill for single-concurrency worker.
- Time-based aging: Adds complexity without clear benefit when row count directly correlates with processing time.

**API**:
```typescript
await enrichmentQueue.add('combined-enrichment', data, { priority: 1 }); // small job
await enrichmentQueue.add('combined-enrichment', data, { priority: 10 }); // large job
```

---

## R2: CloudWatch Metrics via Embedded Metric Format (EMF)

**Decision**: Use `aws-embedded-metrics` npm package to emit custom CloudWatch metrics via Embedded Metric Format (EMF). Do NOT use `@aws-sdk/client-cloudwatch` PutMetricData.

**Rationale**: EMF writes structured JSON to stdout/CloudWatch Logs. CloudWatch automatically extracts and publishes as metrics. Zero additional API call latency. PutMetricData adds synchronous HTTP overhead and costs $0.01/1,000 API requests.

**ECS Task Role**: Requires `logs:PutLogEvents` and `logs:CreateLogGroup` permissions. Does NOT need `cloudwatch:PutMetricData`.

**Environment Variables** (ECS task definition):
```json
{ "name": "AWS_EMF_ENVIRONMENT", "value": "ECS" },
{ "name": "AWS_EMF_NAMESPACE", "value": "SlackListProcessor" },
{ "name": "AWS_EMF_LOG_GROUP_NAME", "value": "/ecs/prod-slack-list-processor" }
```

**Key Rule**: Use `putDimensions()` for low-cardinality grouping (service, job type). Use `setProperty()` for high-cardinality data (job IDs) to avoid metric explosion.

**Alternatives Considered**:
- `@aws-sdk/client-cloudwatch` PutMetricData: Appropriate for low-frequency metrics only. Rejected for high-frequency in-process metrics due to latency.
- Datadog/Axiom: External SaaS. Rejected — EMF is native to AWS with no additional infrastructure.

---

## R3: Prisma Query Timing

**Decision**: Use Prisma `$extends` query extension (NOT deprecated `$use` middleware) to time all queries and emit slow query warnings + CloudWatch metrics.

**Rationale**: Prisma deprecated `$use` middleware in v4.16.0 and removed it in v6.14.0. `$extends()` with a `query` component provides full type safety and composability.

**API**:
```typescript
const prisma = new PrismaClient().$extends({
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        const start = performance.now();
        const result = await query(args);
        const duration = performance.now() - start;
        if (duration > 500) {
          logger.warn(`[SLOW QUERY] ${model}.${operation}: ${duration.toFixed(1)}ms`);
        }
        // Emit CloudWatch metric via EMF
        return result;
      },
    },
  },
});
```

**Alternatives Considered**:
- Prisma `$on('query')` events: Fires asynchronously, no request context. Better for development logging only.
- Prisma Optimize SaaS: External dependency. Rejected for simplicity.

---

## R4: Streaming Excel Generation

**Decision**: Switch file generation from SheetJS (`xlsx`) to **ExcelJS** (`exceljs`) for streaming XLSX output. Keep SheetJS for file parsing (reading uploaded files).

**Rationale**: SheetJS `XLSX.stream.*` only supports CSV/HTML/JSON streaming — NOT `.xlsx` format. For XLSX, SheetJS requires the entire workbook in memory. ExcelJS provides `stream.xlsx.WorkbookWriter` that writes rows incrementally, keeping memory constant regardless of dataset size.

**API**:
```typescript
import ExcelJS from 'exceljs';

const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
  filename: '/tmp/output.xlsx',
  useStyles: true,
});
const sheet = workbook.addWorksheet('Results');
sheet.columns = [/* column definitions */];

for (const row of dataChunks) {
  sheet.addRow(row).commit(); // flush row immediately
}
await sheet.commit();
await workbook.commit();
```

**Gotchas**:
- Must call `.commit()` on each row, then worksheet, then workbook.
- Once committed, rows cannot be edited.
- `useSharedStrings: true` reduces file size but slightly increases memory.

**Alternatives Considered**:
- SheetJS in-memory: Current approach. Rejected for 5,000-row jobs with contacts — memory risk at 1 GB container limit.
- CSV-only output: Lower memory but loses Excel formatting. Rejected — users expect XLSX.

---

## R5: BullMQ Repeatable Jobs for Stale Job Detection

**Decision**: Use `queue.upsertJobScheduler()` API (BullMQ v5.16.0+) for a repeatable stale job detection task running every 5 minutes.

**Rationale**: `upsertJobScheduler` is idempotent — calling on every app startup creates or updates the scheduler without duplicates. The older `queue.add(..., { repeat: {} })` pattern had a known problem of creating duplicate schedulers across restarts.

**API**:
```typescript
await maintenanceQueue.upsertJobScheduler(
  'stale-job-detector',
  { every: 5 * 60 * 1000 }, // every 5 minutes
  {
    name: 'detect-stale-jobs',
    data: { thresholdMs: 30 * 60 * 1000 }, // 30 minutes
    opts: { removeOnComplete: 100, removeOnFail: 200 },
  },
);
```

**Gotchas**:
- Scheduler produces next job only after current job **starts** processing. Interval is `max(interval, processing_delay)`.
- `every` is in milliseconds, not seconds.
- Call `upsertJobScheduler` on every app boot for idempotent setup.

**Alternatives Considered**:
- `setInterval` in-process: Does not survive process restarts or ECS task recycling. Rejected.
- `node-cron`: Not distributed. Rejected — BullMQ scheduler persists in Redis.

---

## R6: Batch Database Operations with Transactions

**Decision**: Use Prisma `$transaction()` for batch operations (company inserts, contact inserts, technology inserts) to ensure atomicity.

**Rationale**: Current code creates companies, technologies, and contacts in separate Prisma calls without transaction wrapping. A failure mid-batch leaves orphaned partial records. Prisma interactive transactions (`$transaction(async (tx) => { ... })`) ensure all-or-nothing.

**API**:
```typescript
await prisma.$transaction(async (tx) => {
  const company = await tx.jobCompany.create({ data: companyData });
  await tx.companyTechnology.createMany({ data: techRecords });
  await tx.jobContact.createMany({ data: contactRecords });
});
```

**Constraints**: Interactive transactions have a default timeout of 5 seconds. For large batches, increase via `timeout` option: `prisma.$transaction(fn, { timeout: 30000 })`.

---

## R7: Slack Message Retry with Backoff

**Decision**: Implement a shared `retryWithBackoff()` utility wrapping Slack SDK calls with exponential backoff (3 retries, 2s initial delay, 2x multiplier).

**Rationale**: Current Slack message delivery is fire-and-forget. Rate limit (429) responses from Slack include `Retry-After` headers. The retry utility should honor this header when present, falling back to exponential backoff otherwise.

**Pattern**:
```typescript
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  opts: { maxRetries: 3, initialDelay: 2000, multiplier: 2 }
): Promise<T> {
  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === opts.maxRetries) throw err;
      const delay = opts.initialDelay * Math.pow(opts.multiplier, attempt);
      await sleep(delay);
    }
  }
}
```

**Alternatives Considered**:
- Queue-based retry via BullMQ: Adds complexity for a simple fire-and-forget notification. Rejected unless failures become frequent.
- Slack SDK built-in retry: `@slack/web-api` has `retryConfig` but it only applies to rate limits, not network errors.
