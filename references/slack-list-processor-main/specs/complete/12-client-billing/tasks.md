# Tasks: Client Billing & Enrichment Credit Management

**Input**: Design documents from `/specs/12-client-billing/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md
**Total tasks**: 80

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Install dependencies and configure environment for billing feature

- [x] T001 Install billing dependencies: `npm install stripe resend` in project root
- [x] T002 Add billing environment variables (STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, RESEND_API_KEY, APP_BASE_URL) to `.env` and `infra/` CloudFormation/ECS task definition
- [x] T003 Create `src/services/billing/` directory structure for new billing service files

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Consolidate API usage logging (Phase 0 from plan) and create billing data model. MUST be complete before ANY user story can be implemented.

### Phase 2a: API Usage Logging Consolidation (FR-022)

Migrate all callers from `logApiUsage()` to `trackUsage()` so every API usage record captures `slackTeamId` for workspace attribution.

- [x] T004 [P] Migrate `logApiUsage` to `trackUsage` in `src/listeners/events/message.ts` -- use `event.team` as slackTeamId
- [x] T005 [P] Migrate `logApiUsage` to `trackUsage` in `src/services/queue/workers/technographic.ts` -- use `job.slackTeamId`
- [x] T006 [P] Migrate `logApiUsage` to `trackUsage` in `src/services/queue/workers/contact.ts` -- use `job.slackTeamId`
- [x] T007 [P] Migrate `logApiUsage` to `trackUsage` in `src/listeners/actions/purposeSelection.ts` -- use `body.team.id`
- [x] T008 [P] Migrate `logApiUsage` to `trackUsage` in `src/services/ai/personaClassifier.ts` -- pass slackTeamId from caller context
- [x] T009 [P] Migrate `logApiUsage` to `trackUsage` in `src/listeners/actions/cacheDecision.ts` -- use conversation state
- [x] T010 [P] Migrate `logApiUsage` to `trackUsage` in `src/listeners/actions/reportFilters.ts` -- use conversation state
- [x] T011 [P] Migrate `logApiUsage` to `trackUsage` in `src/services/queue/workers/techReport.ts` -- use `job.slackTeamId`
- [x] T012 Remove any remaining references to `logApiUsage` in `src/services/admin/thresholdChecker.ts` and `src/services/admin/errorLogger.ts` (update imports to use `trackUsage` if they call it directly)
- [x] T013 Delete `src/lib/apiUsageLogger.ts` after all callers are migrated

### Phase 2b: Billing Data Model

Add Prisma schema models and run migration.

- [x] T014 Add `BillingStatus` and `CreditTransactionType` enums to `prisma/schema.prisma` per data-model.md
- [x] T015 Add `BillingProfile` model to `prisma/schema.prisma` with all fields, indexes, and `@@map("billing_profiles")` per data-model.md
- [x] T016 Add `CreditTransaction` model to `prisma/schema.prisma` with all fields, indexes, and `@@map("credit_transactions")` per data-model.md
- [x] T017 Add `CreditRateConfig` model to `prisma/schema.prisma` with all fields, indexes, and `@@map("credit_rate_configs")` per data-model.md
- [x] T018 Add `MagicLink` model to `prisma/schema.prisma` with all fields, indexes, and `@@map("magic_links")` per data-model.md
- [x] T019 Add `creditRateSnapshot Json? @map("credit_rate_snapshot") @db.JsonB` field to existing `Job` model in `prisma/schema.prisma`
- [x] T020 Run `npx prisma migrate dev --name add-billing-models` to generate and apply the migration
- [x] T021 Create seed script to insert default `CreditRateConfig` row (builtWithCtuLookupCost=10, builtWithDomainLookupCost=5, apolloPeopleSearchCost=3, apolloBulkEnrichCost=2, markupPercent=25, isActive=true) in `prisma/seed.ts` or as part of migration SQL

**Checkpoint**: Foundation ready -- API usage logging consolidated, billing schema deployed. User story implementation can now begin.

---

## Phase 3: User Story 1 - Admin Configures Client Billing Profile (Priority: P1)

**Goal**: Administrators can create, view, edit, suspend, and manually adjust billing profiles for client workspaces via admin dashboard.

**Independent Test**: Create a billing profile via admin dashboard, verify it appears in the list with correct fields. Edit the profile, manually adjust credits, and verify the transaction ledger records the adjustment.

### Implementation for User Story 1

#### Backend Services

- [x] T022 [P] [US1] Implement `creditRateCalculator.ts` in `src/services/billing/creditRateCalculator.ts` -- export `getEffectiveCost(operationType, config)`, `createRateSnapshot()`, and `estimateJobCredits(rowCount, operationTypes)` per contracts/internal-billing-services.md. Formula: `ceil(baseCost * (1 + markupPercent / 100))`

#### Backend API Routes

- [x] T023 [US1] Implement `GET /api/admin/billing/profiles` in `src/routes/admin/billing.ts` -- list all billing profiles with pagination and optional status filter per contracts/admin-billing-api.md. Join with WorkspaceInstallation to include workspaceName
- [x] T024 [US1] Implement `GET /api/admin/billing/profiles/:profileId` in `src/routes/admin/billing.ts` -- single profile with recent transactions per contracts/admin-billing-api.md
- [x] T025 [US1] Implement `POST /api/admin/billing/profiles` in `src/routes/admin/billing.ts` -- create new billing profile, return 409 if profile already exists for slackTeamId per contracts/admin-billing-api.md
- [x] T026 [US1] Implement `PUT /api/admin/billing/profiles/:profileId` in `src/routes/admin/billing.ts` -- partial update of billing profile fields per contracts/admin-billing-api.md
- [x] T027 [US1] Implement `PUT /api/admin/billing/profiles/:profileId/status` in `src/routes/admin/billing.ts` -- status transitions (ACTIVE<->SUSPENDED, DELINQUENT->ACTIVE) with validation of allowed transitions. Suspended->Active resumes prior balance per FR clarification
- [x] T028 [US1] Implement `POST /api/admin/billing/profiles/:profileId/adjust` in `src/routes/admin/billing.ts` -- manual credit adjustment with required reason, creates MANUAL_ADJUSTMENT CreditTransaction, updates balance atomically per contracts/admin-billing-api.md
- [x] T029 [P] [US1] Implement `GET /api/admin/credit-rates` in `src/routes/admin/creditRates.ts` -- return active CreditRateConfig with computed `effectiveCosts` per contracts/credit-rates-api.md
- [x] T030 [P] [US1] Implement `PUT /api/admin/credit-rates` in `src/routes/admin/creditRates.ts` -- update active config, partial update, store admin ID per contracts/credit-rates-api.md
- [x] T031 [P] [US1] Implement `GET /api/admin/credit-rates/preview` in `src/routes/admin/creditRates.ts` -- preview effective costs with hypothetical changes without saving per contracts/credit-rates-api.md
- [x] T032 [US1] Register billing and credit rate routes in `src/server.ts` under admin auth middleware. Ensure all billing profile mutations (create, update, status change, adjust) are captured by existing audit logging middleware (Constitution V: SOC 2). If no audit middleware exists, add `AuditAction` entries for billing profile CRUD in each route handler

#### Admin Dashboard Frontend

- [x] T033 [P] [US1] Create billing profiles list page in `admin-dashboard/src/pages/billing.tsx` -- table with columns: workspace name, status badge, credit balance, monthly allowance, overage rate, billing cycle day. Status filter dropdown. Pagination. Link to detail page
- [x] T034 [P] [US1] Create billing detail page in `admin-dashboard/src/pages/billing-detail.tsx` -- profile edit form (monthlyAllowance, maxRolloverCredits, overageRateUsd, billingCycleDay, billingEmail, billingContactUserId, billingExempt), status transition buttons (suspend/reactivate), manual credit adjustment modal with amount and reason fields
- [x] T035 [P] [US1] Create credit rates configuration page in `admin-dashboard/src/pages/credit-rates.tsx` -- form for base costs (4 operation types) and markup percentage, live preview of effective costs using the preview API endpoint
- [x] T036 [US1] Add billing and credit rates navigation links to admin dashboard sidebar/navigation in `admin-dashboard/src/` layout component

**Checkpoint**: Admin can create and manage billing profiles, view and edit credit rates. No payment onboarding yet.

---

## Phase 4: User Story 2 - Client Payment Onboarding via Magic Link (Priority: P1)

**Goal**: Administrators can send magic links to clients. Clients click the link, complete Stripe Checkout, and their billing status transitions to active with immediate credit allocation.

**Independent Test**: Generate a magic link from admin dashboard, click it, complete Stripe test-mode payment setup, verify billing status transitions to ACTIVE and credits are allocated.

**Dependencies**: Requires US1 (billing profiles must exist)

### Implementation for User Story 2

#### Backend Services

- [x] T037 [US2] Implement `magicLinkService.ts` in `src/services/billing/magicLinkService.ts` -- export `generateAndSendMagicLink(billingProfileId, options?)` that: (1) generates 64-char hex token via `crypto.randomBytes(32)`, (2) stores MagicLink record with 24h expiry, (3) sends Slack DM to billingContactUserId with message containing the magic link URL, (4) sends email via Resend to billingEmail with subject "Set up billing for [workspaceName]" and body containing the magic link URL with a CTA button -- queue email for retry on Resend failure (Slack DM is primary delivery), (5) posts companion message in client channel "Check your DMs for a secure link to set up billing." Also export `validateMagicLink(token)` per contracts/internal-billing-services.md
- [x] T038 [US2] Implement Stripe webhook handler in `src/routes/admin/stripeWebhook.ts` -- raw body parsing for signature verification, handle 4 events: `checkout.session.completed` (PENDING->ACTIVE + immediate MONTHLY_ALLOCATION per FR-027), `payment_intent.succeeded` (record OVERAGE_CHARGE transaction), `payment_intent.payment_failed` (ACTIVE->DELINQUENT), `charge.dispute.created` (ACTIVE->DELINQUENT per FR-028) per contracts/stripe-webhook-api.md
- [x] T039 [US2] Implement magic link redirect endpoint `GET /billing/setup/:token` in `src/routes/billingSetup.ts` -- validate token via `validateMagicLink()`, create Stripe Checkout Session (setup mode) and redirect if valid+unused, redirect to Stripe Customer Portal if already used. For expired/invalid tokens, render minimal inline HTML pages
- [x] T040 [US2] Implement `POST /api/admin/billing/profiles/:profileId/magic-link` in `src/routes/admin/billing.ts` -- calls `generateAndSendMagicLink()`, returns token info and delivery status per contracts/admin-billing-api.md
- [x] T041 [US2] Register Stripe webhook route `POST /api/stripe/webhook` in `src/server.ts` -- MUST use raw body middleware (not JSON parsed) for Stripe signature verification, OUTSIDE admin auth middleware

#### Admin Dashboard Frontend

- [x] T042 [US2] Add "Send Magic Link" button to billing detail page in `admin-dashboard/src/pages/billing-detail.tsx` -- calls POST magic-link endpoint, shows delivery status (Slack DM sent, email sent), disabled when no billing contact/email configured

**Checkpoint**: Full payment onboarding flow works. Admin sends link, client completes Stripe Checkout, billing activates with credits.

---

## Phase 5: User Story 3 - Pre-Enrichment Billing Gate (Priority: P1)

**Goal**: All 7 enrichment entry points check billing status before proceeding. Blocked workspaces get a clear message and magic link.

**Independent Test**: Attempt enrichment for a workspace with no billing profile -- verify it's blocked with a magic link. Set billing exempt flag -- verify enrichment proceeds. Set status to suspended -- verify blocked with appropriate message.

**Dependencies**: Requires US1 (billing profiles) and US2 (magic link for auto-send)

### Implementation for User Story 3

#### Backend Services

- [x] T043 [US3] Implement `billingGate.ts` in `src/services/billing/billingGate.ts` -- export `checkBillingGate(slackTeamId, estimatedCredits, channelId?)` with logic: (1) billingExempt=true->ALLOW, (2) no profile->BLOCK+auto-send magic link, (3) status!=ACTIVE->BLOCK with message, (4) sufficient credits->ALLOW, (5) zero+payment method->ALLOW+overage warning, (6) low credits->ALLOW+estimate. Returns `BillingGateResult` with `rateSnapshot` when allowed per contracts/internal-billing-services.md

#### Integrate Billing Gate at All 7 Entry Points

- [x] T044 [US3] Add billing gate to agent/NL flow in `src/services/agent/intentRouter.ts` -- call `checkBillingGate()` in `handleEnrichmentIntent()` and `handleTechReportIntent()` before job creation. If blocked, post `result.reason` to Slack. If allowed, post pre-enrichment credit estimate ("Approximately X credits for this enrichment") and set `job.creditRateSnapshot = result.rateSnapshot`
- [x] T045 [P] [US3] Add billing gate to "Get Technographics" button in `src/listeners/actions/enrichmentType.ts` -- call `checkBillingGate()` in `enrich_technographics` handler before proceeding. Post pre-enrichment credit estimate if allowed
- [x] T046 [P] [US3] Add billing gate to "Get Contacts" and "Get Both" buttons in `src/listeners/actions/enrichmentType.ts` -- call `checkBillingGate()` in `enrich_contacts` and `enrich_combined` handlers before proceeding. Post pre-enrichment credit estimate if allowed
- [x] T047 [P] [US3] Add billing gate to contact chain from tech job in `src/listeners/actions/contactChain.ts` -- call `checkBillingGate()` in `chain_contacts_yes` handler before proceeding. Post pre-enrichment credit estimate if allowed
- [x] T048[P] [US3] Add billing gate to tech report generation in `src/listeners/actions/reportFilters.ts` -- call `checkBillingGate()` before tech report job creation. Post pre-enrichment credit estimate if allowed
- [x] T048a [P] [US3] Add billing gate to fresh tech report via cache decision in `src/listeners/actions/cacheDecision.ts` -- call `checkBillingGate()` in `cache_fresh` handler before queuing fresh tech report job. Post pre-enrichment credit estimate if allowed
- [x] T049[US3] Snapshot credit rates onto Job record at all 7 entry points -- when `checkBillingGate()` returns allowed, store `result.rateSnapshot` as `job.creditRateSnapshot` in the Job creation call
- [x] T049a [US3] Add legacy limit coexistence logic to `billingGate.ts` -- when no BillingProfile exists for a workspace AND workspace is NOT billing-exempt, check if legacy limit fields (monthlySpendCapUsd, maxBuiltwithLookups, etc.) on WorkspaceInstallation should apply. If legacy limits exist and are non-null, allow enrichment under legacy rules (no credit deduction). If no legacy limits either, BLOCK + auto-send magic link. This ensures gradual migration from legacy to billing profiles

**Checkpoint**: All enrichment paths are gated. No enrichment without active billing (or exempt flag). Legacy workspaces handled gracefully. Rate snapshots stored on jobs.

---

## Phase 6: User Story 4 - Real-Time Credit Deduction During Enrichment (Priority: P1)

**Goal**: Credits are deducted atomically after each successful enrichment batch using PostgreSQL advisory locks.

**Independent Test**: Run an enrichment job with known credit balance, verify balance decreases by the correct amount based on operation costs from rate snapshot.

**Dependencies**: Requires US3 (billing gate must set rate snapshot on jobs)

### Implementation for User Story 4

#### Backend Services

- [x] T050 [US4] Implement `creditManager.ts` in `src/services/billing/creditManager.ts` -- export `deductCredits(slackTeamId, amount, reference)` using PG advisory lock pattern: `pg_advisory_xact_lock(hashtext(slackTeamId)::bigint)`, read balance, deduct, insert CreditTransaction(ENRICHMENT_DEDUCTION), update balance, return `{ newBalance, isOverage, transactionId }`. Also export `getCreditBalance(slackTeamId)` per contracts/internal-billing-services.md and research.md Decision 3

#### Integrate Credit Deduction into Workers

- [x] T051 [P] [US4] Add credit deduction to technographic worker in `src/services/queue/workers/technographic.ts` -- after each successful batch of BuiltWith lookups, read effective cost from `job.creditRateSnapshot`, calculate total (`count * effectiveCost`), call `deductCredits()`. Skip if `creditRateSnapshot` is null (legacy/exempt jobs)
- [x] T052 [P] [US4] Add credit deduction to contact worker in `src/services/queue/workers/contact.ts` -- after each successful batch, deduct for Apollo people search + bulk enrich operations using costs from `job.creditRateSnapshot`. Skip if null
- [x] T053 [P] [US4] Add credit deduction to combined worker in `src/services/queue/workers/combined.ts` -- deduct for both BuiltWith and Apollo operations per batch using costs from `job.creditRateSnapshot`. Skip if null
- [x] T054 [P] [US4] Add credit deduction to tech report worker in `src/services/queue/workers/techReport.ts` -- deduct for BuiltWith CTU lookups per batch using cost from `job.creditRateSnapshot`. Skip if null

**Checkpoint**: Credits deducted in real-time during enrichment. Balance stays current. Only successful batches are charged.

---

## Phase 7: User Story 5 - Overage Detection and Automatic Charging (Priority: P2)

**Goal**: When credits go negative, automatically charge the client's Stripe payment method. Handle failed payments and chargebacks.

**Independent Test**: Deplete a workspace's credits to zero, run another enrichment, verify a Stripe PaymentIntent is created for the overage amount.

**Dependencies**: Requires US4 (credit deduction must be working to detect overage)

### Implementation for User Story 5

- [x] T055 [US5] Implement `overageCharger.ts` in `src/services/billing/overageCharger.ts` -- export `chargeOverage(billingProfile, overageCredits)` that: (1) calculates USD amount = `overageCredits * overageRateUsd`, (2) creates Stripe PaymentIntent with `off_session: true, confirm: true` using stored payment method, (3) records OVERAGE_CHARGE CreditTransaction, (4) returns `{ paymentIntentId, amountUsd, status }` per contracts/internal-billing-services.md
- [x] T056 [US5] Add overage detection to `creditManager.ts` in `src/services/billing/creditManager.ts` -- after `deductCredits()`, if `newBalance < 0` and previous balance was `>= 0`, queue overage charge via BullMQ (or call `chargeOverage()` directly). Handle Stripe unavailability by queuing for retry with exponential backoff

**Note**: `payment_intent.payment_failed` and `charge.dispute.created` webhook handling is already implemented in T038 (Phase 4). No duplicate tasks needed.

**Edge case -- workspace uninstall**: If a workspace is uninstalled while having a negative credit balance, the overage charge is still attempted via Stripe (the PaymentIntent was already queued or will be created). The delinquent status and outstanding amount are preserved for manual collection. No additional task needed beyond T055/T056 retry logic.

**Checkpoint**: Overage charges are created automatically. Failed payments and chargebacks transition workspace to delinquent (via T038 webhook handler).

---

## Phase 8: User Story 6 - Monthly Credit Cycle Reset with Capped Rollover (Priority: P2)

**Goal**: Each workspace's credits reset on their billing cycle day. Unused credits roll over up to a cap. Only active workspaces receive resets.

**Independent Test**: Set a workspace's billing cycle day to today, run the reset job, verify new balance = min(oldBalance, rolloverCap) + monthlyAllowance.

**Dependencies**: Requires US1 (billing profiles). Independent of US4/US5.

### Implementation for User Story 6

- [x] T059 [P] [US6] Implement `monthlyResetProcessor.ts` in `src/services/billing/monthlyResetProcessor.ts` -- export `processMonthlyReset(billingProfile)` with logic: negative balance -> newBalance = balance + monthlyAllowance (no rollover); positive -> rollover = min(balance, maxRolloverCredits), newBalance = rollover + monthlyAllowance. Creates MONTHLY_ALLOCATION CreditTransaction, updates balance and lastResetAt. Also export `shouldResetToday(billingCycleDay)` handling day 31 in short months per contracts/internal-billing-services.md and research.md Decision 4
- [x] T060 [US6] Implement billing cycle reset BullMQ worker in `src/services/queue/workers/billingCycleReset.ts` -- query active BillingProfiles where `billingCycleDay` matches today (using `shouldResetToday()`), WHERE `status = 'ACTIVE'` (skip SUSPENDED/DELINQUENT per FR-013). For each, call `processMonthlyReset()`. Check `lastResetAt` to prevent double-reset
- [x] T061 [US6] Register `billing-cycle-reset` repeatable job in `src/services/queue/queues.ts` -- daily at 00:05 UTC, with BullMQ retry on failure

**Checkpoint**: Monthly resets run automatically. Rollover is capped. Non-active workspaces are skipped.

---

## Phase 9: User Story 7 - Credit Transaction History and Reporting (Priority: P2)

**Goal**: Administrators can view paginated, filterable transaction history per workspace and platform-wide billing KPIs.

**Independent Test**: Perform several credit operations, view transaction history in admin dashboard, verify all appear with correct details. Check KPI endpoint returns accurate totals.

**Dependencies**: Requires US1 (billing profiles + transactions exist from other operations)

### Implementation for User Story 7

- [x] T062 [P] [US7] Implement `GET /api/admin/billing/profiles/:profileId/transactions` in `src/routes/admin/billing.ts` -- paginated, filterable by type (comma-separated) and date range (from/to), ordered by createdAt DESC per contracts/admin-billing-api.md
- [x] T063 [P] [US7] Implement `GET /api/admin/billing/kpis` in `src/routes/admin/billing.ts` -- aggregate queries: total overage revenue (sum of OVERAGE_CHARGE amounts * overageRateUsd), count of low-balance clients (balance < 20% of monthlyAllowance), active/delinquent profile counts, total credits consumed per contracts/admin-billing-api.md
- [x] T064 [US7] Add transaction history table to billing detail page in `admin-dashboard/src/pages/billing-detail.tsx` -- filterable by type dropdown and date range picker, paginated, columns: date, type badge, amount (+/-), balance after, reference, description
- [x] T065 [US7] Add billing KPI summary bar to billing list page in `admin-dashboard/src/pages/billing.tsx` -- cards showing: total overage revenue, low-balance client count, active profiles, delinquent profiles

**Checkpoint**: Full audit trail visible. Admin can filter and review all credit movements and platform billing health.

---

## Phase 10: User Story 8 - Slack Credit Balance Notifications (Priority: P3)

**Goal**: Clients see credit usage in Slack after enrichment jobs and receive warnings at low balance thresholds.

**Independent Test**: Complete an enrichment job, verify the Slack completion message includes credit usage and remaining balance. Trigger 20% threshold crossing, verify warning message appears.

**Dependencies**: Requires US4 (credit deduction must be working for balance info)

### Implementation for User Story 8

- [x] T066 [US8] Implement `billingNotifier.ts` in `src/services/billing/billingNotifier.ts` -- export `notifyJobCredits(channelId, threadTs, creditsUsed, balanceAfter, overageCredits?)`, `notifyLowBalance(channelId, balance, monthlyAllowance)`, `notifyDepleted(channelId, overageRateUsd)` per contracts/internal-billing-services.md. Use Slack `chat.postMessage` to post formatted credit info
- [x] T067 [P] [US8] Add credit notification to technographic worker completion in `src/services/queue/workers/technographic.ts` -- on job completion, call `notifyJobCredits()` with total credits used and remaining balance. Skip if `creditRateSnapshot` is null
- [x] T068 [P] [US8] Add credit notification to contact worker completion in `src/services/queue/workers/contact.ts` -- on job completion, call `notifyJobCredits()`. Skip if null
- [x] T069 [P] [US8] Add credit notification to combined worker completion in `src/services/queue/workers/combined.ts` -- on job completion, call `notifyJobCredits()`. Skip if null
- [x] T070 [P] [US8] Add credit notification to tech report worker completion in `src/services/queue/workers/techReport.ts` -- on job completion, call `notifyJobCredits()`. Skip if null
- [x] T071 [US8] Add 20% low-balance threshold check to `src/services/billing/creditManager.ts` -- after each `deductCredits()`, if balance crossed below 20% of monthlyAllowance, call `notifyLowBalance()`. If balance reached 0, call `notifyDepleted()`

**Checkpoint**: Clients see credit info in Slack. Low-balance warnings fire before credits run out.

---

## Phase 11: Polish & Cross-Cutting Concerns

**Purpose**: Final validation and integration testing

- [x] T072 Verify all new `ApiUsageLog` records have non-null `slackTeamId` after Phase 2a migration
- [x] T073 Verify CreditTransaction ledger consistency: sum of all transactions for a workspace equals current creditBalance (SC-006)
- [x] T074 Verify billing gate blocks enrichment at ALL 7 entry points for workspaces without active billing
- [x] T074a Verify legacy limit coexistence: workspaces with legacy limits but no billing profile can still enrich under legacy rules
- [x] T075 Run TypeScript compilation (`npx tsc --noEmit`) to verify no type errors across all modified files
- [x] T076 Run admin dashboard build (`cd admin-dashboard && npm run build`) to verify frontend compiles
- [x] T076a Verify performance targets: credit deduction < 2s per batch (SC-003), overage charge < 30s (SC-004), monthly reset completes within 5 minutes for all active profiles (SC-005)
- [x] T077 Deploy admin dashboard frontend to CloudFront+S3: `cd admin-dashboard && npm run build && aws s3 sync dist/ s3://slkadmin-developerlabs-ai/ --delete && aws cloudfront create-invalidation --distribution-id E30ZVBVU06GFUV --paths "/*"`
- [x] T078 Push to GitHub and verify CI/CD deploys backend to ECS successfully

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies -- can start immediately
- **Foundational (Phase 2)**: Depends on Setup (T001-T003)
  - Phase 2a (usage consolidation T004-T013) and Phase 2b (data model T014-T021) can run in parallel
  - **BLOCKS all user stories** -- must complete before Phase 3+
