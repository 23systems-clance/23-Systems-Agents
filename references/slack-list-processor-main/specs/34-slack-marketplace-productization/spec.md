# Feature Specification: Slack Marketplace Productization — BDR Orchestrator

**Feature Branch**: `20-slack-marketplace-productization`
**Created**: 2026-03-11
**Status**: Draft
**Input**: Strategic productization analysis — converting internal BDR operations platform into a generic, self-service Slack Marketplace product.

> **NOTE: NEW PROJECT** — This specification describes the creation of a **new, standalone project** forked from the current codebase. The existing Slack List Processor continues as-is for DeveloperLabs internal use. This spec defines a new product ("BDR Orchestrator" or chosen brand name) built for the Slack App Directory, targeting any company with a BDR/SDR team that uses Slack.

## Context

The current Slack List Processor is a 13-feature, production-grade BDR operations platform custom-built for DeveloperLabs' agency model. It includes campaign management (Instantly/HeyReach/HubSpot), BDR onboarding/training, workflow automation, managed client/BDR models, and an operator admin dashboard — all designed for a single organization managing multiple client workspaces.

To sell on the Slack Marketplace, the product must be **generic** (works for any company), **self-service** (no admin intervention to onboard), and **focused** (core enrichment value, not agency operations). This means stripping agency-specific features, adding self-service onboarding/billing, and meeting Slack App Directory submission requirements.

### What Makes This a New Project

1. **Different architecture model**: Current = agency (one install, many managed clients). New = SaaS (each workspace is an independent tenant).
2. **Different feature set**: Current has 13 features. New product launches with 4-5 focused features.
3. **Different deployment model**: Current = single ECS deployment for one org. New = multi-tenant SaaS serving thousands of workspaces.
4. **Different billing model**: Current = admin-initiated magic links. New = self-service Stripe subscription with free tier.
5. **Different codebase trajectory**: Current continues evolving for DeveloperLabs. New product has its own roadmap.

### Competitive Landscape

- **Clay** — Spreadsheet-style enrichment tool with Slack notifications but no native Slack workflow
- **Clearbit/ZoomInfo** — Enterprise enrichment with limited Slack integration
- **Apollo.io native** — Has a Slack app but limited to notifications, no in-Slack enrichment
- **Our edge**: End-to-end enrichment workflow that never leaves Slack. Upload file → AI understands intent → enriched file delivered → all in the same thread.

## Clarifications

### Session 2026-03-11

- Q: Should this be a fork or a clean rewrite? -> A: Fork the current codebase, then strip agency features. The core enrichment pipeline, AI classification, billing credit model, and job queue are proven and should be reused.
- Q: What is the product name? -> A: TBD — working name "BDR Orchestrator" but final brand name will be decided separately. Codebase should use a configurable product name.
- Q: Should we use Slack Marketplace billing or our own Stripe? -> A: Our own Stripe. Slack Marketplace billing is limited and takes a revenue cut. We handle payments directly via Stripe Checkout.
- Q: Should BYOK (Bring Your Own Keys) be in v1? -> A: No. Phase 3 feature. v1 uses our API keys with credit-based pricing.
- Q: What happens to the existing project? -> A: Continues unchanged. This is a new repo/project.
- Q: Should the admin dashboard be customer-facing or internal only? -> A: Both. Customers get a lightweight self-service dashboard (usage, billing, settings). We keep an internal ops dashboard for monitoring all tenants.
- Q: What's the minimum feature set for Slack Marketplace launch? -> A: Core enrichment (technographic + contact + combined + tech reports), AI agent, self-service billing, and Slack App Home settings.

---

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Slack App Installation & Self-Service Onboarding (Priority: P1)

As a sales team leader, I want to install the BDR Orchestrator from the Slack App Directory and start enriching lists within 5 minutes, without contacting support or waiting for manual setup.

**Why this priority**: Without frictionless onboarding, no one gets to the core product. This is the gateway to all revenue.

**Independent Test**: Install the app from a test Slack App Directory listing, complete the welcome flow, and trigger a free-tier enrichment — all without any admin intervention.

**Acceptance Scenarios**:

