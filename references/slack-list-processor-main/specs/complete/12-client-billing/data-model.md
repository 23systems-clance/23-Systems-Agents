# Data Model: Client Billing & Enrichment Credit Management

**Branch**: `12-client-billing` | **Date**: 2026-03-10 | **Spec**: `specs/12-client-billing/spec.md`

## New Enums

```prisma
enum BillingStatus {
  PENDING       // Profile created, no payment method yet
  ACTIVE        // Payment method confirmed, enrichment allowed
  SUSPENDED     // Admin manually suspended (disputes, holds, offboarding)
  DELINQUENT    // Overage charge failed, enrichment blocked
}

enum CreditTransactionType {
  MONTHLY_ALLOCATION      // Monthly credit reset + new allocation
  ENRICHMENT_DEDUCTION    // Credits consumed during enrichment
  OVERAGE_CHARGE          // Overage charged to payment method
  MANUAL_ADJUSTMENT       // Admin manual credit adjustment
  ROLLOVER_RESET          // Rollover calculation during monthly reset
}
```

## New Models

### BillingProfile

Links a workspace to its billing configuration. One per workspace (1:1 with WorkspaceInstallation via `slackTeamId`).

```prisma
/// Client workspace billing configuration.
/// One billing profile per workspace. Controls credit allowance,
/// overage rates, and payment method references.
model BillingProfile {
  id                      String        @id @default(uuid()) @db.Uuid
  slackTeamId             String        @unique @map("slack_team_id")
  status                  BillingStatus @default(PENDING)
  billingExempt           Boolean       @default(false) @map("billing_exempt")

  // Credit configuration
  monthlyAllowance        Int           @map("monthly_allowance")
  creditBalance           Int           @default(0) @map("credit_balance")
  maxRolloverCredits      Int           @map("max_rollover_credits")
  overageRateUsd          Decimal       @map("overage_rate_usd")  // USD per credit

  // Billing cycle
  billingCycleDay         Int           @map("billing_cycle_day")  // 1-31
  lastResetAt             DateTime?     @map("last_reset_at")

  // Contact info
  billingContactUserId    String?       @map("billing_contact_user_id")  // Slack user ID
  billingEmail            String?       @map("billing_email")

  // Stripe references
  stripeCustomerId        String?       @unique @map("stripe_customer_id")
  stripePaymentMethodId   String?       @map("stripe_payment_method_id")

  // Timestamps
  createdAt               DateTime      @default(now()) @map("created_at")
  updatedAt               DateTime      @updatedAt @map("updated_at")

  // Relations
  transactions            CreditTransaction[]
  magicLinks              MagicLink[]

  @@index([status])
  @@index([billingCycleDay])
  @@map("billing_profiles")
}
```

**Key fields:**

| Field | Type | Purpose |
|-------|------|---------|
| `slackTeamId` | String (unique) | Links to `WorkspaceInstallation.slackTeamId` |
| `status` | BillingStatus | Controls enrichment gate behavior |
| `billingExempt` | Boolean | Bypasses billing gate entirely (FR-006a) |
| `monthlyAllowance` | Int | Credits allocated per billing cycle |
| `creditBalance` | Int | Current balance (can be negative for overages) |
| `maxRolloverCredits` | Int | Cap on rollover at cycle reset |
| `overageRateUsd` | Decimal | USD charged per overage credit |
| `billingCycleDay` | Int | Day of month for reset (1-31) |
| `lastResetAt` | DateTime? | Prevents double-reset on retry |
| `billingContactUserId` | String? | Slack user ID for magic link DM |
| `billingEmail` | String? | Email for magic link delivery |
| `stripeCustomerId` | String? | Stripe Customer reference |
| `stripePaymentMethodId` | String? | Default payment method for overages |

**Status transitions:**

