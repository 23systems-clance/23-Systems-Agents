# 13 — Local Infrastructure Setup

## Prerequisites

- Docker Desktop (for Postgres + Redis)
- Node.js 20+
- PM2 (`npm install -g pm2`)
- Ollama (optional, for local LLM)

## 1. Start Infrastructure

```bash
docker compose -f docker-compose.infra.yml up -d
```

This starts:
- **Postgres 16** on port 5432 (user: `postgres`, password: `postgres`, db: `23wf`)
- **Redis 7** on port 6379 (AOF persistence)

## 2. Environment Variables

Add to `.env`:

```bash
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/23wf
REDIS_URL=redis://localhost:6379
JOB_DISPATCH=bullmq    # or "github" to use GitHub Actions
OLLAMA_URL=http://localhost:11434  # optional
```

## 3. Run Database Migrations

```bash
cd Clusters && npx drizzle-kit migrate
```

## 4. Optional: Migrate SQLite Data

If you have existing data in SQLite:

```bash
node scripts/migrate-sqlite-to-postgres.js
```

## 5. Start Services with PM2

```bash
pm2 start ecosystem.config.js
pm2 logs  # watch both processes
```

This starts:
- **event-handler**: Next.js dev server
- **worker**: BullMQ job consumer

## 6. Optional: Install Ollama

```bash
brew install ollama
ollama pull phi4:14b
ollama serve  # runs on port 11434
```

When `OLLAMA_URL` is set, job summaries route to Ollama first with automatic cloud fallback.

## 7. Test the Pipeline

1. Set `JOB_DISPATCH=bullmq` in `.env`
2. Create a job via chat UI or API
3. Verify in PM2 logs:
   - Event handler enqueues to BullMQ
   - Worker picks up job
   - Docker container spawns
   - PR created, validated, auto-merged
   - Notification sent back

## Switching Between Dispatch Modes

| `JOB_DISPATCH` | Behavior |
|----------------|----------|
| `github` (default) | Jobs dispatched via GitHub Actions (original) |
| `bullmq` | Jobs dispatched via BullMQ + local worker |

Both modes still create `job/*` branches on GitHub for audit trail.

## Resource Limits

| Variable | Default | Description |
|----------|---------|-------------|
| `MAX_JOB_TIME_MS` | `1800000` (30 min) | Maximum job execution time |
| `MAX_RETRIES` | `1` | Validation retry attempts |
| `MAX_CONTAINER_MEMORY` | `2g` | Docker container memory limit |
| `WORKER_CONCURRENCY` | `2` | Max concurrent jobs |

## Stopping Services

```bash
pm2 stop all
docker compose -f docker-compose.infra.yml down
```

To preserve data across restarts, volumes (`pgdata`, `redisdata`) persist by default.
