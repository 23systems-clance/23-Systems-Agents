# docker/ — Docker Images & Compose

## Images

All tagged `stephengpope/thepopebot:{tag}-{version}`:

| Image | Lifecycle | Purpose |
|-------|-----------|---------|
| `event-handler` | Long-lived | Next.js server. Installs npm package from npm, user project volume-mounted at `/app`, PM2 process manager |
| `pi-coding-agent-job` | Ephemeral | Clones `job/*` branch, installs skill deps, builds system prompt from SOUL.md + JOB_AGENT.md, runs Pi agent, commits results + creates PR |
| `claude-code-job` | Ephemeral | Same flow as Pi but runs Claude Code CLI with `--dangerously-skip-permissions` |
| `claude-code-workspace` | Long-lived | Clones repo, runs Claude Code in tmux, serves via ttyd on port 7681 |
| `claude-code-cluster-worker` | Ephemeral | Runs Claude Code headlessly for cluster worker tasks — no git clone/merge, workspace bind-mounted |

## Docker Compose

`docker-compose.yml` runs: Traefik (reverse proxy), event-handler, self-hosted GitHub runner. Job containers are NOT in compose — created on-demand by `run-job.yml` workflow.

## Managed

The entire `docker/` directory is managed — auto-synced on upgrade. All Dockerfiles, entrypoints, and this CLAUDE.md are overwritten by `init` to match the package version.

## Secrets Flow

GitHub Actions secrets → `SECRETS` and `LLM_SECRETS` JSON env vars → `entrypoint.sh` exports individual keys into the container environment.