```
PENDING    -> ACTIVE      (Stripe checkout.session.completed webhook + immediate credit allocation FR-027)
ACTIVE     -> DELINQUENT  (Overage payment_intent.payment_failed webhook)
ACTIVE     -> DELINQUENT  (Stripe charge.dispute.created webhook -- chargeback FR-028)
DELINQUENT -> ACTIVE      (Payment retried successfully / admin resolves dispute)
ACTIVE     -> SUSPENDED   (Admin manual action)
SUSPENDED  -> ACTIVE      (Admin manual action -- resumes prior balance, no fresh allocation)
```

**Monthly reset behavior**: Only ACTIVE profiles receive monthly credit allocations. SUSPENDED and DELINQUENT profiles are skipped (FR-013).

---

### CreditTransaction

Immutable, append-only ledger of all credit movements. No UPDATE or DELETE operations.

```prisma
/// Immutable credit transaction ledger.
/// Append-only: no UPDATE or DELETE. No updatedAt field.
/// Every credit movement is recorded here for audit trail.
model CreditTransaction {
  id                String                @id @default(uuid()) @db.Uuid
  billingProfileId  String                @map("billing_profile_id") @db.Uuid
  type              CreditTransactionType
  amount            Int                   // Positive = addition, negative = deduction
  balanceAfter      Int                   @map("balance_after")
  referenceId       String?               @map("reference_id")      // Job ID or Stripe charge ID
  description       String                @db.Text
  metadata          Json?                 @db.JsonB                  // Extra context (admin ID, rate snapshot, etc.)
  createdAt         DateTime              @default(now()) @map("created_at")

  // Relations
  billingProfile    BillingProfile        @relation(fields: [billingProfileId], references: [id], onDelete: Cascade)

  @@index([billingProfileId])
  @@index([type])
  @@index([createdAt])
  @@index([referenceId])
  @@map("credit_transactions")
}
```

**Transaction types and their typical values:**

| Type | Amount Sign | Reference | Description Example |
|------|------------|-----------|-------------------|
| `MONTHLY_ALLOCATION` | + | null | "Monthly allocation: 500 credits (200 rollover + 500 new)" |
| `ENRICHMENT_DEDUCTION` | - | Job ID | "Enrichment job abc123: 15 BuiltWith CTU lookups" |
| `OVERAGE_CHARGE` | 0 (balance unchanged) | Stripe charge ID | "Overage charge: 50 credits at $0.05/credit = $2.50" |
| `MANUAL_ADJUSTMENT` | +/- | null | "Manual adjustment by admin@example.com: +100 credits (trial bonus)" |
| `ROLLOVER_RESET` | - | null | "Rollover cap applied: 1100 -> 1000 credits" |

---

### CreditRateConfig

Global platform-wide credit pricing configuration. Exactly one active row at any time.

```prisma
/// Global credit rate configuration.
/// Defines base credit cost per operation type and global markup percentage.
/// Exactly one active configuration at any time.
model CreditRateConfig {
  id                        String   @id @default(uuid()) @db.Uuid
  builtWithCtuLookupCost    Int      @map("builtwith_ctu_lookup_cost")
  builtWithDomainLookupCost Int      @map("builtwith_domain_lookup_cost")
  apolloPeopleSearchCost    Int      @map("apollo_people_search_cost")
  apolloBulkEnrichCost      Int      @map("apollo_bulk_enrich_cost")
  markupPercent             Int      @map("markup_percent")          // e.g., 25 for 25%
  isActive                  Boolean  @default(true) @map("is_active")
  updatedByAdminId          String?  @map("updated_by_admin_id") @db.Uuid
  createdAt                 DateTime @default(now()) @map("created_at")
  updatedAt                 DateTime @updatedAt @map("updated_at")

  @@index([isActive])
  @@map("credit_rate_configs")
}
```

**Effective cost formula (FR-024):**

```
effectiveCost = ceil(baseCost * (1 + markupPercent / 100))
```

**Example with 25% markup:**

| Operation | Base Cost | Effective Cost |
|-----------|----------|---------------|
| BuiltWith CTU Lookup | 10 | ceil(10 * 1.25) = 13 |
| BuiltWith Domain Lookup | 5 | ceil(5 * 1.25) = 7 |
| Apollo People Search | 3 | ceil(3 * 1.25) = 4 |
| Apollo Bulk Enrich | 2 | ceil(2 * 1.25) = 3 |

