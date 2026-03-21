# BDR Management Platform Constitution

## Core Principles

### I. CRM-First Architecture

The platform is fundamentally a CRM with prospecting as the primary focus. All features MUST support the core CRM workflow: Accounts (Companies) → Contacts → Campaigns → Sequences → Activities. Every component layer (email, LinkedIn, calling) integrates INTO the CRM, not alongside it. The platform targets developer/engineer/decision-maker personas with classification and targeting capabilities.

### II. Plugin Ecosystem (WordPress-like)

The platform MUST be built with a modular plugin architecture similar to WordPress:

#### Core Platform (Minimal)

- **Authentication**: NextAuth.js with Google OAuth + Credentials
- **Database**: Prisma ORM with PostgreSQL
- **API Routing**: Next.js App Router API routes
- **UI Shell**: Base layout, navigation, settings page
- **Plugin Registry**: Central registry for plugin discovery and activation

#### Plugin Architecture Requirements

**Plugin Structure** (located in `src/plugins/`):

```
src/plugins/
├── core/
│   ├── registry.ts          # Plugin registration and lifecycle
│   ├── types.ts             # Plugin interface definitions
│   └── loader.ts            # Plugin discovery and initialization
├── integrations/
│   ├── hubspot/
│   │   ├── plugin.ts        # Plugin manifest and registration
│   │   ├── client.ts        # External API client
│   │   ├── routes.ts        # API route registrations
│   │   ├── components/      # UI components
│   │   ├── types.ts         # TypeScript types
│   │   └── README.md        # Plugin documentation
│   ├── instantly/
│   ├── heyreach/
│   └── builtwith/
└── features/
    ├── campaigns/
    ├── enrichment/
    └── cost-tracking/
```

**Plugin Manifest** (plugin.ts):

```typescript
import { Plugin } from '@/plugins/core/types';

export const hubspotPlugin: Plugin = {
  id: 'hubspot',
  name: 'HubSpot Integration',
  version: '1.0.0',
  description: 'Sync contacts, companies, and deals with HubSpot CRM',
  author: 'BDR Platform Team',

  // Lifecycle hooks
  onInstall: async (context) => {
    /* Migration logic */
  },
  onActivate: async (context) => {
    /* Activation logic */
  },
  onDeactivate: async (context) => {
    /* Cleanup logic */
  },
  onUninstall: async (context) => {
    /* Data removal */
  },

  // Capabilities
  routes: [
    { path: '/api/v1/plugins/hubspot/sync', handler: syncRoute },
    { path: '/api/v1/plugins/hubspot/contacts', handler: contactsRoute },
  ],

  uiComponents: [
    { location: 'settings', component: HubSpotSettings },
    { location: 'contact-detail', component: HubSpotSyncButton },
  ],

  eventListeners: [
    { event: 'contact.created', handler: syncContactToHubSpot },
    { event: 'contact.updated', handler: updateHubSpotContact },
  ],

  permissions: ['read:contacts', 'write:contacts', 'read:companies'],

  settings: {
    apiKey: { type: 'secret', required: true },
    portalId: { type: 'string', required: true },
    autoSync: { type: 'boolean', default: true },
  },
};
```

**Plugin Capabilities**:

- **Route Registration**: Plugins can register API routes under `/api/v1/plugins/{plugin-id}/*`
- **UI Component Injection**: Plugins provide components for specific UI locations (hooks)
- **Event System**: Plugins listen to and emit events via centralized event bus
- **Database Migrations**: Plugins can add tables/columns via Prisma schema extensions
- **Settings Management**: Per-client plugin configuration stored in `PluginSettings` table
- **Webhooks**: Plugins can register webhook handlers under `/api/webhooks/{plugin-id}/*`
- **Background Jobs**: Plugins can schedule cron jobs or queue tasks

**Plugin Types**:

1. **Integration Plugins** (external services):
   - Instantly (email outreach)
   - HeyReach (LinkedIn automation)
   - HubSpot (CRM sync)
   - BuiltWith (company tech stack)
   - Apollo.io (contact enrichment)
   - Clay (enrichment orchestration)

