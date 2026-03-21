# Research: Dynamic Suggested Prompts

**Date**: 2026-03-13
**Phase**: Phase 0 - Research & Technology Decisions
**Status**: ✅ COMPLETE

---

## Research Questions Resolved

This document consolidates research findings from MCP tools (WebSearch) and codebase analysis to resolve all NEEDS CLARIFICATION items from the Technical Context.

---

## R1: Slack Bolt Assistant API & Best Practices

### Decision: Use `setSuggestedPrompts()` with event-driven updates

**Method Signature:**
```typescript
await client.assistant.threads.setSuggestedPrompts({
  channel_id: string,      // Required
  thread_ts: string,       // Required
  title?: string,          // Optional list title
  prompts: Array<{         // Required (max 4)
    title: string,         // Required: Short label
    message: string        // Required: Full message sent when clicked
  }>
});
```

**Constraints:**
- **Maximum 4 prompts per call** (Slack API limit)
- Each prompt requires both `title` (max 25 chars) and `message` (max 150 chars)
- Requires `assistant:write` OAuth scope
- No explicit rate limits documented for `setSuggestedPrompts()`, follow general Slack API best practices

**Event Lifecycle:**

1. **`assistant_thread_started`** - Triggered when user opens assistant panel
   - Use to set initial prompts based on user's overall activity
   - Access to channel ID, team ID, enterprise ID

2. **`assistant_thread_context_changed`** - Triggered when user switches channels
   - Use to update prompts based on new channel context
   - Provides updated context (channel, workspace)
   - **Built-in last-write-wins**: Slack's DefaultThreadContextStore handles concurrent updates

3. **`message.im`** - User sends message to assistant
   - Handle user input, detect prompt clicks via text matching

**Rationale:**
- Slack Bolt v4+ has optimized metadata resolution for assistant `say()` method
- DefaultThreadContextStore automatically handles context persistence (no manual save needed)
- Empty prompts array clears suggestions (TypeScript fix in recent versions)

**Alternatives Considered:**
- ❌ Manual debouncing of `threadContextChanged` events → Not needed; Slack's default store handles this
- ❌ Custom context storage → Default store sufficient for our use case
- ❌ Webhooks for prompt updates → Event handlers are the correct pattern

---

## R2: Thread Context Management Patterns

### Decision: Use DefaultThreadContextStore with automatic context save

**Recommended Pattern:**
```typescript
app.assistant({
  threadStarted: async ({ setSuggestedPrompts, getThreadContext }) => {
    const context = await getThreadContext();
    const prompts = await promptGenerator.generate(context);
    await setSuggestedPrompts({ prompts, title: "How can I help?" });
  },

  // Optional: Only if custom logic needed
  threadContextChanged: async ({ getThreadContext, setSuggestedPrompts }) => {
    const context = await getThreadContext();
    const prompts = await promptGenerator.generate(context);
    await setSuggestedPrompts({ prompts });
  },

  userMessage: async ({ say, getThreadContext }) => {
    const context = await getThreadContext(); // Always up-to-date
    // Context auto-saved when say() responds
  }
});
```

**Rationale:**
- Slack's default store handles concurrent `threadContextChanged` events via last-write-wins
- Context metadata automatically included in `say()` responses
- No need for manual debouncing or complex concurrency logic
- Simplifies implementation and reduces error surface

**Alternatives Considered:**
- ❌ Custom debouncing with setTimeout → Over-engineering; default store handles this
- ❌ Queue-based context updates → Unnecessary complexity for this use case
- ❌ Manual context save on every event → Automatic save is more reliable

---

## R3: Redis Caching Strategies for Real-Time Systems

### Decision: Hierarchical key structure with sliding TTL + event-driven invalidation

**Key Structure:**
```
{workspace_id}:{category}:{identifier}:{subcategory}
```

