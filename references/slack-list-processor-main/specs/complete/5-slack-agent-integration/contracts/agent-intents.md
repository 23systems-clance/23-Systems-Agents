# Agent Intent Classification Contract

## Overview

The agent orchestrator extends the existing intent classification with multi-turn conversation support. It uses Claude Haiku 4.5 with Tool Use (forced) to classify user messages within the agent context.

## Agent Intent Schema

```typescript
// Extended from existing classify_intent tool
const AGENT_CLASSIFY_INTENT_TOOL = {
  name: 'classify_agent_intent',
  description: 'Classify the user message intent within an agent conversation',
  input_schema: {
    type: 'object',
    properties: {
      intent: {
        type: 'string',
        enum: [
          // Enrichment intents (existing, reused)
          'technographic',
          'contact',
          'combined',
          'tech_report',

          // Agent-specific intents (new)
          'job_status',        // "what's running?", "check my jobs"
          'job_cancel',        // "stop job 42", "cancel the enrichment"
          'job_history',       // "show my last 5 enrichments"
          'job_download',      // "download the results"
          'filter_results',    // "filter out companies < 50 employees"
          'usage_query',       // "show our usage this month"
          'help',              // "what can you do?", "how does this work?"
          'clarification',     // user is responding to agent's question
          'confirmation',      // "yes", "go ahead", "start it"
          'unknown',
        ],
      },
      confidence: {
        type: 'number',
        minimum: 0.0,
        maximum: 1.0,
      },
      // Extracted parameters
      technology: { type: 'string' },         // for tech_report
      jobId: { type: 'string' },              // for job_status/cancel/download
      filterExpression: { type: 'string' },   // for filter_results
      enrichmentType: { type: 'string' },     // clarified enrichment type
      usagePeriod: { type: 'string' },        // "this month", "last 30 days"
    },
    required: ['intent', 'confidence'],
  },
};
```

## Confidence Threshold

| Threshold | Action |
|-----------|--------|
| >= 0.85 | Execute intent directly |
| 0.50 - 0.84 | Present clarifying question with top 2-3 interpretations |
| < 0.50 | Ask open-ended clarification |

## Context Assembly

Each classification call includes:
1. **System prompt** with available capabilities and current thread state
2. **Last N conversation turns** (max 20 or 4000 tokens, whichever is less)
3. **Active job context** (if any job is in progress in this thread)
4. **Channel context** (what channel the user is viewing)
5. **Document context** (ICP/settings docs, if available for workspace)

## Intent Routing

```typescript
interface IntentRouteMap {
  // Enrichment flows → reuse existing pipeline
  technographic: (params) => startEnrichmentFlow('technographic', params);
  contact: (params) => startEnrichmentFlow('contact', params);
  combined: (params) => startEnrichmentFlow('combined', params);
  tech_report: (params) => startTechReportFlow(params);

  // Job management → query DB, respond via agent
  job_status: (params) => queryJobStatus(params);
  job_cancel: (params) => cancelJob(params);
  job_history: (params) => queryJobHistory(params);
  job_download: (params) => retrieveJobFile(params);

  // Filter → reuse existing filter parser
  filter_results: (params) => applyFilter(params);

  // Admin → check Slack admin role, then query
  usage_query: (params) => queryWorkspaceUsage(params);

  // Conversation management
  help: () => showCapabilities();
  clarification: (params) => updateAccumulatedParams(params);
  confirmation: (params) => executeAccumulatedAction(params);
  unknown: () => askForClarification();
}
```
