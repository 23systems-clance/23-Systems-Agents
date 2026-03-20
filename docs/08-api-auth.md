# 08 — API & Authentication

## Authentication System

### Browser UI Authentication

- **Framework**: NextAuth v5 with Credentials provider (email/password)
- **Storage**: JWT in httpOnly cookies
- **First visit**: Creates admin account (no invitation system)
- **Session check**: Server Actions use `requireAuth()` pattern

### API Key Authentication

- **Header**: `x-api-key`
- **Format**: `tpb_` prefix + 64 hex characters
- **Storage**: SHA-256 hashed in `settings` table
- **Validation**: Timing-safe comparison to prevent timing attacks
- **Management**: Web UI at `/settings/secrets`

### WebSocket Authentication (Code Workspaces)

- Reads `authjs.session-token` cookie from the WebSocket upgrade request
- Decodes JWT using `next-auth/jwt` with `AUTH_SECRET`
- Returns 401 if no valid token
- Returns 403 if workspace not found or not owned by user
- Proxied via `server.js` → `ws-proxy.js` → container port 7681

## API Endpoints

All routes are under `/api/`, handled by the catch-all route at `app/api/[...thepopebot]/route.js`.

| Endpoint | Method | Auth | Purpose |
|----------|--------|------|---------|
| `/api/create-job` | POST | `x-api-key` | Create a new autonomous agent job |
| `/api/telegram/webhook` | POST | `TELEGRAM_WEBHOOK_SECRET` | Telegram bot webhook receiver |
| `/api/telegram/register` | POST | `x-api-key` | Register Telegram webhook URL |
| `/api/github/webhook` | POST | `GH_WEBHOOK_SECRET` | Receive job completion notifications from GitHub Actions |
| `/api/jobs/status` | GET | `x-api-key` | Check status of running/queued jobs |
| `/api/ping` | GET | Public | Health check |

### Create Job Example

```bash
curl -X POST https://your-app.com/api/create-job \
  -H "x-api-key: tpb_abc123..." \
  -H "Content-Type: application/json" \
  -d '{"job": "Analyze the logs and write a summary report"}'
```

### Chat Streaming

- **Endpoint**: `/stream/chat` (POST)
- **Auth**: Session cookie (NextAuth `auth()` check)
- **Response**: Server-Sent Events (SSE) stream
- **Events**: `text`, `tool-call`, `tool-result`, `done`

## Webhook Trigger Authentication

Webhook triggers (defined in `TRIGGERS.json`) fire on POST requests to watched paths. The request passes through NextAuth middleware first, then the trigger middleware matches `watch_path` and dispatches actions fire-and-forget.

## GitHub Actions Authentication

| Secret | Purpose |
|--------|---------|
| `GH_TOKEN` | Personal Access Token for creating branches/files via GitHub API |
| `GH_WEBHOOK_SECRET` | Validates webhook payloads from GitHub Actions to Event Handler |
| `TELEGRAM_WEBHOOK_SECRET` | Validates Telegram webhook payloads |

## Secret Prefix Conventions (GitHub → Docker)

| Prefix | Visibility | Example |
|--------|-----------|---------|
| `AGENT_*` | Container env vars (filtered from LLM bash) | `AGENT_GH_TOKEN`, `AGENT_ANTHROPIC_API_KEY` |
| `AGENT_LLM_*` | Container env vars (visible to LLM) | `AGENT_LLM_BRAVE_API_KEY` |
| *(no prefix)* | Workflow-only (never in container) | `GH_WEBHOOK_SECRET` |

In `run-job.yml`:
- `AGENT_*` secrets → `SECRETS` JSON object (prefix stripped) → env vars in container
- `AGENT_LLM_*` secrets → `LLM_SECRETS` JSON object → NOT filtered from LLM bash
