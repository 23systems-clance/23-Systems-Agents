# Research: Spec 006 — Infrastructure Migration

**Date**: 2026-03-21
**Spec**: [006-infra-migration-k8s.md](./006-infra-migration-k8s.md)

## Current Architecture Analysis

### Job Creation Flow

**File**: `Clusters/lib/tools/create-job.js`

1. Generates UUID for job ID
2. Creates branch name: `job/{uuid}`
3. Generates job title via LLM (structured output)
4. Creates `logs/{jobId}/job.config.json` with metadata via GitHub Git Data API
5. Pushes branch → triggers `run-job.yml` GitHub Actions workflow
6. Returns `{ job_id, branch, title }`

**Called from**:
- API: `Clusters/api/index.js` POST `/api/create-job`
- Action dispatch: `Clusters/lib/actions.js` (crons and webhook triggers)

### Action Dispatch System

**File**: `Clusters/lib/actions.js`

Three action types via `executeAction()`:
- `command`: Shell exec in `cron/` or `triggers/` directory
- `webhook`: HTTP request with optional vars
- `agent` (default): Calls `createJob()` with optional LLM overrides

### GitHub Actions Workflows

| Workflow | Trigger | Key Logic |
|----------|---------|-----------|
| `run-job.yml` | `job/*` branch creation | Sparse checkout → read `job.config.json` → build SECRETS/LLM_SECRETS JSON → select OCI image → run container with env vars |
| `auto-merge.yml` | PR opened from `job/*` | Poll mergeable status (max 5 min) → check `AUTO_MERGE` flag → validate files against `ALLOWED_PATHS` → `gh pr merge --squash --delete-branch` |
| `notify-pr-complete.yml` | After `auto-merge.yml` | Read job.config.json → gather PR metadata → POST to `/api/github/webhook` |
| `notify-job-failed.yml` | `run-job.yml` failure | Extract job ID → POST failure payload to `/api/github/webhook` |
| `rebuild-event-handler.yml` | Push to `main` | Skip if only logs → rebuild (.next swap + PM2 reload) or full restart on version change |
| `upgrade-event-handler.yml` | Manual dispatch | `npm update 23wf` → create upgrade PR with auto-merge |

### Container Environment Variables

Passed from `run-job.yml` to agent containers (microsandbox microVMs in Phase 0):

| Var | Source | Purpose |
|-----|--------|---------|
| `REPO_URL` | Constructed | Git clone URL |
| `BRANCH` | Branch name | Job branch to checkout |
| `SECRETS` | `AGENT_*` GitHub secrets (excl. `AGENT_LLM_*`) | Protected credentials (env-sanitized from LLM) |
| `LLM_SECRETS` | `AGENT_LLM_*` GitHub secrets | LLM-visible credentials |
| `LLM_MODEL` | `job.config.json` or `vars.LLM_MODEL` | Model override |
| `LLM_PROVIDER` | `job.config.json` or `vars.LLM_PROVIDER` | Provider override |
| `OPENAI_BASE_URL` | `vars.OPENAI_BASE_URL` | Custom provider endpoint |
| `AGENT_BACKEND` | `job.config.json` or `vars.AGENT_BACKEND` | `pi` or `claude-code` |

### Entrypoint Scripts

Both `docker/pi-coding-agent-job/entrypoint.sh` and `docker/claude-code-job/entrypoint.sh`:

1. Extract job ID from branch name
2. Export SECRETS and LLM_SECRETS as individual env vars
3. Git auth setup + clone
4. Install skill npm deps (`skills/active/*/package.json`)
5. Start Chrome if Puppeteer installed
6. Build system prompt from `SOUL.md` + `JOB_AGENT.md`
7. Read job description from `job.config.json`
8. Run agent (Pi or Claude Code) with LLM overrides
9. Commit results (full on success, logs-only on failure)
10. Create PR with log permalink
11. Re-raise exit code

### LLM Provider System

**File**: `Clusters/lib/ai/model.js`

- Single `createModel()` function reads `LLM_PROVIDER` + `LLM_MODEL` from environment
- Supported: `anthropic` (default), `openai`, `google`, `custom` (OpenAI-compatible)
- Default models: `claude-sonnet-4-20250514`, `gpt-4o`, `gemini-2.5-pro`
- **No routing logic** — single provider per process. The LLM router is a new component.

### Database Schema

**File**: `Clusters/lib/db/schema.js` — SQLite via Drizzle ORM

Current tables: `users`, `chats`, `messages`, `notifications`, `subscriptions`, `settings`, `clusters`, `clusterRoles`

**Key finding**: No `jobs` table — jobs exist only as GitHub branches with `logs/{jobId}/job.config.json`. Job status is queried from GitHub API. This means the BullMQ migration needs a new `jobs` table.

### Notification System

**Files**: `Clusters/lib/db/notifications.js` (createNotification, distributeNotification), `Clusters/lib/ai/index.js` (summarizeJob)