1. **Given** a Slack workspace admin visits the App Directory listing, **When** they click "Add to Slack", **Then** they are taken through OAuth 2.0 V2 consent with minimal scopes (files:read, chat:write, commands, app_mentions:read, assistant:write, im:write).
2. **Given** the OAuth flow completes, **When** the app is installed, **Then** the app posts a welcome DM to the installer with: product overview, quick-start guide, and "Start Free Trial" button.
3. **Given** the installer clicks "Start Free Trial", **When** the free trial activates, **Then** the workspace receives 50 free enrichment credits (no payment required), and the App Home tab shows current balance and usage.
4. **Given** a newly installed workspace, **When** any workspace member uploads a CSV/XLSX to a channel where the bot is present, **Then** the bot detects the file and offers enrichment options (same UX as current product).
5. **Given** a workspace on the free tier with credits remaining, **When** a user triggers an enrichment, **Then** the enrichment proceeds without billing friction.
6. **Given** a workspace that exhausts free credits, **When** a user triggers an enrichment, **Then** the bot responds with: "You've used all 50 free credits. Upgrade to continue enriching." with a button linking to Stripe Checkout.
7. **Given** a workspace uninstalls the app, **When** the `app_uninstalled` event fires, **Then** the system marks the workspace as uninstalled, begins a 30-day data retention grace period, and sends a "Sorry to see you go" email if email is on file.

---

### User Story 2 - Core List Enrichment (Technographic + Contact + Combined) (Priority: P1)

As a BDR/SDR, I want to upload a company list in Slack and receive an enriched file with technographic data, decision-maker contacts, or both — without leaving Slack.

**Why this priority**: This is the core value proposition. Everything else supports this.

**Independent Test**: Upload a 10-row CSV with company domains, trigger combined enrichment, and verify the output file contains BuiltWith tech data + Apollo contacts with persona classification.

**Acceptance Scenarios**:

1. **Given** a user uploads a CSV with a "domain" column, **When** the bot detects the file, **Then** it presents enrichment type buttons: "Technographics", "Contacts", "Both", "Tech Report".
2. **Given** the user selects "Technographics", **When** the enrichment completes, **Then** the output file includes: domain, company name, tech stack, cloud provider, tech spend tier (TIER_1/2/3), technology count, traffic rank.
3. **Given** the user selects "Contacts", **When** prompted for purpose, **Then** they can choose: Cold Calling, Emailing, LinkedIn, Just a List, All — which determines contact data depth (phone numbers only for Cold Calling).
4. **Given** the user selects "Both", **When** the enrichment completes, **Then** a single output file contains both technographic columns and contact columns per company.
5. **Given** a natural language message like "find companies using Salesforce in the US", **When** the AI classifier routes it as a tech_report intent, **Then** a technology report is generated from BuiltWith search with the specified filters.
6. **Given** an enrichment job is processing, **When** the user checks progress, **Then** they see real-time stage updates in the Slack thread (parsing → validating → enriching → generating file).
7. **Given** a completed job, **When** the user wants to re-download, **Then** they can use `/enrich history` to find and re-download any past enrichment.
8. **Given** a file with 5,001+ rows, **When** uploaded, **Then** the bot rejects it with a clear message about the 5,000-row limit and suggests splitting the file.

---

### User Story 3 - Self-Service Billing & Subscription Management (Priority: P1)

As a workspace admin, I want to manage my subscription, view usage, and update payment methods without contacting support.

**Why this priority**: Self-service billing is required for SaaS scale. Manual billing doesn't work with 100+ customers.

**Independent Test**: Exhaust free credits, click upgrade, complete Stripe Checkout, verify credits are provisioned, and verify the App Home tab reflects the active subscription.

**Acceptance Scenarios**:

