# Tasks: Multi-Tenant SaaS Licensing

**Input**: Design documents from `/specs/35-multi-tenant-saas-licensing/`
**Prerequisites**: plan.md (required), spec.md (required), research.md, data-model.md, contracts/, quickstart.md

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Configuration changes and environment setup required before any implementation

- [x] T001 Add new environment variables to `src/config/index.ts`: `platformOwnerTeamId` (from `PLATFORM_OWNER_TEAM_ID`), `resendFromEmail` (from `RESEND_FROM_EMAIL`), `clientDashboardUrl` (from `CLIENT_DASHBOARD_URL`)
- [x] T002 [P] Add `channels:read` and `groups:read` to `REQUIRED_SCOPES` array in `src/routes/oauth/install.ts`
- [x] T003 [P] Create feature flag TypeScript type definitions in `src/types/featureFlags.ts` — define `FeatureFlags` interface with 9 boolean fields (enrichment, campaigns, workflows, onboarding, dialer, analytics, icpAnalysis, personalityAnalysis, aiAgent) and `DEFAULT_CLIENT_FLAGS` / `PLATFORM_OWNER_FLAGS` constants
- [x] T004 [P] Create license key TypeScript type definitions in `src/types/licensing.ts` — define `LicenseKeyStatus`, `OnboardingStep` enum, and related interfaces

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Database schema, core services, and middleware that MUST be complete before ANY user story can be implemented

**CRITICAL**: No user story work can begin until this phase is complete

- [x] T005 Add new Prisma models to `prisma/schema.prisma`: `LicenseKey`, `CreditPack`, `EnrichmentChannel`, `AnalysisChannel` with all fields, indexes, and relations as defined in data-model.md
- [x] T006 Extend existing Prisma models in `prisma/schema.prisma`: add `workspaceType`, `licenseKeyId`, `featureFlags`, `onboardingStatus`, `clientDashboardEnabled` to `WorkspaceInstallation`; add `subscriptionTier`, `stripeSubscriptionId`, `nextResetAt` to `BillingProfile`; add `CREDIT_PACK_PURCHASE` and `LICENSE_ACTIVATION` to `CreditTransactionType` enum; add `OnboardingStep` and `WorkspaceType` enums
- [ ] T007 Generate and run Prisma migration against RDS — `npx prisma migrate dev --name multi-tenant-saas-licensing` (sets defaults for existing records: `onboardingStatus=COMPLETE`, `workspaceType=CLIENT`, `featureFlags={}`) — **REQUIRES DEPLOYMENT: run via ECS task or CI/CD**
- [x] T008 [P] Create platform owner auto-detection service in `src/services/workspace/platformOwner.ts` — export `isPlatformOwner(slackTeamId)` that checks against `config.platformOwnerTeamId`; auto-set `workspaceType=PLATFORM_OWNER` and `billingExempt=true` on matching workspace
- [x] T009 [P] Create feature flag resolution service in `src/services/featureToggle/featureFlags.ts` — export `resolveFeatureFlags(workspace)` that merges workspace `featureFlags` JSON with defaults; platform owner gets all-true; empty JSON = all-enabled for backward compatibility
- [x] T010 [P] Create feature gate Bolt middleware in `src/services/featureToggle/featureGate.ts` — export `requireFeature(featureName)` middleware that checks `context.featureFlags[featureName]` and returns "not available on your plan" message if disabled
- [x] T011 Extend `src/services/workspace/authorize.ts` — after token resolution, call `resolveFeatureFlags()` and `isPlatformOwner()`, inject `context.featureFlags`, `context.isPlatformOwner`, and `context.onboardingStatus` into Bolt context
- [x] T012 [P] Add `addCredits()` method to `src/services/billing/creditManager.ts` — accepts `slackTeamId`, `amount`, `reference`, `description`, `transactionType`; uses same PG advisory lock pattern as `deductCredits()`; creates `CreditTransaction` record
- [x] T013 [P] Create license key generator in `src/services/licensing/keyGenerator.ts` — export `generateLicenseKey()` that produces `SLKP-XXXX-XXXX-XXXX-XXXX` format using `crypto.randomBytes(16)` with unambiguous charset (32 chars, no 0/O/1/I/l)
- [x] T014 Create license key validation service in `src/services/licensing/keyValidator.ts` — export `validateAndActivate(key, slackTeamId)` that checks existence, revocation, expiration, single-use, and atomically sets `activatedWorkspaceId` + `activatedAt`; returns feature flags and initial credits on success or error code on failure

