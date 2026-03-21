# 07 — Configuration Files

## Overview

All user-editable configuration lives in `config/`. These files control agent personality, behavior, scheduling, and automation.

## Prompt Files

| File | Consumed By | Purpose |
|------|------------|---------|
| `SOUL.md` | Docker agents (Pi/Claude) | Personality, identity, values. Injected into agent system prompt at container startup |
| `JOB_PLANNING.md` | Event Handler (Job Agent) | System prompt for the LangGraph job planning agent. Controls how chat requests become jobs |
| `CODE_PLANNING.md` | Event Handler (Code Agent) | System prompt for the code workspace agent |
| `JOB_AGENT.md` | Docker agents | Runtime environment documentation. Tells the agent what tools/capabilities it has |
| `JOB_SUMMARY.md` | Docker agents | Prompt template for summarizing completed job results |
| `HEARTBEAT.md` | Event Handler | Self-monitoring and health check behavior |
| `CLUSTER_SYSTEM_PROMPT.md` | Cluster agents | Default system prompt injected into all cluster agent containers |
| `CLUSTER_ROLE_PROMPT.md` | Cluster agents | Default task prompt for roles (overridden by role-specific prompts) |
| `PATTERN_GUIDE.md` | Reference | Documents 6 canonical automation patterns |
| `SKILL_BUILDING_GUIDE.md` | Reference | Guide for creating new agent specialties |

## Markdown Include System

All config `.md` files support a template system processed by `render-md.js`:

```markdown
# My Prompt

Current time: {{datetime}}

## Personality
{{ config/SOUL.md }}

## Available Specialties
{{skills}}
```

| Syntax | Resolution |
|--------|------------|
| `{{ filepath.md }}` | Include file contents (path relative to project root) |
| `{{datetime}}` | Current ISO timestamp |
| `{{skills}}` | Bullet list of active specialty names + descriptions from SKILL.md frontmatter |

- Includes are recursive (file A can include file B which includes file C)
- Circular reference detection prevents infinite loops
- Resolved at runtime, not build time

## JSON Configuration Files

### CRONS.json

Scheduled jobs loaded by `node-cron` at server startup.

```json
[
  {
    "name": "Daily Check",
    "schedule": "0 9 * * *",
    "type": "agent",
    "job": "Review recent activity and summarize findings",
    "enabled": true,
    "llm_provider": "anthropic",
    "llm_model": "claude-sonnet-4-20250514"
  }
]
```

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Display name |
| `schedule` | Yes | Cron expression |
| `type` | No | `agent` (default), `command`, or `webhook` |
| `job` | For agent | Task prompt for the LLM |
| `command` | For command | Shell command (runs in `cron/` directory) |
| `url` | For webhook | Target URL |
| `method` | For webhook | `GET` or `POST` (default: `POST`) |
| `headers` | For webhook | Custom request headers |
| `vars` | For webhook | Key-value pairs for request body |
| `enabled` | No | `false` to disable (default: `true`) |
| `llm_provider` | No | Override LLM provider for this job |
| `llm_model` | No | Override LLM model for this job |

### TRIGGERS.json

Webhook triggers that fire on POST requests to watched paths.

```json
[
  {
    "name": "GitHub Push",
    "watch_path": "/webhook/github-push",
    "enabled": true,
    "actions": [
      {
        "type": "agent",
        "job": "Review the push to {{body.ref}}: {{body.head_commit.message}}"
      }
    ]
  }
]
```

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Display name |
| `watch_path` | Yes | URL path to watch |
| `actions` | Yes | Array of actions (same fields as cron entries) |
| `enabled` | No | `false` to disable |

**Template tokens** (available in `job` and `command` strings):

| Token | Resolves to |
|-------|-------------|
| `{{body}}` | Entire request body as JSON |
| `{{body.field}}` | Nested field from request body |
| `{{query}}` | All query parameters as JSON |
| `{{query.field}}` | Specific query parameter |
| `{{headers}}` | All request headers as JSON |
| `{{headers.field}}` | Specific request header |

### MCP_SERVERS.json

Active Model Context Protocol servers.

```json
[
  {
    "name": "builtwith",
    "path": "mcp-servers/builtwith"
  }
]
```

## Automation Patterns (PATTERN_GUIDE.md)

Six canonical patterns for building automations:

1. **Trigger-Route** — Event arrives, route to appropriate handler
2. **Filter-Fan** — Filter events, fan out to multiple workers
3. **Transformer** — Transform data between formats
4. **Collector** — Aggregate data from multiple sources
5. **Loop** — Iterative processing with feedback
6. **Watcher** — Monitor for changes and react