1. **Given** a workspace on the free tier, **When** the admin clicks "Upgrade" (from bot message or App Home), **Then** they are redirected to a Stripe Checkout page with plan options: Starter ($99/mo, 500 credits), Growth ($299/mo, 2,000 credits), Scale ($599/mo, 5,000 credits).
2. **Given** a successful Stripe Checkout, **When** payment is confirmed, **Then** the workspace status transitions to ACTIVE, credits are provisioned immediately, and a confirmation DM is sent to the admin.
3. **Given** an active subscription, **When** the billing cycle resets (monthly), **Then** credits reset to the plan allowance (unused credits do NOT roll over on standard plans).
4. **Given** an active subscription, **When** the workspace exceeds their monthly credit allowance, **Then** overage charges apply at the plan's per-credit overage rate and are billed to the card on file.
5. **Given** a workspace admin, **When** they visit the App Home "Billing" section, **Then** they see: current plan, credits remaining, credits used this cycle, next billing date, and a "Manage Subscription" link to Stripe Customer Portal.
6. **Given** a workspace admin, **When** they click "Manage Subscription" in App Home, **Then** they are redirected to the Stripe Customer Portal where they can: update payment method, change plan, view invoices, cancel subscription.
7. **Given** a subscription cancellation, **When** the current billing period ends, **Then** the workspace reverts to free tier (50 credits/mo) and all data is retained.
8. **Given** a failed payment (card declined), **When** Stripe retries fail after 3 attempts, **Then** the workspace status transitions to DELINQUENT, enrichments are blocked, and the admin receives a DM with a "Update Payment" link.

---

### User Story 4 - Slack App Home Tab (Settings & Usage Dashboard) (Priority: P1)

As a workspace admin or BDR team member, I want to view my usage, configure settings, and manage billing from the Slack App Home tab — no external dashboard needed.

**Why this priority**: Slack Marketplace apps that keep users inside Slack have higher retention. The App Home is the primary self-service surface.

**Independent Test**: Open the app's Home tab in Slack, verify it shows usage stats, billing status, and settings controls. Change a setting and verify it takes effect on the next enrichment.

**Acceptance Scenarios**:

1. **Given** any workspace member, **When** they open the app's Home tab, **Then** they see: workspace usage summary (credits used/remaining, jobs this month, last enrichment date).
2. **Given** a workspace admin, **When** they open the Home tab, **Then** they see admin-only sections: Billing (plan, credits, manage link), Settings (enrichment defaults, team permissions), and Quick Actions (upgrade, invite to channel).
3. **Given** the Settings section, **When** an admin toggles "Restrict enrichments to admins only", **Then** non-admin workspace members can no longer trigger enrichments (they see "Contact your workspace admin to enrich lists").
4. **Given** the Settings section, **When** an admin sets default enrichment type to "Combined", **Then** new file uploads default to combined enrichment (user can still override).
5. **Given** the Settings section, **When** an admin sets a default contact purpose (e.g., "Cold Calling"), **Then** contact enrichments skip the purpose selection step.
6. **Given** the Home tab, **When** usage data updates (job completes, credits deducted), **Then** the Home tab reflects changes on next open (not real-time, but fresh on each view).

---

### User Story 5 - AI Conversational Agent (Side Panel) (Priority: P2)

As a BDR, I want to interact with the enrichment bot via natural language in the Slack side panel, asking questions like "enrich this with contacts" or "what's the status of my last job" without memorizing commands.

**Why this priority**: The conversational AI interface is the UX differentiator vs. competitors. It makes the product feel magical. But it works without it (slash commands still function), so P2.

**Independent Test**: Open the assistant side panel, ask "enrich the file I just uploaded with technographic data", and verify it triggers the correct enrichment flow.

**Acceptance Scenarios**:

1. **Given** a user opens the assistant side panel, **When** the thread starts, **Then** the agent posts a greeting with 4 suggested prompts: "Enrich a list", "Find contacts", "Check job status", "Generate tech report".
2. **Given** a user types "enrich my file with contacts for cold calling", **When** the agent classifies intent, **Then** it routes to the contact enrichment flow with purpose=COLD_CALLING.
3. **Given** a user asks "what's the status of my last enrichment?", **When** the agent queries job history, **Then** it responds with the most recent job's status, progress, and result link if completed.
4. **Given** the agent conversation, **When** multiple turns occur, **Then** the agent maintains context (remembers which file, which enrichment type) within the same thread.
5. **Given** a 7-day old agent thread, **When** the retention policy runs, **Then** conversation turns are purged and an audit summary is retained.

---

### User Story 6 - CRM-Formatted Export (Priority: P2)

As a BDR, I want to export enriched data in a format that imports directly into my CRM (Salesforce, HubSpot, Pipedrive, Attio) without manual column mapping.