**Checkpoint**: Foundation ready — feature flags, platform owner detection, license key system, and Prisma models are all in place. User story implementation can now begin.

---

## Phase 3: User Story 1 — License Key Activation & Client Onboarding (Priority: P1) MVP

**Goal**: A new client installs the Slack app, enters a license key, sets up billing, assigns an enrichment channel, and triggers their first enrichment — all guided by an in-Slack onboarding wizard.

**Independent Test**: Install the Slack app in a test workspace, enter a license key, complete billing setup via Stripe Checkout, assign a channel, and trigger a test enrichment — all without platform owner manual intervention beyond initial key generation.

### Implementation for User Story 1

- [x] T015 [US1] Create onboarding state machine service in `src/services/workspace/onboardingWizard.ts` — manage `OnboardingStep` transitions (PENDING → LICENSE_KEY → BILLING → CHANNELS → COMPLETE); persist state to `WorkspaceInstallation.onboardingStatus`; expose `getStep()`, `advanceStep()`, `renderStepView()` methods
- [x] T016 [US1] Create App Home opened event listener in `src/listeners/events/appHomeOpened.ts` — on `app_home_opened` event, check `onboardingStatus`; if not COMPLETE, render onboarding wizard step view with progress indicator ("Step N of 4") via `views.publish`; if COMPLETE, render dashboard view with credit balance and quick links
- [x] T017 [US1] Create onboarding wizard action listeners in `src/listeners/actions/onboardingWizard.ts` — handle `onboarding_enter_license_key` (open modal for key input), `onboarding_license_submitted` (call `validateAndActivate()`), `onboarding_billing_setup` (generate Stripe Checkout URL and present link), `onboarding_assign_channel` (show channel picker), `onboarding_complete` (finalize setup)
- [ ] T018 [US1] Extend billing setup route in `src/routes/billingSetup.ts` — support onboarding-initiated billing setup; create `BillingProfile` with `initialCredits` from license key, `subscriptionTier` from key config; set Stripe payment method; on success, call `advanceStep('CHANNELS')` — **DEFERRED: existing billing setup already handles profile creation; onboarding advance handled via webhook**
- [x] T019 [US1] Create welcome DM sender in `src/services/workspace/onboardingWizard.ts` — send DM to installer after OAuth callback with welcome message and link to App Home tab; triggered from `src/routes/oauth/callback.ts` after workspace creation
- [x] T020 [US1] Modify `src/routes/oauth/callback.ts` — after workspace creation, set `onboardingStatus=PENDING`, send welcome DM via onboarding wizard, trigger `app_home_opened`-style view publish for installer
- [x] T021 [US1] Register onboarding listeners in `src/app.ts` — import and register `appHomeOpened` event listener and `onboardingWizard` action listeners; gate behind onboarding feature (always active for new installs)
- [x] T022 [US1] Add audit logging for license key activation — log `LICENSE_KEY_ACTIVATED` event to `AuditLog` with `slackTeamId`, `licenseKeyId`, `installedByUserId` via existing `auditLogger.ts`

**Checkpoint**: User Story 1 complete — a client can install the app, activate a license key, set up billing, assign a channel, and be ready to enrich. This is the MVP.

---

## Phase 4: User Story 2 — Core Enrichment with Credit Preview & Cancellation (Priority: P1)

**Goal**: Client users see how many credits an enrichment will cost before proceeding, with the ability to cancel or go back at every step.

**Independent Test**: Upload a 50-row CSV, view the credit cost estimate, confirm enrichment, then separately test cancelling before enrichment starts. Verify credits are only deducted on completed enrichments.

### Implementation for User Story 2

