# Spec 005: Rebrand Verification — Full Application Walkthrough

**Status:** Draft
**Priority:** P0 (Critical — blocks open-source readiness)
**Estimated Effort:** 8 hours
**Dependencies:** Spec 000 Phase 1 + Phase 2 (complete)
**Branch:** `rebrand`

---

## Overview

Comprehensive verification that the thepopebot → 23WF rebrand and skills → specialties rename are complete, correct, and functional across every page, workflow, API endpoint, and Docker artifact. This spec exists because bulk find-replace can introduce subtle breakage (invalid JS identifiers, missing exports, broken Docker builds, stale caches).

## Goals

1. **Verify zero remaining thepopebot/popebot/tpb_ references** in all shipped files
2. **Verify every UI page renders** without errors
3. **Verify every API endpoint responds** correctly
4. **Verify Docker builds succeed** with renamed images
5. **Verify GitHub Actions workflows** reference correct image tags and env vars
6. **Verify the Clusters/ package** builds, lints, and could publish as `23wf`
7. **Document any pre-existing issues** found during verification (separate from rebrand bugs)

## Non-Goals

- Fixing pre-existing bugs unrelated to the rebrand
- Publishing the `23wf` package to npm (separate task)
- Setting up the `23systems` Docker registry (separate task)

---

## Verification Checklist

### Phase 1: Static Analysis (no server needed)

#### 1.1 — Grep Audit
- [ ] `grep -ri "thepopebot\|popebot\|tpb_\|stephengpope" --include="*.{js,jsx,mjs,json,md,yml,yaml,css,html,template,sh}" .` returns zero matches (excluding: `Clusters/CHANGELOG.md`, `.specify/specs/000-*`, `package-lock.json`, `.claude/settings*`, `node_modules/`, `.next/`, `.git/`)
- [ ] No JS files contain `23wfDb`, `23wfPkg`, `23wfDep` (mangled variable names — should be `wfDb`, `wfPkg`, `wfDep`)
- [ ] No JS files contain `deps.23wf` or `devDeps.23wf` (must use bracket notation: `deps['23wf']`)
- [ ] No JS object literals contain unquoted `23wf:` keys (must be `'23wf':`)
- [ ] All `import ... from '23wf/...'` paths resolve correctly

#### 1.2 — Package.json Integrity
- [ ] Root `package.json`: `"23wf": "file:./Clusters"` (local dev) or published version
- [ ] `Clusters/package.json`: `"name": "23wf"`, `"bin": { "23wf": "./bin/cli.js" }`
- [ ] All `exports` paths in Clusters/package.json resolve to existing files
- [ ] `npm ls 23wf` resolves without errors

#### 1.3 — Clusters/ Package Build
- [ ] `cd Clusters && npm run build` succeeds (esbuild JSX compilation)
- [ ] `cd Clusters && node bin/cli.js --help` shows `23wf` branding in usage text
- [ ] `cd Clusters && node -e "import('./config/index.js').then(m => console.log(typeof m.with23WF))"` prints `function`

### Phase 2: Build & Dev Server

#### 2.1 — Next.js Build
- [ ] `npm run build` compiles successfully (note: `/_not-found` static generation error is pre-existing, not rebrand-related)
- [ ] No webpack errors mentioning `thepopebot`, missing modules, or invalid identifiers
- [ ] Build output in `.next/` contains only `23wf` references (no `thepopebot` in chunk filenames)

#### 2.2 — Dev Server Startup
- [ ] `npm run dev` starts without errors
- [ ] Console output shows `23wf initialized` (not `thepobebot initialized`)
- [ ] Cron jobs load from `config/CRONS.json`
- [ ] Cluster runtime starts
- [ ] No import resolution errors in terminal

### Phase 3: UI Page Walkthrough

Test each page loads without rendering errors. Check browser console for import failures or undefined component errors.

