# Spec 002: End User Portal — Simplified Agent Management

**Status:** Draft
**Priority:** P1 (High)
**Estimated Effort:** 80 hours
**Dependencies:** Clusters feature (functional), Spec 001 (pattern templates)

---

## Problem Statement

The current 23 Systems Agents portal is a **developer-facing control panel**. It exposes Docker containers, cron expressions, template variables, system prompts, trigger configs, MCP servers, and raw JSON. A non-technical user cannot create, manage, or monitor AI agents without understanding the infrastructure underneath.

The goal is to build a **separate End User Portal** — a simplified interface that sits on top of the same backend — where anyone can build and run AI agent teams as easily as creating a playlist or filling out a form.

**Two portals, one backend:**

| Portal | Audience | URL Path | Purpose |
|--------|----------|----------|---------|
| Developer Portal | Engineers, power users | `/dev/*` (existing) | Full control: raw configs, Docker, prompts, triggers |
| End User Portal | Business users, non-technical | `/` (new default) | Guided: wizards, templates, plain-English controls |

---

## Goals

1. **One-click agent creation** from pre-built templates — no prompt engineering required
2. **"Build a Team" wizard** that translates plain-English inputs into Cluster + Role configs
3. **Task-first interface** — users describe what they want done, not how to configure it
4. **Live dashboard** showing agent status in plain English, not container logs
5. **Keep the Developer Portal intact** — power users can still access everything

## Non-Goals

- Replacing or deprecating the Developer Portal
- Changing the Clusters backend, Docker execution, or database schema
- Building a mobile app
- Multi-tenant / multi-organization support (single-owner for now)
- Real-time inter-agent chat or collaboration UI

---

## User Personas

### Persona 1: "The Business Owner" (Primary)
- Non-technical, runs a small business or agency
- Wants AI agents to handle repetitive tasks (research, content, data processing)
- Thinks in terms of *outcomes* ("I need a weekly competitor report") not *infrastructure*
- Will never write a system prompt, cron expression, or touch Docker

### Persona 2: "The Operator" (Secondary)
- Semi-technical, comfortable with web apps but not DevOps
- Manages the agents day-to-day — assigns tasks, reviews output, adjusts settings
- Understands what agents do, doesn't need to know how they work internally

### Persona 3: "The Developer" (Existing — unchanged)
- Uses the Developer Portal for full control
- Builds custom templates, writes prompts, configures triggers
- Creates templates that End User Portal users can deploy

---

## Requirements

### Functional Requirements

#### FR-1: Template Gallery
**Priority:** P0

A browsable gallery of pre-built agent team templates. Each template is a JSON file that defines a complete Cluster configuration (roles, prompts, triggers, shared folders) behind a friendly card UI.

**1.1 Template Structure**

File location: `config/templates/`

```json
{
  "id": "research-team",
  "name": "Research Team",
  "description": "Give it a topic, get a comprehensive research report with sources.",
  "icon": "search",
  "category": "research",
  "difficulty": "beginner",
  "estimatedTime": "10-30 minutes per task",
  "inputs": [
    {
      "id": "topic",
      "label": "What should the team research?",
      "type": "text",
      "placeholder": "e.g., Top competitors in the meal-kit delivery space",
      "required": true
    },
    {
      "id": "depth",
      "label": "How deep should they go?",
      "type": "select",
      "options": [
        { "value": "quick", "label": "Quick overview (5 min)" },
        { "value": "standard", "label": "Standard report (15 min)" },
        { "value": "deep", "label": "Deep dive (30+ min)" }
      ],
      "default": "standard"
    }
  ],
  "cluster": {
    "systemPrompt": "You are part of a research team...",
    "folders": ["research", "sources", "reports"],
    "roles": [
      {
        "roleName": "Researcher",
        "role": "You find and gather information from the web...",
        "prompt": "Research the following topic: {{input.topic}}. Depth: {{input.depth}}.",
        "maxConcurrency": 2
      },
      {
        "roleName": "Analyst",
        "role": "You synthesize raw research into structured findings...",
        "prompt": "Analyze the research in {{CLUSTER_SHARED_DIR}}/research/ and produce a structured report.",
        "maxConcurrency": 1,
        "dependsOn": "Researcher"
      },
      {
        "roleName": "Writer",
        "role": "You produce a polished final report...",
        "prompt": "Write a final report from {{CLUSTER_SHARED_DIR}}/reports/analysis.md",
        "maxConcurrency": 1,
        "dependsOn": "Analyst"
      }
    ]
  }
}
```

