# Quickstart Guide: Dynamic Suggested Prompts

**Date**: 2026-03-13
**Feature**: Dynamic Suggested Prompts
**For**: Developers implementing and testing this feature

---

## Overview

This guide covers:
1. How to test prompt generation (AWS ECS deployment required)
2. How to add a new prompt category
3. How to modify the priority algorithm
4. How to debug prompt generation
5. How to view prompt click analytics

**Important**: This feature runs exclusively on AWS ECS Fargate. There is NO local testing - all changes must be deployed to ECS.

---

## Testing Prompt Generation

### Prerequisites

✅ **AWS Credentials**: Configured for ECS access
✅ **Slack Workspace**: Test workspace with bot installed
✅ **Database Access**: RDS PostgreSQL connection (via bastion or VPN)
✅ **Redis Access**: ElastiCache Redis connection

### Test Flow

**Step 1: Deploy Changes to ECS**
```bash
cd /path/to/slack-list-processor
./infra/deploy.sh --update
```

This will:
- Build Docker image
- Push to ECR
- Force ECS service redeployment
- Wait for healthy task

**Step 2: Trigger Event in Slack**
- Open Slack workspace
- Navigate to "Messages" → Find your bot in "Apps"
- Click on the bot to open assistant panel
- **Event**: `assistant_thread_started` fires → prompts should appear

**Step 3: Switch Channels to Test Context Changes**
- While assistant panel is open, click on a different channel
- **Event**: `assistant_thread_context_changed` fires → prompts should update

**Step 4: Click a Suggested Prompt**
- Click one of the 4 suggested prompts
- Verify bot responds correctly
- Check CloudWatch logs for prompt click event

**Step 5: Verify in CloudWatch Logs**
```bash
# Via AWS CLI
aws logs tail /ecs/prod-slack-list-processor --follow

# Or via AWS Console
# Navigate to: CloudWatch → Log groups → /ecs/prod-slack-list-processor
```

**Expected Log Output:**
```
[INFO] Prompt generation started | userId=U12345 teamId=T67890
[INFO] Prompt context cache MISS | building context from DB
[INFO] Fetched 2 active jobs, 3 completed jobs, 1 failed job
[INFO] Generated 4 prompts | scores=[1850, 1400, 1200, 800]
[DEBUG] Prompt breakdown:
  1. "Check your running enrichment" (active job, score=1850)
  2. "Retry failed enrichment" (failed job, score=1400)
  3. "Filter your last results" (completed job, score=1200)
  4. "Generate tech report" (default, score=800)
[INFO] Prompts sent to Slack | duration=45ms
```

### Test Scenarios

**Scenario 1: New User (No History)**
- Create a fresh Slack user (never used bot before)
- Open assistant panel
- **Expected**: Onboarding prompts ("Upload a list to get started", "What can I help with?")

**Scenario 2: Active Enrichment Job**
- Start a technographic enrichment (upload CSV)
- While job is running, open assistant panel
- **Expected**: "Check your running enrichment" as top prompt

**Scenario 3: Failed Job Recovery**
- Manually fail a job in database (set `status = 'failed'`)
- Open assistant panel
- **Expected**: "Retry your failed enrichment" in top 4

**Scenario 4: Channel Context**
- Upload an ICP document to a channel
- Switch to that channel in assistant panel
- **Expected**: "Enrich using [doc-slug] settings" appears

**Scenario 5: Power User**
- Create 10+ completed enrichment jobs for a user
- Open assistant panel
- **Expected**: Advanced prompts (filter, split, usage query) instead of onboarding

---

## Adding a New Prompt Category

**Step 1: Define Template in `promptTemplates.ts`**

```typescript
// src/services/agent/promptTemplates.ts

export const PROMPT_TEMPLATES: PromptTemplate[] = [
  // ... existing templates

  // NEW: Export Results Prompt
  {
    id: 'export_to_crm',
    category: 'follow_up',
    subcategory: 'export',
    basePriority: 300, // Lower than active jobs, higher than defaults

    isApplicable(context: PromptContext): boolean {
      // Only show if user has completed jobs with results
      return context.completedJobs.length > 0 &&
             context.completedJobs.some(job => job.rowCount > 0);
    },

    render(context: PromptContext): SuggestedPrompt {
      const latestJob = context.completedJobs[0]; // Most recent
      return {
        title: 'Export to CRM',
        message: `Export your ${latestJob.type} results to HubSpot or Salesforce`,
      };
    },
  },
];
```

**Step 2: Add to Priority Matrix (if needed)**

If your new category needs custom priority scoring:

```typescript
// src/services/agent/promptGenerator.ts

function calculateScore(
  template: PromptTemplate,
  context: PromptContext,
  userHistory: string[]
): number {
  let score = template.basePriority;

  // Custom scoring for export prompts
  if (template.subcategory === 'export') {
    const latestJob = context.completedJobs[0];
    const hoursSinceCompletion = (Date.now() - latestJob.createdAt.getTime()) / (1000 * 60 * 60);

    // Boost score if job completed recently
    if (hoursSinceCompletion < 1) {
      score += 500; // Fresh completion, highly relevant
    }
  }

  // ... existing recency/diversity logic

  return score;
}
```