---

### MagicLink

Stores secure tokens for payment onboarding.

```prisma
/// Secure magic link tokens for payment onboarding.
/// Each token is single-use and expires after 24 hours.
model MagicLink {
  id                String         @id @default(uuid()) @db.Uuid
  billingProfileId  String         @map("billing_profile_id") @db.Uuid
  token             String         @unique
  expiresAt         DateTime       @map("expires_at")
  usedAt            DateTime?      @map("used_at")
  createdAt         DateTime       @default(now()) @map("created_at")

  // Relations
  billingProfile    BillingProfile @relation(fields: [billingProfileId], references: [id], onDelete: Cascade)

  @@index([billingProfileId])
  @@index([token])
  @@index([expiresAt])
  @@map("magic_links")
}
```

**Token lifecycle:**

```
Created  -> usedAt=null, expiresAt=createdAt+24h
Clicked  -> If not expired and not used: redirect to Stripe, mark usedAt=now()
           If expired: render "expired" page
           If already used: redirect to Stripe Customer Portal
```

---

## Extended Models

### Job (existing -- add field)

Add a JSONB field to snapshot credit rates at job start for in-progress rate stability (FR-026).

```prisma
model Job {
  // ... existing fields ...

  /// Credit rate snapshot taken at job start for billing consistency.
  /// Contains effective costs per operation type at time of job creation.
  /// Null for legacy jobs or billing-exempt workspaces.
  creditRateSnapshot    Json?   @map("credit_rate_snapshot") @db.JsonB

  // ... existing relations ...
}
```

**Snapshot shape (TypeScript interface):**

```typescript
interface CreditRateSnapshot {
  builtWithCtuLookup: number;     // Effective cost (after markup)
  builtWithDomainLookup: number;
  apolloPeopleSearch: number;
  apolloBulkEnrich: number;
  markupPercent: number;           // Stored for audit reference
  snapshotAt: string;              // ISO 8601 timestamp
}
```

---

## Relationships Diagram

```
WorkspaceInstallation (existing)
  |
  | slackTeamId (unique)
  |
BillingProfile (1:1 via slackTeamId)
  |
  |--- CreditTransaction[] (1:N, append-only ledger)
  |--- MagicLink[] (1:N, token history)

CreditRateConfig (singleton, global)

Job (existing)
  |--- creditRateSnapshot (JSONB, nullable)
```

---

## Migration Notes

### New Tables

1. `billing_profiles` -- Core billing configuration per workspace.
2. `credit_transactions` -- Immutable credit ledger.
3. `credit_rate_configs` -- Global credit pricing (seeded with defaults).
4. `magic_links` -- Payment onboarding tokens.

### Altered Tables

1. `jobs` -- Add `credit_rate_snapshot` JSONB column (nullable, no backfill needed).

### Seed Data

The migration should seed one `CreditRateConfig` row with sensible defaults:

```sql
INSERT INTO credit_rate_configs (
  id, builtwith_ctu_lookup_cost, builtwith_domain_lookup_cost,
  apollo_people_search_cost, apollo_bulk_enrich_cost,
  markup_percent, is_active, created_at, updated_at
) VALUES (
  gen_random_uuid(), 10, 5, 3, 2, 25, true, now(), now()
);
```

### Index Strategy

- `billing_profiles.slack_team_id` -- UNIQUE, primary lookup path for billing gate.
- `billing_profiles.status` -- Filter for active/delinquent workspace lists.
- `billing_profiles.billing_cycle_day` -- Monthly reset scanner query.
- `credit_transactions.billing_profile_id` -- Transaction history per workspace.
- `credit_transactions.type` -- Filtered transaction views.
- `credit_transactions.created_at` -- Date range filtering.
- `credit_transactions.reference_id` -- Lookup by job ID or charge ID.
- `magic_links.token` -- UNIQUE, token validation on click.
- `magic_links.expires_at` -- Cleanup of expired tokens.
