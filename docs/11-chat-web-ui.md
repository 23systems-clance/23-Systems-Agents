# 11 — Chat & Web UI

## Overview

The web interface is built with Next.js 15 + React 19. All UI components live in the `thepopebot` npm package — the `app/` directory contains only thin page shells that import from the package.

## Web Routes

| Route | Page | Purpose |
|-------|------|---------|
| `/` | ChatPage | Main chat interface (new conversation) |
| `/chat/[chatId]` | Chat | Resume existing conversation |
| `/chats` | ChatsPage | Chat history list |
| `/code/[codeWorkspaceId]` | CodePage | Interactive code workspace (xterm.js terminal) |
| `/cluster/[clusterId]` | ClusterPage | View cluster roles and controls |
| `/cluster/[clusterId]/logs` | ClusterLogsPage | Live worker execution logs |
| `/clusters` | ClustersPage | List all worker clusters |
| `/mcp` | MCPServersPage | MCP server configuration |
| `/settings/crons` | CronsPage | Manage scheduled cron jobs |
| `/settings/triggers` | TriggersPage | Manage webhook triggers |
| `/settings/secrets` | SettingsSecretsPage | API key management |
| `/runners` | RunnersPage | Job queue and active runner monitor |
| `/pull-requests` | PullRequestsPage | PR status and history |
| `/notifications` | NotificationsPage | Job completion notifications |
| `/login` | LoginPage | Authentication (first visit creates admin) |

## Chat System Architecture

### Message Flow

```
User types message in ChatInput
    ↓
POST /stream/chat (with session cookie)
    ↓
lib/chat/api.js validates session
    ↓
Message saved to DB (messages table)
    ↓
LangGraph agent processes (Job Agent or Code Agent)
    ↓
SSE stream returns events:
  - text (assistant response chunks)
  - tool-call (tool invocations)
  - tool-result (tool outputs)
  - done (stream complete)
    ↓
React component renders incrementally
    ↓
Final message saved to DB
```

### Chat Components

Located in `Clusters/lib/chat/components/`:

| Component | Purpose |
|-----------|---------|
| ChatPage | Main page layout with greeting/chat toggle |
| ChatInput | Message input with submit handling |
| ChatHeader | Top bar with chat title and controls |
| Messages | Message list with auto-scroll |
| Greeting | Welcome screen for new conversations |
| Markdown renderer | Renders assistant responses with embedded tool calls |
| Settings MCP Page | MCP server configuration UI |

### Server Actions (`lib/chat/actions.js`)

| Action | Purpose |
|--------|---------|
| `getChats()` | List user's chat sessions |
| `getChat(chatId)` | Get single chat with messages |
| `createChat()` | Start new conversation |
| `renameChat()` | Update chat title |
| `deleteChat()` | Remove chat and messages |
| `starChat()` | Toggle starred status |

All actions use `requireAuth()` for session validation and ownership checks.

## Theme Customization

Edit `theme.css` in the project root to customize the web UI appearance. This file is loaded after `globals.css` and is user-owned (not managed/auto-synced).

## Code Workspaces

Interactive Docker-based terminal environments accessible at `/code/[id]`:

1. xterm.js frontend connects via WebSocket
2. `server.js` WebSocket proxy authenticates via JWT cookie
3. Proxied to Docker container running `ttyd` on port 7681
4. Full terminal access to Claude Code or other agents

### Server Actions (`lib/code/actions.js`)

| Action | Purpose |
|--------|---------|
| `getCodeWorkspaces()` | List user's workspaces |
| `createCodeWorkspace()` | Spawn new container |
| `renameCodeWorkspace()` | Update name |
| `starCodeWorkspace()` | Toggle starred |
| `deleteCodeWorkspace()` | Remove workspace + container |
| `ensureCodeWorkspaceContainer()` | Recover stopped/dead containers |