**1.2 Starter Templates**

| Template | Roles | Use Case |
|----------|-------|----------|
| Research Team | Researcher, Analyst, Writer | Topic research with sourced report |
| Content Pipeline | Researcher, Writer, Editor | Blog posts, articles, social content |
| Competitor Watch | Scanner, Analyst, Reporter | Weekly competitor monitoring |
| Code Review Team | Scanner, Reviewer, Reporter | PR review and security analysis |
| Data Processor | Collector, Transformer, Validator | CSV/JSON data processing |
| Customer Support | Classifier, Responder, Escalator | Triage and draft responses |
| Meeting Prep | Researcher, Briefer | Pre-meeting research packets |
| SEO Auditor | Crawler, Analyzer, Reporter | Site SEO analysis and recommendations |

**Acceptance Criteria:**
- [ ] Template JSON schema defined and documented
- [ ] 8 starter templates created and tested
- [ ] Templates stored in `config/templates/` and scannable at runtime
- [ ] Template `inputs` field drives the wizard form (FR-2)
- [ ] `dependsOn` field enables sequential role execution

---

#### FR-2: "Build a Team" Wizard
**Priority:** P0

A step-by-step guided flow that creates a working agent team from a template. No raw config editing. No prompt writing.

**2.1 Wizard Flow**

```
Page 1 — CHOOSE TEMPLATE
┌──────────────────────────────────────────────────────┐
│  What kind of team do you need?                      │
│                                                      │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐             │
│  │ 🔍      │  │ 📝      │  │ 👁       │             │
│  │Research │  │Content  │  │Competitor│             │
│  │ Team    │  │Pipeline │  │ Watch    │             │
│  └─────────┘  └─────────┘  └─────────┘             │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐             │
│  │ 💻      │  │ ⚙       │  │ 📋      │             │
│  │  Code   │  │  Data   │  │ Support │             │
│  │ Review  │  │Processor│  │  Team   │             │
│  └─────────┘  └─────────┘  └─────────┘             │
│                                                      │
│  [Or describe what you need in plain English...]     │
│  ┌──────────────────────────────────────────────┐   │
│  │                                              │   │
│  └──────────────────────────────────────────────┘   │
│                                    [Find a Match →] │
└──────────────────────────────────────────────────────┘

Page 2 — CUSTOMIZE
(driven by template.inputs — each input becomes a form field)
┌──────────────────────────────────────────────────────┐
│  Research Team                                       │
│  "Give it a topic, get a comprehensive report"       │
│                                                      │
│  What should the team research?                      │
│  ┌──────────────────────────────────────────────┐   │
│  │ Top competitors in the meal-kit delivery...  │   │
│  └──────────────────────────────────────────────┘   │
│                                                      │
│  How deep should they go?                            │
│  ○ Quick overview (5 min)                            │
│  ● Standard report (15 min)                          │
│  ○ Deep dive (30+ min)                               │
│                                                      │
│  Team Members:                                       │
│  ✅ Researcher — finds information online            │
│  ✅ Analyst — synthesizes into structured findings   │
│  ✅ Writer — produces polished final report          │
│                                                      │
│                         [Back]  [Create Team →]      │
└──────────────────────────────────────────────────────┘

Page 3 — CONFIRM & LAUNCH
┌──────────────────────────────────────────────────────┐
│  Ready to go!                                        │
│                                                      │
│  Team: "Research Team"                               │
│  Task: "Top competitors in the meal-kit delivery..." │
│  Members: Researcher → Analyst → Writer              │
│  Estimated time: ~15 minutes                         │
│                                                      │
│  When should this run?                               │
│  ● Right now                                         │
│  ○ On a schedule (e.g., every Monday at 9am)         │
│  ○ When triggered (e.g., webhook, file upload)       │
│                                                      │
│                         [Back]  [Launch Team ▶]      │
└──────────────────────────────────────────────────────┘
```

