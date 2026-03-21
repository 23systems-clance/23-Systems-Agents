# Internal Billing Service Contracts

**Branch**: `12-client-billing`

These are internal TypeScript service interfaces consumed by workers and listeners (not HTTP APIs).

---

## BillingGate

**File**: `src/services/billing/billingGate.ts`

```typescript
interface BillingGateResult {
  allowed: boolean;
  reason?: string;               // Human-readable block reason for Slack message
  profile?: BillingProfile;      // Present if profile exists
  rateSnapshot?: CreditRateSnapshot; // Present if allowed -- snapshot for job
  estimatedCredits?: number;     // Estimated cost for this job
  estimatedOverage?: number;     // Credits that will exceed balance (0 if sufficient)
}

/**
 * Check if a workspace is allowed to run an enrichment job.
 * Called at all 7 entry points before job creation.
 *
 * Logic:
 * 1. billingExempt=true -> ALLOW (skip all checks)
 * 2. No profile -> BLOCK + auto-send magic link
 * 3. status != ACTIVE -> BLOCK with status-specific message
 * 4. Sufficient credits -> ALLOW
 * 5. Zero credits + valid payment method -> ALLOW with overage warning
 * 6. Low credits -> ALLOW with overage estimate
 */
function checkBillingGate(
  slackTeamId: string,
  estimatedCredits: number,
  channelId?: string       // For auto-sending magic link message
): Promise<BillingGateResult>;
```

---

## CreditManager

**File**: `src/services/billing/creditManager.ts`

```typescript
interface DeductResult {
  newBalance: number;
  isOverage: boolean;          // true if newBalance < 0
  transactionId: string;
}

/**
 * Atomically deduct credits using PG advisory lock.
 * Called by workers after each successful batch.
 */
function deductCredits(
  slackTeamId: string,
  amount: number,
  reference: {
    jobId: string;
    description: string;
  }
): Promise<DeductResult>;

/**
 * Get current credit balance for a workspace.
 */
function getCreditBalance(slackTeamId: string): Promise<{
  balance: number;
  monthlyAllowance: number;
  percentRemaining: number;
}>;
```

---

## CreditRateCalculator

**File**: `src/services/billing/creditRateCalculator.ts`

```typescript
type OperationType =
  | 'BUILTWITH_CTU_LOOKUP'
  | 'BUILTWITH_DOMAIN_LOOKUP'
  | 'APOLLO_PEOPLE_SEARCH'
  | 'APOLLO_BULK_ENRICH';

interface CreditRateSnapshot {
  builtWithCtuLookup: number;     // Effective cost (after markup)
  builtWithDomainLookup: number;
  apolloPeopleSearch: number;
  apolloBulkEnrich: number;
  markupPercent: number;           // Stored for audit reference
  snapshotAt: string;              // ISO 8601 timestamp
}

/**
 * Calculate effective cost for a single operation.
 * Formula: ceil(baseCost * (1 + markupPercent / 100))
 */
function getEffectiveCost(
  operationType: OperationType,
  config: CreditRateConfig
): number;

/**
 * Create a rate snapshot from current active config.
 * Stored on Job record for billing consistency.
 */
function createRateSnapshot(): Promise<CreditRateSnapshot>;

/**
 * Estimate total credits for a job based on row count and operation types.
 */
function estimateJobCredits(
  rowCount: number,
  operationTypes: OperationType[],
  config?: CreditRateConfig   // Optional; fetches active config if not provided
): Promise<number>;
```

---

## OverageCharger

**File**: `src/services/billing/overageCharger.ts`

```typescript
/**
 * Charge the client's Stripe payment method for overage credits.
 * Creates a PaymentIntent with off_session=true, confirm=true.
 * Queues for BullMQ retry on Stripe unavailability.
 */
function chargeOverage(
  billingProfile: BillingProfile,
  overageCredits: number
): Promise<{
  paymentIntentId: string;
  amountUsd: number;
  status: 'succeeded' | 'requires_action' | 'failed';
}>;
```

---

## MagicLinkService

**File**: `src/services/billing/magicLinkService.ts`

```typescript
/**
 * Generate a magic link token and send via Slack DM + email.
 */
function generateAndSendMagicLink(
  billingProfileId: string,
  options?: { expiresInHours?: number }
): Promise<{
  magicLink: MagicLink;
  url: string;
  delivery: {
    slackDm: 'sent' | 'failed';
    email: 'sent' | 'failed' | 'skipped';
    channelNotification: 'sent' | 'failed';
  };
}>;

/**
 * Validate a magic link token.
 * Returns the action to take based on token state.
 */
function validateMagicLink(token: string): Promise<
  | { valid: true; used: false; billingProfile: BillingProfile }
  | { valid: true; used: true; billingProfile: BillingProfile }
  | { valid: false; reason: 'expired' | 'not_found' }
>;
```

---

## MonthlyResetProcessor

**File**: `src/services/billing/monthlyResetProcessor.ts`

```typescript
/**
 * Process monthly credit reset for a single billing profile.
 * Only called for ACTIVE profiles (FR-013).
 *
 * Logic:
 * - Negative balance: newBalance = balance + monthlyAllowance (no rollover)
 * - Positive balance: rollover = min(balance, maxRolloverCredits), newBalance = rollover + monthlyAllowance
 */
function processMonthlyReset(
  billingProfile: BillingProfile
): Promise<{
  previousBalance: number;
  rollover: number;
  newBalance: number;
  transactionId: string;
}>;

/**
 * Check if a billing cycle day should trigger a reset today.
 * Handles day 31 in short months.
 */
function shouldResetToday(billingCycleDay: number): boolean;
```

---

## BillingNotifier

**File**: `src/services/billing/billingNotifier.ts`

```typescript
/**
 * Post credit usage info to Slack after job completion.
 */
function notifyJobCredits(
  channelId: string,
  threadTs: string,
  creditsUsed: number,
  balanceAfter: number,
  overageCredits?: number
): Promise<void>;

/**
 * Post low-balance warning (20% threshold).
 */
function notifyLowBalance(
  channelId: string,
  balance: number,
  monthlyAllowance: number
): Promise<void>;

/**
 * Post balance-depleted notification.
 */
function notifyDepleted(
  channelId: string,
  overageRateUsd: number
): Promise<void>;
```
