# Data Model: Platform Features

**Feature**: 10-platform-features
**Date**: 2026-03-10

## Existing Entities (Modified)

### ManagedClient (existing - extended with workspace fields)

Adds workspace-scoping fields and additional API credential slots. Existing fields and relationships are preserved.

| Field | Type | Change | Notes |
| ----- | ---- | ------ | ----- |
| slackTeamId | String? | **NEW** | Scopes client to a workspace. Null = global/unscoped. |
| apolloApiKey | String? (Text) | **NEW** | Encrypted Apollo API key per client. |
| builtwithApiKey | String? (Text) | **NEW** | Encrypted BuiltWith API key per client. |

```prisma
model ManagedClient {
  id              String   @id @default(uuid()) @db.Uuid
  name            String
  slug            String   @unique
  slackTeamId     String?  @map("slack_team_id")          // NEW
  instantlyApiKey String?  @map("instantly_api_key") @db.Text
  heyreachApiKey  String?  @map("heyreach_api_key") @db.Text
  hubspotApiKey   String?  @map("hubspot_api_key") @db.Text
  hubspotPortalId String?  @map("hubspot_portal_id")
  apolloApiKey    String?  @map("apollo_api_key") @db.Text  // NEW
  builtwithApiKey String?  @map("builtwith_api_key") @db.Text // NEW
  isActive        Boolean  @default(true) @map("is_active")
  createdAt       DateTime @default(now()) @map("created_at")
  updatedAt       DateTime @updatedAt @map("updated_at")

  // Relations
  bdrs            BdrClient[]
  campaigns       Campaign[]
  channelMappings ChannelClientMapping[]
  apiCredentials  ApiCredential[]          // NEW
  retentionConfig RetentionConfig[]        // NEW (per-client retention)

  @@index([isActive])
  @@index([slackTeamId])                   // NEW
  @@map("managed_clients")
}
```

### EnrichmentPreset (existing - extended with tags and enable/disable)

Adds `isEnabled` boolean and a many-to-many tag relationship.

| Field | Type | Change | Notes |
| ----- | ---- | ------ | ----- |
| isEnabled | Boolean | **NEW** | Default true. When false, excluded from workflow builder dropdowns. |

```prisma
model EnrichmentPreset {
  id                String   @id @default(uuid()) @db.Uuid
  name              String
  isDefault         Boolean  @default(false) @map("is_default")
  isEnabled         Boolean  @default(true) @map("is_enabled")  // NEW
  personSeniorities String[] @default([]) @map("person_seniorities")
  personTitles      String[] @default([]) @map("person_titles")
  personDepartments String[] @default([]) @map("person_departments")
  personFunctions   String[] @default([]) @map("person_functions")
  perPage           Int      @default(25) @map("per_page")
  createdByUserId   String   @map("created_by_user_id")
  createdByName     String?  @map("created_by_name")
  createdAt         DateTime @default(now()) @map("created_at")
  updatedAt         DateTime @updatedAt @map("updated_at")

  // Relations
  tags              PresetTag[]  // NEW (many-to-many junction)

  @@index([isDefault])
  @@index([isEnabled])  // NEW
  @@map("enrichment_presets")
}
```

### RetentionConfig (existing - extended with per-client scoping)

Adds optional `clientId` FK to allow per-workspace retention overrides.

| Field | Type | Change | Notes |
| ----- | ---- | ------ | ----- |
| clientId | String? (FK) | **NEW** | When set, retention applies to this client's data only. Null = global default. |