**2.2 Template Matching via Plain English**

On Page 1, the free-text input ("describe what you need") uses the chat LLM to:
1. Parse the user's intent
2. Match to the best template (or suggest creating a custom team)
3. Pre-fill the template inputs on Page 2

**2.3 Behind the Scenes**

When the user clicks "Launch Team", the wizard:
1. Creates a Cluster with `systemPrompt` from the template (with `{{input.*}}` resolved)
2. Creates Roles from `template.cluster.roles` (with `{{input.*}}` resolved)
3. Sets trigger config based on Page 3 selection (manual, cron, webhook)
4. Triggers the first role immediately if "Right now" is selected
5. Redirects to the Team Dashboard (FR-3)

**Acceptance Criteria:**
- [ ] 3-step wizard flow implemented
- [ ] Template inputs render as form fields dynamically
- [ ] Plain-English matching suggests templates via LLM
- [ ] Wizard creates valid Cluster + Roles behind the scenes
- [ ] User never sees raw prompts, template variables, or cron expressions
- [ ] "On a schedule" option shows human-readable picker (not cron expressions)

---

#### FR-3: Team Dashboard
**Priority:** P0

The main screen after creating a team. Shows status, output, and actions in plain English.

**3.1 Dashboard Layout**

```
┌──────────────────────────────────────────────────────────────┐
│  Research Team                              [Pause] [Delete] │
│  "Top competitors in the meal-kit delivery space"            │
│                                                              │
│  STATUS                                                      │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐            │
│  │ Researcher │→ │  Analyst   │→ │   Writer   │            │
│  │  ✅ Done   │  │ 🔵 Working │  │ ⚪ Waiting │            │
│  │  2 min ago │  │  started   │  │            │            │
│  └────────────┘  └────────────┘  └────────────┘            │
│                                                              │
│  LATEST OUTPUT                                               │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  📄 Research Report — Meal Kit Competitors            │   │
│  │                                                       │   │
│  │  Found 12 competitors across 3 market segments...    │   │
│  │  [View Full Report]  [Download PDF]                   │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
│  HISTORY                                                     │
│  Mar 19, 2:30pm — Completed in 12 minutes  [View]          │
│  Mar 18, 9:00am — Completed in 15 minutes  [View]          │
│  Mar 17, 9:00am — Failed (Researcher timeout) [View]       │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ Run again with a new task...                          │   │
│  │ ┌──────────────────────────────────────────────┐     │   │
│  │ │                                              │     │   │
│  │ └──────────────────────────────────────────────┘     │   │
│  │                                          [Go ▶]      │   │
│  └──────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────┘
```

**3.2 Status Translation**

The dashboard translates container states to plain English:

| Container State | Dashboard Shows |
|-----------------|-----------------|
| Container creating | "Starting up..." |
| Container running | "Working..." with elapsed time |
| Container exited (0) | "Done" with completion time |
| Container exited (non-0) | "Failed" with plain-English error |
| Not started + `dependsOn` pending | "Waiting for [Role Name]" |
| Concurrency limit hit | "Busy — will start when a slot opens" |

**3.3 Output Rendering**

Instead of raw Docker logs, the dashboard:
1. Reads the latest output files from the cluster's shared directory
2. Renders Markdown content as formatted HTML
3. Offers "View Full Report" and "Download" actions
4. Shows a summary snippet (first 200 chars) on the dashboard card

**Acceptance Criteria:**
- [ ] Pipeline visualization shows role sequence with status
- [ ] Status updates in real-time (SSE from existing stream infrastructure)
- [ ] Output files rendered as formatted content, not raw logs
- [ ] "Run again" input box to re-trigger with new task
- [ ] History section with past runs and their status
- [ ] Plain-English error messages on failure

---

#### FR-4: Home Dashboard (All Teams)
**Priority:** P0

The landing page after login. Shows all teams and recent activity.

**4.1 Layout**

