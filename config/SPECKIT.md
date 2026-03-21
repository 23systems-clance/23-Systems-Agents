# Speckit: Teams, Agents & Skills

## The Three Layers

- **Skill** = a repeatable capability or workflow
- **Agent** = an actor that can perform work
- **Team** = a group of agents organized around an outcome/domain

The cleanest way to name them:

- **Skill names** describe what gets done
- **Agent names** describe who does it
- **Team names** describe the broader function or specialty area

```
Specialty / Domain: One-Pagers
 └── Team: One-Pager Team
      ├── Agent: Research Agent
      │    └── Skills: research_brief, extract_key_points
      ├── Agent: Outline Agent
      │    └── Skills: structure_onepager, prioritize_findings
      ├── Agent: Writer Agent
      │    └── Skills: draft_onepager, write_executive_summary
      ├── Agent: Editor Agent
      │    └── Skills: edit_for_clarity, check_tone_consistency
      └── Agent: QA Agent
           └── Skills: validate_sources, check_formatting
```

## Rule of Thumb

If the thing sounds like:

- a **deliverable** -> probably a team/domain
- a **job title** -> probably an agent
- a **verb/process** -> probably a skill

Examples:

| Name | Layer | Why |
|------|-------|-----|
| One-Pagers | Domain/specialty | It's an outcome area |
| One-Pager Team | Team | Group organized around delivering one-pagers |
| One-Pager Strategist | Agent | A single actor with a job title |
| `draft_onepager` | Skill | A verb — describes what gets done |
| `revise_onepager_for_exec_audience` | Skill | A verb — specific process step |

## The Key Distinction

A skill can absolutely involve multiple steps and even coordinate multiple agents. But avoid defining a skill as "the team."

The hierarchy is:

- **Team** = owns the domain
- **Agents** = own subfunctions
- **Skills** = reusable methods those agents execute

A "one-pager" is usually an outcome/domain, not a single atomic skill. That's why making `onepagers` a skill feels wrong — it's better framed as a team that owns that domain.

However, a high-level orchestration skill like `produce_onepager` is valid when you want a single entry point that coordinates the full workflow.

## Five Concepts

There are actually five concepts — the **specialty/domain** is the broader area, and the **capability registry** is the platform catalog that manages all of them:

| Concept | What it is | Example |
|---------|-----------|---------|
| **Specialty/Domain** | The broader function or area | One-Pagers, Compliance, Content |
| **Team** | The group that owns the domain | One-Pager Team, Compliance Team |
| **Agent** | An actor within the team | Research Agent, Editor Agent |
| **Skill** | A method an agent executes | `draft_onepager`, `audit_soc2_controls` |
| **Capability** | Any registered item in the platform catalog | A skill, MCP server, agent template, or team template |

A domain can have one team or many. A team always belongs to a domain.

### Capability Registry

The capability registry is the centralized catalog of everything the platform offers — skills, MCP servers, agent templates, and team templates. It serves three purposes:

1. **Multi-tenant entitlements** — Each tenant has access to a defined subset of capabilities based on their licensing tier (free, pro, enterprise)
2. **Task routing** — When a job is dispatched, only relevant capabilities from the tenant's entitled set are injected into the agent's system prompt (saves tokens, improves agent focus)
3. **Marketplace** — Tenants can publish capabilities for other tenants to license (Spec 007)

Every skill in `skills/active/`, every team template in `config/templates/`, and every MCP server is a **capability** in the registry. The registry is the source of truth for what's available, who can use it, and how much it's been used.

See: Spec 006 (FR-023, FR-026) for registry infrastructure, Spec 007 for marketplace layer.

## Naming Conventions

### Teams

Teams own a domain. Name them after the specialty area + "Team."

| Good | Bad | Why |
|------|-----|-----|
| One-Pager Team | `onepagers` skill | It's an outcome, not a single action |
| Research Team | Research Agent | Multiple agents collaborate, not one actor |
| Content Team | Content Skill | A team coordinates a workflow |
| Compliance Team | `compliance` skill | Compliance spans auditing, implementation, monitoring |

