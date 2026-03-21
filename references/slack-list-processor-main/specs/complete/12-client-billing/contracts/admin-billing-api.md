# Admin Billing API Contracts

**Branch**: `12-client-billing` | **Base Path**: `/api/admin/billing`

All endpoints require admin authentication via existing admin auth middleware.

---

## Billing Profiles

### GET /api/admin/billing/profiles

List all billing profiles with summary data.

**Query Parameters**:

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `status` | string | No | Filter by status: `PENDING`, `ACTIVE`, `SUSPENDED`, `DELINQUENT` |
| `page` | number | No | Page number (default: 1) |
| `limit` | number | No | Items per page (default: 20, max: 100) |

**Response 200**:

```json
{
  "profiles": [
    {
      "id": "uuid",
      "slackTeamId": "T1234567890",
      "workspaceName": "Acme Corp",
      "status": "ACTIVE",
      "billingExempt": false,
      "monthlyAllowance": 500,
      "creditBalance": 320,
      "maxRolloverCredits": 1000,
      "overageRateUsd": "0.05",
      "billingCycleDay": 1,
      "lastResetAt": "2026-03-01T00:05:00.000Z",
      "billingEmail": "billing@acme.com",
      "billingContactUserId": "U0987654321",
      "stripeCustomerId": "cus_xxx",
      "createdAt": "2026-01-15T10:00:00.000Z",
      "updatedAt": "2026-03-10T12:00:00.000Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 45,
    "totalPages": 3
  }
}
```

---

### GET /api/admin/billing/profiles/:profileId

Get a single billing profile with full details.

**Response 200**:

```json
{
  "id": "uuid",
  "slackTeamId": "T1234567890",
  "workspaceName": "Acme Corp",
  "status": "ACTIVE",
  "billingExempt": false,
  "monthlyAllowance": 500,
  "creditBalance": 320,
  "maxRolloverCredits": 1000,
  "overageRateUsd": "0.05",
  "billingCycleDay": 1,
  "lastResetAt": "2026-03-01T00:05:00.000Z",
  "billingEmail": "billing@acme.com",
  "billingContactUserId": "U0987654321",
  "stripeCustomerId": "cus_xxx",
  "stripePaymentMethodId": "pm_xxx",
  "createdAt": "2026-01-15T10:00:00.000Z",
  "updatedAt": "2026-03-10T12:00:00.000Z",
  "recentTransactions": [
    {
      "id": "uuid",
      "type": "ENRICHMENT_DEDUCTION",
      "amount": -50,
      "balanceAfter": 320,
      "description": "Enrichment job abc123: 10 BuiltWith CTU lookups",
      "createdAt": "2026-03-10T11:30:00.000Z"
    }
  ]
}
```

**Response 404**: Profile not found.

---

### POST /api/admin/billing/profiles

Create a new billing profile for a workspace.

**Request Body**:

```json
{
  "slackTeamId": "T1234567890",
  "monthlyAllowance": 500,
  "maxRolloverCredits": 1000,
  "overageRateUsd": 0.05,
  "billingCycleDay": 1,
  "billingEmail": "billing@acme.com",
  "billingContactUserId": "U0987654321",
  "billingExempt": false
}
```

**Response 201**: Created billing profile (same shape as GET single).

**Response 409**: Profile already exists for this workspace.

---

### PUT /api/admin/billing/profiles/:profileId

Update an existing billing profile.

**Request Body** (partial update):

```json
{
  "monthlyAllowance": 750,
  "maxRolloverCredits": 1500,
  "overageRateUsd": 0.04,
  "billingCycleDay": 15,
  "billingEmail": "new-billing@acme.com",
  "billingContactUserId": "U1111111111",
  "billingExempt": false
}
```

**Response 200**: Updated billing profile.

---

### PUT /api/admin/billing/profiles/:profileId/status

Update billing status (suspend/reactivate).

**Request Body**:

```json
{
  "status": "SUSPENDED",
  "reason": "Contract dispute"
}
```

**Allowed transitions**:
- `ACTIVE` -> `SUSPENDED`
- `SUSPENDED` -> `ACTIVE` (resumes prior balance)
- `DELINQUENT` -> `ACTIVE` (after payment issue resolved)

**Response 200**: Updated profile with new status.

**Response 400**: Invalid status transition.

---

## Credit Adjustments

### POST /api/admin/billing/profiles/:profileId/adjust

Manually adjust a workspace's credit balance.

**Request Body**:

```json
{
  "amount": 100,
  "reason": "Trial bonus credits"
}
```

- `amount`: Positive for addition, negative for deduction.
- `reason`: Required human-readable description (stored in transaction ledger).

**Response 200**:

```json
{
  "transaction": {
    "id": "uuid",
    "type": "MANUAL_ADJUSTMENT",
    "amount": 100,
    "balanceAfter": 420,
    "description": "Manual adjustment by admin@example.com: +100 credits (Trial bonus credits)",
    "createdAt": "2026-03-10T12:00:00.000Z"
  },
  "newBalance": 420
}
```

---

## Magic Links

### POST /api/admin/billing/profiles/:profileId/magic-link

Generate and send a magic link for payment onboarding.

**Request Body** (optional):

```json
{
  "expiresInHours": 24
}
```

**Response 201**:

```json
{
  "magicLink": {
    "id": "uuid",
    "token": "a1b2c3...",
    "expiresAt": "2026-03-11T12:00:00.000Z",
    "url": "https://api.example.com/billing/setup/a1b2c3..."
  },
  "delivery": {
    "slackDm": "sent",
    "email": "sent",
    "channelNotification": "sent"
  }
}
```

**Response 400**: No billing contact or email configured.

---

## Transaction History

### GET /api/admin/billing/profiles/:profileId/transactions

Get paginated transaction history for a billing profile.

**Query Parameters**:

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | string | No | Comma-separated types: `MONTHLY_ALLOCATION,ENRICHMENT_DEDUCTION,OVERAGE_CHARGE,MANUAL_ADJUSTMENT,ROLLOVER_RESET` |
| `from` | string | No | ISO date (inclusive) |
| `to` | string | No | ISO date (inclusive) |
| `page` | number | No | Default: 1 |
| `limit` | number | No | Default: 50, max: 100 |

**Response 200**:

```json
{
  "transactions": [
    {
      "id": "uuid",
      "type": "ENRICHMENT_DEDUCTION",
      "amount": -50,
      "balanceAfter": 320,
      "referenceId": "job-uuid",
      "description": "Enrichment job abc123: 10 BuiltWith CTU lookups",
      "metadata": null,
      "createdAt": "2026-03-10T11:30:00.000Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 50,
    "total": 150,
    "totalPages": 3
  }
}
```

---

## Billing KPIs

### GET /api/admin/billing/kpis

Get billing overview KPIs.

**Query Parameters**:

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `from` | string | No | ISO date for period start |
| `to` | string | No | ISO date for period end |

**Response 200**:

```json
{
  "totalOverageRevenue": 1250.50,
  "lowBalanceClients": 3,
  "activeProfiles": 42,
  "delinquentProfiles": 1,
  "totalCreditsConsumed": 15000,
  "period": {
    "from": "2026-03-01",
    "to": "2026-03-10"
  }
}
```
