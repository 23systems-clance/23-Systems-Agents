# Feature Specification: Multi-Tenant SaaS Licensing

**Feature Branch**: `35-multi-tenant-saas-licensing`
**Created**: 2026-03-18
**Status**: Draft
**Input**: User description: "Convert the internal Slack enrichment system into a licensable multi-tenant SaaS product. Require license keys for activation. Platform owner can toggle features (enrichment, outreach, analysis) per client. Client onboarding flow: billing -> channel assignment -> enrich. Different client-facing dashboard vs. platform owner dashboard. Credit cost preview before enrichment. Cancel/go back for mistakes. Send copy to (email/Slack). Private enrichment channels per user. ICP/one-pager analysis channel. Optional personality analysis (AIARC) and job postings/news (Apollo). Determine single vs. two Slack apps."

## Context

The Slack List Processor is currently an internal BDR operations platform built for DeveloperLabs. It includes enrichment (BuiltWith + Apollo), campaign management, BDR onboarding, workflow automation, and an admin dashboard. The system needs to be converted into a licensable multi-tenant SaaS product that can be delivered to external clients, starting with core enrichment features. Unlike spec 34 (which proposes forking to a new repo), this approach keeps everything in the same application with per-client feature toggles controlled by the platform owner.

### Architecture Decision: Single App vs. Two Slack Apps

**Recommendation: Single Slack App** with feature gating.

**Rationale:**
- The existing codebase already scopes all data by `slackTeamId` (workspace ID), providing natural multi-tenant isolation
- A single Slack app means one OAuth install flow, one Socket Mode connection, one set of event handlers
- Feature toggles on `WorkspaceInstallation.settings` can enable/disable entire feature modules per workspace
- Platform owner workspaces get all features enabled; client workspaces start with enrichment-only
- The existing billing system (`BillingProfile`) is already per-workspace with credit isolation
- Two apps would mean duplicate infrastructure, duplicate maintenance, and duplicated code divergence over time

**How it works:**
- When a client installs the Slack app, the platform owner creates their workspace record with a license key and assigns which features are enabled
- The app checks the workspace's feature flags before exposing commands, listeners, and dashboard sections
- As features mature, the platform owner enables them per-client without any app reinstallation

---

## Clarifications

### Session 2026-03-18

- Q: What distinguishes a "client admin" from a "client user" in a client workspace? → A: Use Slack's native workspace admin role — workspace admins (`is_admin` from Slack API) are client admins with access to billing, settings, and channel management; all other workspace members are client users limited to enrichment operations.
- Q: What happens to an already-activated workspace when its license key expires? → A: License key expiration only blocks new activations. Already-activated workspaces continue operating on their billing subscription indefinitely. The key is a one-time activation gate, not an ongoing access control mechanism.
- Q: How do clients replenish credits after initial allocation? → A: Monthly subscription with credit allowance (credits reset each billing cycle, overage billed to card). Additionally, on-demand credit packs are available for purchase as an upsell to entice users to buy more beyond their monthly allowance.
- Q: How does the DeveloperLabs internal workspace coexist with external client workspaces? → A: Platform owner workspace is auto-detected (hardcoded team ID or config flag), exempt from billing and licensing, all features enabled by default. No license key required for the platform owner.
- Q: Should the MVP use the AI agent (side panel) or channel-only interactions? → A: Channel-only for MVP — file uploads, slash commands, and button interactions in channels. The AI agent side panel is not included in the MVP and will be available as a future feature toggle.

---

## User Scenarios & Testing _(mandatory)_

### User Story 1 - License Key Activation & Client Onboarding (Priority: P1)

As a new client, I want to install the Slack app and activate it with a license key so that I can start using enrichment features in my workspace. The onboarding guides me through billing setup and channel assignment before I can begin enriching.

**Why this priority**: Without onboarding, no client can use the product. This is the gateway to all client revenue and the first impression of the product experience.

**Independent Test**: Install the Slack app in a test workspace, enter a license key, complete billing setup, assign an enrichment channel, and trigger a test enrichment — all without platform owner manual intervention beyond initial license key generation.

**Acceptance Scenarios**:

