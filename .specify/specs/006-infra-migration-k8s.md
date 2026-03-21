# Spec 006: Infrastructure Migration — GitHub Actions to Kubernetes + BullMQ

**Status:** Draft
**Priority:** P1 (High)
**Estimated Effort:** 80 hours
**Dependencies:** Cluster system stable (current), Mac Mini M4 base 16GB RAM (Phase 0)
**Sequence:** Self-hosted local (Phase 0) first — cloud deployment (Phase 1+) only after local is fully proven. Spec 003 (AWS) is an alternative cloud path, not a prerequisite

> **PRODUCTION DEPLOY SAFEGUARD:** Production deployments (merges to main, GKE service updates, DNS cutover to production domain) MUST NOT proceed unless the user explicitly says **"DEPLOY PRODUCTION"**. Staging deployments are unrestricted.

---

## Overview

Migrate the 23WF agent execution layer from GitHub Actions to a self-managed orchestration stack: BullMQ job queue + Redis + Kubernetes (GKE Autopilot) + local LLM inference via Ollama on Mac Mini. This enables multi-tenant operation at scale with SOC 2 compliance, eliminates GitHub Actions concurrency limits and cold start overhead, and reduces per-run LLM costs by ~40% through hybrid local/cloud model routing.

Git itself is retained for code storage and PRs. Only the orchestration and compute layer is replaced.

## Why Migrate

| Problem | Current (GitHub Actions) | After Migration |
|---------|------------------------|-----------------|
| Concurrency | 20 parallel jobs max (hard cap) | Unlimited (K8s autoscaling) |
| Cold start | ~30-60s per job (runner provisioning) | ~2-5s (warm pod pool) or <1s (BullMQ dispatch) |
| Tenant isolation | None — all jobs share one GH org | K8s namespaces + network policies + resource quotas |
| Cost at scale | Linear with GH Actions minutes | Sublinear (bin-packing, spot instances) |
| LLM cost | 100% cloud API | ~60% cloud, ~40% local (free after hardware) |
| Job status | GitHub API (rate limited) | Direct BullMQ + Postgres query (instant) |
| Secrets management | GitHub Secrets (org-level) | Per-tenant Postgres/Vault |
| SOC 2 readiness | Partial (no tenant isolation) | Full (namespace isolation, audit logging, Western-only models) |

---

## Environment Philosophy

| | Phase 0: Local | Phase 1: Cloud Run | Phase 2: GKE Autopilot |
|---|---|---|---|
| **Purpose** | Prove architecture, dev/test, low-volume production | Single-tenant cloud, moderate volume | Multi-tenant production at scale |
| **Job queue** | BullMQ + Redis (Mac Mini) | BullMQ + Memorystore | BullMQ + Memorystore (clustered) |
| **Agent execution** | Docker containers (Mac Mini) | Cloud Run Jobs | K8s Jobs (GKE) |
| **LLM (planning/chat)** | Ollama on Mac Mini | Ollama on Mac Mini via Tailscale | Ollama on Mac Mini or GPU node |
| **LLM (agent)** | Claude Sonnet (API) | Claude Sonnet (API) | Claude Sonnet (API) |
| **Database** | Postgres (local, Docker) | Cloud SQL (Postgres) | Cloud SQL (Postgres, HA) |
| **Cost (idle)** | ~$2.60/mo electricity | ~$0/mo (scale-to-zero) | ~$144/mo (control plane + Redis) |
| **Cost (20 tasks/mo)** | ~$3.00 + LLM | ~$5 + LLM | ~$148 + LLM |
| **Cost (50 tasks/mo)** | ~$3.00 + LLM | ~$12 + LLM | ~$152 + LLM |

---

## Goals

1. **Replace GitHub Actions as orchestration layer** with BullMQ + Redis job queue and direct container spawning
2. **Maintain feature parity** — every GitHub Actions feature (18 total) has a direct equivalent
3. **Enable multi-tenant isolation** via K8s namespaces, network policies, and resource quotas
4. **Reduce LLM costs ~40%** by routing planning, summaries, and chat to local Phi-4 14B on Mac Mini (16GB RAM constraint — single local model)
5. **SOC 2 compliance** — Western-only model stack (Anthropic US, Microsoft US), full audit logging
6. **Incremental migration** — each phase is independently deployable and production-usable

## Non-Goals

- Replacing Git/GitHub for code storage or PRs (retained as-is)
- Building a custom container orchestrator (use K8s)
- Training or fine-tuning local models (use off-the-shelf)
- Multi-region deployment (single region sufficient for initial scale)
- ~~Migrating off SQLite in Phase 0~~ **Resolved:** Postgres is introduced in Phase 0 for capability registry, job tracking, and secrets — eliminates a later migration step

---

## User Scenarios & Testing

### User Story 1 — Job Dispatch Without GitHub Actions (Priority: P0)

A user (or cron/trigger) creates a job via the event handler. Instead of pushing a `job/*` branch to trigger a GitHub Actions workflow, the event handler enqueues the job to BullMQ. A worker process picks it up, spawns a Docker container with the agent, and the container runs the job exactly as it does today — cloning the repo, running the LLM agent, committing results, and creating a PR.

**Why this priority**: This is the core replacement. Without this, nothing else works.

**Independent Test**: Create a job via chat UI → verify it appears in BullMQ → verify worker spawns container → verify PR is created on GitHub.

**Acceptance Scenarios**:

1. **Given** a job is created via chat UI, **When** the event handler processes it, **Then** a BullMQ job is enqueued (not a GitHub branch created)
2. **Given** a job is in the BullMQ queue, **When** a worker picks it up, **Then** a Docker container is spawned with the correct env vars (SECRETS, LLM_SECRETS, LLM_MODEL, etc.)
3. **Given** the agent container completes successfully, **When** it pushes results and creates a PR, **Then** the worker detects completion and calls the notification API
4. **Given** the agent container fails (non-zero exit), **When** the worker detects failure, **Then** it calls the failure notification API with error details
5. **Given** 21+ jobs are enqueued simultaneously, **When** workers process them, **Then** all jobs execute (no GitHub 20-job cap)

---

### User Story 2 — Auto-Merge Without GitHub Actions (Priority: P0)

When an agent job creates a PR, the worker process (not a GitHub workflow) validates the changed files against `ALLOWED_PATHS` and squash-merges if all files are within allowed prefixes.

**Why this priority**: Auto-merge is part of the core job lifecycle. Jobs that only write to `logs/` should auto-merge without human intervention.

**Independent Test**: Agent creates PR with changes only in `logs/` → verify PR is auto-merged → verify branch is deleted.

**Acceptance Scenarios**:

1. **Given** a PR is created by the agent with all changed files under `ALLOWED_PATHS`, **When** the worker runs auto-merge validation, **Then** the PR is squash-merged and branch deleted
2. **Given** a PR has changed files outside `ALLOWED_PATHS`, **When** validation runs, **Then** the PR is left open for human review
3. **Given** `AUTO_MERGE` setting is `false`, **When** any PR is created, **Then** no auto-merge is attempted
4. **Given** a PR has merge conflicts, **When** validation runs, **Then** the PR is left open and a notification is sent

---

### User Story 3 — Local LLM for Planning and Summaries (Priority: P1)

Job planning requests (deciding how to execute a task), job summaries, and chat UI conversations are routed to Ollama running on Mac Mini instead of the cloud Claude API. Agent execution (the hard coding/reasoning work) continues to use Claude Sonnet via API.

**Why this priority**: This is the primary cost reduction lever — ~40% LLM cost savings.

**Independent Test**: Create a job via chat → verify planning LLM call goes to Ollama (Phi-4 14B) → verify agent execution uses Claude Sonnet → verify summary uses Ollama (Phi-4 14B).

**Acceptance Scenarios**:

1. **Given** a chat message is received, **When** the event handler processes it, **Then** Ollama (Phi-4 14B) is used for the response
2. **Given** Ollama is unreachable, **When** a planning request is made, **Then** the system falls back to Claude Sonnet (cloud) and logs a warning
3. **Given** a job completes, **When** the summary is generated, **Then** Ollama (Phi-4 14B) is used
4. **Given** agent execution is triggered, **When** the container starts, **Then** Claude Sonnet is used (never local models for agent work)

---

### User Story 4 — Heartbeat and Self-Monitoring (Priority: P1)

The heartbeat cron (self-monitoring) runs against the local BullMQ queue instead of creating a GitHub branch. Lightweight heartbeat checks use Ollama; only complex self-analysis tasks escalate to Claude.

**Why this priority**: Heartbeat is currently disabled because it costs a full agent job. Local LLM makes it free to run.

**Independent Test**: Enable heartbeat cron → verify it dispatches to BullMQ → verify Ollama handles the check → verify notification on anomaly.

**Acceptance Scenarios**:

1. **Given** the heartbeat cron fires, **When** it dispatches, **Then** a BullMQ job is created (not a GitHub branch)
2. **Given** a heartbeat job runs, **When** the check is lightweight (status check), **Then** Ollama handles it locally
3. **Given** the heartbeat detects an anomaly, **When** it needs deep analysis, **Then** it escalates to Claude Sonnet
4. **Given** Redis is unreachable, **When** the heartbeat fires, **Then** a failure notification is sent via direct HTTP (bypass queue)

---

### User Story 5 — Job Status Without GitHub API (Priority: P1)

The `/api/jobs/status` endpoint queries BullMQ and Postgres directly instead of the GitHub API, eliminating rate limits and providing real-time status.

**Why this priority**: Current job status is slow (GitHub API) and rate-limited. Direct query is instant.

**Independent Test**: Create 5 jobs → query `/api/jobs/status` → verify all 5 appear with correct states (queued, active, completed, failed).

**Acceptance Scenarios**:

1. **Given** jobs are in various states in BullMQ, **When** `/api/jobs/status` is called, **Then** all jobs are returned with correct states and metadata
2. **Given** a job transitions from queued → active → completed, **When** status is polled, **Then** transitions are reflected within 1 second
3. **Given** 100 jobs exist, **When** status is queried, **Then** response time is <100ms (no GitHub API round-trip)

---

### User Story 6 — Secrets Management Per Tenant (Priority: P2)

Secrets are stored in Postgres (existing `settings` table) with tenant scoping. The worker injects secrets into the container environment at spawn time, replicating the current `AGENT_*` / `AGENT_LLM_*` prefix system.

**Why this priority**: Required for multi-tenant but not for single-tenant Phase 0.

**Independent Test**: Store tenant-specific API keys → create a job for that tenant → verify correct secrets injected → verify other tenants' secrets are not accessible.

**Acceptance Scenarios**:

1. **Given** secrets are stored in Postgres with tenant scope, **When** a worker spawns a container for tenant A, **Then** only tenant A's secrets are injected
2. **Given** the `AGENT_*` prefix convention, **When** secrets are injected, **Then** `AGENT_` prefix is stripped (same as current GitHub behavior)
3. **Given** `AGENT_LLM_*` secrets, **When** injected, **Then** they go into `LLM_SECRETS` (visible to LLM, not filtered by env-sanitizer)

---

### User Story 7 — CD / Rebuild on Push (Priority: P2)

When code is pushed to `main`, the event handler detects the change and self-restarts — replacing the `rebuild-event-handler.yml` workflow. Package version changes trigger image pulls and container restarts.

**Why this priority**: Needed for production but manual deploys work fine in Phase 0.

**Independent Test**: Push to main → verify event handler detects change → verify rebuild/restart → verify new code is live.

**Acceptance Scenarios**:

1. **Given** a push to `main` with code changes (not just logs), **When** the webhook fires, **Then** the event handler pulls, rebuilds, and restarts
2. **Given** a push to `main` with only `logs/` changes, **When** the webhook fires, **Then** no rebuild is triggered (skip optimization)
3. **Given** a 23wf package version change, **When** the rebuild runs, **Then** `23wf init` is executed and the container image is updated

---

### User Story 8 — Package Upgrade (Priority: P2)

Upgrading the 23wf package is triggered via CLI command or web UI button instead of the `upgrade-event-handler.yml` workflow_dispatch.

**Why this priority**: Convenience feature, not critical path.

**Acceptance Scenarios**:

1. **Given** a new 23wf version is available, **When** the user triggers upgrade, **Then** `npm update 23wf` runs, init scaffolds new templates, and the event handler restarts

---

### Edge Cases

- What happens when Redis goes down mid-job? Worker should detect and retry or fail gracefully with notification.
- What happens when Ollama is unreachable? All LLM requests should fall back to cloud API.
- What happens when a worker crashes mid-execution? BullMQ's stalled job detection should re-queue or fail the job.
- What happens when the Mac Mini loses power? Cloud fallback for LLM + BullMQ persistence in Redis (AOF) preserves queue state.
- What happens when a job's Docker container runs out of memory? Worker catches OOM exit code, sends failure notification, respects per-tenant resource limits.

---

## Requirements

### Functional Requirements