**Step 3: Test**
- Deploy to ECS (`./infra/deploy.sh --update`)
- Complete an enrichment job
- Open assistant panel
- Verify new prompt appears in top 4

**Step 4: Document**
- Add to prompt category table in `data-model.md`
- Update analytics dashboard to track new category

---

## Modifying the Priority Algorithm

**Current Algorithm Location:**
- `src/services/agent/promptGenerator.ts` → `calculateScore()` function

**Tunable Parameters:**

```typescript
// src/services/agent/promptGenerator.ts

const PRIORITY_WEIGHTS = {
  STATE_WEIGHT: 1.5,       // Multiplier for state priority (active > failed > completed)
  RECENCY_WEIGHT: 1.0,     // Multiplier for recency bonus
  DIVERSITY_PENALTY: 500,  // Penalty per appearance in last 20 prompts
};

const STATE_PRIORITY = {
  active: 1000,
  failed: 800,
  completed: 400,
  pending: 200,
};
```

**To Adjust Weights:**

1. Edit constants in `promptGenerator.ts`
2. Deploy to ECS
3. Monitor prompt ordering in CloudWatch logs
4. Iterate until desired behavior achieved

**Example Modification: Boost Failed Jobs**

```typescript
// Before
const STATE_PRIORITY = {
  active: 1000,
  failed: 800,  // ← Lower than active
  // ...
};

// After
const STATE_PRIORITY = {
  active: 1000,
  failed: 1200,  // ← Now higher than active (prioritize error recovery)
  // ...
};
```

**Testing Algorithm Changes:**

1. **Log score breakdowns**: Already implemented in `calculateScore()`
   ```typescript
   logger.debug('Prompt score breakdown', {
     promptId: template.id,
     basePriority: template.basePriority,
     recencyBonus,
     diversityPenalty,
     finalScore: score,
   });
   ```

2. **Create test users with known activity**:
   - User A: 1 active job, 0 completed
   - User B: 0 active, 5 completed (yesterday)
   - User C: 1 failed job, 2 completed
   - Compare prompt ordering across users

3. **A/B Test** (future):
   - Deploy two algorithm variants
   - Track click-through rate per variant
   - Choose winning variant

---

## Debugging Prompt Generation

### Common Issues

#### Issue 1: No Prompts Appear
**Symptoms**: Assistant panel opens but no suggested prompts shown

**Debug Steps:**
1. Check CloudWatch logs for errors:
   ```
   ERROR: Prompt generation failed | error=...
   ```

2. Verify event handler is registered:
   ```typescript
   // src/listeners/events/assistantThreadStarted.ts
   app.assistant({
     threadStarted: async ({ setSuggestedPrompts, ... }) => {
       // Should be called
     }
   });
   ```

3. Check Slack OAuth scopes (App Management → OAuth & Permissions):
   - ✅ `assistant:write` required

4. Verify fallback to static prompts:
   ```typescript
   try {
     const prompts = await promptGenerator.generate(context);
     await setSuggestedPrompts({ prompts });
   } catch (err) {
     logger.error('Prompt generation failed, falling back', { error: err });
     await setSuggestedPrompts({ prompts: DEFAULT_PROMPTS });
   }
   ```

#### Issue 2: Same Prompts Always Shown
**Symptoms**: Prompts don't change despite user activity

**Debug Steps:**
1. Check Redis cache invalidation:
   ```bash
   # Connect to Redis (via bastion/VPN)
   redis-cli

   # Check cached context
   GET T12345:prompt:U67890:context

   # Delete cache to force refresh
   DEL T12345:prompt:U67890:context
   ```

2. Verify job state is updating:
   ```sql
   -- Query PostgreSQL
   SELECT id, type, status, created_at
   FROM enrichment_jobs
   WHERE slack_user_id = 'U67890'
   ORDER BY created_at DESC
   LIMIT 10;
   ```

3. Check cache invalidation on job completion:
   ```typescript
   // src/services/queue/workers/technographic.ts (example)
   async function onJobComplete(jobId: string) {
     // ... existing logic

     // Invalidate prompt cache
     await promptContextCache.invalidate(job.teamId, job.slackUserId);
   }
   ```

#### Issue 3: Prompts Take Too Long to Load
**Symptoms**: Assistant panel opens but prompts appear after 2-3 seconds

**Debug Steps:**
1. Check prompt generation latency in logs:
   ```
   INFO: Prompts sent to Slack | duration=2500ms  ← TOO SLOW (should be <500ms)
   ```

2. Identify slow query:
   ```typescript
   // Add timing logs to contextBuilder.ts
   const startTime = Date.now();
   const activeJobs = await prisma.enrichmentJob.findMany({ ... });
   logger.debug(`Active jobs query: ${Date.now() - startTime}ms`);
   ```

3. Check database indexes:
   ```sql
   EXPLAIN ANALYZE
   SELECT * FROM enrichment_jobs
   WHERE slack_user_id = 'U67890' AND status = 'processing';
   ```