```
┌──────────────────────────────────────────────────────────────┐
│  23 Systems                                                  │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │ 💬 What do you need done?                             │   │
│  │ ┌──────────────────────────────────────────────┐     │   │
│  │ │ "Research the top CRM tools for small biz"   │     │   │
│  │ └──────────────────────────────────────────────┘     │   │
│  │                                          [Go ▶]      │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
│  YOUR TEAMS                                [+ New Team]      │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐        │
│  │ Research    │  │ Content     │  │ Competitor  │        │
│  │ Team        │  │ Pipeline    │  │ Watch       │        │
│  │ ✅ Idle     │  │ 🔵 Working  │  │ ✅ Idle     │        │
│  │ Last: 2h ago│  │ 3 min ago   │  │ Last: 1d ago│        │
│  └─────────────┘  └─────────────┘  └─────────────┘        │
│                                                              │
│  RECENT ACTIVITY                                             │
│  🟢 Content Pipeline completed "March newsletter draft"     │
│  🟢 Research Team completed "CRM comparison report"         │
│  🔴 Competitor Watch failed — Slack notification sent       │
│                                                              │
│  SCHEDULED                                                   │
│  📅 Competitor Watch — Every Monday at 9:00 AM              │
│  📅 Content Pipeline — Every Wednesday at 10:00 AM          │
└──────────────────────────────────────────────────────────────┘
```

**4.2 Quick Task Input**

The top input box ("What do you need done?") is a **smart dispatcher**:
1. If the user has an existing team that matches → routes to that team with the task pre-filled
2. If no match → suggests creating a new team from a template
3. If ambiguous → asks a clarifying question

This uses the same chat LLM as the existing chat interface but with a simplified prompt focused on task routing.

**Acceptance Criteria:**
- [ ] Home page shows all teams as cards with live status
- [ ] Quick task input routes to existing teams or wizard
- [ ] Recent activity feed with color-coded status
- [ ] Scheduled section shows upcoming automated runs
- [ ] Cards link to individual Team Dashboards

---

#### FR-5: Schedule Picker (Human-Readable)
**Priority:** P1

Replace cron expressions with a visual schedule picker for end users.

**5.1 Schedule Options**

```
When should this run?

● Just once — right now
○ Every day at [9:00 AM ▾]
○ Every week on [Monday ▾] at [9:00 AM ▾]
○ Every month on the [1st ▾] at [9:00 AM ▾]
○ Every [2 ▾] hours
○ Custom... (advanced — shows cron input for developers)
```

**5.2 Conversion**

The picker outputs a `{ humanLabel, cron }` object:
- `humanLabel`: "Every Monday at 9:00 AM" (stored for display)
- `cron`: "0 9 * * 1" (passed to the trigger system)

**Acceptance Criteria:**
- [ ] Visual picker covers 90% of common schedules
- [ ] Outputs valid cron expressions for the backend
- [ ] "Custom" option reveals raw cron input (escape hatch)
- [ ] Displays next 3 scheduled run times as preview

---

#### FR-6: Settings (Simplified)
**Priority:** P1

End User Portal settings — minimal, no infrastructure details.

**6.1 Settings Sections**

| Section | What's Shown | What's Hidden |
|---------|-------------|---------------|
| Profile | Name, email, password | — |
| Notifications | Slack channel, email alerts on/off | Webhook secrets, API keys |
| Appearance | Light/dark mode, accent color | Raw CSS variables |
| API Access | "Connect external apps" with copy-paste key | Key hashing details, SHA-256 |
| Switch to Developer Portal | Link to `/dev` | — |

**Acceptance Criteria:**
- [ ] Settings page with 4 sections
- [ ] No Docker, GitHub, or infrastructure details visible
- [ ] "Switch to Developer Portal" link for power users

---

#### FR-7: Portal Routing & Switching
**Priority:** P0

How the two portals coexist on the same Next.js app.

**7.1 Route Structure**

