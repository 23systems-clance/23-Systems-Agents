# Implementation Plan: BDR Manager Agent

**Branch**: `6-bdr-manager-agent` | **Date**: 2026-03-07 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/6-bdr-manager-agent/spec.md`

## Summary

Add a BDR Manager/Assistant Agent to the existing Slack List Processor that manages multi-step outreach campaigns across Email (Instantly.ai), Phone (HubSpot dialer), and LinkedIn (HeyReach). The system sends daily Slack DMs to BDRs with campaign tasks, provides a web UI for task execution (UniBox + call lists), handles webhook-driven sequence progression, and generates end-of-day reports. Campaigns are the central entity and can be created via API POST from external applications or manually through the admin dashboard UI.

## Technical Context

**Language/Version**: TypeScript 5.9.3 (target: ES2022, module: NodeNext)
**Primary Dependencies**: @slack/bolt 4.6.0 (Socket Mode), Express 5.2.1, BullMQ 5.70.1, Prisma 7.4.2
**Storage**: PostgreSQL via Prisma (AWS RDS) + Redis via ioredis (AWS ElastiCache) + AWS S3
**Testing**: Manual via deployed ECS (no local test runner — AWS-only deployment model)
**Target Platform**: AWS ECS Fargate (Docker container, single Socket Mode connection)
**Project Type**: Single project (Node.js server + React admin dashboard)
**Performance Goals**: <5min campaign activation (SC-001), <60s automated step firing (SC-002), <10s webhook advancement (SC-003), <3s UI load (SC-005)
**Constraints**: 512 CPU / 1024 MB ECS task, single Socket Mode connection
**Scale/Scope**: 50 concurrent campaigns with 1,000 contacts each (SC-009)

**Key Existing Patterns**:
- Multi-tenant via `slackTeamId` on all models
- BullMQ job queues with dispatcher routing pattern
- API key authentication for external API routes
- Admin dashboard (React/Vite) at `admin-dashboard/`
- Webhook handling with deduplication and async processing
- Circuit breaker + rate limiter patterns for external API calls

**External API Integrations**:
- **HubSpot API**: Contact import from lists, phone fallback logic, contact record links for dialer
- **Instantly.ai API**: Email campaign management, send emails, receive webhooks (email_sent, reply_received, email_bounced), UniBox reply retrieval, reply-to-email
- **HeyReach API**: LinkedIn campaign management, send connection requests/messages, receive webhooks (CONNECTION_REQUEST_SENT, MESSAGE_SENT, MESSAGE_REPLY_RECEIVED), conversation retrieval

## Constitution Check

| Principle | Status | Notes |
|-----------|--------|-------|
| I. CRM-First Architecture | N/A | Standalone service, not part of BDR CRM platform |
| II. Plugin Ecosystem | N/A | Standalone Slack service |
| III. API-First Development | PASS | Full REST API for campaign CRUD; webhook-driven integration |
| IV. Client Isolation (Multi-Tenancy) | PASS | All models scoped by slackTeamId/clientId; BDRs see only their workspace data |
| V. SOC 2 Compliance & Audit Logging | PASS | WebhookEvent audit table; all API calls logged; activity tracking |
| VI. Cost Tracking & Financial Model | PASS | DailyBdrActivity tracks all channel activity per BDR per campaign |
| VII. Deviation Prevention | PASS | Plan checked against constitution |
| VIII. Integration-Centric Design | PASS | HubSpot, Instantly, HeyReach integrations with circuit breakers |
| IX. Sequence-Driven Workflows | PASS | Core feature — linear sequence engine with Email/Phone/LinkedIn steps |
| X. Enrichment as Foundation | N/A | Consumes pre-enriched HubSpot lists, does not perform enrichment |
| XI. Context-First Decision Making | PASS | Spec clarifications resolved; research complete |
| XII. Holistic System Awareness | PASS | Integrates with existing queues, state store, admin dashboard |
| XIII. Confirmation-Required Workflow | PASS | Campaign requires activation step before sequences begin |
| XIV. UI/UX First Design | PASS | UniBox, call lists, daily DMs — BDR-centric workflow |
| XV. AWS-Only Infrastructure | PASS | Deploys via existing ECS Fargate |
| XVI. Developer Navigation Index | PASS | Web UI routes documented in admin dashboard router |
| XVII. MCP-First Research | PASS | HubSpot, Instantly, HeyReach APIs researched |

**Gate Result: PASS**

## Project Structure

### Documentation (this feature)

```text
specs/6-bdr-manager-agent/
├── plan.md              # This file
├── spec.md              # Feature specification with 8 user stories
└── tasks.md             # Task breakdown (/speckit.tasks)
```

### Source Code (repository root)

```text
src/
├── services/
│   ├── campaign/                     # NEW: Campaign management core
│   │   ├── campaignService.ts        # CRUD, validation, lifecycle management
│   │   ├── contactImport.ts          # HubSpot list import with capability flags
│   │   ├── sequenceEngine.ts         # State machine for step progression
│   │   ├── activityTracker.ts        # DailyBdrActivity counter updates
│   │   ├── statsAggregator.ts        # Campaign metrics and funnel aggregation
│   │   ├── unibox.ts                 # Unified inbox for email + LinkedIn replies
│   │   ├── dailyDm.ts               # Morning Slack DM briefings
│   │   ├── eodReport.ts             # End-of-day report generation
│   │   ├── stuckStepDetector.ts      # Flag contacts stuck waiting for webhooks
│   │   ├── validators.ts             # LinkedIn URL validation
│   │   ├── types.ts                  # TypeScript interfaces for campaign operations
│   │   └── executors/                # Channel-specific step executors
│   │       ├── emailExecutor.ts      # Instantly.ai email firing
│   │       ├── linkedinExecutor.ts   # HeyReach LinkedIn action firing
│   │       └── callExecutor.ts       # Phone task creation (manual)
│   ├── hubspot/                      # NEW: HubSpot API client
│   │   └── hubspotClient.ts          # Contact list import, rate limiting, circuit breaker
│   ├── instantly/                    # NEW: Instantly.ai API client
│   │   └── instantlyClient.ts        # Email campaigns, replies, reply-to-email
│   └── heyreach/                     # NEW: HeyReach API client
│       └── heyreachClient.ts         # LinkedIn campaigns, conversations, stats
├── routes/
│   ├── campaigns.ts                  # NEW: Campaign REST API (POST/GET/PATCH)
│   ├── bdr/                          # NEW: BDR task UI API
│   │   ├── index.ts                  # Router with bdrAuth middleware
│   │   ├── tasks.ts                  # GET /tasks - task counts per campaign
│   │   ├── calls.ts                  # GET/POST /calls - call list + mark complete
│   │   ├── unibox.ts                 # GET/POST/PATCH /unibox - unified inbox
│   │   └── stats.ts                  # GET /stats + POST /stats/eod-notes
│   ├── admin/
│   │   ├── campaigns.ts              # NEW: Admin campaign dashboard API
│   │   ├── bdrManagement.ts          # NEW: BDR CRUD admin API
│   │   ├── clientManagement.ts       # NEW: Client management admin API
│   │   └── enrichmentPresets.ts      # NEW: Enrichment preset management
│   └── webhooks/
│       ├── instantly.ts              # NEW: Instantly.ai webhook handler
│       └── heyreach.ts              # NEW: HeyReach webhook handler
├── lib/
│   ├── bdrAuth.ts                    # NEW: BDR magic link authentication
│   └── tokenEncryption.ts           # NEW: Client API key encryption
├── config/
│   └── index.ts                      # MODIFIED: Add bdrManager, HubSpot, Instantly, HeyReach config
└── server.ts                         # MODIFIED: Mount campaign, BDR, webhook routes