**Format:** Title case, `<Domain> Team`. Used in UI and templates.

### Agents

Agents are actors within a team. Name them as who does the work — job titles with "Agent" suffix.

| Good | Bad | Why |
|------|-----|-----|
| Research Agent | Research Team | An agent is a single actor, not a group |
| Outline Agent | `outline_onepager` | An agent is a who, not a what |
| Writer Agent | Content Pipeline | An agent is one member, not the pipeline |
| Editor Agent | `edit_draft` | An agent does the editing, the skill is the method |
| QA Agent | QA | Add "Agent" to clarify the layer |

**Format:** Title case, `<Role> Agent`. Used as `roleName` in cluster templates.

### Skills

Skills are reusable methods those agents execute. Name them as verbs describing what gets done.

| Good | Bad | Why |
|------|-----|-----|
| `draft_onepager` | One-Pager | A skill is what gets done, not the deliverable |
| `research_brief` | Researcher | A skill is a what, not a who |
| `extract_key_points` | Key Points Agent | It's a process step, not an actor |
| `revise_onepager_for_exec_audience` | Executive Summary Team | Specific verb, not a team |
| `produce_onepager` | `onepagers` | Orchestration skill is valid; bare noun is not |
| `outline_onepager` | Outline | Be specific about what gets done to what |
| `qa_onepager` | QA | Include the domain so the skill is self-describing |

**Format:** `snake_case`, verb-first (or `verb_object` pattern). Used as `name` in `SKILL.md` frontmatter.

## How Each Layer Maps to Infrastructure

| Concept | Infrastructure | Where it lives |
|---------|---------------|----------------|
| **Specialty/Domain** | Category field on cluster | `"category"` in template JSON |
| **Team** | Cluster | `config/templates/` or Clusters UI |
| **Agent** | Role (within a cluster) | `"roles"` array in cluster definition |
| **Skill** | Skill directory | `skills/<skill-name>/SKILL.md` |
| **Capability** | Registry row in Postgres | `capabilities` table (Spec 006 Phase 0) |

### Team -> Cluster

```json
{
  "id": "onepager-team",
  "name": "One-Pager Team",
  "description": "Research a topic and produce a polished executive one-pager.",
  "category": "one-pagers",
  "cluster": {
    "systemPrompt": "You are part of the One-Pager Team...",
    "folders": ["research", "drafts", "final"],
    "roles": [ ... ]
  }
}
```

### Agent -> Role

```json
{
  "roleName": "Research Agent",
  "role": "You are a research agent. Your job is to find and synthesize information...",
  "prompt": "Research the following topic: {{input.topic}}...",
  "maxConcurrency": 2,
  "dependsOn": null
}
```

### Skill -> `skills/<skill-name>/`

```
skills/draft-onepager/
  SKILL.md        # Frontmatter + instructions
  draft.sh        # Executable script
```

```yaml
---
name: draft-onepager
description: Draft a one-page executive summary from research notes. Use when an agent needs to produce a concise one-pager.
---
```

## Composition Examples

### One-Pager Team

**Specialty/Domain:** One-Pagers
**Team:** One-Pager Team

| Agent | Skills Used | Depends On |
|-------|-------------|------------|
| Research Agent | `research_brief`, `extract_key_points` | - |
| Outline Agent | `structure_onepager`, `prioritize_findings` | Research Agent |
| Writer Agent | `draft_onepager`, `write_executive_summary` | Outline Agent |
| Editor Agent | `edit_for_clarity`, `check_tone_consistency` | Writer Agent |
| QA Agent | `validate_sources`, `check_formatting` | Editor Agent |

The team could also expose a single orchestration skill — `produce_onepager` — that coordinates the full pipeline as one entry point.

### Compliance Team

**Specialty/Domain:** Compliance
**Team:** Compliance Team

