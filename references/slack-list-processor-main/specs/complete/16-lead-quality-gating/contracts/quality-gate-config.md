# API Contract: Quality Gate Configuration

**Feature**: 16-lead-quality-gating
**Base Path**: `/api/v1/admin/quality-gate-config`
**Authentication**: Admin API key (same as existing admin routes)

---

## GET /api/v1/admin/quality-gate-config/:clientId

Retrieve the quality gate configuration for a workspace. Returns global defaults if no workspace-specific config exists.

### Path Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| clientId | UUID | Yes | ManagedClient ID |

### Response: 200 OK

```json
{
  "id": "uuid-or-null",
  "clientId": "abc-123",
  "isCustom": false,
  "config": {
    "rejectPersonalEmails": true,
    "rejectMissingCompany": true,
    "rejectDuplicateEmails": true,
    "deduplicateDomains": true,
    "suppressionDomains": [],
    "personalDomainOverrides": [],
    "allowPersonalDomains": []
  },
  "effectivePersonalDomains": [
    "gmail.com", "yahoo.com", "hotmail.com", "outlook.com",
    "aol.com", "icloud.com", "live.com", "msn.com",
    "me.com", "protonmail.com", "ymail.com", "mail.com"
  ]
}
```

**Notes**:
- `isCustom`: `false` when using global defaults (no DB record), `true` when workspace has overrides.
- `effectivePersonalDomains`: Computed field = (global defaults + personalDomainOverrides) - allowPersonalDomains.

### Response: 404 Not Found

```json
{
  "error": "Client not found",
  "clientId": "abc-123"
}
```

---

## PUT /api/v1/admin/quality-gate-config/:clientId

Create or update quality gate configuration for a workspace. Upsert behavior — creates config record if none exists, updates if it does.

### Path Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| clientId | UUID | Yes | ManagedClient ID |

### Request Body

```json
{
  "rejectPersonalEmails": true,
  "rejectMissingCompany": true,
  "rejectDuplicateEmails": true,
  "deduplicateDomains": true,
  "suppressionDomains": ["competitor.com", "vendor.com"],
  "personalDomainOverrides": ["tempmail.org"],
  "allowPersonalDomains": ["gmail.com"]
}
```

All fields are optional. Omitted fields retain their current value (or global default for new records).

### Validation

| Field | Rule |
|-------|------|
| suppressionDomains | Each entry: valid domain format (contains `.`, no protocol/paths). Max 500 entries. |
| personalDomainOverrides | Each entry: valid domain format. Max 100 entries. |
| allowPersonalDomains | Each entry: valid domain format. Max 50 entries. |

### Response: 200 OK

Returns the full config object (same shape as GET response).

### Response: 400 Bad Request

```json
{
  "error": "Validation failed",
  "details": [
    { "field": "suppressionDomains[2]", "message": "Invalid domain: 'not-a-domain'" }
  ]
}
```

---

## DELETE /api/v1/admin/quality-gate-config/:clientId

Reset workspace to global defaults by deleting the custom config record.

### Path Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| clientId | UUID | Yes | ManagedClient ID |

### Response: 200 OK

```json
{
  "message": "Quality gate config reset to defaults",
  "clientId": "abc-123"
}
```

### Response: 404 Not Found

```json
{
  "error": "No custom config found for client",
  "clientId": "abc-123"
}
```

---

## GET /api/v1/admin/quality-gate-config/defaults

Retrieve the global default configuration (read-only, defined in code).

### Response: 200 OK

```json
{
  "config": {
    "rejectPersonalEmails": true,
    "rejectMissingCompany": true,
    "rejectDuplicateEmails": true,
    "deduplicateDomains": true,
    "suppressionDomains": [],
    "personalDomainOverrides": [],
    "allowPersonalDomains": []
  },
  "defaultPersonalDomains": [
    "gmail.com", "yahoo.com", "hotmail.com", "outlook.com",
    "aol.com", "icloud.com", "live.com", "msn.com",
    "me.com", "protonmail.com", "ymail.com", "mail.com"
  ]
}
```
