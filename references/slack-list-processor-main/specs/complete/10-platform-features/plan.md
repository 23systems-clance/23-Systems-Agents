# Implementation Plan: Platform Features

**Branch**: `10-platform-features` | **Date**: 2026-03-10 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/10-platform-features/spec.md`

## Summary

Add five platform capabilities: (1) workspace & client assignment with credential isolation, (2) API key rotation with dual-key fallback, (3) enrichment preset tagging and enable/disable, (4) configurable data retention purge (30-90 days) for contact PII, and (5) self-hosted SOC 2 licensing with offline validation. Requires Prisma schema migration for new models (`ApiCredential`, `PresetTag`, `License`) and field additions to existing models (`ManagedClient`, `EnrichmentPreset`, `RetentionConfig`).

## Technical Context

**Language/Version**: TypeScript 5.x (Node.js backend + React frontend)
**Primary Dependencies**: Express 4.x (backend), React 18 + Vite (admin-dashboard), @tanstack/react-query, shadcn/ui, Prisma ORM
**Storage**: PostgreSQL via Prisma (AWS RDS), Redis (AWS ElastiCache) for BullMQ
**Testing**: Manual testing via deployed ECS service (no local dev server)
**Target Platform**: Web (SPA admin dashboard) + ECS Fargate backend
**Project Type**: Web application (backend + frontend)
**Constraints**: Single Socket Mode connection (ECS only), no local server
**Scale/Scope**: Admin tool, ~10 concurrent users max
**Cryptography**: AES-256-GCM for key encryption (`src/lib/tokenEncryption.ts`), Ed25519 for license signatures

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

| Principle | Status | Notes |
| --------- | ------ | ----- |
| I. CRM-First | PASS | Workspace isolation extends CRM client model |
| III. API-First | PASS | All endpoints designed before UI |
| IV. Client Isolation | PASS | Per-client credentials, retention, and data scoping |
| V. SOC 2 Audit Logging | PASS | All key rotations, retention changes, and license events logged |
| VI. Cost Tracking | N/A | No new paid API calls |
| VIII. Integration-Centric | PASS | Credential rotation supports all existing integrations |
| XIII. Confirmation-Required | PASS | Key revocation and data purge use confirmation dialogs |
| XIV. UI/UX First | PASS | Follows existing admin dashboard patterns |
| XV. AWS-Only | PASS | All testing via deployed ECS, no local dev |
| XIX. GitHub Account | PASS | Using developerlabsai account |

**Post-Design Re-check**: All gates still pass. Schema migration required (new tables + field additions).

## Project Structure

### Documentation (this feature)

```text
specs/10-platform-features/
├── plan.md              # This file
├── spec.md              # Feature specification
├── research.md          # Phase 0 research decisions
├── data-model.md        # Data model documentation
├── quickstart.md        # Implementation quickstart
├── checklists/
│   └── requirements.md  # FR traceability
└── tasks.md             # Task breakdown
```

### Source Code (repository root)

```text
prisma/
└── schema.prisma                      # MODIFY: add enums, new models, extend existing models

src/
├── lib/
│   ├── tokenEncryption.ts             # EXISTING (no changes - reuse encrypt/decrypt)
│   ├── clientApiService.ts            # EXISTING (modify to use ApiCredential table)
│   ├── credentialResolver.ts          # NEW: resolve active key for service+client with fallback
│   └── licenseValidator.ts            # NEW: Ed25519 license verification + fingerprint
├── routes/admin/
│   ├── clientManagement.ts            # MODIFY: add workspace fields CRUD
│   ├── enrichmentPresets.ts           # MODIFY: add tag + enable/disable endpoints
│   ├── retention.ts                   # MODIFY: add per-client retention support
│   ├── apiCredentials.ts              # NEW: CRUD for API key rotation
│   └── licensing.ts                   # NEW: license activation + status endpoints
├── services/
│   ├── retention/
│   │   ├── conversationPurge.ts       # EXISTING (no changes)
│   │   ├── workspaceDisposal.ts       # EXISTING (no changes)
│   │   └── contactDataPurge.ts        # NEW: purge contact PII by retention policy
│   └── licensing/
│       ├── licenseService.ts          # NEW: license lifecycle management
│       └── fingerprintGenerator.ts    # NEW: deployment fingerprint generation
└── middleware/
    └── licenseGuard.ts                # NEW: middleware to check license status

admin-dashboard/src/
├── services/
│   ├── managed-clients.ts             # MODIFY: add workspace fields
│   ├── enrichment-presets.ts          # MODIFY: add tag + enable/disable
│   ├── api-credentials.ts            # NEW: credential rotation API calls
│   └── licensing.ts                  # NEW: license status API calls
├── pages/
│   ├── managed-clients.tsx            # MODIFY: add workspace fields to edit form
│   ├── enrichment-presets.tsx         # MODIFY: add tag filter, enable/disable toggle
│   └── settings.tsx                   # MODIFY: add retention + license sections
└── components/
    ├── credentials/
    │   └── ApiKeyRotationPanel.tsx     # NEW: key rotation UI with status indicators
    └── presets/
        └── PresetTagFilter.tsx         # NEW: tag filter bar for presets