- **US1 (Phase 3)**: Depends on Phase 2 completion
- **US2 (Phase 4)**: Depends on US1 (billing profiles must exist to send magic links)
- **US3 (Phase 5)**: Depends on US1 + US2 (needs billing profiles and magic link for auto-send)
- **US4 (Phase 6)**: Depends on US3 (billing gate must set rate snapshot on jobs)
- **US5 (Phase 7)**: Depends on US4 (overage detection requires credit deduction)
- **US6 (Phase 8)**: Depends on US1 only (can run in parallel with US3-US5)
- **US7 (Phase 9)**: Depends on US1 (needs billing profiles + some transactions to display)
- **US8 (Phase 10)**: Depends on US4 (needs credit deduction for balance info)
- **Polish (Phase 11)**: Depends on all prior phases

### User Story Dependencies

```
Phase 1 (Setup)
  |
  v
Phase 2 (Foundation: usage consolidation + data model)
  |
  +---> Phase 3 (US1: Billing profile CRUD) ----+
  |       |                                      |
  |       +---> Phase 4 (US2: Magic link)        |
  |       |       |                              |
  |       +---> Phase 5 (US3: Billing gate) <----+
  |               |
  |               +---> Phase 6 (US4: Credit deduction)
  |               |       |
  |               |       +---> Phase 7 (US5: Overage charging)
  |               |       |
  |               |       +---> Phase 10 (US8: Slack notifications)
  |               |
  |       +---> Phase 8 (US6: Monthly reset) [parallel with US3-US5]
  |       |
  |       +---> Phase 9 (US7: Transaction history) [parallel with US3-US5]
  |
  +---> Phase 11 (Polish)
```

