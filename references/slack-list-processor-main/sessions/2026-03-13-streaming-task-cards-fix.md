# Session Summary: Fixing Streaming Task Card Visualization

**Date:** 2026-03-13
**Branch:** main
**Focus:** Fix streaming task card issues in Slack bot enrichment flows

---

## Overview

This session focused on debugging and fixing multiple cascading issues with Slack streaming task card visualization for the enrichment pipeline. The bot uses task-mode streams to show real-time progress during company list enrichment jobs.

---

## Issues Fixed

### 1. Cache Duplicate Error (Tech Report Worker)

**Problem:**
- Tech report queries were failing with "Unique constraint failed on query_hash"
- Using `prisma.techReportCache.create()` which failed when the same query was run multiple times

**Root Cause:**
- Cache should be updated (upserted) when a query is re-run, not created fresh
- Cache entries weren't being cleared before inserting new results

**Solution:**
```typescript
// Changed from create() to upsert()
const cache = await prisma.techReportCache.upsert({
  where: { queryHash },
  update: {
    resultCount,
    resultFileUrl: s3Key,
    requestedByUserId: dbJob.slackUserId,
    requestedInChannel: dbJob.slackChannelId,
  },
  create: {
    queryHash,
    technology,
    country: filters.country ?? null,
    // ... other fields
  },
});

// Delete old cache entries before creating new ones
await prisma.techReportCacheEntry.deleteMany({
  where: { cacheId: cache.id },
});
```

**Files Modified:**
- `src/services/queue/workers/techReport.ts`

---

### 2. Missing Progress Events (Tech Report Worker)

**Problem:**
- Tech report streaming task cards appeared frozen with no progress updates
- Worker wasn't publishing progress events to Redis pub/sub

**Solution:**
Added `publishProgress()` calls at all stages:

```typescript
import { publishProgress } from '../../agent/taskVisualizer.js';

// At each stage
await publishProgress({ jobId, stage: 'query', status: 'in_progress' });
await publishProgress({
  jobId,
  stage: 'query',
  status: 'complete',
  detail: `${resultCount} companies found`
});
await publishProgress({ jobId, stage: 'narrative', status: 'in_progress' });
await publishProgress({ jobId, stage: 'narrative', status: 'complete' });
```

**Files Modified:**
- `src/services/queue/workers/techReport.ts`

---

### 3. Missing Streaming in Tech Report Chain

**Problem:**
- Tech report chain enrichment (when user chooses to enrich after tech report) had no streaming visualization
- Users saw "Starting technographic enrichment..." but no progress updates

**Solution:**
Added streaming task card initialization:

```typescript
import { startStream, type StreamConfig } from '../../services/agent/streamingHelper.js';
import { buildInitialPlan, subscribeToProgress } from '../../services/agent/taskVisualizer.js';

const streamConfig: StreamConfig = {
  client,
  channel: channelId,
  threadTs,
  userId,
  teamId,
};

const initialChunks = buildInitialPlan(enrichType, `${jobType} Enrichment`);
const session = await startStream(streamConfig, {
  taskDisplayMode: 'plan',
  initialChunks,
});

subscribeToProgress(jobId, enrichType, session);
```

**Files Modified:**
- `src/listeners/actions/techReportChain.ts`

---

### 4. Missing rowIndex Parameter

**Problem:**
- Tech report chain enrichment failed with `Argument rowIndex is missing`
- Database lookup uses composite key (jobId + rowIndex) but rowIndex wasn't passed to queue

**Solution:**
```typescript
await enrichmentQueue.add(enrichJobName, {
  jobId: job.id,
  companies: companyData.map((c) => ({
    jobCompanyId: c.id,
    rowIndex: c.rowIndex,  // Added this line
    domain: c.domain,
    companyName: c.companyName ?? undefined,
  })),
});
```

**Files Modified:**
- `src/listeners/actions/techReportChain.ts`

---

### 5. streaming_mode_mismatch Error (appendStream)

