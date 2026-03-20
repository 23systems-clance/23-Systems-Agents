# Automation Pattern Guide

Every automation in this system must follow one of six canonical patterns. Identify the pattern **before building** — this surfaces the right design questions and prevents failures that emerge weeks later.

## Pattern Decision Tree

```
Does it need to THINK (AI reasoning)?
├── Yes → Does it reshape input into structured output?
│   ├── Yes → TRANSFORMER
│   └── No → Does it pull from multiple sources?
│       ├── Yes → COLLECTOR
│       └── No → Use "agent" action type with appropriate pattern below
└── No → Is it event-driven (reacts to something)?
    ├── Yes → Does it route to different paths based on properties?
    │   ├── Yes → FILTER-FAN
    │   └── No → TRIGGER-ROUTE
    └── No → Does it repeat until a condition is met?
        ├── Yes → LOOP
        └── No → Does it passively monitor for anomalies?
            ├── Yes → WATCHER
            └── No → TRIGGER-ROUTE (simplest path)
```

## The Six Patterns

### 1. Trigger-Route
**One event → one linear path → one outcome.**

Use for: notifications, confirmations, data syncs, simple webhook forwarding.

| Field | Value |
|-------|-------|
| Action type | `command` or `webhook` |
| Complexity | Low |
| Cost | Free |

**Required safeguards:**
- [ ] Failure alert at final step with named owner
- [ ] Slack/notification on failure (never fail silently)

**Example cron:**
```json
{
  "name": "[Trigger-Route] Daily backup notification",
  "schedule": "0 9 * * *",
  "type": "command",
  "command": "node trigger-route-backup-check.js"
}
```

---

### 2. Filter-Fan
**One input → multiple conditional exits based on properties.**

Use for: lead routing, classification, conditional workflows, content moderation.

| Field | Value |
|-------|-------|
| Action type | `agent` (needs reasoning) or `command` (rule-based) |
| Complexity | Medium |
| Cost | LLM calls if agent type |

**Required safeguards:**
- [ ] Catch-all "unclassified" branch routed to human review
- [ ] Never silently drop records that don't match any condition
- [ ] Log classification decisions for debugging

**Example trigger:**
```json
{
  "name": "[Filter-Fan] Inbound lead router",
  "watch_path": "/webhook/inbound-lead",
  "actions": [
    {
      "type": "agent",
      "job": "Classify this lead by service interest: {{body}}. Route to the correct handler. If classification confidence is below 70%, output 'unclassified' and include the raw data for human review. Output JSON: {classification: string, confidence: number, action: string, data: object}"
    }
  ]
}
```

---

### 3. Collector
**Multiple data streams → aggregated into one output before action.**

Use for: reports, summaries, cross-source dashboards, weekly digests.

| Field | Value |
|-------|-------|
| Action type | `agent` (cross-source reasoning) or `command` (simple merge) |
| Complexity | Medium-High |
| Cost | LLM calls if agent type |

**Required safeguards:**
- [ ] Validate record counts from each source before output
- [ ] Flag anomalies (unexpected zeros, missing sources)
- [ ] Never send incomplete reports without warning

**Example cron:**
```json
{
  "name": "[Collector] Weekly cross-source report",
  "schedule": "0 9 * * 1",
  "type": "agent",
  "job": "Collect data from these sources: [SOURCE_1], [SOURCE_2], [SOURCE_3]. Before generating the report: 1) Validate each source returned data. 2) If any source returns zero records, flag it as an anomaly. 3) Include a data quality section at the top of the report. Save to logs/."
}
```

---

### 4. Loop
**Repeat until condition met, then explicitly break.**

Use for: follow-up sequences, retry logic, escalation flows, polling.

| Field | Value |
|-------|-------|
| Action type | `command` (stateful iteration) |
| Complexity | Medium |
| Cost | Free |

**Required safeguards:**
- [ ] Hard exit after N attempts regardless of condition
- [ ] Escalation notification when max iterations reached
- [ ] Never create infinite loops

**Example cron:**
```json
{
  "name": "[Loop] Invoice follow-up sequence",
  "schedule": "0 9 * * *",
  "type": "command",
  "command": "node loop-followup.js --max-iterations 5"
}
```

---

### 5. Transformer
**Raw input → processed/reshaped by AI → structured output.**

Use for: content generation, data extraction, brief-to-spec conversion, summarization.

| Field | Value |
|-------|-------|
| Action type | `agent` (AI processing) |
| Complexity | Medium |
| Cost | LLM calls |

**Required safeguards:**
- [ ] AI Sandwich architecture: automation → AI → automation
- [ ] Define exact output schema (JSON fields, types, limits)
- [ ] Never output freeform text — always structured
- [ ] Validate AI output against schema before routing

**Example trigger:**
```json
{
  "name": "[Transformer] Brief-to-spec converter",
  "watch_path": "/webhook/client-brief",
  "actions": [
    {
      "type": "agent",
      "job": "Convert this client brief into a structured project spec. Input: {{body.brief}}. Output MUST be valid JSON: {title: string, requirements: string[], timeline: string, budget: string, risks: string[]}. Do NOT output freeform text."
    }
  ]
}
```

---

### 6. Watcher
**Passive continuous monitor → fires only when threshold/anomaly crossed.**

Use for: revenue monitoring, error rate alerts, usage tracking, SLA monitoring.

| Field | Value |
|-------|-------|
| Action type | `command` (threshold check) or `agent` (complex anomaly) |
| Complexity | Low-Medium |
| Cost | Free (command) or LLM calls (agent) |

**Required safeguards:**
- [ ] Check frequency based on response capability, not problem speed
- [ ] Include triggering data in notifications (not just "anomaly detected")
- [ ] Set meaningful thresholds (avoid alert fatigue)

**Example cron:**
```json
{
  "name": "[Watcher] Revenue anomaly detector",
  "schedule": "0 */4 * * *",
  "type": "command",
  "command": "node watcher-revenue.js --threshold 20 --lookback 48h"
}
```

---

## Naming Convention

Always prefix cron and trigger names with the pattern type:
- `[Trigger-Route] Daily backup notification`
- `[Filter-Fan] Inbound lead router`
- `[Collector] Weekly cross-source report`
- `[Loop] Invoice follow-up sequence`
- `[Transformer] Brief-to-spec converter`
- `[Watcher] Revenue anomaly detector`

## Composing Patterns

Patterns can chain together:
- **Watcher → Trigger-Route:** Anomaly detected → send alert
- **Trigger-Route → Transformer:** Webhook received → AI processes → structured output saved
- **Collector → Transformer:** Data aggregated → AI generates summary report
- **Filter-Fan → Loop:** Lead classified → follow-up sequence starts

Use webhook triggers to chain patterns: one automation's output becomes the next automation's input via an HTTP call.
