# Tasks: Spec 006 — Infrastructure Migration (Phase 0)

**Input**: Design documents from `.specify/specs/006-infra-migration-k8s-*`
**Prerequisites**: spec (clarified), plan, research, data-model

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Get Postgres, Redis, and BullMQ running locally. Wire up the feature flag.

- [ ] T001 [P] Create `docker-compose.infra.yml` with `postgres:16-alpine` (port 5432, volume `pgdata`) + `redis:7-alpine` (AOF persistence, port 6379) at project root
- [ ] T002 [P] Create `ecosystem.config.js` (PM2 config) at project root with two processes: `event-handler` (Next.js, `npm run dev`) and `worker` (`node worker/index.js`), auto-restart enabled
- [ ] T003 [P] Create `worker/` directory structure: `index.js`, `blueprint.js`, `container.js`, `auto-merge.js`, `notify.js`, `validate.js`, `llm-router.js`
- [ ] T004 Add dependencies to `Clusters/package.json`: `bullmq`, `ioredis`, `pg` (or `postgres`), plus `@types/pg` if needed. Run `pnpm install`
- [ ] T005 Add env vars to `.env`: `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/23wf`, `REDIS_URL=redis://localhost:6379`, `OLLAMA_URL=http://localhost:11434`, `JOB_DISPATCH=github`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Database migration to Postgres, new tables, dispatcher adapter pattern. BLOCKS all user stories.

### Database Migration

- [ ] T006 Modify `Clusters/lib/db/schema.js` — change all `sqliteTable` imports to `pgTable` from `drizzle-orm/pg-core`. Update type imports (`integer` → `integer`/`bigint` for timestamps)
- [ ] T007 Modify `Clusters/lib/db/index.js` — replace `better-sqlite3` connection with `node-postgres` (`pg.Pool`) or `postgres` library. Read `DATABASE_URL` from env. Update `initDatabase()` to use Postgres migrate
- [ ] T008 Add `jobs` table to `Clusters/lib/db/schema.js` per data-model.md — columns: `id`, `title`, `prompt`, `status`, `branch`, `pr_url`, `pr_number`, `commit_sha`, `log_sha`, `exit_code`, `error`, `merge_result`, `changed_files`, `llm_provider`, `llm_model`, `agent_backend`, `started_at`, `completed_at`, `duration_ms`, `current_step`, `step_history`, `retry_count`, `validation_errors`, `bullmq_job_id`, `created_at`, `updated_at`
- [ ] T009 [P] Add `capabilities` table to `Clusters/lib/db/schema.js` — columns: `id`, `type`, `name`, `description`, `category`, `version`, `source_path`, `config`, `enabled`, `created_at`, `updated_at`
- [ ] T010 [P] Add `job_capabilities` table to `Clusters/lib/db/schema.js` — columns: `id`, `job_id` (FK), `capability_id` (FK), `tokens_used`, `created_at`
- [ ] T011 Run `drizzle-kit generate` to produce Postgres migration SQL. Verify migration files in `Clusters/drizzle/`
- [ ] T012 Create data migration script `scripts/migrate-sqlite-to-postgres.js` — export all SQLite tables as JSON, import into Postgres. One-time use
- [ ] T013 Run `docker compose -f docker-compose.infra.yml up -d` → run Drizzle migrations → run data migration script. Verify all existing data in Postgres

### Capability Registry Seeding

- [ ] T014 Create `Clusters/lib/db/capabilities.js` — `seedCapabilities()` function that scans `skills/active/*/SKILL.md` frontmatter and `config/templates/*.json`, upserts into `capabilities` table
- [ ] T015 Call `seedCapabilities()` from `Clusters/config/instrumentation.js` during server startup (after DB init)

### Dispatcher Adapter Pattern

- [ ] T016 Modify `Clusters/lib/tools/create-job.js` — extract GitHub branch push logic into `pushGitHubBranch()` function. Add `setJobDispatcher(dispatcher)` export. Default dispatcher calls `pushGitHubBranch()`
- [ ] T017 Create `Clusters/lib/tools/bullmq-dispatcher.js` — BullMQ dispatcher that: (1) still calls `pushGitHubBranch()` to create the branch, (2) enqueues job to BullMQ with `{ jobId, title, config, branch }`, (3) inserts row into `jobs` table with status `queued`
- [ ] T018 Modify `Clusters/config/instrumentation.js` — on startup, if `JOB_DISPATCH=bullmq`, import bullmq-dispatcher and call `setJobDispatcher(bullmqDispatcher)`. Also init Redis connection for BullMQ

**Checkpoint**: `JOB_DISPATCH=bullmq` enqueues a job to Redis AND creates the GitHub branch. Row appears in `jobs` table with status `queued`. `JOB_DISPATCH=github` works exactly as before.

---

