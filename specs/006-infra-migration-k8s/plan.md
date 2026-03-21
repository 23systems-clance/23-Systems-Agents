# Implementation Plan: Spec 006 — Infrastructure Migration

**Branch**: `rebrand` (current) → `infra-migration-phase0` (new)
**Date**: 2026-03-21
**Spec**: [006-infra-migration-k8s.md](./006-infra-migration-k8s.md)
**Research**: [006-infra-migration-k8s-research.md](./006-infra-migration-k8s-research.md)
**Data Model**: [006-infra-migration-k8s-data-model.md](./006-infra-migration-k8s-data-model.md)

---

## Summary

Replace GitHub Actions job orchestration with BullMQ + Redis on a Mac Mini M4 (16GB RAM). Add Ollama (Phi-4 14B) for local LLM inference on planning/chat/summary tasks. Introduce Postgres for capability registry and job tracking. Retain Git/GitHub for code storage and PRs.

**Approach**: Incremental migration with `JOB_DISPATCH` feature flag — both systems run simultaneously, switch with a single env var, instant rollback.

---

## Technical Context

**Language/Version**: JavaScript ES2022, Node.js 20.x
**Primary Dependencies**: Next.js 14, 23wf npm package, Drizzle ORM, BullMQ (new), ioredis (new), node-postgres/postgres.js (new), microsandbox (new), Ollama (local)
**Storage**: Postgres (local Docker, replacing SQLite) via Drizzle ORM
**Testing**: Manual testing against full job lifecycle + heartbeat
**Target Platform**: Mac Mini M4 base (16GB RAM), microsandbox (microVM via Apple Hypervisor), PM2 process manager
**Project Type**: Agent infrastructure (event handler + worker process)
**Performance Goals**: Job dispatch <1s (BullMQ), Ollama >15 tok/s, job status <100ms
**Constraints**: 16GB RAM budget (~9GB Ollama + ~3GB OS + ~1GB Redis/Next.js + ~3GB headroom; no Docker Desktop VM — microsandbox runs directly on Apple Hypervisor), max 2 concurrent agent sandboxes

---

## Constitution Check

_GATE: Must pass before implementation._

### SOUL.md Principles

| Principle | Status | Notes |
|-----------|--------|-------|
| **Methodical**: Work through problems systematically | PASS | 7-step Blueprint state machine, phased migration, feature flag |
| **Reliable**: Follow through on commitments | PASS | Feature parity map (22 features), rollback strategy, BullMQ persistence |
| **Curious**: Explore and learn from codebase | PASS | Research phase completed, existing patterns documented |
| **Quality over speed** | PASS | Incremental migration, not big-bang. Each phase independently deployable |
| **Simplicity** | PASS | Reuse existing entrypoint scripts unchanged. Worker is one file. LLM router is one function |

### CONSTITUTION.md Principles

| Principle | Status | Notes |
|-----------|--------|-------|
| **1. Pattern-First Design** | PASS | Worker uses deterministic-agentic Blueprint pattern. All existing patterns (Trigger-Route, Filter-Fan, etc.) preserved |
| **2. Failure Awareness** | PASS | Every step has failure handling. BullMQ stalled job detection. Sandbox timeout watchdog. Cloud fallback for Ollama |
| **3. Observability** | PASS | Per-step progress events via BullMQ `job.updateProgress()`. Job status in Postgres. Notifications preserved |
| **4. Reliability Over Cleverness** | PASS | Reuse existing entrypoint scripts, existing notification system, existing auth. No custom orchestrator |
| **5. Staging-First Deployment** | PASS | `JOB_DISPATCH` flag enables testing on staging before production cutover. Production safeguard preserved |
| **6. AI as Typed Function** | PASS | LLM router uses typed request/response. Job planning outputs structured `job.config.json` |

---

## Critical Architectural Decision: Package Boundary

**Problem**: `createJob()` lives in the 23wf npm package (`Clusters/lib/tools/create-job.js`). We need to modify it to support BullMQ dispatch, but the package is published to npm and shared across deployments.

**Options**:

| Option | Pros | Cons |
|--------|------|------|
| **A. Modify package source directly** | Clean, single source of truth | Breaks other users if published; requires version bump |
| **B. Override `createJob` at project level** | No package changes needed | Fragile, breaks on package updates |
| **C. Add dispatch hook/adapter pattern in package** | Clean extension point, backwards compatible | More code, but simple |

**Recommendation: Option C** — Add a `jobDispatcher` adapter in the package. Default implementation pushes GitHub branches (current behavior). Project-level config can override with BullMQ dispatcher. This is backwards-compatible and publishable.

```javascript
// In package: lib/tools/create-job.js
const defaultDispatcher = { dispatch: pushGitHubBranch };
let dispatcher = defaultDispatcher;

export function setJobDispatcher(d) { dispatcher = d; }

export async function createJob(jobDescription, options = {}) {
  const jobId = uuidv4();
  const title = await generateJobTitle(jobDescription);
  const config = buildJobConfig(jobDescription, options);

  // Dispatch via configured adapter
  const result = await dispatcher.dispatch({ jobId, title, config });
  return { job_id: jobId, branch: result.branch, title };
}
```

```javascript
// In project: worker/bullmq-dispatcher.js
import { Queue } from 'bullmq';
const queue = new Queue('agent-jobs', { connection: redis });

export const bullmqDispatcher = {
  async dispatch({ jobId, title, config }) {
    // Still create GitHub branch (for git clone in container)
    const branch = await pushGitHubBranch({ jobId, title, config });
    // But also enqueue to BullMQ for worker processing
    await queue.add('agent-job', { jobId, title, config, branch }, { jobId });
    return { branch };
  }
};
```

**Key insight**: Even with BullMQ, we still need the GitHub branch — the sandbox clones it. The difference is that `run-job.yml` no longer triggers. The branch is just a data carrier.

---

## Project Structure

### Documentation (this feature)

```text
specs/006-infra-migration-k8s/
├── spec.md          # Spec (clarified)
├── research.md      # Research findings
├── data-model.md    # Database schema
├── plan.md          # This file
└── tasks.md         # Task list
```

### Source Code (Phase 0 changes)

```text
# New files
worker/
├── index.js                    # Worker entry point (PM2-managed process)
├── blueprint.js                # 7-step Blueprint state machine
├── sandbox.js                  # Microsandbox microVM spawn/monitor (replaces Docker)
├── auto-merge.js               # Port of auto-merge.yml logic
├── notify.js                   # Notification assembly + delivery
├── validate.js                 # Output validation (lint + anomaly detection)
└── llm-router.js               # Ollama-first LLM routing

ecosystem.config.js              # PM2 config for event handler + worker
docker-compose.infra.yml         # Postgres + Redis containers

# Modified files (in Clusters/ package source)
Clusters/lib/tools/create-job.js  # Add dispatcher adapter pattern
Clusters/lib/db/schema.js         # Add jobs + capabilities tables, change to pgTable
Clusters/lib/db/index.js          # Change connection from SQLite to Postgres
Clusters/lib/ai/model.js          # Add Ollama/custom provider routing
Clusters/config/instrumentation.js # Add BullMQ init + worker start + microsandbox server

# Modified files (project level)
.env                              # Add DATABASE_URL, REDIS_URL, OLLAMA_URL, JOB_DISPATCH
Sandboxfile                       # Microsandbox config (sandbox definitions for agent images)
```

### Structure Decision

The `worker/` directory is a new top-level directory (not in the npm package) because:
1. The worker is project-specific — it uses project-level config files
2. It runs as a separate PM2 process, not inside Next.js
3. It imports from the 23wf package but isn't part of it
4. Phase 1+ may containerize it separately

---

## Implementation Phases

### Phase 0A: Infrastructure Foundation (8 hours)

**Goal**: Postgres + Redis running locally, BullMQ connected, feature flag in place.

