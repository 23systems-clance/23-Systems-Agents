# Data Model: Multi-Tenant SaaS Licensing

**Branch**: `35-multi-tenant-saas-licensing` | **Date**: 2026-03-18
**Phase**: 1 — Design & Contracts

---

## New Models

### LicenseKey

Represents a one-time activation key issued by the platform owner for client workspace activation.

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | String (cuid) | PK | Internal identifier |
| key | String | Unique, NOT NULL | Full license key (e.g., `SLKP-A7F3-8D2E-9B1C-4F6A`) |
| featureFlags | Json | NOT NULL | Feature flags preset for this key (e.g., `{ enrichment: true, campaigns: false }`) |
| initialCredits | Int | NOT NULL, default 0 | Credits allocated to workspace upon activation |
| subscriptionTier | String | NOT NULL, default 'starter' | Subscription tier assigned (starter/professional/enterprise) |
| expiresAt | DateTime | Nullable | Expiration blocks new activations only; activated workspaces unaffected |
| singleUse | Boolean | NOT NULL, default true | Whether key can only activate one workspace |
| activatedWorkspaceId | String | Nullable, FK → WorkspaceInstallation.slackTeamId | Workspace that activated this key |
| activatedAt | DateTime | Nullable | When the key was activated |
| revokedAt | DateTime | Nullable | When the key was revoked by platform owner |
| createdByAdminId | String | NOT NULL, FK → AdminUser.id | Admin who created the key |
| notes | String | Nullable | Internal notes (e.g., client name, deal reference) |
| createdAt | DateTime | NOT NULL, default now() | |
| updatedAt | DateTime | NOT NULL, auto | |

**Indexes**: `key` (unique), `activatedWorkspaceId`, `createdByAdminId`
**Lifecycle**: Created → Activated (one-time, sets `activatedWorkspaceId` + `activatedAt`) → key becomes inert. Optionally revoked (sets `revokedAt`).
**Validation**: Key is valid when: exists AND `revokedAt` is null AND (`expiresAt` is null OR `expiresAt` > now) AND `activatedWorkspaceId` is null (single-use).

---

### CreditPack

Pre-defined credit bundle available for one-time purchase.

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | String (cuid) | PK | Internal identifier |
| name | String | NOT NULL | Display name (e.g., "200 Credit Pack") |
| creditAmount | Int | NOT NULL | Number of credits in the pack |
| priceUsd | Decimal | NOT NULL | Price in USD (e.g., 49.99) |
| stripePriceId | String | Nullable | Optional pre-created Stripe Price ID |
| active | Boolean | NOT NULL, default true | Whether pack is available for purchase |
| sortOrder | Int | NOT NULL, default 0 | Display order in UI |
| createdAt | DateTime | NOT NULL, default now() | |
| updatedAt | DateTime | NOT NULL, auto | |

**Indexes**: `active` (partial: WHERE active = true)

---

### EnrichmentChannel

Per-user private channel registration for enrichment access.

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | String (cuid) | PK | Internal identifier |
| slackTeamId | String | NOT NULL | Workspace identifier |
| slackChannelId | String | NOT NULL | Private Slack channel ID |
| slackChannelName | String | NOT NULL | Channel name (denormalized for display) |
| assignedUserId | String | NOT NULL | Slack user ID assigned to this channel |
| assignedUserName | String | NOT NULL | Slack user display name (denormalized) |
| status | Enum | NOT NULL, default ACTIVE | ACTIVE or INACTIVE |
| registeredAt | DateTime | NOT NULL, default now() | |
| deactivatedAt | DateTime | Nullable | When deactivated by admin |
| createdAt | DateTime | NOT NULL, default now() | |
| updatedAt | DateTime | NOT NULL, auto | |

**Indexes**: `(slackTeamId, slackChannelId)` unique, `(slackTeamId, assignedUserId)`, `(slackTeamId, status)`
**Validation**: One active channel per user per workspace (enforced at application level, not DB — user can re-register a different channel).

---

### AnalysisChannel

Per-workspace ICP & analysis channel designation.

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | String (cuid) | PK | Internal identifier |
| slackTeamId | String | NOT NULL, unique | One analysis channel per workspace |
| slackChannelId | String | NOT NULL | Designated Slack channel ID |
| slackChannelName | String | NOT NULL | Channel name (denormalized) |
| icpDocumentUrl | String | Nullable | S3 URL for stored ICP document |
| useCasesDocumentUrl | String | Nullable | S3 URL for use cases document |
| caseStudiesDocumentUrl | String | Nullable | S3 URL for case studies document |
| icpExtractedText | String | Nullable | Extracted text content for AI context |
| useCasesExtractedText | String | Nullable | Extracted text content for AI context |
| caseStudiesExtractedText | String | Nullable | Extracted text content for AI context |
| lastDocumentUploadAt | DateTime | Nullable | Last document update timestamp |
| createdAt | DateTime | NOT NULL, default now() | |
| updatedAt | DateTime | NOT NULL, auto | |