```

## Phase Overview

| Phase | Scope | Priority | Depends On |
| ----- | ----- | -------- | ---------- |
| 0 | Research & Design | - | - |
| 1 | Workspace & Client Assignment | P1 | Phase 0 |
| 2 | API Key Rotation | P1 | Phase 1 (schema migration) |
| 3 | Enrichment Preset Tags + Enable/Disable | P2 | Phase 1 (schema migration) |
| 4 | Data Retention Policy | P2 | Phase 1 (schema migration) |
| 5 | Self-Hosted Licensing | P3 | Phase 1 (schema migration) |

---

## Phase 0: Research

**Goal**: Validate design decisions documented in [research.md](research.md).

- R-001: Workspace isolation via ManagedClient extension
- R-002: Dual-key rotation pattern with ApiCredential table
- R-003: Many-to-many tag model for enrichment presets
- R-004: Batch deletion purge strategy for contact PII
- R-005: Ed25519-signed license keys with offline validation
- R-006: isEnabled boolean for preset enable/disable

**Output**: research.md, data-model.md (complete)

---

## Phase 1: Workspace & Client Assignment (P1)

**Goal**: Extend ManagedClient with workspace-level isolation. Add slackTeamId scoping and additional credential fields. Schema migration.

### 1.1 Schema Migration

- Add `slackTeamId`, `apolloApiKey`, `builtwithApiKey` to `ManagedClient`
- Add `isEnabled` to `EnrichmentPreset`
- Add `clientId` to `RetentionConfig` (change unique constraint)
- Add new enums: `ApiCredentialStatus`, `ApiServiceType`, `LicenseStatus`
- Add new models: `ApiCredential`, `PresetTag`, `License`

**Files**:
- `prisma/schema.prisma`
- Migration via `npx prisma migrate dev`

### 1.2 Backend - Workspace CRUD

- Extend `clientManagement.ts` routes to accept/return new workspace fields
- Update `clientApiService.ts` to scope key lookups by workspace

**Files**:
- `src/routes/admin/clientManagement.ts`
- `src/lib/clientApiService.ts`

### 1.3 Frontend - Workspace UI

- Add workspace fields (slackTeamId, Apollo/BuiltWith keys) to client edit form
- Add workspace filter on client list page

**Files**:
- `admin-dashboard/src/pages/managed-clients.tsx`
- `admin-dashboard/src/services/managed-clients.ts`

---

## Phase 2: API Key Rotation (P1)

**Goal**: Enable multi-key per service per client with transition period and automatic fallback.

### 2.1 Credential Resolver

- Create `credentialResolver.ts` with `getActiveKey(clientId, service)` function
- Implements: use newest ACTIVE key, fallback to previous ACTIVE on auth failure
- Updates `lastUsedAt` on successful use

**Files**:
- `src/lib/credentialResolver.ts` (NEW)

### 2.2 API Credential Routes

- CRUD for ApiCredential records
- POST: add new key (encrypt via tokenEncryption)
- PATCH: deprecate/revoke with guard against last-active revoke
- GET: list keys for client+service (never return decrypted key values)
- All mutations logged to AuditLog

**Files**:
- `src/routes/admin/apiCredentials.ts` (NEW)

### 2.3 Frontend - Rotation UI

- Key rotation panel on client detail page
- Status badges (ACTIVE/DEPRECATED/REVOKED)
- Add/deprecate/revoke actions with confirmation dialogs
- Masked key display (last 4 characters only)

**Files**:
- `admin-dashboard/src/components/credentials/ApiKeyRotationPanel.tsx` (NEW)
- `admin-dashboard/src/services/api-credentials.ts` (NEW)

---

## Phase 3: Enrichment Preset Tags + Enable/Disable (P2)

**Goal**: Tag presets for organization, filter by tag, toggle enable/disable.

### 3.1 Tag CRUD on Preset Routes

- Extend `enrichmentPresets.ts` with tag management endpoints
- POST/DELETE tags on a preset
- GET presets with tag filter query parameter
- PATCH enable/disable toggle

**Files**:
- `src/routes/admin/enrichmentPresets.ts`

### 3.2 Frontend - Tag Filter + Toggle

- Tag filter bar component on presets list page
- Multi-tag filter with chip display
- Enable/disable toggle switch per preset row
- Visual indicator (greyed out) for disabled presets

**Files**:
- `admin-dashboard/src/components/presets/PresetTagFilter.tsx` (NEW)
- `admin-dashboard/src/pages/enrichment-presets.tsx`
- `admin-dashboard/src/services/enrichment-presets.ts`

---

## Phase 4: Data Retention Policy (P2)

**Goal**: Configurable 30-90 day purge of contact PII with permanent application log retention.

### 4.1 Contact Data Purge Service

- Create `contactDataPurge.ts` with batch deletion logic
- Targets: JobContact PII fields, CampaignContact PII fields, S3 result files
- Respects per-client retention overrides
- Batch size: 100 records per transaction
- Logs purge stats to AuditLog

**Files**:
- `src/services/retention/contactDataPurge.ts` (NEW)

### 4.2 Scheduled Purge Job

- Register BullMQ repeatable job for daily purge at 02:00 UTC
- Follows existing pattern from conversation purge scheduling

**Files**:
- `src/queues/` (existing queue registration files)

### 4.3 Per-Client Retention Config

- Extend retention routes for per-client overrides
- Client-specific retention takes precedence over global default

**Files**:
- `src/routes/admin/retention.ts`

### 4.4 Frontend - Retention Settings

- Per-client retention slider (30-90 days) on client detail page
- Global retention settings on platform settings page
- Last purge timestamp display

**Files**:
- `admin-dashboard/src/pages/settings.tsx`
- `admin-dashboard/src/pages/managed-clients.tsx`

---

## Phase 5: Self-Hosted Licensing (P3)

**Goal**: Ed25519-signed license keys with offline validation, user limit enforcement, and grace period.

### 5.1 License Validator

- Create `licenseValidator.ts` with Ed25519 signature verification
- Parse license key format: `LICENSE-v1.<payload>.<signature>`
- Validate expiry, fingerprint, and signature

**Files**:
- `src/lib/licenseValidator.ts` (NEW)

### 5.2 Fingerprint Generator

- Create `fingerprintGenerator.ts` with SHA-256 fingerprint
- Inputs: hostname, network interfaces, database connection string

**Files**:
- `src/services/licensing/fingerprintGenerator.ts` (NEW)

### 5.3 License Service

- License activation, renewal, status check
- User count enforcement
- Grace period management (14 days post-expiry)
- Read-only mode enforcement after grace period

**Files**:
- `src/services/licensing/licenseService.ts` (NEW)

### 5.4 License Guard Middleware

- Express middleware to check license validity on every admin request
- Returns 403 with license status if expired beyond grace period
- Allows read-only operations during grace period

**Files**:
- `src/middleware/licenseGuard.ts` (NEW)

### 5.5 License Routes + Frontend

- Activation endpoint, status endpoint, renewal endpoint
- License status page in admin dashboard

**Files**:
- `src/routes/admin/licensing.ts` (NEW)
- `admin-dashboard/src/services/licensing.ts` (NEW)
- `admin-dashboard/src/pages/settings.tsx`

---

## Dependencies & Execution Order

### Phase Dependencies

```
Phase 0 (Research) ──> Phase 1 (Schema + Workspace) ──┬──> Phase 2 (API Key Rotation)
                                                       ├──> Phase 3 (Preset Tags)
                                                       ├──> Phase 4 (Data Retention)
                                                       └──> Phase 5 (Licensing)