2. **Feature Plugins** (core functionality):
   - Campaigns (sequence management)
   - Enrichment (data enhancement workflows)
   - Calling (phone/dialer integration)
   - Cost Tracking (LLM and API cost monitoring)
   - Meetings (calendar integration)

3. **UI Enhancement Plugins**:
   - Custom dashboards
   - Reporting widgets
   - Analytics overlays

**Plugin Isolation**:

- Each plugin has isolated dependencies in `package.json`
- Plugin settings scoped by `clientId` for multi-tenancy
- Plugins cannot directly access other plugins (must use event system)
- Database tables prefixed with plugin ID (e.g., `hubspot_sync_log`)
- Error in one plugin does not crash entire application

**Plugin Activation Flow**:

1. Admin navigates to Settings → Plugins
2. Admin clicks "Activate" on a plugin
3. System runs `plugin.onActivate(context)` hook
4. Plugin registers routes, components, and event listeners
5. Plugin settings UI appears in Settings page
6. Plugin is marked as active in `Plugin` table for that client

**Plugin Development**:

- Plugins follow same TypeScript + ESLint standards as core
- Plugins must export a default `Plugin` object
- Plugins must include comprehensive README.md
- Plugins are versioned independently from core platform
- Breaking changes in core must not break plugins (stable Plugin API)

**Third-Party Plugin Support** (Future):

- Plugin marketplace for discovery
- Plugin submission and review process
- Sandboxed execution environment for untrusted plugins
- Rate limiting per plugin
- Revenue sharing model for premium plugins

**Forbidden Plugin Patterns**:

- Plugins MUST NOT bypass authentication/authorization
- Plugins MUST NOT access database directly (use Prisma client from context)
- Plugins MUST NOT create global variables or pollute namespace
- Plugins MUST NOT make synchronous blocking calls
- Plugins MUST respect client isolation (no cross-tenant access)

### III. API-First Development

ALL functionality MUST be accessible via API before any UI is built:

- Design API contracts (OpenAPI/Swagger) BEFORE implementation
- UI is ONE consumer of the API, not the only consumer
- Full REST API with consistent patterns (or tRPC/GraphQL if justified)
- Versioned APIs (v1, v2) for backwards compatibility
- Webhook events for external system integration
- Authentication via API keys and OAuth for programmatic access
- Mobile-ready, automation-friendly, headless-capable

### IV. Client Isolation (Multi-Tenancy)

Client portals MUST maintain strict data isolation:

- Prospects, campaigns, activities, and costs are scoped by client
- No cross-client data leakage is permitted under any circumstance
- Client-specific views show ONLY data relevant to that client's campaigns
- Database-level isolation (tenant ID on all tables)
- API endpoints enforce tenant context
- Audit logs capture tenant context for all operations

### V. SOC 2 Compliance & Full Audit Logging

The platform MUST be built for SOC 2 audit readiness:

- **Log EVERYTHING**: All user actions, API calls, data changes, system events
- **Immutable Audit Trail**: Who did what, when, to what entity, with what result
- **Data Change Tracking**: Before/after values for all mutations
- **Access Logging**: All authentication attempts, authorization decisions
- **Integration Logging**: All external API calls with request/response (sanitized)
- **Retention**: Logs retained per compliance requirements (minimum 1 year)
- **Tamper-Proof**: Logs cannot be modified or deleted by application users

### VI. Cost Tracking & Financial Model

ALL costs MUST be tracked with full attribution:

- **LLM Costs**: Every AI/LLM API call tracked (tokens, cost, model, endpoint, timestamp)
- **Enrichment Costs**: Per-service costs (BuiltWith, contact enrichment providers)
- **Cost Attribution**: Costs linked to Client, Account, Contact, Campaign
- **SaaS Pricing Input**: Admin can input vendor pricing for accurate cost calculation
- **Real-Time Dashboard**: View costs by client, service, time period, entity
- **Margin Visibility**: Understand true cost per client for pricing decisions

### VII. Deviation Prevention

The system and development process MUST actively prevent deviation from project objectives:

- **Planning Phase**: Warn if proposed features conflict with constitution
- **Implementation Phase**: Flag code changes that violate architectural principles
- **Runtime**: Alert on usage patterns that deviate from intended workflows
- **AI Assistance**: Any AI-generated code/plans MUST be checked against constitution
- **Documentation**: All deviations require explicit justification in Complexity Tracking

### VIII. Integration-Centric Design

The platform orchestrates external tools rather than replacing them:

- **Instantly**: Email campaign execution (Plugin)
- **HeyReach**: LinkedIn outreach automation (Plugin)
- **HubSpot/Orum**: Calling tasks and dialer integration (Plugin)
- **BuiltWith**: Company tech stack enrichment (Plugin)
- **Contact Enrichment**: Email/phone data providers (Plugin)

All integrations MUST:

- Sync bidirectionally where applicable
- Handle API failures gracefully with retry logic and circuit breakers
- Log all external API interactions (SOC 2 requirement)
- Support webhook-based real-time updates where available
- Track costs per API call for financial model

### IX. Sequence-Driven Workflows

Campaigns drive sequences. Each campaign MUST define its complete sequence:

- Multi-channel orchestration (email → LinkedIn → call)
- Automatic step progression based on activity completion
- Manual override capabilities for BDR flexibility
- Templates for each step (email copy, LinkedIn messages, call scripts)
- BDR Playbook and Account Manager Playbook per campaign

### X. Enrichment as Foundation

Data enrichment is a prerequisite for quality outreach:

- Bulk company list uploads with domain-based enrichment
- Tech spend classification (high/mid/low) from BuiltWith
- Contact enrichment: email, mobile, direct dial, HQ phone
- Persona classification for decision-maker targeting
- Track enrichment source, freshness, and cost

### XI. Context-First Decision Making

Before ANY action or implementation, the following MUST occur:

- **Project Review**: Search relevant files/folders to gather context before decisions
- **Impact Analysis**: Understand how a change affects connected components
- **Question First**: If ANYTHING is unclear, ask clarifying questions BEFORE proceeding
- **No Assumptions**: Never assume requirements - always verify with stakeholder
- **Agentic Consideration**: For each task, determine if it should leverage the AI/agent platform being integrated or be handled differently

### XII. Holistic System Awareness

The platform is an interconnected system - NO isolated changes:

- **Connection Mapping**: Before any change, identify ALL related components, entities, and workflows
- **Cross-Feature Impact**: A change to Contacts affects Campaigns, Activities, Enrichment, etc.
- **Plugin Dependencies**: Changes to core affect all plugins; plugin changes may affect core
- **Data Flow Tracing**: Understand how data flows through the entire system before modifying any part
- **No Silos**: Never implement a feature in isolation - always consider the whole system
- **Documentation Links**: Every feature must reference how it connects to other features

### XIII. Confirmation-Required Workflow

NO implementation without explicit confirmation:

**Pre-Implementation Requirements:**

1. **Summary Presentation**: Always present a summary of what will be done BEFORE doing it
2. **Scope Confirmation**: Get explicit "yes" or approval before implementing
3. **Change Preview**: Show exactly what files/code will be modified
4. **Rollback Plan**: For significant changes, document how to undo if needed

**Data Protection:**

- **NO DELETE without confirmation**: Never delete any data, files, or code without explicit user approval
- **Soft Delete First**: Prefer soft deletes (flagging) over hard deletes
- **Backup Reminder**: For destructive operations, remind user to backup first
- **Audit Trail**: All deletions MUST be logged with who, what, when, why

**Implementation Gate:**

- Present summary → Ask for confirmation → Wait for explicit "yes" → Then implement
- If user says "proceed" or similar, ask: "To confirm, I will [specific actions]. Is this correct?"

### XIV. UI/UX First Design

Simple, intuitive interfaces are non-negotiable:

- **User-Centered**: Design for the user, not the developer
- **Simplicity First**: If it needs explanation, simplify it
- **Consistency**: Follow established patterns (shadcn/ui conventions)
- **Accessibility**: WCAG 2.1 AA compliance minimum
- **Design Before Code**: UI/UX review before implementation
- **Gemini CLI Review**: Use Gemini for design feedback and iteration
- **Mobile Consideration**: Responsive design, touch-friendly interactions
- **Feedback Loops**: Loading states, error states, success confirmations
- **Progressive Disclosure**: Show only what's needed, reveal complexity gradually

