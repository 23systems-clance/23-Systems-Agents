# Research: Client Billing & Enrichment Credit Management

**Branch**: `12-client-billing` | **Date**: 2026-03-10 | **Spec**: `specs/12-client-billing/spec.md`

## Decision 1: Payment Processor Selection

### Context

The platform needs to collect payment methods from clients, charge for overages, and provide a billing portal -- all without handling sensitive payment data directly (FR-004, SC-010).

### Options Considered

| Option | Pros | Cons |
|--------|------|------|
| **Stripe Checkout + Customer Portal** | PCI DSS compliant hosted pages; webhooks for payment events; Customer Portal for self-service card management; well-documented Node.js SDK | Stripe fees (2.9% + $0.30 per charge) |
| PayPal Billing | Wide consumer adoption | Weaker B2B experience; complex API surface; less reliable webhooks |
| Paddle | Merchant of record (handles tax) | Higher fees; less flexibility for custom credit models |

### Decision

**Stripe Checkout + Customer Portal**.

### Rationale

- Stripe Checkout Session in `setup` mode collects payment method without charging. The session URL is what the magic link redirects to.
- Stripe Customer Portal provides self-service card management after initial setup (handles the "already used magic link redirects to portal" requirement).
- Stripe `PaymentIntent` API handles overage charges with stored payment methods.
- Webhooks (`checkout.session.completed`, `payment_intent.succeeded`, `payment_intent.payment_failed`) drive status transitions.
- The `stripe` npm package is mature and well-supported for TypeScript/Node.js.

### Integration Points

- `BillingProfile.stripeCustomerId` stores the Stripe Customer ID.
- `BillingProfile.stripePaymentMethodId` stores the default payment method.
- Stripe webhook endpoint at `/api/stripe/webhook` validates signatures and routes events.
- Overage charges use `stripe.paymentIntents.create({ customer, amount, payment_method, confirm: true, off_session: true })`.

---

## Decision 2: Magic Link Implementation

### Context

Clients need a secure, time-limited way to reach the Stripe Checkout page (FR-002). The link is delivered via Slack DM and email.

### Options Considered

| Option | Pros | Cons |
|--------|------|------|
| JWT with expiry claim | Self-contained; no DB lookup needed to validate expiry | Cannot be revoked without a blocklist; token is longer/uglier in URLs |
| **Random token stored in DB** | Simple to implement; can mark as used; supports expiry and revocation; short clean URLs | Requires DB lookup on click |
| Stripe Checkout Session URL directly | No custom token needed | Cannot track usage/expiry independently; URL is long and opaque |

### Decision

**Random token stored in DB** (via `crypto.randomBytes(32).toString('hex')`).

### Rationale

- The `MagicLink` table stores token, billingProfileId, expiresAt, and usedAt.
- On click, the server validates: (a) token exists, (b) not expired (24h), (c) not already used.
- If valid, creates a Stripe Checkout Session in `setup` mode and redirects the client.
- If expired, renders a friendly "link expired" page.
- If already used, redirects to the Stripe Customer Portal for managing existing payment details.
- The token is 64 hex characters -- clean enough for URLs but cryptographically strong.
- DB-backed tokens allow admin visibility into link status (sent, clicked, used, expired).

### Magic Link Flow

```
Admin clicks "Send Magic Link" in dashboard
  -> POST /api/admin/billing/:profileId/magic-link
  -> Generate token, store in MagicLink table with 24h expiry
  -> Send Slack DM to billing contact with link
  -> Send email to billing email via Resend
  -> Post companion message in client channel

Client clicks magic link
  -> GET /billing/setup/:token
  -> Validate token (exists, not expired)
  -> If valid + not used: Create Stripe Checkout Session (setup mode), redirect
  -> If valid + already used: Redirect to Stripe Customer Portal
  -> If expired: Render "link expired" page

Stripe webhook: checkout.session.completed
  -> Mark MagicLink as used
  -> Store stripeCustomerId + stripePaymentMethodId on BillingProfile
  -> Transition billing status: pending -> active
```

---

## Decision 3: Atomic Credit Deduction

### Context

Concurrent enrichment jobs for the same workspace must not cause race conditions on the credit balance (FR-020). Credits are deducted incrementally per batch.

### Options Considered

| Option | Pros | Cons |
|--------|------|------|
| **PostgreSQL advisory locks** | Row-level locking scoped to a workspace ID; does not block reads; well-suited for short critical sections | Must remember to release lock; advisory lock IDs are integers (hash teamId) |
| Serializable transactions | Strongest isolation; no custom locking code | Performance penalty; high retry rate under concurrency |
| Optimistic locking with version column | No explicit locks; simple retry logic | Retry storms under high concurrency; more complex application code |
| Redis-based distributed lock | Fast; works across processes | Adds Redis as a billing-critical dependency; harder to keep consistent with PG |

