# Research: Canonical Data Schema & CRM Adapter Pattern

**Feature**: 18-canonical-data-schema | **Date**: 2026-03-12

## R1: CRM Adapter Interface Pattern

**Decision**: TypeScript abstract class with 7 required methods + adapter registry singleton.

**Rationale**: Abstract class (vs pure interface) allows shared base logic (error normalization, logging, rate limit backoff) while enforcing method signatures. The registry pattern (Map<CrmType, CrmAdapter>) enables runtime adapter lookup without hardcoding CRM-specific imports in the import service.

**Alternatives considered**:
- **Pure TS interface**: No shared behavior — each adapter reimplements logging, error normalization. Rejected.
- **Strategy pattern with DI container**: Overkill for 1-3 adapters. Would add InversifyJS dependency. Rejected.
- **Plugin-based dynamic loading**: Aligns with constitution's plugin principle but premature — adapters are internal, not third-party. Deferred.

## R2: Canonical Schema Storage Strategy

**Decision**: Prisma models (`CanonicalContact`, `CanonicalAccount`) stored in PostgreSQL alongside existing enrichment tables. Created on-demand during CRM import trigger.

**Rationale**: Canonical records are a translation layer, not a replacement for `JobCompany`/`JobContact`. Storing them in PG (vs ephemeral/in-memory) enables: audit trail, incremental push tracking, multi-CRM import of the same data, and admin dashboard visibility. On-demand creation avoids touching the enrichment pipeline.

**Alternatives considered**:
- **In-memory conversion (no persistence)**: Fast but no audit trail, no incremental push, no multi-CRM import from same data. Rejected.
- **Replace enrichment tables entirely**: Too risky — would require rewriting the entire enrichment pipeline. Rejected per spec clarification.
- **Materialized view**: Read-only, can't add push tracking columns. Rejected.

## R3: Field Mapping UI Pattern (Apollo-Inspired)

**Decision**: Apollo-style tabbed UI in admin dashboard with 2 tabs relevant to this project: **Fields** (two-column mapping table) and **Data Writing Rules** (overwrite toggle). Opens in web browser via admin dashboard.

**Rationale**: The user provided Apollo's HubSpot integration UI as reference. Analysis of which Apollo tabs apply:

| Apollo Tab | Relevant? | Why |
|------------|-----------|-----|
| **Fields** | YES | Core feature — maps canonical fields to CRM properties. Two-column layout with data types, search, add/delete mapping. |
| **Data Writing Rules** | YES (partial) | "Overwrite" vs "Auto-fill" applies to whether adapter overwrites existing CRM values. Write-only simplification. |
| **Stages** | NO | No lifecycle stage concept in canonical schema. Out of scope. |
| **Sync (Pull)** | NO | Bidirectional sync deferred per spec. Write-only for now. |
| **Sync (Push)** | YES (partial) | Push contacts to CRM — but this is triggered from Slack/enrichment flow, not a standalone sync config page. |

