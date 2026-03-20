# 09 — Docker & Deployment

## Docker Images

| Image | Directory | Purpose |
|-------|-----------|---------|
| Event Handler | `docker/event-handler/` | Traefik-fronted Next.js server (PM2 managed) |
| Pi Coding Agent | `docker/pi-coding-agent-job/` | Lightweight Python autonomous agent |
| Claude Code Job | `docker/claude-code-job/` | Claude Code in headless mode |
| Claude Code Workspace | `docker/claude-code-workspace/` | Interactive terminal (ttyd on port 7681) |
| Claude Code Cluster Worker | `docker/claude-code-cluster-worker/` | Role-based worker containers |

### Build Pattern

Multi-stage builds:
1. **Builder stage**: Node 22, installs npm dependencies
2. **Runtime stage**: Minimal image, PM2 process manager, GitHub CLI

### Cluster Worker Container (`docker/claude-code-cluster-worker/`)

The `entrypoint.sh` script:
1. Sets up git config and SSH keys
2. Clones the repository (sparse checkout if `FOLDERS` specified)
3. Installs dependencies
4. Writes `SYSTEM.md` from `SYSTEM_PROMPT` env var
5. Runs Claude Code in headless mode with the `PROMPT` env var
6. Commits and pushes results

## Docker Compose

`docker-compose.yml` orchestrates the Event Handler for local development. Key services:
- **app**: Next.js server with volume mounts for `config/`, `skills/`, `data/`, `logs/`
- **traefik** (optional): Reverse proxy for HTTPS

## GitHub Actions Workflows

### run-job.yml (Job Execution)

**Trigger**: Push to `job/*` branch

Flow:
1. Sparse checkout `logs/*/job.config.json` from job branch
2. Resolve 23wf version from `package-lock.json`
3. Read job config overrides (llm_provider, llm_model, agent_backend)
4. Login to GHCR if `JOB_IMAGE_URL` uses `ghcr.io`
5. Select Docker image based on `agent_backend`:
   - `pi` (default) → Pi coding agent image
   - `claude-code` → Claude Code job image
   - Custom → `JOB_IMAGE_URL` variable
6. Build `SECRETS` and `LLM_SECRETS` from GitHub secrets
7. Run container with env vars

### auto-merge.yml

**Trigger**: PR opened by job agent

- Checks if ALL changed files fall within `ALLOWED_PATHS` prefixes
- Default `ALLOWED_PATHS`: `/logs`
- If approved: squash-merges the PR
- Set `AUTO_MERGE=false` repository variable to disable

### notify-pr-complete.yml

**Trigger**: After `auto-merge.yml` completes

- Sends POST to `APP_URL/api/github/webhook` with job results
- Event Handler creates notification + sends Telegram/Slack message

### notify-job-failed.yml

**Trigger**: `run-job.yml` fails

- Sends failure notification to Event Handler

### rebuild-event-handler.yml

**Trigger**: Push to `main` branch

- Rebuilds the Next.js server container
- Fast path (no Docker rebuild) or full Docker restart

### upgrade-event-handler.yml

**Trigger**: Manual `workflow_dispatch`

- Creates a PR to upgrade the `23wf` npm package

## Repository Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `APP_URL` | Public URL for webhooks and Telegram | **Required** |
| `RUNS_ON` | GitHub Actions runner label | `ubuntu-latest` |
| `AUTO_MERGE` | Set `"false"` to disable | Enabled |
| `ALLOWED_PATHS` | Comma-separated path prefixes for auto-merge | `/logs` |
| `JOB_IMAGE_URL` | Custom Docker image for job agents | Default per backend |
| `EVENT_HANDLER_IMAGE_URL` | Custom Docker image for event handler | Default |
| `LLM_PROVIDER` | LLM provider for Docker agents | `anthropic` |
| `LLM_MODEL` | LLM model override | Provider default |
| `AGENT_BACKEND` | `pi` or `claude-code` | `pi` |

## Code Workspace Container Lifecycle

1. Chat agent calls `start_coding` tool → `runCodeWorkspaceContainer()`
2. Docker container starts with `ttyd` on port 7681 (WebSocket terminal)
3. Browser navigates to `/code/{id}` → xterm.js connects via WebSocket
4. `server.js` → `ws-proxy.js` authenticates JWT cookie and proxies to container
5. Container recovery: `ensureCodeWorkspaceContainer()` handles restart/recreate of stopped containers
