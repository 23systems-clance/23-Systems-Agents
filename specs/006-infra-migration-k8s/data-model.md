# Data Model: Spec 006 — Infrastructure Migration

**Date**: 2026-03-21
**Spec**: [006-infra-migration-k8s.md](./006-infra-migration-k8s.md)

## Database Migration: SQLite → Postgres

### Existing Tables (migrate as-is, change dialect)

| Table | Purpose | Migration Notes |
|-------|---------|-----------------|
| `users` | Auth accounts | No schema change, change `integer` PKs to keep compat |
| `chats` | Chat sessions | No schema change |
| `messages` | Chat messages | No schema change |
| `notifications` | Job/system notifications | No schema change |
| `subscriptions` | Telegram push subscriptions | No schema change |
| `settings` | Key-value store + API keys | No schema change |
| `clusters` | Team metadata | No schema change |
| `cluster_roles` | Team role definitions | No schema change |
| `codeWorkspaces` | Code workspace sessions (userId, containerName, repo, branch) | No schema change |
| `leads` | Consultation leads (name, email, projectSummary, recommendations) | No schema change |

### New Tables (Phase 0)

#### `jobs` — Job tracking (replaces GitHub branch-based tracking)

```sql
CREATE TABLE jobs (
  id            TEXT PRIMARY KEY,          -- UUID, same as current job ID
  title         TEXT NOT NULL,             -- LLM-generated job title
  prompt        TEXT NOT NULL,             -- Full job description/prompt
  status        TEXT NOT NULL DEFAULT 'queued',  -- queued | active | completed | failed | cancelled
  branch        TEXT,                      -- job/{id} branch name (created on GitHub)
  pr_url        TEXT,                      -- Pull request URL (set after PR creation)
  pr_number     INTEGER,                   -- PR number (for gh CLI operations)
  commit_sha    TEXT,                      -- HEAD SHA of PR branch
  log_sha       TEXT,                      -- SHA of the log commit
  exit_code     INTEGER,                   -- Container exit code (0 = success)
  error         TEXT,                      -- Error message on failure
  merge_result  TEXT,                      -- merged | not_merged | skipped
  changed_files TEXT,                      -- JSON array of changed file paths

  -- Config overrides (from job.config.json or caller)
  llm_provider  TEXT,                      -- Provider override (anthropic, openai, etc.)
  llm_model     TEXT,                      -- Model override
  agent_backend TEXT DEFAULT 'pi',         -- pi | claude-code

  -- Resource tracking
  started_at    INTEGER,                   -- Epoch ms when worker picked up job
  completed_at  INTEGER,                   -- Epoch ms when job finished
  duration_ms   INTEGER,                   -- Total execution time

  -- Blueprint state machine tracking
  current_step  TEXT,                      -- Current step: prepare | spawn | execute | validate | retry | merge | notify
  step_history  TEXT,                      -- JSON array of { step, status, ts } events
  retry_count   INTEGER DEFAULT 0,         -- Number of retries attempted
  validation_errors TEXT,                  -- JSON array of lint/anomaly errors

  -- BullMQ reference
  bullmq_job_id TEXT,                      -- BullMQ internal job ID (for queue operations)

  -- Metadata
  created_at    INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  updated_at    INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE INDEX idx_jobs_status ON jobs(status);
CREATE INDEX idx_jobs_created_at ON jobs(created_at);
```

#### `capabilities` — Capability registry (skills, MCP servers, templates)

```sql
CREATE TABLE capabilities (
  id          TEXT PRIMARY KEY,            -- kebab-case identifier (e.g., 'search-web', 'research-team')
  type        TEXT NOT NULL,               -- skill | mcp_server | agent_template | team_template
  name        TEXT NOT NULL,               -- Human-readable name
  description TEXT,                        -- Description from SKILL.md frontmatter or template
  category    TEXT,                        -- Domain/specialty category (e.g., 'infrastructure', 'compliance')
  version     TEXT DEFAULT '1.0.0',        -- Semver version
  source_path TEXT,                        -- Path relative to project root (e.g., 'skills/search-web/')
  config      TEXT,                        -- JSON blob of capability-specific config
  enabled     INTEGER NOT NULL DEFAULT 1,  -- 0 = disabled, 1 = enabled
  created_at  INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  updated_at  INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE INDEX idx_capabilities_type ON capabilities(type);
CREATE INDEX idx_capabilities_category ON capabilities(category);
```