Flow: GitHub webhook → `summarizeJob()` (in `lib/ai/index.js`) → `createNotification()` → `distributeNotification()` → Slack

The notification creation function works with any payload — it doesn't depend on GitHub. The worker can call `createNotification()` directly.

## Migration Impact Analysis

### High-Impact Changes (must modify)

| Component | Current | New | Risk |
|-----------|---------|-----|------|
| `createJob()` | Pushes GitHub branch | Enqueues BullMQ job (when `JOB_DISPATCH=bullmq`) | Medium — feature flag isolates risk |
| `executeAction()` | Calls `createJob()` for agent type | No change — `createJob()` handles routing internally | Low |
| Job status API | Queries GitHub API | Queries BullMQ + Postgres | Medium |
| Notification webhook | Receives POST from GitHub Actions | Worker calls `createNotification()` directly | Low |
| Server startup | Init DB + crons + triggers | Also init BullMQ connection + start worker | Medium |

### No-Change Components

| Component | Why No Change |
|-----------|---------------|
| Entrypoint scripts | Same env vars, same OCI image, same behavior (microsandbox runs OCI-compatible images) |
| Cron scheduler | Still fires `executeAction()` — dispatch routing is inside `createJob()` |
| Trigger system | Same — fires `executeAction()` |
| Chat streaming | Separate route, unaffected |
| Auth system | Unaffected |
| Web UI | Unaffected (job status endpoint changes, but UI calls same route) |

### New Components Required

1. **BullMQ producer** — in `createJob()`, conditional on `JOB_DISPATCH`
2. **Worker process** — separate PM2 process, 7-step Blueprint state machine
3. **LLM router** — Ollama-first with cloud fallback for planning/chat/summary
4. **Postgres migration** — new `jobs`, `capabilities` tables
5. **PM2 ecosystem config** — manage event handler + worker processes

## Technology Decisions

### BullMQ vs Alternatives

| Option | Pros | Cons | Decision |
|--------|------|------|----------|
| **BullMQ** | Redis-backed, Node.js native, rich features (priorities, retries, progress), battle-tested | Requires Redis | **Selected** — best fit for Node.js, dashboard available |
| Bee-Queue | Lightweight | Less maintained, fewer features | Rejected |
| Agenda | MongoDB-backed | Wrong DB (we're on Postgres) | Rejected |
| pg-boss | Postgres-backed, no Redis | Less mature, slower throughput | Considered for Phase 0 if Redis is unwanted |

### Microsandbox for Agent Isolation

| Option | Pros | Cons | Decision |
|--------|------|------|----------|
| **microsandbox** | microVM via Apple Hypervisor (no Docker Desktop VM), <200ms boot, <5 MiB overhead, OCI-compatible, VM-level isolation (dedicated kernel per sandbox), Node.js SDK | Pre-1.0 (v0.1.x), smaller community | **Selected** — saves ~1-2GB RAM (no Docker Desktop Linux VM), better isolation, native macOS hypervisor |
| Docker Desktop | Mature, large ecosystem, extensive tooling | Requires Linux VM on macOS (~1-2GB RAM overhead), container-level isolation (shared kernel) | Rejected — RAM overhead unacceptable on 16GB Mac Mini |
| Lima/colima | Lighter than Docker Desktop | Still requires Linux VM, less integrated | Rejected — same fundamental VM overhead issue |

**Key insight**: microsandbox runs OCI images directly via Apple Hypervisor Framework (libkrun), so existing entrypoint scripts and Docker Hub/GHCR images work unchanged. Each sandbox gets its own dedicated kernel (VM-level isolation) vs Docker's shared kernel (container-level isolation).

**Fallback strategy**: If microsandbox proves too immature, fall back to Docker Desktop with the understanding that ~1-2GB RAM headroom is lost. The `worker/sandbox.js` module abstracts this — swap the implementation without changing the Blueprint state machine.

### PM2 for Process Management

Already implied by `rebuild-event-handler.yml` which uses `npx pm2 reload all`. PM2 is the right choice for managing both the event handler and the worker process on the Mac Mini.

### Ollama for Local LLM

Ollama is the standard for local model serving on macOS. One-line install, supports Apple Silicon Metal acceleration, HTTP API compatible with OpenAI format (works with existing `custom` provider).

## Key Risks Identified

1. **SQLite → Postgres migration**: Existing data in `data/23wf.sqlite` needs migration. Drizzle supports Postgres — schema files need dialect change.
2. **Package boundary**: `createJob()` lives in the 23wf npm package (`Clusters/lib/tools/create-job.js`). Modifying it requires either forking or adding a hook/override mechanism.
3. **Worker process crash recovery**: BullMQ has stalled job detection, but sandbox orphaning is possible if the worker dies mid-execution. Microsandbox SDK provides `sandbox.stop()` for cleanup.
