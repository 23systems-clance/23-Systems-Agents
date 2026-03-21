# Stripe Webhook API Contract

**Branch**: `12-client-billing` | **Path**: `/api/stripe/webhook`

This endpoint is NOT behind admin auth. It uses Stripe signature verification.

---

## POST /api/stripe/webhook

Receives Stripe webhook events. Request body must be raw (not parsed JSON) for signature verification.

**Headers**:

| Header | Description |
|--------|-------------|
| `stripe-signature` | Stripe webhook signature for verification |

**Content-Type**: `application/json` (raw body)

**Handled Events**:

### 1. `checkout.session.completed`

Triggered when a client completes payment method setup via Stripe Checkout.

**Action**:
1. Look up `BillingProfile` by Stripe customer ID from session metadata
2. Store `stripeCustomerId` and `stripePaymentMethodId` on the profile
3. Transition status: `PENDING` -> `ACTIVE`
4. Mark corresponding `MagicLink` as used (`usedAt = now()`)
5. Create `MONTHLY_ALLOCATION` transaction with full `monthlyAllowance` (FR-027)
6. Update `creditBalance` to `monthlyAllowance`

### 2. `payment_intent.succeeded`

Triggered when an overage charge is successfully collected.

**Action**:
1. Look up `BillingProfile` by Stripe customer ID
2. Record `CreditTransaction` with type `OVERAGE_CHARGE` and Stripe charge ID as reference
3. No status change (remains `ACTIVE`)

### 3. `payment_intent.payment_failed`

Triggered when an overage charge fails (declined card, insufficient funds).

**Action**:
1. Look up `BillingProfile` by Stripe customer ID
2. Transition status: `ACTIVE` -> `DELINQUENT`
3. Block future enrichments for this workspace
4. Notify admin via dashboard and Slack

### 4. `charge.dispute.created` (FR-028)

Triggered when a client initiates a chargeback/dispute.

**Action**:
1. Look up `BillingProfile` by Stripe customer ID from the disputed charge
2. Transition status: `ACTIVE` -> `DELINQUENT`
3. Block future enrichments for this workspace
4. Notify admin via dashboard and Slack
5. Admin resolves dispute in Stripe Dashboard (outside platform)

**Response**:

- **200**: Event processed successfully (or event type not handled -- acknowledged silently)
- **400**: Invalid signature or malformed payload

---

## Magic Link Redirect Endpoint

### GET /billing/setup/:token

Client-facing endpoint. Not an API -- returns HTML or redirects.

**Behavior**:

| Token State | Action |
|-------------|--------|
| Valid + not used | Create Stripe Checkout Session (setup mode), redirect to Stripe |
| Valid + already used | Redirect to Stripe Customer Portal |
| Expired (> 24h) | Render "link expired" HTML page |
| Not found | Render "invalid link" HTML page |
