# Research: Campaign Management Enhancements

**Feature**: 8-campaign-management
**Date**: 2026-03-09

## R-001: External Campaign Listing APIs

**Decision**: Add campaign listing functions to Instantly and HeyReach clients, with per-client credential support.

**Rationale**: The existing clients (`instantlyClient.ts`, `heyreachClient.ts`) use global API keys from `config`. For per-client campaigns, we need functions that accept a decrypted API key parameter.

**Instantly API v2** - List Campaigns:
- Endpoint: `GET /api/v2/campaigns` with `?api_key=...` or Bearer token
- Returns: `{ items: [{ id, name, status, ... }] }`
- Docs confirm campaign list is available on v2

**HeyReach API** - List Campaigns:
- Endpoint: `GET /api/public/campaigns` with `X-API-KEY` header
- Returns: `{ data: [{ id, name, status, ... }] }`

**Alternatives considered**:
- Reuse global client with key swap: Rejected - not thread-safe, existing clients use module-level config
- Create new per-client wrapper module: Selected - isolates per-client calls, keeps existing clients untouched

## R-002: Contact Quality Stats Computation

**Decision**: Add `getContactQualityStats()` to `statsAggregator.ts` using Prisma `count` queries on existing `canEmail`, `canCall`, `canLinkedin` boolean fields.

**Rationale**: CampaignContact already stores quality flags from import. Stats are simple aggregation of existing data.

**Implementation**: Three `prisma.campaignContact.count()` calls with `where: { campaignId, canEmail: true }` etc., plus a multi-channel count where all three are true. Runs in parallel with `Promise.all()`.

**Alternatives considered**:
- Pre-compute on import: Already partially done (ImportResult has counts), but not persisted on campaign. Rejected because counts could become stale if contacts are modified.
- Store on Campaign model: Rejected - derived data should be computed, not duplicated.

## R-003: Campaign Delete Strategy

**Decision**: Two-tier approach matching existing patterns:
- DRAFT campaigns with 0 contacts: Hard delete (cascade CampaignBdr, CampaignSequenceStep)
- All other statuses: Transition to ARCHIVED status

**Rationale**: DRAFT with no contacts is safe to hard delete (no data loss). Other campaigns have imported contacts and execution history that should be preserved for audit purposes. Matches constitution's SOC 2 logging requirements.

**Alternatives considered**:
- Soft-delete with `isActive` flag: Rejected - Campaign already has ARCHIVED status which serves this purpose
- Always hard delete: Rejected - violates SOC 2 audit trail requirements

## R-004: Edit UI Approach

**Decision**: Edit dialog on campaign detail page (not a full page).

**Rationale**: Matches existing patterns in BDR management and Client management pages which both use Dialog components for editing. Keeps user on detail page for quick edits.

**Alternatives considered**:
- Full edit page (like campaign-create): Rejected - inconsistent with BDR/Client patterns
- Inline editing: Rejected - too many fields for inline approach

## R-005: Per-Client API Key Architecture

**Decision**: Create a `clientApiService.ts` that fetches a ManagedClient, decrypts the requested key, and returns it. New Instantly/HeyReach list-campaigns functions accept an API key parameter.

**Rationale**: Existing clients use global config keys. Per-client credentials need decryption from ManagedClient. Isolating this in a service keeps encryption logic centralized.

**Pattern**:
```
1. Backend route receives request with clientId
2. clientApiService.getDecryptedKey(clientId, 'instantly') → string | null
3. instantlyClient.listCampaigns(apiKey) → campaign list
4. Return to frontend
```

## R-006: HubSpot Contact Import - DNC Handling

**Decision**: Treat `donotcall` as `true` when value is `true`, `"true"`, or `null`/`undefined` (unknown). Only `false` or `"false"` allows calling.

**Rationale**: User explicitly requested "DO NOT CALL is unknown" must be filtered out. Conservative approach - only allow calling when explicitly permitted.

**Current code**: `canCall = !!resolvedPhone` (no DNC check). Must update to: `canCall = !!resolvedPhone && String(donotcall).toLowerCase() === 'false'`.

**HubSpot property**: `donotcall` is a standard HubSpot contact property (boolean type, but API may return string). Using `String(...).toLowerCase() === 'false'` handles both boolean `false` and string `"false"` from the API, while correctly rejecting `true`, `"true"`, `null`, and `undefined` (unknown).