| Agent | Skills Used | Depends On |
|-------|-------------|------------|
| Auditor Agent | `audit_soc2_controls`, `audit_hipaa_controls` | - |
| Policy Agent | `draft_policy_document`, `format_compliance_report` | Auditor Agent |
| Implementation Agent | `generate_remediation_plan`, `apply_security_controls` | Auditor Agent |
| Monitor Agent | `scan_control_drift`, `generate_compliance_dashboard` | Implementation Agent |

### Infrastructure Migration Team

**Specialty/Domain:** Infrastructure
**Team:** Infrastructure Migration Team

Migrates the 23WF agent execution layer from GitHub Actions to Kubernetes + local LLM inference for multi-tenant, SOC 2-compliant production. Four phases: Mac Mini local (Phase 0), multi-tenant foundations (Phase 0.5), Cloud Run Jobs (Phase 1a), GKE Autopilot (Phase 1b).

| Agent | Skills Used | Depends On |
|-------|-------------|------------|
| Architecture Agent | `assess_infra_gaps`, `plan_migration_phase` | - |
| DevOps Agent | `generate_k8s_manifests`, `configure_bullmq`, `setup_ollama`, `write_docker_compose` | Architecture Agent |
| Security Agent | `audit_soc2_controls`, `review_network_policies`, `document_model_provenance` | DevOps Agent |
| Cost Analyst Agent | `project_infra_costs`, `analyze_per_run_cost`, `compare_hosting_options` | Architecture Agent |
| Reporter Agent | `compile_migration_report` | Security Agent |

**Key architecture decisions:**
- **LLM routing:** Phi-4 14B (Microsoft, US) local via Ollama for planning/summaries/chat; Claude Sonnet (Anthropic, US) via API for agent execution
- **No Chinese models** — SOC 2 enterprise requirement eliminates Qwen despite 15% quality advantage
- **Job queue:** BullMQ + Redis replaces GitHub Actions trigger — runs locally on Mac Mini and on cloud with same code
- **Cloud provider:** Google Cloud (GKE Autopilot) — best managed K8s, Cloud Run Jobs as lower-cost intermediate step
- **Start local:** Mac Mini M4 ($599 one-time, ~$2.60/mo idle) → Cloud Run ($0 idle) → GKE ($144/mo idle) as demand grows

**GitHub Features → New Infrastructure Migration Map:**

Every feature currently provided by GitHub Actions must have a direct equivalent in the new architecture. Git itself is retained for code storage and PRs — only the orchestration layer is replaced.