- **FR-001**: System MUST enqueue jobs to BullMQ instead of creating `job/*` GitHub branches
- **FR-002**: System MUST spawn Docker containers from BullMQ worker process with identical env var injection (SECRETS, LLM_SECRETS, LLM_MODEL, LLM_PROVIDER, REPO_URL, BRANCH, OPENAI_BASE_URL, AGENT_BACKEND)
- **FR-003**: System MUST auto-merge PRs via `gh pr merge` with ALLOWED_PATHS validation (same logic as current `auto-merge.yml`)
- **FR-004**: System MUST send job completion notifications directly to event handler API (replacing `notify-pr-complete.yml`)
- **FR-005**: System MUST send job failure notifications with error details (replacing `notify-job-failed.yml`)
- **FR-006**: System MUST route planning/summary/chat LLM calls to Ollama with cloud fallback
- **FR-007**: System MUST support heartbeat cron dispatch to BullMQ with local LLM execution
- **FR-008**: System MUST provide real-time job status via BullMQ query (replacing GitHub API calls)
- **FR-009**: System MUST inject per-tenant secrets from Postgres into container env at spawn time
- **FR-010**: System MUST detect pushes to `main` and self-rebuild (replacing `rebuild-event-handler.yml`)
- **FR-011**: System MUST support package upgrades via CLI/UI (replacing `upgrade-event-handler.yml`)
- **FR-012**: System MUST read `job.config.json` for per-job LLM provider/model overrides
- **FR-013**: System MUST support both `pi` and `claude-code` agent backends (AGENT_BACKEND env var)
- **FR-014**: System MUST select Docker image based on agent backend and 23wf version (same logic as `run-job.yml`)
- **FR-015**: System MUST install skill npm deps inside container before agent execution
- **FR-016**: System MUST start Chrome for automate-browser skill if Puppeteer is installed
- **FR-017**: System MUST capture log commit SHA, remove logs from PR branch, and include log permalink in PR body
- **FR-018**: System MUST support `RUNS_ON` equivalent — K8s nodeSelector/affinity for worker placement (Phase 2)

#### Stripe-Inspired Agentic Performance Requirements

*Source: Stripe Minions playbook — Blueprints, CI iteration loops, context engineering, Toolshed, constrained autonomy patterns.*

- **FR-019**: Worker MUST execute jobs as a deterministic-agentic state machine (Blueprint pattern) with discrete, monitorable steps — each step independently timed, logged, and retryable
- **FR-020**: Worker MUST validate agent output before creating PR — lint check on changed files + anomaly detection (empty commits, file size anomalies, only-log changes)
- **FR-021**: Worker MUST support max 2 iteration rounds for agent self-correction — if validation fails, agent gets lint errors as context and retries once; second failure escalates with `[needs-review]` label
- **FR-022**: Worker MUST assemble task-scoped system prompts based on job type and target directories — heartbeat loads only HEARTBEAT.md, coding tasks load JOB_AGENT.md + relevant skill docs, not all context unconditionally
- **FR-023**: System MUST maintain a capability registry (skills, MCP servers, agent templates, team templates) in Postgres — Phase 0: all capabilities available (single-tenant), Phase 2: per-tenant entitlements. Foundational for marketplace and multi-tenant capability management
- **FR-024**: Worker MUST enforce configurable per-job resource limits — max execution time (default: 30 min), max LLM tokens (default: 100K), max retries (default: 2), max container memory (per tenant tier)
- **FR-025**: Worker MUST escalate to notification on resource limit breach — kill container, send failure notification with "exceeded [limit]" reason, do not retry silently
- **FR-026**: Worker MUST only inject capabilities the tenant is entitled to when assembling a job — not the full platform catalog (Phase 2; Phase 0: all capabilities injected for single tenant)

### Key Entities

- **Job**: Task to be executed — contains prompt, config overrides, tenant ID, status
- **Worker**: Process that pulls from BullMQ and spawns agent containers
- **Tenant**: Scoped entity with own secrets, resource quotas, and job queues (Phase 2 — Phase 0 is single-tenant, all capabilities available)
- **LLM Route**: Decision of which model (local vs cloud) handles a given request
- **Capability**: A registered skill, MCP server, agent template, or team template in the catalog
- **Entitlement**: A tenant's access to a specific capability (Phase 2 — Phase 0 has no scoping, all capabilities are available to the single tenant)
- **Usage Record**: Per-invocation metering for billing (Phase 2+)

---

## GitHub Features → New Infrastructure Migration Map

Every feature currently provided by GitHub Actions must have a direct equivalent. 18 features identified from workflow analysis:

| # | GitHub Feature | Current Implementation | New Implementation | Phase |
|---|---|---|---|---|
| 1 | **Job dispatch** | `job/*` branch creation triggers `run-job.yml` | BullMQ + Redis queue, `createJob()` enqueues directly | 0 |
| 2 | **Agent execution** | `run-job.yml` spins up Docker container on GH runner | Worker pulls from BullMQ, spawns Docker container locally or K8s Job | 0 |
| 3 | **Secrets injection** | `toJson(secrets)` collects `AGENT_*`/`AGENT_LLM_*`, passes as env vars | Worker reads from Postgres `settings` table, builds SECRETS/LLM_SECRETS JSON, injects into container env | 0 |
| 4 | **LLM config overrides** | `vars.LLM_PROVIDER`, `vars.LLM_MODEL`, per-job `job.config.json` | Same `job.config.json` in BullMQ payload. Worker reads and passes to container | 0 |
| 5 | **Agent backend selection** | `AGENT_BACKEND` var selects Pi vs Claude Code image | Same logic in worker — select image based on `agent_backend` field in job config | 0 |
| 6 | **Image version resolution** | `package-lock.json` → 23wf version → Docker Hub tag | Same logic in worker — read version, construct image tag | 0 |
| 7 | **GHCR login** | `docker/login-action` when `JOB_IMAGE_URL` starts with `ghcr.io/` | Worker handles registry auth if needed. Default: Docker Hub (no auth) or GCP Artifact Registry | 0 |
| 8 | **Auto-merge** | `auto-merge.yml` — waits for mergeable, checks `AUTO_MERGE`, validates `ALLOWED_PATHS`, squash-merges | Worker calls `gh pr merge` after same validation logic. No workflow needed | 0 |
| 9 | **Job completion notification** | `notify-pr-complete.yml` gathers PR metadata, POSTs to event handler webhook | Worker gathers same metadata (job_id, status, changed_files, commit_sha, etc.), calls notification API directly | 0 |
| 10 | **Job failure notification** | `notify-job-failed.yml` POSTs on workflow failure | Worker catches container exit code, builds same payload, calls notification API | 0 |
| 11 | **Heartbeat** | Cron in `CRONS.json` → creates agent job (disabled due to cost) | Cron dispatches to BullMQ. Lightweight checks use Ollama (free). Complex analysis escalates to Claude | 0 |
| 12 | **Git identity in containers** | `gh auth setup-git` + `gh api user` in entrypoint | Same — containers still use GH_TOKEN. No change to entrypoint scripts | 0 |
| 13 | **PR creation** | `gh pr create` in container entrypoint | Same — agent containers still create PRs via gh CLI. No change needed | 0 |
| 14 | **Log commit SHA + permalink** | Entrypoint captures SHA, removes logs, includes log URL in PR body | Same — entrypoint logic unchanged. Worker may additionally store SHA in Postgres | 0 |
| 15 | **Skill npm deps installation** | Entrypoint loops through `skills/active/*/package.json` and runs `npm install` | Same — entrypoint logic unchanged | 0 |
| 16 | **Chrome for browser skill** | Entrypoint finds Puppeteer Chrome binary, starts headless | Same — entrypoint logic unchanged | 0 |
| 17 | **CD / rebuild on push** | `rebuild-event-handler.yml` — self-hosted runner does git pull + rebuild | Webhook on `main` push → event handler self-restarts (PM2 reload or container restart) | 0.5 |
| 18 | **Package upgrade** | `upgrade-event-handler.yml` — manual workflow_dispatch creates upgrade PR | CLI command or web UI button runs `npm update 23wf` + restart | 0.5 |
| 19 | **Runner selection** | `vars.RUNS_ON` (ubuntu-latest or self-hosted) | K8s nodeSelector/affinity for worker pod placement | 2 |
| 20 | **Concurrency control** | GitHub's 20 parallel jobs limit | BullMQ concurrency per queue. Default: 2 concurrent containers (16GB RAM constraint — ~4GB available after OS + Ollama + Redis + event handler). Per-tenant limits in Phase 2 | 0 |
| 21 | **Auto-merge kill switch** | `vars.AUTO_MERGE = "false"` | Config flag in `settings` table or env var | 0 |
| 22 | **Allowed paths whitelist** | `vars.ALLOWED_PATHS` — comma-separated prefixes | Same config, read by worker instead of workflow | 0 |