1. **Docker Compose for infra** — `docker-compose.infra.yml` with `postgres:16-alpine` (AOF) + `redis:7-alpine`
2. **Drizzle dialect migration** — Change `Clusters/lib/db/schema.js` from `sqliteTable` to `pgTable`, update `lib/db/index.js` connection
3. **Run Drizzle migrations** — `drizzle-kit generate` + `drizzle-kit migrate` against local Postgres
4. **Data migration script** — Export SQLite → JSON → Import Postgres (one-time)
5. **New tables** — `jobs`, `capabilities`, `job_capabilities` (see data-model.md)
6. **Seed capabilities** — Scan `skills/active/` and `config/templates/` on startup
7. **JOB_DISPATCH env var** — Add to `.env`, read in `createJob()`
8. **Dispatcher adapter** — Add `setJobDispatcher()` + default GitHub dispatcher in package
9. **BullMQ producer** — Create `bullmqDispatcher` that enqueues to Redis

**Exit criteria**: `createJob()` with `JOB_DISPATCH=bullmq` enqueues a job to Redis AND creates the GitHub branch. Job appears in `jobs` table with status `queued`.

### Phase 0B: Worker Process (10 hours)

**Goal**: Worker picks up jobs from BullMQ and executes the full 7-step Blueprint.

1. **PM2 ecosystem config** — `ecosystem.config.js` with `event-handler` + `worker` processes
2. **Worker entry point** — `worker/index.js` connects to Redis, creates BullMQ Worker
3. **Step 1: Resolve & Prepare** — Read job from Postgres, resolve capabilities, build env vars, assemble scoped system prompt
4. **Step 2: Spawn Sandbox** — microsandbox SDK `create()` with OCI image, env vars, timeout watchdog (default 30 min)
5. **Step 3: Agent Execution** — Wait for sandbox exit, stream logs
6. **Step 4: Validate Output** — Check exit code, find PR, run lint on changed files, anomaly detection
7. **Step 5: Retry** — If validation failed, feed errors back, re-run sandbox (max 1 retry), label `[needs-review]` on 2nd failure
8. **Step 6: Auto-Merge** — Port `auto-merge.yml` logic (check AUTO_MERGE, validate ALLOWED_PATHS, `gh pr merge --squash --delete-branch`)
9. **Step 7: Notify + Meter** — Build notification payload, call `createNotification()`, record capability usage
10. **Progress tracking** — `job.updateProgress()` at each step, update `jobs` table

**Exit criteria**: Full job lifecycle works — chat → enqueue → worker picks up → sandbox runs → PR created → auto-merged → notification sent. Job status API returns real-time BullMQ state.

### Phase 0C: Local LLM (4 hours)

**Goal**: Ollama serves planning/chat/summary requests, cloud fallback works.

1. **Install Ollama** — `brew install ollama` on Mac Mini
2. **Pull Phi-4 14B** — `ollama pull phi4:14b` (Q4_K_M quantization, ~9GB)
3. **LLM router module** — `worker/llm-router.js` with Ollama-first + Claude Sonnet fallback
4. **Integrate router** — Hook into event handler's `createModel()` for planning/chat/summary
5. **Ollama health check** — Add to heartbeat cron
6. **Test fallback** — Stop Ollama, verify cloud fallback works with warning log

**Exit criteria**: Chat UI responses come from Ollama (Phi-4 14B). Stopping Ollama triggers cloud fallback with logged warning. >15 tok/s on planning tasks.

### Phase 0D: Verification (2 hours)

**Goal**: All 22 GitHub features verified working via BullMQ.

1. **Test matrix** — Run through all 22 features from the migration map
2. **Heartbeat test** — Enable heartbeat cron, verify BullMQ dispatch, verify Ollama handles it
3. **Validation test** — Trigger a job that produces lint errors, verify retry + escalation
4. **Resource limit test** — Set short timeout, verify kill + notification
5. **Concurrency test** — Enqueue 3+ jobs, verify max 2 concurrent
6. **Cutover test** — Switch `JOB_DISPATCH` between `github` and `bullmq`, verify both paths work

**Exit criteria**: All 22 features pass. `JOB_DISPATCH=bullmq` is the default for staging.

---

## Key Design Decisions

### 1. GitHub Branch Still Created

Even with BullMQ dispatch, the worker still creates a `job/*` branch on GitHub. Reason: the container entrypoint clones this branch. The branch is a data carrier, not a trigger. This means:
- **No change to entrypoint scripts** — they still `git clone` the branch
- **GitHub Actions `run-job.yml` must be disabled** — otherwise it also triggers on the branch. Solution: add `if: github.event.ref != 'refs/heads/job/*'` guard, or remove the workflow entirely after cutover.