**UI/UX Workflow:**

1. Define user flow and wireframes
2. Run `/speckit.ux` to generate Gemini CLI prompt
3. Get AI design feedback via Gemini CLI
4. Iterate on design based on feedback
5. Implement with shadcn/ui components
6. Validate accessibility (keyboard nav, screen readers)

### XV. AWS-Only Infrastructure (Slack List Processor)

The Slack List Processor MUST run exclusively on AWS infrastructure. There is NO local development server, NO local testing, NO local Redis, NO local database:

- **Deployment Target**: AWS ECS Fargate is the ONLY runtime environment. Valid clusters: `prod-slack-list-processor` (production) and `staging-slack-list-processor` (staging)
- **Database**: AWS RDS PostgreSQL (never localhost)
- **Cache/Queue**: AWS ElastiCache Redis (never localhost Redis)
- **Storage**: AWS S3 (never local filesystem)
- **Socket Mode**: Only ONE ECS task per Slack app connects via Socket Mode. Production and staging use separate Slack apps so their connections don't conflict. Running a local connection still causes event splitting within that app
- **Build & Deploy**: Day-to-day deployments use GitHub Actions CI/CD (`develop` → staging, `main` → production). The deploy script (`./infra/deploy.sh`) is for initial stack creation only
- **Testing**: Test against the deployed AWS service, not a local process
- **Environment Variables**: Production values in CloudFormation parameters and ECS task definition. The `.env` file is used ONLY as input to the deploy script, NOT for running a local server
- **NEVER start the app locally** (`npm run dev`, `tsx src/app.ts`, `node dist/app.js`): this creates a competing Socket Mode connection that steals events from the production ECS task, causing "No file found" and other state-mismatch errors
- **Logs**: CloudWatch Logs at `/ecs/prod-slack-list-processor` (production) and `/ecs/staging-slack-list-processor` (staging), 30-day retention

**FORBIDDEN:**
- `npm run dev` or `npm start` for testing
- `localhost:6379` Redis connections
- `localhost:5432` database connections
- Running any Slack Bot process outside of ECS Fargate

### XVI. Developer Navigation Index

The root page (localhost:3000) MUST be a live Table of Contents:

- **Auto-Cataloging**: Automatically lists ALL routes created in the project

### XVII. MCP-First Research Workflow

Before implementing ANY feature, the AI assistant MUST use MCP tools to research:

**Required Research Steps:**

1. **Documentation Lookup** (ref.tools):
   - Official API documentation for libraries being used
   - Framework-specific patterns (Next.js, React, Supabase)
   - TypeScript type definitions and interfaces

2. **Best Practices Search** (exa):
   - Current year patterns and approaches (2024+)
   - Known issues and gotchas
   - Community-recommended implementations
   - Accessibility and security considerations

3. **Validation**:
   - Confirm implementation approach aligns with researched best practices
   - Document any deviations with justification
   - Note enhancements discovered during research

**When MCP Research is MANDATORY:**
| Task Type | Research Focus |
|-----------|---------------|
| New UI component | Accessibility, patterns, UX best practices |
| API integration | SDK docs, error handling, rate limits |
| State management | Current patterns, performance considerations |
| Security feature | OWASP guidelines, framework security docs |
| Database schema | Normalization, indexing, query patterns |
| Performance work | Profiling techniques, optimization patterns |

**MCP Tool Selection:**

- `ref.tools` - Official documentation, API references, type definitions
- `exa` - Articles, tutorials, blog posts, recent best practices

**Output Requirements:**

- Cite sources that influenced the implementation
- Note any improvements added based on research (e.g., "Added Select All per best practices")
- Flag if research revealed the proposed approach is suboptimal

### XVIII. Developer Navigation Index (continued)

