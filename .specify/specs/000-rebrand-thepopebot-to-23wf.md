# Spec 000: Rebrand thepopebot to 23WF

**Status:** Draft
**Priority:** P0 (Critical)
**Estimated Effort:** 40 hours
**Dependencies:** thepopebot package fork or upstream rename

---

## Overview

Remove all references to "thepopebot", "popebot", "pope", and the `tpb_` prefix across the codebase. Replace with "23WF" (23 Systems Workforce) branding. This covers user-editable files, managed files, Docker images, GitHub Actions, API key prefixes, environment variables, and documentation.

## Goals

1. **Eliminate all thepopebot branding** from code, config, docs, CLI output, and Docker artifacts
2. **Replace with 23WF branding** consistently across all layers
3. **Maintain functional equivalence** — no behavior changes, only naming
4. **Update API key prefix** from `tpb_` to `23wf_`

## Non-Goals

- Changing application architecture or features
- Renaming internal database column names (snake_case schema stays)
- Renaming third-party dependencies unrelated to thepopebot

---

## Audit Results

### Naming Map

| Old Term | New Term | Context |
|----------|----------|---------|
| `thepopebot` | `23wf` | Package name, imports, CLI commands, container names |
| `thepopebot` (display) | `23 Systems Workforce` | User-facing UI text, documentation prose |
| `withThepopebot` | `with23WF` | Next.js config wrapper function |
| `tpb_` | `23wf_` | API key prefix |
| `THEPOPEBOT_VERSION` | `WF_VERSION` | Environment variable |
| `thepopebot.sqlite` | `23wf.sqlite` | Database filename |
| `stephengpope/thepopebot` | `23systems/23wf` | Docker image registry |
| `thepopebot/` (import path) | `23wf/` (import path) | All JS/JSX imports |

### Files Requiring Changes

#### Layer 1: User-Editable Files (change directly)

| File | References | Change Description |
|------|-----------|-------------------|
| `CLAUDE.md` | ~30 refs | Replace all "thepopebot" with "23wf" in docs, paths, examples |
| `package.json` | 4 refs | Rename dependency, update script commands |
| `next.config.mjs` | 2 refs | `import { with23WF } from '23wf/config'` |
| `instrumentation.js` | 1 ref | `import('23wf/instrumentation')` |
| `middleware.js` | 1 ref | `from '23wf/middleware'` |
| `server.js` | 1 ref | `from '23wf/code/ws-proxy'` |
| `.env` | 2 refs | Rename comment and `THEPOPEBOT_VERSION` |
| `.env.example` | 3 refs | Same as .env |
| `config/JOB_PLANNING.md` | Check | Any thepopebot references in prompts |
| `config/JOB_AGENT.md` | Check | Any thepopebot references in prompts |
| `config/SOUL.md` | Check | Any thepopebot references in identity |

#### Layer 2: Managed Files — App Routes (requires package fork)

These files are auto-synced by the package. Editing them directly will be overwritten on upgrade.

| Directory | Files | Import Pattern |
|-----------|-------|---------------|
| `app/api/[...thepopebot]/` | `route.js` | Directory name + import from `thepopebot/api` |
| `app/api/auth/` | `route.js` | `from 'thepopebot/auth'` |
| `app/login/` | `page.js` | `from 'thepopebot/auth'`, `thepopebot/auth/components` |
| `app/layout.js` | 1 file | `from 'thepopebot/chat'` |
| `app/page.js` | 1 file | `from 'thepopebot/auth'` |
| `app/settings/` | 4 files | `from 'thepopebot/chat'` |
| `app/chat/` | 2 files | `from 'thepopebot/chat'`, `thepopebot/chat/api` |
| `app/chats/` | 1 file | `from 'thepopebot/chat'` |
| `app/runners/` | 1 file | `from 'thepopebot/chat'` |
| `app/notifications/` | 1 file | `from 'thepopebot/chat'` |
| `app/pull-requests/` | 1 file | `from 'thepopebot/chat'` |
| `app/clusters/` | 1 file | `from 'thepopebot/cluster'` |
| `app/cluster/` | 3 files | `from 'thepopebot/cluster'`, `thepopebot/cluster/stream` |
| `app/code/` | 1 file | `from 'thepopebot/code'` |
| `app/mcp/` | 1 file | `from 'thepopebot/chat'` |
| `app/stream/` | 2 files | `from 'thepopebot/chat/api'`, `thepopebot/cluster/stream` |
| `app/team/` | portal files | `from 'thepopebot/...'` if any |

