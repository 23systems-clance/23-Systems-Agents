# lib/db/ — Database (SQLite + Drizzle ORM)

## Column Naming Convention

Drizzle schema uses camelCase JS property names mapped to snake_case SQL columns.
Example: `createdAt: integer('created_at')` — use `createdAt` in JS code, SQL column is `created_at`.

## Migration Workflow

Edit `lib/db/schema.js` → `npm run db:generate` → review generated SQL in `drizzle/` → commit both schema change and migration file. Migrations auto-apply on startup via `migrate()` in `initDatabase()`.

Key files: `schema.js` (source of truth), `drizzle/` (generated migrations), `drizzle.config.js` (Drizzle Kit config), `index.js` (`initDatabase()` calls `migrate()`).

## CRUD Patterns

- Import `getDb()` from `./index.js`
- Functions are synchronous (better-sqlite3 driver)
- Primary keys: `crypto.randomUUID()`
- Timestamps: `Date.now()` (epoch milliseconds)

## Tables

| Table | Purpose |
|-------|---------|
| `users` | Admin accounts (email, bcrypt password hash, role) |
| `chats` | Chat sessions (user_id, title, starred, code_workspace_id, timestamps) |
| `messages` | Chat messages (chat_id, role, content) |
| `code_workspaces` | Code workspace containers (user_id, container_name, repo, branch, coding_agent, starred) |
| `notifications` | Job completion notifications (notification text, payload, read status) |
| `subscriptions` | Channel subscriptions (platform, channel_id) |
| `clusters` | Worker clusters (user_id, name, system_prompt, folders, enabled, starred) |
| `cluster_roles` | Role definitions scoped to a cluster (cluster_id, role_name, role, trigger_config, max_concurrency, cleanup_worker_dir, folders) |
| `settings` | Key-value configuration store (also stores API keys via type/key/value) |