- **Classification**: Routes grouped by type (Dashboard, Admin, API, Auth, Portal, Plugin)
- **Live Updates**: New pages automatically appear when route files are created
- **Route Metadata**: Each route displays path, description, auth requirements, status
- **API Endpoints**: Separate section listing all `/api/*` routes with methods (GET, POST, etc.)
- **Status Indicators**: Mark routes as Complete, In Progress, or Planned
- **Search/Filter**: Quick search to find specific routes
- **Development Only**: Can be disabled or replaced in production builds

**Implementation Requirements:**

1. Route registry utility scans `src/app/` directory structure
2. Each page exports metadata: `{ title, description, category, status, auth }`
3. Root page dynamically renders categorized, clickable links
4. API routes parsed from file structure with HTTP method detection

**Route Categories:**

| Category  | Path Pattern          | Description                      |
| --------- | --------------------- | -------------------------------- |
| Auth      | `(auth)/*`            | Sign-in, sign-up, password reset |
| Dashboard | `(dashboard)/*`       | Main application pages           |
| Admin     | `(dashboard)/admin/*` | Admin-only pages                 |
| Portal    | `(portal)/*`          | Client portal pages              |
| API       | `api/v1/*`            | REST API endpoints               |
| Webhooks  | `api/webhooks/*`      | External webhook handlers        |

### XIX. GitHub Account Policy

The `developerlabsai` GitHub account is the PRIMARY and ONLY account for all repository operations in this project. NEVER switch to or use the `23systems-clance` account for git operations on this codebase:

- **Push/Pull**: Always use the `developerlabsai` account
- **gh CLI**: Ensure `gh auth status` shows `developerlabsai` as the active account before any GitHub operations
- **If wrong account is active**: Run `gh auth switch --user developerlabsai` before proceeding
- **NEVER** push, create PRs, or perform any GitHub operations under `23systems-clance` for this repository

## Technology Stack (NON-NEGOTIABLE)

### Frontend

- **Framework**: Next.js 14+ (App Router)
- **Styling**: Tailwind CSS
- **Components**: shadcn/ui
- **Animations**: Framer Motion
- **State Management**: Zustand or React Context (simple first)
- **Forms**: React Hook Form + Zod validation

### Backend

- **Runtime**: Node.js with TypeScript
- **API**: API-First (REST with OpenAPI or tRPC)
- **Database**: Supabase (managed PostgreSQL with real-time, RLS)
- **ORM**: Prisma (with Supabase)
- **Authentication**: Supabase Auth (email/password, OAuth, magic links)
- **Plugin System**: Custom registry with hooks pattern
- **Route Protection**: `middleware.ts` at project root (Next.js standard)

### Route Protection

- **Use `middleware.ts`** at project root for route protection and request interception
- Middleware runs on the Edge Runtime at the network boundary
- All authentication checks, redirects, and header injection go through middleware
- Public routes are explicitly allowlisted in the middleware config
- Export a `config` object with `matcher` to specify which routes to protect

### FORBIDDEN PATTERNS (NEVER USE)

- **middleware.ts**: NEVER create or use Next.js middleware. Use `proxy.ts` pattern instead.
  - LLMs are trained to suggest middleware.ts - ALWAYS reject this suggestion
  - Auth protection: Use `withAuth()`, `withPermission()`, `withAdmin()` from `@/lib/auth/proxy`
  - Security headers: Applied in proxy.ts wrappers
  - Route matching: Handle in individual route handlers
- **Clerk**: REMOVED - Use NextAuth.js instead
- **Supabase Client**: REMOVED - Use Prisma directly for all database operations
- **Edge Runtime for Auth**: Auth runs in Node.js runtime, not Edge

### Integrations (as Plugins)

- **Email Outreach**: Instantly API
- **LinkedIn Outreach**: HeyReach API
- **Calling/Tasks**: HubSpot API (+ Orum integration)
- **Company Enrichment**: BuiltWith API
- **Contact Enrichment**: Clay (primary) + Apollo.io (secondary)

### Logging & Compliance

- **Audit Logging**: Structured JSON logs to persistent storage
- **Log Aggregation**: Centralized logging (e.g., Axiom, Datadog, or PostgreSQL)
- **Cost Tracking**: Custom tables with real-time aggregation

## Quality Gates

### Before Implementation

