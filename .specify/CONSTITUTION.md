# 23 Systems Workforce - Project Constitution

## Project Vision
Build a bullet-proof autonomous AI agent workforce that executes tasks reliably through well-defined automation patterns. Every automation — whether a cron job, webhook trigger, chat-initiated task, or API call — must follow one of six proven patterns to ensure predictability, debuggability, and resilience.

## Core Principles

### 1. Pattern-First Design
- **Identify Before Building:** Every automation must be classified into one of the six canonical patterns before implementation
- **No Snowflakes:** Reject one-off automation designs that don't fit a pattern — reshape the requirement or compose multiple patterns
- **Pattern Literacy:** All team members and AI agents must understand the six patterns and their failure modes

### 2. Failure Awareness
- **Silent Failures Kill:** Every automation must have explicit failure alerting — no automation runs without a named owner receiving failure notifications
- **Catch-All Branches:** Every conditional path must include an "unclassified" or "else" branch routed to human review
- **Hard Exit Conditions:** Every loop and retry must have a maximum iteration count — infinite loops are never acceptable

### 3. Observability
- **Every Action Logged:** Job creation, execution, completion, and failure are tracked in the database and visible in the web UI
- **Notification Pipeline:** Results flow back through Slack, web UI, and notification system — never fire-and-forget without confirmation
- **Anomaly Detection:** Watchers monitor for deviations, not just failures — a job that succeeds with unexpected data is still a problem

### 4. Reliability Over Cleverness
- **Simple Patterns Compose:** Prefer composing two simple patterns over building one complex automation
- **Validate Before Acting:** Collector patterns validate record counts; Transformers validate output schemas; Filters validate classification completeness
- **Idempotent by Default:** Actions should be safe to retry — design for at-least-once delivery

### 5. Staging-First Deployment
- **Staging is Unrestricted:** Push to staging, test on staging, and iterate freely — staging exists for exactly this purpose
- **Production Requires Explicit Authorization:** No code, configuration, or infrastructure may be deployed to production (main branch, production ECS services, production DNS) unless the user explicitly says **"DEPLOY PRODUCTION"**
- **No Implicit Promotions:** Completing work on staging does NOT authorize production deployment. A passing test suite does NOT authorize production deployment. Only the explicit phrase authorizes it
- **Scope Per-Action:** Each production deploy action requires its own authorization. Authorizing one push to main does not authorize the next

### 6. AI as Typed Function
- **Structured Output:** AI (Transformer pattern) must produce structured, schema-validated output — never freeform text that downstream automation must parse
- **AI Sandwich Architecture:** Automation delivers clean input, AI performs one specific job, automation catches and routes output
- **Humans Review, Never Move Data:** AI generates; humans approve; automation executes

## The Six Canonical Patterns

### Pattern 1: Trigger-Route
One event -> one linear path -> one outcome.
Use for: notifications, confirmations, data syncs.
Required: failure alert at final step with named owner.

### Pattern 2: Filter-Fan
One input -> multiple conditional exits based on properties.
Use for: lead routing, classification, conditional workflows.
Required: catch-all "unclassified" branch routed to human review.

### Pattern 3: Collector
Multiple data streams -> aggregated into one output before action.
Use for: reports, summaries, cross-source data consolidation.
Required: record count validation before output fires; anomaly flagging for unexpected zeros.

### Pattern 4: Loop
Repeat until condition met and loop explicitly breaks.
Use for: follow-up sequences, retry logic, escalation flows.
Required: hard exit after N attempts regardless of condition; no infinite loops.

### Pattern 5: Transformer
Raw input -> processed/reshaped by AI -> structured output.
Use for: content generation, data extraction, classification requiring reasoning.
Required: AI Sandwich architecture; typed output schema; no freeform text outputs.

### Pattern 6: Watcher
Passive continuous monitor -> fires only when threshold/anomaly crossed.
Use for: dashboards, anomaly detection, threshold monitoring.
Required: check frequency based on response capability; triggering data included in notifications.

## Technical Standards

### Automation Quality
- **Pattern Classification:** Every CRON, TRIGGER, and job prompt must declare its pattern type
- **Failure Alerting:** 100% of automations have a failure notification path
- **Catch-All Coverage:** 100% of Filter-Fan patterns include an unclassified branch
- **Loop Safety:** 100% of Loop patterns have hard exit conditions

### Action Type Selection

