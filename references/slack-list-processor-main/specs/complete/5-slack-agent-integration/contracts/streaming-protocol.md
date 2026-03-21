# Streaming & Task Visualization Protocol

## Overview

Two streaming patterns are used:
1. **Text streaming** — Progressive LLM response delivery (for intent responses, reports)
2. **Task pipeline streaming** — Visual task cards showing enrichment progress

## Text Streaming Protocol

### Flow

```
User sends message
  → setStatus({ status: 'is thinking...' })
  → Classify intent (non-streamed, fast)
  → chat.startStream({ channel, thread_ts, task_display_mode: 'timeline' })
  → For each LLM token: chat.appendStream({ ts, markdown_text: chunk })
  → chat.stopStream({ ts, blocks: [feedbackButtons] })
```

### Parameters

```typescript
interface StreamConfig {
  channel: string;       // DM channel ID
  threadTs: string;      // Agent thread timestamp
  userId: string;        // Recipient user ID
  teamId: string;        // Recipient team ID
}

// Start
const { ts } = await client.chat.startStream({
  channel: config.channel,
  thread_ts: config.threadTs,
  recipient_user_id: config.userId,
  recipient_team_id: config.teamId,
});

// Append (per LLM chunk)
await client.chat.appendStream({
  channel: config.channel,
  ts: streamTs,
  markdown_text: chunk,  // Max 12,000 chars per call
});

// Stop (finalize with optional feedback)
await client.chat.stopStream({
  channel: config.channel,
  ts: streamTs,
  blocks: feedbackBlocks,
});
```

### Rate Limits

| Method | Tier | Rate |
|--------|------|------|
| startStream | 2 | 20+/min |
| appendStream | 4 | 100+/min |
| stopStream | 2 | 20+/min |

Batching: Accumulate LLM tokens and flush every 100ms or 500 chars (whichever comes first) to stay well under limits.

## Task Pipeline Visualization

### Flow

```
Job submitted via agent
  → chat.startStream({ task_display_mode: 'plan', chunks: initialPlan })
  → Worker progresses → Publish BullMQ event
  → Agent receives event → chat.appendStream({ chunks: [taskUpdate] })
  → ... repeat for each stage ...
  → Job complete → chat.stopStream({ markdown_text: summary })
```

### Pipeline Task Definitions

```typescript
const ENRICHMENT_PIPELINE_TASKS = {
  technographic: [
    { id: 'parse', title: 'Parsing uploaded file' },
    { id: 'validate', title: 'Validating data structure' },
    { id: 'builtwith', title: 'Looking up technology stacks' },
    { id: 'classify', title: 'Classifying tech spend tiers' },
    { id: 'generate', title: 'Generating output file' },
  ],
  contact: [
    { id: 'parse', title: 'Parsing uploaded file' },
    { id: 'validate', title: 'Validating data structure' },
    { id: 'apollo_search', title: 'Searching for contacts' },
    { id: 'persona', title: 'Classifying decision makers' },
    { id: 'generate', title: 'Generating output file' },
  ],
  combined: [
    { id: 'parse', title: 'Parsing uploaded file' },
    { id: 'validate', title: 'Validating data structure' },
    { id: 'builtwith', title: 'Looking up technology stacks' },
    { id: 'classify', title: 'Classifying tech spend tiers' },
    { id: 'apollo_search', title: 'Searching for contacts' },
    { id: 'persona', title: 'Classifying decision makers' },
    { id: 'generate', title: 'Generating output file' },
  ],
  tech_report: [
    { id: 'query', title: 'Querying enrichment data' },
    { id: 'analyze', title: 'Analyzing technology distribution' },
    { id: 'score', title: 'Scoring opportunities' },
    { id: 'narrative', title: 'Generating report narrative' },
  ],
};
```

### Task Update Chunks

```typescript
// Initial plan (sent with startStream)
const initialChunks = [
  { type: 'plan_update', title: 'Technographic Enrichment' },
  { type: 'task_update', id: 'parse', title: 'Parsing uploaded file', status: 'pending' },
  { type: 'task_update', id: 'validate', title: 'Validating data structure', status: 'pending' },
  { type: 'task_update', id: 'builtwith', title: 'Looking up technology stacks', status: 'pending' },
  // ...
];

// Progress update (sent with appendStream)
const progressChunks = [
  { type: 'task_update', id: 'parse', title: 'Parsing uploaded file', status: 'complete' },
  { type: 'task_update', id: 'validate', title: 'Validating data structure', status: 'in_progress' },
];

// Error update
const errorChunks = [
  { type: 'task_update', id: 'builtwith', title: 'Looking up technology stacks', status: 'error' },
];
```

### Progress Communication (BullMQ → Agent)

The agent needs to receive progress updates from BullMQ workers. Pattern:

```
Worker updates Job.progress in DB
  → Worker publishes to Redis pub/sub channel: `agent:progress:{jobId}`
  → Agent subscribes to channel when job starts
  → Agent receives update → maps to task card update → appendStream
```

Redis pub/sub channel format:
```typescript
interface AgentProgressEvent {
  jobId: string;
  stage: string;       // matches task id (e.g., 'builtwith', 'persona')
  status: 'in_progress' | 'complete' | 'error';
  detail?: string;     // optional status text
  progress?: number;   // 0-100 percentage
}
```
