# Quickstart: Client Billing & Enrichment Credit Management

**Branch**: `12-client-billing` | **Date**: 2026-03-10 | **Spec**: `specs/12-client-billing/spec.md`

## Prerequisites

Before starting implementation, ensure you have:

1. **Stripe account** with test mode enabled. Get API keys from https://dashboard.stripe.com/test/apikeys
2. **Resend account** for transactional email. Get API key from https://resend.com/api-keys
3. **Existing dev environment** running (PostgreSQL, Redis, Node.js 20+)
4. **Branch**: `git checkout -b 12-client-billing`

## Environment Setup

Add these variables to your `.env` file:

```bash
# Stripe (test mode)
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...

# Resend (email delivery)
RESEND_API_KEY=re_...

# App base URL (for magic link redirect)
APP_BASE_URL=https://your-app-url.com
```

## Install Dependencies

```bash
npm install stripe resend
npm install -D @types/stripe  # if needed
```

## Database Migration

After updating `prisma/schema.prisma` with the new models:

```bash
npx prisma migrate dev --name add-billing-models
```

This creates:
- `billing_profiles` table
- `credit_transactions` table (append-only)
- `credit_rate_configs` table (seeded with defaults)
- `magic_links` table
- `credit_rate_snapshot` column on `jobs` table

## Key Files Reference

### Existing files you will modify

| File | What changes |
|------|-------------|
| `prisma/schema.prisma` | Add 4 models, 2 enums, 1 Job field |
| `src/services/agent/intentRouter.ts` | Billing gate in enrichment + tech report handlers |
| `src/listeners/actions/enrichmentType.ts` | Billing gate in button handlers |
| `src/listeners/actions/contactChain.ts` | Billing gate in contact chain handler |
| `src/listeners/actions/reportFilters.ts` | Billing gate in tech report filters |
| `src/services/queue/workers/technographic.ts` | Credit deduction per batch |
| `src/services/queue/workers/contact.ts` | Credit deduction per batch |
| `src/services/queue/workers/combined.ts` | Credit deduction per batch |
| `src/services/queue/workers/techReport.ts` | Credit deduction per batch |
| `src/services/queue/queues.ts` | Register billing cycle reset job |
| `src/server.ts` | Register Stripe webhook route |

### New files you will create

| File | Purpose |
|------|---------|
| `src/services/billing/billingGate.ts` | Pre-enrichment billing check |
| `src/services/billing/creditManager.ts` | Atomic credit deduction (PG advisory lock) |
| `src/services/billing/creditRateCalculator.ts` | Effective cost calculation |
| `src/services/billing/overageCharger.ts` | Stripe overage charge |
| `src/services/billing/monthlyResetProcessor.ts` | Monthly reset logic |
| `src/services/billing/magicLinkService.ts` | Magic link generation + validation |
| `src/services/billing/billingNotifier.ts` | Slack credit notifications |
| `src/routes/admin/billing.ts` | Billing profile admin API |
| `src/routes/admin/creditRates.ts` | Credit rate config API |
| `src/routes/admin/stripeWebhook.ts` | Stripe webhook handler |
| `src/services/queue/workers/billingCycleReset.ts` | Monthly reset BullMQ worker |
| `admin-dashboard/src/pages/billing.tsx` | Billing profiles list page |
| `admin-dashboard/src/pages/billing-detail.tsx` | Single profile detail page |
| `admin-dashboard/src/pages/credit-rates.tsx` | Credit rate config page |

## Phase 0 First: Usage Consolidation

Before any billing work, consolidate API usage logging:

1. Open all files that import from `src/lib/apiUsageLogger.ts`
2. Replace `logApiUsage(...)` calls with `trackUsage(...)` from `src/services/metering/usageTracker.ts`
3. Ensure `slackTeamId` is passed in every call
4. Delete `src/lib/apiUsageLogger.ts`
5. Verify: all new `ApiUsageLog` records have non-null `slackTeamId`

## Stripe Webhook Testing

For local/staging webhook testing:

```bash
# Install Stripe CLI
brew install stripe/stripe-cli/stripe

# Forward webhooks to local server
stripe listen --forward-to localhost:3000/api/stripe/webhook

# This outputs your webhook signing secret (use in STRIPE_WEBHOOK_SECRET)
```

## Key Patterns

### Credit Cost Calculation

```typescript
// src/services/billing/creditRateCalculator.ts
function getEffectiveCost(operationType: string, config: CreditRateConfig): number {
  const baseCostMap: Record<string, number> = {
    BUILTWITH_CTU_LOOKUP: config.builtWithCtuLookupCost,
    BUILTWITH_DOMAIN_LOOKUP: config.builtWithDomainLookupCost,
    APOLLO_PEOPLE_SEARCH: config.apolloPeopleSearchCost,
    APOLLO_BULK_ENRICH: config.apolloBulkEnrichCost,
  };
  const baseCost = baseCostMap[operationType];
  return Math.ceil(baseCost * (1 + config.markupPercent / 100));
}
```

### Billing Gate Check

```typescript
// src/services/billing/billingGate.ts
const result = await checkBillingGate(slackTeamId, estimatedCredits);
if (!result.allowed) {
  // Post result.reason to Slack channel
  // If no profile, auto-send magic link
  return;
}
// Snapshot rates onto job
job.creditRateSnapshot = result.rateSnapshot;
```

### Atomic Credit Deduction

```typescript
// src/services/billing/creditManager.ts
const { newBalance, isOverage } = await deductCredits(
  slackTeamId,
  creditsUsed,
  { jobId, description: '10 BuiltWith CTU lookups' }
);
if (isOverage) {
  await queueOverageCharge(slackTeamId);
}
```

## Testing Strategy

| Layer | Tool | What to test |
|-------|------|-------------|
| Unit | Vitest | `creditRateCalculator`, `monthlyResetProcessor`, `billingGate` logic |
| Integration | Vitest + Prisma | `creditManager` with real PG advisory locks, transaction ledger consistency |
| Stripe | Stripe CLI + test mode | Webhook delivery, checkout session creation, payment intents |
| E2E | Manual via Slack | Full flow: admin creates profile -> sends magic link -> client completes setup -> enrichment gated -> credits deducted |

## Verification Checklist

After implementation, verify these success criteria:

- [ ] Enrichment blocked for workspaces without active billing (SC-001)
- [ ] Magic link -> payment setup completes in < 3 minutes (SC-002)
- [ ] Credit balance updates within 2 seconds of batch completion (SC-003)
- [ ] Overage charge created within 30 seconds of job completion (SC-004)
- [ ] Monthly reset runs within 5 minutes (SC-005)
- [ ] Transaction ledger sums equal current balance at all times (SC-006)
- [ ] Admin can manage everything from dashboard (SC-007)
- [ ] Slack completion messages show credit usage (SC-008)
- [ ] Low-balance notifications fire at 20% threshold (SC-009)
- [ ] Zero payment data stored by platform (SC-010)