**Examples:**
- `T12345:prompt:U67890:context` - User's cached prompt context
- `T12345:job:active:U67890` - Active jobs for user
- `T12345:channel:C98765:history` - Channel enrichment history
- `T12345:doc:D45678:metadata` - Document metadata

**Rationale:**
- **Tenant isolation**: Workspace ID prefix prevents cross-tenant leaks
- **Pattern matching**: Enables efficient bulk invalidation with SCAN
- **Redis Cluster compatible**: Key prefixing enables horizontal scaling
- **Debugging**: Easy to identify data ownership and category

**TTL Strategy:**

| Cache Type | TTL | Pattern | Rationale |
|------------|-----|---------|-----------|
| Prompt context | 5 min | Sliding (reset on access) | Active users stay cached, idle users expire |
| Job metadata | 1 hour | Fixed | Jobs complete/fail within this window |
| Document metadata | 24 hours | Fixed | Relatively static data |
| Channel history | 1 hour | Fixed | Recent activity window for prompts |

**Sliding TTL Implementation:**
```typescript
async function getUserContext(workspaceId: string, userId: string) {
  const key = `${workspaceId}:prompt:${userId}:context`;
  const data = await redis.get(key);

  if (data) {
    // Sliding TTL: reset expiration on access
    await redis.expire(key, 300); // 5 minutes
    return JSON.parse(data);
  }
  return null;
}
```

**Invalidation Strategy:**

**Event-Driven Invalidation** (preferred over time-based):
- Job state change (queued → processing → completed/failed) → Invalidate job cache + all user contexts
- Document upload/processing → Invalidate document cache + affected channel history
- User initiates enrichment → Invalidate user's prompt context (force refresh)

**Implementation:**
```typescript
async function onJobComplete(workspaceId: string, jobId: string) {
  const pipeline = redis.pipeline();

  // Delete job-specific cache
  pipeline.del(`${workspaceId}:job:${jobId}:status`);

  // Invalidate all user prompt contexts (force refresh on next panel open)
  const userKeys = await scanKeys(`${workspaceId}:prompt:*:context`);
  if (userKeys.length > 0) {
    pipeline.del(...userKeys);
  }

  await pipeline.exec();
}
```

**Rationale:**
- Event-driven invalidation ensures users always see fresh data after state changes
- Sliding TTL keeps active users cached while evicting idle sessions
- Pipeline operations minimize Redis round-trips

**Alternatives Considered:**
- ❌ Fixed 5-min TTL without sliding → Active users would see cache misses unnecessarily
- ❌ Very short TTLs (< 1 min) → Frequent cache misses, higher DB load
- ❌ Manual refresh only (no TTL) → Risk of stale data if invalidation logic has bugs

---

## R4: Rule-Based Prompt Selection Algorithms

### Decision: Multi-signal priority scoring with post-processing diversity filter

**Algorithm Design:**

**Scoring Formula:**
```
Final Score = (State Priority × State Weight) + (Recency × Recency Weight) - Diversity Penalty
```

**Component Weights:**
- **State Priority Weight**: 1.5x (most important signal)
- **Recency Weight**: 1.0x (secondary signal)
- **Diversity Penalty**: -500 per appearance in last 20 prompts

**Priority Matrix:**

| Signal Type | Score Calculation | Example |
|-------------|-------------------|---------|
| **Active jobs** | 1000 points | Running enrichment → "Check your running job" |
| **Failed jobs (< 24h)** | 800 points | Failed yesterday → "Retry your failed enrichment" |
| **Completed jobs (< 48h)** | 400 points | Completed today → "Filter your last enrichment" |
| **No activity** | 0 points (fallback) | New user → "Upload a list to get started" |
| **Recency bonus** | `1000 / (days_since + 1)` | Today's job: +1000, yesterday's: +500 |
| **Diversity penalty** | `-500 × appearance_count` | Shown twice → -1000 penalty |