**What stays on GitHub (not migrated):**
- Git repository for code storage
- Pull requests as job output artifacts
- Git commit history as audit trail
- `GH_TOKEN` for container git operations (clone, push, PR)
- GitHub as source of truth for code

---

## LLM Routing Architecture

### SOC 2-Clean Model Stack

All models from US or EU companies. No Chinese-origin models (eliminates Qwen despite 15% quality advantage — SOC 2 enterprise audit narrative must be clean).

| Touchpoint | Model | Origin | License | Where It Runs |
|------------|-------|--------|---------|---------------|
| Job Planning | Phi-4 14B | Microsoft (US) | MIT | Mac Mini (Ollama) |
| Job Summary | Phi-4 14B | Microsoft (US) | MIT | Mac Mini (Ollama) |
| Chat UI | Phi-4 14B | Microsoft (US) | MIT | Mac Mini (Ollama) |
| Agent Execution | Claude Sonnet | Anthropic (US) | Commercial API | Cloud API |

**16GB RAM constraint:** Mistral Small 24B (Q5_K_M, ~17GB) does not fit alongside OS + Docker + Redis + event handler on 16GB RAM. Phi-4 14B (Q4_K_M, ~9GB) handles all local tasks. If hardware is upgraded to 24GB+ in the future, Mistral Small 24B can be added for planning while Phi-4 handles summaries.

**Audit narrative:** *"Our AI stack uses Anthropic (US) for complex reasoning and Microsoft Phi-4 (US, MIT-licensed) for lightweight inference. Lightweight models run on-premise with no external network access. All vendors are domiciled in jurisdictions with adequate data protection frameworks."*

### Routing Logic

```
Request comes in
    │
    ├── Is this agent execution (coding/reasoning)?
    │     └── YES → Claude Sonnet (cloud API)
    │
    └── Is this planning, chat, or summary?
          └── YES → Try Ollama (Phi-4 14B) → fallback: Claude Sonnet
```

### Mac Mini Setup

| Component | Details |
|-----------|---------|
| Hardware | Mac Mini M4 base 16GB RAM (~$600 one-time) |
| Software | Ollama (one-line install) |
| Models | Phi-4 14B (Q4_K_M, ~9GB unified memory) — fits within 16GB alongside OS, Docker, Redis, event handler. Mistral Small 24B does NOT fit on 16GB (requires ~17GB for Q5_K_M alone) |
| Connectivity | Tailscale (WireGuard tunnel to cloud/event handler) |
| Performance | ~35 tok/s (Phi-4) — sufficient for planning/summary tasks |
| Network | Outbound blocked except Tailscale (belt-and-suspenders security) |
| Fallback | If unreachable, all requests route to cloud API |
| **RAM budget** | ~3GB OS + ~2GB Docker/Redis/Next.js + ~9GB Phi-4 + ~2GB headroom = 16GB |

### Cost Per Run (Hybrid LLM)

| Touchpoint | Model | Cost Per Run |
|------------|-------|-------------|
| Job Planning | Phi-4 14B (local) | ~$0.00 |
| Agent Execution | Claude Sonnet (cloud) | ~$0.15 |
| Job Summary | Phi-4 14B (local) | ~$0.00 |
| Chat UI | Phi-4 14B (local) | ~$0.00 |
| **Total** | | **~$0.15/run** |

vs. all-cloud: ~$0.26/run — **42% savings on LLM costs**

---

## Cost Estimates

### Phase 0: Mac Mini Local (20-50 tasks/month)

| Component | Monthly Cost |
|-----------|-------------|
| Mac Mini M4 base 16GB (hardware) | $0 (after ~$600 purchase, break-even ~2 months vs cloud GPU) |
| Electricity (~10W idle, ~30W active) | ~$2.60 |
| Redis (local, included in event handler) | $0 |
| **Infra subtotal** | **~$2.60/mo** |
| LLM: 20 tasks × $0.15 (Claude Sonnet) | $3.00 |
| LLM: 50 tasks × $0.15 (Claude Sonnet) | $7.50 |
| **Total (20 tasks/mo)** | **~$5.60/mo** |
| **Total (50 tasks/mo)** | **~$10.10/mo** |
| **Total (0 tasks/mo — idle)** | **~$2.60/mo** |

### Phase 1: Cloud Run Jobs (20-50 tasks/month) — *Estimates, validate against current GCP pricing before Phase 1 commit*