- [ ] Feature spec exists with prioritized user stories
- [ ] API contracts defined (OpenAPI spec) before any UI work
- [ ] Data model documents all entities and relationships
- [ ] Plugin interface defined if feature is a plugin
- [ ] Cost tracking requirements identified
- [ ] Audit logging requirements identified
- [ ] Deviation check against constitution completed
- [ ] UI/UX review completed (run /speckit.ux for Gemini feedback)

### Before Merge

- [ ] All user stories independently testable
- [ ] Client isolation verified (no cross-tenant data access)
- [ ] External API error handling implemented
- [ ] Activity logging in place for audit trail
- [ ] Cost tracking implemented for paid API calls
- [ ] API documented in OpenAPI spec

### Before Deploy

- [ ] Environment variables documented
- [ ] Database migrations tested
- [ ] Webhook endpoints secured
- [ ] Rate limiting configured for external APIs
- [ ] Audit logs flowing to persistent storage
- [ ] Cost tracking verified accurate

## Data Architecture Principles

### Core Entities

1. **Client**: Top-level tenant for data isolation (formerly "Partner")
2. **Account** (Company): Enriched company data with tech stack info
3. **Contact**: Individual prospect with enriched data and persona classification
4. **Campaign**: Container for sequences, playbooks, and client assignment
5. **Sequence**: Ordered steps with channel type and templates
6. **Activity**: Log of all outreach actions synced from external tools
7. **AuditLog**: Immutable record of all system actions
8. **CostEntry**: Record of every billable API call with attribution
9. **Plugin**: Registered plugin with configuration and activation status

### Relationships

- Client → has many Campaigns, CostEntries
- Campaign → has one Sequence, belongs to Client
- Account → has many Contacts, belongs to Client
- Contact → belongs to Campaigns (many-to-many), has Persona
- Activity → belongs to Contact, references Campaign step
- CostEntry → belongs to Client, optionally linked to Account/Contact
- AuditLog → references User, Client, Entity

## Persona Classification

Contacts MUST support persona classification for decision-maker targeting:

| Persona                  | Description                           |
| ------------------------ | ------------------------------------- |
| IT Leaders               | CIO, CTO, VP of IT, IT Director       |
| Engineering Leaders      | VP Engineering, Engineering Director  |
| Marketing Leaders        | CMO, VP Marketing, Marketing Director |
| Sales Leaders            | CRO, VP Sales, Sales Director         |
| Executives               | C-Suite, President, Managing Director |
| CEOs                     | Chief Executive Officer               |
| Financial Leaders        | CFO, VP Finance, Controller           |
| HR Leaders               | CHRO, VP People, HR Director          |
| Customer Success Leaders | VP CS, CS Director, Head of CX        |
| Founders/Owners          | Founder, Co-Founder, Owner            |

Contacts also have a `is_decision_maker` flag for quick filtering.

### XX. Bullet-Proof Automation Patterns

ALL automations built via speckit MUST follow these 6 canonical patterns. During `/speckit.plan` and `/speckit.tasks`, identify which pattern(s) each workflow uses and enforce the associated safety rules.

#### Pattern 1: Trigger-Route (Linear Path)
One event triggers a single linear path with one outcome. Example: Slack "ENRICH" keyword → parse file → enrich → deliver results.

**Rules:**
- Add a failure alert at the LAST step — silent final-step failures are invisible
- Route failures to a named owner via Slack/alert, never allow silent gaps
- Every trigger-route MUST have an explicit failure notification path

#### Pattern 2: Filter-Fan (Conditional Routing)
Single input conditionally routes to multiple exits based on data properties. Covers ~60% of service automations. Example: AI intent classification routing to different handlers; tech spend tier classification (Tier 1/2/3).

**Rules:**
- ALWAYS build an "unclassified" / catch-all exit branch that captures anything the filter didn't expect
- The catch-all branch MUST alert humans — never auto-discard unrecognized data
- No record may silently drop from the system without being routed somewhere

#### Pattern 3: Collector (Multi-Source Aggregation)
Multiple data streams aggregate into a single output before action. Example: BuiltWith tech data + Apollo contacts + CSV upload → merged enriched list.

