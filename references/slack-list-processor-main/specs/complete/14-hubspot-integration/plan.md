# Implementation Plan: HubSpot OAuth Integration + Contact Import + Activity Sync + Webhooks

**Branch**: `14-hubspot-integration` | **Date**: 2026-03-10 (updated 2026-03-11) | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/14-hubspot-integration/spec.md`

## Summary

Per-client HubSpot OAuth 2.0 integration via Slack. Clients connect their own HubSpot accounts through a `/hubspot connect` slash command, which initiates an OAuth authorization code flow. Once connected, users can: (1) import enriched contacts into the client's HubSpot CRM using `/hubspot import` or an inline "Import to HubSpot" button, with auto-detected column mapping and static list creation following the `LIST : MMDD [CLIENT] Campaign Name / Target List` naming convention; (2) pull engagement activity (meetings, calls, emails) from HubSpot via `/hubspot activity` with date range presets (Today, Last 7 Days, Custom) and batch Search API queries; (3) automatically push campaign activity (call completions, email sends, meeting bookings) back to HubSpot as engagement records by hooking into existing per-client webhook receivers; and (4) receive real-time webhook notifications for deal stage changes on enriched contacts via app-level subscriptions routed by portal ID.

### Clarification-Driven Updates (2026-03-11)

- **Token encryption**: Reuses existing `tokenEncryption.ts` utility (same as `instantlyApiKey`) — no new crypto module
- **Activity event sources**: Hooks into existing per-client webhook receivers for Instantly/HeyReach/campaign events
- **Webhook subscriptions**: App-level one-time setup; routed by portal ID (no per-client registration)
- **Activity pull UX**: Preset buttons (Today, Last 7 Days, Custom) instead of hardcoded time windows
- **Activity query strategy**: Batch via HubSpot Search API (avoids N+1 per-contact calls)
- **Data model change**: Removed `webhookSubscriptionId` from HubSpotConnection (app-level, not per-client)

## Technical Context

**Language/Version**: TypeScript 5.x (Node.js runtime on ECS Fargate)
**Primary Dependencies**: @slack/bolt v4.6.0 (Socket Mode), Express.js, Prisma ORM, BullMQ, @hubspot/api-client v13.x (new dependency)
**Storage**: PostgreSQL (AWS RDS) via Prisma, Redis (AWS ElastiCache) for BullMQ queues and conversation state, AWS S3 for file storage
**Testing**: Deployed to ECS Fargate; no local testing (single Socket Mode connection constraint)
**Target Platform**: AWS ECS Fargate (Docker container), ALB for HTTP routes
**Project Type**: Single project (backend-only Slack bot + Express API server)
**Performance Goals**: OAuth callback <2s, contact import of 5,000 rows <5 minutes, activity queries <5s, webhook notifications to Slack <30s, activity push <2min after event, HubSpot API batch upsert respecting 110 req/10s rate limit
**Constraints**: One Socket Mode connection (ECS only), HubSpot OAuth tokens expire every 30 minutes (auto-refresh required), batch upsert max 100 contacts per API call, static list membership max 100 per API call
**Scale/Scope**: ~10-50 managed clients, each with independent HubSpot connections, imports up to 5,000 contacts per job

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

| Principle | Status | Notes |
|-----------|--------|-------|
| I. CRM-First Architecture | PASS | HubSpot integration enhances CRM workflow — enriched contacts flow into client's CRM |
| II. Plugin Ecosystem | DEVIATION | **Formally acknowledged deviation.** Constitution's plugin architecture (`src/plugins/`) targets the BDR Management Platform (Next.js). This standalone Slack bot follows existing service-module patterns (`src/services/hubspot/`) consistent with BuiltWith, Apollo, Instantly, and HeyReach integrations. See Complexity Tracking for full justification. |
| III. API-First Development | PASS | OAuth callback and import endpoints are API routes. Contracts defined before implementation. |
| IV. Client Isolation | PASS | Per-client OAuth tokens encrypted and scoped via ManagedClient. FR-009 enforces isolation. |
| V. SOC 2 / Audit Logging | PASS | All HubSpot API calls logged. Import operations tracked in HubSpotImportJob. OAuth events audited. |
| VI. Cost Tracking | PASS | HubSpot API calls are free (no per-call cost), but import job metrics tracked for operational visibility. |
| VII. Deviation Prevention | PASS | Spec reviewed against constitution. Deviations documented. |
| VIII. Integration-Centric Design | PASS | HubSpot is an orchestrated external service with retry, circuit breaker, and rate limit handling. |
| IX. Sequence-Driven Workflows | N/A | This feature is import-focused, not sequence/campaign execution. |
| X. Enrichment as Foundation | PASS | Feature builds ON enrichment output — imports enriched data into client CRM. |
| XV. AWS-Only Infrastructure | PASS | No local execution. OAuth callback routed via existing ALB. All processing on ECS. |
| XIX. GitHub Account Policy | PASS | All operations via `developerlabsai` account. |

## Project Structure

### Documentation (this feature)

```text
specs/14-hubspot-integration/
├── plan.md              # This file
├── research.md          # Phase 0: HubSpot API research & decisions
├── data-model.md        # Phase 1: Prisma models & entity relationships
├── quickstart.md        # Phase 1: Setup & deployment guide
├── contracts/           # Phase 1: API endpoint contracts
│   ├── oauth.md         # OAuth callback & token management
│   ├── import.md        # Contact import & list creation
│   ├── activity.md      # Activity pull/push contracts
│   └── webhooks.md      # Webhook endpoint contract
└── tasks.md             # Phase 2: Implementation tasks (via /speckit.tasks)
```

### Source Code (repository root)

```text
src/
├── config/
│   └── index.ts                          # Add HUBSPOT_CLIENT_ID, HUBSPOT_OAUTH_REDIRECT_URI
├── listeners/
│   ├── commands/
│   │   └── hubspot.ts                    # NEW: /hubspot command handler (connect, disconnect, status, import, activity, sync, help)
│   └── actions/
│       ├── hubspotImport.ts              # NEW: "Import to HubSpot" button handler + mapping modal actions
│       └── hubspotActivity.ts            # NEW: Activity preset button handlers + custom date range modal
├── services/
│   ├── hubspot/
│   │   ├── hubspotClient.ts              # EXISTING: Global API key client (no modifications — OAuth logic in hubspotOAuth.ts)
│   │   ├── hubspotOAuth.ts               # NEW: OAuth flow helpers (generate auth URL, exchange code, refresh token)
│   │   ├── hubspotImport.ts              # NEW: Contact upsert, list creation, property management
│   │   ├── hubspotPropertyMapping.ts     # NEW: Auto-detection logic + property fetching
│   │   ├── hubspotActivity.ts            # NEW: Activity pull (query engagements via Search API) + activity push (create engagements)
│   │   └── hubspotWebhook.ts             # NEW: Webhook event processor (signature validation, deal stage notifications)
│   └── queue/
│       ├── queues.ts                     # MODIFY: Add hubspotImportQueue + hubspotActivitySyncQueue
│       └── workers/
│           ├── hubspotImportWorker.ts    # NEW: Async import job processor
│           ├── hubspotActivityWorker.ts  # NEW: Async activity push processor
│           └── fileGeneration.ts         # MODIFY: Add "Import to HubSpot" button to completion message
├── routes/
│   ├── hubspot/
│   │   └── oauth.ts                      # NEW: /api/hubspot/oauth/callback route
│   └── webhooks/
│       └── hubspot.ts                    # NEW: /api/webhooks/hubspot endpoint (follows existing webhooks/{provider}.ts pattern)
├── lib/
│   └── tokenEncryption.ts               # EXISTING: Used for encrypting OAuth tokens (AES-256-GCM)
└── server.ts                             # MODIFY: Mount hubspot OAuth + webhook routers

prisma/
└── schema.prisma                         # MODIFY: Add HubSpotConnection, HubSpotImportJob, HubSpotContactMapping, HubSpotEngagementMapping, HubSpotSyncLog models
```

**Structure Decision**: Follows existing single-project pattern. HubSpot OAuth, import, and activity services live under `src/services/hubspot/`. New slash command in `src/listeners/commands/hubspot.ts`. OAuth callback and webhook endpoints as Express routes in `src/routes/hubspot/`.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|-----------|--------------------------------------|
| No plugin architecture (Principle II) | This is a Slack bot (Express + @slack/bolt), not a Next.js app. The constitution's plugin system (`src/plugins/`) is designed for the BDR Management Platform, not this standalone service. | HubSpot code is organized modularly under `src/services/hubspot/` following the same pattern as BuiltWith, Apollo, Instantly, and HeyReach integrations in this codebase. Plugin registry overhead is unnecessary for a single-service bot. |