| Component | Monthly Cost |
|-----------|-------------|
| Cloud Run (event handler, scale-to-zero) | ~$0 idle, ~$5 active |
| Memorystore Redis (1GB) | $35 |
| Cloud SQL Postgres (db-f1-micro) | $10 |
| Cloud Run Jobs (agent containers) | ~$0.01/run |
| Tailscale (Mac Mini link) | $0 (free tier) |
| **Infra subtotal** | **~$45-50/mo** |
| **Total (20 tasks/mo)** | **~$48 + $3 LLM = ~$51/mo** |
| **Total (50 tasks/mo)** | **~$50 + $7.50 LLM = ~$57.50/mo** |
| **Total (0 tasks/mo — idle)** | **~$45/mo** |

### Phase 2: GKE Autopilot (multi-tenant, 100+ tenants) — *Estimates, validate against current GCP pricing before Phase 2 commit*

| Component | Monthly Cost |
|-----------|-------------|
| GKE Autopilot control plane | $74 |
| Compute (spot instances, bin-packed) | ~$150-5,000 (scales with tenants) |
| Memorystore Redis (5-25GB, HA) | $175-600 |
| Cloud SQL Postgres (HA) | $140-800 |
| Networking/LB | $50-200 |
| Monitoring | $50-300 |
| **Total (10 tenants, ~100 jobs/day)** | **~$320/mo + LLM** |
| **Total (50 tenants, ~1000 jobs/day)** | **~$1,380/mo + LLM** |
| **Total (500 tenants, ~10000 jobs/day)** | **~$7,000/mo + LLM** |

### Per-Run Cost at Scale

| Scale | Infra/Run | LLM/Run | Total/Run |
|-------|-----------|---------|-----------|
| Phase 0 (local) | ~$0.00 | $0.15 | $0.15 |
| Phase 1 (Cloud Run) | ~$0.01 | $0.15 | $0.16 |
| Phase 2 (100 jobs/day) | $0.11 | $0.15 | $0.26 |
| Phase 2 (1000 jobs/day) | $0.05 | $0.15 | $0.20 |
| Phase 2 (10000 jobs/day) | $0.02 | $0.15 | $0.17 |

---

## Technical Design

### Architecture (Phase 0 — Mac Mini)

```
┌─────────────────────────────────────────────────────────────┐
│  Mac Mini M4 base (16GB RAM)                                 │
│                                                              │
│  ┌─────────────────────────────────────┐                    │
│  │  Event Handler (Next.js)            │                    │
│  │  ├── Web UI, Chat, Cron Scheduler   │                    │
│  │  ├── Trigger Runtime                │                    │
│  │  ├── BullMQ Producer (enqueue jobs) │                    │
│  │  └── LLM Router (Ollama / Claude)   │                    │
│  └──────────────┬──────────────────────┘                    │
│                 │                                            │
│  ┌──────────────▼──────────────────────┐                    │
│  │  Redis (BullMQ backend)             │                    │
│  └──────────────┬──────────────────────┘                    │
│                 │                                            │
│  ┌──────────────▼──────────────────────┐                    │
│  │  Worker Process                      │                    │
│  │  ├── Pulls jobs from BullMQ          │                    │
│  │  ├── Spawns Docker containers        │                    │
│  │  ├── Monitors container exit         │                    │
│  │  ├── Runs auto-merge validation      │                    │
│  │  └── Sends notifications             │                    │
│  └──────────────┬──────────────────────┘                    │
│                 │ docker run                                 │
│                 ▼                                            │
│  ┌──────────────────────┐  ┌──────────────────────┐        │
│  │  Agent Container A   │  │  Agent Container B   │        │
│  │  (Pi or Claude Code) │  │  (Pi or Claude Code) │        │
│  │  → clone, run, PR    │  │  → clone, run, PR    │        │
│  └──────────────────────┘  └──────────────────────┘        │
│                                                              │
│  ┌─────────────────────────────────────┐                    │
│  │  Ollama                              │                    │
│  │  └── Phi-4 14B (planning/chat/sum)   │                    │
│  └─────────────────────────────────────┘                    │
│                                                              │
│  Tailscale (WireGuard) ← secure tunnel if cloud needed     │
└─────────────────────────────────────────────────────────────┘
```

### Architecture (Phase 2 — GKE Multi-Tenant)

```
┌─────────────────────────────────────────────────────────────────┐
│  GKE Cluster (Google Cloud)                                      │
│                                                                  │
│  ┌──────────────────────────────────────────┐                   │
│  │  Event Handler (Next.js pod)             │                   │
│  │  ├── BullMQ Producer                     │                   │
│  │  └── LLM Router                          │                   │
│  └──────────────┬───────────────────────────┘                   │
│                 │                                                 │
│  ┌──────────────▼───────────────────────────┐                   │
│  │  Memorystore Redis (HA, clustered)       │                   │
│  │  └── Per-tenant queues with rate limits  │                   │
│  └──────────────┬───────────────────────────┘                   │
│                 │                                                 │
│  ┌──────────────▼───────────────────────────┐                   │
│  │  Worker Pods (K8s Deployment)            │                   │
│  │  └── Pull from BullMQ, spawn K8s Jobs   │                   │
│  └──────────────┬───────────────────────────┘                   │
│                 │                                                 │
│  ├── namespace: tenant-abc  (quota: 4 CPU, 8GB)                 │
│  │     └── K8s Job (agent container)                            │
│  │                                                               │
│  ├── namespace: tenant-xyz  (quota: 8 CPU, 16GB) ← paid tier   │
│  │     └── K8s Job (agent container)                            │
│  │     └── K8s Job (concurrent)                                 │
│  │                                                               │
│  └── namespace: tenant-free (quota: 1 CPU, 2GB)                 │
│        └── K8s Job (queued, lower priority)                     │
│                                                                  │
│  ┌──────────────────────────────────────────┐                   │
│  │  Cloud SQL Postgres (HA + read replica)  │                   │
│  └──────────────────────────────────────────┘                   │
│                                                                  │
│  ┌──────────────────────────────────────────┐                   │
│  │  Mac Mini M4 (via Tailscale)              │                   │
│  │  └── Ollama (Phi-4 14B)                  │                   │
│  └──────────────────────────────────────────┘                   │
└─────────────────────────────────────────────────────────────────┘
```

### Worker Process Design — Blueprint Execution Pattern