**UI Components**:
- `FieldMappingTable`: Two-column table — left side shows canonical fields (grouped by category: Name, Contact Info, Location, Enrichment Data), right side shows CRM property dropdown (fetched from CRM via adapter.getProperties()). Each row has data type indicator and delete button.
- `FieldMappingModal`: "Add field mapping" modal with searchable canonical field list grouped by category (like Apollo's "Add field to map" modal).
- `DataWritingRules`: Toggle per field group — "Overwrite existing CRM values" or "Only fill empty fields".

**Alternatives considered**:
- **Simple JSON editor**: Too technical for admins. Rejected.
- **Full Apollo clone (all 4 tabs)**: Stages and bidirectional sync are out of scope. Rejected as over-engineering.

## R4: HubSpot Adapter Refactoring Strategy

**Decision**: Extract import/sync logic from existing `hubspotSyncService.ts`, `hubspotPropertyMapping.ts`, and `hubspotImportWorker.ts` into a `HubSpotAdapter` class implementing `CrmAdapter`. Keep non-import services (OAuth, activity, webhooks) in `src/services/hubspot/`.

**Rationale**: Clean separation — the adapter handles only CRM import concerns. OAuth token management stays shared because it's used by activity logging and webhooks too. The import worker and Slack action handler are modified to call `crmImportService` which delegates to the adapter registry.

**Files refactored**:
| Existing File | Change |
|---------------|--------|
| `hubspotSyncService.ts` | Logic moves to `HubSpotAdapter.upsertContacts()`. File deprecated. |
| `hubspotPropertyMapping.ts` | `autoDetectMapping()` becomes default field map in `hubspotFieldMap.ts`. `getContactProperties()` and `ensureEnrichmentProperties()` move to adapter methods. |
| `hubspotImport.ts` | Import job lifecycle moves to `crmImportService.ts`. |
| `hubspotClient.ts` | Stays — reused by adapter internally. |
| `hubspotImportWorker.ts` | Modified to call `crmImportService.executeImport()`. |
| `hubspotImport.ts` (listener) | Modified to create `CrmConnection`-based import. |

**Alternatives considered**:
- **Keep HubSpot code, add adapter as wrapper**: Thin wrapper adds indirection without removing duplication. Rejected.
- **Rewrite from scratch**: Risky — existing code is battle-tested. Better to extract and refactor. Rejected.

## R5: Incremental Push Tracking

**Decision**: `CrmPushRecord` join table linking canonical records to CRM connections with push status and timestamps.

**Rationale**: Without push tracking, every import re-pushes all records (wasteful HubSpot API calls, rate limit risk). The `CrmPushRecord` tracks `lastPushedAt` per canonical record per CRM connection. During import, only records where `canonicalRecord.updatedAt > pushRecord.lastPushedAt` (or no push record exists) are sent.

**Schema**: `CrmPushRecord` has composite unique on (canonicalContactId, crmConnectionId) for contacts and (canonicalAccountId, crmConnectionId) for accounts.

**Alternatives considered**:
- **Timestamp on canonical record**: Only tracks one CRM. Multi-CRM requires per-connection tracking. Rejected.
- **Job-level tracking only**: Can't handle partial re-enrichments or individual record updates. Rejected.

## R6: HubSpot Batch API Rate Limiting

**Decision**: 100 contacts per batch API call, exponential backoff starting at 1s on 429 responses, max 5 retries.

**Rationale**: HubSpot batch endpoints accept max 100 records per call. Rate limit is 100 requests per 10 seconds for batch API. Exponential backoff (1s, 2s, 4s, 8s, 16s) with jitter handles burst scenarios without manual tuning.

**Implementation**: Base delay in adapter config, backoff logic in abstract `CrmAdapter` base class (shared across all future adapters).

## R7: CrmConnection Model vs Existing HubSpotConnection

**Decision**: Create new `CrmConnection` model. Migrate existing `HubSpotConnection` data to it. Keep `HubSpotConnection` as a relation for HubSpot-specific OAuth fields.

**Rationale**: `CrmConnection` is the CRM-agnostic parent (crmType, status, clientId). `HubSpotConnection` keeps OAuth tokens and portal info that are HubSpot-specific. The adapter reads `CrmConnection` to determine type, then loads HubSpot-specific config from the related `HubSpotConnection`. Future Attio adapter would have an `AttioConnection` relation instead.

**Schema relationship**: `CrmConnection` 1:1 `HubSpotConnection` (for HubSpot type). `CrmConnection` 1:many `CrmFieldMapping`. `CrmConnection` 1:many `CrmPushRecord`.

**Alternatives considered**:
- **Replace HubSpotConnection entirely**: Would break existing OAuth flow, webhook handling, activity logging. Too risky. Rejected.
- **JSONB adapterConfig field only**: Loses type safety and queryability for HubSpot-specific fields. Rejected.
