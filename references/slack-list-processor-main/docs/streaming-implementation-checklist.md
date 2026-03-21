# Streaming Task Cards - Quick Implementation Checklist

Use this checklist when adding streaming task cards to any enrichment workflow.

---

## Phase 1: Task Definition (taskVisualizer.ts)

```typescript
// src/services/agent/taskVisualizer.ts
```

- [ ] Add new entry to `ENRICHMENT_PIPELINE_TASKS`:
  ```typescript
  your_workflow: [
    { id: 'stage1', title: 'Stage 1 description' },
    { id: 'stage2', title: 'Stage 2 description' },
    // ... etc
  ],
  ```

- [ ] Add title mapping to `formatPlanTitle()`:
  ```typescript
  const titles: Record<string, string> = {
    // ... existing titles
    your_workflow: 'Your Workflow Display Name',
  };
  ```

- [ ] **VERIFY:** Stage IDs match what your worker will publish (check worker code)
- [ ] **VERIFY:** Stages are in execution order

---

## Phase 2: Action Handler (Bolt action or intent router)

```typescript
// e.g., src/listeners/actions/yourAction.ts or src/services/agent/intentRouter.ts
```

### Imports

- [ ] Add imports:
  ```typescript
  import { startStream, type StreamConfig } from '../../services/agent/streamingHelper.js';
  import { buildInitialPlan, subscribeToProgress } from '../../services/agent/taskVisualizer.js';
  ```

### Stream Initialization

- [ ] Create stream config:
  ```typescript
  const streamConfig: StreamConfig = {
    client,
    channel: channelId,
    threadTs,
    userId,
    teamId,
  };
  ```

- [ ] Build initial plan:
  ```typescript
  const enrichType = 'your_workflow'; // Must match taskVisualizer.ts key
  const initialChunks = buildInitialPlan(enrichType, 'Display Title');
  ```

- [ ] Start stream:
  ```typescript
  const session = await startStream(streamConfig, {
    taskDisplayMode: 'plan',
    initialChunks,
  });
  ```

- [ ] Subscribe to progress:
  ```typescript
  subscribeToProgress(jobId, enrichType, session);
  ```

- [ ] Enqueue job:
  ```typescript
  await yourQueue.add('job-name', { jobId, /* ... */ });
  ```

### ⚠️ CRITICAL: What NOT to do

- [ ] **DO NOT** call `session.appendText()` ❌
- [ ] **DO NOT** call `session.flush()` ❌
- [ ] **DO NOT** call `session.stop()` manually ❌ (auto-closes on final stage)

---

## Phase 3: Worker Implementation

```typescript
// e.g., src/services/queue/workers/yourWorker.ts
```

### Imports

- [ ] Add import:
  ```typescript
  import { publishProgress } from '../../services/agent/taskVisualizer.js';
  ```

### For Each Stage

- [ ] **Start of stage:** Publish `in_progress`
  ```typescript
  await publishProgress({
    jobId,
    stage: 'stage1', // Must match task definition ID
    status: 'in_progress',
  });
  ```

- [ ] **End of stage:** Publish `complete`
  ```typescript
  await publishProgress({
    jobId,
    stage: 'stage1',
    status: 'complete',
    detail: 'Optional detail message', // Optional
  });
  ```

- [ ] **On error:** Publish `error`
  ```typescript
  try {
    // ... stage work ...
    await publishProgress({ jobId, stage: 'stage1', status: 'complete' });
  } catch (err) {
    await publishProgress({
      jobId,
      stage: 'stage1',
      status: 'error',
      detail: err.message,
    });
    throw err;
  }
  ```

### ⚠️ CRITICAL: Final Stage

- [ ] **Last stage MUST publish `complete`** to trigger auto-close:
  ```typescript
  // If last stage enqueues another job:
  await fileGenerationQueue.add('generate-result-file', data);
  await publishProgress({ jobId, stage: 'final_stage', status: 'complete' }); // ← CRITICAL

  // If last stage does work directly:
  await generateOutputFile();
  await publishProgress({ jobId, stage: 'final_stage', status: 'complete' }); // ← CRITICAL
  ```

