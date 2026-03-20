# 06 — Clusters & Workers

## Overview

Clusters are groups of Docker containers spawned from role definitions. Each role has its own trigger, prompt, and concurrency settings. Workers are ephemeral containers — they spin up, execute, and terminate.

## Data Model

```
cluster
  ├── system_prompt (shared by all roles)
  ├── folders (shared folder access)
  ├── enabled (master switch)
  │
  ├── role: "Data Collector"
  │   ├── prompt: "Scrape data from..."
  │   ├── trigger: { type: "cron", cron: "0 */6 * * *" }
  │   ├── max_concurrency: 2
  │   ├── folders: ["/data/raw"]
  │   └── mcp_servers: ["builtwith"]
  │
  └── role: "Report Generator"
      ├── prompt: "Analyze collected data..."
      ├── trigger: { type: "webhook" }
      ├── max_concurrency: 1
      └── folders: ["/data/reports"]
```

## Trigger Types

| Type | Configuration | How It Fires |
|------|--------------|--------------|
| `manual` | `{ type: "manual" }` | User clicks "Run" in UI |
| `webhook` | `{ type: "webhook" }` | POST to `/cluster/{clusterId}/{roleId}/webhook` |
| `cron` | `{ type: "cron", cron: "*/5 * * * *" }` | Scheduled via node-cron |
| `file_watch` | `{ type: "file_watch", file_watch: ["/path/to/watch"] }` | chokidar monitors for file changes |

## Container Execution

**Source**: `Clusters/lib/cluster/execute.js`

### Lifecycle

1. **canRunRole()** — Checks cluster enabled + current container count < max_concurrency
2. **runClusterWorker()** — Creates and starts Docker container
3. Container runs with:
   - `SYSTEM_PROMPT` = cluster system_prompt + role instructions
   - `PROMPT` = role task prompt (supports `{{PLACEHOLDER}}` variables)
   - Mounted folders from cluster + role definitions
4. Container executes autonomously, then stops
5. Logs streamed via SSE (`Clusters/lib/cluster/stream.js`)

### Template Variables in Prompts

| Variable | Resolves To |
|----------|-------------|
| `{{CLUSTER_DIR}}` | Cluster's data directory |
| `{{ROLE_DIR}}` | Role's data directory |
| `{{TIMESTAMP}}` | Current ISO timestamp |
| `{{ROLE_NAME}}` | Name of the executing role |

### Concurrency Control

- Each role has `maxConcurrency` (default: 1)
- Before launching, `canRunRole()` counts running containers for that role
- If at limit, the trigger is skipped (no queue — fire-and-forget)

## Runtime Scheduler

**Source**: `Clusters/lib/cluster/runtime.js`

- Manages in-memory cron schedules and file watchers for all cluster roles
- Uses `node-cron` for scheduled triggers
- Uses `chokidar` for file system watching
- Reloads on cluster/role CRUD operations

## Key Files

| File | Purpose |
|------|---------|
| `Clusters/lib/cluster/actions.js` | Server Actions for cluster/role CRUD |
| `Clusters/lib/cluster/execute.js` | Docker container lifecycle |
| `Clusters/lib/cluster/runtime.js` | Trigger scheduler (cron + file watch) |
| `Clusters/lib/cluster/stream.js` | SSE live console streaming |
| `Clusters/lib/cluster/components/` | React UI components |
| `Clusters/lib/db/clusters.js` | Database queries |
| `config/CLUSTER_SYSTEM_PROMPT.md` | Default cluster system prompt |
| `config/CLUSTER_ROLE_PROMPT.md` | Default role prompt template |

## Web UI Routes

| Route | Purpose |
|-------|---------|
| `/clusters` | List all clusters |
| `/cluster/{id}` | View cluster details, roles, and controls |
| `/cluster/{id}/logs` | Live worker execution logs |
