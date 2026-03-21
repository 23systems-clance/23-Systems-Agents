# Quickstart: Canonical Data Schema & CRM Adapter Pattern

**Feature**: 18-canonical-data-schema | **Date**: 2026-03-12

## Prerequisites

- Branch `18-canonical-data-schema` checked out
- AWS credentials configured (ECS deployment)
- Prisma schema access (`prisma/schema.prisma`)
- Admin dashboard dev environment (`admin-dashboard/`)

## Implementation Order

### Step 1: Prisma Schema (Database Layer)

Add new models to `prisma/schema.prisma`:

1. Add enums: `CrmType`, `CrmConnectionStatus`, `CrmPushStatus`, `SyncDirection`
2. Add models: `CanonicalContact`, `CanonicalAccount`, `CrmConnection`, `CrmFieldMapping`, `CrmPushRecord`
3. Add relations to existing `HubSpotConnection` and `ManagedClient`
4. Generate migration: `npx prisma migrate dev --name add-canonical-schema`

**Verify**: `npx prisma generate` succeeds, new tables appear in schema.

### Step 2: Canonical Layer (src/services/canonical/)

1. `types.ts` — TypeScript interfaces for canonical contact/account
2. `canonicalMapper.ts` — Convert `JobCompany`/`JobContact` rows to canonical format
3. `canonicalService.ts` — Upsert canonical records (by email/domain)

**Verify**: Unit-testable with mock JobContact/JobCompany data.

### Step 3: CRM Adapter Interface (src/services/crm/)

1. `types.ts` — `CrmAdapter` abstract class, `CrmUpsertResult`, `CrmAdapterError`, `CrmPropertyInfo`
2. `crmAdapterRegistry.ts` — Singleton registry: `registerAdapter()`, `getAdapter(crmType)`

**Verify**: Registry accepts and returns adapter instances by CrmType.

### Step 4: HubSpot Adapter (src/services/crm/adapters/hubspot/)

1. `hubspotAdapter.ts` — Implements `CrmAdapter` using existing `hubspotClient.ts`, `identityResolver.ts`
2. `hubspotFieldMap.ts` — Default canonical → HubSpot property mappings (from existing `COLUMN_ALIAS_MAP`)
3. Register adapter in `crmAdapterRegistry.ts`

**Verify**: `hubspotAdapter.upsertContacts()` produces same results as existing `syncContactsToHubSpot()`.

### Step 5: CRM Import Service (src/services/crm/)

1. `crmImportService.ts` — Orchestrator: canonical conversion → adapter lookup → upsert → push record tracking
2. Modify `hubspotImportWorker.ts` to call `crmImportService.executeImport()`
3. Modify `hubspotImport.ts` (listener) to create `CrmConnection`-based import

**Verify**: End-to-end: enrich list → trigger HubSpot import → contacts appear in HubSpot.

### Step 6: API Routes (src/routes/crm/)

1. `connections.ts` — CRUD for CRM connections
2. `fieldMappings.ts` — CRUD for field mappings + auto-detect endpoint
3. `import.ts` — Trigger CRM import endpoint
4. Register routes in `src/server.ts`

**Verify**: `curl` or Postman against deployed API.

### Step 7: Admin Dashboard UI (admin-dashboard/)

1. `services/crm.ts` — API client for CRM routes
2. `pages/crm-connections.tsx` — CRM connection list page
3. `components/crm/FieldMappingTable.tsx` — Apollo-style two-column mapping table
4. `components/crm/FieldMappingModal.tsx` — Add field mapping modal
5. `components/crm/DataWritingRules.tsx` — Overwrite toggle per field
6. `components/crm/CrmConnectionCard.tsx` — Connection status card

**Verify**: Admin can view connections, edit field mappings, trigger import.

### Step 8: Migration Path

1. Create `CrmConnection` records for existing `HubSpotConnection` entries
2. Auto-populate `CrmFieldMapping` rows from existing `COLUMN_ALIAS_MAP`
3. Verify zero functional regression: same enrichment → HubSpot import flow works

## Key Files Reference

| Purpose | Path |
|---------|------|
| Prisma schema | `prisma/schema.prisma` |
| Canonical types | `src/services/canonical/types.ts` |
| Canonical mapper | `src/services/canonical/canonicalMapper.ts` |
| CRM adapter interface | `src/services/crm/types.ts` |
| Adapter registry | `src/services/crm/crmAdapterRegistry.ts` |
| HubSpot adapter | `src/services/crm/adapters/hubspot/hubspotAdapter.ts` |
| Import orchestrator | `src/services/crm/crmImportService.ts` |
| API routes | `src/routes/crm/connections.ts`, `fieldMappings.ts`, `import.ts` |
| Admin dashboard page | `admin-dashboard/src/pages/crm-connections.tsx` |
| Field mapping UI | `admin-dashboard/src/components/crm/FieldMappingTable.tsx` |

## Deployment

1. Push to GitHub → CI/CD builds Docker, pushes ECR, redeploys ECS
2. After admin dashboard changes: `cd admin-dashboard && npm run build && aws s3 sync dist/ s3://slkadmin-developerlabs-ai/ --delete && aws cloudfront create-invalidation --distribution-id E30ZVBVU06GFUV --paths "/*"`