```
/                      → End User Portal (home dashboard)
/teams                 → All teams list
/team/new              → Build a Team wizard
/team/[id]             → Team dashboard
/team/[id]/history     → Past runs
/team/[id]/settings    → Team settings (simplified)
/templates             → Template gallery (browse all)
/settings              → User settings (simplified)

/dev                   → Developer Portal (existing chat UI)
/dev/clusters          → Clusters management
/dev/cluster/[id]      → Cluster editor (raw)
/dev/settings/crons    → Cron editor (raw JSON)
/dev/settings/triggers → Trigger editor (raw JSON)
/dev/settings/secrets  → API key management
/dev/runners           → Job monitor
/dev/notifications     → Notification center
```

**7.2 Portal Switching**

- End User Portal has a footer link: "Switch to Developer Mode"
- Developer Portal has a header badge: "Developer Mode" with link back to "/"
- Both share the same auth session (NextAuth)
- Both read/write to the same database and Clusters

**7.3 Migration of Existing Routes**

Existing routes (chat, clusters, settings, runners, etc.) move under `/dev/*` prefix. A redirect layer handles old bookmarks:

```
/clusters     → 301 → /dev/clusters
/settings/*   → 301 → /dev/settings/*
/runners      → 301 → /dev/runners
/chats        → 301 → /dev/chats
```

The chat interface at `/dev` remains the primary Developer Portal entry point.

**Acceptance Criteria:**
- [ ] End User routes under `/` (new pages)
- [ ] Developer routes under `/dev/*` (existing pages, relocated)
- [ ] 301 redirects from old routes to `/dev/*`
- [ ] Shared auth session between portals
- [ ] Portal switching links in both UIs

---

#### FR-8: Template Builder (Developer Portal Addition)
**Priority:** P2

A tool in the Developer Portal for creating templates that End User Portal users can deploy.

**8.1 Builder Flow**

Developers can:
1. Create a Cluster manually with roles, prompts, triggers (existing UI)
2. Click "Export as Template" to generate a template JSON
3. Define `inputs` (user-facing form fields) that map to `{{input.*}}` variables in prompts
4. Preview how it will look in the End User wizard
5. Save to `config/templates/`

**Acceptance Criteria:**
- [ ] "Export as Template" button on Cluster edit page
- [ ] Input field editor (label, type, placeholder, required)
- [ ] Preview mode showing End User wizard view
- [ ] Saves valid template JSON to `config/templates/`

---

### Non-Functional Requirements

#### NFR-1: No Backend Changes
The End User Portal is a **UI-only addition**. It calls the same:
- Server Actions (from `Clusters/lib/cluster/actions.js`)
- Database queries (from `Clusters/lib/db/clusters.js`)
- SSE streams (from `Clusters/lib/cluster/stream.js`)
- Docker execution (from `Clusters/lib/cluster/execute.js`)

The only backend addition is:
- Template file loading (scan `config/templates/*.json`)
- Input variable resolution (`{{input.*}}` → user values)

#### NFR-2: Performance
- Home dashboard loads in < 2 seconds
- Team status updates within 3 seconds of container state change
- Template gallery renders all templates without pagination (< 50 templates expected)

#### NFR-3: Accessibility
- All wizard steps keyboard-navigable
- Form labels associated with inputs
- Status colors paired with icons (not color-only)
- Minimum contrast ratio 4.5:1

#### NFR-4: Responsive
- Desktop-first but usable on tablet
- Mobile: read-only dashboard view (no wizard on mobile)

---

## Technical Design

### Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│  ┌───────────────────────┐    ┌───────────────────────┐        │
│  │   END USER PORTAL     │    │   DEVELOPER PORTAL    │        │
│  │   /                   │    │   /dev                 │        │
│  │                       │    │                        │        │
│  │  Home Dashboard       │    │  Chat Interface        │        │
│  │  Template Gallery     │    │  Cluster Editor        │        │
│  │  Build-a-Team Wizard  │    │  Cron/Trigger Config   │        │
│  │  Team Dashboard       │    │  Console/Logs          │        │
│  │  Schedule Picker      │    │  Runners/Notifications │        │
│  │  Simplified Settings  │    │  API Key Management    │        │
│  └──────────┬────────────┘    └──────────┬─────────────┘        │
│             │                            │                      │
│             │    ┌───────────────────┐   │                      │
│             └───►│ ORCHESTRATION     │◄──┘                      │
│                  │ LAYER (NEW)       │                           │
│                  │                   │                           │
│                  │ Template Loader   │                           │
│                  │ Input Resolver    │                           │
│                  │ Schedule Mapper   │                           │
│                  │ Status Translator │                           │
│                  │ Output Renderer   │                           │
│                  │ Task Router       │                           │
│                  └────────┬──────────┘                           │
│                           │                                     │
│             ┌─────────────▼─────────────────┐                   │
│             │      EXISTING BACKEND          │                   │
│             │                                │                   │
│             │  Cluster Actions (CRUD)        │                   │
│             │  Docker Execution              │                   │
│             │  SSE Streaming                 │                   │
│             │  Database (SQLite/Drizzle)     │                   │
│             │  GitHub Integration            │                   │
│             │  Notification System           │                   │
│             └────────────────────────────────┘                   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### New Files

```
app/
├── page.js                          → End User Home Dashboard
├── teams/page.js                    → All Teams list
├── team/
│   ├── new/page.js                  → Build a Team wizard
│   ├── [id]/page.js                 → Team Dashboard
│   ├── [id]/history/page.js         → Past runs
│   └── [id]/settings/page.js        → Simplified team settings
├── templates/page.js                → Template gallery
├── settings/page.js                 → Simplified user settings
└── dev/                             → Developer Portal (relocated existing pages)
    ├── page.js                      → Chat (existing)
    ├── clusters/page.js             → Clusters (existing)
    ├── cluster/[id]/page.js         → Cluster editor (existing)
    ├── settings/                    → Settings pages (existing)
    ├── runners/page.js              → Runners (existing)
    └── ...

lib/
├── portal/
│   ├── templates.js                 → Template loader (scans config/templates/)
│   ├── resolver.js                  → Input variable resolver ({{input.*}} → values)
│   ├── schedule.js                  → Human-readable ↔ cron expression mapper
│   ├── status.js                    → Container state → plain English translator
│   ├── output.js                    → Cluster output file reader/renderer
│   └── router.js                    → Smart task dispatcher (LLM-based routing)
├── portal/components/
│   ├── home-dashboard.jsx           → Home page with team cards + quick task
│   ├── template-gallery.jsx         → Browse/search templates
│   ├── team-wizard.jsx              → 3-step wizard flow
│   ├── team-dashboard.jsx           → Individual team status + output
│   ├── pipeline-status.jsx          → Role sequence visualization
│   ├── schedule-picker.jsx          → Human-readable schedule selector
│   ├── output-viewer.jsx            → Rendered Markdown/file output
│   ├── activity-feed.jsx            → Recent activity list
│   └── portal-layout.jsx            → End User Portal shell (nav, footer)

config/
├── templates/
│   ├── research-team.json
│   ├── content-pipeline.json
│   ├── competitor-watch.json
│   ├── code-review-team.json
│   ├── data-processor.json
│   ├── customer-support.json
│   ├── meeting-prep.json
│   └── seo-auditor.json
```

### Orchestration Layer Details

#### Template Loader (`lib/portal/templates.js`)
```
loadTemplates()           → scan config/templates/*.json, return sorted list
getTemplate(id)           → load single template by ID
validateTemplate(json)    → check required fields, validate input types
```

#### Input Resolver (`lib/portal/resolver.js`)
```
resolveInputs(template, userInputs)
  → deep-clone template.cluster
  → replace all {{input.fieldId}} with userInputs[fieldId]
  → return resolved cluster config ready for createCluster()
```

#### Schedule Mapper (`lib/portal/schedule.js`)
```
humanToCron(selection)    → { humanLabel, cron }
cronToHuman(expression)   → "Every Monday at 9:00 AM"
getNextRuns(cron, count)  → next N scheduled times
```

#### Status Translator (`lib/portal/status.js`)
```
translateContainerState(container, role)
  → "Working..." | "Done" | "Waiting for Researcher" | "Failed: connection timeout"

translateClusterState(containers, roles)
  → { overall: "Working", roles: [...], progress: "2 of 3 roles complete" }
```