**Why this priority**: The enrichment is only valuable if it gets into the CRM. Reducing import friction increases stickiness and perceived value.

**Independent Test**: Complete an enrichment, select "Export for HubSpot", and verify the output CSV has HubSpot-compatible column headers that import without mapping.

**Acceptance Scenarios**:

1. **Given** a completed enrichment job, **When** the result is delivered, **Then** the bot includes an additional button: "Export for CRM" alongside the standard download.
2. **Given** the user clicks "Export for CRM", **When** the export modal appears, **Then** they see options: Salesforce, HubSpot, Pipedrive, Attio, Generic CSV.
3. **Given** the user selects "HubSpot", **When** the export generates, **Then** the CSV uses HubSpot standard property names: `Company name`, `Company Domain Name`, `First Name`, `Last Name`, `Email`, `Phone Number`, `Job Title`, `LinkedIn`, `City`, `State/Region`, `Country`.
4. **Given** the user selects "Salesforce", **When** the export generates, **Then** the CSV uses Salesforce standard field names: `Account Name`, `Website`, `First Name`, `Last Name`, `Email`, `Phone`, `Title`, `LinkedIn Profile`, etc.
5. **Given** a workspace admin, **When** they set a default CRM in App Home Settings, **Then** all future exports default to that CRM format (user can still override per-export).

---

### User Story 7 - Filter, Split & Analyze Commands (Priority: P2)

As a BDR manager, I want to filter enriched lists by criteria, split them into smaller chunks for team distribution, and generate AI-powered analysis reports.

**Why this priority**: These are high-value utilities that make the product "sticky" beyond one-time enrichment. But they require a completed enrichment first, so P2.

**Independent Test**: Complete an enrichment, use `/filter` to extract only TIER_1 tech spend companies, `/split` to divide into quarters, and `/analyze` to generate a summary report.

**Acceptance Scenarios**:

1. **Given** a completed enrichment, **When** the user runs `/filter`, **Then** they can build filter expressions on any enriched column (tech spend tier, persona type, cloud provider, technology, location).
2. **Given** a completed enrichment, **When** the user runs `/split half`, **Then** the enriched file is split into two equal files delivered as separate messages.
3. **Given** a completed enrichment, **When** the user runs `/analyze`, **Then** an AI-generated analysis report is produced summarizing: industry breakdown, tech stack trends, persona distribution, geographic coverage, and enrichment quality metrics.

---

### User Story 8 - Internal Ops Dashboard (Priority: P3)

As the product operator (us), I need an internal dashboard to monitor all tenant workspaces, track platform-wide usage/costs, manage credit rates, and troubleshoot issues.

**Why this priority**: Critical for operations but not customer-facing. Can launch with basic monitoring and iterate.

**Independent Test**: Log into the ops dashboard, view all workspace installations, check platform-wide API cost trends, and adjust global credit rates.

**Acceptance Scenarios**:

1. **Given** an ops team member, **When** they access the internal dashboard, **Then** they see: total workspaces, total jobs (today/week/month), platform API costs, error rate, revenue summary.
2. **Given** the workspace list, **When** an ops member clicks a workspace, **Then** they see: workspace name, plan, credits used, jobs run, install date, last active, billing status.
3. **Given** the credit rates page, **When** an ops member updates the BuiltWith credit cost or markup percentage, **Then** all future enrichments use the new rate (existing in-flight jobs use snapshotted rates).
4. **Given** the error log, **When** API errors spike, **Then** the dashboard shows the error trend and allows drill-down to specific failed jobs.
5. **Given** platform-wide monitoring, **When** a workspace exceeds normal usage patterns, **Then** the system flags it for review (abuse detection).

---

### Edge Cases