---

## Phase 4: Testing

### Happy Path

- [ ] Run workflow end-to-end
- [ ] Verify task card appears with all stages
- [ ] Verify stages show in correct order
- [ ] Verify each stage transitions: pending → in_progress → complete (green checkmark)
- [ ] Verify task card auto-closes when final stage completes
- [ ] Verify no red error icons appear

### Error Path

- [ ] Simulate failure in one stage (e.g., throw error)
- [ ] Verify stage shows red error icon
- [ ] Verify error detail message appears
- [ ] Verify job fails gracefully

### CloudWatch Logs

- [ ] Check for `streaming_mode_mismatch` errors (should be NONE)
- [ ] Verify progress events are published for all stages
- [ ] Check for any unexpected errors

### Common Issues Checklist

- [ ] **Task card frozen?** → Worker not publishing progress events
- [ ] **Task card won't close?** → Final stage missing `complete` event
- [ ] **Red error icons?** → Stage defined but never completes (remove from definition OR add publishProgress)
- [ ] **`streaming_mode_mismatch` error?** → Using `appendText()` or `stop({ markdownText })`

---

## Quick Reference: Common Patterns

### Pattern 1: Simple Worker Stage

```typescript
await publishProgress({ jobId, stage: 'parse', status: 'in_progress' });
const data = await parseInputFile();
await publishProgress({ jobId, stage: 'parse', status: 'complete' });
```

### Pattern 2: Stage with Error Handling

```typescript
await publishProgress({ jobId, stage: 'builtwith', status: 'in_progress' });
try {
  const techData = await fetchTechStacks(domains);
  await publishProgress({ jobId, stage: 'builtwith', status: 'complete' });
} catch (err) {
  await publishProgress({
    jobId,
    stage: 'builtwith',
    status: 'error',
    detail: err.message,
  });
  throw err;
}
```

### Pattern 3: Stage with Detail Message

```typescript
await publishProgress({ jobId, stage: 'query', status: 'in_progress' });
const results = await queryDatabase();
await publishProgress({
  jobId,
  stage: 'query',
  status: 'complete',
  detail: `${results.length} companies found`,
});
```

### Pattern 4: Final Stage (Enqueues Another Job)

```typescript
// Stage: generate (FINAL STAGE)
await fileGenerationQueue.add('generate-result-file', {
  jobId,
  data: enrichedData,
});

// ✅ CRITICAL: Publish completion to trigger auto-close
await publishProgress({ jobId, stage: 'generate', status: 'complete' });
```

---

## Files to Modify

| Phase | File | Purpose |
|-------|------|---------|
| 1 | `src/services/agent/taskVisualizer.ts` | Define pipeline stages |
| 2 | Action handler or intent router | Start stream, subscribe to progress |
| 3 | Worker file | Publish progress events |

---

## Before You Commit

- [ ] All task definitions have matching worker events
- [ ] No phantom stages (stages without publishProgress)
- [ ] Final stage publishes `complete`
- [ ] No `appendText()` or `stop({ markdownText })` calls
- [ ] Error handling in all worker stages
- [ ] Tested happy path
- [ ] Tested error path
- [ ] Checked CloudWatch for errors

---

## References

- **Full Best Practices:** `docs/streaming-task-cards-best-practices.md`
- **Session Summary:** `sessions/2026-03-13-streaming-task-cards-fix.md`
- **Example Workers:**
  - `src/services/queue/workers/techReport.ts`
  - `src/services/queue/workers/technographic.ts`
- **Example Action Handlers:**
  - `src/services/agent/intentRouter.ts`
  - `src/listeners/actions/techReportChain.ts`
  - `src/listeners/actions/cacheDecision.ts`

---

**Last Updated:** 2026-03-13