## Phase 3: User Story 1 — Job Dispatch Without GitHub Actions (Priority: P0, MVP)

**Goal**: Worker picks up BullMQ jobs, spawns Docker containers, full lifecycle works.

**Independent Test**: Create a job via chat UI → verify it appears in BullMQ → verify worker spawns container → verify PR created → verify notification sent.

### Worker Core

- [ ] T019 Implement `worker/index.js` — connect to Redis via `ioredis`, create BullMQ `Worker` on `agent-jobs` queue with concurrency 2, import and call `runBlueprint()` for each job, handle graceful shutdown (SIGTERM)
- [ ] T020 Implement `worker/blueprint.js` — `runBlueprint(job)` function implementing the 7-step state machine. Each step: emit progress via `job.updateProgress()`, update `jobs` table status/step. Steps call out to separate modules (T021-T026)

### Step 1: Resolve & Prepare

- [ ] T021 In `worker/blueprint.js` Step 1 — read job data from `jobs` table, query `capabilities` table for all enabled capabilities (Phase 0: no tenant scoping), resolve Docker image (agent backend + version from `Clusters/package.json`), build env vars object (REPO_URL, BRANCH, SECRETS, LLM_SECRETS, LLM_MODEL, LLM_PROVIDER, OPENAI_BASE_URL, AGENT_BACKEND), set resource limits (max time from env or 30min default)

### Step 2: Spawn Container

- [ ] T022 Implement `worker/container.js` — `spawnContainer(image, env, limits)` function that runs `docker run --rm` with env vars and resource limits (`--memory`, timeout watchdog via `setTimeout`). Returns a promise that resolves with exit code. `killContainer(containerId, reason)` for timeout/cleanup

### Step 3: Agent Execution

- [ ] T023 In `worker/blueprint.js` Step 3 — call `spawnContainer()`, await exit code, update `jobs.exit_code`. On timeout: kill container, set status `failed`, set error `exceeded max_time`

### Step 4: Validate Output

- [ ] T024 Implement `worker/validate.js` — `validateOutput(jobId)` function: (1) find PR via `gh pr list --head job/{jobId}`, (2) get changed files via `gh pr diff`, (3) run `npx eslint` on changed JS files (if eslint config exists), (4) anomaly detection: empty commits (0 changed files), file size spikes (>1MB single file), (5) return `{ passed, errors[] }`

### Step 5: Retry

- [ ] T025 In `worker/blueprint.js` Step 5 — if validation failed and `retry_count < 1`: re-spawn container with validation errors appended to prompt as context, re-validate. If still fails: `gh pr edit --add-label needs-review`. Update `jobs.retry_count`

### Step 6: Auto-Merge

- [ ] T026 Implement `worker/auto-merge.js` — port logic from `.github/workflows/auto-merge.yml`: (1) read `AUTO_MERGE` from env/settings, (2) read `ALLOWED_PATHS` (default: `/logs`), (3) check each changed file against prefixes, (4) if all pass: `gh pr merge --squash --delete-branch`, (5) update `jobs.merge_result`

### Step 7: Notify + Meter

- [ ] T027 Implement `worker/notify.js` — build notification payload matching existing structure (`job_id`, `branch`, `status`, `job`, `pr_url`, `changed_files`, `commit_sha`, `merge_result`), call `createNotification()` from `Clusters/lib/db/notifications.js`, record capability usage in `job_capabilities` table

### Job Status API

- [ ] T028 Modify the `/api/jobs/status` handler in `Clusters/api/index.js` — when `JOB_DISPATCH=bullmq`, query `jobs` table + BullMQ queue state instead of GitHub API. Return same response shape for backwards compatibility

### Integration Test

- [ ] T029 End-to-end test: set `JOB_DISPATCH=bullmq`, create job via chat UI, verify: (1) job appears in `jobs` table with status `queued`, (2) worker picks up job (status → `active`), (3) container spawns with correct env vars, (4) PR created on GitHub, (5) auto-merge runs if within ALLOWED_PATHS, (6) notification created in DB, (7) job status API returns correct state

**Checkpoint**: Full job lifecycle works via BullMQ. Chat → enqueue → worker → container → PR → auto-merge → notification. `JOB_DISPATCH=github` still works as fallback.

---

## Phase 4: User Story 2 — Auto-Merge Without GitHub Actions (Priority: P0)

**Goal**: Verify auto-merge logic handles all edge cases identically to `auto-merge.yml`.

**Independent Test**: Agent creates PR with changes only in `logs/` → verify auto-merged. Agent creates PR with changes in `skills/` → verify left open.

- [ ] T030 [US2] Test auto-merge happy path: job changes only `logs/` → PR auto-merged, branch deleted
- [ ] T031 [US2] Test auto-merge blocked: job changes files outside ALLOWED_PATHS → PR left open for review
- [ ] T032 [US2] Test AUTO_MERGE=false: no merge attempted regardless of paths
- [ ] T033 [US2] Test merge conflict: PR has conflicts → left open, notification sent with conflict info