| Pattern | Primary Action Type | Secondary | When to Use |
|---------|-------------------|-----------|-------------|
| Trigger-Route | `command` or `webhook` | `agent` for complex routes | Thinking, reasoning, coding → `agent` |
| Filter-Fan | `agent` (needs reasoning) | `command` with pre-built rules | Shell scripts, file operations → `command` |
| Collector | `agent` (cross-source reasoning) | `command` for simple aggregation | External API calls → `webhook` |
| Loop | `command` (stateful iteration) | `agent` for each iteration step | |
| Transformer | `agent` (AI processing) | — | |
| Watcher | `command` (threshold check) | `agent` for complex anomaly detection | |

### Error Handling Strategy
- **Trigger-Route:** Alert named owner on final-step failure
- **Filter-Fan:** Route unclassified items to human review queue
- **Collector:** Validate source record counts; flag anomalies before aggregation
- **Loop:** Exit after max iterations; escalate on exhaustion
- **Transformer:** Validate AI output against schema; reject and retry on schema violations
- **Watcher:** Include triggering data in all alerts; set check frequency to response capability

### Job Prompt Standards
Every agent job prompt should:
1. State the pattern type being implemented
2. Define the expected output format/schema
3. Include failure handling instructions
4. Specify where to save outputs
5. Reference required specialties by name

### Pattern Metadata Fields

Every cron/trigger entry MUST include these underscore-prefixed metadata fields. The runtime ignores them — they exist for documentation, auditing, and agent context.

| Field | Required | Description |
|-------|----------|-------------|
| `_pattern` | Yes | One of: `trigger-route`, `filter-fan`, `collector`, `loop`, `transformer`, `watcher` |
| `_owner` | Yes | Named person who receives failure alerts |
| `_failure_alert` | Yes | Alert channel: `slack`, `web`, or `both` |
| `_catch_all` | Filter-Fan only | Must be `true` — confirms unclassified branch exists |
| `_max_iterations` | Loop only | Hard exit count — no infinite loops |
| `_hard_exit` | Loop only | Must be `true` — confirms exit condition exists |
| `_sources` | Collector only | Array of data source names for count validation |
| `_validate_counts` | Collector only | Must be `true` — confirms record count validation |
| `_output_schema` | Transformer only | Output format: `json`, `csv`, etc. |
| `_ai_sandwich` | Transformer only | Must be `true` — confirms structured I/O wrapping |
| `_check_frequency` | Watcher only | Human-readable check interval (e.g., `"4h"`) |
| `_threshold` | Watcher only | Trigger condition (e.g., `"20% deviation"`) |
| `_include_data` | Watcher only | Must be `true` — confirms triggering data in alerts |

## Configuration Standards

### CRONS.json Entries
Every cron job entry must include a pattern-prefixed name and all required metadata fields:
- `"name": "[Trigger-Route] Daily backup notification"`
- `"name": "[Watcher] Revenue anomaly check"`
- `"name": "[Collector] Weekly cross-source report"`

### TRIGGERS.json Entries
Every trigger must declare its pattern in the name:
- `"name": "[Filter-Fan] Inbound lead router"`
- `"name": "[Transformer] Brief-to-spec converter"`

### Canonical Pattern Templates

These are the reference templates for each pattern. All new automations MUST start from one of these templates. Copy, rename, and customize — never build from scratch.

**Trigger-Route** (CRONS.json):
```json
{
  "name": "[Trigger-Route] <description>",
  "schedule": "<cron expression>",
  "type": "command",
  "command": "node <script>.js",
  "enabled": false,
  "_pattern": "trigger-route",
  "_owner": "<name>",
  "_failure_alert": "slack"
}
```

**Filter-Fan** (TRIGGERS.json):
```json
{
  "name": "[Filter-Fan] <description>",
  "watch_path": "/webhook/<path>",
  "enabled": false,
  "actions": [
    {
      "type": "agent",
      "job": "Classify this input and route to the correct handler. Input: {{body}}. IMPORTANT: If classification is uncertain, output 'unclassified' and include the raw data for human review.",
      "_pattern": "filter-fan",
      "_owner": "<name>",
      "_failure_alert": "slack",
      "_catch_all": true
    }
  ]
}
```

**Collector** (CRONS.json):
```json
{
  "name": "[Collector] <description>",
  "schedule": "<cron expression>",
  "type": "agent",
  "job": "Collect data from: [SOURCE_1], [SOURCE_2]. Validate each source returned data. If any source returns zero records, flag as anomaly. Save report to logs/.",
  "enabled": false,
  "_pattern": "collector",
  "_owner": "<name>",
  "_failure_alert": "slack",
  "_sources": ["source_1", "source_2"],
  "_validate_counts": true
}
```