| GitHub Feature | Current Implementation | New Implementation | Phase |
|---|---|---|---|
| **Job dispatch (queue)** | `job/*` branch creation triggers `run-job.yml` | BullMQ + Redis queue, API-driven `createJob()` enqueues directly | Phase 0 |
| **Agent execution** | `run-job.yml` spins up Docker container on GH runner | Worker process pulls from BullMQ, spawns microsandbox microVM locally (Phase 0) or K8s Job (Phase 1) | Phase 0 |
| **Auto-merge** | `auto-merge.yml` — squash-merges PRs within `ALLOWED_PATHS` | Worker process merges via `gh pr merge` after validation (same logic, no workflow needed) | Phase 0 |
| **Job completion notification** | `notify-pr-complete.yml` POSTs to event handler webhook | Worker process calls event handler notification API directly after job completes (in-process, no webhook round-trip) | Phase 0 |
| **Job failure notification** | `notify-job-failed.yml` POSTs on workflow failure | Worker process catches container exit code, calls notification API on failure | Phase 0 |
| **Heartbeat / self-monitoring** | `heartbeat` cron in `CRONS.json` → agent job (disabled) | Same cron definition, but dispatches to local BullMQ instead of creating a GitHub branch. Ollama handles lightweight heartbeat tasks locally (no Claude API cost) | Phase 0 |
| **Secrets management** | `AGENT_*` / `AGENT_LLM_*` GitHub secrets → injected as env vars by `run-job.yml` | Secrets stored in Postgres (existing `settings` table) or HashiCorp Vault. Worker injects into container env at spawn time | Phase 0 |
| **Container registry** | GHCR (`ghcr.io/23systems/23wf:*`) with `GITHUB_TOKEN` auth | Docker Hub (public, already works) or GCP Artifact Registry (Phase 1). No GHCR dependency | Phase 0 |
| **CD / rebuild on push** | `rebuild-event-handler.yml` — self-hosted runner does `docker exec` rebuild | Webhook on `main` push → event handler self-restarts (PM2 restart or container health check). Or: Cloud Build trigger (Phase 1) | Phase 0.5 |
| **Package upgrade** | `upgrade-event-handler.yml` — manual workflow_dispatch | CLI command or web UI button that runs `npm update 23wf` + restarts | Phase 0.5 |
| **Git identity in containers** | `gh auth setup-git` + `gh api user` in every entrypoint | Same — containers still use `GH_TOKEN` for git operations. Git/GitHub is retained for code, only orchestration changes | Phase 0 |
| **PR creation** | `gh pr create` in container entrypoint | Same — agent containers still create PRs. No change needed | Phase 0 |
| **Audit log (git history)** | Job output committed to git, accessible at `LOG_SHA` | Same — git history is retained. Additionally: structured job logs in Postgres for queryability | Phase 0.5 |
| **LLM config overrides** | `vars.LLM_PROVIDER`, `vars.LLM_MODEL`, per-job `job.config.json` | Same config in `job.config.json`. BullMQ job payload carries overrides. Worker reads and applies | Phase 0 |
| **Runner selection** | `vars.RUNS_ON` (ubuntu-latest or self-hosted) | Not needed — worker runs containers directly. K8s node selection via nodeSelector/affinity (Phase 1) | Phase 1 |
| **Auto-merge kill switch** | `vars.AUTO_MERGE` = `"false"` disables auto-merge | Config flag in `settings` table or env var on worker | Phase 0 |
| **Allowed paths whitelist** | `vars.ALLOWED_PATHS` — comma-separated prefixes for auto-merge | Same config, read by worker process instead of workflow | Phase 0 |
| **Per-tenant isolation** | None — all jobs share one GitHub org | K8s namespaces + network policies + resource quotas (Phase 1). Microsandbox VM-level isolation + resource limits (Phase 0) | Phase 0 → 1 |
| **Concurrency control** | GitHub's 20 parallel jobs limit (hard cap) | BullMQ concurrency settings per queue. Unlimited with K8s (Phase 1) | Phase 0 |
| **Job status API** | `/api/jobs/status` queries GitHub API for running workflows | `/api/jobs/status` queries BullMQ + Postgres directly (faster, no GitHub API rate limits) | Phase 0 |

**What stays on GitHub (not migrated):**
- Git repository for code storage
- Pull requests as job output artifacts
- Git commit history as audit trail
- `GH_TOKEN` for container git operations (clone, push, PR)
- GitHub as source of truth for code — the migration only replaces the orchestration/compute layer

**Reference spec:** `references/reports/Infrastructure-Migration-Spec.html`
**Cluster template:** `config/templates/infra-migration.json`

## Decision Framework

### When a skill is enough

- It describes what gets done (verb/process)
- It could be a single step or a multi-step workflow
- Multiple different agents/teams could reuse it
- It doesn't need a persistent persona or identity
- Examples: `search_web`, `draft_onepager`, `produce_onepager`, `fetch_transcript`

### When you need an agent

- The work requires a persistent persona, judgment, or context
- It produces intermediate work that feeds into a pipeline
- It has a distinct "who" identity (researcher vs. writer vs. editor)
- Examples: Research Agent, Writer Agent, QA Agent

### When you need a team

- The outcome requires multiple agents coordinating
- There are dependencies between agents (Agent B waits for Agent A)
- The deliverable is a complex artifact owned by a domain
- Examples: One-Pager Team, Research Team, Compliance Team

### The naming test

Ask yourself: does this name describe...

- **what gets done?** -> Skill (`draft_onepager`)
- **who does it?** -> Agent (Writer Agent)
- **the broader function?** -> Team (One-Pager Team)

## Current Skills

All skills now follow verb-first naming:

| Skill | Description |
|-------|-------------|
| `search-web` | Search the web and extract content via Brave Search API |
| `automate-browser` | Automate browser interactions via Chrome DevTools Protocol |
| `audit-compliance` | Audit SOC2/HIPAA compliance, implement controls, monitor drift |
| `list-secrets` | List available LLM-accessible credentials |
| `sync-notebooklm` | Sync with Google NotebookLM — notebooks, sources, artifacts |
| `send-slack-message` | Send interactive Slack messages using Block Kit |
| `fetch-transcript` | Fetch transcripts from YouTube videos |
| `generate-sop` | Generate branded HTML SOP documents |
| `modify-self` | Modify the agent's own code, config, or skills |
| `assess-infra` | Assess infrastructure gaps, map GitHub features to new equivalents, produce migration checklists |
| `generate-k8s-manifests` | Generate Kubernetes manifests, Docker Compose files, and cloud configs |
| `project-infra-costs` | Project infrastructure and LLM costs at target tenant volumes |

### Internal Worker Modules (Spec 006 Phase 0)

These are internal modules in `worker/`, not agent skills. They run inside the worker process and don't have `SKILL.md` files:

| Module | File | Purpose |
|--------|------|---------|
| Job dispatcher | `Clusters/lib/tools/bullmq-dispatcher.js` | Enqueue agent jobs to BullMQ |
| Sandbox spawner | `worker/sandbox.js` | Spawn microsandbox microVM with secrets injection, capture results |
| Auto-merge | `worker/auto-merge.js` | Validate PR changed files against ALLOWED_PATHS and squash-merge |
| Notifier | `worker/notify.js` | Send job completion/failure notifications to event handler |
| LLM router | `worker/llm-router.js` | Route LLM requests between local Ollama (Phi-4 14B) and cloud APIs |
| Validator | `worker/validate.js` | Lint changed files, anomaly detection on job output |

### Setup Scripts (one-time)

| Script | Purpose |
|--------|---------|
| `setup-ollama-models` | Pull and configure Ollama Phi-4 14B model with verification |
| `migrate-sqlite-to-postgres` | Export SQLite data → import into Postgres (one-time migration) |

Future considerations:
- `audit-compliance` spans multiple concerns (auditing, policy, implementation, monitoring) and may eventually become a Compliance Team with specialized agents.

## Templates

### Defining a New Team

`config/templates/<team-id>.json`:

```json
{
  "id": "<team-id>",
  "name": "<Domain> Team",
  "description": "<What this team delivers, in one sentence.>",
  "icon": "<icon-name>",
  "category": "<domain>",
  "difficulty": "beginner|intermediate|advanced",
  "estimatedTime": "<typical duration>",
  "inputs": [
    {
      "id": "<input-id>",
      "label": "<Human-readable question>",
      "type": "text|select|number",
      "placeholder": "<example value>",
      "required": true
    }
  ],
  "cluster": {
    "systemPrompt": "You are part of the <Domain> Team. <shared context and coordination rules>",
    "folders": ["<shared-folder-1>", "<shared-folder-2>"],
    "roles": [
      {
        "roleName": "<Role> Agent",
        "role": "You are a <role> agent. <what you do and how you contribute to the team>.",
        "prompt": "<specific task instructions with {{input.field}} and {{CLUSTER_SHARED_DIR}} variables>",
        "maxConcurrency": 1,
        "dependsOn": null
      },
      {
        "roleName": "<Next Role> Agent",
        "role": "...",
        "prompt": "...",
        "maxConcurrency": 1,
        "dependsOn": "<Previous Role> Agent"
      }
    ]
  }
}
```

### Defining a New Skill

```
skills/<skill-name>/
  SKILL.md
  <script>.sh (or .js)
```

**SKILL.md:**
```yaml
---
name: <verb-noun-in-kebab-case>
description: <Verb-first sentence describing what gets done and when to use it.>
---

# <Skill Name>

## Usage

```bash
skills/<skill-name>/<script>.sh <args>
```

## Inputs
- `<arg1>` — <description>

## Output
<what the skill produces>
```