- What happens when a workspace installs the app but never triggers an enrichment? Free credits expire after 90 days of inactivity. App Home shows "Your trial credits will expire in X days."
- What happens when two users in the same workspace upload files simultaneously? Both jobs are processed independently with their own credit deductions. No cross-contamination.
- What happens when Slack's API is rate-limited during file delivery? The system retries with exponential backoff (3 attempts). If all fail, the result is stored in S3 and the user gets a direct download link.
- What happens when BuiltWith or Apollo APIs are down? The system marks the job as FAILED with a user-friendly message and does NOT deduct credits for failed enrichments.
- What happens when a workspace downgrades from Growth to Starter mid-cycle? The downgrade takes effect at the next billing cycle. Current cycle credits are not clawed back.
- What happens when a workspace has negative credits (overage) and cancels? The final overage charge is billed before cancellation completes.
- What happens when someone installs the app in a free Slack workspace? The app works normally. Slack free workspaces have message history limits but the bot's enrichment flow works within those constraints.
- What happens when the Slack App Directory review rejects the submission? Common rejection reasons are addressed in FR requirements: privacy policy, minimal scopes, uninstall handling, token rotation, app description quality.

## Requirements _(mandatory)_

### Functional Requirements

**New Project Setup**
- **FR-001**: System MUST be a standalone codebase (new repository) forked from the current Slack List Processor, with agency-specific features removed.
- **FR-002**: System MUST remove the following feature modules from the fork: Campaign Management (Feature 8), BDR Onboarding (Feature 7), BDR Manager Agent (Feature 6), Workflow Builder (Feature 9), Managed Clients/BDRs, Channel-to-Client Mappings.
- **FR-003**: System MUST remove the following Prisma models from the fork: `ManagedClient`, `Bdr`, `BdrClient`, `Campaign*` (all campaign models), `OnboardingPlan`, `OnboardingModule`, `TrainingItem`, `OnboardingEnrollment`, `ModuleProgress`, `CheckinResponse`, `ContentLibraryItem`, `WorkflowTemplate`, `WorkflowVersion`, `WorkflowExecution`, `WebhookEndpoint`, `WebhookLog`, `WorkflowCustomTemplate`, `DocsChannelConfig`, `ChannelConfigDoc`, `DailyBdrActivity`, `EodReport`, `UniboxReply`.
- **FR-004**: System MUST retain and adapt the following core modules: enrichment pipeline (technographic, contact, combined, tech report), AI intent classification, persona classification, job queue (BullMQ), file parsing/generation, billing credit system, Slack Agent assistant, error logging, audit trail.
- **FR-005**: Product name MUST be configurable via environment variable (`PRODUCT_NAME`) and used in all Slack messages, App Home, and user-facing text.

**OAuth & Installation**
- **FR-006**: System MUST implement Slack OAuth 2.0 V2 install flow with token rotation support.
- **FR-007**: System MUST request only minimal OAuth scopes: `files:read`, `chat:write`, `commands`, `app_mentions:read`, `assistant:write`, `im:write`, `im:history`, `users:read`.
- **FR-008**: System MUST auto-provision a workspace record with FREE tier billing profile on successful OAuth install (no admin intervention).
- **FR-009**: System MUST post a welcome DM to the installing user with: product overview, quick-start guide (3 steps), and "Start Free Trial" button.
- **FR-010**: System MUST handle `app_uninstalled` event by: marking workspace as uninstalled, beginning 30-day data retention countdown, and optionally sending a farewell email.
- **FR-011**: System MUST handle `tokens_revoked` event by invalidating stored tokens and marking workspace as inactive.