**Pseudocode:**
```typescript
function generatePrompts(context: PromptContext): SuggestedPrompt[] {
  const candidates = [];

  // 1. Score all possible prompts
  for (const promptType of ALL_PROMPT_TYPES) {
    if (!isApplicable(promptType, context)) continue;

    const score = calculateScore(promptType, context);
    candidates.push({ type: promptType, score });
  }

  // 2. Sort by score (deterministic tie-breaker by type ID)
  candidates.sort((a, b) => b.score - a.score || a.type.localeCompare(b.type));

  // 3. Apply diversity re-ranking
  const selected = [];
  while (selected.length < 4 && candidates.length > 0) {
    if (selected.length === 0) {
      // First item: highest score
      selected.push(candidates.shift());
    } else {
      // Apply similarity penalty
      for (const candidate of candidates) {
        let penalty = 0;

        // Same category as last selected?
        if (candidate.type.category === selected[selected.length - 1].type.category) {
          penalty += 200;
        }

        candidate.adjustedScore = candidate.score - penalty;
      }

      // Re-sort and select
      candidates.sort((a, b) => b.adjustedScore - a.adjustedScore);
      selected.push(candidates.shift());
    }
  }

  // 4. Render templates
  return selected.map(s => renderPrompt(s.type, context));
}
```

**Diversity Mechanisms:**

1. **Sliding Window Anti-Repetition**: Track last 20 prompts shown to user, apply exponential penalty
2. **Category Distribution**: Ensure at least 2 different categories in top 4 (e.g., job management + enrichment)
3. **Temporal Diversity**: Avoid clustering prompts about jobs created on same day

**Rationale:**
- **Fully deterministic**: Same inputs → same outputs (reproducible, testable)
- **Transparent**: All scoring is explainable (debug logs show breakdown)
- **Fast**: O(n log n) sorting, no model inference (<500ms target easily met)
- **No training required**: Works immediately with zero historical data
- **Easy to tune**: Adjust weights in config without code changes

**Alternatives Considered:**
- ❌ Machine learning model → Requires training data, adds latency, black box
- ❌ LLM-powered generation → Violates <500ms budget, incurs per-call costs
- ❌ Pure rule-based (if-then only) → Too rigid, doesn't handle competing signals well
- ❌ Random selection → No personalization, defeats purpose of dynamic prompts

---

## R5: Testing Framework Identification

### Decision: Vitest 4.0.18 (existing framework)

**Current Setup:**
- **Framework**: Vitest v4.0.18 (already in `package.json`)
- **Scripts**:
  - `npm test` → `vitest run` (one-time test run)
  - `npm run test:watch` → `vitest` (watch mode)

**Test Structure:**
```
tests/
├── unit/
│   ├── promptGenerator.test.ts          # NEW
│   ├── promptContext.test.ts            # NEW
│   └── promptTemplates.test.ts          # NEW
└── integration/
    └── promptGeneration.test.ts         # NEW
```

**Test Coverage Requirements:**
- **Unit tests**: Core logic (scoring algorithm, context builder, template rendering)
- **Integration tests**: End-to-end prompt generation with mocked Slack events
- **Fixtures**: Mock user activity, channel context, workspace config
- **Assertions**: Verify exactly 4 prompts returned, correct priority ordering, diversity enforcement

**Rationale:**
- Vitest is modern, fast, and TypeScript-native
- Already integrated into codebase (no additional setup needed)
- Compatible with Slack Bolt testing patterns

**Alternatives Considered:**
- ❌ Jest → Vitest is faster and better TypeScript support
- ❌ No tests → Violates constitution quality gates

---

## Technology Stack Summary

**Final Decisions:**

| Component | Technology | Version | Justification |
|-----------|------------|---------|---------------|
| **Testing** | Vitest | 4.0.18 | Existing framework, TypeScript-native, fast |
| **Slack API** | @slack/bolt | 4.6.0 | Already in use, optimized assistant support |
| **Caching** | Redis (ioredis) | 5.10.0 | Already in use, sliding TTL + SCAN support |
| **Database** | PostgreSQL + Prisma | 7.4.2 | Already in use for job/activity queries |
| **Runtime** | Node.js 18+ (ECS) | Current | AWS Fargate runtime |

