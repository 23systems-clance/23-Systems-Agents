# 01 — Architecture Overview

## System Identity

- **Product**: 23 Systems Agent (powered by [23WF](https://github.com/23systems/23wf))
- **Core Pattern**: Two-layer autonomous AI agent with event-driven orchestration
- **All business logic** lives in the `23wf` npm package. This project is a scaffolded shell — thin Next.js wiring, user-editable configuration, GitHub Actions workflows, and Docker files.

## Two-Layer Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                                                                     │
│  ┌──────────────────┐         ┌──────────────────┐                 │
│  │  EVENT HANDLER   │ ──1──►  │     GitHub       │                 │
│  │  (Next.js)       │         │ (job/* branch)   │                 │
│  │                  │         └────────┬─────────┘                 │
│  │  - Web UI        │                  │                           │
│  │  - Chat          │                  2 (triggers run-job.yml)    │
│  │  - Cron jobs     │                  │                           │
│  │  - Webhooks      │                  ▼                           │
│  │  - Telegram      │         ┌──────────────────┐                 │
│  │  - API           │         │  DOCKER AGENT    │                 │
│  └────────▲─────────┘         │  (Pi / Claude)   │                 │
│           │                   └────────┬─────────┘                 │
│           │                            │                           │
│           │                            3 (commits + opens PR)      │
│           │                            │                           │
│           │                   ┌────────▼─────────┐                 │
│           │                   │  GitHub PR        │                 │
│           │                   │  (auto-merge.yml) │                 │
│           │                   └────────┬─────────┘                 │
│           │                            │                           │
│           5 (notification →            4 (notify-pr-complete.yml)  │
│              web UI + Telegram)        │                           │
│           └────────────────────────────┘                           │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### Layer 1: Event Handler

The Next.js server that orchestrates everything:

| Responsibility | Implementation |
|---------------|----------------|
| Web UI | React pages imported from `23wf/chat`, `23wf/auth/components`, etc. |
| Chat | LangGraph agent with streaming responses via `/stream/chat` |
| Cron scheduling | `node-cron` from `config/CRONS.json`, loaded at startup |
| Webhook triggers | Middleware matches `config/TRIGGERS.json` watch paths |
| Telegram | Bot webhook at `/api/telegram/webhook` |
| Job dispatch | Creates `job/{UUID}` branches via GitHub API |
| Notifications | Receives completion webhooks, updates DB + Telegram |

### Layer 2: Docker Agents

Containers spun up by GitHub Actions that execute autonomous tasks:

| Backend | Image | Use Case |
|---------|-------|----------|
| Pi Coding Agent | `pi-coding-agent-job` | Default. Lightweight Python-based autonomous agent |
| Claude Code Headless | `claude-code-job` | Claude Code in headless mode |
| Claude Code Workspace | `claude-code-workspace` | Interactive terminal via xterm.js in browser |
| Cluster Agent | `claude-code-cluster-worker` | Role-based agent containers |

## Job Lifecycle (Complete Flow)

```
1. JOB CREATED
   └─ Source: Chat, Cron, Webhook Trigger, or /api/create-job
   └─ Event Handler calls createJob()

2. BRANCH PUSHED
   └─ Creates job/{UUID} branch on GitHub
   └─ Writes logs/{UUID}/job.md (task prompt)
   └─ Writes logs/{UUID}/job.config.json (LLM overrides)

3. WORKFLOW TRIGGERS
   └─ run-job.yml fires on job/* branch creation
   └─ Resolves Docker image from job.config.json or repo variables
   └─ Builds SECRETS + LLM_SECRETS from GitHub secrets (prefix-based)

4. CONTAINER RUNS
   └─ Docker agent clones job/{UUID} branch
   └─ Builds system prompt from config/SOUL.md + config/JOB_AGENT.md
   └─ Runs LLM with job prompt
   └─ Logs session to logs/{UUID}/

5. PR CREATED
   └─ Agent commits results and opens pull request

6. AUTO-MERGE (optional)
   └─ auto-merge.yml checks if ALL changed files are within ALLOWED_PATHS
   └─ Default ALLOWED_PATHS: /logs
   └─ Squash-merges if approved

7. NOTIFICATION
   └─ notify-pr-complete.yml fires after merge
   └─ Sends webhook to Event Handler at APP_URL
   └─ Creates notification in web UI
   └─ Sends Telegram/Slack message
```

## Action Type System

Both cron jobs and webhook triggers share the same dispatch system with three action types:

| Type | Uses LLM | Runtime | Cost | Use Case |
|------|----------|---------|------|----------|
| `agent` (default) | Yes — Docker container | Minutes to hours | LLM API + GitHub Actions | Tasks that need reasoning |
| `command` | No — shell script | Milliseconds to seconds | Free (runs on event handler) | File ops, scripts |
| `webhook` | No — HTTP request | Milliseconds to seconds | Free (runs on event handler) | External API calls |

**Decision rule**: If the task needs to *think*, use `agent`. If it needs to *do*, use `command`. If it needs to *call*, use `webhook`.

## BullMQ Worker Architecture (Phase 0)

When `JOB_DISPATCH=bullmq`, jobs are dispatched via BullMQ + Redis instead of GitHub Actions:

```
┌─────────────────────────────────────────────────────────────────────┐
│                                                                     │
│  ┌──────────────────┐         ┌──────────────────┐                 │
│  │  EVENT HANDLER   │ ──1──►  │   BullMQ Queue   │                 │
│  │  (Next.js)       │         │   (Redis)        │                 │
│  │                  │         └────────┬─────────┘                 │
│  │  - Web UI        │                  │                           │
│  │  - Chat          │                  2 (worker dequeues)         │
│  │  - Cron jobs     │                  │                           │
│  │  - Webhooks      │                  ▼                           │
│  │  - API           │         ┌──────────────────┐                 │
│  └────────▲─────────┘         │  WORKER          │                 │
│           │                   │  (7-step         │                 │
│           │                   │   blueprint)     │                 │
│           │                   └────────┬─────────┘                 │
│           │                            │                           │
│           │                            3 (spawns Docker container) │
│           │                            │                           │
│           │                   ┌────────▼─────────┐                 │
│           │                   │  DOCKER AGENT    │                 │
│           │                   │  (Pi / Claude)   │                 │
│           │                   └────────┬─────────┘                 │
│           │                            │                           │
│           │                            4 (commits + opens PR)      │
│           │                            │                           │
│           │                   ┌────────▼─────────┐                 │
│           │                   │  Worker:         │                 │
│           │                   │  validate →      │                 │
│           │                   │  auto-merge →    │                 │
│           5 (notification)    │  notify          │                 │
│           └───────────────────┘                  │                 │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### Worker Blueprint (7-Step State Machine)

| Step | Name | Action |
|------|------|--------|
| 1 | Resolve | Read job config, query capabilities, resolve Docker image, build env vars |
| 2 | Spawn | Start Docker container with resource limits (memory, timeout) |
| 3 | Execute | Await container exit code, enforce timeout watchdog |
| 4 | Validate | Find PR, check changed files, run eslint, detect anomalies |
| 5 | Retry | Re-spawn with validation errors as context (max 1 retry) |
| 6 | Auto-Merge | Squash-merge if all files within ALLOWED_PATHS |
| 7 | Notify | Send completion webhook to event handler |

### Infrastructure Components

| Component | Technology | Purpose |
|-----------|-----------|---------|
| Job queue | BullMQ + Redis | Job dispatch, progress tracking, concurrency control |
| Database | Postgres 16 | Jobs, capabilities, job_capabilities tables |
| Worker | Node.js (PM2) | Separate process, dequeues and executes jobs |
| Local LLM | Ollama (Phi-4 14B) | Planning, chat, summaries — cloud fallback on failure |
| Feature flag | `JOB_DISPATCH` env var | `github` (default) or `bullmq` |

### LLM Routing

When `OLLAMA_URL` is set, lightweight requests (summaries, titles) route to Ollama first with automatic cloud fallback. Agent execution always uses cloud (Claude Sonnet).

| Request Type | Primary | Fallback |
|-------------|---------|----------|
| Agent execution | Claude Sonnet (cloud) | — |
| Job summary | Ollama (Phi-4 14B) | Cloud provider |
| Chat/planning | Cloud provider | — |
| Auto-title | Cloud provider | — |

## Key Design Principles

1. **Git-backed auditability** — Every agent action is a commit, fully reversible via git
2. **Managed vs user-editable separation** — `app/`, `.github/`, `docker/` are auto-synced; `config/`, `skills/`, `cron/` are user-owned
3. **Self-modification** — Agent can modify its own config, specialties, crons, and triggers through git PRs
4. **Prefix-based secret isolation** — `AGENT_*` secrets filtered from LLM; `AGENT_LLM_*` accessible to LLM
5. **Path resolution from project root** — All paths resolve from `process.cwd()`, enabling npm package to access user files
6. **Gradual migration** — `JOB_DISPATCH` flag allows switching between GitHub Actions and BullMQ without code changes
7. **Resource limits** — Per-job timeout and memory limits with kill + notification on breach
