# Implementation Plan: Client Billing & Enrichment Credit Management

**Branch**: `12-client-billing` | **Date**: 2026-03-10 | **Spec**: `specs/12-client-billing/spec.md`
**Input**: Feature specification from `/specs/12-client-billing/spec.md`

## Summary

Add a client-facing billing system with Stripe integration, hybrid credit model (monthly allowance + overage charges), magic link onboarding, and real-time credit deduction during enrichment. The system gates all 7 enrichment entry points, deducts credits atomically via PostgreSQL advisory locks, and handles monthly resets via BullMQ repeatable jobs. A prerequisite consolidation of fragmented API usage logging must be completed first.

## Technical Context

**Language/Version**: TypeScript 5.x (Node.js)
**Primary Dependencies**: @slack/bolt 4.6.0, Prisma ORM, BullMQ, Stripe, Resend
**Storage**: PostgreSQL (RDS) + Redis (ElastiCache)
**Testing**: Vitest (unit + integration)
**Target Platform**: ECS Fargate (backend), CloudFront + S3 (admin dashboard)
**Project Type**: Web (backend + admin frontend)
**Performance Goals**: Credit deduction < 2s per batch (SC-003); overage charge < 30s (SC-004); monthly reset < 5min (SC-005)
**Constraints**: Atomic credit operations under concurrency; zero PCI data stored
**Scale/Scope**: ~10-50 active workspaces initially

## Out of Scope (v1)

Per clarification, the following are explicitly excluded:
- Invoice/PDF generation, tax calculation, multi-currency support
- Client-facing billing web portal (clients use Slack messages + Stripe Customer Portal)
- Billing data CSV export, per-workspace credit rates
- Stripe Refund API integration (refunds via admin credit adjustments only)

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

| Principle | Status | Notes |
|-----------|--------|-------|
| III. API-First Development | PASS | Admin REST API routes defined before dashboard UI; endpoints documented in contracts/ |
| IV. Client Isolation | PASS | All billing data scoped by `slackTeamId`; PG advisory locks per workspace; no cross-tenant access |
| V. SOC 2 Compliance & Audit Logging | PASS | Immutable `CreditTransaction` ledger (append-only, no UPDATE/DELETE); zero PCI data stored (SC-010); all admin actions recorded |
| VI. Cost Tracking & Financial Model | PASS | FR-022 consolidates cost tracking; per-operation credit pricing with markup; full attribution via `slackTeamId` |
| VIII. Integration-Centric Design | PASS | Stripe + Resend as external services; webhook-driven status transitions; retry with exponential backoff |
| XI. Context-First Decision Making | PASS | 3 clarification sessions completed (15 questions resolved) |
| XII. Holistic System Awareness | PASS | All 7 enrichment entry points identified; legacy limit migration planned; worker deduction integrated |
| XIII. Confirmation-Required Workflow | PASS | Plan requires explicit approval before implementation |
| XV. AWS-Only Infrastructure | PASS | ECS Fargate deployment; RDS PostgreSQL; no local dev server |
| XIX. GitHub Account Policy | PASS | `developerlabsai` account enforced |