admin-dashboard/src/
├── pages/
│   ├── campaigns.tsx                 # NEW: Campaign list view
│   ├── campaign-detail.tsx           # NEW: Campaign detail/metrics view
│   ├── bdr-activity.tsx              # NEW: BDR activity summary
│   ├── managed-bdrs.tsx              # NEW: BDR management page
│   ├── managed-clients.tsx           # NEW: Client management page
│   ├── enrichment.tsx                # NEW: Enrichment preset management
│   └── bdr/                          # NEW: BDR task UI pages
│       ├── tasks.tsx                 # Task overview
│       ├── calls.tsx                 # Call list per campaign
│       ├── unibox.tsx                # Unified inbox
│       └── stats.tsx                 # Daily stats + EOD report
├── services/
│   ├── campaigns.ts                  # NEW: Campaign API client
│   ├── bdrs.ts                       # NEW: BDR API client
│   ├── managed-clients.ts            # NEW: Client API client
│   ├── bdr-calls.ts                  # NEW: BDR calls API client
│   ├── bdr-tasks.ts                  # NEW: BDR tasks API client
│   ├── bdr-unibox.ts                # NEW: BDR unibox API client
│   └── enrichment-presets.ts         # NEW: Enrichment preset API client
└── hooks/
    └── useBdrAuth.ts                 # NEW: BDR auth hook

prisma/
├── schema.prisma                     # MODIFIED: Campaign, Contact, Sequence, BDR, Webhook, UniBox models
└── migrations/
    ├── 20260307142814_bdr_manager_agent/      # Core campaign models
    ├── 20260307144323_add_client_bdr_models/  # Client/BDR management models
    └── 20260307154627_enrichment_presets/      # Enrichment presets
```

## Key Entities

- **Campaign**: Central entity — ICP, sequences, scripts, meeting link, status lifecycle
- **CampaignSequenceStep**: Ordered step (Email/Phone/LinkedIn) within a campaign
- **CampaignContact**: Contact imported from HubSpot with capability flags and sequence position
- **CampaignContactStepExecution**: Per-step execution record with status tracking
- **CampaignBdr**: Junction linking BDRs to campaigns
- **WebhookEvent**: Audit log for all inbound webhooks (deduplication + traceability)
- **UniboxReply**: Email + LinkedIn replies for unified inbox
- **DailyBdrActivity**: Aggregated daily stats per BDR per campaign
- **EodReport**: End-of-day report with automated stats + optional BDR notes
- **ManagedClient**: Business client with encrypted API keys
- **Bdr**: Business Development Representative linked to Slack user
- **EnrichmentPreset**: Apollo search filter presets

## Complexity Tracking

> No constitution violations to justify.