4. If no cache, queries taking >100ms → add indexes:
   ```sql
   CREATE INDEX idx_jobs_user_status_time
   ON enrichment_jobs(slack_user_id, status, created_at);
   ```

#### Issue 4: Prompt Click Not Detected
**Symptoms**: User clicks prompt but click event not recorded

**Debug Steps:**
1. Check text matching logic:
   ```typescript
   // src/listeners/events/assistantUserMessage.ts
   const lastPrompts = await getLastPromptsForThread(threadTs);
   const clickedPrompt = lastPrompts.find(p => p.message === message.text);

   if (clickedPrompt) {
     await promptGenerator.recordClick({
       userId,
       teamId,
       promptTitle: clickedPrompt.title,
       // ...
     });
   }
   ```

2. Verify exact text match (no extra whitespace):
   ```typescript
   const normalizedText = message.text.trim();
   ```

3. Check PromptClickEvent insertion:
   ```sql
   SELECT * FROM prompt_click_events
   ORDER BY clicked_at DESC
   LIMIT 10;
   ```

---

## Viewing Prompt Click Analytics

**Phase 3 Feature** (not implemented yet, planned for Admin Dashboard)

**Current Access** (via Database Query):

```sql
-- Click-through rate per prompt title (last 7 days)
SELECT
  prompt_title,
  context_type,
  COUNT(*) as click_count,
  COUNT(DISTINCT user_id) as unique_users
FROM prompt_click_events
WHERE clicked_at >= NOW() - INTERVAL '7 days'
GROUP BY prompt_title, context_type
ORDER BY click_count DESC;

-- Most clicked prompts by position
SELECT
  prompt_position,
  COUNT(*) as clicks
FROM prompt_click_events
WHERE clicked_at >= NOW() - INTERVAL '7 days'
GROUP BY prompt_position
ORDER BY prompt_position;

-- User engagement (how many users clicking prompts)
SELECT
  DATE(clicked_at) as date,
  COUNT(DISTINCT user_id) as active_users,
  COUNT(*) as total_clicks
FROM prompt_click_events
WHERE clicked_at >= NOW() - INTERVAL '30 days'
GROUP BY DATE(clicked_at)
ORDER BY date;
```

**Future Dashboard** (Admin Dashboard feature 3):
- Click-through rate per prompt type
- Position bias analysis (are top prompts always clicked?)
- Context effectiveness (do channel-aware prompts outperform defaults?)
- Time-series trends (prompt engagement over time)

---

## Performance Monitoring

**Key Metrics:**

| Metric | Target | Alert Threshold |
|--------|--------|-----------------|
| Prompt generation latency (p95) | <500ms | >800ms |
| Prompt generation latency (p50) | <100ms | >200ms |
| Cache hit rate | >80% | <60% |
| Fallback rate (errors) | <1% | >5% |
| Database query time (active jobs) | <50ms | >150ms |

**CloudWatch Metrics** (custom metrics to emit):

```typescript
// src/services/agent/promptGenerator.ts

await cloudwatch.putMetricData({
  Namespace: 'SlackListProcessor/Prompts',
  MetricData: [
    {
      MetricName: 'GenerationLatency',
      Value: duration,
      Unit: 'Milliseconds',
      Dimensions: [
        { Name: 'TeamId', Value: teamId },
        { Name: 'CacheHit', Value: cacheHit ? 'true' : 'false' },
      ],
    },
  ],
});
```

**CloudWatch Alarms:**

- **High Latency Alarm**: p95 > 800ms for 5 consecutive minutes
- **High Fallback Rate**: Error rate > 5% for 10 minutes
- **Low Cache Hit Rate**: Cache hit rate < 60% for 15 minutes

---

## Troubleshooting Checklist

Before escalating issues:

- [ ] Check CloudWatch logs for errors
- [ ] Verify ECS task is healthy (`aws ecs describe-services`)
- [ ] Test Redis connectivity (`redis-cli PING`)
- [ ] Test PostgreSQL connectivity (`psql -c "SELECT 1"`)
- [ ] Verify Slack OAuth scopes include `assistant:write`
- [ ] Check database indexes exist on `enrichment_jobs`
- [ ] Invalidate Redis cache for test user
- [ ] Review recent code changes (git log)
- [ ] Check for Slack API rate limits (429 responses)

---

## Related Files

- **Implementation**: `src/services/agent/promptGenerator.ts`
- **Templates**: `src/services/agent/promptTemplates.ts`
- **Context Builder**: `src/services/agent/promptContext.ts`
- **Cache**: `src/services/cache/promptCache.ts`
- **Analytics**: `src/services/agent/promptAnalytics.ts`
- **Event Handlers**: `src/listeners/events/assistantThreadStarted.ts`, `assistantThreadContextChanged.ts`

---

## Next Steps

After implementing this feature:

1. **Monitor production metrics** for 7 days
2. **Review click analytics** to identify low-performing prompts
3. **Iterate on priority weights** based on user engagement
4. **Add new prompt categories** based on user feedback
5. **Build admin dashboard** (feature 3) for visual analytics

---

**Last Updated**: 2026-03-13
**Author**: Based on research and design from `/speckit.plan` workflow