**Phase 0 notes**: No tenant scoping columns. All capabilities are available to the single tenant. `tenant_capabilities` join table added in Phase 2.

#### `job_capabilities` — Track which capabilities were used per job

```sql
CREATE TABLE job_capabilities (
  id            TEXT PRIMARY KEY,
  job_id        TEXT NOT NULL REFERENCES jobs(id),
  capability_id TEXT NOT NULL REFERENCES capabilities(id),
  tokens_used   INTEGER DEFAULT 0,         -- LLM tokens consumed by this capability
  created_at    INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE INDEX idx_job_capabilities_job ON job_capabilities(job_id);
```

### Phase 2 Tables (deferred — multi-tenant)

#### `tenants` — Tenant management

```sql
CREATE TABLE tenants (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  tier        TEXT NOT NULL DEFAULT 'free', -- free | pro | enterprise
  max_concurrent_jobs INTEGER DEFAULT 2,
  max_job_time_ms     INTEGER DEFAULT 1800000,  -- 30 min
  max_tokens_per_job  INTEGER DEFAULT 100000,
  max_container_memory TEXT DEFAULT '2Gi',
  created_at  INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);
```

#### `tenant_capabilities` — Per-tenant entitlements

```sql
CREATE TABLE tenant_capabilities (
  id            TEXT PRIMARY KEY,
  tenant_id     TEXT NOT NULL REFERENCES tenants(id),
  capability_id TEXT NOT NULL REFERENCES capabilities(id),
  granted_at    INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  UNIQUE(tenant_id, capability_id)
);
```

## Entity Relationship Diagram

```
Phase 0:

  jobs ──────────< job_capabilities >────────── capabilities
   │                                                │
   │ status, step_history,                          │ type, category,
   │ bullmq_job_id                                  │ source_path
   │                                                │
   └── notifications (existing, linked by job_id text match)


Phase 2 additions:

  tenants ──────< tenant_capabilities >────────── capabilities
   │
   │ tier, limits
   │
   └──────────── jobs (add tenant_id FK)
```

## Drizzle ORM Migration Strategy

### Dialect Change

Current: `drizzle-orm/better-sqlite3`
New: `drizzle-orm/node-postgres` (or `drizzle-orm/postgres-js`)

**Files to modify in Clusters/ (package source)**:
- `lib/db/index.js` — change connection from `better-sqlite3` to `postgres`
- `lib/db/schema.js` — change `sqliteTable` to `pgTable`, adjust types
- `drizzle.config.js` — change dialect and connection string

**Migration approach**:
1. Create new Postgres schema with Drizzle `pgTable` definitions
2. Run `drizzle-kit generate` to produce migration SQL
3. Export existing SQLite data as JSON
4. Import into Postgres
5. Update `DATABASE_URL` env var

### Type Mapping

| SQLite | Postgres | Notes |
|--------|----------|-------|
| `text('id')` | `text('id')` | Same |
| `integer('read')` | `integer('read')` | Same |
| `integer('created_at')` | `bigint('created_at')` | Epoch ms needs bigint |
| `sqliteTable` | `pgTable` | Import change |

## Seeding the Capability Registry

On first startup (Phase 0), the system should scan `skills/active/` and `config/templates/` to seed the `capabilities` table:

```javascript
// Pseudocode for capability seeding
async function seedCapabilities(db) {
  // Skills from skills/active/*/SKILL.md
  const skillDirs = glob('skills/active/*/SKILL.md');
  for (const skillMd of skillDirs) {
    const frontmatter = parseFrontmatter(skillMd);
    await db.insert(capabilities).values({
      id: frontmatter.name,
      type: 'skill',
      name: frontmatter.name,
      description: frontmatter.description,
      source_path: path.dirname(skillMd),
    }).onConflictDoUpdate({ target: capabilities.id, set: { description, updated_at } });
  }

  // Team templates from config/templates/*.json
  const templates = glob('config/templates/*.json');
  for (const tmpl of templates) {
    const data = JSON.parse(fs.readFileSync(tmpl));
    await db.insert(capabilities).values({
      id: data.id,
      type: 'team_template',
      name: data.name,
      description: data.description,
      category: data.category,
      source_path: tmpl,
    }).onConflictDoUpdate({ target: capabilities.id, set: { description, category, updated_at } });
  }
}
```

This runs on every server startup (idempotent via upsert) to keep the registry in sync with the filesystem.
