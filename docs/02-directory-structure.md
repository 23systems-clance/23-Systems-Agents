# 02 — Directory Structure

## Complete File Tree

```
project-root/
├── CLAUDE.md                          # AI assistant context (MANAGED — auto-synced)
├── AGENTS.md                          # Agent instructions
├── next.config.mjs                    # Next.js config (wraps withThepopebot())
├── server.js                          # HTTP server with WebSocket proxy for code workspaces
├── instrumentation.js                 # Server startup hook (re-exports from package)
├── middleware.js                       # Auth middleware (re-exports from package)
├── theme.css                          # User-editable theme customization
├── package.json                       # Project dependencies
├── .env                               # API keys and tokens (gitignored)
│
├── app/                               # Next.js app directory (MANAGED — do not edit)
│   ├── api/[...thepopebot]/route.js   # Catch-all API route
│   ├── stream/chat/route.js           # Chat streaming endpoint
│   ├── chat/[chatId]/page.js          # Resume chat
│   ├── chats/page.js                  # Chat history
│   ├── cluster/[clusterId]/page.js    # Cluster view
│   ├── clusters/page.js               # Cluster list
│   ├── code/[codeWorkspaceId]/page.js # Code workspace (xterm.js)
│   ├── mcp/page.js                    # MCP server config
│   ├── settings/crons/page.js         # Cron management
│   ├── settings/triggers/page.js      # Trigger management
│   ├── settings/secrets/page.js       # API key management
│   ├── runners/page.js                # Job queue monitor
│   ├── pull-requests/page.js          # PR status
│   ├── notifications/page.js          # Notifications
│   └── login/page.js                  # Authentication
│
├── config/                            # Agent configuration (USER-EDITABLE)
│   ├── SOUL.md                        # Personality, identity, values
│   ├── JOB_PLANNING.md                # Event handler LLM system prompt
│   ├── CODE_PLANNING.md               # Code workspace agent system prompt
│   ├── JOB_AGENT.md                   # Agent runtime environment docs
│   ├── JOB_SUMMARY.md                 # Prompt for summarizing completed jobs
│   ├── HEARTBEAT.md                   # Self-monitoring behavior
│   ├── CLUSTER_SYSTEM_PROMPT.md       # System prompt for cluster workers
│   ├── CLUSTER_ROLE_PROMPT.md         # Default prompt for cluster roles
│   ├── PATTERN_GUIDE.md              # 6 canonical automation patterns
│   ├── SKILL_BUILDING_GUIDE.md        # Guide for building new skills
│   ├── MCP_SERVERS.json               # Active MCP server definitions
│   ├── CRONS.json                     # Scheduled job definitions
│   └── TRIGGERS.json                  # Webhook trigger definitions
│
├── Clusters/                          # thepopebot package source (local dev)
│   ├── package.json                   # Package manifest (thepopebot)
│   ├── api/index.js                   # API route handler
│   ├── drizzle/                       # Database migrations
│   │   ├── *.sql                      # Migration files
│   │   └── meta/                      # Migration metadata
│   └── lib/                           # Core library
│       ├── paths.js                   # Central path resolver
│       ├── actions.js                 # Action dispatch (agent/command/webhook)
│       ├── ai/
│       │   ├── agent.js               # LangGraph agent definitions
│       │   ├── mcp-bridge.js          # MCP tool loader
│       │   └── headless-stream.js     # Docker stream parser
│       ├── chat/
│       │   ├── api.js                 # /stream/chat endpoint
│       │   ├── actions.js             # Chat server actions
│       │   └── components/            # React UI components (JSX)
│       ├── cluster/
│       │   ├── actions.js             # Cluster CRUD server actions
│       │   ├── execute.js             # Docker container lifecycle
│       │   ├── runtime.js             # Trigger scheduler (cron, chokidar)
│       │   ├── stream.js              # SSE live console streaming
│       │   └── components/            # Cluster UI components
│       ├── channels/
│       │   ├── index.js               # Channel abstraction
│       │   ├── telegram.js            # Telegram adapter
│       │   └── slack.js               # Slack adapter
│       ├── db/
│       │   ├── schema.js              # Drizzle ORM table definitions
│       │   ├── clusters.js            # Cluster DB queries
│       │   └── index.js               # DB initialization + migration
│       └── tools/
│           ├── create-job.js          # Job creation tool
│           ├── docker.js              # Docker container management
│           ├── github.js              # GitHub API operations
│           ├── telegram.js            # Telegram bot
│           ├── slack.js               # Slack integration
│           └── openai.js              # Whisper voice-to-text
│
├── skills/                            # Agent skill plugins
│   ├── active/                        # Symlinks to enabled skills
│   │   ├── brave-search → ../brave-search/
│   │   ├── youtube-transcript → ../youtube-transcript/
│   │   ├── notebooklm → ../notebooklm/
│   │   ├── sop-generator → ../sop-generator/
│   │   └── browser-tools → (browser automation)
│   ├── brave-search/                  # Brave Search API
│   ├── youtube-transcript/            # YouTube transcript fetcher
│   ├── notebooklm/                    # Google NotebookLM
│   └── sop-generator/                 # HTML document generator
│
├── .pi/skills → skills/active         # Pi agent reads skills from here
├── .claude/skills → skills/active     # Claude Code reads skills from here
│
├── mcp-servers/                       # MCP (Model Context Protocol) servers
│   └── builtwith/                     # Technology profiling API
│
├── cron/                              # Command-type cron scripts
│   └── lib/                           # Shared cron utilities
│
├── triggers/                          # Command-type trigger scripts
│
├── docker/                            # Docker images (MANAGED)
│   ├── event-handler/                 # Traefik-fronted Next.js
│   ├── pi-coding-agent-job/           # Pi autonomous agent
│   ├── claude-code-job/               # Claude Code headless
│   ├── claude-code-workspace/         # Interactive terminal
│   └── claude-code-cluster-worker/    # Cluster worker container
│
├── .github/workflows/                 # GitHub Actions (MANAGED)
│   ├── run-job.yml                    # Execute Docker agent jobs
│   ├── auto-merge.yml                 # Auto-merge job PRs
│   ├── notify-pr-complete.yml         # Job completion notification
│   ├── notify-job-failed.yml          # Job failure notification
│   ├── rebuild-event-handler.yml      # Rebuild on push to main
│   └── upgrade-event-handler.yml      # Upgrade thepopebot package
│
├── references/                        # Reference materials
│   ├── SOP Templates/                 # HTML templates + brand system
│   ├── MCP-Platform-main/            # MCP platform reference code
│   ├── Youtube Summaries/             # Generated video summaries
│   ├── Youtube Transcripts/           # Raw transcripts
│   ├── logos/                         # Brand assets
│   └── reports/                       # Generated reports
│
├── logs/                              # Per-job output (logs/{JOB_ID}/)
├── data/                              # SQLite database + cluster data
└── docs/                              # This documentation
```

## Managed vs User-Editable

### MANAGED (auto-synced by `thepopebot init` / `thepopebot upgrade` — do NOT edit)

| Path | Reason |
|------|--------|
| `app/` | Thin page shells importing from npm package |
| `.github/workflows/` | CI/CD pipelines |
| `docker/event-handler/` | Event handler Docker config |
| `docker/pi-coding-agent-job/` | Pi agent Docker config |
| `docker/claude-code-*` | Claude Code Docker configs |
| `docker-compose.yml` | Docker orchestration |
| `.dockerignore` | Docker ignore rules |
| `CLAUDE.md` | AI assistant context file |

### USER-EDITABLE (safe to modify)

| Path | Purpose |
|------|---------|
| `config/` | All prompts, cron jobs, triggers, personality |
| `skills/` | Add/activate/deactivate skills |
| `cron/` | Command-type cron scripts |
| `triggers/` | Command-type trigger scripts |
| `mcp-servers/` | MCP server definitions |
| `theme.css` | Visual theme customization |
| `.env` | API keys and secrets |
| `references/` | Reference materials and templates |
| `docs/` | This documentation |