```prisma
model RetentionConfig {
  id            String    @id @default(uuid()) @db.Uuid
  dataType      String    @map("data_type")
  retentionDays Int       @map("retention_days")
  lastPurgedAt  DateTime? @map("last_purged_at")
  clientId      String?   @map("client_id") @db.Uuid       // NEW
  updatedBy     String?   @map("updated_by") @db.Uuid
  createdAt     DateTime  @default(now()) @map("created_at")
  updatedAt     DateTime  @updatedAt @map("updated_at")

  // Relations
  updatedByAdmin AdminUser?    @relation("RetentionUpdatedBy", fields: [updatedBy], references: [id], onDelete: SetNull)
  client         ManagedClient? @relation(fields: [clientId], references: [id], onDelete: SetNull) // NEW

  @@unique([dataType, clientId])  // CHANGED: composite unique instead of dataType alone
  @@index([clientId])             // NEW
  @@map("retention_configs")
}
```

**Migration note**: The existing `@@unique` on `dataType` alone must be changed to a composite `@@unique([dataType, clientId])`. Existing rows have `clientId = null`, so the constraint is preserved.

---

## New Entities

### ApiCredential

Stores encrypted API keys for external services, scoped to a workspace (client). Supports multiple keys per service for rotation.

```prisma
enum ApiCredentialStatus {
  ACTIVE
  DEPRECATED
  REVOKED
}

enum ApiServiceType {
  HUBSPOT
  APOLLO
  BUILTWITH
  INSTANTLY
  HEYREACH
}

model ApiCredential {
  id           String              @id @default(uuid()) @db.Uuid
  clientId     String              @map("client_id") @db.Uuid
  service      ApiServiceType
  label        String?                                          // Human-readable label (e.g., "Production Key", "Rotation 2026-03")
  encryptedKey String              @map("encrypted_key") @db.Text // AES-256-GCM encrypted, format: iv:authTag:ciphertext
  status       ApiCredentialStatus @default(ACTIVE)
  lastUsedAt   DateTime?           @map("last_used_at")
  expiresAt    DateTime?           @map("expires_at")
  createdBy    String              @map("created_by")           // Admin user ID who added the key
  revokedAt    DateTime?           @map("revoked_at")
  revokedBy    String?             @map("revoked_by")           // Admin user ID who revoked
  createdAt    DateTime            @default(now()) @map("created_at")
  updatedAt    DateTime            @updatedAt @map("updated_at")

  // Relations
  client ManagedClient @relation(fields: [clientId], references: [id], onDelete: Cascade)

  @@index([clientId, service, status])
  @@index([clientId, service])
  @@index([status])
  @@map("api_credentials")
}
```

### PresetTag

A categorization label for enrichment presets. Many-to-many relationship via implicit junction table.

```prisma
model PresetTag {
  id        String   @id @default(uuid()) @db.Uuid
  name      String   @unique                        // Normalized: lowercase, alphanumeric + hyphens, max 30 chars
  createdAt DateTime @default(now()) @map("created_at")

  // Relations
  presets EnrichmentPreset[]  // Many-to-many (Prisma implicit junction)

  @@map("preset_tags")
}
```

**Prisma implicit many-to-many**: Prisma will create a `_EnrichmentPresetToPresetTag` junction table automatically. No explicit junction model needed.

### License

Stores self-hosted deployment license information. One record per deployment.

```prisma
enum LicenseStatus {
  ACTIVE
  EXPIRED
  SUSPENDED
  REVOKED
}

model License {
  id              String        @id @default(uuid()) @db.Uuid
  licenseKey      String        @unique @map("license_key") @db.Text  // Full license key string
  organizationName String       @map("organization_name")
  userLimit       Int           @map("user_limit")                    // Base: 15 users
  additionalUsers Int           @default(0) @map("additional_users")  // Extra users beyond base
  tier            String        @default("base")                      // "base", "enterprise"
  fingerprint     String        @unique                               // SHA-256 of hostname + MAC + DB connection
  status          LicenseStatus @default(ACTIVE)
  activatedAt     DateTime      @map("activated_at")
  expiresAt       DateTime      @map("expires_at")
  gracePeriodEnds DateTime?     @map("grace_period_ends")             // expiresAt + 14 days
  lastValidatedAt DateTime?     @map("last_validated_at")
  createdAt       DateTime      @default(now()) @map("created_at")
  updatedAt       DateTime      @updatedAt @map("updated_at")

  @@map("licenses")
}
```

