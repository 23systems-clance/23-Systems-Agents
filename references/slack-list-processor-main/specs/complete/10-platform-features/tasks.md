# Tasks: Platform Features

**Input**: Design documents from `/specs/10-platform-features/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, quickstart.md

**Tests**: Not explicitly requested. Manual verification via deployed ECS service.

**Organization**: Tasks grouped by phase. Dependency order enforced.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel with other [P] tasks in the same phase (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1-US5)
- Exact file paths included in all descriptions

---

## Phase 1: Schema Migration (Foundation)

**Purpose**: Prisma schema changes that all subsequent phases depend on. Single migration.

**CRITICAL**: No backend or frontend work can begin until migration is applied.

- [ ] T001 [US1] Add `slackTeamId` (optional String), `apolloApiKey` (optional Text), and `builtwithApiKey` (optional Text) fields to `ManagedClient` model in `prisma/schema.prisma`. Add `@@index([slackTeamId])`. Add `apiCredentials ApiCredential[]` and `retentionConfig RetentionConfig[]` relations.

- [ ] T002 [US3] Add `isEnabled` Boolean field (default true) to `EnrichmentPreset` model in `prisma/schema.prisma`. Add `@@index([isEnabled])`. Add `tags PresetTag[]` relation for many-to-many.

- [ ] T003 [US4] Add optional `clientId` (FK to ManagedClient) to `RetentionConfig` model in `prisma/schema.prisma`. Change unique constraint from `@@unique([dataType])` to `@@unique([dataType, clientId])`. Add `@@index([clientId])` and `client ManagedClient?` relation.

- [ ] T004 [P] [US2] Add `ApiCredentialStatus` enum (ACTIVE, DEPRECATED, REVOKED), `ApiServiceType` enum (HUBSPOT, APOLLO, BUILTWITH, INSTANTLY, HEYREACH), and `ApiCredential` model to `prisma/schema.prisma` per data-model.md. Include all fields: id, clientId, service, label, encryptedKey, status, lastUsedAt, expiresAt, createdBy, revokedAt, revokedBy, timestamps. Add indexes on `[clientId, service, status]` and `[clientId, service]`.

- [ ] T005 [P] [US3] Add `PresetTag` model to `prisma/schema.prisma` with id, name (unique), createdAt. Use Prisma implicit many-to-many with `EnrichmentPreset`.

- [ ] T006 [P] [US5] Add `LicenseStatus` enum (ACTIVE, EXPIRED, SUSPENDED, REVOKED) and `License` model to `prisma/schema.prisma` per data-model.md. Include all fields: id, licenseKey (unique Text), organizationName, userLimit, additionalUsers, tier, fingerprint (unique), status, activatedAt, expiresAt, gracePeriodEnds, lastValidatedAt, timestamps.

- [ ] T007 Run `npx prisma migrate dev --name platform-features` to generate and apply the migration. Verify migration SQL is correct. Run `npx prisma generate` to update Prisma client.

**Checkpoint**: Schema migration applied. All new models and fields available in Prisma client.

---

## Phase 2: Workspace & Client Assignment (P1)

**Goal**: Extend ManagedClient with workspace isolation fields and update CRUD.

**Independent Test**: Create a client with slackTeamId -> verify it is scoped. Create workflows under that client -> verify isolation.

### Backend

- [ ] T008 [US1] Update create endpoint in `src/routes/admin/clientManagement.ts` to accept `slackTeamId`, `apolloApiKey`, `builtwithApiKey` in request body. Encrypt new API key fields using `encrypt()` from `src/lib/tokenEncryption.ts` before storing.

- [ ] T009 [US1] Update update endpoint in `src/routes/admin/clientManagement.ts` to accept and persist workspace fields. When API keys change, encrypt new values. Log changes via `logAudit()`.

- [ ] T010 [US1] Update list endpoint in `src/routes/admin/clientManagement.ts` to accept `slackTeamId` query parameter for filtering clients by workspace. Return workspace fields in response (never return decrypted API keys).

- [ ] T011 [US1] Update `src/lib/clientApiService.ts` to include `apolloApiKey` and `builtwithApiKey` in the decryption lookup. Add `'apollo'` and `'builtwith'` as valid platform parameters to `getDecryptedKey()`.

### Frontend

- [ ] T012 [P] [US1] Update `admin-dashboard/src/services/managed-clients.ts` to add `slackTeamId`, `apolloApiKey`, `builtwithApiKey` fields to the ManagedClient TypeScript interface and create/update API calls.

- [ ] T013 [US1] Update client edit form in `admin-dashboard/src/pages/managed-clients.tsx` to include workspace fields: slackTeamId input, Apollo API Key input, BuiltWith API Key input. API key fields should use password-type inputs with show/hide toggle.

- [ ] T014 [US1] Add workspace filter dropdown to client list page in `admin-dashboard/src/pages/managed-clients.tsx`. Fetch distinct slackTeamIds, display as a Select filter alongside existing isActive filter.

**Checkpoint**: Clients have workspace isolation. Credentials include Apollo and BuiltWith.

---

## Phase 3: API Key Rotation (P1)

**Goal**: Enable multi-key per service per client with dual-key fallback.

**Independent Test**: Add new key -> verify both active. Simulate failure -> verify fallback. Deprecate old key -> verify status. Revoke -> verify blocked. Try revoke last key -> verify error.

### Backend

- [ ] T015 [US2] Create `src/lib/credentialResolver.ts` with `getActiveKey(clientId: string, service: ApiServiceType): Promise<string>` function. Query `ApiCredential` for ACTIVE keys ordered by `createdAt DESC`. Return decrypted newest key. Export `getActiveKeyWithFallback(clientId, service)` that catches auth errors and retries with the next ACTIVE key. Update `lastUsedAt` on successful use.

- [ ] T016 [US2] Create `src/routes/admin/apiCredentials.ts` with Express router:
  - `GET /:clientId/credentials` - list all credentials for a client (grouped by service). Never return decrypted key values; return masked (last 4 chars).
  - `POST /:clientId/credentials` - add new credential. Accept `service`, `key`, `label`. Encrypt key, store as ACTIVE.
  - `PATCH /:clientId/credentials/:credId` - update status (deprecate/revoke). Guard: cannot revoke last ACTIVE key for service. Set revokedAt/revokedBy on revoke.
  - All mutations: `logAudit()` with action, service, clientId, admin user.

- [ ] T017 [US2] Register `apiCredentialsRouter` in `src/routes/admin/index.ts` under path `/clients`.

- [ ] T018 [US2] Update `src/lib/clientApiService.ts` to use `credentialResolver.getActiveKey()` as primary lookup. Fall back to direct ManagedClient fields for backward compatibility (clients without ApiCredential records).

### Frontend

- [ ] T019 [P] [US2] Create `admin-dashboard/src/services/api-credentials.ts` with functions: `fetchCredentials(clientId)`, `addCredential(clientId, data)`, `updateCredentialStatus(clientId, credId, status)`. Define `ApiCredentialItem` interface.

- [ ] T020 [US2] Create `admin-dashboard/src/components/credentials/ApiKeyRotationPanel.tsx` - collapsible panel per service type. Shows list of credentials with status badge (green=ACTIVE, yellow=DEPRECATED, red=REVOKED). Actions: "Add Key" button opens dialog, "Deprecate" and "Revoke" buttons with AlertDialog confirmation. Masked key display (last 4 chars). Follow Dialog pattern from `managed-clients.tsx`.

- [ ] T021 [US2] Integrate `ApiKeyRotationPanel` into client detail/edit view in `admin-dashboard/src/pages/managed-clients.tsx`. Show below the basic client info form. One panel per service (HubSpot, Apollo, BuiltWith, Instantly, HeyReach).

**Checkpoint**: API key rotation fully functional with dual-key fallback and admin UI.

---

## Phase 4: Enrichment Preset Tags + Enable/Disable (P2)

**Goal**: Tag presets for organization, filter by tag, toggle enable/disable.

**Independent Test**: Create preset with tags -> filter by tag -> verify. Disable preset -> verify hidden from workflow builder. Re-enable -> verify visible.

### Backend

- [ ] T022 [US3] Add tag management to `src/routes/admin/enrichmentPresets.ts`:
  - Update `POST /` (create preset) to accept `tags: string[]` in body. Normalize each tag (lowercase, alphanumeric + hyphens, max 30 chars). Create or connect PresetTag records via Prisma `connectOrCreate`.
  - Update `PUT /:id` (update preset) to accept `tags: string[]`. Replace tag associations using Prisma `set` + `connectOrCreate`.
  - Update `GET /` (list presets) to accept `tag` query parameter. Filter presets that have the specified tag via `where: { tags: { some: { name: tag } } }`.
  - Update `toResponse()` to include `tags` array and `isEnabled` field.

- [ ] T023 [US3] Add enable/disable toggle to `src/routes/admin/enrichmentPresets.ts`:
  - Update `PUT /:id` to accept `isEnabled` boolean. Log enable/disable changes via `logAudit()`.
  - Update `GET /` to accept `isEnabled` query parameter for filtering.

- [ ] T024 [US3] Add `GET /tags` endpoint to `src/routes/admin/enrichmentPresets.ts` - return all distinct PresetTag names for autocomplete/filter UI. Query: `prisma.presetTag.findMany({ orderBy: { name: 'asc' } })`.

### Frontend

- [ ] T025 [P] [US3] Update `admin-dashboard/src/services/enrichment-presets.ts` to add `tags: string[]` and `isEnabled: boolean` to preset interfaces and API calls. Add `fetchPresetTags()` function.

- [ ] T026 [US3] Create `admin-dashboard/src/components/presets/PresetTagFilter.tsx` - horizontal chip bar showing available tags. Clicking a chip filters the preset list. "Clear" button to reset filter. Tags fetched via `fetchPresetTags()`.

- [ ] T027 [US3] Update `admin-dashboard/src/pages/enrichment-presets.tsx`:
  - Add `PresetTagFilter` component above preset list
  - Add tag input (comma-separated or chip input) to create/edit forms
  - Add enable/disable toggle switch per preset row
  - Show disabled presets with greyed-out styling (opacity-50)
  - Wire toggle to `updatePreset({ isEnabled })` mutation

**Checkpoint**: Presets taggable, filterable, and toggleable.

---

## Phase 5: Data Retention Policy (P2)

**Goal**: Configurable 30-90 day purge of contact PII with per-client overrides.

**Independent Test**: Set 30-day retention -> create old data -> run purge -> verify PII deleted, metadata retained -> verify audit log entry.

### Backend

- [ ] T028 [US4] Create `src/services/retention/contactDataPurge.ts` with `purgeExpiredContactData(): Promise<PurgeStats>`:
  - Query `RetentionConfig` for all `contact_data` type configs (global + per-client)
  - For each config: find JobContacts and CampaignContacts older than retentionDays
  - Batch delete in groups of 100 using `prisma.$transaction()`
  - For JobContacts: null out PII fields (fullName, firstName, lastName, email, directPhone, businessPhone, linkedinUrl, apolloMetadata) rather than deleting the row (preserve enrichment status)
  - For CampaignContacts: null out PII fields (firstName, lastName, email, mobilePhone, directPhone, linkedinUrl, companyName, jobTitle)
  - Delete S3 result files for Jobs where resultFileUrl exists and Job is past retention period
  - Update `RetentionConfig.lastPurgedAt` after each run
  - Log purge stats to `AuditLog` via `logAudit()`
  - Return PurgeStats: { contactsAnonymized, campaignContactsAnonymized, s3FilesDeleted, errors }

- [ ] T029 [US4] Register `contactDataPurge` as a BullMQ repeatable job. Add to existing queue registration in `src/queues/` (follow pattern from conversation purge). Schedule: daily at 02:00 UTC. Add job processor that calls `purgeExpiredContactData()`.

- [ ] T030 [US4] Update `src/routes/admin/retention.ts`:
  - Extend `GET /` to include per-client retention configs. Accept `clientId` query parameter.
  - Extend `PUT /:data_type` to accept optional `clientId` in body. When provided, create/update per-client override.
  - Add validation: retention for `contact_data` type must be 30-90 days.

- [ ] T031 [US4] Seed default `RetentionConfig` for `contact_data` data type with 90-day default retention if not already seeded. Add to existing seed script or migration.

### Frontend

- [ ] T032 [P] [US4] Add global retention configuration section to `admin-dashboard/src/pages/settings.tsx`. Show current retention period for contact data with a slider (30-90 days). Display last purge timestamp. Save button calls `PUT /retention/contact_data`.

- [ ] T033 [US4] Add per-client retention override to client edit view in `admin-dashboard/src/pages/managed-clients.tsx`. Show a slider (30-90 days) with "Use global default" checkbox. When unchecked, slider is enabled and saves per-client override via `PUT /retention/contact_data` with `clientId`.

**Checkpoint**: Data retention purge running daily. Per-client overrides functional.

---

## Phase 6: Self-Hosted Licensing (P3)

**Goal**: Ed25519-signed license keys with offline validation and user limit enforcement.

**Independent Test**: Activate license -> verify valid. Hit user limit -> verify blocked. Expire license -> verify grace period -> verify read-only mode.

### Backend

- [ ] T034 [US5] Create `src/services/licensing/fingerprintGenerator.ts` with `generateFingerprint(): string`:
  - Collect: `os.hostname()`, primary network interface MAC address, database connection string hash
  - Compute SHA-256 hash of concatenated values
  - Return hex-encoded fingerprint string

- [ ] T035 [US5] Create `src/lib/licenseValidator.ts` with functions:
  - `parseLicenseKey(key: string): LicensePayload` - parse `LICENSE-v1.<payload>.<signature>` format, base64url-decode payload JSON
  - `verifySignature(payload: string, signature: string, publicKey: Buffer): boolean` - Ed25519 signature verification
  - `validateLicense(key: string): LicenseValidationResult` - full validation: parse, verify signature, check expiry, compare fingerprint
  - Embed Ed25519 public key as constant (private key held by Dev Labs)

- [ ] T036 [US5] Create `src/services/licensing/licenseService.ts` with functions:
  - `activateLicense(licenseKey: string): Promise<License>` - validate key, generate fingerprint, store in DB
  - `getLicenseStatus(): Promise<LicenseStatusResult>` - check current license, compute days until expiry, grace period status
  - `checkUserLimit(): Promise<{ allowed: boolean; current: number; limit: number }>` - count active admin users vs license limit
  - `isReadOnlyMode(): Promise<boolean>` - true if license expired beyond 14-day grace period

- [ ] T037 [US5] Create `src/middleware/licenseGuard.ts` - Express middleware:
  - Skip if `DEPLOYMENT_MODE !== 'self-hosted'` (no-op for cloud deployments)
  - On each request: check `isReadOnlyMode()` from licenseService
  - If read-only: allow GET requests, reject POST/PUT/PATCH/DELETE with 403 and license status
  - If license expiring within 30 days: add `X-License-Warning` header

- [ ] T038 [US5] Create `src/routes/admin/licensing.ts` with Express router:
  - `POST /activate` - accept `licenseKey` in body, call `activateLicense()`, return license status
  - `GET /status` - return current license status, user count, expiry info
  - `POST /validate` - re-validate current license (offline check)

- [ ] T039 [US5] Register `licensingRouter` in `src/routes/admin/index.ts`. Conditionally apply `licenseGuard` middleware when `DEPLOYMENT_MODE === 'self-hosted'`.

### Frontend

- [ ] T040 [P] [US5] Create `admin-dashboard/src/services/licensing.ts` with functions: `activateLicense(key)`, `getLicenseStatus()`, `validateLicense()`. Define `LicenseStatus` interface.

- [ ] T041 [US5] Add license status section to `admin-dashboard/src/pages/settings.tsx`:
  - Show license status badge (ACTIVE/EXPIRED/SUSPENDED)
  - Show organization name, user count (current/limit), expiry date
  - Renewal reminder banner when expiring within 30 days
  - Read-only mode warning banner when past grace period
  - License activation form (key input + activate button) for initial setup

**Checkpoint**: Self-hosted licensing fully functional with offline validation.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Final improvements across all user stories.

- [ ] T042 Add audit logging for all credential rotation events in `src/routes/admin/apiCredentials.ts` - log add, deprecate, revoke with before/after status, admin user, timestamp (SOC 2 compliance).

- [ ] T043 Add audit logging for all retention policy changes in `src/routes/admin/retention.ts` - log global and per-client retention changes with before/after values.

- [ ] T044 [P] Add input validation middleware for tag normalization in `src/routes/admin/enrichmentPresets.ts` - reject tags with special characters, enforce max 30 chars, trim whitespace.

- [ ] T045 Deploy backend: push to GitHub, let CI/CD build and deploy to ECS.

- [ ] T046 Deploy admin dashboard frontend: `cd admin-dashboard && npm run build && aws s3 sync dist/ s3://slkadmin-developerlabs-ai/ --delete && aws cloudfront create-invalidation --distribution-id E30ZVBVU06GFUV --paths "/*"`