1. **Given** a client workspace admin installs the Slack app via OAuth, **When** the installation completes, **Then** the app posts a welcome DM to the installer with a prompt to enter their license key.
2. **Given** the installer enters a valid license key, **When** the system validates the key, **Then** the workspace is activated with the features assigned to that license tier, and the user is guided to Step 1: Billing Setup.
3. **Given** an invalid or expired license key is entered, **When** validation fails, **Then** the user receives a clear error message with instructions to contact the platform owner for a valid key.
4. **Given** the license key is accepted, **When** the user reaches Step 1 (Billing), **Then** they are presented with a billing setup flow (credit card or invoice) via Stripe Checkout to fund their credit balance.
5. **Given** billing is complete, **When** the user reaches Step 2 (Channel Assignment), **Then** they are guided to create or select a private Slack channel for enrichment, which gets assigned to their workspace.
6. **Given** channel assignment is complete, **When** onboarding finishes, **Then** the user can immediately upload a file and trigger enrichment in their assigned channel.
7. **Given** a workspace that has already completed onboarding, **When** the app is opened again, **Then** the onboarding flow is skipped and the user goes directly to the enrichment experience.
8. **Given** the platform owner generates a license key, **When** they assign feature flags to it, **Then** only those features are available to the client workspace (e.g., enrichment only, no campaigns).

---

### User Story 2 - Core Enrichment with Credit Preview & Cancellation (Priority: P1)

As a client user, I want to enrich a company list and see how many credits it will cost before proceeding, with the ability to cancel or go back if I made a mistake.

**Why this priority**: This is the core value proposition. Enrichment is the primary feature for the MVP beta. Credit transparency and cancellation prevent costly mistakes and build trust.

**Independent Test**: Upload a 50-row CSV, view the credit cost estimate, confirm enrichment, then separately test cancelling before enrichment starts. Verify credits are only deducted on completed enrichments.

**Acceptance Scenarios**:

1. **Given** a client user uploads a CSV/XLSX file in their enrichment channel, **When** the bot detects the file, **Then** it parses the file and presents enrichment options (Technographic, Contacts, Both, Tech Report).
2. **Given** the user selects an enrichment type, **When** the selection is made, **Then** the bot displays a credit cost estimate showing: estimated credits for this job, current credit balance, and remaining balance after enrichment.
3. **Given** the credit preview is shown, **When** the user clicks "Confirm & Enrich", **Then** the enrichment job begins processing with real-time progress updates in the thread.
4. **Given** the credit preview is shown, **When** the user clicks "Cancel" or "Go Back", **Then** no credits are deducted, the job is not created, and the user can re-upload or change their enrichment selection.
5. **Given** an enrichment job is in progress (before completion), **When** the user clicks "Cancel Job", **Then** the job stops processing, only credits for already-completed rows are deducted, and a partial result file is offered if any rows were enriched.
6. **Given** an enrichment job fails due to an API error, **When** the failure is detected, **Then** no credits are deducted for failed rows and the user is notified with a clear error message.
7. **Given** a workspace has insufficient credits for the estimated cost, **When** the credit preview is shown, **Then** the bot warns the user and offers options to "Buy Credit Pack" (one-time top-up via Stripe) or "Manage Subscription" (upgrade monthly tier).

---

### User Story 3 - Send Copy To (Email or Slack) (Priority: P1)

As a client user, I want to send a copy of my enrichment results to a colleague via email or another Slack channel so that I can share the data without manually downloading and forwarding.

**Why this priority**: Sharing results is a core workflow need. Users often enrich lists for team members who aren't in the same Slack channel.

**Independent Test**: Complete an enrichment, click "Send Copy To", choose email delivery, enter an email address, and verify the recipient receives the enrichment file. Separately test Slack channel delivery.

**Acceptance Scenarios**:

1. **Given** an enrichment job completes, **When** the result file is delivered in the thread, **Then** a "Send Copy To" button appears alongside the download button.
2. **Given** the user clicks "Send Copy To", **When** the share modal opens, **Then** they can choose between "Email" and "Slack Channel" as delivery methods.
3. **Given** the user selects "Email", **When** they enter one or more email addresses, **Then** the enrichment result file is sent as an email attachment with a summary of the enrichment (row count, enrichment type, date).
4. **Given** the user selects "Slack Channel", **When** they search for and select a channel (both public and private channels shown), **Then** the result file is posted to that channel with context about the enrichment.
5. **Given** the user selects a private channel they are not a member of, **When** they attempt to share, **Then** the system informs them that the bot must be invited to the channel first and provides instructions.