- [x] T023 [US2] Create credit preview service in `src/services/enrichment/creditPreview.ts` — export `calculateCreditEstimate(rowCount, enrichmentType, slackTeamId)` using existing `creditRateCalculator.ts`; return `CreditEstimate` object with estimated credits, current balance, balance after enrichment, and insufficient balance flag
- [x] T024 [US2] Create credit preview action listener in `src/listeners/actions/creditPreview.ts` — handle `enrichment_confirm` (proceed with enrichment), `enrichment_cancel` (abort with zero deduction), `enrichment_go_back` (return to type/purpose selection); display credit estimate card with current balance and cost breakdown
- [ ] T025 [US2] Modify existing enrichment flow in `src/listeners/actions/enrichmentType.ts` — after user selects enrichment type, call `calculateCreditEstimate()` and render preview card with Confirm/Cancel/Go Back buttons instead of immediately creating job — **DEFERRED: requires deep integration with existing multi-step enrichment flow; wiring will be done during integration testing**
- [x] T026 [US2] Create enrichment cancellation service in `src/services/enrichment/cancellation.ts` — export `cancelJob(jobId, slackTeamId)` that stops BullMQ job processing, calculates credits for completed rows only, refunds remaining credits via `addCredits()`, marks job as CANCELLED, offers partial result download
- [ ] T027 [US2] Add "Cancel Job" button to enrichment progress messages in `src/services/queue/progressUpdater.ts` — include cancel button in progress thread updates; wire to `enrichment_cancel_job` action ID — **DEFERRED: requires integration with existing progress updater flow**
- [x] T028 [US2] Create credit pack purchase prompt in `src/listeners/actions/creditPackPurchase.ts` — when insufficient credits detected in preview, show "Buy Credit Pack" and "Manage Subscription" buttons; "Buy Credit Pack" opens Stripe Checkout for selected pack; "Manage Subscription" links to billing portal
- [x] T029 [US2] Create credit pack Stripe Checkout shared service in `src/services/billing/creditPackService.ts` — export `createCreditPackCheckout(packId, slackTeamId)` that looks up `CreditPack`, creates Stripe Checkout Session with `mode: 'payment'`, `metadata: { slackTeamId, creditPackId, creditAmount }`, returns `checkoutUrl`; also export `listActiveCreditPacks()` and `fulfillCreditPackPurchase(session)`. Create admin route in `src/routes/admin/creditPacks.ts` — `POST /api/v1/admin/credit-packs/:packId/checkout` (used by admin dashboard); client route T053 reuses the same shared service
- [x] T030 [US2] Extend Stripe webhook handler in `src/routes/admin/stripeWebhook.ts` — handle `checkout.session.completed` for credit pack purchases; parse `metadata`, call `addCredits()`, create `CREDIT_PACK_PURCHASE` transaction, send confirmation DM to purchaser

**Checkpoint**: User Story 2 complete — users see credit costs before enriching, can cancel at any step, and can purchase credit packs when balance is low.

---

## Phase 5: User Story 3 — Send Copy To (Priority: P1)

**Goal**: Client users can send enrichment results to colleagues via email or another Slack channel.

**Independent Test**: Complete an enrichment, click "Send Copy To", choose email delivery, enter an email address, and verify the recipient receives the file. Separately test Slack channel delivery.

### Implementation for User Story 3

- [x] T031 [P] [US3] Create email sender service in `src/services/sendCopyTo/emailSender.ts` — export `sendResultByEmail(jobId, recipientEmails, slackTeamId)` that downloads result file from S3, sends via Resend with attachment (Buffer), includes enrichment summary (type, row count, date, workspace name) in email body
- [x] T032 [P] [US3] Create Slack channel sender service in `src/services/sendCopyTo/slackChannelSender.ts` — export `sendResultToChannel(jobId, channelId, slackTeamId)` that downloads result file from S3, uploads to target channel via Slack `files.uploadV2`, includes context message about enrichment source
- [x] T033 [US3] Create channel listing utility in `src/services/sendCopyTo/channelLister.ts` — export `listAccessibleChannels(slackTeamId)` that calls `conversations.list({ types: 'public_channel,private_channel' })` with pagination; cache results in Redis for 5 minutes per workspace
- [x] T034 [US3] Create Send Copy To action listener in `src/listeners/actions/sendCopyTo.ts` — handle `send_copy_to_open` (open modal with Email/Slack Channel choice), `send_copy_to_email` (collect email addresses, call `sendResultByEmail`), `send_copy_to_channel` (show channel picker from `listAccessibleChannels`, call `sendResultToChannel`); validate bot membership for private channels
- [x] T035 [US3] Add "Send Copy To" button to enrichment result messages — modify file delivery in `src/services/queue/workers/fileGeneration.ts` to include "Send Copy To" button alongside download link in completion thread message