**Checkpoint**: Auto-merge behavior is identical to the GitHub Actions workflow for all edge cases.

---

## Phase 5: User Story 3 — Local LLM for Planning and Summaries (Priority: P1)

**Goal**: Ollama (Phi-4 14B) handles planning/chat/summary requests. Cloud fallback works.

**Independent Test**: Create job via chat → verify planning goes to Ollama → verify agent uses Claude Sonnet → verify summary uses Ollama.

### Ollama Setup

- [ ] T034 [P] [US3] Install Ollama on Mac Mini: `brew install ollama`. Pull model: `ollama pull phi4:14b`. Verify serving at `http://localhost:11434`

### LLM Router

- [ ] T035 [US3] Implement `worker/llm-router.js` — `routeLLM(request)` function: if `type === 'agent_execution'` → Claude Sonnet (cloud); else → try Ollama (`phi4:14b`) at `OLLAMA_URL`, fallback to Claude Sonnet on error. Log warning on fallback

### Event Handler Integration

- [ ] T036 [US3] Modify `Clusters/lib/ai/model.js` — add `ollama` or `custom` provider support that routes to `OLLAMA_URL` with OpenAI-compatible API. When `LLM_PROVIDER` is not set and `OLLAMA_URL` is set, use Ollama for non-agent requests (chat, planning)
- [ ] T037 [US3] Modify chat streaming route (`app/stream/chat/route.js` or package equivalent) — route chat requests through LLM router (Ollama first, cloud fallback)

### Summary Integration

- [ ] T038 [US3] Modify job summary generation in `Clusters/lib/ai/index.js` (`summarizeJob()`) — route through LLM router (Phi-4 14B for summaries)

### Fallback Test

- [ ] T039 [US3] Test: stop Ollama (`ollama stop`), send chat message → verify cloud fallback works with warning logged. Restart Ollama → verify local routing resumes

**Checkpoint**: Chat/planning/summary requests go to Ollama. Agent execution still uses Claude Sonnet. Cloud fallback works automatically.

---

## Phase 6: User Story 4 — Heartbeat and Self-Monitoring (Priority: P1)

**Goal**: Heartbeat cron dispatches to BullMQ, Ollama handles lightweight checks.

**Independent Test**: Enable heartbeat cron → verify BullMQ dispatch → verify Ollama handles → verify notification on anomaly.

- [ ] T040 [US4] Verify heartbeat cron in `config/CRONS.json` dispatches via `executeAction()` → `createJob()` → BullMQ (already works via dispatcher adapter from T016-T018)
- [ ] T041 [US4] Implement task-scoped system prompt assembly in `worker/blueprint.js` Step 1 — detect heartbeat jobs (title/prompt pattern or `job_type` field), load only `SOUL.md` + `HEARTBEAT.md` instead of full `JOB_AGENT.md` + all skills
- [ ] T042 [US4] Test: enable heartbeat cron, verify it dispatches to BullMQ, verify Ollama handles the lightweight check, verify notification on anomaly detection
- [ ] T043 [US4] Test: when Redis is unreachable and heartbeat fires, verify failure notification via direct HTTP (bypass queue) — add try/catch in cron dispatcher that falls back to direct notification

**Checkpoint**: Heartbeat runs via BullMQ with Ollama, zero LLM cost for routine checks.

---

## Phase 7: User Story 5 — Job Status Without GitHub API (Priority: P1)

**Goal**: `/api/jobs/status` returns real-time state from BullMQ + Postgres.

**Independent Test**: Create 5 jobs → query status → verify all appear with correct states.

- [ ] T044 [US5] Already implemented in T028 — verify: create 5 jobs in various states (queued, active, completed, failed), query `/api/jobs/status`, confirm correct states and metadata
- [ ] T045 [US5] Test: verify status transitions are reflected within 1 second (poll during active job)
- [ ] T046 [US5] Test: verify response time <100ms with 100 job records (seed test data)

**Checkpoint**: Job status is real-time from BullMQ, no GitHub API dependency.

---

## Phase 8: User Story 8 — Resource Limits (from FR-024/FR-025)

**Goal**: Per-job resource limits enforced with kill + notification on breach.

- [ ] T047 [P] [US8] Add resource limit configuration: read `MAX_JOB_TIME_MS` (default 1800000), `MAX_TOKENS_PER_JOB` (default 100000), `MAX_RETRIES` (default 2), `MAX_CONTAINER_MEMORY` (default `2g`) from env
- [ ] T048 [US8] In `worker/container.js` — pass `--memory` flag to `docker run`, enforce timeout via watchdog timer from limits config
- [ ] T049 [US8] In `worker/blueprint.js` — on resource limit breach: kill container, set `jobs.error` to `exceeded [limit_name]`, send failure notification with breach reason, do NOT retry
- [ ] T050 [US8] Test: set `MAX_JOB_TIME_MS=10000` (10s), run a long job → verify kill + notification with "exceeded max_time"