**Self-Service Billing**
- **FR-012**: System MUST support 4 billing tiers: Free (50 credits/mo, no payment required), Starter ($99/mo, 500 credits), Growth ($299/mo, 2,000 credits), Scale ($599/mo, 5,000 credits). Tier names and pricing MUST be configurable.
- **FR-013**: System MUST provision free-tier credits automatically on install with no payment method required.
- **FR-014**: Upgrade flow MUST use Stripe Checkout Sessions (not custom payment forms) for PCI compliance.
- **FR-015**: System MUST integrate Stripe Customer Portal for self-service: update payment method, change plan, view invoices, cancel subscription.
- **FR-016**: System MUST handle Stripe webhooks for: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_succeeded`, `invoice.payment_failed`.
- **FR-017**: System MUST enforce billing gates: free tier users blocked after 50 credits with upgrade prompt; paid tier users allowed overage (charged to card on file).
- **FR-018**: System MUST NOT roll over unused credits on standard plans. Credits reset to plan allowance on each billing cycle.
- **FR-019**: On subscription cancellation, workspace MUST revert to free tier at end of current billing period (no immediate cutoff).
- **FR-020**: On payment failure after 3 Stripe retry attempts, workspace MUST transition to DELINQUENT status with enrichments blocked and admin DM with "Update Payment" link.

**Slack App Home Tab**
- **FR-021**: System MUST implement a Slack App Home tab using Block Kit that displays: usage summary (credits used/remaining, jobs this month), billing status (plan name, next billing date), and quick actions.
- **FR-022**: App Home MUST show admin-only sections (detected via Slack `users.info` `is_admin` field) for: billing management, workspace settings, team permissions.
- **FR-023**: App Home Settings MUST include: default enrichment type, default contact purpose, restrict enrichments to admins only (boolean), default CRM export format.
- **FR-024**: App Home MUST refresh data on each `app_home_opened` event (not cached stale data).

**Core Enrichment (Retained)**
- **FR-025**: System MUST support 4 enrichment types: technographic (BuiltWith), contact (Apollo), combined (both), and tech report (BuiltWith search).
- **FR-026**: System MUST retain the AI intent classifier (Claude Haiku) for natural language enrichment triggers.
- **FR-027**: System MUST retain the 14-persona classification system with fast lookup + AI fallback.
- **FR-028**: System MUST retain the tech spend tier scoring (TIER_1/2/3/UNCLASSIFIED).
- **FR-029**: System MUST enforce a 5,000-row hard maximum per file upload.
- **FR-030**: System MUST retain job history with re-download capability (`/enrich history`).
- **FR-031**: System MUST retain real-time progress updates in Slack threads.

**CRM Export**
- **FR-032**: System MUST support CRM-formatted exports for: Salesforce, HubSpot, Pipedrive, Attio, and Generic CSV.
- **FR-033**: Each CRM format MUST map enriched columns to that CRM's standard import field names.
- **FR-034**: System MUST allow workspace admins to set a default CRM format in App Home Settings.

**Filter/Split/Analyze**
- **FR-035**: System MUST retain `/filter`, `/split`, and `/analyze` slash commands with existing functionality.
- **FR-036**: `/analyze` MUST generate AI-powered reports using Claude (same as current implementation).

**Multi-Tenant Operations**
- **FR-037**: All data MUST be isolated by `slackTeamId` — no cross-workspace data leakage.
- **FR-038**: System MUST support concurrent enrichment jobs across different workspaces without interference.
- **FR-039**: Credit deductions MUST be atomic (PostgreSQL advisory locks) to prevent race conditions on shared credit balance.
- **FR-040**: System MUST implement per-workspace rate limiting: Free (5 concurrent jobs), Starter (10), Growth (25), Scale (50).

**Internal Ops Dashboard**
- **FR-041**: System MUST retain a simplified admin dashboard (React/Vite) for internal operations.
- **FR-042**: Ops dashboard MUST show: all workspace installations, platform-wide API costs, global error log, credit rate configuration, revenue summary.
- **FR-043**: Ops dashboard MUST NOT be accessible to customers — it is for the product operator only.
- **FR-044**: Ops dashboard MUST support abuse detection: flag workspaces with unusual usage patterns (> 3x average for their tier).

**Slack App Directory Requirements**
- **FR-045**: App listing MUST include: clear description, feature screenshots, privacy policy URL, terms of service URL, support URL/email, app icon (512x512), and category tags.
- **FR-046**: System MUST handle token rotation (Slack's automatic token refresh for OAuth V2).
- **FR-047**: System MUST respond to Slack API events within 3 seconds (acknowledge immediately, process async).
- **FR-048**: System MUST implement proper error responses for all Slack interactions (no silent failures).
- **FR-049**: Privacy policy MUST describe: what data is collected, how it's stored, retention periods, deletion on uninstall, third-party data sharing (BuiltWith, Apollo, Stripe).

**Data Privacy & Compliance**
- **FR-050**: System MUST delete all workspace data within 30 days of uninstall (configurable).
- **FR-051**: System MUST support workspace-level data export on request (GDPR right of access).
- **FR-052**: System MUST NOT store raw file contents after enrichment is complete — only structured enrichment results.
- **FR-053**: Uploaded files MUST be deleted from S3 within 24 hours of job completion. Result files retained for 30 days (configurable).

### Key Entities

- **WorkspaceInstallation**: Extended to include: plan tier, subscription status, Stripe customer ID, Stripe subscription ID, free trial start date, settings JSON (default enrichment type, default purpose, default CRM, restrict to admins), installed by user ID, install date, last active date.
- **BillingProfile**: Adapted for subscription model: plan tier (FREE/STARTER/GROWTH/SCALE), monthly credit allowance, current credit balance, overage rate (per plan), Stripe customer ID, Stripe subscription ID, billing cycle day, status (ACTIVE/DELINQUENT/CANCELLED).
- **SubscriptionPlan**: Global plan definitions: name, monthly price (cents), credit allowance, overage rate per credit, max concurrent jobs, features enabled (JSON).
- **Job**: Retained as-is, scoped by slackTeamId.
- **CreditTransaction**: Retained as-is (immutable append-only ledger).
- **CrmExportTemplate**: CRM name, column mappings (enriched field → CRM field name), format version.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: New workspace can go from "Add to Slack" to first enrichment result in under 5 minutes with zero human support intervention.
- **SC-002**: Slack App Directory submission passes review on first attempt (no rejections for missing requirements).
- **SC-003**: Free-to-paid conversion rate exceeds 5% within 90 days of launch.
- **SC-004**: Average enrichment latency remains under 30 seconds for files with 100 or fewer rows.
- **SC-005**: System supports 500+ concurrent workspace installations without performance degradation.
- **SC-006**: Zero cross-workspace data leakage incidents (verified by automated tenant isolation tests).
- **SC-007**: Customer churn rate below 10% monthly after the first 3 months.
- **SC-008**: Stripe subscription lifecycle (create, upgrade, downgrade, cancel, failed payment) handles all edge cases without manual intervention.
- **SC-009**: App Home tab loads in under 2 seconds on every open.
- **SC-010**: CRM-formatted exports import into target CRM without manual column mapping for all 4 supported CRMs.

## Assumptions

- The new project will be a Git fork of the current codebase with agency features surgically removed, not a ground-up rewrite.
- BuiltWith and Apollo API keys will be owned by the product operator (us). Customers do not bring their own keys in v1.
- Pricing tiers and credit costs are configurable and will be tuned based on actual API cost data from the current production system.
- The Slack App Directory review process takes 2-4 weeks. The product must be fully functional before submission.
- Stripe Checkout and Customer Portal handle PCI compliance — no credit card data touches our servers.
- The internal ops dashboard reuses the existing admin-dashboard React app with modifications (remove customer-facing routes, add tenant overview).
- The AI agent (Feature 5 - Slack Assistant) is retained in full as a core differentiator.
- Socket Mode is used for development/testing. For Slack Marketplace at scale, the product may need to migrate to Events API (HTTP) to support multiple concurrent WebSocket connections. This architectural decision should be evaluated during Phase 2.
- All enrichment workers, job queue, and billing logic are reused from the current codebase with minimal changes.

## Phased Delivery

### Phase 1: Strip & Genericize (Weeks 1-6)
- Fork codebase to new repository
- Remove agency features (campaigns, onboarding, workflow builder, managed clients)
- Clean Prisma schema (remove ~50 unused models)
- Implement self-service OAuth install with auto-provisioning
- Add Slack App Home tab (usage, settings, billing)
- Convert billing to Stripe Checkout subscriptions with free tier
- Add team permissions (admin/member enrichment controls)
- Add CRM-formatted export templates

### Phase 2: Marketplace Submission (Weeks 7-10)
- Privacy policy, terms of service, support infrastructure
- GDPR data controls (export, delete on uninstall)
- Per-workspace rate limiting and abuse detection
- Comprehensive test suite (tenant isolation, billing lifecycle, enrichment pipeline)
- Landing page / marketing site
- Slack App Directory submission
- Internal ops dashboard adaptation

### Phase 3: Growth Features (Post-Launch)
- BYOK (Bring Your Own Keys) for enterprise tier
- Webhook/Zapier output integration
- Enrichment templates (saved filter presets)
- Direct CRM write-back integrations (HubSpot, Salesforce, Attio)
- Usage analytics and insights within Slack
- Workflow builder (reintroduced as premium feature)
- Annual billing plans with discount
