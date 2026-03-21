# Credit Rates API Contracts

**Branch**: `12-client-billing` | **Base Path**: `/api/admin/credit-rates`

All endpoints require admin authentication via existing admin auth middleware.

---

## GET /api/admin/credit-rates

Get the active credit rate configuration.

**Response 200**:

```json
{
  "id": "uuid",
  "builtWithCtuLookupCost": 10,
  "builtWithDomainLookupCost": 5,
  "apolloPeopleSearchCost": 3,
  "apolloBulkEnrichCost": 2,
  "markupPercent": 25,
  "effectiveCosts": {
    "builtWithCtuLookup": 13,
    "builtWithDomainLookup": 7,
    "apolloPeopleSearch": 4,
    "apolloBulkEnrich": 3
  },
  "isActive": true,
  "updatedByAdminId": "uuid",
  "updatedAt": "2026-03-10T12:00:00.000Z"
}
```

The `effectiveCosts` field is computed: `ceil(baseCost * (1 + markupPercent / 100))`.

---

## PUT /api/admin/credit-rates

Update the active credit rate configuration.

**Request Body**:

```json
{
  "builtWithCtuLookupCost": 12,
  "builtWithDomainLookupCost": 6,
  "apolloPeopleSearchCost": 4,
  "apolloBulkEnrichCost": 3,
  "markupPercent": 30
}
```

All fields are optional (partial update). Only provided fields are updated.

**Response 200**: Updated config (same shape as GET, with recomputed `effectiveCosts`).

**Side effects**: New rates take effect immediately for new enrichment jobs. In-progress jobs continue using their snapshotted rates (FR-026).

---

## GET /api/admin/credit-rates/preview

Preview effective costs with hypothetical rate changes without saving.

**Query Parameters**:

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `builtWithCtuLookupCost` | number | No | Override base cost |
| `builtWithDomainLookupCost` | number | No | Override base cost |
| `apolloPeopleSearchCost` | number | No | Override base cost |
| `apolloBulkEnrichCost` | number | No | Override base cost |
| `markupPercent` | number | No | Override markup |

**Response 200**:

```json
{
  "current": {
    "builtWithCtuLookup": 13,
    "builtWithDomainLookup": 7,
    "apolloPeopleSearch": 4,
    "apolloBulkEnrich": 3
  },
  "preview": {
    "builtWithCtuLookup": 16,
    "builtWithDomainLookup": 8,
    "apolloPeopleSearch": 6,
    "apolloBulkEnrich": 4
  }
}
```