**Problem:**
- Error: `streaming_mode_mismatch` when calling `appendStream` with `markdown_text`
- Task-mode streams only accept chunks (TaskChunk[]), not markdown text

**Root Cause:**
- Slack's task-mode streams (`task_display_mode: 'plan'`) have different API than message-mode streams
- Cannot mix task chunks with markdown text appends

**Solution:**
Removed all `session.appendText()` and `session.flush()` calls:

```typescript
// REMOVED - task-mode streams don't support markdown_text appends
// await session.appendText('Starting query...');
// await session.flush();

// Instead, all updates go through task chunks via subscribeToProgress()
subscribeToProgress(jobId, 'tech_report', session);
```

**Files Modified:**
- `src/listeners/actions/cacheDecision.ts`
- `src/listeners/actions/techReportChain.ts`
- `src/services/agent/intentRouter.ts`

---

### 6. streaming_mode_mismatch Error (stopStream)

**Problem:**
- Task cards were working but not closing when jobs completed
- Error: `streaming_mode_mismatch` when calling `stopStream` with `markdown_text`

**Solution:**
Removed markdown text from `stop()` call:

```typescript
// Auto-stop stream on final stage completion
if (isFinalStage(event, enrichmentType)) {
  // CHANGED: Removed markdownText parameter
  void session.stop();
  void doUnsubscribe();
}
```

**Files Modified:**
- `src/services/agent/taskVisualizer.ts`

---

### 7. Red Error Icons on Completed Tasks

**Problem:**
- Task cards showed red error icons instead of green checkmarks
- Some tasks never completed (analyze, score for tech_report)
- Technographic enrichment missing final stage completion

**Root Cause:**
- Task definitions included phantom stages that never received completion events
- Worker wasn't publishing the final `generate` stage completion

**Solution:**

**A) Removed unused stages from tech_report:**
```typescript
tech_report: [
  { id: 'query', title: 'Querying enrichment data' },
  { id: 'narrative', title: 'Generating output file' },
  // REMOVED: analyze, score (these stages don't exist in the worker)
],
```

**B) Added missing completion event to technographic worker:**
```typescript
await fileGenerationQueue.add('generate-result-file', fileJobData);
jobLogger.info('File generation job enqueued', { jobId });

// Notify agent of final stage completion
await publishProgress({ jobId, stage: 'generate', status: 'complete' });
```

**Files Modified:**
- `src/services/agent/taskVisualizer.ts`
- `src/services/queue/workers/technographic.ts`

---

## Key Technical Insights

### Slack Streaming API Limitations (Task Mode)

**Task-mode streams (`task_display_mode: 'plan'`) have strict limitations:**

1. **Only accept TaskChunk[] for updates:**
   ```typescript
   // ✅ ALLOWED
   await session.appendChunks([
     { type: 'task_update', id: 'parse', title: 'Parsing file', status: 'complete' }
   ]);

   // ❌ NOT ALLOWED
   await session.appendText('Some markdown text');
   ```

2. **Cannot pass markdown_text to stop():**
   ```typescript
   // ✅ ALLOWED
   await session.stop();

   // ❌ NOT ALLOWED
   await session.stop({ markdownText: 'All done!' });
   ```

3. **All updates must go through task chunk system:**
   - Workers publish progress events to Redis pub/sub
   - `subscribeToProgress()` listens and converts to task chunks
   - `session.appendChunks()` updates the Slack UI

### Task Definition Must Match Worker Implementation

**Critical rule:** Every stage in `ENRICHMENT_PIPELINE_TASKS` MUST have corresponding `publishProgress()` calls in the worker, or it will show as errored (red icon).

```typescript
// Task definition
tech_report: [
  { id: 'query', title: 'Querying enrichment data' },
  { id: 'narrative', title: 'Generating output file' },
]

// Worker must publish ALL stages
await publishProgress({ jobId, stage: 'query', status: 'in_progress' });
await publishProgress({ jobId, stage: 'query', status: 'complete' });
await publishProgress({ jobId, stage: 'narrative', status: 'in_progress' });
await publishProgress({ jobId, stage: 'narrative', status: 'complete' });
```