---

### User Story 4 - Private Enrichment Channels Per User (Priority: P1)

As a client admin, I want to assign enrichment access to specific users by having them create private channels, so that enrichment data stays private to the user who requested it and I can control who has enrichment access.

**Why this priority**: Channel-based access control is the primary way clients manage who can enrich. This replaces admin-level RBAC with a Slack-native approach that clients understand intuitively.

**Independent Test**: As a client admin, designate a user for enrichment access. That user creates a private channel, the system assigns it to them, and they can enrich. Another user without an assigned channel cannot trigger enrichments.

**Acceptance Scenarios**:

1. **Given** a client workspace with enrichment enabled, **When** a user creates a private Slack channel and invites the bot, **Then** the bot detects the channel and asks if this should be registered as that user's enrichment channel.
2. **Given** the user confirms channel registration, **When** the system registers it, **Then** the channel is assigned to that specific Slack user, and only files uploaded by that user in that channel trigger enrichment.
3. **Given** a user with a registered enrichment channel, **When** they upload a file in that channel, **Then** the enrichment flow triggers normally with credit deduction from the workspace's billing profile.
4. **Given** a user without a registered enrichment channel, **When** they upload a file in any channel, **Then** the bot does not trigger enrichment and responds with instructions on how to set up their enrichment channel.
5. **Given** a client admin, **When** they view the list of registered enrichment channels, **Then** they can see which users have channels and can deactivate a user's channel to revoke enrichment access.
6. **Given** the system lists available channels for any selection UI, **When** channels are displayed, **Then** both public and private channels are shown (filtered to channels where the bot is a member).

---

### User Story 5 - Platform Owner Feature Toggle Management (Priority: P1)

As the platform owner, I want to toggle major feature modules on or off per client workspace so that I can control which capabilities each client has access to, release features incrementally, and focus development on specific areas.

**Why this priority**: Feature toggling is the foundation of the licensing model. Without it, all clients get all features (including unfinished ones), which creates support burden and unpredictable behavior.

**Independent Test**: In the platform owner dashboard, toggle off the "Campaigns" feature for a client workspace. Verify that the client can no longer access campaign-related commands or dashboard sections.

**Acceptance Scenarios**:

1. **Given** the platform owner opens a client workspace's settings in the admin dashboard, **When** they view the feature toggles panel, **Then** they see a list of toggleable features: Enrichment, Campaigns, Workflows, Onboarding, Dialer, Analytics, ICP Analysis, Personality Analysis.
2. **Given** the platform owner disables "Campaigns" for a client, **When** a user in that workspace tries to access campaign commands, **Then** the system responds with "This feature is not available on your current plan."
3. **Given** the platform owner enables "ICP Analysis" for a client, **When** a user in that workspace accesses analysis features, **Then** ICP analysis commands and channels become functional.
4. **Given** a feature toggle is changed, **When** the toggle is saved, **Then** the change takes effect immediately without requiring the client to reinstall the Slack app.
5. **Given** the platform owner creates a new license key, **When** they configure the key, **Then** they can preset which features are enabled for workspaces that activate with that key.
6. **Given** multiple workspaces, **When** the platform owner views the workspace list, **Then** they can see at a glance which features are enabled for each workspace.

---

### User Story 6 - Client Dashboard (Priority: P2)

As a client workspace admin, I want a lightweight dashboard to view my usage, manage billing, see enrichment history, and configure settings — separate from the platform owner's admin dashboard.

**Why this priority**: Clients need self-service access to usage and billing without requiring platform owner intervention. However, the Slack in-app experience handles core workflows, so the dashboard is supplementary.

**Independent Test**: A client admin logs into the client dashboard, views their credit balance, reviews enrichment job history, and updates their billing payment method — all without seeing any platform-owner-level data or controls.

**Acceptance Scenarios**:

1. **Given** a client admin accesses the client dashboard URL, **When** they authenticate (via Slack OAuth or magic link), **Then** they see only their workspace's data: credit balance, usage stats, and enrichment history.
2. **Given** the client dashboard billing section, **When** the admin views billing, **Then** they see: current credit balance, monthly usage, payment method on file, transaction history, and "Add Credits" / "Manage Billing" actions.
3. **Given** the client dashboard enrichment history section, **When** the admin views history, **Then** they see all jobs run by their workspace with: date, user, row count, enrichment type, credits used, and download link.
4. **Given** the client dashboard settings section, **When** the admin views settings, **Then** they can configure: default enrichment type, registered enrichment channels, and notification preferences.
5. **Given** a client admin, **When** they try to access platform-owner routes or other workspace data, **Then** they are denied with a 403 error — strict data isolation is enforced.
6. **Given** the platform owner dashboard, **When** the platform owner views a client's workspace, **Then** they see everything the client sees plus: feature toggles, license key details, and admin controls.

---

### User Story 7 - ICP & One-Pager Analysis Channel (Priority: P2)

As a client user, I want a dedicated channel for uploading ICP information, case studies, and campaign details so that the system can generate comprehensive analysis reports against company or contact lists using that context.

**Why this priority**: Analysis reports are a high-value differentiator but depend on enrichment (P1) being functional first. The analysis leverages existing ICP document and AI orchestration infrastructure.

**Independent Test**: Set up an ICP channel, upload ICP document and case studies, then request an analysis report against an enriched list. Verify the report references ICP criteria, use cases, and case studies in its recommendations.

**Acceptance Scenarios**:

1. **Given** a client workspace, **When** the admin designates a channel as the "ICP & Analysis" channel, **Then** the system recognizes uploads in that channel as configuration documents (ICP, use cases, case studies).
2. **Given** ICP documents are uploaded to the analysis channel, **When** the system processes them, **Then** it extracts and stores the ICP definition, use cases, and case study information for that workspace.
3. **Given** a client user requests an analysis report on an enriched list, **When** the system generates the report, **Then** it leverages the stored ICP criteria, campaign information, use cases, and case studies to build a contextualized plan for the company.
4. **Given** no ICP documents have been uploaded, **When** a user requests an analysis report, **Then** the system generates a generic analysis and suggests uploading ICP documents for more targeted results.
5. **Given** the analysis report is complete, **When** the report is delivered, **Then** it follows a standardized template format (to be provided by the platform owner) and can be shared via "Send Copy To."

---

### User Story 8 - Optional Personality Analysis & Company Intelligence (Priority: P3)

As a client user, I want to optionally run personality analysis (via AIARC) on contacts and view job postings/latest news for companies (via Apollo) as standalone on-demand actions, not as part of any automated workflow.

**Why this priority**: These are value-add features that enhance the enrichment data but are not required for the core enrichment workflow. They should be simple, user-triggered actions.

**Independent Test**: After enriching a list, select a contact and trigger personality analysis. Separately, select a company and view its latest job postings and news. Verify both work independently without being tied to any workflow or campaign.

**Acceptance Scenarios**:

1. **Given** an enriched contact with a LinkedIn URL, **When** the user triggers "Analyze Personality", **Then** the system calls AIARC and returns a personality profile (DISC, OCEAN, communication style, email approach) in a formatted Slack message.
2. **Given** an enriched company, **When** the user triggers "View Job Postings & News", **Then** the system calls Apollo to retrieve current job postings and recent company news, displayed in a formatted Slack message.
3. **Given** a workspace where personality analysis is disabled by the platform owner, **When** the user looks for the "Analyze Personality" option, **Then** it is not shown.
4. **Given** a user triggers personality analysis, **When** credits are required, **Then** the credit cost is shown before proceeding, consistent with the enrichment preview pattern.
5. **Given** these features, **When** they are used, **Then** they operate as standalone actions accessible from enrichment results — they are not injected into any automated workflow or campaign sequence.

---

### Edge Cases

