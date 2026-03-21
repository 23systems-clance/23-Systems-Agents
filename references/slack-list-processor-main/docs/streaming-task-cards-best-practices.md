# Streaming Task Cards - Best Practices Guide

**Purpose:** Ensure all enrichment workflows follow the correct streaming task card pattern to avoid common pitfalls.

---

## Table of Contents

1. [Overview](#overview)
2. [The Streaming Pattern](#the-streaming-pattern)
3. [Task Definition Rules](#task-definition-rules)
4. [Worker Implementation Rules](#worker-implementation-rules)
5. [Common Pitfalls](#common-pitfalls)
6. [Implementation Checklist](#implementation-checklist)
7. [Reference Implementations](#reference-implementations)

---

## Overview

Slack streaming task cards provide real-time progress visualization for long-running enrichment jobs. This guide documents the correct implementation pattern discovered after fixing multiple streaming issues in March 2026.

**Key Principle:** Task-mode streams (`task_display_mode: 'plan'`) have strict API limitations that differ from message-mode streams.

---

## The Streaming Pattern

### Architecture Flow

```
[Bolt Action Handler]
    ↓ 1. Start stream with initial plan
[streamingHelper.startStream()]
    ↓ 2. Subscribe to Redis pub/sub
[taskVisualizer.subscribeToProgress()]
    ↓ 3. Enqueue job
[BullMQ Queue]
    ↓ 4. Worker processes job
[Worker (e.g., techReport.ts)]
    ↓ 5. Publish progress events
[Redis pub/sub channel: agent:progress:{jobId}]
    ↓ 6. Convert to task chunks
[taskVisualizer.mapProgressToChunks()]
    ↓ 7. Update Slack UI
[session.appendChunks()]
    ↓ 8. Auto-close on final stage
[session.stop()]
```

### Code Pattern (Action Handler)

```typescript
import { startStream, type StreamConfig } from '../../services/agent/streamingHelper.js';
import { buildInitialPlan, subscribeToProgress } from '../../services/agent/taskVisualizer.js';

// 1. Set up stream configuration
const streamConfig: StreamConfig = {
  client,
  channel: channelId,
  threadTs,
  userId,
  teamId,
};

// 2. Build initial plan with all tasks in 'pending' state
const enrichType = 'technographic'; // or 'contact', 'combined', 'tech_report'
const initialChunks = buildInitialPlan(enrichType, 'Technographic Enrichment');

// 3. Start the stream in task display mode
const session = await startStream(streamConfig, {
  taskDisplayMode: 'plan',
  initialChunks,
});

// 4. Subscribe to Redis pub/sub for this job
subscribeToProgress(jobId, enrichType, session);

// 5. Enqueue the job
await enrichmentQueue.add('technographic-enrichment', {
  jobId,
  companies: [...],
});
```

### Code Pattern (Worker)

```typescript
import { publishProgress } from '../../services/agent/taskVisualizer.js';

// At the start of each stage
await publishProgress({
  jobId,
  stage: 'parse',
  status: 'in_progress',
});

// When stage completes successfully
await publishProgress({
  jobId,
  stage: 'parse',
  status: 'complete',
  detail: 'Optional detail message', // Optional
});

// On stage error
await publishProgress({
  jobId,
  stage: 'parse',
  status: 'error',
  detail: 'Error description',
});
```

---

## Task Definition Rules

### Rule 1: Define All Pipeline Stages

Every enrichment type MUST have a complete task definition in `taskVisualizer.ts`:

```typescript
// src/services/agent/taskVisualizer.ts

const ENRICHMENT_PIPELINE_TASKS: Record<string, PipelineTask[]> = {
  technographic: [
    { id: 'parse', title: 'Parsing uploaded file' },
    { id: 'validate', title: 'Validating data structure' },
    { id: 'builtwith', title: 'Looking up technology stacks' },
    { id: 'classify', title: 'Classifying tech spend tiers' },
    { id: 'generate', title: 'Generating output file' },
  ],
  tech_report: [
    { id: 'query', title: 'Querying enrichment data' },
    { id: 'narrative', title: 'Generating output file' },
  ],
  // Add more as needed...
};
```

### Rule 2: Task IDs Must Match Worker Events

**CRITICAL:** Every stage `id` in the task definition MUST have corresponding `publishProgress()` calls in the worker.

```typescript
// ❌ BAD - Will show red error icon
tech_report: [
  { id: 'query', title: 'Querying data' },
  { id: 'analyze', title: 'Analyzing results' },  // ← No publishProgress() for 'analyze' in worker
  { id: 'narrative', title: 'Generating file' },
]

// ✅ GOOD - All stages have matching publishProgress() calls
tech_report: [
  { id: 'query', title: 'Querying data' },
  { id: 'narrative', title: 'Generating file' },
]
```

### Rule 3: Stages Must Execute in Order

Tasks are displayed in the order they appear in the definition. Workers should publish progress events in the same order.

---

## Worker Implementation Rules

### Rule 4: Publish Progress at Every Stage

**Every stage MUST publish two events: `in_progress` and `complete` (or `error`).**

```typescript
// ✅ CORRECT - Full lifecycle
await publishProgress({ jobId, stage: 'builtwith', status: 'in_progress' });
try {
  // ... do the work ...
  await publishProgress({ jobId, stage: 'builtwith', status: 'complete' });
} catch (err) {
  await publishProgress({
    jobId,
    stage: 'builtwith',
    status: 'error',
    detail: err.message,
  });
}

// ❌ WRONG - Missing in_progress or complete
await publishProgress({ jobId, stage: 'builtwith', status: 'in_progress' });
// ... work happens but no completion event ...
```

### Rule 5: Final Stage MUST Publish Complete

The last stage in the pipeline MUST publish a `complete` event to trigger auto-close:

```typescript
// Last stage of pipeline
await fileGenerationQueue.add('generate-result-file', fileJobData);

// ✅ CRITICAL - This triggers task card auto-close
await publishProgress({ jobId, stage: 'generate', status: 'complete' });
```

**What happens if missing:**
- Task card will never close
- Last stage will show red error icon
- User sees perpetually "running" job

### Rule 6: Use Optional Details for Context

Add helpful context to progress events when useful:

```typescript
// Basic completion
await publishProgress({ jobId, stage: 'query', status: 'complete' });

// ✅ Better - With detail
await publishProgress({
  jobId,
  stage: 'query',
  status: 'complete',
  detail: `${resultCount} companies found`,
});
```

This shows as: "Querying enrichment data — 10 companies found"

---

## Common Pitfalls

### ❌ Pitfall 1: Using appendText() on Task-Mode Streams

**Error:** `streaming_mode_mismatch`

```typescript
// ❌ WRONG - Task-mode streams don't support markdown_text
const session = await startStream(config, {
  taskDisplayMode: 'plan',
  initialChunks,
});
await session.appendText('Starting query...');  // ← ERROR

// ✅ CORRECT - All updates via task chunks
subscribeToProgress(jobId, enrichType, session);
// Worker publishes progress events
// taskVisualizer converts to chunks automatically
```

### ❌ Pitfall 2: Passing markdown_text to stop()

**Error:** `streaming_mode_mismatch`

```typescript
// ❌ WRONG
await session.stop({ markdownText: 'All done!' });

// ✅ CORRECT
await session.stop();
```

### ❌ Pitfall 3: Phantom Stages in Task Definition

**Problem:** Red error icons on stages that never complete

```typescript
// ❌ WRONG - 'analyze' stage doesn't exist in worker
tech_report: [
  { id: 'query', title: 'Querying data' },
  { id: 'analyze', title: 'Analyzing results' },  // ← No publishProgress() for this
  { id: 'narrative', title: 'Generating file' },
]

// ✅ CORRECT - Only stages that worker actually implements
tech_report: [
  { id: 'query', title: 'Querying data' },
  { id: 'narrative', title: 'Generating file' },
]
```

### ❌ Pitfall 4: Missing Final Stage Completion

**Problem:** Task card never closes, last stage shows red error

```typescript
// ❌ WRONG - Worker enqueues file generation but doesn't publish completion
await fileGenerationQueue.add('generate-result-file', data);
// ... job ends without publishing progress ...

// ✅ CORRECT - Always publish final stage completion
await fileGenerationQueue.add('generate-result-file', data);
await publishProgress({ jobId, stage: 'generate', status: 'complete' });
```

### ❌ Pitfall 5: Not Handling Errors

**Problem:** Task card shows "in progress" forever when error occurs

```typescript
// ❌ WRONG - No error handling
await publishProgress({ jobId, stage: 'builtwith', status: 'in_progress' });
const data = await fetchTechStack(domain); // ← Could throw

// ✅ CORRECT - Publish error status
await publishProgress({ jobId, stage: 'builtwith', status: 'in_progress' });
try {
  const data = await fetchTechStack(domain);
  await publishProgress({ jobId, stage: 'builtwith', status: 'complete' });
} catch (err) {
  await publishProgress({
    jobId,
    stage: 'builtwith',
    status: 'error',
    detail: err.message,
  });
  throw err; // Re-throw for job failure handling
}
```

---

## Implementation Checklist

Use this checklist when implementing streaming for a new enrichment workflow:

### Task Definition Setup

- [ ] Add enrichment type to `ENRICHMENT_PIPELINE_TASKS` in `taskVisualizer.ts`
- [ ] Define all pipeline stages with unique IDs
- [ ] Ensure stage IDs match what worker will publish
- [ ] Add enrichment type to `formatPlanTitle()` mapping
- [ ] Verify stages are in execution order

### Action Handler Setup

- [ ] Import `startStream`, `buildInitialPlan`, `subscribeToProgress`
- [ ] Create `StreamConfig` with `client`, `channel`, `threadTs`, `userId`, `teamId`
- [ ] Call `buildInitialPlan()` with correct enrichment type
- [ ] Call `startStream()` with `taskDisplayMode: 'plan'` and `initialChunks`
- [ ] Call `subscribeToProgress()` with `jobId`, `enrichType`, and `session`
- [ ] Do NOT call `session.appendText()` or `session.flush()`
- [ ] Do NOT call `session.stop()` manually (auto-closes on final stage)

### Worker Implementation

- [ ] Import `publishProgress` from `taskVisualizer.ts`
- [ ] Publish `in_progress` at start of each stage
- [ ] Publish `complete` (or `error`) at end of each stage
- [ ] Add error handling with `status: 'error'` publishing
- [ ] Ensure final stage publishes `complete` to trigger auto-close
- [ ] Add optional `detail` messages for helpful context
- [ ] Verify all stage IDs match task definition

### Testing

- [ ] Test happy path (all stages complete successfully)
- [ ] Verify task card shows all stages in correct order
- [ ] Verify all stages show green checkmarks when complete
- [ ] Verify task card auto-closes when final stage completes
- [ ] Test error path (simulate failure in one stage)
- [ ] Verify error stage shows red icon with detail message
- [ ] Check CloudWatch logs for any `streaming_mode_mismatch` errors
- [ ] Test with cached data (if applicable)
- [ ] Test with fresh query (if applicable)

---

## Reference Implementations

### Example 1: Tech Report Intent Router

**File:** `src/services/agent/intentRouter.ts`

```typescript
// Intent: tech_report
const streamConfig: StreamConfig = {
  client,
  channel: channelId,
  threadTs,
  userId,
  teamId,
};

const initialChunks = buildInitialPlan('tech_report', `Technology Report: ${technology}`);
const session = await startStream(streamConfig, {
  taskDisplayMode: 'plan',
  initialChunks,
});

// Note: task-mode streams only accept chunks, not markdown_text
subscribeToProgress(jobId, 'tech_report', session);

await techReportQueue.add('generate-tech-report', {
  jobId,
  technology,
  filters,
});
```

**Worker:** `src/services/queue/workers/techReport.ts`

```typescript
import { publishProgress } from '../../services/agent/taskVisualizer.js';

// Stage 1: Query
await publishProgress({ jobId, stage: 'query', status: 'in_progress' });
// ... fetch data from cache/API ...
await publishProgress({
  jobId,
  stage: 'query',
  status: 'complete',
  detail: `${resultCount} companies found`,
});

// Stage 2: Narrative
await publishProgress({ jobId, stage: 'narrative', status: 'in_progress' });
// ... generate CSV file ...
await publishProgress({ jobId, stage: 'narrative', status: 'complete' });
```

**Task Definition:** `src/services/agent/taskVisualizer.ts`

```typescript
tech_report: [
  { id: 'query', title: 'Querying enrichment data' },
  { id: 'narrative', title: 'Generating output file' },
],
```

---

### Example 2: Tech Report Chain Enrichment

**File:** `src/listeners/actions/techReportChain.ts`

```typescript
// After user clicks "Get Technographics" button
const enrichType = 'technographic';

const streamConfig: StreamConfig = {
  client,
  channel: channelId,
  threadTs,
  userId,
  teamId,
};

const initialChunks = buildInitialPlan(enrichType, 'TECHNOGRAPHIC Enrichment');
const session = await startStream(streamConfig, {
  taskDisplayMode: 'plan',
  initialChunks,
});

subscribeToProgress(jobId, enrichType, session);

await enrichmentQueue.add('technographic-enrichment', {
  jobId: job.id,
  companies: companyData.map((c) => ({
    jobCompanyId: c.id,
    rowIndex: c.rowIndex,
    domain: c.domain,
    companyName: c.companyName ?? undefined,
  })),
});
```

**Worker:** `src/services/queue/workers/technographic.ts`

```typescript
import { publishProgress } from '../../services/agent/taskVisualizer.js';

// Stage 1: Parse
await publishProgress({ jobId, stage: 'parse', status: 'in_progress' });
// ... parse input data ...
await publishProgress({ jobId, stage: 'parse', status: 'complete' });

// Stage 2: Validate
await publishProgress({ jobId, stage: 'validate', status: 'in_progress' });
// ... validate domains ...
await publishProgress({ jobId, stage: 'validate', status: 'complete' });

// Stage 3: BuiltWith
await publishProgress({ jobId, stage: 'builtwith', status: 'in_progress' });
// ... fetch tech stacks ...
await publishProgress({ jobId, stage: 'builtwith', status: 'complete' });

// Stage 4: Classify
await publishProgress({ jobId, stage: 'classify', status: 'in_progress' });
// ... classify tech spend tiers ...
await publishProgress({ jobId, stage: 'classify', status: 'complete' });

// Stage 5: Generate (CRITICAL - triggers auto-close)
await fileGenerationQueue.add('generate-result-file', fileJobData);
await publishProgress({ jobId, stage: 'generate', status: 'complete' });
```

**Task Definition:** `src/services/agent/taskVisualizer.ts`

```typescript
technographic: [
  { id: 'parse', title: 'Parsing uploaded file' },
  { id: 'validate', title: 'Validating data structure' },
  { id: 'builtwith', title: 'Looking up technology stacks' },
  { id: 'classify', title: 'Classifying tech spend tiers' },
  { id: 'generate', title: 'Generating output file' },
],
```

---

### Example 3: Cache Decision Handler

**File:** `src/listeners/actions/cacheDecision.ts`

```typescript
// When user clicks "Run Fresh Query" button
app.action('tr_fresh_query', async ({ ack, body, client }) => {
  await ack();

  // ... parse cached data ...

  const streamConfig: StreamConfig = {
    client,
    channel: channelId,
    threadTs,
    userId,
    teamId,
  };

  const initialChunks = buildInitialPlan('tech_report', `Technology Report: ${technology}`);
  const session = await startStream(streamConfig, {
    taskDisplayMode: 'plan',
    initialChunks,
  });

  subscribeToProgress(jobId, 'tech_report', session);

  await techReportQueue.add('generate-tech-report', {
    jobId,
    technology,
    filters,
  });
});
```

---

## Debugging Streaming Issues

### Check CloudWatch Logs

Filter for streaming errors:
```
fields @timestamp, @message
| filter @message like /streaming_mode_mismatch/
| sort @timestamp desc
| limit 20
```

Filter for progress events:
```
fields @timestamp, @message
| filter @message like /agent progress/
| sort @timestamp desc
| limit 50
```

### Common Error Messages

| Error | Cause | Fix |
|-------|-------|-----|
| `streaming_mode_mismatch` (appendStream) | Called `appendText()` on task-mode stream | Remove `session.appendText()` calls |
| `streaming_mode_mismatch` (stopStream) | Called `stop({ markdownText })` on task-mode stream | Change to `session.stop()` |
| Task card never closes | Missing final stage completion event | Add `publishProgress()` for last stage |
| Red error icon on stage | Stage defined but never completes | Either remove from definition or add `publishProgress()` |
| Task card frozen | Worker not publishing progress events | Add `publishProgress()` calls to worker |

### Verify Progress Events

Check Redis pub/sub manually:
```typescript
// Subscribe to job's progress channel
const subscriber = redis.duplicate();
subscriber.subscribe(`agent:progress:${jobId}`, (err) => {
  if (err) console.error(err);
});
subscriber.on('message', (channel, message) => {
  console.log('Progress event:', JSON.parse(message));
});
```

---

## Related Files

- **Task Definitions:** `src/services/agent/taskVisualizer.ts`
- **Streaming Helper:** `src/services/agent/streamingHelper.ts`
- **Intent Router:** `src/services/agent/intentRouter.ts`
- **Workers:**
  - `src/services/queue/workers/techReport.ts`
  - `src/services/queue/workers/technographic.ts`
  - `src/services/queue/workers/contact.ts`
  - `src/services/queue/workers/combined.ts`
- **Action Handlers:**
  - `src/listeners/actions/cacheDecision.ts`
  - `src/listeners/actions/techReportChain.ts`
  - `src/listeners/actions/purposeSelection.ts`

---

## Version History

- **2026-03-13:** Initial documentation after fixing streaming issues
  - Documented task-mode stream limitations
  - Added comprehensive implementation checklist
  - Documented all common pitfalls with examples

---

**Last Updated:** 2026-03-13
**Author:** Based on fixes and learnings from streaming task card debugging session