---

## Files Modified

1. **src/services/queue/workers/techReport.ts**
   - Cache upsert fix
   - Added progress publishing at all stages

2. **src/listeners/actions/techReportChain.ts**
   - Added streaming task card visualization
   - Added missing rowIndex to companies mapping
   - Removed appendText call

3. **src/listeners/actions/cacheDecision.ts**
   - Removed appendText and flush calls

4. **src/services/agent/intentRouter.ts**
   - Removed appendText and flush calls

5. **src/services/agent/taskVisualizer.ts**
   - Removed markdownText from stop() call
   - Simplified tech_report task definition (removed unused stages)

6. **src/services/queue/workers/technographic.ts**
   - Added publishProgress for generate stage completion

---

## Deployment Status

**Latest Commit:**
- Hash: `50c01b60404b83f400951ab82773de2f47b0b439`
- Message: `fix(streaming): remove unused stages and add missing generate completion`
- Time: ~5 minutes ago (as of session end)

**GitHub Actions:**
- Status: `in_progress`
- Workflow: Deploy to ECS
- Display Title: fix(streaming): remove unused stages and add missing generate completion

**ECS Service:**
- Cluster: `prod-slack-list-processor`
- Status: ACTIVE
- Running Count: 1/1
- Current Task Definition: `:10`
- Deployment awaiting completion

---

## Expected Behavior After Deployment

### Tech Report Flow
1. User types: "find me a list of 10 heroku companies in the us"
2. Bot shows cached result with "Run Fresh Query" button
3. User clicks "Run Fresh Query"
4. Task card appears with 2 stages:
   - ✅ Querying enrichment data (with detail: "10 companies found")
   - ✅ Generating output file
5. Task card closes when complete
6. Bot delivers tech report CSV and asks "Would you like to enrich this list further?"

### Tech Report Chain Enrichment
1. User clicks "Get Technographics"
2. Task card appears with 5 stages:
   - ✅ Parsing uploaded file
   - ✅ Validating data structure
   - ✅ Looking up technology stacks
   - ✅ Classifying tech spend tiers
   - ✅ Generating output file
3. Task card closes when complete
4. Bot delivers enriched CSV

### Success Criteria
- All tasks show green checkmarks (no red error icons)
- Task cards properly close when jobs complete
- No "frozen" or stuck streaming cards
- No streaming_mode_mismatch errors

---

## GitHub Account Notes

**Repository:** `developerlabsai/slack-list-processor`
**Required Account:** `developerlabsai`

Multiple times during this session, had to run:
```bash
gh auth switch --user developerlabsai
```

Before any `gh` commands to avoid "repository not found" errors.

---

## Next Steps

1. ✅ Monitor deployment completion (in progress)
2. ⏳ Verify all task cards show green checkmarks
3. ⏳ Test tech report flow end-to-end
4. ⏳ Test tech report chain enrichment flow
5. ⏳ Confirm no red error icons appear

---

## User Feedback Throughout Session

1. "it seems to be frozen at this section" → Led to discovering missing progress events
2. "review the original flow because that worked" → Led to fixing cache upsert
3. "i received no response" → Led to adding streaming to tech report chain
4. "it still looks like its erroring out we need them all to be checked so it turns green not red" → Led to removing unused stages and adding missing generate completion

---

## Architecture Context

- **Framework:** @slack/bolt v4.6.0 with Socket Mode
- **Job Queue:** BullMQ + Redis
- **Database:** PostgreSQL via Prisma ORM (AWS RDS)
- **Cache:** AWS ElastiCache Redis
- **Deployment:** ECS Fargate via GitHub Actions CI/CD
- **Critical Constraint:** Only ONE Socket Mode connection allowed (AWS-only deployment)

---

**Session End Time:** 2026-03-13 ~16:20 (deployment in progress)