- [ ] T047 Run quickstart.md verification steps against ECS environment.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Schema)**: No dependencies - start immediately
- **Phase 2 (Workspace)**: Depends on Phase 1 (T007 migration applied)
- **Phase 3 (API Key Rotation)**: Depends on Phase 1 (T007). Can run in parallel with Phase 2
- **Phase 4 (Preset Tags)**: Depends on Phase 1 (T007). Can run in parallel with Phases 2-3
- **Phase 5 (Data Retention)**: Depends on Phase 1 (T007). Can run in parallel with Phases 2-4
- **Phase 6 (Licensing)**: Depends on Phase 1 (T007). Can run in parallel with Phases 2-5
- **Phase 7 (Polish)**: Depends on all previous phases complete

### Task Dependency Graph

```
Phase 1 (T001-T007) ──┬──> Phase 2 (T008-T014) ──> Phase 7 (T042-T047)
                       ├──> Phase 3 (T015-T021) ──┘
                       ├──> Phase 4 (T022-T027) ──┘
                       ├──> Phase 5 (T028-T033) ──┘
                       └──> Phase 6 (T034-T041) ──┘
```

### Parallel Opportunities

**Phase 1**: T004, T005, T006 can run in parallel (independent new models)
**Phase 2**: T012 can run in parallel with T008-T011 (frontend types vs backend routes)
**Phase 3**: T019 can run in parallel with T015-T018 (frontend service vs backend)
**Phase 4**: T025 can run in parallel with T022-T024 (frontend service vs backend)
**Phase 5**: T032 can run in parallel with T028-T031 (frontend settings vs backend purge)
**Phase 6**: T034 and T035 can run in parallel (fingerprint vs validator). T040 can run in parallel with T034-T039
**Phase 7**: T042, T043, T044 can run in parallel (different files)

### Implementation Strategy

**Priority-first delivery**:

1. **Sprint 1** (P1): Phase 1 (Schema) + Phase 2 (Workspace) + Phase 3 (API Key Rotation)
   - Schema migration first, then workspace and rotation in parallel
   - Deploy after Sprint 1 for P1 validation

2. **Sprint 2** (P2): Phase 4 (Preset Tags) + Phase 5 (Data Retention)
   - Both can run in parallel
   - Deploy after Sprint 2 for P2 validation

3. **Sprint 3** (P3): Phase 6 (Licensing) + Phase 7 (Polish)
   - Licensing is self-contained
   - Polish applies to all phases
   - Final deploy with full verification