**Indexes**: `slackTeamId` (unique), `slackChannelId`

---

### OnboardingStep (Enum)

Tracks client workspace onboarding progress.

```
PENDING        → Installed, awaiting license key
LICENSE_KEY    → License key entry step
BILLING        → Billing/payment setup step
CHANNELS       → Channel assignment step
COMPLETE       → Onboarding finished
```

---

## Extended Models

### WorkspaceInstallation (existing — extend)

| New/Changed Field | Type | Constraints | Description |
|-------------------|------|-------------|-------------|
| workspaceType | Enum | NOT NULL, default CLIENT | `PLATFORM_OWNER` or `CLIENT` |
| licenseKeyId | String | Nullable, FK → LicenseKey.id | License key used for activation |
| featureFlags | Json | NOT NULL, default `{}` | Per-workspace feature toggles (see Feature Flag Schema below) |
| onboardingStatus | Enum | NOT NULL, default PENDING | OnboardingStep enum value |
| clientDashboardEnabled | Boolean | NOT NULL, default true | Whether client can access dashboard |

**New Relations**: `licenseKey` → LicenseKey, `enrichmentChannels` → EnrichmentChannel[], `analysisChannel` → AnalysisChannel

---

### BillingProfile (existing — extend)

| New/Changed Field | Type | Constraints | Description |
|-------------------|------|-------------|-------------|
| subscriptionTier | String | NOT NULL, default 'starter' | starter/professional/enterprise |
| stripeSubscriptionId | String | Nullable | Stripe Subscription ID for monthly billing |
| nextResetAt | DateTime | Nullable | Next credit reset date |

---

### CreditTransaction (existing — extend enum)

Add new transaction types to existing `CreditTransactionType` enum:

```
CREDIT_PACK_PURCHASE    → Credits added via credit pack purchase
LICENSE_ACTIVATION      → Initial credits from license key activation
```

---

## Feature Flag Schema

The `featureFlags` JSON field on `WorkspaceInstallation` uses this schema:

```typescript
interface FeatureFlags {
  enrichment: boolean;       // Core enrichment (default: true for clients)
  campaigns: boolean;        // Campaign management (default: false)
  workflows: boolean;        // Workflow builder (default: false)
  onboarding: boolean;       // BDR onboarding system (default: false)
  dialer: boolean;           // Power dialer (default: false)
  analytics: boolean;        // Analytics dashboard (default: false)
  icpAnalysis: boolean;      // ICP & analysis reports (default: false)
  personalityAnalysis: boolean; // AIARC personality analysis (default: false)
  aiAgent: boolean;          // AI agent side panel (default: false, MVP: always false)
}
```

**Default flags for new client workspaces** (overridden by license key preset):
```json
{
  "enrichment": true,
  "campaigns": false,
  "workflows": false,
  "onboarding": false,
  "dialer": false,
  "analytics": false,
  "icpAnalysis": false,
  "personalityAnalysis": false,
  "aiAgent": false
}
```

**Platform owner workspace flags** (always all true):
```json
{
  "enrichment": true,
  "campaigns": true,
  "workflows": true,
  "onboarding": true,
  "dialer": true,
  "analytics": true,
  "icpAnalysis": true,
  "personalityAnalysis": true,
  "aiAgent": true
}
```

---

## Entity Relationship Diagram (Text)

```
AdminUser ──creates──> LicenseKey ──activates──> WorkspaceInstallation
                                                       │
                    ┌──────────────────────────────────┼──────────────────────┐
                    │                                  │                      │
             BillingProfile                   EnrichmentChannel[]       AnalysisChannel
                    │                          (per user)                (per workspace)
            CreditTransaction[]
                    │
            CreditPack (purchased via Stripe)
```

---

## Migration Strategy

1. **Non-breaking**: All new fields on existing models have defaults or are nullable
2. **Feature flags**: Default `{}` for `featureFlags` — existing workspaces continue operating with current behavior (empty flags = all features enabled for backward compatibility)
3. **Workspace type**: Default `CLIENT` — the deploy script sets `PLATFORM_OWNER_TEAM_ID` env var, and the app auto-detects and updates the workspace type on startup
4. **Onboarding status**: Default `PENDING` for new installs; existing installs auto-set to `COMPLETE` via migration
5. **Billing profile**: Existing profiles unchanged; `subscriptionTier` defaults to `'starter'`
6. **Backward compatibility**: Workspaces with empty `featureFlags` JSON are treated as "all features enabled" (pre-licensing behavior preserved)