**Total: ~25 managed app files with thepopebot imports**

#### Layer 3: Managed Files — Infrastructure (requires package fork)

| File | References | Change Description |
|------|-----------|-------------------|
| `docker-compose.yml` | 2 refs | Container name, image URL |
| `docker/event-handler/Dockerfile` | 1 ref | npm install command |
| `.github/workflows/run-job.yml` | 5 refs | Version detection, image refs, job names |
| `.github/workflows/upgrade-event-handler.yml` | 11 refs | CLI commands, git config, npm commands |
| `.github/workflows/rebuild-event-handler.yml` | 15 refs | Container exec, version detection, init |
| `.github/workflows/auto-merge.yml` | Check | Any references |
| `.github/workflows/notify-pr-complete.yml` | Check | Any references |
| `.github/workflows/notify-job-failed.yml` | Check | Any references |

#### Layer 4: Clusters Package (requires package fork)

| File | References | Change Description |
|------|-----------|-------------------|
| `Clusters/package.json` | 2 refs | Package name and version |
| `Clusters/bin/cli.js` | 60+ refs | CLI command name, help text, all output |
| `Clusters/bin/postinstall.js` | 5 refs | Project detection logic |
| `Clusters/bin/sync.js` | 5 refs | Image tags, dev package name |
| `Clusters/bin/docker-build.js` | refs | Docker image tag references |
| `Clusters/templates/` | Many | Workflow and Dockerfile templates |

#### Layer 5: API Key Prefix (requires package fork + DB migration)

| File | Location | Change |
|------|----------|--------|
| `Clusters/lib/db/api-keys.js` | Line 6 | `const KEY_PREFIX = 'tpb_'` -> `'23wf_'` |
| `node_modules/thepopebot/lib/db/api-keys.js` | Same | Package source |

**Migration concern:** Existing API keys with `tpb_` prefix must remain valid during transition. Add dual-prefix support or run a one-time key migration.

---

## Requirements

### Functional Requirements

#### FR-1: Fork thepopebot Package
**Priority:** P0

The thepopebot npm package must be forked or the upstream must be renamed, since:
- All `app/` routes import from `'thepopebot/*'`
- All managed files reference the package by name
- CLI commands use `thepopebot` as the binary name
- Docker images are published under `stephengpope/thepopebot`

**Options:**
| Option | Pros | Cons |
|--------|------|------|
| **A: Fork to `23wf` npm package** | Full control, clean naming | Maintenance burden, diverges from upstream |
| **B: npm alias** (`"23wf": "npm:thepopebot@^1.2.73"`) | Quick, stays on upstream | Imports still say `thepopebot/*` internally |
| **C: Request upstream rename** | Cleanest long-term | Depends on upstream maintainer |
| **D: Wrapper package** | Thin re-export layer | Extra indirection, still has thepopebot underneath |

**Recommendation:** Option A (fork) for full control, or Option B (alias) as a quick interim step while pursuing Option C.

#### FR-2: Rename User-Editable Files
**Priority:** P0

Update all user-editable files listed in Layer 1 above. These can be changed immediately without a package fork.

#### FR-3: Update Managed App Routes
**Priority:** P1 (blocked on FR-1)

After package fork/rename:
- Rename `app/api/[...thepopebot]/` directory to `app/api/[...23wf]/`
- Update all imports from `'thepopebot/*'` to `'23wf/*'`
- Disable auto-sync or update sync logic to use new package name

#### FR-4: Update Infrastructure Files
**Priority:** P1 (blocked on FR-1)

After package fork/rename:
- Update `docker-compose.yml` container name and image references
- Update all GitHub Actions workflows
- Update Docker image registry from `stephengpope/thepopebot` to `23systems/23wf`
- Publish Docker images under new registry