**Checkpoint**: User Story 3 complete — users can share enrichment results via email or Slack channel.

---

## Phase 6: User Story 4 — Private Enrichment Channels Per User (Priority: P1)

**Goal**: Client admins assign enrichment access to specific users via private channel registration; only the assigned user can trigger enrichments in their channel.

**Independent Test**: As a client admin, designate a user for enrichment access. That user creates a private channel, the system registers it, and they can enrich. Another user without a channel cannot trigger enrichments.

### Implementation for User Story 4

- [x] T036 [US4] Create channel registration action listener in `src/listeners/actions/channelRegistration.ts` — when bot is invited to a private channel, detect via `member_joined_channel` event; send message asking if this should be the user's enrichment channel; handle `register_enrichment_channel` action to create `EnrichmentChannel` record
- [x] T037 [US4] Modify file detection in `src/listeners/events/fileShared.ts` — before triggering enrichment, check if the channel has an `EnrichmentChannel` record; if yes, verify the file uploader matches `assignedUserId`; if no registered channel and workspace is a client, respond with setup instructions; skip check for platform owner workspaces
- [x] T038 [US4] Create enrichment channel management service in `src/services/workspace/enrichmentChannelManager.ts` — export `registerChannel(slackTeamId, slackChannelId, slackUserId)`, `deactivateChannel(channelId)`, `listChannels(slackTeamId)`, `getChannelForUser(slackTeamId, slackUserId)`; enforce one active channel per user
- [x] T039 [US4] Handle channel deletion/bot removal — listen for `channel_deleted` and `member_left_channel` events; if bot is removed from registered enrichment channel, mark channel as INACTIVE and DM the assigned user with re-configuration instructions
- [x] T040 [US4] Add `member_joined_channel` event listener registration in `src/app.ts` — register the channel registration event handler; add `channels:read` event subscription if not already present in Slack app manifest

**Checkpoint**: User Story 4 complete — per-user private enrichment channels are registered and enforced.

---

## Phase 7: User Story 5 — Platform Owner Feature Toggle Management (Priority: P1)

**Goal**: Platform owner can toggle feature modules on/off per client workspace from the admin dashboard, with changes taking effect immediately.

**Independent Test**: In the platform owner dashboard, toggle off "Campaigns" for a client workspace. Verify that the client can no longer access campaign commands.

### Implementation for User Story 5

- [x] T041 [US5] Create license key management admin API in `src/routes/admin/licensing.ts` — `GET /api/v1/admin/licenses` (list with filters), `POST /api/v1/admin/licenses` (create key with feature flags, credits, tier, expiration), `GET /api/v1/admin/licenses/:id` (detail), `POST /api/v1/admin/licenses/:id/revoke` (revoke key); all per licensing-api.yaml contract
- [x] T042 [US5] Create license key manager service in `src/services/licensing/licenseManager.ts` — export `createLicenseKey(options)`, `listLicenseKeys(filters)`, `getLicenseKey(id)`, `revokeLicenseKey(id)`; use `keyGenerator.ts` for creation; log all operations to `AuditLog`
- [x] T043 [US5] Create workspace management admin API in `src/routes/admin/workspaceManagement.ts` — `GET /api/v1/admin/workspaces` (list with feature flags, credit balance, onboarding status), `PATCH /api/v1/admin/workspaces/:slackTeamId/features` (update feature flags), `POST /api/v1/admin/workspaces/:slackTeamId/credits` (manual credit adjustment with audit); all per feature-toggle-api.yaml contract
- [x] T044 [US5] Mount new admin routes in `src/routes/admin/index.ts` — import and mount `licensingRouter` at `/licenses` and `workspaceManagementRouter` at `/workspaces`
- [x] T045 [P] [US5] Create License Key Management page in `admin-dashboard/src/pages/licensing.tsx` — table listing all keys with status (active/activated/expired/revoked), creation date, activated workspace, notes; create key form with feature flag checkboxes, credit amount, tier selector, optional expiration; revoke button with confirmation
- [x] T046 [P] [US5] Create Workspace Management page in `admin-dashboard/src/pages/workspace-management.tsx` — table listing all workspaces with team name, type, onboarding status, feature flags summary, credit balance, last activity; click to expand per-workspace feature toggle panel; manual credit adjustment modal with reason field
- [x] T047 [P] [US5] Create FeatureTogglePanel component in `admin-dashboard/src/components/FeatureTogglePanel.tsx` — 9 toggle switches (one per feature flag) with labels and descriptions; save button that calls `PATCH /workspaces/:id/features`; visual distinction for platform owner workspace (all toggles locked-on)
- [x] T048 [US5] Create frontend API services in `admin-dashboard/src/services/licensing-api.ts` and `admin-dashboard/src/services/workspace-management-api.ts` — API client functions matching the licensing and feature-toggle contracts
- [x] T049 [US5] Add new pages to admin dashboard router in `admin-dashboard/src/router.tsx` — add routes for `/licensing` and `/workspace-management`; add sidebar navigation entries

