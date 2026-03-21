# Implementation Plan: Canonical Data Schema & CRM Adapter Pattern

**Branch**: `18-canonical-data-schema` | **Date**: 2026-03-12 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/18-canonical-data-schema/spec.md`

## Summary

Introduce a CRM-agnostic canonical data model as an intermediate layer between enrichment output and CRM push. Define a `CrmAdapter` interface (7 methods), implement a HubSpot adapter by refactoring existing `src/services/hubspot/` code, and build an Apollo-style field mapping UI in the admin dashboard. The canonical layer creates `CanonicalContact` and `CanonicalAccount` records on-demand during CRM import, with per-record push tracking (`CrmPushRecord`) for incremental syncs. The existing spec 14 HubSpot import flow is replaced entirely by the new adapter — no parallel code paths.

## Technical Context

**Language/Version**: TypeScript 5.x (Node.js 20+)
**Primary Dependencies**: @slack/bolt 4.6.0 (Socket Mode), Express 4.x, @hubspot/api-client, Prisma 5.x, BullMQ, React 18 + Vite (admin dashboard)
**Storage**: PostgreSQL via Prisma ORM (AWS RDS), Redis (AWS ElastiCache) for caching & BullMQ
**Testing**: Manual testing against deployed AWS ECS service (no local dev server)
**Target Platform**: AWS ECS Fargate (backend), CloudFront + S3 (admin dashboard SPA)
**Project Type**: Web application (backend + separate frontend)
**Performance Goals**: 100 contacts/batch for CRM push, exponential backoff on 429s, <5s for canonical conversion of 1000 records
**Constraints**: Single Socket Mode connection (ECS only), 5000 row max per enrichment job, HubSpot rate limits (100 req/10s for batch endpoints)
**Scale/Scope**: ~10 clients, up to 5000 contacts per job, 1 CRM adapter (HubSpot) with interface for future adapters

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

| Principle | Status | Notes |
|-----------|--------|-------|
| I. CRM-First Architecture | PASS | This feature IS the CRM abstraction layer |
| II. Plugin Ecosystem | PASS | CRM adapters follow plugin-like registration pattern |
| III. API-First Development | PASS | API contracts defined before UI (contracts/ dir) |
| IV. Client Isolation | PASS | Field mappings scoped per CRM connection per client |
| V. SOC 2 / Audit Logging | PASS | CrmPushRecord + HubSpotSyncLog provide audit trail |
| VI. Cost Tracking | PASS | Existing HubSpot API cost tracking unchanged |
| VIII. Integration-Centric | PASS | Adapter pattern orchestrates external CRM APIs |
| X. Enrichment as Foundation | PASS | Canonical layer sits alongside enrichment tables |
| XIV. UI/UX First Design | PASS | Apollo-style field mapping UI reference provided |
| XV. AWS-Only Infrastructure | PASS | No local dev; ECS + CloudFront only |

**No violations. Gate passed.**

## Project Structure

### Documentation (this feature)

```text
specs/18-canonical-data-schema/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   └── crm-adapter-api.yaml
└── tasks.md             # Phase 2 output (/speckit.tasks)
```

### Source Code (repository root)

```text
# Backend (ECS Fargate)
src/
├── services/
│   ├── canonical/                    # NEW — canonical data layer
│   │   ├── types.ts                  # CanonicalContact, CanonicalAccount interfaces
│   │   ├── canonicalMapper.ts        # JobCompany/JobContact → canonical conversion
│   │   └── canonicalService.ts       # CRUD + upsert logic
│   ├── crm/                          # NEW — CRM adapter layer
│   │   ├── types.ts                  # CrmAdapter interface, CrmError, CrmUpsertResult
│   │   ├── crmAdapterRegistry.ts     # Adapter registration + lookup
│   │   ├── crmImportService.ts       # Orchestrator (canonical → adapter → CRM)
│   │   └── adapters/
│   │       └── hubspot/              # HubSpot adapter (refactored from src/services/hubspot/)
│   │           ├── hubspotAdapter.ts  # CrmAdapter implementation
│   │           └── hubspotFieldMap.ts # Default field mapping definitions
│   └── hubspot/                      # EXISTING — keeps OAuth, webhooks, activity (non-import)
│       ├── hubspotOAuth.ts           # Unchanged
│       ├── hubspotClient.ts          # Reused by adapter
│       ├── hubspotActivity.ts        # Unchanged
│       ├── hubspotWebhook.ts         # Unchanged
│       ├── identityResolver.ts       # Reused by adapter
│       ├── domainNormalizer.ts       # Unchanged
│       ├── nameNormalizer.ts         # Unchanged
│       └── fuzzyMatcher.ts           # Unchanged
├── routes/
│   ├── hubspot/oauth.ts              # Unchanged
│   └── crm/                          # NEW — CRM management API routes
│       ├── connections.ts            # CRUD CRM connections
│       ├── fieldMappings.ts          # CRUD field mappings
│       └── import.ts                 # Trigger CRM import
├── listeners/
│   ├── actions/hubspotImport.ts      # MODIFIED — calls crmImportService instead of direct HubSpot
│   └── commands/hubspot.ts           # MODIFIED — connect flow creates CrmConnection
└── services/queue/workers/
    └── hubspotImportWorker.ts        # MODIFIED — delegates to crmImportService

# Admin Dashboard (CloudFront + S3)
admin-dashboard/src/
├── pages/
│   └── crm-connections.tsx           # NEW — CRM connection list + field mapping UI
├── components/
│   └── crm/                          # NEW — Apollo-style field mapping components
│       ├── FieldMappingTable.tsx      # Two-column mapping table (canonical ↔ CRM)
│       ├── FieldMappingModal.tsx      # Add/edit field mapping modal
│       ├── DataWritingRules.tsx       # Overwrite vs auto-fill toggle per field
│       └── CrmConnectionCard.tsx     # Connection status + quick actions
└── services/
    └── crm.ts                        # NEW — API client for CRM routes
```

**Structure Decision**: Web application pattern — backend (ECS) + frontend (CloudFront SPA). New code lives in `src/services/canonical/` and `src/services/crm/` with adapter subdirectories. Existing HubSpot services stay in `src/services/hubspot/` for non-import concerns (OAuth, activity, webhooks). Admin dashboard gets a new CRM connections page.

## Complexity Tracking

> No constitution violations. No entries needed.