#### FR-5: Migrate API Key Prefix
**Priority:** P2

- Change `KEY_PREFIX` from `'tpb_'` to `'23wf_'`
- Add migration: validate keys with either prefix during transition period
- After transition: generate new keys with `23wf_` prefix only
- Document migration timeline for API consumers

#### FR-6: Rename Database File
**Priority:** P2

- Rename `data/thepopebot.sqlite` to `data/23wf.sqlite`
- Update `DATABASE_PATH` default in package
- Add startup migration: if old path exists and new doesn't, rename automatically

#### FR-7: Update Environment Variables
**Priority:** P1

| Old Variable | New Variable |
|-------------|-------------|
| `THEPOPEBOT_VERSION` | `WF_VERSION` |

- Support both old and new variable names during transition (fallback logic)
- Update `.env`, `.env.example`, and all workflow references

#### FR-8: Update Documentation
**Priority:** P1

- Rewrite `CLAUDE.md` with all 23WF terminology
- Update `docs/` directory references
- Update `.specify/CONSTITUTION.md` naming conventions section (remove thepopebot translation table, as it will no longer be needed)
- Update any skill documentation referencing the package

### Non-Functional Requirements

#### NFR-1: Zero Downtime
All changes must be deployable without service interruption. Dual-support (old + new names) during migration window.

#### NFR-2: Backwards Compatibility Window
Existing API keys (`tpb_` prefix) must work for at least 30 days after migration.

---

## Implementation Phases

### Phase 1: Immediate (no package fork needed)
1. Update `CLAUDE.md` — replace all thepopebot references
2. Update `.env` and `.env.example` comments
3. Update `config/*.md` files if they reference thepopebot
4. Update `.specify/CONSTITUTION.md` naming section

### Phase 2: Package Fork
1. Fork `thepopebot` to `23wf` (or set up npm alias)
2. Global find-replace in forked package source
3. Rename exported functions (`withThepopebot` -> `with23WF`)
4. Rename CLI binary
5. Publish to npm / private registry

### Phase 3: Codebase Migration (after fork)
1. Update `package.json` dependency
2. Update all imports in `app/` routes
3. Rename `app/api/[...thepopebot]/` directory
4. Update `next.config.mjs`, `instrumentation.js`, `middleware.js`, `server.js`
5. Update `docker-compose.yml` and Dockerfiles
6. Update all GitHub Actions workflows

### Phase 4: Data Migration
1. Migrate API key prefix (dual-support first)
2. Rename SQLite database file
3. Update `THEPOPEBOT_VERSION` env var to `WF_VERSION`

### Phase 5: Cleanup
1. Remove dual-prefix API key support after 30-day window
2. Remove old env var fallbacks
3. Final audit — grep for any remaining references
4. Update Docker image registry references

---

## Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Upstream package updates break fork | Can't pull updates easily | Pin version, cherry-pick critical fixes |
| Existing API keys stop working | API consumers break | 30-day dual-prefix support |
| Managed file sync overwrites changes | Reverts to thepopebot naming | Disable sync or update sync source |
| Database rename fails on locked DB | Data loss | Rename only at startup, backup first |
| Docker image registry migration | Existing deployments pull old images | Keep old images available, update refs gradually |

---

## Test Plan

- [ ] `grep -ri "thepopebot\|popebot\|tpb_" --include="*.{js,jsx,ts,tsx,json,md,yml,yaml,mjs,env}" .` returns zero matches (excluding node_modules)
- [ ] Application starts without errors after all renames
- [ ] API keys generated with `23wf_` prefix validate correctly
- [ ] Existing `tpb_` keys still validate (during transition)
- [ ] Docker containers build and run with new image names
- [ ] GitHub Actions workflows execute successfully
- [ ] Web UI loads with no broken imports
- [ ] Chat, crons, triggers, and jobs function normally
- [ ] Database migrates from old filename seamlessly

---

**Document Owner:** 23 Systems
**Created:** 2026-03-20
**Status:** Draft