**No new dependencies required** ✅

---

## Performance Targets (Validated)

| Metric | Target | Feasibility |
|--------|--------|-------------|
| Prompt generation latency | <500ms p95 | ✅ Achievable with Redis cache + deterministic algorithm |
| Fallback latency (dependencies down) | <50ms | ✅ Static prompts served from memory |
| Redis cache hit rate | >80% | ✅ 5-min sliding TTL covers active users |
| Database query time | <100ms | ✅ Indexed queries on existing tables |

---

## Architecture Validation

**Prompt Generation Flow:**

```
User opens assistant panel
    ↓
assistant_thread_started event
    ↓
getThreadContext() (includes channel, user, team)
    ↓
promptGenerator.generate(context)
    ├─→ Check Redis cache (key: {workspace}:prompt:{user}:context)
    │   ├─→ HIT: Return cached context (sliding TTL reset)
    │   └─→ MISS: Query DB for user activity + channel history
    ↓
Score all applicable prompts (priority matrix)
    ↓
Apply diversity filter (post-processing)
    ↓
Render top 4 prompts from templates
    ↓
setSuggestedPrompts({ prompts })
    ↓
User sees personalized suggestions
```

**Performance Budget:**
- Redis cache lookup: ~5ms (local network)
- Database query (cache miss): ~50ms (indexed, limited to 10 recent jobs)
- Scoring + diversity: ~10ms (in-memory computation)
- Template rendering: ~5ms (string interpolation)
- **Total**: ~70ms (well under 500ms target)

---

## Next Steps

✅ **Phase 0 Complete** - All NEEDS CLARIFICATION resolved

**Proceed to Phase 1: Design**
- Create `data-model.md` (PromptContext, PromptClickEvent entities)
- Create `contracts/` (TypeScript interfaces)
- Create `quickstart.md` (testing guide, debugging)
- Update agent context (`update-agent-context.sh claude`)

---

## Sources

### Slack Bolt API Research
- [Slack Bolt AI Assistant Tutorial](https://docs.slack.dev/tools/bolt-js/tutorials/ai-assistant/)
- [assistant.threads.setSuggestedPrompts API Method](https://api.slack.com/methods/assistant.threads.setSuggestedPrompts)
- [assistant_thread_started Event](https://api.slack.com/events/assistant_thread_started)
- [assistant_thread_context_changed Event](https://api.slack.com/events/assistant_thread_context_changed)
- [Using AI in Apps - Bolt.js Concepts](https://docs.slack.dev/tools/bolt-js/concepts/ai-apps/)

### Redis Caching Research
- [Caching | Redis](https://redis.io/solutions/caching/)
- [Redis + Local Cache: Implementation and Best Practices | Medium](https://medium.com/@max980203/redis-local-cache-implementation-and-best-practices-f63ddee2654a)
- [Best practices for development - Azure Cache for Redis | Microsoft Learn](https://learn.microsoft.com/en-us/azure/azure-cache-for-redis/cache-best-practices-development)
- [How to Implement Sliding TTL in Redis](https://oneuptime.com/blog/post/2026-01-26-redis-sliding-ttl/view)
- [Multi-Tenancy in Redis Enterprise | Redis](https://redis.io/blog/multi-tenancy-redis-enterprise/)

### Rule-Based Recommendation Research
- [Rule-based recommendations - Metabase](https://www.metabase.com/community-posts/rule-based-recommendations)
- [Priority Scheduling in Operating System - GeeksforGeeks](https://www.geeksforgeeks.org/operating-systems/priority-scheduling-in-operating-system/)
- [Diversity in Recommendation Systems - GitHub](https://gist.github.com/kumarbhrgv/fe075ee67705c71786f269680f659389)