**Loop** (CRONS.json):
```json
{
  "name": "[Loop] <description>",
  "schedule": "<cron expression>",
  "type": "command",
  "command": "node <script>.js --max-iterations 5",
  "enabled": false,
  "_pattern": "loop",
  "_owner": "<name>",
  "_failure_alert": "slack",
  "_max_iterations": 5,
  "_hard_exit": true
}
```

**Transformer** (TRIGGERS.json):
```json
{
  "name": "[Transformer] <description>",
  "watch_path": "/webhook/<path>",
  "enabled": false,
  "actions": [
    {
      "type": "agent",
      "job": "Transform input into structured output. Input: {{body}}. Output MUST be valid JSON matching this schema: {<field>: <type>}. Do NOT output freeform text.",
      "_pattern": "transformer",
      "_owner": "<name>",
      "_failure_alert": "slack",
      "_output_schema": "json",
      "_ai_sandwich": true
    }
  ]
}
```

**Watcher** (CRONS.json):
```json
{
  "name": "[Watcher] <description>",
  "schedule": "0 */4 * * *",
  "type": "command",
  "command": "node <script>.js --threshold <N> --lookback <period>",
  "enabled": false,
  "_pattern": "watcher",
  "_owner": "<name>",
  "_failure_alert": "slack",
  "_check_frequency": "4h",
  "_threshold": "<N>% deviation",
  "_include_data": true
}
```

### Notification Standards

All failure and alert notifications (Slack, web UI) must follow this format:

```
[<Pattern>] <automation name> — <ALERT|FAILURE>

<Context-specific details>
Owner: @<owner>
Timestamp: <ISO 8601>

Data: <triggering data for Watchers, error details for failures>

Action required: <next step>
```