**Checkpoint**: Resource limits enforced, breach produces clear notification.

---

## Phase 9: Verification & Cutover

**Purpose**: Full test matrix, all 22 GitHub features verified, cutover to BullMQ.

- [ ] T051 Run through all 22 features from the GitHub Features Migration Map (spec lines 266-289) and verify each works via BullMQ
- [ ] T052 Test concurrency: enqueue 3+ jobs simultaneously → verify max 2 run concurrently, 3rd waits in queue
- [ ] T053 Test `JOB_DISPATCH` toggle: switch between `github` and `bullmq` → verify both paths work
- [ ] T054 Test rollback: set `JOB_DISPATCH=github` after running BullMQ jobs → verify GitHub Actions path still works
- [ ] T055 [P] Disable `run-job.yml` workflow — add `if: false` guard or disable in GitHub UI to prevent duplicate triggers when `JOB_DISPATCH=bullmq`
- [ ] T056 Set `JOB_DISPATCH=bullmq` as default in `.env`

**Checkpoint**: All 22 features pass. BullMQ is the default dispatch path. GitHub Actions is disabled but available as rollback.

---

## Phase 10: Polish & Cross-Cutting

- [ ] T057 [P] Update `docs/01-architecture.md` with new BullMQ + Worker architecture diagram
- [ ] T058 [P] Update `docs/INDEX.md` with new architecture references
- [ ] T059 [P] Update `CLAUDE.md` with worker process, PM2, Postgres, Redis documentation
- [ ] T060 [P] Update `config/SPECKIT.md` — fix stale references (Mistral Small 24B → Phi-4 14B, internal modules vs skills classification)
- [ ] T061 Update `.env.example` (if exists) with new env vars: `DATABASE_URL`, `REDIS_URL`, `OLLAMA_URL`, `JOB_DISPATCH`
- [ ] T062 Create quickstart guide: `docs/13-local-infra-setup.md` — Docker Compose, PM2, Ollama install, first job test

---

## Dependencies & Execution Order

### Phase Dependencies

```
Phase 1: Setup ──────────────── (no dependencies, start immediately)
    │
Phase 2: Foundational ────────── (depends on Phase 1)
    │                              BLOCKS all user stories
    │
    ├── Phase 3: US1 Job Dispatch (P0, MVP) ── depends on Phase 2
    │       │
    │       ├── Phase 4: US2 Auto-Merge (P0) ── depends on Phase 3 (uses T026)
    │       │
    │       └── Phase 7: US5 Job Status (P1) ── depends on Phase 3 (uses T028)
    │
    ├── Phase 5: US3 Local LLM (P1) ── depends on Phase 2 only (parallel with Phase 3)
    │
    ├── Phase 6: US4 Heartbeat (P1) ── depends on Phase 3 + Phase 5
    │
    └── Phase 8: Resource Limits ── depends on Phase 3
         │
Phase 9: Verification ────────── depends on Phases 3-8
    │
Phase 10: Polish ─────────────── depends on Phase 9
```

### Parallel Opportunities

- **Phase 5 (Local LLM) runs in parallel with Phase 3 (Worker)** — LLM router hooks into event handler, not worker
- **T001, T002, T003, T004, T005** — all Phase 1 setup tasks are parallel
- **T009, T010** — capabilities and job_capabilities tables are independent
- **T034** — Ollama install is independent of all code tasks
- **All Phase 10 documentation tasks** are parallel with each other

### Critical Path

```
T001-T005 → T006-T018 → T019-T029 → T051-T056
(Setup)     (Foundation) (Worker MVP) (Verification)
```

Estimated critical path: **~20 hours** (8h foundation + 10h worker + 2h verification)

---

## Implementation Strategy

### MVP First (Phases 1-3 only)

1. Complete Phase 1: Setup (2h)
2. Complete Phase 2: Foundational — Postgres + BullMQ + dispatcher (8h)
3. Complete Phase 3: US1 Job Dispatch — full worker lifecycle (10h)
4. **STOP AND VALIDATE**: Test full job lifecycle end-to-end
5. If working: proceed to Phase 4+ in priority order

### Incremental Delivery

Each phase adds independently testable value:
- After Phase 3: Jobs work via BullMQ (core replacement)
- After Phase 4: Auto-merge verified (complete P0)
- After Phase 5: Local LLM saves ~40% on LLM costs
- After Phase 6: Heartbeat runs for free
- After Phase 9: Full cutover, GitHub Actions disabled