```

- **Phase 0**: No dependencies - start immediately
- **Phase 1**: Depends on Phase 0 research. Schema migration must complete first.
- **Phase 2**: Depends on Phase 1 schema (ApiCredential model)
- **Phase 3**: Depends on Phase 1 schema (PresetTag model, isEnabled field)
- **Phase 4**: Depends on Phase 1 schema (RetentionConfig clientId field)
- **Phase 5**: Depends on Phase 1 schema (License model). Can run in parallel with 2-4.

### Parallel Opportunities

- **Phases 2-5**: All can start in parallel after Phase 1 schema migration
- Within Phase 2: Backend credential resolver (2.1) and routes (2.2) can be built before frontend (2.3)
- Within Phase 3: Backend tag CRUD (3.1) before frontend (3.2)
- Within Phase 4: Purge service (4.1) and scheduled job (4.2) before frontend (4.4)
- Within Phase 5: Validator (5.1) and fingerprint (5.2) can be built in parallel

### Implementation Strategy

**Priority-first delivery**:
1. Phase 1 (Schema + Workspace) - foundation for everything
2. Phase 2 (API Key Rotation) - P1, security-critical
3. Phase 3 (Preset Tags) - P2, quick win
4. Phase 4 (Data Retention) - P2, compliance requirement
5. Phase 5 (Licensing) - P3, deferred to later sprint

## Complexity Tracking

No constitution violations requiring complexity tracking. UI follows existing admin dashboard patterns (Dialog, AlertDialog, data tables). No novel UI paradigms.