**Non-applicable principles**: I (CRM-First -- this is Slack List Processor), II (Plugin Ecosystem -- standalone service), IX (Sequences), X (Enrichment foundation -- billing augments, doesn't change enrichment), XIV (UI/UX -- admin-only dashboard, no client-facing UI), XVI/XVIII (Developer Navigation Index).

**Violations requiring justification**: None.

## Project Structure

### Documentation (this feature)

```text
specs/12-client-billing/
├── spec.md              # Feature specification
├── plan.md              # This file
├── research.md          # Technology decisions
├── data-model.md        # Prisma data model
├── quickstart.md        # Developer quickstart
└── tasks.md             # Task breakdown
```

### Source Code (new and modified files)

```text
# Backend (new files)
prisma/
└── schema.prisma                          # Add BillingProfile, CreditTransaction, CreditRateConfig, MagicLink

src/services/billing/
├── billingGate.ts                         # Pre-enrichment billing check (all 7 entry points)
├── creditManager.ts                       # Atomic credit deduction + balance queries
├── creditRateCalculator.ts                # Effective cost calculation with markup
├── overageCharger.ts                      # Stripe overage charge creation + retry
├── monthlyResetProcessor.ts               # Billing cycle reset logic
├── magicLinkService.ts                    # Token generation, validation, Stripe session creation
└── billingNotifier.ts                     # Slack credit balance notifications

src/routes/admin/
├── billing.ts                             # Admin billing profile CRUD + magic link API
├── creditRates.ts                         # Credit rate config GET/PUT
└── stripeWebhook.ts                       # Stripe webhook handler

src/services/queue/workers/
└── billingCycleReset.ts                   # BullMQ worker for monthly reset

# Backend (modified files)
src/lib/apiUsageLogger.ts                  # DELETE after migration to trackUsage
src/services/metering/usageTracker.ts      # Already correct -- callers migrate here
src/services/agent/intentRouter.ts         # Add billing gate to agent enrichment flow
src/listeners/actions/enrichmentType.ts    # Add billing gate to "Get Technographics" / "Get Contacts" / "Get Both"
src/listeners/actions/contactChain.ts      # Add billing gate to contact chain from tech job
src/listeners/actions/reportFilters.ts     # Add billing gate to tech report generation
src/listeners/actions/cacheDecision.ts     # Add billing gate to cache decision flow
src/services/queue/workers/technographic.ts  # Add credit deduction per batch
src/services/queue/workers/contact.ts        # Add credit deduction per batch
src/services/queue/workers/combined.ts       # Add credit deduction per batch
src/services/queue/workers/techReport.ts     # Add credit deduction per batch
src/services/queue/queues.ts               # Register billing cycle reset repeatable job

# Admin Dashboard (new files)
admin-dashboard/src/pages/
├── billing.tsx                            # Billing profiles list with status overview
├── billing-detail.tsx                     # Single workspace billing detail + transactions
└── credit-rates.tsx                       # Global credit rate configuration page
```

## Phase Breakdown

### Phase 0: Prerequisite -- Consolidate API Usage Logging

**Goal**: Migrate all callers from `logApiUsage()` (missing `slackTeamId`) to `trackUsage()` (always captures `slackTeamId`). There are 7 call sites of the exported function across 6 files, plus 3 worker-local `logApiUsage` wrappers in technographic.ts, contact.ts, and techReport.ts. This is required before billing can attribute costs to workspaces.

**Files to modify**:
- `src/listeners/events/message.ts` -- Replace `logApiUsage` with `trackUsage`
- `src/services/queue/workers/technographic.ts` -- Replace `logApiUsage` with `trackUsage`
- `src/services/queue/workers/contact.ts` -- Replace `logApiUsage` with `trackUsage`
- `src/listeners/actions/purposeSelection.ts` -- Replace `logApiUsage` with `trackUsage`
- `src/services/ai/personaClassifier.ts` -- Replace `logApiUsage` with `trackUsage`
- `src/listeners/actions/cacheDecision.ts` -- Replace `logApiUsage` with `trackUsage`
- `src/listeners/actions/reportFilters.ts` -- Replace `logApiUsage` with `trackUsage`
- `src/services/queue/workers/techReport.ts` -- Replace `logApiUsage` with `trackUsage`

**File to delete**:
- `src/lib/apiUsageLogger.ts` -- Remove after all callers migrated

**Verification**: All new `ApiUsageLog` records have non-null `slackTeamId`.

---

### Phase 1: Data Model + Billing Profile CRUD

**Goal**: Create the Prisma schema additions and admin API for managing billing profiles.

**New Prisma models**: `BillingProfile`, `CreditTransaction`, `CreditRateConfig`, `MagicLink`
**Modified model**: `Job` (add `creditRateSnapshot` JSONB field)

**New files**:
- `prisma/schema.prisma` -- Add 4 new models + 2 enums + 1 Job field
- `src/routes/admin/billing.ts` -- CRUD endpoints: list profiles, get profile, create profile, update profile, manual adjust credits
- `src/routes/admin/creditRates.ts` -- GET/PUT for global credit rate config
- `src/services/billing/creditRateCalculator.ts` -- `getEffectiveCost(operationType)` using `ceil(baseCost * (1 + markupPercent / 100))`
- `admin-dashboard/src/pages/billing.tsx` -- Billing profiles list with status, balance, allowance columns
- `admin-dashboard/src/pages/billing-detail.tsx` -- Profile edit form + transaction history table + manual adjustment modal
- `admin-dashboard/src/pages/credit-rates.tsx` -- Rate config form with live preview of effective costs

**Seed**: Insert default `CreditRateConfig` row.

---

### Phase 2: Magic Link + Payment Onboarding

**Goal**: Generate secure tokens, deliver via Slack DM + email, redirect to Stripe Checkout.

**New files**:
- `src/services/billing/magicLinkService.ts` -- `generateMagicLink()`, `validateMagicLink()`, `createStripeCheckoutSession()`
- `src/routes/admin/stripeWebhook.ts` -- Stripe webhook handler for `checkout.session.completed`, `payment_intent.succeeded`, `payment_intent.payment_failed`, `charge.dispute.created`

**Modified files**:
- `src/routes/admin/billing.ts` -- Add `POST /billing/:profileId/magic-link` endpoint
- `src/server.ts` -- Register `/api/stripe/webhook` route (raw body for signature verification)

**External setup**:
- Stripe account: Create product/customer objects.
- Resend account: Configure sending domain.
- Environment variables: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `RESEND_API_KEY`, `APP_BASE_URL`.

**Flow**: Admin triggers -> token generated + stored -> Slack DM + email sent -> client clicks -> Stripe Checkout -> webhook -> status active -> immediate credit allocation (FR-027).

**Mid-cycle activation (FR-027)**: When the `checkout.session.completed` webhook transitions status to ACTIVE, the system immediately allocates the full `monthlyAllowance` as a `MONTHLY_ALLOCATION` transaction. The first billing cycle reset then occurs on the configured `billingCycleDay`.

---

### Phase 3: Pre-Enrichment Billing Gate (All 7 Entry Points)

**Goal**: Block enrichment for workspaces without active billing. Inject the gate at all 7 entry points.

**New files**:
- `src/services/billing/billingGate.ts` -- `checkBillingGate(slackTeamId, estimatedCredits)` returns `{ allowed, reason, profile, estimatedOverage }`

**Modified files (the 7 entry points)**:

1. **Agent/NL flow**: `src/services/agent/intentRouter.ts`
   - In `handleEnrichmentIntent()` and `handleTechReportIntent()`, call `checkBillingGate()` before job creation.
   - If blocked, return billing setup message with auto-generated magic link.

2. **"Get Technographics" button**: `src/listeners/actions/enrichmentType.ts`
   - In `enrich_technographics` handler, call `checkBillingGate()`.

3. **"Get Contacts" / "Get Both" buttons**: `src/listeners/actions/enrichmentType.ts`
   - In `enrich_contacts` and `enrich_combined` handlers, call `checkBillingGate()` before proceeding.

4. **Contact chain from tech job**: `src/listeners/actions/contactChain.ts`
   - In `chain_contacts_yes` handler, call `checkBillingGate()`.

5. **Tech report generation**: `src/listeners/actions/reportFilters.ts` / `src/services/agent/intentRouter.ts`
   - In tech report initiation, call `checkBillingGate()`.

6. **Fresh tech report via cache decision**: `src/listeners/actions/cacheDecision.ts`
   - In `cache_fresh` handler, call `checkBillingGate()` before queuing fresh tech report job.

**Billing gate logic**:
```
1. Look up BillingProfile for slackTeamId
2. If billingExempt=true: ALLOW (skip all checks)
3. If no profile: BLOCK + auto-send magic link
4. If status != ACTIVE: BLOCK with status-specific message
5. If active + sufficient credits: ALLOW
6. If active + zero credits + valid payment method: ALLOW with overage warning
7. If active + low credits: ALLOW with credit/overage estimate
```

**Credit rate snapshot**: When the gate allows, snapshot current rates onto the Job record.

---

### Phase 4: Real-Time Credit Deduction

**Goal**: Deduct credits atomically as each enrichment batch completes.

**New files**:
- `src/services/billing/creditManager.ts` -- `deductCredits(slackTeamId, amount, reference)` with PG advisory lock

**Modified files**:
- `src/services/queue/workers/technographic.ts` -- After each batch of BuiltWith lookups, call `deductCredits()` with costs from job's rate snapshot
- `src/services/queue/workers/contact.ts` -- After each Apollo people search + bulk enrich batch, call `deductCredits()`
- `src/services/queue/workers/combined.ts` -- Deduct for both tech and contact operations
- `src/services/queue/workers/techReport.ts` -- Deduct for BuiltWith CTU lookups

**Deduction flow per batch**:
```
1. Count operations in batch (e.g., 10 BuiltWith lookups)
2. Read effective cost from job.creditRateSnapshot
3. Calculate total: 10 * effectiveCost
4. Call deductCredits(slackTeamId, total, { jobId, description })
5. If newBalance < 0 and this is the first overage: queue overage charge
```

**Failure handling**: If a batch fails, no credits are deducted for that batch (FR: only successful batches).

---

### Phase 5: Overage Detection + Charging

**Goal**: Detect negative balance and charge the client's Stripe payment method.

**New files**:
- `src/services/billing/overageCharger.ts` -- `chargeOverage(billingProfile, overageCredits)` creates Stripe PaymentIntent

**Modified files**:
- `src/services/billing/creditManager.ts` -- After deduction, if balance < 0 and was previously >= 0, trigger overage charge
- `src/routes/admin/stripeWebhook.ts` -- Handle `payment_intent.payment_failed` -> set status to DELINQUENT; handle `charge.dispute.created` -> set status to DELINQUENT (FR-028)

**Overage charge logic**:
```
1. Calculate overage amount: abs(negativeBalance) * overageRateUsd
2. Create Stripe PaymentIntent with stored payment method (off_session, confirm: true)
3. Record CreditTransaction with type OVERAGE_CHARGE
4. On webhook payment_failed: set status = DELINQUENT, notify admin
5. On webhook payment_succeeded: no action needed (status stays ACTIVE)
```

**Chargeback handling (FR-028)**:
```
1. On webhook charge.dispute.created: set status = DELINQUENT, block enrichments
2. Notify admin via dashboard + Slack
3. Admin resolves dispute outside platform (Stripe Dashboard)
4. Credit refunds handled via admin manual adjustments (FR-015), not Stripe Refund API
```

**Retry**: If Stripe is temporarily unavailable, queue the charge for retry with exponential backoff via BullMQ.

---

### Phase 6: Monthly Reset + Rollover

**Goal**: Reset credit balances on each workspace's billing cycle day.

**New files**:
- `src/services/billing/monthlyResetProcessor.ts` -- `processMonthlyReset(billingProfile)` calculates rollover + new allocation
- `src/services/queue/workers/billingCycleReset.ts` -- BullMQ worker that runs daily, scans for profiles due for reset

**Modified files**:
- `src/services/queue/queues.ts` -- Register `billing-cycle-reset` repeatable job (daily at 00:05 UTC)

**Reset logic (FR-013, FR-014)**:
```
1. Query profiles WHERE status = ACTIVE AND billingCycleDay matches today
   (Skip SUSPENDED and DELINQUENT workspaces -- they receive no allocation)
2. For each matching profile:
   if (balance < 0):
     newBalance = balance + monthlyAllowance  // Negative carries forward
     rollover = 0
   else:
     rollover = min(balance, maxRolloverCredits)
     newBalance = rollover + monthlyAllowance
3. Create CreditTransaction(MONTHLY_ALLOCATION, amount=newBalance-oldBalance)
4. Update billingProfile.creditBalance = newBalance
5. Update billingProfile.lastResetAt = now()
```

**Edge case: Day 31 in short months**: Reset on Feb 28/29 (or last day of month).

**Reactivation from suspended**: When an admin reactivates a suspended workspace, the credit balance resumes at the value it had when suspended. No fresh allocation is granted; the monthly reset handles the next allocation naturally on the billing cycle day. If a reset was skipped while suspended, the workspace simply waits for the next cycle day.

---

### Phase 7: Transaction History + Reporting

**Goal**: Admin dashboard pages for viewing transaction history and billing KPIs.

**Modified files**:
- `src/routes/admin/billing.ts` -- Add `GET /billing/:profileId/transactions` with type + date range filters
- `admin-dashboard/src/pages/billing-detail.tsx` -- Add transaction history table with filters, pagination
- `admin-dashboard/src/pages/billing.tsx` -- Add billing KPI summary bar: total overage revenue, count of low-balance clients

**Transaction history API**:
```
GET /api/admin/billing/:profileId/transactions
  ?type=ENRICHMENT_DEDUCTION,OVERAGE_CHARGE
  &from=2026-01-01
  &to=2026-03-31
  &page=1
  &limit=50
```

---

### Phase 8: Slack Notifications

**Goal**: Post credit balance info in Slack after enrichment and at threshold crossings.

**New files**:
- `src/services/billing/billingNotifier.ts` -- `notifyJobCredits(job, creditsUsed, balanceAfter)`, `notifyLowBalance(profile)`, `notifyDepleted(profile)`

**Modified files**:
- `src/services/queue/workers/technographic.ts` -- On job completion, call `notifyJobCredits()`
- `src/services/queue/workers/contact.ts` -- On job completion, call `notifyJobCredits()`
- `src/services/queue/workers/combined.ts` -- On job completion, call `notifyJobCredits()`
- `src/services/queue/workers/techReport.ts` -- On job completion, call `notifyJobCredits()`
- `src/services/billing/creditManager.ts` -- After deduction, check 20% threshold crossing

**Notification triggers**:
1. **Job completion**: "Used X credits. Remaining balance: Y credits."
2. **20% threshold**: "Your enrichment credit balance is running low. X credits remaining out of Y monthly allowance."
3. **Balance depleted**: "Your monthly enrichment credits have been used. Additional enrichments will be charged at [rate] per credit."

---

## Dependency Graph

```
Phase 0 (Usage consolidation)
  |
  v
Phase 1 (Data model + CRUD)
  |
  +---> Phase 2 (Magic link + payment)
  |       |
  +---> Phase 3 (Billing gate) <--- Phase 2 (needs magic link for auto-send)
          |
          v
        Phase 4 (Credit deduction)
          |
          +---> Phase 5 (Overage charging) <--- Phase 2 (needs Stripe integration)
          |
          +---> Phase 6 (Monthly reset)
          |
          +---> Phase 7 (Transaction history)
          |
          +---> Phase 8 (Slack notifications)
```

## Environment Variables (New)

| Variable | Description | Example |
|----------|-------------|---------|
| `STRIPE_SECRET_KEY` | Stripe API secret key | `sk_live_...` |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret | `whsec_...` |
| `RESEND_API_KEY` | Resend email API key | `re_...` |
| `APP_BASE_URL` | Public URL for magic links | `https://api.example.com` |

## Rollback Strategy

- All new tables are additive -- no destructive schema changes.
- The billing gate checks for `BillingProfile` existence. Workspaces without profiles continue using legacy limits.
- Feature can be disabled by not creating billing profiles for workspaces.
- The `billingExempt` flag provides per-workspace bypass.

## Complexity Tracking

No constitution violations requiring justification. All principles either pass or are non-applicable (see Constitution Check above).