| Route | What to Verify |
|-------|---------------|
| `/login` | Login page renders, form works |
| `/` | Chat page renders after login |
| `/chats` | Chat history list renders |
| `/chat/[chatId]` | Individual chat loads and streams |
| `/settings/crons` | Cron management page renders |
| `/settings/triggers` | Trigger management page renders |
| `/settings/secrets` | API key management renders, key prefix shows `23wf_` |
| `/runners` | Job runner status page renders |
| `/notifications` | Notification list renders |
| `/pull-requests` | PR list renders |
| `/clusters` | Cluster list renders |
| `/cluster/[id]` | Cluster detail page renders |
| `/cluster/[id]/logs` | Cluster logs render |
| `/cluster/[id]/console` | Console view renders |
| `/code/[id]` | Code workspace renders |
| `/mcp` | MCP server page renders |
| `/team/new` | Team creation wizard renders |
| `/teams` | Team list renders |
| `/team/[id]` | Team dashboard renders |
| `/team/[id]/history` | Team run history renders |
| `/account` | Account page renders |
| `/templates` | Templates page renders |

#### 3.1 — Specialties Rename Verification
- [ ] No user-facing text says "skill" or "skills" (should say "specialty" / "specialties")
- [ ] Skill building guide page references specialties in headings/descriptions
- [ ] Chat agent tool descriptions use specialties terminology

### Phase 4: API Endpoints

| Endpoint | Method | Auth | Verify |
|----------|--------|------|--------|
| `/api/ping` | GET | None | Returns 200 |
| `/api/create-job` | POST | `x-api-key` | Accepts `23wf_` prefixed keys |
| `/api/jobs/status` | GET | `x-api-key` | Returns job status |
| `/api/telegram/webhook` | POST | Secret | Accepts messages |
| `/api/github/webhook` | POST | Secret | Processes notifications |
| `/stream/chat` | POST | Session | Chat streaming works |

#### 4.1 — API Key Lifecycle
- [ ] Generate new API key → prefix is `23wf_` (not `tpb_`)
- [ ] New key validates successfully via `x-api-key` header
- [ ] Key prefix shown in Settings > Secrets starts with `23wf_`

### Phase 5: Docker & Infrastructure

#### 5.1 — Docker Compose
- [ ] `docker-compose.yml` references `23wf-event-handler` container name
- [ ] Image tags reference `23systems/23wf` registry
- [ ] `WF_VERSION` env var (not `THEPOPEBOT_VERSION`)

#### 5.2 — Docker Build
- [ ] `docker build -f docker/event-handler/Dockerfile .` succeeds
- [ ] Container starts and serves the application
- [ ] Container name in `docker ps` shows `23wf-event-handler`

#### 5.3 — GitHub Actions Workflows
- [ ] `run-job.yml` — references `WF_VERSION`, `23systems/23wf` image
- [ ] `rebuild-event-handler.yml` — references `23wf-event-handler`, correct npm commands
- [ ] `upgrade-event-handler.yml` — git config, npm commands, PR title all use 23wf
- [ ] `auto-merge.yml` — no thepopebot references
- [ ] `notify-pr-complete.yml` — no thepopebot references
- [ ] `notify-job-failed.yml` — no thepopebot references

### Phase 6: Database & Data

- [ ] New installations create `data/23wf.sqlite` (not `data/thepopebot.sqlite`)
- [ ] Existing `data/thepopebot.sqlite` still works if `DATABASE_PATH` is set (backward compat)
- [ ] Drizzle migrations resolve from `node_modules/23wf/drizzle/`

### Phase 7: CLI Commands

- [ ] `npx 23wf --help` shows correct branding
- [ ] `npx 23wf init` scaffolds a project with 23wf references
- [ ] `npx 23wf setup` runs interactive setup
- [ ] `npx 23wf diff` shows managed file differences
- [ ] `npx 23wf upgrade` resolves from npm (once published)

---

## Known Pre-Existing Issues (Not Rebrand Bugs)

| Issue | Description | Impact |
|-------|-------------|--------|
| `FeaturesProvider` undefined | `app/layout.js` imports `FeaturesProvider` from `23wf/chat` but it's not exported | `/_not-found` static generation fails during `next build` |
| Edge runtime warning | `jose` library uses `DecompressionStream` not supported in Edge | Warning only, non-blocking |

---

## Test Plan

- [ ] All Phase 1 static checks pass
- [ ] Dev server starts and all pages render
- [ ] API key generation produces `23wf_` prefix
- [ ] Docker containers build and run
- [ ] No console errors referencing thepopebot/popebot
- [ ] Specialties terminology used consistently in UI

---

**Document Owner:** 23 Systems
**Created:** 2026-03-20
**Status:** Draft
