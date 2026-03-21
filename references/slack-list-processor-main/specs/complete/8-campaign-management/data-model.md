# Data Model: Campaign Management Enhancements

**Feature**: 8-campaign-management
**Date**: 2026-03-09

## Existing Entities (Modified)

### Campaign (existing - no schema changes needed)

The Campaign model already has `clientId` (FK to ManagedClient), which is currently nullable. No schema change required - the activation validation will enforce client assignment at runtime.

| Field | Type | Notes |
| ----- | ---- | ----- |
| clientId | String? (FK) | Already exists. Optional at creation, required at activation. |

### CampaignContact (existing - no schema changes needed)

Already has `canEmail`, `canCall`, `canLinkedin` boolean fields. The contact import logic will be updated to evaluate DNC status when setting `canCall`.

| Field | Type | Current Logic | New Logic |
| ----- | ---- | ------------- | --------- |
| canEmail | Boolean | `!!email && status !== 'bounced'` | Same (already correct) |
| canCall | Boolean | `!!resolvedPhone` | `!!resolvedPhone && String(donotcall).toLowerCase() === 'false'` |
| canLinkedin | Boolean | `isValidLinkedInUrl(url)` | Same (already correct) |

## New Types (No Schema Changes)

### ContactQualityStats (runtime type only)

Computed from existing CampaignContact data. Not persisted.

```typescript
interface ContactQualityStats {
  totalContacts: number;
  emailVerified: number;    // count where canEmail = true
  phoneCallable: number;    // count where canCall = true
  linkedinAvailable: number; // count where canLinkedin = true
  multiChannel: number;     // count where canEmail AND canCall AND canLinkedin = true
}
```

### ExternalCampaignItem (runtime type only)

Returned from Instantly/HeyReach campaign list API calls.

```typescript
interface ExternalCampaignItem {
  id: string;
  name: string;
  status?: string;
}
```

## State Transitions

### Campaign Status Lifecycle (updated with ARCHIVED)

```
DRAFT ──────────────────────────────────────> ARCHIVED (via archive)
  │                                              ↑
  │ activate (requires: client, BDRs,            │
  │   steps, contact list, type config)          │
  ↓                                              │
ACTIVE ──────────> PAUSED ──────────────────> ARCHIVED (via archive)
  │                  │  ↑                        ↑
  │                  │  └── resume               │
  │                  │                           │
  ↓                  ↓                           │
COMPLETED ──────────────────────────────────> ARCHIVED (via archive)
```

**Delete Rules**:
- DRAFT with 0 contacts: Hard delete allowed
- All other states: Archive only (set status to ARCHIVED)

## Validation Rules (Activation)

The existing `validateCampaignForActivation()` will be extended:

| Rule | Current | Updated |
| ---- | ------- | ------- |
| Has name | Yes | Same |
| Has >= 1 step | Yes | Same |
| Has >= 1 BDR | Yes | Same |
| Has contact list | Yes | Same |
| Has client assigned | No | **New - FR-019** |
| Type-specific config | Yes | Same |
| Has required external campaign IDs | Yes | Same |

## Relationships (Existing, No Changes)

```
ManagedClient 1 ──── * Campaign
Campaign 1 ──── * CampaignBdr
Campaign 1 ──── * CampaignContact
Campaign 1 ──── * CampaignSequenceStep
Bdr * ──── * ManagedClient (via BdrClient)
```