---

## State Transitions

### ApiCredential Status Lifecycle

```
ACTIVE ──────────────> DEPRECATED ──────────────> REVOKED
   │                       │
   │  (new key added)      │  (admin confirms)
   │                       │
   └───────────────────────┘
           (direct revoke for emergencies)
```

**Rules**:
- A new key starts as `ACTIVE`
- Old keys can be deprecated manually (transition to `DEPRECATED`)
- `DEPRECATED` keys are not used for new requests but remain valid for fallback
- `REVOKED` keys are permanently disabled; cannot be reactivated
- System prevents revoking the last `ACTIVE` key for any service+client combination

### License Status Lifecycle

```
                    ┌─── SUSPENDED (admin action)
                    │
ACTIVE ────────> EXPIRED ────────> (grace period 14 days) ────────> read-only mode
   │                │
   │                └─── REVOKED (permanent, admin action)
   │
   └─── REVOKED (permanent, admin action)
```

**Rules**:
- License starts as `ACTIVE` upon activation
- Becomes `EXPIRED` when `expiresAt` passes
- 14-day grace period: platform functions normally but shows renewal reminder
- After grace period: platform enters read-only mode (existing data accessible, new workflows/executions blocked)
- `SUSPENDED` and `REVOKED` are admin-initiated states

### ManagedClient (Workspace) Lifecycle

```
ACTIVE (isActive=true) ────────> INACTIVE (isActive=false)
                                    │
                                    └─── All assigned workflows/campaigns paused
                                         Cannot be deleted until workflows archived/reassigned
```

---

## Relationships

### New Relationships

```
ManagedClient 1 ──── * ApiCredential        (one client has many API credentials)
ManagedClient 1 ──── * RetentionConfig       (per-client retention overrides)
EnrichmentPreset * ──── * PresetTag          (many-to-many via implicit junction)
License 1 (standalone, no FKs)
```

### Existing Relationships (Unchanged)

```
ManagedClient 1 ──── * Campaign
ManagedClient 1 ──── * BdrClient
ManagedClient 1 ──── * ChannelClientMapping
Bdr * ──── * ManagedClient (via BdrClient)
Campaign 1 ──── * CampaignContact
```

---

## Validation Rules

### ApiCredential

| Rule | Description |
| ---- | ----------- |
| Cannot revoke last active key | `COUNT(status='ACTIVE', clientId=X, service=Y) > 1` required before revoke |
| Key format validation | `encryptedKey` must match `iv:authTag:ciphertext` format |
| Service must match client | Service type must be valid for the client's integration profile |

### RetentionConfig (per-workspace)

| Rule | Description |
| ---- | ----------- |
| 30-90 day range | `retentionDays` must be between 30 and 90 for contact data types |
| Locked types | `audit_logs` and `daily_aggregates` cannot be modified (permanent retention) |
| Client override | Per-client config takes precedence over global default |

### License

| Rule | Description |
| ---- | ----------- |
| User limit enforcement | `COUNT(active users) <= userLimit + additionalUsers` |
| Fingerprint uniqueness | Same license key cannot be activated on different deployments |
| Expiry grace period | 14 days after `expiresAt` before read-only enforcement |

### PresetTag

| Rule | Description |
| ---- | ----------- |
| Name normalization | Lowercase, alphanumeric + hyphens only, max 30 characters |
| Unique name | No duplicate tag names allowed |
| Cannot delete tag in use | Tag deletion cascades via Prisma implicit junction |

---

## New Enums Summary

```prisma
enum ApiCredentialStatus {
  ACTIVE
  DEPRECATED
  REVOKED
}

enum ApiServiceType {
  HUBSPOT
  APOLLO
  BUILTWITH
  INSTANTLY
  HEYREACH
}

enum LicenseStatus {
  ACTIVE
  EXPIRED
  SUSPENDED
  REVOKED
}
```