- What happens when a license key is used by a second workspace? License keys are single-use. The system rejects the key with "This license key has already been activated" and suggests contacting the platform owner.
- What happens when a client's credit balance reaches zero mid-enrichment? The job completes processing of already-queued rows, deducts credits for completed rows only, and delivers a partial result. The user is notified about insufficient credits with a link to add more.
- What happens when the platform owner disables enrichment for a workspace that has jobs in progress? In-progress jobs complete normally. New enrichment requests are blocked with "Enrichment has been disabled for your workspace."
- What happens when a user tries to enrich in a public channel instead of their assigned private channel? The bot responds with "Please use your assigned enrichment channel" and provides the channel name or setup instructions.
- What happens when the bot is removed from a private enrichment channel? The channel registration is marked inactive, and the user is notified via DM that their enrichment channel needs to be re-configured.
- What happens when a client has no payment method and tries to enrich after free credits are exhausted? The bot blocks enrichment and provides a direct link to the billing portal to add a payment method.
- What happens when two users in the same workspace cancel enrichments simultaneously? Each cancellation is processed independently with atomic credit adjustments — no race conditions due to existing PG advisory locks.
- How does the system handle Slack API rate limits when listing both public and private channels? Channel lists are cached for 5 minutes per workspace. If the cache is empty, channels are fetched with pagination and rate-limit-aware retry logic.
- What happens when a license key expires after a workspace has already activated it? Nothing changes for the workspace — it continues operating on its billing subscription. The expired key simply cannot be used to activate any new workspace.

## Requirements _(mandatory)_

### Functional Requirements

**License Key System**

- **FR-001**: System MUST support license key generation by the platform owner with configurable feature flags (which modules are enabled), credit allocation, and expiration date.
- **FR-002**: System MUST validate license keys during workspace activation: check existence, expiration, single-use constraint, and extract assigned feature flags.
- **FR-003**: System MUST store the activated license key reference on the workspace record for audit trail and feature flag inheritance.

**Client Onboarding Flow**

- **FR-004**: System MUST present a guided onboarding flow after OAuth installation: welcome message -> license key entry -> billing setup -> channel assignment -> completion confirmation.
- **FR-005**: System MUST auto-create a billing profile for the workspace upon license key activation with initial credits from the license key allocation and a monthly subscription tier.
- **FR-006**: System MUST support Stripe Checkout for billing setup during onboarding (monthly subscription selection). Invoice-based billing for enterprise clients is deferred to v2.
- **FR-006a**: System MUST support on-demand credit pack purchases (e.g., buy 200 credits for $X) via Stripe Checkout, available from the client dashboard and from in-Slack "Add Credits" prompts when balance is low. Credit packs add to the current balance immediately without affecting the monthly subscription cycle.
- **FR-007**: System MUST guide the user to create or select a private Slack channel for enrichment and register it to their workspace.
- **FR-008**: System MUST track onboarding progress and allow users to resume from where they left off if they exit mid-flow.

**Feature Toggle System**

- **FR-009**: System MUST maintain a feature flag configuration per workspace with at minimum these toggleable modules: Enrichment, Campaigns, Workflows, Onboarding, Dialer, Analytics, ICP Analysis, Personality Analysis, AI Agent. The AI Agent toggle is disabled for all client workspaces in the MVP; channel-only interactions (file uploads, slash commands, buttons) are the primary UX.
- **FR-010**: System MUST enforce feature flags at every user-facing interaction — disabled features return a user-friendly "not available on your plan" message.
- **FR-011**: System MUST allow the platform owner to change feature flags per workspace at any time, with changes taking effect immediately.
- **FR-012**: System MUST propagate feature flag changes to the client's Slack experience — disabled commands return a "not available on your plan" message; disabled feature buttons are omitted from Block Kit messages — without requiring app reinstallation.

**Credit Cost Preview**

- **FR-013**: System MUST calculate and display an estimated credit cost before any enrichment job begins, based on row count, enrichment type, and current credit rates.
- **FR-014**: System MUST show the user's current credit balance alongside the estimate so they can make an informed decision.
- **FR-015**: System MUST require explicit user confirmation ("Confirm & Enrich") before deducting any credits.

**Cancellation & Go Back**

- **FR-016**: System MUST allow users to cancel before enrichment starts (after preview) with zero credit deduction.
- **FR-017**: System MUST allow users to cancel in-progress enrichment jobs, deducting credits only for rows already processed and offering partial results.
- **FR-018**: System MUST provide a "Go Back" option at each step of the enrichment selection flow (type selection, purpose selection, preview) to let users change their choices.