#### Output Renderer (`lib/portal/output.js`)
```
getLatestOutput(clusterId)
  → scan shared directory for output files
  → return { files: [...], summary, renderedHtml }

renderOutput(filePath)
  → read file, detect type (md/json/csv/txt)
  → render as formatted HTML
```

#### Task Router (`lib/portal/router.js`)
```
routeTask(userInput, existingTeams)
  → LLM call: "Given these teams and this task, which team should handle it?"
  → return { teamId, confidence, suggestion }
```

### Role Dependency Execution

Templates can define `dependsOn` between roles. The orchestration layer handles this:

1. When a team is triggered, only roles with no `dependsOn` (or whose dependency is satisfied) start
2. When a role completes (container exits 0), check if any blocked roles can now start
3. This is implemented as a lightweight state machine on top of the existing manual trigger system

**Implementation:** A new `triggerDependentRoles(clusterId, completedRoleId)` function that:
- Queries cluster roles
- Finds roles where `dependsOn === completedRoleName`
- Calls `triggerRoleManually()` for each unblocked role
- Hooks into container exit via the existing SSE stream monitoring

### Database Changes

**None required for core functionality.** Templates are file-based. The End User Portal creates standard Clusters and Roles.

**Optional enhancement (P2):** Add a `source_template` column to `clusters` table to track which template a cluster was created from (enables "update from template" later).

---

## Implementation Plan

### Phase 1: Foundation (20 hours)
**Goal:** Template system + portal routing

**Deliverables:**
- [ ] Template JSON schema and 4 starter templates
- [ ] Template loader (`lib/portal/templates.js`)
- [ ] Input resolver (`lib/portal/resolver.js`)
- [ ] Portal route structure (`/` for end user, `/dev/*` for developer)
- [ ] Redirect layer for existing routes
- [ ] Portal layout component with navigation

**Tasks:**
1. Define template JSON schema with validation
2. Create 4 templates: Research Team, Content Pipeline, Competitor Watch, Data Processor
3. Build template loader that scans `config/templates/`
4. Build input resolver for `{{input.*}}` variables
5. Set up `/dev/*` route group and relocate existing pages
6. Add 301 redirects from old routes
7. Create portal layout component (nav, footer, portal switcher)

### Phase 2: Wizard & Gallery (25 hours)
**Goal:** Users can browse templates and create teams

**Deliverables:**
- [ ] Template gallery page
- [ ] 3-step Build a Team wizard
- [ ] Schedule picker component
- [ ] Plain-English template matching (LLM)

**Tasks:**
1. Build template gallery with category filters and search
2. Build wizard Step 1: template selection + plain-English input
3. Build wizard Step 2: dynamic form from template inputs
4. Build wizard Step 3: schedule selection + confirmation
5. Build schedule picker component (human-readable ↔ cron)
6. Integrate LLM for template matching from free-text input
7. Wire wizard to `createCluster()` + `createClusterRoleAction()` actions
8. Create remaining 4 templates: Code Review, Customer Support, Meeting Prep, SEO Auditor

### Phase 3: Dashboard (25 hours)
**Goal:** Users can monitor and interact with running teams

**Deliverables:**
- [ ] Home dashboard with team cards and quick task input
- [ ] Individual team dashboard with pipeline visualization
- [ ] Status translator + output renderer
- [ ] Activity feed
- [ ] Role dependency execution

**Tasks:**
1. Build home dashboard layout with team cards
2. Build quick task input with LLM-based routing
3. Build team dashboard with pipeline status visualization
4. Build status translator (container state → plain English)
5. Build output renderer (read shared dir → formatted HTML)
6. Build activity feed from cluster logs
7. Implement `triggerDependentRoles()` for sequential execution
8. Wire SSE stream to team dashboard for real-time updates

### Phase 4: Polish & Settings (10 hours)
**Goal:** Complete experience with settings and portal switching

**Deliverables:**
- [ ] Simplified settings page
- [ ] Portal switching (both directions)
- [ ] Error states and empty states
- [ ] Run history page

