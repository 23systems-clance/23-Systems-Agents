# 03 — Database Schema

## Overview

- **Engine**: SQLite via Drizzle ORM
- **Location**: `data/23wf.sqlite` (override via `DATABASE_PATH` env var)
- **Initialization**: Auto-created and auto-migrated on server startup
- **Schema source**: `Clusters/lib/db/schema.js`
- **Migrations**: `Clusters/drizzle/*.sql`
- **Column naming**: camelCase in JS → snake_case in SQL

## Tables

### `users`

Admin accounts created via the login page (first visit creates admin).

| Column | Type | Notes |
|--------|------|-------|
| `id` | TEXT (UUID) | Primary key, auto-generated |
| `email` | TEXT | Unique, not null |
| `password` | TEXT | bcrypt hash, not null |
| `name` | TEXT | Display name |
| `role` | TEXT | Default: `'admin'` |
| `created_at` | TEXT | ISO timestamp |
| `updated_at` | TEXT | ISO timestamp |

### `chats`

Chat sessions tied to users.

| Column | Type | Notes |
|--------|------|-------|
| `id` | TEXT (UUID) | Primary key |
| `user_id` | TEXT | FK → users.id |
| `title` | TEXT | Chat title (auto-generated or user-set) |
| `starred` | INTEGER | Boolean (0/1), default 0 |
| `code_workspace_id` | TEXT | FK → code_workspaces.id (optional) |
| `created_at` | TEXT | ISO timestamp |
| `updated_at` | TEXT | ISO timestamp |

### `messages`

Individual messages within chats.

| Column | Type | Notes |
|--------|------|-------|
| `id` | TEXT (UUID) | Primary key |
| `chat_id` | TEXT | FK → chats.id |
| `role` | TEXT | `'user'`, `'assistant'`, or `'system'` |
| `content` | TEXT | Message content (may include tool calls as JSON) |
| `created_at` | TEXT | ISO timestamp |

### `code_workspaces`

Interactive Docker-based code environments with xterm.js terminals.

| Column | Type | Notes |
|--------|------|-------|
| `id` | TEXT (UUID) | Primary key |
| `user_id` | TEXT | FK → users.id |
| `name` | TEXT | Display name |
| `container_name` | TEXT | Docker container name |
| `repo` | TEXT | GitHub repository (owner/repo) |
| `branch` | TEXT | Git branch |
| `agent_backend` | TEXT | `'claude-code'` etc. |
| `starred` | INTEGER | Boolean (0/1) |
| `created_at` | TEXT | ISO timestamp |
| `updated_at` | TEXT | ISO timestamp |

### `notifications`

Job completion/failure notifications displayed in the web UI.

| Column | Type | Notes |
|--------|------|-------|
| `id` | TEXT (UUID) | Primary key |
| `notification` | TEXT | Human-readable notification text |
| `payload` | TEXT | JSON payload with job details |
| `read` | INTEGER | Boolean (0/1), default 0 |
| `created_at` | TEXT | ISO timestamp |

### `subscriptions`

Channel subscriptions for multi-platform notifications.

| Column | Type | Notes |
|--------|------|-------|
| `id` | TEXT (UUID) | Primary key |
| `platform` | TEXT | `'telegram'` or `'slack'` |
| `channel_id` | TEXT | Platform-specific channel ID |
| `metadata` | TEXT | JSON metadata |
| `created_at` | TEXT | ISO timestamp |

### `clusters`

Agent cluster definitions — groups of role-based Docker containers.

| Column | Type | Notes |
|--------|------|-------|
| `id` | TEXT (UUID) | Primary key |
| `name` | TEXT | Cluster display name |
| `system_prompt` | TEXT | System prompt for all workers in this cluster |
| `folders` | TEXT | JSON array of folder paths |
| `enabled` | INTEGER | Boolean (0/1), default 1 |
| `starred` | INTEGER | Boolean (0/1), default 0 |
| `created_at` | TEXT | ISO timestamp |
| `updated_at` | TEXT | ISO timestamp |

### `cluster_roles`

Role definitions within a cluster, each with its own trigger configuration.

| Column | Type | Notes |
|--------|------|-------|
| `id` | TEXT (UUID) | Primary key |
| `cluster_id` | TEXT | FK → clusters.id |
| `role_name` | TEXT | Display name for this role |
| `role` | TEXT | Role description / instructions |
| `prompt` | TEXT | Task prompt (default: "Execute your role.") |
| `trigger_config` | TEXT | JSON: `{ type, cron?, file_watch?, webhook? }` |
| `max_concurrency` | INTEGER | Max simultaneous containers, default 1 |
| `folders` | TEXT | JSON array of folder paths for this role |
| `mcp_servers` | TEXT | JSON array of MCP server names |
| `created_at` | TEXT | ISO timestamp |
| `updated_at` | TEXT | ISO timestamp |

### `settings`

Generic key-value store. Also stores hashed API keys.

| Column | Type | Notes |
|--------|------|-------|
| `id` | TEXT (UUID) | Primary key |
| `key` | TEXT | Setting key (unique) |
| `value` | TEXT | Setting value (API keys are SHA-256 hashed) |
| `created_at` | TEXT | ISO timestamp |

## Migration Workflow

1. Edit `Clusters/lib/db/schema.js` (Drizzle table definitions)
2. Run `npm run db:generate` to create migration SQL
3. Review generated file in `Clusters/drizzle/`
4. Commit both the schema change and migration file
5. Migration auto-applies at server startup via `migrate()` in `initDatabase()`

## Relationships

```
users ──┬── chats ──── messages
        └── code_workspaces

clusters ──── cluster_roles

notifications (standalone)
subscriptions (standalone)
settings (key-value store)
```
