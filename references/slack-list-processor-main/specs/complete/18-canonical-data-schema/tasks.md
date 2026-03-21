# Tasks: Canonical Data Schema & CRM Adapter Pattern

**Input**: Design documents from `/specs/18-canonical-data-schema/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/crm-adapter-api.yaml, quickstart.md

**Tests**: Not explicitly requested. No test tasks generated.

**Organization**: Tasks grouped by user story. US1 and US2 are both P1 and tightly coupled — US2 (adapter interface) is foundational for US1 (end-to-end import). US3 (field mapping UI) is P2 and independent.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story (US1, US2, US3)
- Exact file paths included in all descriptions

---

## Phase 1: Setup (Schema & Migrations)

**Purpose**: Database schema changes and project scaffolding

- [x] T001 Add new enums (CrmType, CrmConnectionStatus, CrmPushStatus, SyncDirection) to `prisma/schema.prisma` per `data-model.md`
- [x] T002 Add CanonicalContact model to `prisma/schema.prisma` with 16 standard fields, unique email constraint, and indexes per `data-model.md`
- [x] T003 Add CanonicalAccount model to `prisma/schema.prisma` with 12 standard fields, unique domain constraint, and relation to CanonicalContact per `data-model.md`
- [x] T004 Add CrmConnection model to `prisma/schema.prisma` with crmType, status, clientId, hubspotConnectionId (optional 1:1), and adapterConfig JSONB per `data-model.md`
- [x] T005 Add CrmFieldMapping model to `prisma/schema.prisma` with canonicalField, crmProperty, dataType, transformRule, overwriteExisting, syncDirection per `data-model.md`
- [x] T006 Add CrmPushRecord model to `prisma/schema.prisma` with canonicalContactId/canonicalAccountId, crmConnectionId, pushStatus, lastPushedAt, crmRecordId per `data-model.md`
- [x] T007 Add relations to existing models: `crmConnection` on HubSpotConnection, `crmConnections` on ManagedClient in `prisma/schema.prisma`
- [x] T008 Generate Prisma migration for all new models: run `npx prisma migrate dev --name add-canonical-crm-schema`
- [x] T009 Create directory structure: `src/services/canonical/`, `src/services/crm/`, `src/services/crm/adapters/hubspot/`, `src/routes/crm/`

**Checkpoint**: Database schema ready, Prisma client regenerated, directory structure in place.

---

## Phase 2: Foundational (Canonical Layer + Adapter Interface)

**Purpose**: Core infrastructure that MUST be complete before user story implementation

**CRITICAL**: No user story work can begin until this phase is complete

- [x] T010 [P] Define canonical TypeScript interfaces (CanonicalContact, CanonicalAccount) in `src/services/canonical/types.ts` matching the 16 contact fields and 12 account fields from `data-model.md`
- [x] T011 [P] Define CrmAdapter abstract class, CrmUpsertResult, CrmAdapterError, CrmPropertyInfo interfaces in `src/services/crm/types.ts` per `data-model.md` TypeScript Interfaces section — include abstract methods: connect(), disconnect(), getConnectionStatus(), upsertContacts(), createList(), addContactsToList(), getProperties(), ensureCustomProperties() — include shared withRetry() and normalizeError() base methods
- [x] T012 Implement canonical mapper service in `src/services/canonical/canonicalMapper.ts` — convert JobCompany rows to CanonicalAccount and JobContact rows to CanonicalContact, pulling enrichment metadata (source, date, techSpendTier, jobId) from the parent Job record
- [x] T013 Implement canonical CRUD service in `src/services/canonical/canonicalService.ts` — upsertContacts (by email), upsertAccounts (by domain), getContactsByJobId, getAccountsByJobId, using Prisma client
- [x] T014 Implement CRM adapter registry singleton in `src/services/crm/crmAdapterRegistry.ts` — registerAdapter(crmType, adapter), getAdapter(crmType), listRegisteredAdapters() — use Map<CrmType, CrmAdapter>

**Checkpoint**: Canonical types, mapper, CRUD service, adapter interface, and registry are ready. User story implementation can begin.

---

## Phase 3: User Story 2 — CRM Adapter Interface (Priority: P1)

**Goal**: Standardized CRM adapter interface so adding a new CRM requires only implementing the adapter, not modifying core import logic.

**Independent Test**: Verify the HubSpot adapter implements all 7 interface methods. Verify the import service calls only adapter methods with no HubSpot-specific code.

### Implementation for User Story 2

- [x] T015 [P] [US2] Define default HubSpot canonical-to-property mapping dictionary in `src/services/crm/adapters/hubspot/hubspotFieldMap.ts` — migrate the COLUMN_ALIAS_MAP from `src/services/hubspot/hubspotPropertyMapping.ts` into canonical field → HubSpot property format per `data-model.md` Canonical Field Definitions tables
- [x] T016 [US2] Implement HubSpotAdapter class in `src/services/crm/adapters/hubspot/hubspotAdapter.ts` extending CrmAdapter — implement all 7 methods by refactoring logic from existing `src/services/hubspot/hubspotSyncService.ts` (identity resolution + batch create/update), `src/services/hubspot/hubspotPropertyMapping.ts` (getProperties, ensureCustomProperties), and `src/services/hubspot/hubspotClient.ts` (API calls) — use 100-contact batch size with exponential backoff on 429 per spec clarifications — support partial success (CrmUpsertResult with succeeded/failed/errors)
- [x] T017 [US2] Register HubSpotAdapter in the adapter registry — add registration call in `src/services/crm/adapters/hubspot/hubspotAdapter.ts` or a dedicated `src/services/crm/registerAdapters.ts` init file that runs at app startup
- [x] T018 [US2] Implement CRM import orchestrator service in `src/services/crm/crmImportService.ts` — executeImport(connectionId, enrichmentJobId, options) that: (1) loads CrmConnection + field mappings from DB, (2) calls canonicalMapper to create/upsert canonical records from job results, (3) looks up adapter from registry by crmType, (4) filters records needing push via CrmPushRecord timestamps, (5) calls adapter.upsertContacts() with mapped fields, (6) updates CrmPushRecord with results — this service MUST NOT import any HubSpot-specific modules directly
- [x] T019 [US2] Add adapter error normalization in HubSpotAdapter — catch HubSpot API errors (401/403/429/500) and normalize to CrmAdapterError format with retryable flag per FR-006

**Checkpoint**: HubSpot adapter fully implements CrmAdapter interface. Import service is CRM-agnostic. Adapter can be swapped without changing import logic.

---

## Phase 4: User Story 1 — CRM-Agnostic Contact Import (Priority: P1)

**Goal**: Enriched contacts stored in canonical format and pushed to HubSpot through the adapter. Same data importable to any future CRM.

**Independent Test**: Enrich a list, trigger CRM import, verify canonical records created AND HubSpot contacts match the canonical data.

**Dependencies**: Requires Phase 3 (US2) completion — the adapter and import service must exist.

### Implementation for User Story 1

- [x] T020 [US1] Create CRM connection API routes in `src/routes/crm/connections.ts` — GET /api/crm/connections (list, optional clientId filter), POST /api/crm/connections (create), GET /api/crm/connections/:id (detail), DELETE /api/crm/connections/:id (disconnect) per `contracts/crm-adapter-api.yaml`
- [x] T021 [US1] Create CRM import API route in `src/routes/crm/import.ts` — POST /api/crm/connections/:connectionId/import (accepts enrichmentJobId, listName, incrementalOnly) that delegates to crmImportService.executeImport() — returns 202 with CrmImportResult, GET /api/crm/connections/:connectionId/import/:importId for status per `contracts/crm-adapter-api.yaml`
- [x] T022 [US1] Register CRM routes in `src/server.ts` — import and mount connection, field mapping, and import route handlers under /api/crm/*
- [x] T023 [US1] Write data migration script to create CrmConnection records for all existing HubSpotConnection entries — script in `src/scripts/migrateToCrmConnections.ts` — for each HubSpotConnection: create CrmConnection with crmType=HUBSPOT, status matching existing status, link hubspotConnectionId
- [x] T024 [US1] Refactor `src/services/queue/workers/hubspotImportWorker.ts` to call `crmImportService.executeImport()` instead of direct HubSpot sync — pass connectionId (looked up from enrichmentJobId's client), use CrmConnection for adapter resolution
- [x] T025 [US1] Refactor `src/listeners/actions/hubspotImport.ts` to create CRM import via crmImportService instead of calling hubspotSyncService directly — look up CrmConnection by clientId + crmType=HUBSPOT
- [x] T026 [US1] Modify HubSpot OAuth callback in `src/routes/hubspot/oauth.ts` to also create a CrmConnection record when a new HubSpotConnection is established — set crmType=HUBSPOT, link hubspotConnectionId
- [x] T027 [US1] Update `src/services/workflow/nodes/hubspotNodeExecutor.ts` sync mode to delegate to crmImportService instead of directly importing hubspotSyncService — maintain backward compatibility with existing workflow configs

**Checkpoint**: End-to-end flow works: enrich list → trigger import → canonical records created → HubSpot adapter pushes contacts → push records tracked. Zero functional regression from spec 14.

---

## Phase 5: User Story 3 — Field Mapping Configuration (Priority: P2)

**Goal**: Administrators can configure field mappings between canonical fields and CRM properties per client via the admin dashboard, using an Apollo-style two-column mapping UI.

**Independent Test**: Configure a custom field mapping (canonical "techSpendTier" → HubSpot "custom_tech_tier"), import contacts, verify the custom field is populated correctly in HubSpot.

**Dependencies**: Requires Phase 4 (US1) completion — CRM connections and import flow must exist.

### Backend Implementation for User Story 3

- [x] T028 [P] [US3] Create field mapping API routes in `src/routes/crm/fieldMappings.ts` — GET /api/crm/connections/:connectionId/field-mappings (list + unmappedCanonicalFields), POST (create single), PUT (bulk update/replace all), PATCH /:mappingId (update single), DELETE /:mappingId per `contracts/crm-adapter-api.yaml`
- [x] T029 [P] [US3] Create CRM properties endpoint in `src/routes/crm/connections.ts` — GET /api/crm/connections/:connectionId/properties that calls adapter.getProperties() via registry — cache results in Redis (1hr TTL) per existing pattern in `src/services/hubspot/hubspotPropertyMapping.ts`
- [x] T030 [US3] Create auto-detect field mapping endpoint in `src/routes/crm/fieldMappings.ts` — POST /api/crm/connections/:connectionId/auto-map that fetches CRM properties, matches against canonical field names using the adapter's default field map, creates CrmFieldMapping rows for matches, returns count per `contracts/crm-adapter-api.yaml`
- [x] T031 [US3] Auto-populate default field mappings on CRM connection creation — in the POST /api/crm/connections handler (T020), after creating CrmConnection, call auto-detect to seed initial CrmFieldMapping rows using the HubSpot default map from `hubspotFieldMap.ts`

### Admin Dashboard Implementation for User Story 3

- [x] T032 [P] [US3] Create CRM API service in `admin-dashboard/src/services/crm.ts` — functions: listConnections(), getConnection(id), createConnection(), deleteConnection(), listFieldMappings(connId), bulkUpdateFieldMappings(connId, mappings), autoDetectMappings(connId), getCrmProperties(connId), triggerImport(connId, jobId)
- [x] T033 [US3] Create CRM connections page in `admin-dashboard/src/pages/crm-connections.tsx` — list all CRM connections with status badges, client name, CRM type icon, field mapping count, last import date — add "View Mappings" button per connection that opens field mapping view — add navigation entry in sidebar
- [x] T034 [US3] Create CrmConnectionCard component in `admin-dashboard/src/components/crm/CrmConnectionCard.tsx` — displays connection status (Active/Disconnected/Error), CRM type, portal name, mapping count, last sync timestamp — disconnect button with confirmation
- [x] T035 [US3] Create FieldMappingTable component in `admin-dashboard/src/components/crm/FieldMappingTable.tsx` — Apollo-style two-column layout: left column shows canonical fields (with icon + data type label), right column shows CRM property dropdown (populated from adapter.getProperties()) — search/filter bar at top — "Add field mapping" button — delete button per row — pagination (10 per page) — "Save" button that calls bulkUpdateFieldMappings — "Auto-map" button that calls autoDetectMappings endpoint
- [x] T036 [US3] Create FieldMappingModal component in `admin-dashboard/src/components/crm/FieldMappingModal.tsx` — "Add field to map" modal — shows unmapped canonical fields grouped by category (Name, Contact Info, Phone Numbers, Location, Enrichment Data) similar to Apollo's grouped field picker — search within modal — checkboxes to select fields — "Add field" button creates mappings with auto-detected CRM property
- [x] T037 [US3] Create DataWritingRules component in `admin-dashboard/src/components/crm/DataWritingRules.tsx` — shows field groups (Name, Job Title, Phone Numbers, Emails, Location, Links, Company) with "Overwrite" toggle per group — maps to the overwriteExisting field on CrmFieldMapping — "Save" button persists changes

**Checkpoint**: Admin can view CRM connections, configure field mappings via Apollo-style UI, auto-detect mappings, toggle overwrite behavior. Custom mappings are respected during import.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Error handling, logging, migration path, and validation

- [x] T038 [P] Deprecate direct HubSpot sync service — add deprecation comments to `src/services/hubspot/hubspotSyncService.ts` and `src/services/hubspot/hubspotPropertyMapping.ts` noting they are superseded by `src/services/crm/` — remove unused imports from files that were refactored in T024-T027
- [x] T039 [P] Add structured logging to crmImportService in `src/services/crm/crmImportService.ts` — log canonical conversion counts, adapter push results (succeeded/failed), push record updates, and duration — use existing logger pattern from `src/lib/logger.ts`
- [x] T040 [P] Add CRM import audit entries — in `src/services/crm/crmImportService.ts`, create HubSpotSyncLog records (or a new CrmSyncLog) after each import with recordsProcessed/Created/Updated/Failed counts and duration per constitution SOC 2 requirements
- [x] T041 Run end-to-end validation per `quickstart.md` — enrich a test list, trigger CRM import, verify canonical records created, verify HubSpot contacts match, verify push records tracked, verify field mappings respected
- [x] T042 Deploy and verify — push to GitHub (CI/CD deploys backend to ECS), build and deploy admin dashboard to CloudFront (`cd admin-dashboard && npm run build && aws s3 sync dist/ s3://slkadmin-developerlabs-ai/ --delete && aws cloudfront create-invalidation --distribution-id E30ZVBVU06GFUV --paths "/*"`)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies — start immediately
- **Phase 2 (Foundational)**: Depends on Phase 1 — BLOCKS all user stories
- **Phase 3 (US2 - Adapter Interface)**: Depends on Phase 2
- **Phase 4 (US1 - Contact Import)**: Depends on Phase 3 (needs adapter + import service)
- **Phase 5 (US3 - Field Mapping UI)**: Depends on Phase 4 (needs connections + import flow)
- **Phase 6 (Polish)**: Depends on all user stories complete