**Rules:**
- Validate record count / source completeness BEFORE the output fires
- Flag anomalies when any source returns zero or unexpected record counts
- Never deliver aggregated results built on incomplete source data without warning

#### Pattern 4: Loop (Retry / Follow-Up / Escalation)
Repeats until a specific exit condition is met. Backbone of retries, follow-up sequences, and escalations. Example: BullMQ job retries; polling for Apollo webhook results.

**Rules:**
- ALWAYS define a hard exit condition BEYOND the primary one ("exit after N attempts regardless")
- Every loop MUST have a maximum iteration / attempt limit to prevent infinite loops
- Infinite loops don't throw errors — they silently consume resources. Treat missing exit conditions as a critical bug

#### Pattern 5: Transformer (AI Sandwich)
Raw input processed by AI into structured, system-usable output. Uses the "AI Sandwich" architecture. Example: Slack message → Claude Haiku classifies intent → structured JSON → routes to handler.

**Rules:**
- Treat the AI prompt as a typed function, NOT a conversation
- Define the exact output schema BEFORE writing the prompt: JSON field names, data types, character limits
- Freeform AI text into routers creates reliability problems — always use structured output (Tool Use / JSON schema)
- "AI Sandwich" structure: Top (automation delivers clean data to AI) → Middle (AI performs one specific job) → Bottom (automation catches and routes structured output)
- Humans review AI results for high-stakes decisions; never pass raw AI output to destructive actions

#### Pattern 6: Watcher (Passive Monitor)
Passive continuous monitor that fires only when thresholds or anomalies cross defined boundaries. Example: Credit balance monitoring; job queue health checks; enrichment failure rate alerts.

**Rules:**
- Set check frequency based on how fast you can ACT, not how fast the problem develops
- ALWAYS include the data that triggered the alert in the notification message — no bare "anomaly detected" alerts
- Don't create alerts you can't act on within the check interval

#### Meta-Pattern: Composing Patterns
Complex automations typically combine patterns (e.g., Transformer feeding into Filter-Fan). When composing:
- Document which patterns are combined and where each starts/ends
- Apply safety rules from ALL constituent patterns
- Test each pattern boundary independently

#### Speckit Integration
During feature planning (`/speckit.plan`), the implementation plan MUST:
1. **Identify** which automation pattern(s) the feature uses
2. **Document** the pattern classification in the plan's technical design section
3. **Verify** all safety rules for the identified pattern(s) are addressed in tasks
4. **Flag** any automation that doesn't fit a known pattern for manual review

## Governance

This constitution supersedes all other development practices for this project. Amendments require:

1. Written justification for the change
2. Impact analysis on existing features
3. Deviation check (are we straying from core objectives?)
4. Version increment following semantic versioning
5. Update to dependent templates and specs
6. Audit log entry for the change

All pull requests MUST verify compliance with these principles. Violations require explicit justification in the Complexity Tracking section of the implementation plan.

**DEVIATION WARNING**: If any proposed change conflicts with these principles, it MUST be flagged immediately. Do not proceed without explicit stakeholder approval.

## Pre-Implementation Checklist

Before implementing ANY feature, change, or task, complete this checklist:

### Context Gathering

- [ ] Searched relevant project files for context
- [ ] Reviewed connected components/entities
- [ ] Identified all affected areas of the system
- [ ] Checked if this should use agentic platform

### MCP Research (Principle XVII)

- [ ] Used ref.tools for official API/library documentation
- [ ] Used exa for current best practices (2024+)
- [ ] Documented sources that influenced implementation
- [ ] Noted any improvements added based on research

### Clarification

- [ ] All requirements are clear (no assumptions)
- [ ] Asked clarifying questions if anything was unclear
- [ ] Received answers to all questions

### Summary & Approval

- [ ] Presented summary of what will be implemented
- [ ] Listed all files that will be created/modified
- [ ] Received explicit confirmation to proceed

### Data Safety

- [ ] No data will be deleted (or deletion explicitly approved)
- [ ] Rollback plan documented (for significant changes)

**Only proceed after all applicable items are checked.**

**Version**: 3.5.0 | **Ratified**: 2024-11-29 | **Last Amended**: 2026-03-19