The worker is the core new component. It replaces all 6 GitHub Actions workflows and executes jobs as a **deterministic-agentic state machine** (inspired by Stripe's Blueprint pattern). Each step is independently monitorable, timed, and retryable.

**Deployment:** The worker runs as a **separate long-running process** managed by PM2 on the Mac Mini, independent of the event handler (Next.js). This provides crash isolation — if the worker dies, the event handler continues serving the web UI, and PM2 auto-restarts the worker. In Phase 1+, the worker becomes a separate container/pod.

```
Worker Execution Blueprint (State Machine)
═══════════════════════════════════════════

Step 1 [DETERMINISTIC] ─── Resolve & Prepare
  ├── Query capability registry for tenant entitlements
  ├── Select image (agent backend + version)
  ├── Build env vars (SECRETS, LLM_SECRETS, config overrides)
  ├── Assemble task-scoped system prompt (not global)
  │     └── Base: SOUL.md
  │     └── + Job type context (JOB_AGENT.md / HEARTBEAT.md / relevant SKILL.md)
  │     └── + Only entitled capability descriptions
  └── Set resource limits (time, tokens, memory from tenant tier)

Step 2 [DETERMINISTIC] ─── Spawn Container
  ├── docker run with env vars, resource limits
  └── Start timeout watchdog (default: 30 min)

Step 3 [AGENTIC] ──────── Agent Execution
  ├── LLM agent runs task (Pi or Claude Code)
  ├── Clone repo, implement, commit, push, create PR
  └── (This is the existing entrypoint — unchanged)

Step 4 [DETERMINISTIC] ─── Validate Output
  ├── Check container exit code
  ├── Run lint/format check on changed files
  ├── Anomaly detection: empty commits, file size spikes, only-log changes
  └── Result: PASS / FAIL with error details

Step 5 [AGENTIC] ──────── Retry (if validation failed, max 1 retry)
  ├── Feed lint errors + anomaly details back to agent as context
  ├── Agent gets one more attempt to fix
  └── Re-run Step 4 validation
      └── If still fails → mark PR with [needs-review] label

Step 6 [DETERMINISTIC] ─── Auto-Merge
  ├── Check AUTO_MERGE setting
  ├── Validate changed files against ALLOWED_PATHS
  ├── If all pass → gh pr merge --squash --delete-branch
  └── If blocked → leave PR open for human review

Step 7 [DETERMINISTIC] ─── Notify + Meter
  ├── Build notification payload (job_id, status, changed_files, commit_sha, PR URL)
  ├── Send to event handler notification API
  ├── Record capability usage for billing (tenant_id, capabilities_used, tokens_consumed)
  └── Clean up (remove container, update job status in BullMQ)
```

```javascript
// worker.js — pseudocode
import { Worker } from 'bullmq';

const worker = new Worker('agent-jobs', async (job) => {
  const { jobId, prompt, config, tenantId, secrets } = job.data;
  const emit = (step, status) => job.updateProgress({ step, status, ts: Date.now() });

  // Step 1: Resolve & Prepare [DETERMINISTIC]
  emit('prepare', 'started');
  const entitlements = await getEntitlements(tenantId);
  const image = resolveImage(config.agent_backend, config.wf_version, config.job_image_url);
  const systemPrompt = assembleScopedPrompt(config.job_type, entitlements);
  const env = buildContainerEnv(secrets, config, systemPrompt);
  const limits = getTenantLimits(tenantId, config);
  emit('prepare', 'done');

  // Step 2: Spawn Container [DETERMINISTIC]
  emit('spawn', 'started');
  const container = await spawnContainer(image, env, limits);
  const timeout = setTimeout(() => killContainer(container, 'timeout'), limits.maxTime);
  emit('spawn', 'done');

  // Step 3: Agent Execution [AGENTIC]
  emit('execute', 'started');
  let exitCode = await waitForExit(container);
  clearTimeout(timeout);
  emit('execute', exitCode === 0 ? 'done' : 'failed');

  // Step 4: Validate Output [DETERMINISTIC]
  let pr = null;
  if (exitCode === 0) {
    emit('validate', 'started');
    pr = await findPR(jobId);
    const validation = await validateOutput(pr); // lint + anomaly check
    emit('validate', validation.passed ? 'done' : 'failed');

    // Step 5: Retry if validation failed [AGENTIC] (max 1 retry)
    if (!validation.passed && config.retries_remaining > 0) {
      emit('retry', 'started');
      exitCode = await retryWithContext(container, image, env, validation.errors);
      const revalidation = await validateOutput(pr);
      if (!revalidation.passed) {
        await labelPR(pr, 'needs-review');
      }
      emit('retry', revalidation.passed ? 'done' : 'escalated');
    }
  }

  // Step 6: Auto-Merge [DETERMINISTIC]
  if (exitCode === 0 && pr) {
    emit('merge', 'started');
    if (shouldAutoMerge(pr, config.allowed_paths, config.auto_merge)) {
      await mergePR(pr);
      emit('merge', 'done');
    } else {
      emit('merge', 'skipped');
    }
  }

  // Step 7: Notify + Meter [DETERMINISTIC]
  emit('notify', 'started');
  await sendNotification(jobId, exitCode, pr);
  await meterUsage(tenantId, jobId, entitlements.used);
  emit('notify', 'done');

}, { connection: redis, concurrency: config.max_concurrent || 2 }); // Default 2 on 16GB Mac Mini
```

### LLM Router Design

```javascript
// llm-router.js — pseudocode
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const CLOUD_FALLBACK = true;

async function routeLLM(request) {
  const { type, messages, model_override } = request;

  // Agent execution always goes to cloud
  if (type === 'agent_execution') {
    return callClaude(messages, model_override || 'claude-sonnet-4-6');
  }

  // Planning, chat, and summary → Ollama (Phi-4 14B)
  // 16GB RAM constraint: single local model only
  const localModel = 'phi4:14b';

  try {
    return await callOllama(OLLAMA_URL, localModel, messages);
  } catch (err) {
    if (CLOUD_FALLBACK) {
      console.warn(`Ollama unreachable, falling back to cloud: ${err.message}`);
      return callClaude(messages, 'claude-sonnet-4-6');
    }
    throw err;
  }
}
```

---

## Success Criteria

### Phase 0 Metrics
- [ ] Jobs dispatch via BullMQ (no GitHub branch creation)
- [ ] Agent containers spawn and execute identically to current behavior
- [ ] Auto-merge works for PRs within ALLOWED_PATHS
- [ ] Job completion and failure notifications delivered
- [ ] Heartbeat runs on local Ollama (zero LLM cost)
- [ ] Job status API returns real-time state from BullMQ
- [ ] Ollama (Phi-4 14B) serves planning/summary/chat requests at >15 tok/s
- [ ] Cloud fallback works when Ollama is unreachable
- [ ] All 22 GitHub features have working equivalents
- [ ] Monthly idle cost < $5
- [ ] Worker executes as 7-step Blueprint state machine with per-step status events
- [ ] Lint validation runs on agent output before PR creation
- [ ] Agent self-corrects on validation failure (1 retry), escalates with `[needs-review]` label on 2nd failure
- [ ] Task-scoped system prompts: heartbeat jobs load only HEARTBEAT.md, coding jobs load JOB_AGENT.md + relevant skills
- [ ] Capability registry table exists in Postgres with at least all current skills registered
- [ ] Per-job resource limits enforced (time, tokens, retries) with kill + notification on breach
- [ ] Worker injects only tenant-entitled capabilities (not full catalog) into agent system prompt

### Phase 1 Metrics
- [ ] Event handler runs on Cloud Run with scale-to-zero
- [ ] Agent containers run as Cloud Run Jobs
- [ ] Postgres replaces SQLite for job tracking
- [ ] CD pipeline rebuilds on push to main
- [ ] Monthly idle cost < $50

### Phase 2 Metrics
- [ ] Per-tenant namespace isolation verified
- [ ] Resource quotas enforced per tenant tier
- [ ] 50+ concurrent jobs execute without degradation
- [ ] Per-run cost < $0.20 at 1000 jobs/day
- [ ] SOC 2 audit passes with clean model provenance narrative

---

## Risks & Mitigation

### Risk 1: BullMQ/Redis Reliability
**Impact:** High — lost jobs if Redis crashes
**Probability:** Low — Redis with AOF persistence is battle-tested
**Mitigation:** Enable Redis AOF persistence. BullMQ has built-in stalled job detection and retry. Add Redis health check to heartbeat.

### Risk 2: Mac Mini Single Point of Failure (LLM)
**Impact:** Medium — planning/chat degrades to cloud (higher cost, still functional)
**Probability:** Low-Medium — hardware failure or power loss
**Mitigation:** Cloud fallback is automatic. For production, run 2 Mac Minis behind load balancer (~$1,200 total). Or accept cloud cost during outage.

### Risk 3: Docker Socket Security on Mac Mini
**Impact:** High — container escape could access host
**Probability:** Low — agent containers are short-lived and don't run untrusted code
**Mitigation:** Run containers with `--network=none` where possible. Use rootless Docker. Phase 2 moves to K8s with proper pod security policies.

### Risk 4: Ollama Model Quality Gap
**Impact:** Medium — Phi-4 14B is ~60-65% of Claude Sonnet quality for planning tasks
**Probability:** Medium — noticeable for complex planning tasks
**Mitigation:** Planning and chat are lower-stakes than agent execution. Pure model-based routing (no quality threshold) — always use local for planning/chat/summary. Use few-shot prompting (2-3 examples) in system prompt to close gap. Monitor quality and escalate to Claude manually if patterns emerge. If hardware is upgraded to 24GB+, Mistral Small 24B can replace Phi-4 for planning.

### Risk 5: Tailscale Tunnel Latency
**Impact:** Low — adds ~5-20ms to Ollama requests
**Probability:** Low — Tailscale is stable and well-tested
**Mitigation:** For Phase 0 (all local), no tunnel needed. For Phase 1+, 20ms is negligible on 2-5 second planning requests.

### Risk 6: Entrypoint Script Compatibility
**Impact:** Medium — container entrypoints assume GitHub Actions environment
**Probability:** Low — entrypoints only need REPO_URL, BRANCH, SECRETS, LLM_SECRETS env vars
**Mitigation:** Worker injects identical env vars. Entrypoint scripts are unchanged. Test with current entrypoints before any modifications.

---

## Cutover & Rollback Strategy

A `JOB_DISPATCH` environment variable controls which dispatch path `createJob()` uses:

| Value | Behavior |
|-------|----------|
| `github` (default) | Current behavior — push `job/*` branch to trigger GitHub Actions |
| `bullmq` | New behavior — enqueue job to BullMQ for worker processing |

**Cutover plan:**
1. Deploy BullMQ worker alongside existing GitHub Actions (both systems operational)
2. Set `JOB_DISPATCH=bullmq` on staging, test full job lifecycle
3. Once verified, set `JOB_DISPATCH=bullmq` on production
4. After 2 weeks stable, remove GitHub Actions workflows (keep as archive)

**Rollback:** Set `JOB_DISPATCH=github` to immediately revert to GitHub Actions. No code changes needed. GitHub Actions workflows remain intact until explicitly removed.

---

## Implementation Plan

### Phase 0: Local BullMQ + Worker (24 hours)

**Deliverables:**
- [ ] Postgres running locally (Docker) — replaces SQLite for capability registry, job tracking, secrets
- [ ] `JOB_DISPATCH` env var feature flag (`github` | `bullmq`) for incremental cutover and rollback
- [ ] BullMQ producer in event handler (replaces `createJob` GitHub branch push when `JOB_DISPATCH=bullmq`)
- [ ] Redis running locally (Docker or Homebrew)
- [ ] Blueprint worker process (separate PM2 process) — 7-step state machine that pulls jobs and spawns Docker containers
- [ ] Output validation step — lint check + anomaly detection before PR creation
- [ ] Retry loop — agent gets lint errors as context, max 1 retry, escalation on 2nd failure
- [ ] Auto-merge logic in worker (port from `auto-merge.yml`)
- [ ] Notification + metering logic in worker (port from `notify-pr-complete.yml` + `notify-job-failed.yml`)
- [ ] Task-scoped system prompt assembly — job-type-aware context loading
- [ ] Capability registry in Postgres — skills, MCP servers, agent/team templates with tenant entitlements
- [ ] Per-job resource limits — time, tokens, retries, memory (configurable per tenant tier)
- [ ] Ollama running with Phi-4 14B (single model — 16GB RAM constraint)
- [ ] LLM router with Ollama-first + cloud fallback
- [ ] All 22 GitHub features verified working

**Tasks:**
1. Install Postgres locally (Docker: `postgres:16-alpine`) — migrate from SQLite
2. Install Redis locally (Docker: `redis:7-alpine` with AOF persistence)
3. Add `bullmq` dependency to event handler
4. Implement `JOB_DISPATCH` env var feature flag — `createJob()` checks flag to route to GitHub or BullMQ
5. Create BullMQ producer — modify `createJob()` to enqueue when `JOB_DISPATCH=bullmq`
6. Create Blueprint worker process (`worker.js`, separate PM2 process) — implement 7-step state machine with per-step progress events
7. Implement container spawning in worker (same env vars as `run-job.yml`) with timeout watchdog, default concurrency: 2
8. Implement output validation step — run lint/format on changed files, detect anomalies (empty commits, file size spikes)
9. Implement retry loop — feed validation errors back to agent, re-validate, label `[needs-review]` on 2nd failure
10. Implement task-scoped system prompt assembly — map job types to config files (HEARTBEAT.md, JOB_AGENT.md, skill docs)
11. Create `capabilities` table in Postgres (capability registry — no tenant scoping in Phase 0)
12. Seed capability registry with current skills from `skills/active/`
13. Implement per-job resource limits — max time (30 min default), max tokens (100K default), max retries (2 default)
14. Port auto-merge logic from `auto-merge.yml` to worker (Step 6 of Blueprint)
15. Port notification payload assembly + capability usage metering (Step 7 of Blueprint)
16. Install Ollama on Mac Mini, pull Phi-4 14B (Q4_K_M quantization)
17. Create LLM router module with Ollama-first + Claude fallback
18. Integrate LLM router into event handler (planning, chat, summaries)
19. Update `/api/jobs/status` to query BullMQ instead of GitHub API
20. Test full job lifecycle: chat → enqueue → Blueprint worker → validate → auto-merge → notification
21. Test heartbeat with local Ollama (verify task-scoped prompt loads only HEARTBEAT.md)
22. Test validation failure → retry → escalation path
23. Test resource limit breach → kill + notification
24. Verify all 22 GitHub features work

### Phase 0.5: CD and Upgrade (8 hours)

**Deliverables:**
- [ ] Webhook-triggered rebuild on push to `main`
- [ ] CLI/UI package upgrade command
- [ ] ~~Structured job logs in Postgres~~ **Deferred** — add when SOC 2 audit prep begins

**Tasks:**
1. Add webhook handler for `main` push → PM2 reload
2. Implement version detection and `23wf init` on upgrade
3. Create upgrade CLI command / web UI button
4. ~~(Optional) Add job log records to Postgres~~ **Deferred** — git history + PR metadata is sufficient audit trail. Add Postgres `job_logs` table when SOC 2 audit prep begins

### Phase 1a: Cloud Run Jobs (16 hours)

**Deliverables:**
- [ ] Event handler on Cloud Run
- [ ] Agent containers as Cloud Run Jobs
- [ ] Memorystore Redis
- [ ] Cloud SQL Postgres
- [ ] Tailscale tunnel to Mac Mini for Ollama

**Tasks:**
1. Create GCP project and enable APIs
2. Deploy Redis (Memorystore, 1GB)
3. Deploy Postgres (Cloud SQL, db-f1-micro)
4. Containerize event handler for Cloud Run
5. Create Cloud Run Job template for agent containers
6. Modify worker to use Cloud Run Jobs API instead of Docker socket
7. Set up Tailscale on Mac Mini and Cloud Run service
8. Configure DNS and SSL
9. Test full lifecycle on cloud

### Phase 1b: GKE Autopilot (16 hours)

**Deliverables:**
- [ ] GKE Autopilot cluster
- [ ] Worker launches K8s Jobs instead of Cloud Run Jobs
- [ ] Per-tenant namespaces with resource quotas
- [ ] Network policies for tenant isolation
- [ ] Monitoring (Prometheus + Grafana or Cloud Monitoring)

**Tasks:**
1. Create GKE Autopilot cluster
2. Define K8s Job template for agent containers
3. Modify worker to use K8s Jobs API
4. Create namespace-per-tenant with ResourceQuota
5. Create NetworkPolicy for tenant isolation
6. Deploy monitoring stack
7. Configure KEDA for scale-to-zero workers
8. Load test with 50+ concurrent jobs

### Phase 2: Multi-Tenant Production (16 hours)

**Deliverables:**
- [ ] Tenant management API
- [ ] Per-tenant job queues with rate limits
- [ ] Per-tenant secrets isolation
- [ ] Billing-tier-based priority scheduling
- [ ] SOC 2 audit documentation

**Tasks:**
1. Create tenant model in Postgres
2. Implement per-tenant BullMQ queues
3. Implement per-tenant secrets scoping
4. Create K8s PriorityClass per tenant tier
5. Generate SOC 2 control documentation (using audit-compliance skill)
6. End-to-end multi-tenant testing

---

## Relationship to Spec 003

Spec 003 (AWS Cloud Deployment) targets ECS Fargate on AWS. This spec targets GKE on Google Cloud. The two are **alternative paths**, not sequential:

| | Spec 003 (AWS) | Spec 006 (GKE) |
|---|---|---|
| Cloud provider | AWS | Google Cloud |
| Container orchestration | ECS Fargate | GKE Autopilot |
| Job queue | None (GitHub Actions) | BullMQ + Redis |
| Multi-tenant | Not addressed | Core feature |
| Local LLM | Not addressed | Ollama on Mac Mini |
| SOC 2 model compliance | Not addressed | Western-only stack |

**Decision:** Self-hosted local (Spec 006 Phase 0) is the priority. Cloud deployment (Phase 1+) only after all capabilities are proven locally. Spec 003 (AWS) remains an alternative cloud path — the cloud provider decision (AWS vs GCP) is deferred until Phase 0 is complete and cloud migration is needed. Phase 0 is provider-agnostic and works with either cloud path.

---

## New Components Required

### Internal Worker Modules (code in worker process — not LLM-facing)

| Module | Description | Phase |
|--------|-------------|-------|
| `dispatch-job-bullmq` | Enqueue agent jobs to BullMQ instead of creating GitHub branches | 0 |
| `spawn-agent-container` | Pull from BullMQ, spawn Docker container with secrets injection | 0 |
| `auto-merge-pr` | Validate ALLOWED_PATHS and squash-merge via gh CLI | 0 |
| `notify-job-status` | Send completion/failure notifications to event handler | 0 |
| `route-llm` | Route between Ollama and cloud API based on task type | 0 |
| `manage-secrets` | Secrets from Postgres into container env | 0 |

### Agent Skills (LLM-invocable, live in `skills/`)

| Skill | Description | Phase |
|-------|-------------|-------|
| `assess-infra` | Assess gaps, map features, produce migration checklists | 0 |
| `generate-k8s-manifests` | K8s manifests, Docker Compose, cloud configs | 1b |
| `project-infra-costs` | Project costs at target volumes | 0 |

### Setup / Operations (one-time or manual scripts)

| Script | Description | Phase |
|--------|-------------|-------|
| `setup-ollama-models` | Pull and configure Ollama models with verification | 0 |
| `monitor-worker-health` | Check worker, Redis, container runtime, Ollama status (heartbeat integration) | 0 |

---

**Spec Author:** 23 Systems
**Created:** 2026-03-21
**Status:** Draft — Clarifications Resolved, Ready for `/speckit.plan`
**Reference Spec:** `references/reports/Infrastructure-Migration-Spec.html`
**Cluster Template:** `config/templates/infra-migration.json`
