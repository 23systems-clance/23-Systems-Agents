# Implementation Plan: Slack List Processor

**Branch**: `1-slack-list-processor` | **Date**: 2026-03-04 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/1-slack-list-processor/spec.md`

## Summary

Build a Slack bot backend that detects CSV/XLSX file uploads, uses an AI orchestrator (Claude 3.5 Haiku) to classify user intent from "ENRICH" trigger messages, and processes company lists through BuiltWith (technographic enrichment, cloud provider extraction, tech spend tier classification) and Apollo.io (decision maker lookup with persona classification, phone webhook handling). Results are delivered as files back to Slack threads. Technology reports are generated via natural language queries against the BuiltWith Lists API with result caching. All jobs are permanently stored with full API usage logging.

## Technical Context

**Language/Version**: TypeScript 5.x (strict mode, ES2022 target)
**Primary Dependencies**: @slack/bolt ^4.6.0, bullmq ^5.70.1, @anthropic-ai/sdk ^0.78.0, xlsx (SheetJS), csv-parse ^5.5.x, ioredis, @prisma/client, express (HTTP server for REST API + webhooks), @aws-sdk/client-s3 + @aws-sdk/s3-request-presigner (persistent file storage)
**Storage**: PostgreSQL (via Prisma ORM) + Redis (BullMQ job queue + conversation state) + S3-compatible object storage (source/result file persistence per FR-020)
**Testing**: Vitest
**Target Platform**: Node.js 18+ backend service (ECS Fargate or EC2)
**Project Type**: Single project (backend service, no frontend)
**Performance Goals**: Acknowledge Slack requests within 3 seconds; process 100-company lists within 5 minutes; support 10 concurrent jobs without degradation
**Constraints**: 5,000 row hard max per file; 1,000 row default processing limit; Socket Mode (10 concurrent WebSocket connections); no mobile phone numbers in output; REST API endpoints authenticated via API key in `X-API-Key` header
**Scale/Scope**: Single Slack workspace, moderate volume (est. 50-100 jobs/day), permanent job history storage

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

| Principle | Status | Notes |
|-----------|--------|-------|
| I. CRM-First | DEVIATION | Standalone Slack bot, not part of CRM web app. Justified: this is a separate service that enriches data for import into CRM later. Data model aligns with CRM entities (Company, Contact, Persona). |
| II. Plugin Ecosystem | DEVIATION | Not built as a plugin within the BDR Management Platform. Justified: standalone service that operates independently via Slack. Can be integrated as a plugin later if the platform grows. |
| III. API-First | PASS | REST API contracts defined with X-API-Key authentication. Internal API for job management. Slack is the primary UI consumer. |
| IV. Client Isolation | PASS | Jobs scoped by `slack_team_id`. Single-workspace deployment initially; multi-tenant via team ID. |
| V. SOC 2 / Audit Logging | PASS | All API usage logged per job (FR-019). Job history permanent (FR-016). Structured logging. |
| VI. Cost Tracking | PASS | `ApiUsageLog` entity tracks BuiltWith credits, Apollo credits, AI tokens per job. |
| VII. Deviation Prevention | PASS | Constitution check performed. Deviations documented. |
| VIII. Integration-Centric | PASS | Orchestrates BuiltWith + Apollo.io + Claude API. Does not replace them. |
| IX. Sequence-Driven | N/A | Not applicable to this feature (no campaign sequences). |
| X. Enrichment as Foundation | PASS | Core purpose is bulk enrichment with tech spend classification and persona classification. Persona types extended from constitution's 10 to 14 for finer-grained sales targeting. is_decision_maker flag included on JobContact. |
| XI. Context-First | PASS | Research completed. All unknowns resolved. |
| XII. Holistic Awareness | PASS | Data model designed to be compatible with future CRM import. |
| XIII. Confirmation-Required | PASS | Slack prompts for purpose, co-sell status, cache decisions before processing. |
| XIV. UI/UX First | PASS | Block Kit interactive messages for all user interactions. Threaded conversations. |
| XV. Dev Nav Index | N/A | No web UI; Slack is the interface. |
| XVI. MCP Research | PASS | Research completed via agents for all technology decisions. |

## Project Structure

### Documentation (this feature)

```text
specs/1-slack-list-processor/
├── plan.md              # This file
├── research.md          # Phase 0 output - technology decisions
├── data-model.md        # Phase 1 output - database schema
├── quickstart.md        # Phase 1 output - setup guide
├── contracts/
│   └── api-contracts.md # Phase 1 output - API & event contracts
└── tasks.md             # Phase 2 output (/speckit.tasks command)
```

### Source Code (repository root)

```text
src/
├── app.ts                          # Bolt app + Express HTTP server startup
├── server.ts                       # Express HTTP server factory (REST API + webhooks)
├── config/
│   └── index.ts                    # Environment config loader
├── listeners/
│   ├── events/
│   │   ├── fileShared.ts           # file_shared event handler
│   │   └── message.ts              # ENRICH message detection
│   └── actions/
│       ├── purposeSelection.ts     # Cold Calling/Emailing/etc buttons
│       ├── cosellCheck.ts          # Co-sell Yes/No buttons
│       ├── cloudProvider.ts        # Cloud provider selection
│       ├── reportFilters.ts        # Tech report filter inputs
│       └── cacheDecision.ts        # Use cached / fresh query
├── services/
│   ├── ai/
│   │   ├── orchestrator.ts         # Intent classification (Claude Haiku)
│   │   └── personaClassifier.ts    # Job title -> persona type (lookup + LLM fallback)
│   ├── builtwith/
│   │   ├── client.ts               # BuiltWith API client
│   │   ├── domainEnricher.ts       # Domain technographic enrichment
│   │   ├── listsClient.ts          # Technology reports (Lists API)
│   │   ├── companyResolver.ts      # Company name -> domain (CTU API)
│   │   ├── cloudExtractor.ts       # Cloud provider extraction from tech data
│   │   └── techSpendScorer.ts      # Technology spend tier scoring algorithm
│   ├── apollo/
│   │   ├── client.ts               # Apollo.io API client
│   │   ├── peopleSearch.ts         # Free people search (no credits)
│   │   ├── peopleEnrich.ts         # People enrichment (credits)
│   │   └── bulkEnrich.ts           # Bulk enrichment (10 per request)
│   ├── file/
│   │   ├── parser.ts               # CSV/XLSX file parsing
│   │   ├── generator.ts            # Result file generation (CSV/XLSX)
│   │   └── slackFile.ts            # Slack file download/upload
│   ├── queue/
│   │   ├── queues.ts               # BullMQ queue definitions
│   │   └── workers/
│   │       ├── technographic.ts    # Technographic enrichment worker
│   │       ├── contact.ts          # Contact enrichment worker
│   │       ├── combined.ts         # Combined enrichment worker
│   │       ├── techReport.ts       # Tech report generation worker
│   │       └── fileGeneration.ts   # Result file generation + Slack upload
│   └── state/
│       └── conversationStore.ts    # Redis-backed conversation state (TTL 1hr)
├── routes/
│   ├── health.ts                   # GET /api/v1/health
│   ├── jobs.ts                     # GET /api/v1/jobs, GET /api/v1/jobs/:id
│   └── webhooks/
│       └── apollo.ts               # POST /api/webhooks/apollo/phone-results
├── models/
│   └── index.ts                    # Prisma client export + type re-exports
├── lib/
│   ├── redis.ts                    # IORedis connection
│   ├── logger.ts                   # Structured JSON logging
│   ├── errors.ts                   # Custom error classes
│   └── storage.ts                  # S3-compatible object storage client
└── data/
    ├── personaLookup.ts            # ~200 title -> persona type mapping
    ├── enterpriseTechs.ts          # Enterprise technology set
    ├── freeTechs.ts                # Free technology set
    └── cloudProviderKeywords.ts    # Cloud provider keyword + weight mappings