**Checkpoint**: User Story 5 complete — platform owner can create license keys, manage workspaces, and toggle features per client.

---

## Phase 8: User Story 6 — Client Dashboard (Priority: P2)

**Goal**: Client workspace admins have a lightweight dashboard to view usage, manage billing, see enrichment history, and configure settings — isolated from the platform owner dashboard.

**Independent Test**: A client admin logs into the client dashboard, views their credit balance, reviews enrichment history, and updates payment method — all without seeing any platform-owner data.

### Implementation for User Story 6

- [x] T050 [US6] Create client authentication middleware in `src/lib/clientAuth.ts` — Slack OAuth flow for client users: exchange code for user token, call `users.info` to get `is_admin` field, create session scoped to `slackTeamId`; cache `is_admin` for 15 minutes; export `clientAuth()` middleware and `requireClientAdmin()` guard
- [x] T051 [US6] Create client auth routes in `src/routes/client/auth.ts` — `GET /api/v1/client/auth/login` (redirect to Slack OAuth), `GET /api/v1/client/auth/callback` (exchange code, create session, redirect to dashboard), `GET /api/v1/client/auth/me` (return authenticated user info with `isAdmin` flag)
- [x] T052 [US6] Create client overview route in `src/routes/client/overview.ts` — `GET /api/v1/client/overview` returns credit balance, monthly allowance, credits used this month, subscription tier, enrichment stats, enabled features; scoped to session's `slackTeamId`
- [x] T053 [US6] Create client billing routes in `src/routes/client/billing.ts` — `GET /api/v1/client/billing` (billing details, transactions), `GET /api/v1/client/billing/credit-packs` (available packs), `POST /api/v1/client/billing/credit-packs/:packId/checkout` (create Stripe Checkout session), `POST /api/v1/client/billing/manage` (create Stripe Billing Portal session)
- [x] T054 [US6] Create client enrichment history route in `src/routes/client/enrichments.ts` — `GET /api/v1/client/enrichments` returns paginated job history (date, user, row count, type, credits, download link); admin sees all workspace jobs; non-admin sees only own jobs
- [x] T055 [US6] Create client channels route in `src/routes/client/channels.ts` — `GET /api/v1/client/channels` lists enrichment channels for workspace; `POST /api/v1/client/channels/:channelId/deactivate` (admin only) deactivates a channel
- [x] T056 [US6] Create client settings route in `src/routes/client/settings.ts` — `GET /api/v1/client/settings` returns workspace settings; `PATCH /api/v1/client/settings` (admin only) updates default enrichment type, notification preferences
- [x] T057 [US6] Create client router index and mount in server — create `src/routes/client/index.ts` that mounts all client routes; mount at `/api/v1/client` in `src/server.ts`
- [x] T058 [P] [US6] Create client dashboard login page in `admin-dashboard/src/pages/client/login.tsx` — Slack OAuth "Sign in with Slack" button; handle OAuth callback and session creation
- [x] T059 [P] [US6] Create client dashboard overview page in `admin-dashboard/src/pages/client/overview.tsx` — credit balance card, usage stats, recent enrichments list, quick actions (Upload File, Add Credits)
- [x] T060 [P] [US6] Create client dashboard billing page in `admin-dashboard/src/pages/client/billing.tsx` — credit balance, monthly usage chart, payment method display, transaction history table, "Add Credits" (credit pack selector → Stripe Checkout), "Manage Subscription" (Stripe Portal)
- [x] T061 [P] [US6] Create client dashboard enrichment history page in `admin-dashboard/src/pages/client/enrichment-history.tsx` — paginated table with date, user, row count, type, credits used, download button; filter by user (admin only)
- [x] T062 [P] [US6] Create client dashboard channels page in `admin-dashboard/src/pages/client/channels.tsx` — list enrichment channels with assigned user, status, deactivate button (admin only)
- [x] T063 [P] [US6] Create client dashboard settings page in `admin-dashboard/src/pages/client/settings.tsx` — default enrichment type selector, notification preference toggles, enabled features list (read-only)
- [x] T064 [US6] Create client API service in `admin-dashboard/src/services/client-api.ts` — API client functions for all client dashboard endpoints
- [x] T065 [US6] Add client routes to admin dashboard router in `admin-dashboard/src/router.tsx` — add `/client/*` route tree with separate layout (no admin sidebar); guard with client session check