**Send Copy To**

- **FR-019**: System MUST provide a "Send Copy To" action on completed enrichment results with options for email and Slack channel delivery.
- **FR-020**: System MUST support email delivery of enrichment files with a summary (job type, row count, date) to one or more email addresses.
- **FR-021**: System MUST support Slack channel delivery of enrichment files to any channel where the bot is a member, showing both public and private channels in the selection.

**Channel Management**

- **FR-022**: System MUST list both public and private Slack channels when presenting channel selection options, filtered to channels where the bot has been invited.
- **FR-023**: System MUST support per-user private enrichment channels where only the assigned user's file uploads trigger enrichment in that channel.
- **FR-024**: System MUST allow client admins to view and manage registered enrichment channels for their workspace.
- **FR-025**: System MUST support a dedicated ICP & Analysis channel per workspace for uploading configuration documents (ICP, use cases, case studies).

**Client Dashboard**

- **FR-026**: System MUST provide a client-facing dashboard (separate from the platform owner dashboard) with: credit balance, usage stats, enrichment history, billing management, and workspace settings.
- **FR-027**: System MUST enforce strict workspace data isolation in the client dashboard — clients see only their own workspace data.
- **FR-028**: System MUST authenticate client dashboard users via Slack OAuth or magic link, scoped to their workspace. Client admin role is determined by Slack's native `is_admin` field — workspace admins get full dashboard access; non-admin members get read-only enrichment history.

**Platform Owner Controls**

- **FR-029**: System MUST provide a license key management interface in the platform owner dashboard for creating, viewing, revoking, and tracking license keys.
- **FR-030**: System MUST provide a workspace management view showing all client workspaces with: activation status, feature flags, credit balance, last activity, and license key.
- **FR-031**: System MUST allow the platform owner to perform manual credit adjustments for any client workspace with audit logging.
- **FR-031a**: System MUST auto-detect the platform owner workspace (via configurable team ID or environment flag) and exempt it from license key requirements, billing, and feature gating — all features enabled by default, billing exempt. The existing `billingExempt` field on BillingProfile is used for this purpose.

**Optional Features (User-Triggered)**

- **FR-032**: System MUST support on-demand personality analysis (AIARC) for individual contacts, triggered by the user from enrichment results, with credit cost preview.
- **FR-033**: System MUST support on-demand company intelligence (job postings, latest news) via Apollo, triggered by the user from enrichment results.
- **FR-034**: System MUST respect the workspace's feature flags for optional features — if personality analysis or company intelligence is disabled, the trigger buttons are hidden.

**ICP & Analysis Reports**

- **FR-035**: System MUST process ICP documents, use cases, and case studies uploaded to the designated analysis channel and store them as workspace configuration.
- **FR-036**: System MUST generate analysis reports against enriched lists using the workspace's stored ICP context, campaign information, and case studies.
- **FR-037**: System MUST use a standardized report template format for analysis report output. Template management (upload, storage, versioning) is deferred to v2; the initial implementation uses a hardcoded default template.

### Key Entities

