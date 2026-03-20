# 12 — Environment Variables

## Required Variables

| Variable | Description |
|----------|-------------|
| `APP_URL` | Public URL for webhooks and Telegram (e.g., `https://agent.23systems.com`) |
| `AUTH_SECRET` | NextAuth session encryption key (auto-generated on first run) |
| `GH_TOKEN` | GitHub Personal Access Token (repo scope) for branch/file/PR creation |
| `GH_OWNER` | GitHub repository owner (e.g., `23-Systems`) |
| `GH_REPO` | GitHub repository name (e.g., `23-Systems-Agents`) |

## LLM Provider Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `LLM_PROVIDER` | `anthropic`, `openai`, `google`, or `custom` | `anthropic` |
| `LLM_MODEL` | Model name override | Provider default |
| `LLM_MAX_TOKENS` | Max tokens for LLM responses | `4096` |
| `ANTHROPIC_API_KEY` | Anthropic API key | Required for anthropic provider |
| `OPENAI_API_KEY` | OpenAI API key (also used for Whisper voice-to-text) | Required for openai provider |
| `OPENAI_BASE_URL` | Custom OpenAI-compatible endpoint | Required for custom provider |
| `GOOGLE_API_KEY` | Google API key | Required for google provider |
| `CUSTOM_API_KEY` | Custom provider API key | Required for custom provider |

## Integration Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `TELEGRAM_BOT_TOKEN` | Telegram bot token | For Telegram features |
| `TELEGRAM_WEBHOOK_SECRET` | Telegram webhook validation | Optional |
| `TELEGRAM_CHAT_ID` | Default chat ID for notifications | For Telegram notifications |
| `GH_WEBHOOK_SECRET` | GitHub Actions webhook auth | For job notifications |
| `WEB_SEARCH` | Enable/disable web search tool | Default: enabled |
| `DATABASE_PATH` | Override SQLite DB location | Default: `data/23wf.sqlite` |

## GitHub Repository Secrets

Secrets set in GitHub repo settings, consumed by GitHub Actions workflows.

### Prefix Convention

| Prefix | Container Visibility | LLM Visibility | Example |
|--------|---------------------|----------------|---------|
| `AGENT_*` | Yes (env vars) | No (filtered by env-sanitizer) | `AGENT_GH_TOKEN`, `AGENT_ANTHROPIC_API_KEY` |
| `AGENT_LLM_*` | Yes (env vars) | Yes (in LLM bash environment) | `AGENT_LLM_BRAVE_API_KEY` |
| *(no prefix)* | No (workflow-only) | No | `GH_WEBHOOK_SECRET` |

### How Secrets Flow

```
GitHub Repo Secrets
    ↓
run-job.yml collects by prefix:
    AGENT_*       → SECRETS JSON     (prefix stripped, e.g., AGENT_GH_TOKEN → GH_TOKEN)
    AGENT_LLM_*   → LLM_SECRETS JSON (prefix stripped)
    ↓
Docker container receives:
    SECRETS env vars  → available to code, NOT to LLM bash
    LLM_SECRETS       → available to both code AND LLM bash
```

## GitHub Repository Variables

Variables set in GitHub repo settings, consumed by workflows as configuration.

| Variable | Description | Default |
|----------|-------------|---------|
| `APP_URL` | Public URL for webhooks/Telegram | **Required** |
| `RUNS_ON` | GitHub Actions runner label | `ubuntu-latest` |
| `AUTO_MERGE` | Set `"false"` to disable auto-merge | Enabled |
| `ALLOWED_PATHS` | Comma-separated path prefixes for auto-merge | `/logs` |
| `JOB_IMAGE_URL` | Custom Docker image for job agents | Default per backend |
| `EVENT_HANDLER_IMAGE_URL` | Custom Docker image for event handler | Default |
| `LLM_PROVIDER` | LLM provider for Docker agents | `anthropic` |
| `LLM_MODEL` | LLM model for Docker agents | Provider default |
| `AGENT_BACKEND` | `pi` or `claude-code` | `pi` |

## Example .env File

```env
# Required
APP_URL=https://agent.23systems.com
AUTH_SECRET=auto-generated-on-first-run
GH_TOKEN=ghp_xxxxxxxxxxxx
GH_OWNER=23-Systems
GH_REPO=23-Systems-Agents

# LLM (pick one provider)
LLM_PROVIDER=anthropic
ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxx

# Optional: Telegram
TELEGRAM_BOT_TOKEN=123456:ABC-DEF
TELEGRAM_CHAT_ID=987654321
TELEGRAM_WEBHOOK_SECRET=mysecret

# Optional: OpenAI (for Whisper voice-to-text)
OPENAI_API_KEY=sk-xxxxxxxxxxxx

# Optional: GitHub webhook auth
GH_WEBHOOK_SECRET=webhook-secret-here
```