tests/
├── unit/
│   ├── services/
│   │   ├── techSpendScorer.test.ts
│   │   ├── cloudExtractor.test.ts
│   │   ├── personaClassifier.test.ts
│   │   └── fileParser.test.ts
│   └── data/
│       └── personaLookup.test.ts
├── integration/
│   ├── builtwith.test.ts
│   ├── apollo.test.ts
│   └── queue.test.ts
└── contract/
    └── webhookApollo.test.ts

prisma/
├── schema.prisma
└── migrations/
```

**Structure Decision**: Single project (Option 1). This is a backend-only service with no frontend. Slack serves as the UI via Block Kit. The service runs as a single Node.js process handling both the Bolt app (event listeners) and BullMQ workers. Separation into microservices is not needed at this scale.

## Complexity Tracking

| Deviation | Why Needed | Simpler Alternative Rejected Because |
|-----------|-----------|--------------------------------------|
| Standalone service (not CRM plugin) | Slack bot operates independently; real-time file processing requires dedicated workers with Socket Mode connection | Building as a plugin requires the BDR Management Platform to be deployed first; this service provides immediate value standalone |
| Redis dependency (BullMQ) | Long-running jobs (1-60 min) need progress tracking, stall detection, retry with backoff | PostgreSQL-based queue lacks progress events, stall detection, and rate limiting; would require 2-4 weeks of custom development |
| Separate Prisma schema | Own database schema not shared with BDR Platform | Shared schema would create coupling; standalone schema allows independent deployment and migration |