**Checkpoint**: User Story 6 complete — clients have self-service dashboard for billing, usage, history, and settings with strict data isolation.

---

## Phase 9: User Story 7 — ICP & One-Pager Analysis Channel (Priority: P2)

**Goal**: Client users have a dedicated channel for uploading ICP documents, case studies, and campaign info. The system generates analysis reports using this context.

**Independent Test**: Set up an ICP channel, upload ICP document and case studies, then request an analysis report against an enriched list. Verify the report references ICP context.

### Implementation for User Story 7

- [x] T066 [US7] Create ICP document processor in `src/services/analyze/icpDocumentProcessor.ts` — export `processIcpDocument(slackTeamId, documentType, fileUrl)` that downloads file, extracts text (using existing mammoth/pdf-parse/turndown), stores extracted text and S3 URL to `AnalysisChannel` record; support document types: `icp`, `useCases`, `caseStudies`
- [x] T067 [US7] Create analysis channel registration flow — add `register_analysis_channel` action listener in `src/listeners/actions/channelRegistration.ts` (extend existing file); when bot detects uploads in a designated channel, process as ICP config documents; create `AnalysisChannel` record linking channel to workspace
- [x] T068 [US7] Extend report generator in `src/services/analyze/reportGenerator.ts` — when generating analysis reports, look up workspace's `AnalysisChannel` record; inject ICP definition, use cases, and case studies as AI context; if no ICP docs uploaded, generate generic analysis with suggestion to upload ICP documents
- [x] T069 [US7] Gate ICP analysis behind feature flag — wrap analysis-related listeners and commands with `requireFeature('icpAnalysis')` middleware; hide analysis buttons in Block Kit messages when flag is disabled
- [x] T070 [US7] Add analysis channel admin management — expose `AnalysisChannel` data in client dashboard channels page (`admin-dashboard/src/pages/client/channels.tsx`); show designated analysis channel with uploaded document status

**Checkpoint**: User Story 7 complete — ICP documents are processed and incorporated into analysis reports.

---

## Phase 10: User Story 8 — Optional Personality Analysis & Company Intelligence (Priority: P3)

**Goal**: Users can optionally trigger personality analysis (AIARC) on contacts and view job postings/news for companies (Apollo) as standalone on-demand actions from enrichment results.

**Independent Test**: After enriching a list, select a contact and trigger personality analysis. Separately, select a company and view job postings/news. Both work independently.

### Implementation for User Story 8

- [x] T071 [US8] Add "Analyze Personality" button to enrichment result messages — modify enrichment completion messages to conditionally include "Analyze Personality" button (only if `personalityAnalysis` feature flag enabled and contact has LinkedIn URL); button triggers `personality_analyze` action with contact ID
- [x] T072 [US8] Create personality analysis action listener in `src/listeners/actions/personalityAnalysis.ts` — handle `personality_analyze` action; show credit cost preview; on confirm, call existing `src/services/aiark/client.ts` to fetch AIARC profile; format DISC, OCEAN, communication style, email approach as Block Kit message in thread
- [x] T073 [US8] Add "View Job Postings & News" button to enrichment result messages — conditionally include button for enriched companies (gated by `icpAnalysis` feature flag); button triggers `company_intelligence` action with company domain
- [x] T074 [US8] Create company intelligence action listener in `src/listeners/actions/companyIntelligence.ts` — handle `company_intelligence` action; call existing `src/services/apollo/client.ts` to fetch job postings and company news; format results as Block Kit message in thread

**Checkpoint**: User Story 8 complete — personality analysis and company intelligence work as standalone on-demand actions.

---

## Phase 11: Polish & Cross-Cutting Concerns