### 2. Worker Separate from Event Handler

The worker runs as a separate PM2 process, not embedded in Next.js. Reasons:
- **Crash isolation** — worker crash doesn't take down the web UI
- **Resource isolation** — worker's sandbox spawning doesn't compete with Next.js request handling
- **Restart independence** — PM2 auto-restarts each process independently
- **Future migration** — worker becomes a separate container/pod in Phase 1+

### 3. Postgres from Day 1

We introduce Postgres in Phase 0 instead of keeping SQLite. Reasons:
- Capability registry needs proper relational queries
- Job tracking needs concurrent write safety (worker + event handler)
- Avoids a painful SQLite → Postgres migration later
- Postgres in Docker is trivial on Mac Mini

### 4. System Prompt Assembly is Task-Scoped

The worker assembles a different system prompt based on job type:
- **Heartbeat**: `SOUL.md` + `HEARTBEAT.md` only
- **Coding task**: `SOUL.md` + `JOB_AGENT.md` + relevant skill docs from capability registry
- **Chat/planning**: `SOUL.md` only (handled by event handler, not worker)

This reduces token waste and improves agent focus (Stripe Minions insight).

### 5. Auto-Merge Logic in Worker, Not Separate Process

The auto-merge step is part of the worker's Blueprint (Step 6), not a separate listener. This simplifies the system — one process handles the entire job lifecycle end-to-end.

---

## Dependency Graph

```
Phase 0A: Foundation
  ├── Docker Compose (Postgres + Redis)
  ├── Drizzle dialect migration
  ├── New tables (jobs, capabilities)
  ├── JOB_DISPATCH feature flag
  └── BullMQ producer
       │
Phase 0B: Worker (depends on 0A)
  ├── PM2 ecosystem config
  ├── Blueprint state machine
  ├── Sandbox spawning (microsandbox)
  ├── Validation + retry
  ├── Auto-merge port
  └── Notifications
       │
Phase 0C: Local LLM (independent of 0B, depends on 0A for Postgres)
  ├── Ollama install + model pull
  ├── LLM router
  └── Integration with event handler
       │
Phase 0D: Verification (depends on 0B + 0C)
  └── Full test matrix
```

**Parallelizable**: Phase 0C (LLM) can be built in parallel with Phase 0B (Worker) since they're independent. The LLM router hooks into the event handler, not the worker.

---

## Risk Mitigation Plan

| Risk | Mitigation | Fallback |
|------|------------|----------|
| SQLite → Postgres data loss | Export JSON backup before migration | Restore from SQLite backup |
| BullMQ worker crashes mid-job | BullMQ stalled job detection (5 min), re-queue or fail | `JOB_DISPATCH=github` rollback |
| Ollama quality too low | Cloud fallback automatic | Set `OLLAMA_URL=` (empty) to disable local LLM entirely |
| Microsandbox orphaning | Worker calls `sandbox.stop()` on stalled job detection | `microsandbox list` cleanup command |
| 16GB RAM exhaustion | Limit to 2 concurrent sandboxes, monitor with `htop` | Reduce to 1 concurrent if needed |
| Package `createJob` conflict | Dispatcher adapter pattern is backwards-compatible | Can fork package if needed |

---

## Complexity Tracking

| Deviation | Why Needed | Simpler Alternative Rejected Because |
|-----------|-----------|--------------------------------------|
| New `worker/` directory (6 files) | Worker is a separate process with distinct lifecycle | Embedding in Next.js would couple crash domains and complicate PM2 management |
| Postgres instead of SQLite | Concurrent writes from worker + event handler; capability registry needs relational queries | SQLite WAL mode could handle concurrency but migration to Postgres is inevitable for Phase 1 |
| BullMQ + Redis dependency | Need persistent job queue with retry, priority, progress tracking | Simple in-memory queue loses jobs on restart; pg-boss is less mature |
| Dispatcher adapter in package | Need to modify `createJob()` without breaking existing users | Direct modification would break other deployments; override pattern is fragile |