### Decision

**PostgreSQL advisory locks** per workspace, combined with a standard READ COMMITTED transaction.

### Rationale

- `pg_advisory_xact_lock(hashWorkspaceId)` acquires an exclusive lock scoped to the billing profile's workspace. Released automatically when the transaction commits.
- The hash function converts `slackTeamId` to a bigint: `SELECT hashtext('T1234567890')::bigint`.
- Inside the lock: read balance, deduct credits, insert CreditTransaction, update balance -- all in one atomic transaction.
- Advisory locks are lightweight and do not block unrelated queries on the same table.
- This approach handles the "two jobs running concurrently" edge case from the spec.

### Implementation Pattern

```typescript
async function deductCredits(
  slackTeamId: string,
  amount: number,
  reference: { jobId: string; description: string }
): Promise<{ newBalance: number; isOverage: boolean }> {
  return prisma.$transaction(async (tx) => {
    // Acquire advisory lock for this workspace
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${slackTeamId})::bigint)`;

    const profile = await tx.billingProfile.findUnique({
      where: { slackTeamId },
      select: { id: true, creditBalance: true },
    });

    const newBalance = profile.creditBalance - amount;

    await tx.billingProfile.update({
      where: { id: profile.id },
      data: { creditBalance: newBalance },
    });

    await tx.creditTransaction.create({
      data: {
        billingProfileId: profile.id,
        type: 'ENRICHMENT_DEDUCTION',
        amount: -amount,
        balanceAfter: newBalance,
        referenceId: reference.jobId,
        description: reference.description,
      },
    });

    return { newBalance, isOverage: newBalance < 0 };
  });
}
```

---

## Decision 4: Monthly Reset Scheduling

### Context

Each workspace has a configurable billing cycle day (1-31). The system must reset credits on that day each month (FR-013).

### Options Considered

| Option | Pros | Cons |
|--------|------|------|
| **BullMQ repeatable job (daily scanner)** | Already using BullMQ; simple daily job that scans for resets due today; handles missed days via catch-up | Slight delay (runs once per day) |
| Per-workspace BullMQ delayed jobs | Exact timing per workspace | Managing thousands of delayed jobs; rescheduling on config change |
| PostgreSQL cron (pg_cron) | Native DB-level scheduling | Requires pg_cron extension on RDS; limited error handling |
| External scheduler (EventBridge) | Decoupled | Over-engineered for this use case; additional infra |

### Decision

**BullMQ repeatable job** that runs daily at 00:05 UTC.

### Rationale

- A single repeatable job (`billing-cycle-reset`) runs daily.
- It queries all active BillingProfiles where `billingCycleDay` matches today's day-of-month (or last day of month for day > month length).
- For each matching profile: calculate rollover, add monthly allocation, create transaction records.
- If the job fails, BullMQ's built-in retry handles recovery.
- If the job is delayed (e.g., ECS restart), the next run catches up by checking `lastResetAt` < current cycle boundary.
- This reuses the existing BullMQ infrastructure -- no new dependencies.

### Edge Case: Day 31 in Short Months

```typescript
function shouldResetToday(billingCycleDay: number): boolean {
  const today = new Date();
  const todayDay = today.getUTCDate();
  const lastDayOfMonth = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0)
  ).getUTCDate();

  if (billingCycleDay > lastDayOfMonth) {
    return todayDay === lastDayOfMonth;
  }
  return todayDay === billingCycleDay;
}
```

---

## Decision 5: Credit Rate Snapshot Strategy

### Context

Effective credit rates must be snapshotted at job start so mid-job rate changes do not affect in-progress work (FR-026).

### Options Considered

| Option | Pros | Cons |
|--------|------|------|
| **Snapshot to Job record as JSON** | Simple; data travels with the job; no extra queries during deduction | Slightly larger Job record |
| Versioned CreditRateConfig table | Full audit trail of rate changes | More complex; overkill for current needs |
| Pass rates through BullMQ job data | No DB change | Rates not visible in DB for auditing |

### Decision

**Snapshot to Job record as a JSON field** (`creditRateSnapshot`).

### Rationale

- When the billing gate approves an enrichment job, it reads the current `CreditRateConfig` and stores a snapshot as `Job.creditRateSnapshot` (JSONB).
- Workers read rates from `job.creditRateSnapshot` instead of querying the global config.
- If `creditRateSnapshot` is null (legacy jobs or exempt workspaces), workers fall back to the global config.
- This is the simplest approach and keeps all billing-relevant data on the Job record for auditing.

### Snapshot Schema

```typescript
interface CreditRateSnapshot {
  builtWithCtuLookup: number;    // effective cost after markup
  builtWithDomainLookup: number;
  apolloPeopleSearch: number;
  apolloBulkEnrich: number;
  markupPercent: number;          // for reference/auditing
  snapshotAt: string;             // ISO timestamp
}
```

---

## Decision 6: Prerequisite -- API Usage Logging Consolidation

### Context

The spec requires (FR-022) consolidating fragmented API usage logging before billing implementation. Currently there are two competing functions:

1. **`src/lib/apiUsageLogger.ts`** -- `logApiUsage()`: The original logger. Does NOT capture `slackTeamId`. Used by 11+ callers across workers, listeners, and services.
2. **`src/services/metering/usageTracker.ts`** -- `trackUsage()`: The newer, correct logger. Always requires `slackTeamId`. Currently has only 1 caller (itself; recently introduced for metering).

### Problem

- `logApiUsage()` writes `ApiUsageLog` records without `slackTeamId`, making workspace attribution impossible for billing.
- Budget threshold checks in `logApiUsage()` work but are not workspace-scoped.
- Workers like `contact.ts` and `technographic.ts` use local `logApiUsage` calls that miss workspace attribution.

### Decision

Migrate all 11 callers from `logApiUsage()` to `trackUsage()`. Then deprecate and remove `logApiUsage()`.

### Migration Plan

1. **Audit all callers** of `logApiUsage` (11 files identified via grep).
2. **For each caller**: Replace `logApiUsage({ jobId, service, endpoint, ... })` with `trackUsage({ jobId, slackTeamId, service, endpoint, ... })`.
3. **Resolve `slackTeamId`**: Most callers already have access to `slackTeamId` from the Job record. For any that do not, add a Job query to retrieve it.
4. **Delete** `src/lib/apiUsageLogger.ts` after all callers are migrated.
5. **Verify**: Confirm `ApiUsageLog.slackTeamId` is populated for all new records.

### Callers to Migrate

| File | Current Import | slackTeamId Source |
|------|---------------|-------------------|
| `src/listeners/events/message.ts` | `logApiUsage` | Available from `event.team` |
| `src/services/queue/workers/technographic.ts` | `logApiUsage` | Available from `job.slackTeamId` |
| `src/services/queue/workers/contact.ts` | `logApiUsage` | Available from `job.slackTeamId` |
| `src/listeners/actions/purposeSelection.ts` | `logApiUsage` | Available from `body.team.id` |
| `src/services/admin/thresholdChecker.ts` | `logApiUsage` (indirect) | N/A (checker, not a caller) |
| `src/services/ai/personaClassifier.ts` | `logApiUsage` | Available from caller context |
| `src/services/admin/errorLogger.ts` | `logApiUsage` (indirect) | N/A (logger, not a direct caller) |
| `src/listeners/actions/cacheDecision.ts` | `logApiUsage` | Available from conversation state |
| `src/listeners/actions/reportFilters.ts` | `logApiUsage` | Available from conversation state |
| `src/services/queue/workers/techReport.ts` | `logApiUsage` | Available from `job.slackTeamId` |

---

## Decision 7: Email Delivery Service

### Context

Magic links must also be sent via email (FR-003a). The platform needs a simple transactional email service.

### Decision

**Resend** (https://resend.com).

### Rationale

- Simple REST API with a lightweight Node.js SDK (`resend` npm package).
- Free tier covers initial volume (100 emails/day).
- Supports custom domains and DKIM authentication.
- Clean, modern API surface -- send an email in 3 lines of code.
- No complex template system needed -- magic link emails are simple text with a single CTA button.
- If Resend is unavailable, the Slack DM is the primary delivery channel. Email is queued for retry.

---

## Decision 8: Admin Dashboard Billing Pages

### Context

Administrators need to manage billing profiles, credit rates, and transaction history through the existing React admin dashboard.

### Decision

Add three new pages to `admin-dashboard/src/pages/`:

1. **`billing.tsx`** -- Billing profiles list with status overview (mirrors existing `clients.tsx` pattern).
2. **`billing-detail.tsx`** -- Single workspace billing detail with profile edit, transaction history, and manual adjustment.
3. **`credit-rates.tsx`** -- Global credit rate configuration (base costs per operation + markup percentage).

### Backend Routes

Add new routes to `src/routes/admin/`:

1. **`billing.ts`** -- CRUD for billing profiles, magic link generation, manual adjustments.
2. **`creditRates.ts`** -- GET/PUT for global credit rate configuration.
3. **`stripeWebhook.ts`** -- Stripe webhook handler (outside admin auth, uses Stripe signature verification).

---

## Decision 9: Chargeback and Dispute Handling

### Context

When a client disputes a Stripe charge (chargeback), the platform needs to react appropriately (FR-028). The spec clarified that refunds are admin-only via credit adjustments, not through Stripe's Refund API.

### Options Considered

| Option | Pros | Cons |
|--------|------|------|
| **Webhook-driven delinquent status** | Automatic; immediate enforcement; uses existing status transitions | Requires admin to manually resolve dispute in Stripe Dashboard |
| Automatic Stripe Refund API | Seamless for clients | Opens abuse vector; removes admin control; out of scope for v1 |
| Ignore disputes (manual only) | Simple | No automatic enforcement; clients could continue enriching during dispute |

### Decision

**Webhook-driven delinquent status** via `charge.dispute.created` event.

### Rationale

- Stripe sends `charge.dispute.created` when a client initiates a chargeback.
- The webhook handler sets the workspace's billing status to `DELINQUENT`, immediately blocking enrichments.
- Admin is notified via dashboard and Slack.
- Admin resolves the dispute through Stripe's Dashboard (outside the platform).
- If the admin wants to issue a credit refund, they use the existing manual adjustment mechanism (FR-015).
- This avoids any Stripe Refund API integration, keeping v1 scope tight.
- Reactivation after dispute resolution: admin manually sets status back to ACTIVE via the dashboard.

### Webhook Events (Updated)

The Stripe webhook handler now processes 4 event types:
1. `checkout.session.completed` -- Payment method setup complete -> PENDING to ACTIVE
2. `payment_intent.succeeded` -- Overage charge successful -> no status change
3. `payment_intent.payment_failed` -- Overage charge failed -> ACTIVE to DELINQUENT
4. `charge.dispute.created` -- Client chargeback -> ACTIVE to DELINQUENT (FR-028)

---

## Decision 10: Mid-Cycle Activation Credit Allocation

### Context

When a billing profile is activated mid-cycle (e.g., on day 15 of a 30-day cycle), should the client receive credits immediately or wait for the first billing cycle day? (FR-027)

### Decision

**Immediate full allocation** upon activation.

### Rationale

- When `checkout.session.completed` webhook transitions status to ACTIVE, the system immediately creates a `MONTHLY_ALLOCATION` transaction with the full `monthlyAllowance`.
- The first billing cycle reset then occurs on the configured `billingCycleDay`.
- This is simpler than pro-rating and ensures clients can start enriching immediately.
- No pro-rating calculation needed -- full allowance regardless of cycle position.

---

## Decision 11: Monthly Reset for Non-Active Workspaces

### Context

Should suspended or delinquent workspaces receive monthly credit allocations? (FR-013 update)

### Decision

**Skip non-active workspaces** during monthly reset.

### Rationale

- The daily billing cycle reset job queries only profiles with `status = ACTIVE`.
- Suspended and delinquent workspaces are excluded from the query entirely.
- This prevents credits from accumulating for workspaces that can't use them.
- When a suspended workspace is reactivated, it resumes with its prior balance (no catch-up allocation).
- The next natural billing cycle day handles the workspace's next allocation.

---

## Decision 12: Reactivation from Suspended Status

### Context

When a suspended workspace is reactivated by an admin, should it get fresh credits or resume with its prior balance?

### Decision

**Resume with prior balance**.

### Rationale

- The credit balance is preserved during suspension (not zeroed out).
- Reactivation simply changes status back to ACTIVE.
- If monthly resets were skipped during suspension, the workspace waits for the next billing cycle day.
- Admin can use manual adjustment (FR-015) to grant additional credits if desired.
- This prevents abuse where suspending and reactivating could be used to get extra allocations.

---

## Summary of Technology Choices

| Concern | Technology | Package |
|---------|-----------|---------|
| Payment processing | Stripe | `stripe` |
| Email delivery | Resend | `resend` |
| Magic link tokens | crypto.randomBytes | Node.js built-in |
| Atomic credit ops | PostgreSQL advisory locks | Prisma raw SQL |
| Monthly reset scheduling | BullMQ repeatable jobs | Existing `bullmq` |
| Rate snapshots | Job JSONB field | Prisma JSON type |
| Admin UI | React pages | Existing Vite/React dashboard |
