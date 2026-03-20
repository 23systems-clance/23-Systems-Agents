# 04 — AI Agents & LLM Integration

## Agent Architecture

Built on **LangChain + LangGraph** with a `createReactAgent` pattern. Two agent types exist:

### Job Agent (Singleton)

- **Source**: `Clusters/lib/ai/agent.js`
- **System prompt**: `config/JOB_PLANNING.md` (rendered fresh per invocation with `{{ includes }}`)
- **Memory**: SQLite checkpointer via `SqliteSaver` (persistent across conversations)
- **Purpose**: Plans and dispatches autonomous jobs via chat

**Tools available to Job Agent:**

| Tool | Purpose |
|------|---------|
| `create_job` | Dispatch an autonomous Docker agent job |
| `get_job_status` | Check status of running/queued jobs |
| `get_system_technical_specs` | Retrieve system environment details |
| `get_skill_building_guide` | Read the skill creation guide |
| `get_skill_details` | Read a specific skill's SKILL.md |
| Web search | Available for anthropic & openai providers (controlled by `WEB_SEARCH` env var) |
| MCP tools | Dynamically loaded from `mcp-servers/` via `mcp-bridge.js` |

### Code Agent (Per-Chat)

- **Source**: `Clusters/lib/ai/agent.js`
- **System prompt**: `config/CODE_PLANNING.md`
- **Memory**: Keyed by `chatId` in an internal Map
- **Purpose**: Interactive coding assistance with workspace spawning

**Tools available to Code Agent:**

| Tool | Purpose |
|------|---------|
| `start_coding` | Launch a Docker code workspace (bound to workspace config) |
| `get_repository_details` | Fetch repo structure (bound to repo/branch) |
| Web search | Same availability as Job Agent |
| MCP tools | Same as Job Agent |

## LLM Provider Configuration

| Provider | Env Key | Default Model | Required Env |
|----------|---------|---------------|--------------|
| `anthropic` (default) | `LLM_PROVIDER=anthropic` | `claude-sonnet-4-20250514` | `ANTHROPIC_API_KEY` |
| `openai` | `LLM_PROVIDER=openai` | `gpt-4o` | `OPENAI_API_KEY` |
| `google` | `LLM_PROVIDER=google` | `gemini-2.5-pro` | `GOOGLE_API_KEY` |
| `custom` | `LLM_PROVIDER=custom` | (user-specified) | `OPENAI_BASE_URL` + `CUSTOM_API_KEY` |

**Per-job overrides**: Cron jobs and triggers can override `llm_provider` and `llm_model` in their JSON config. These get written to `logs/{UUID}/job.config.json` and read by `run-job.yml`.

## Web Search Integration

- Controlled by `WEB_SEARCH` env var (default: enabled)
- Only available for `anthropic` and `openai` providers
- When available, injects `WEB_SEARCH_AVAILABLE.md` into system prompt
- When unavailable, injects `WEB_SEARCH_UNAVAILABLE.md`

## MCP Bridge

- **Source**: `Clusters/lib/ai/mcp-bridge.js`
- Loads tool definitions from MCP servers defined in `config/MCP_SERVERS.json`
- Server implementations live in `mcp-servers/` directory
- Tools are injected into both Job Agent and Code Agent at startup
- Currently active: `builtwith` (technology profiling API)

## Headless Stream Parser

- **Source**: `Clusters/lib/ai/headless-stream.js`
- Parses Docker container output from Claude Code headless agents
- Three-layer parsing pipeline:
  1. **Docker frame decoder** — 8-byte multiplexed headers (stdout/stderr)
  2. **NDJSON splitter** — Accumulates UTF-8, splits on newlines
  3. **Event mapper** — Converts to chat events: `text`, `tool-call`, `tool-result`

## Chat Streaming Flow

```
User message
    ↓
/stream/chat (POST with session auth)
    ↓
Agent processes with LangGraph
    ↓
Server-Sent Events (SSE) stream back:
  - text chunks (assistant response)
  - tool-call events (tool invocations)
  - tool-result events (tool outputs)
  - done event (stream complete)
    ↓
React UI renders incrementally
```

## Prompt Template System

Config markdown files support:

| Syntax | Resolution |
|--------|------------|
| `{{ filepath.md }}` | Include another file (relative to project root, recursive with circular detection) |
| `{{datetime}}` | Current ISO timestamp |
| `{{skills}}` | Dynamic bullet list of active skill descriptions from `skills/active/*/SKILL.md` frontmatter |

Processed by the package's `render-md.js` at runtime.