### Within Each User Story

- Services before routes
- Routes before dashboard pages
- Core implementation before integration with existing code
- Story complete before moving to next priority

### Parallel Opportunities

**Phase 2a**: T004-T011 are all independent file migrations -- can all run in parallel
**Phase 2b**: T014-T019 are schema additions (sequential in schema file, but can be done as one edit)
**Phase 3**: T022 (creditRateCalculator), T029-T031 (credit rates routes), T033-T035 (dashboard pages) can run in parallel
**Phase 5**: T045-T048a (entry point integrations) can run in parallel after T043 (billingGate)
**Phase 6**: T051-T054 (worker integrations) can run in parallel after T050 (creditManager)
**Phase 8**: Can run in parallel with Phase 5-7 (only depends on US1)
**Phase 9**: T062-T063 (API endpoints) can run in parallel
**Phase 10**: T067-T070 (worker notifications) can run in parallel after T066 (billingNotifier)

---

## Implementation Strategy

### MVP First (US1 + US2 + US3 Only)

1. Complete Phase 1: Setup (T001-T003)
2. Complete Phase 2: Foundation (T004-T021)
3. Complete Phase 3: US1 - Billing Profile CRUD (T022-T036)
4. Complete Phase 4: US2 - Magic Link Onboarding (T037-T042)
5. Complete Phase 5: US3 - Billing Gate (T043-T049)
6. **STOP and VALIDATE**: Test billing gate blocks unauthenticated workspaces, magic links work end-to-end
7. Deploy MVP

### Incremental Delivery

1. **MVP**: Setup + Foundation + US1 + US2 + US3 -> Billing gate enforced, payment onboarding works
2. **+US4**: Credit deduction -> Balance changes during enrichment
3. **+US5**: Overage charging -> Revenue collection from overages
4. **+US6**: Monthly reset -> Full credit lifecycle
5. **+US7**: Transaction history -> Admin visibility into billing activity
6. **+US8**: Slack notifications -> Client transparency
7. **Polish**: Validation, deployment, frontend deploy