### Pattern Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Pattern Layer                            │
│                                                             │
│  config/CRONS.json          config/TRIGGERS.json            │
│  ┌──────────────┐           ┌──────────────────┐           │
│  │ [Trigger-Rte] │           │ [Filter-Fan]      │           │
│  │ [Collector]   │           │ [Transformer]     │           │
│  │ [Loop]        │           │                   │           │
│  │ [Watcher]     │           │                   │           │
│  └──────┬───────┘           └────────┬──────────┘           │
│         │                            │                      │
│         ▼                            ▼                      │
│  ┌──────────────────────────────────────────────┐          │
│  │         Existing Action Dispatch              │          │
│  │    agent | command | webhook                  │          │
│  └──────────────────────────────────────────────┘          │
│         │                            │                      │
│         ▼                            ▼                      │
│  ┌─────────────┐            ┌──────────────────┐           │
│  │ cron/ scripts│            │ Docker Agent     │           │
│  │ (command)    │            │ (agent jobs)     │           │
│  └──────┬──────┘            └────────┬─────────┘           │
│         │                            │                      │
│         ▼                            ▼                      │
│  ┌──────────────────────────────────────────────┐          │
│  │         Notification Layer                    │          │
│  │    Slack | Web UI | Database                  │          │
│  └──────────────────────────────────────────────┘          │
└─────────────────────────────────────────────────────────────┘
```

## Success Criteria

### Reliability Metrics
- **Zero silent failures:** Every automation failure produces a notification
- **Zero dropped records:** Every Filter-Fan has catch-all coverage
- **Zero infinite loops:** Every Loop has hard exit conditions
- **Schema compliance:** 100% of Transformer outputs pass validation

### Operational Metrics
- **Job completion rate:** > 95% of agent jobs complete successfully
- **Notification delivery:** 100% of job results reach at least one channel (Slack, web UI)
- **Cron reliability:** 100% of enabled crons fire on schedule

## Documentation Standards

### Required for Each Automation
1. Pattern type classification
2. Input/output specification
3. Failure handling description
4. Owner assignment
5. Check frequency (for Watchers)

### Technical Documentation System

All architectural and system knowledge must be maintained in `docs/` as focused, self-contained markdown files. This is critical for AI agent context efficiency and team onboarding.

#### Documentation Structure
- **`docs/INDEX.md`** — Master table of contents with "when to reference" guide. Must be kept in sync with all doc files. Max ~50 lines to stay scannable.
- **Individual docs** — Numbered `01-*.md` through `NN-*.md`, one per domain (architecture, database, specialties, etc.)
- **Solved issues** — `references/solved/*.md` for debugging knowledge that prevents repeat investigations

#### Documentation File Template

Every technical doc must follow this structure:

```markdown
# NN — Title

## Overview
One paragraph explaining what this doc covers and when to read it.

## [Domain-Specific Sections]
Tables, diagrams, and concise explanations.
Prefer tables over prose for structured data.
Use code blocks for file paths, commands, and config examples.

## Key Files
| File | Purpose |
|------|---------|
| `path/to/file.js` | What it does |
```

#### When to Create/Update Documentation
1. **New feature or subsystem added** — Create a new doc or update the relevant existing doc
2. **Architecture change** — Update `01-architecture.md` and any affected docs
3. **Database schema change** — Update `03-database-schema.md` after migration
4. **New specialty created** — Update `05-skills.md`
5. **Bug solved after investigation** — Create `references/solved/issue-name.md`
6. **New doc created** — Update `docs/INDEX.md` immediately

#### Documentation Quality Rules
- **Self-contained**: Each doc must be readable without context from other docs
- **Tables over prose**: Use tables for structured data (env vars, endpoints, file mappings)
- **No duplication**: Reference other docs by path instead of copying content
- **Current**: Docs must reflect the actual codebase — stale docs are worse than no docs
- **Concise**: Optimize for AI token efficiency — every line should earn its place

#### Solved Issues Format (`references/solved/`)

```markdown
# Issue Title

**Date:** YYYY-MM-DD
**Component:** `path/to/affected/file`

## Problem
What was broken and how it manifested.

## Root Cause
The actual technical cause (not symptoms).

## Solution
What was changed and why it works.

## Key Takeaway
One-line lesson for future reference.
```

## Naming Conventions — User-Facing vs Internal

The `23wf` package uses internal naming conventions that differ from 23 Systems' user-facing terminology. All user-facing communication (UI, docs, prompts, conversations) must use the 23 Systems terms. Internal code, paths, database tables, and package APIs retain the original names.

| Concept | User-Facing Term (23 Systems) | Internal/Code Term (23wf) | Notes |
|---------|-------------------------------|----------------------------|-------|
| Pluggable capabilities | **Specialties** | `skills` | Directory `skills/`, files `SKILL.md`, template var `{{skills}}`, tool names `get_skill_building_guide` / `get_skill_details` — all stay as-is in code |
| Multi-agent work groups | **Teams** | `clusters` | DB tables `clusters` / `cluster_roles`, config files `CLUSTER_SYSTEM_PROMPT.md` / `CLUSTER_ROLE_PROMPT.md`, routes `/cluster/`, template vars `{{CLUSTER_SHARED_DIR}}` — all stay as-is in code |
| Autonomous workers | **Agents** | `agents` | No difference — same term in both contexts |

### Why the Split?
The 23wf package hardcodes internal names in paths, database migrations, template variables, and CLI tooling. Renaming at the package level would require a major version bump and DB migration. Instead, we maintain a thin translation layer:
- The **portal UI** (`lib/portal/`) already presents "Teams" to users while calling `cluster*` functions internally
- **Documentation and prompts** should use the user-facing terms with parenthetical code references where needed (e.g., "specialties (internally: `skills/`)")
- **Config file names** retain internal naming (`CLUSTER_ROLE_PROMPT.md`, `SKILL_BUILDING_GUIDE.md`) but their prose content should use user-facing terms

### Quick Reference for Writing Docs & Prompts
- "Create a new specialty" (not "Create a new skill")
- "Your team has 3 roles" (not "Your cluster has 3 roles")
- "Active specialties" (not "Active skills") when describing capabilities to users
- When referencing paths or code: "specialties directory (`skills/`)" or "team config (`CLUSTER_SYSTEM_PROMPT.md`)"

---

## Spec Execution Order

All specs in `.specify/specs/` are numbered by execution priority. Work them in order — each builds on the last.

| # | Spec | Priority | Key Dependencies |
|---|------|----------|-----------------|
| **000** | Rebrand thepopebot to 23WF | P0 | Phase 1 (user-editable files) first; Phases 2-5 blocked on package fork |
| **001** | End User Portal | P0 | Rebrand Phase 1 complete, Clusters functional |
| **002** | Slack Pipeline Integration | P1 | End User Portal feature-complete |
| **003** | AWS Cloud Deployment | P1 | All features complete; staging unrestricted, production requires **"DEPLOY PRODUCTION"** |

---

**Document Owner:** 23 Systems
**Last Updated:** 2026-03-20
**Status:** Active
**Review Cycle:** Monthly