### User Story Dependencies

```
Phase 1 (Setup)
    │
    ▼
Phase 2 (Foundational)
    │
    ▼
Phase 3 (US2: Adapter Interface) ─── MVP cut line ───
    │
    ▼
Phase 4 (US1: Contact Import)
    │
    ▼
Phase 5 (US3: Field Mapping UI)
    │
    ▼
Phase 6 (Polish)
```

### Within Each Phase — Parallel Opportunities

**Phase 2**: T010 and T011 can run in parallel (different files, no dependencies)
**Phase 3**: T015 can run in parallel with T016 (field map vs adapter class)
**Phase 5**: T028+T029 can run in parallel (different route files). T032 can run in parallel with backend tasks (frontend service layer). T035+T036+T037 are sequential (component dependencies).

---

## Implementation Strategy

### MVP First (US2 Only — Adapter Interface)

1. Complete Phase 1: Schema + migrations
2. Complete Phase 2: Canonical layer + adapter interface
3. Complete Phase 3: HubSpot adapter + import service
4. **STOP and VALIDATE**: Adapter exists, registry works, import service is CRM-agnostic
5. This is the architectural foundation — everything else builds on it

### Incremental Delivery

1. Phase 1+2+3 → Adapter interface ready (internal validation)
2. Phase 4 → End-to-end import works through adapter (functional validation, SC-001 regression test)
3. Phase 5 → Admin dashboard field mapping UI (user-facing feature)
4. Phase 6 → Polish, audit trail, deprecation cleanup
5. Each phase adds value without breaking previous phases