**Tasks:**
1. Build simplified settings (profile, notifications, appearance)
2. Add portal switcher to both portal layouts
3. Design empty states (no teams, no activity, no templates)
4. Design error states (failed run, timeout, concurrency limit)
5. Build run history page with past output viewer
6. End-to-end testing of full flow: template → wizard → launch → dashboard → output

---

## UX Principles

### 1. Task-First, Not Config-First
Every screen starts with "What do you want done?" — not "Configure your settings."

### 2. Progressive Disclosure
- Level 1 (default): Template cards, form fields, status icons
- Level 2 (on demand): Schedule details, role list, output files
- Level 3 (developer): Raw prompts, container logs, cron expressions

### 3. Plain English Everywhere
- "Working..." not "Container running"
- "Every Monday at 9am" not "0 9 * * 1"
- "Waiting for Researcher to finish" not "dependsOn: Researcher, state: pending"
- "Failed: couldn't reach the website" not "Exit code 1: ECONNREFUSED"

### 4. One Input, One Button
The ideal interaction is: type what you want → click Go. Everything else is optional.

---

## Success Metrics

### Usability
- [ ] Non-technical user can create and run a team in < 3 minutes (from login to first output)
- [ ] Zero raw config visible in the End User Portal (no JSON, no cron, no template vars)
- [ ] User can understand team status at a glance without clicking into details

### Adoption
- [ ] 80% of teams created via templates (not raw cluster creation)
- [ ] < 5% of end users ever visit the Developer Portal

### Reliability
- [ ] Team creation from template succeeds 99%+ of the time
- [ ] Status dashboard reflects real container state within 3 seconds
- [ ] Role dependencies execute correctly (dependsOn chain completes in order)

---

## Risks & Mitigation

### Risk 1: Template Rigidity
**Impact:** High — users need teams that don't fit templates
**Probability:** Medium
**Mitigation:** "Describe what you need" free-text input can suggest custom team creation. Add a "Custom Team" option in the wizard that offers more flexibility (still guided, not raw config).

### Risk 2: LLM Routing Accuracy
**Impact:** Medium — wrong team selected for a task
**Probability:** Low (small number of teams, clear purposes)
**Mitigation:** Always show the routing suggestion with a "Not what I meant? Choose manually" option. Route to wizard (not direct execution) so user can review before launching.

### Risk 3: Output File Discovery
**Impact:** Medium — dashboard can't find the output to display
**Probability:** Medium (agents may save output in unexpected locations)
**Mitigation:** Templates include explicit output path instructions in prompts. Output renderer falls back to showing the full shared directory listing if no standard output file found.

### Risk 4: Route Migration Disruption
**Impact:** Low — broken bookmarks
**Probability:** High (all existing routes move)
**Mitigation:** 301 redirects for all old routes. Existing API routes (`/api/*`) do NOT move. Telegram webhook and external integrations unaffected.

### Risk 5: Sequential Role Execution Reliability
**Impact:** High — pipeline stalls if a dependency isn't detected as complete
**Probability:** Medium
**Mitigation:** Timeout per role (configurable in template). If a role doesn't complete within the timeout, mark as failed and notify. Dashboard shows "stuck" state explicitly.

---

## Resolved Decisions

1. **Templates are NOT editable after deployment.** Templates create clusters, then clusters live independently. To update, re-deploy from the template. No version tracking needed.

2. **Solo Jobs modeled as single-role clusters.** The End User Portal uses Clusters for everything. A solo agent is a "team of one." User sees no difference.

3. **File upload supported in wizard (Phase 2 stretch).** Add `"type": "file"` input option. Uploaded files go into the cluster's shared directory. Critical for Data Processor and Customer Support templates.

4. **Notification preferences per team — simple.** Two toggles per team: notify on completion (on/off), notify on failure (on/off, default: on). Channel selection stays global in settings.

5. **Single-user only for v1.** No team sharing or multi-user. Future spec if needed.

---

**Spec Author:** 23 Systems
**Created:** 2026-03-19
**Decisions Resolved:** 2026-03-19
**Status:** Approved — Phase 1 In Progress