- **LicenseKey**: Represents a one-time activation key issued by the platform owner. Attributes: key (unique), assigned feature flags, credit allocation, expiration date (blocks new activations only — already-activated workspaces are unaffected), single-use flag, activated workspace ID (nullable), activation date (nullable), creation date, created by (admin user). Lifecycle: Created → Activated (one-time) → key becomes inert; workspace continues on billing subscription independently.
- **WorkspaceInstallation** (extended): Existing workspace record with additional fields: license key reference, feature flags, onboarding status (pending/license_key/billing/channels/complete), client dashboard access settings, workspace type (platform_owner/client — platform owner workspaces are auto-detected via config and bypass licensing, billing, and feature gating).
- **BillingProfile** (existing, extended): Per-workspace credit balance, payment method, billing cycle, subscription tier. Credits reset monthly per subscription allowance; overage billed to card. Supports on-demand credit pack purchases that add to balance immediately without affecting the subscription cycle.
- **CreditPack**: Purchasable credit bundle. Attributes: pack size (number of credits), price, display name. Available for one-time purchase via Stripe Checkout to top up workspace balance.
- **EnrichmentChannel**: Per-user private channel registration. Attributes: workspace ID, Slack channel ID, assigned Slack user ID, status (active/inactive), registration date.
- **AnalysisChannel**: Per-workspace ICP & analysis channel designation. Attributes: workspace ID, Slack channel ID, document references (ICP, use cases, case studies), last updated date.
- **CreditEstimate**: Transient entity representing a pre-enrichment cost preview. Attributes: estimated credits, job type, row count, current balance, balance after enrichment.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: A new client can go from Slack app installation to first enrichment result in under 10 minutes, including license activation, billing setup, and channel assignment.
- **SC-002**: 100% of enrichment jobs display a credit cost preview before the user confirms, with the estimate within 15% of actual cost.
- **SC-003**: Users can cancel enrichment at any point before or during processing, with credits accurately adjusted (zero deduction for pre-start cancellation, pro-rated for in-progress cancellation).
- **SC-004**: Feature toggle changes by the platform owner take effect within 60 seconds without requiring client-side reinstallation or restart.
- **SC-005**: Zero cross-workspace data leakage — no client can access another client's enrichment results, credit balance, or configuration.
- **SC-006**: Client dashboard pages load in under 3 seconds and display accurate real-time usage data.
- **SC-007**: License keys can only be activated once — duplicate activation attempts are rejected 100% of the time.
- **SC-008**: "Send Copy To" successfully delivers enrichment files via email (within 2 minutes) and Slack channel (within 30 seconds) with 99% reliability.
- **SC-009**: System supports 50+ concurrent client workspaces without performance degradation in enrichment processing.
- **SC-010**: Analysis reports incorporate at least 3 ICP context elements (ICP definition, use cases, case studies) when available, producing workspace-specific recommendations.

## Assumptions

- The existing single Slack app architecture can support multi-tenant operation without splitting into two apps — feature gating handles capability differences. The DeveloperLabs workspace (platform owner) is auto-detected and runs with all features enabled, billing exempt, no license key required.
- License keys are generated and distributed by the platform owner manually (via dashboard) — there is no self-service license purchase flow in v1.
- The platform owner dashboard is the existing admin dashboard (enhanced), not a net-new application.
- The client dashboard is a new lightweight web app (or a separate route set within the existing admin dashboard) with Slack OAuth authentication.
- Socket Mode remains the connection method for the MVP beta — migration to Events API (HTTP) may be needed for scale beyond 50+ workspaces.
- The analysis report template will be provided by the platform owner separately and ingested as a configuration document.
- Email delivery for "Send Copy To" uses a transactional email service — the specific provider is an implementation detail.
- The MVP focuses on enrichment as the primary licensed feature; campaigns and other modules remain toggleable but are not the initial selling point. The AI agent side panel is excluded from MVP — all client interactions use channel file uploads, slash commands, and button-based flows.
- Existing billing infrastructure (credit system, Stripe, advisory locks) is reused without major changes.
- Channel listing for both public and private channels is possible with current or slightly expanded Slack bot scopes.

## Scope Boundaries

### In Scope
- License key generation, validation, and single-use activation
- Client onboarding wizard (billing -> channels -> enrich)
- Per-workspace feature flag system with platform owner controls
- Credit cost preview before enrichment
- Cancel/go back at every enrichment step
- "Send Copy To" for email and Slack channel delivery
- Per-user private enrichment channels
- Public + private channel listing
- ICP & Analysis channel with report generation
- On-demand personality analysis (AIARC) and company intelligence (Apollo)
- Client-facing dashboard for billing, usage, and settings
- Platform owner license and workspace management UI

### Out of Scope
- Self-service license purchase (clients get keys from platform owner)
- Automated feature pricing/tiering (manual per-key configuration)
- Slack App Directory submission (handled by spec 34)
- White-label/custom branding per workspace
- Multi-region deployment
- BYOK (Bring Your Own API Keys) for enrichment providers
- Automated campaign execution for clients (outreach features exist but are toggled off by default)
- Mobile-native client dashboard (web-responsive only)
- SSO/SAML authentication for client dashboard (Slack OAuth + magic link only)
- AI Agent side panel for clients (channel-only interactions for MVP; agent is a future feature toggle)