**Purpose**: Integration testing, security hardening, and cross-story improvements

- [x] T075 Apply `requireFeature()` middleware to all existing commands and actions — audit `src/listeners/commands/*.ts` and `src/listeners/actions/*.ts`; wrap campaign commands with `requireFeature('campaigns')`, workflow commands with `requireFeature('workflows')`, dialer commands with `requireFeature('dialer')`, analyze commands with `requireFeature('icpAnalysis')`
- [x] T076 [P] Add onboarding gate to enrichment flow — in `src/listeners/events/fileShared.ts`, check `context.onboardingStatus`; if not COMPLETE for client workspaces, respond with "Please complete onboarding first" and link to App Home
- [x] T077 [P] Verify comprehensive audit logging coverage — audit all new operations across US1-US8 and confirm each creates `AuditLog` entries (license key activation T022, feature toggle changes T043, credit pack purchases T030, channel registrations T038, onboarding steps T017); fix any gaps found
- [x] T078 [P] Add seed data for credit packs — create initial CreditPack records (e.g., "100 Credits / $29", "250 Credits / $59", "500 Credits / $99") in a seed script or migration
- [x] T079 Verify backward compatibility — test that existing workspaces (platform owner) with empty `featureFlags` JSON continue operating with all features enabled; ensure no regression in current enrichment, campaign, workflow, and dialer functionality
- [ ] T080 Run quickstart.md verification checklist — execute all 12 verification items against deployed ECS service — **REQUIRES DEPLOYMENT**

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion — BLOCKS all user stories
- **User Stories (Phase 3-10)**: All depend on Foundational phase completion
  - P1 stories (US1-US5) can proceed in parallel or sequentially
  - P2 stories (US6-US7) can start after Foundational; US6 integrates with US1/US2
  - P3 story (US8) can start after Foundational
- **Polish (Phase 11)**: Depends on all desired user stories being complete

### User Story Dependencies

- **US1 (Onboarding)**: Can start after Foundational — no story dependencies. **MVP target.**
- **US2 (Credit Preview)**: Can start after Foundational — independent of US1
- **US3 (Send Copy To)**: Can start after Foundational — independent of US1/US2
- **US4 (Private Channels)**: Can start after Foundational — independent of US1/US2/US3
- **US5 (Feature Toggles UI)**: Can start after Foundational — reuses license key service from T013/T014
- **US6 (Client Dashboard)**: Can start after Foundational — integrates US1 billing and US2 credit packs but is independently testable
- **US7 (ICP Analysis)**: Can start after Foundational — independent
- **US8 (Personality/Intelligence)**: Can start after Foundational — independent

### Within Each User Story

- Models/schema before services
- Services before API routes/listeners
- Backend before frontend
- Core logic before integration wiring

### Parallel Opportunities

**Phase 1** (all [P] tasks): T002, T003, T004 can run simultaneously
**Phase 2** (after T005-T007 migration): T008, T009, T010, T012, T013 can run in parallel
**Phase 5**: T031 and T032 can run in parallel (different files)
**Phase 7** (dashboard pages): T045, T046, T047 can run in parallel
**Phase 8** (client pages): T058-T063 can all run in parallel (different files)
**Phase 11**: T076, T077, T078 can run in parallel

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (~4 tasks)
2. Complete Phase 2: Foundational (~10 tasks, CRITICAL — blocks all stories)
3. Complete Phase 3: User Story 1 — Client Onboarding (~8 tasks)
4. **STOP and VALIDATE**: Test full onboarding flow end-to-end on deployed ECS
5. Deploy and demo the MVP: install → license key → billing → channel → first enrichment

### Incremental Delivery

1. **MVP**: Setup + Foundational + US1 → First client can install and enrich
2. **Credit UX**: + US2 → Credit preview, cancellation, credit packs
3. **Sharing**: + US3 → Send results via email/Slack
4. **Access Control**: + US4 → Per-user private enrichment channels
5. **Admin Tools**: + US5 → Platform owner license + workspace management dashboard
6. **Client Self-Service**: + US6 → Client billing/usage/settings dashboard
7. **Analysis**: + US7 → ICP document processing and analysis reports
8. **Intelligence**: + US8 → On-demand personality analysis and company news
9. **Polish**: Phase 11 → Feature gate all existing commands, audit logging, verification
