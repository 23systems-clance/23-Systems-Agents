# Implementation Plan: Multi-Provider Waterfall Enrichment

**Branch**: `27-waterfall-enrichment` | **Date**: 2026-03-14 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/27-waterfall-enrichment/spec.md`

**Note**: This template is filled in by the `/speckit.plan` command. See `.specify/templates/commands/plan.md` for the execution workflow.

## Summary

Implement multi-provider waterfall enrichment for contact email and phone numbers using Apollo, Wiza, and AI Ark with intelligent fallback, async webhook handling, cost tracking, and real-time Slack progress updates. Email waterfall: Apollo → Wiza → AI Ark (synchronous). Phone waterfall: Wiza → AI Ark (asynchronous webhooks). System tracks per-provider costs, skips contacts with existing data, and enforces 2,000 contact limit to prevent excessive API calls. Includes email verification quality gate via Findymail API (US6) — after email enrichment, users choose "Verify Emails" or "Do Not Verify"; verification adds "Email Verified" and "Email Provider" columns to output. Follows same quality gate pattern as DNC scrub for phones.

## Technical Context

**Language/Version**: TypeScript 5.x (Node.js runtime)
**Primary Dependencies**:
- @slack/bolt v4.6.0 (Slack Bot framework with Socket Mode)
- @prisma/client v7.4.2 (PostgreSQL ORM)
- bullmq v5.70.1 (Redis-based job queue)
- ioredis v5.10.0 (Redis client for cache/queue)
- express v5.2.1 (REST API for webhooks)
- @anthropic-ai/sdk v0.78.0 (Claude for intent classification)
- @aws-sdk/client-s3 v3.1001.0 (S3 file storage)
- xlsx, csv-parse (file parsing)

**Storage**:
- PostgreSQL (AWS RDS) - job tracking, contact data, provider metadata
- Redis (AWS ElastiCache) - conversation state, job queue, provider caching
- AWS S3 - file uploads/downloads

**Testing**: Vitest
**Target Platform**: AWS ECS Fargate (`prod-slack-list-processor` cluster)
**Project Type**: Single backend service (Node.js API + Slack bot)
**Performance Goals**:
- Email enrichment: 2-5 minutes for 2,000 contacts
- Phone enrichment: 5-15 minutes async via webhooks
- Webhook processing: <500ms per callback
- Provider API calls: <2s timeout per contact

**Constraints**:
- AWS-only deployment (no local development - see Constitution XV)
- Single Socket Mode connection (ECS task only)
- 2,000 contact limit per job (6,000 worst-case API calls)
- 5-minute webhook timeout per provider
- Provider credentials in environment variables (ECS task definition)

**Scale/Scope**:
- 3 enrichment providers (Apollo, Wiza, AI Ark)
- 1 verification provider (Findymail)
- 2 webhook endpoints (Wiza, AI Ark)
- 5 new Prisma models (EnrichmentProvider, ProviderAttempt, ProviderCost, etc.)
- 3 BullMQ workers (provider-enrichment, webhook-processor, email-verification)
- 1 quality gate (email verification via Findymail, modeled after DNC scrub)
- ~1,800 LOC estimated

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

### Applicable Principles

**✅ Principle XV: AWS-Only Infrastructure (Slack List Processor)**
- Feature deploys to AWS ECS Fargate (existing cluster)
- No local development allowed
- All testing against deployed AWS service
- **Compliance**: Feature follows ECS deployment pattern

**✅ Principle V: SOC 2 Compliance & Audit Logging**
- FR-017 requires comprehensive logging of all provider API calls
- Request/response details, credits consumed, errors logged
- Immutable audit trail for cost attribution
- **Compliance**: Feature includes audit logging requirements

**✅ Principle VI: Cost Tracking & Financial Model**
- FR-010: Display cost breakdowns per provider
- FR-011: Store per-provider pricing rates in configuration
- FR-004: Track which provider found each piece of data
- **Compliance**: Feature includes full cost attribution system

**✅ Principle VIII: Integration-Centric Design**
- Integrates 3 external enrichment providers (Apollo, Wiza, AI Ark)
- FR-016: Graceful handling of provider API failures
- FR-014: 5-minute timeout with circuit breaker pattern
- Webhook-based async delivery for phone numbers
- **Compliance**: Feature follows integration best practices

**✅ Principle X: Enrichment as Foundation**
- Core enrichment feature for contact data
- FR-026: Skip contacts with existing data (respect existing enrichment)
- FR-015: Cache enriched data to avoid re-enrichment
- FR-019: Deduplicate before enrichment
- **Compliance**: Feature enhances existing enrichment foundation

**✅ Principle XVII: MCP-First Research Workflow**
- MUST research Wiza API documentation (https://docs.wiza.co/)
- MUST research AI Ark API documentation (https://docs.ai-ark.com/)
- MUST research webhook payload formats and authentication
- MUST research rate limits, error codes, pricing models
- **Compliance**: Phase 0 includes comprehensive MCP research

**✅ Principle III: API-First Development**
- FR-007: Webhook endpoints designed before implementation
- REST API patterns for provider callbacks
- Versioned endpoint paths: `/api/webhooks/{provider}/enrichment-results`
- **Compliance**: Webhook API contracts defined in Phase 1

### Not Applicable Principles

- ❌ Principle I: CRM-First Architecture (BDR platform-specific, not Slack bot)
- ❌ Principle II: Plugin Ecosystem (Slack bot is standalone service)
- ❌ Principle IV: Client Isolation (Slack uses channels, not multi-tenant clients)
- ❌ Principle XIV: UI/UX First Design (Slack bot has minimal UI - only Slack messages)
- ❌ Principle XVI: Developer Navigation Index (Slack bot has no web UI)

### Violations & Justifications

**None**. All applicable constitution principles are satisfied by the feature specification.

## Project Structure

### Documentation (this feature)

```text
specs/27-waterfall-enrichment/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/           # Phase 1 output (/speckit.plan command)
│   ├── webhooks.yaml    # OpenAPI spec for Wiza/AI Ark webhook endpoints
│   └── providers.yaml   # Provider configuration contract
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)

```text
src/
├── models/
│   └── index.ts                          # Prisma client export
├── services/
│   ├── apollo/
│   │   └── bulkEnrich.ts                 # Existing Apollo integration
│   ├── wiza/
│   │   ├── client.ts                     # NEW: Wiza API client
│   │   └── enrichment.ts                 # NEW: Wiza enrichment logic
│   ├── aiark/
│   │   ├── client.ts                     # NEW: AI Ark API client
│   │   └── enrichment.ts                 # NEW: AI Ark enrichment logic
│   ├── findymail/
│   │   └── client.ts                     # NEW: Findymail email verification client
│   ├── enrichment/
│   │   ├── waterfall.ts                  # NEW: Waterfall orchestration logic
│   │   ├── providerRegistry.ts           # NEW: Provider configuration and selection
│   │   └── costCalculator.ts             # NEW: Cost attribution and tracking
│   ├── queue/
│   │   ├── queues.ts                     # Existing queue definitions (extend)
│   │   └── workers/
│   │       ├── providerEnrichment.ts     # NEW: Waterfall enrichment worker
│   │       ├── webhookProcessor.ts       # NEW: Wiza/AI Ark webhook worker
│   │       └── emailVerification.ts     # NEW: Findymail email verification worker
│   └── state/
│       └── conversationStore.ts          # Existing (extend for provider status)
├── routes/
│   └── webhooks/
│       ├── apollo.ts                     # Existing Apollo webhook handler
│       ├── wiza.ts                       # NEW: Wiza webhook handler
│       └── aiark.ts                      # NEW: AI Ark webhook handler
├── listeners/
│   └── actions/
│       └── emailVerification.ts          # NEW: Slack button handler for verify/skip
├── config/
│   ├── index.ts                          # Existing config (extend for provider credentials)
│   └── providers.ts                      # NEW: Provider pricing and endpoints
└── types/
    ├── enrichment.ts                     # Existing enrichment types (extend)
    └── providers.ts                      # NEW: Provider-specific types

prisma/
└── schema.prisma                         # Extend with provider tables

tests/
├── unit/
│   ├── services/
│   │   ├── waterfall.test.ts             # NEW: Waterfall logic tests
│   │   ├── costCalculator.test.ts        # NEW: Cost attribution tests
│   │   └── emailVerification.test.ts    # NEW: Findymail verification tests
│   └── routes/
│       ├── wiza-webhook.test.ts          # NEW: Wiza webhook tests
│       └── aiark-webhook.test.ts         # NEW: AI Ark webhook tests
└── integration/
    └── waterfall-enrichment.test.ts      # NEW: End-to-end waterfall tests
```

**Structure Decision**: Single backend service pattern (existing Slack bot codebase). Feature integrates into existing `src/` structure with new provider-specific modules under `src/services/`, new webhook routes under `src/routes/webhooks/`, and new BullMQ workers under `src/services/queue/workers/`. Prisma schema extended with provider tracking tables. Email verification quality gate (US6) follows the established DNC scrub pattern: Slack button handler under `src/listeners/actions/`, BullMQ worker under `src/services/queue/workers/`, and Findymail client under `src/services/findymail/`.

## Complexity Tracking

> **Fill ONLY if Constitution Check has violations that must be justified**

No violations identified. Feature complies with all applicable constitution principles.

---

## Phase 0: Research & Clarification ✅

**Status**: Complete

**Deliverables**:
- [research.md](research.md) - Provider API research, webhook best practices, waterfall strategies

**Key Findings**:
1. **Wiza pricing corrected**: Spec had $0.15/email and $0.35/phone, actual is $0.05/email and $0.125/phone
2. **Wiza same price as Apollo** for emails ($0.05), not 3x more expensive
3. **AI Ark pricing estimates**: $0.14/email, $0.27/phone (requires sales confirmation)
4. **Webhook patterns**: HMAC-SHA256 for AI Ark, SHA256 hash for Wiza (different methods)
5. **Idempotency strategy**: BullMQ job ID + DB unique constraint on webhookId
6. **Findymail API (US6)**: Synchronous POST /api/verify with Bearer auth, returns `{verified, provider}`, 300 concurrent limit, no webhooks needed

---

## Phase 1: Design & Contracts ✅

**Status**: Complete

**Deliverables**:
- [data-model.md](data-model.md) - Prisma schema, entity relationships, migrations
- [contracts/webhooks.yaml](contracts/webhooks.yaml) - OpenAPI spec for Wiza/AI Ark webhooks
- [contracts/providers.yaml](contracts/providers.yaml) - Provider configuration contract
- [quickstart.md](quickstart.md) - Setup, deployment, and testing guide

**Database Schema**:
- `ProviderAttempt` - Track each provider enrichment attempt
- `ProviderWebhook` - Track async webhook deliveries
- `ProviderCost` - Store per-provider pricing configuration
- Extended `Job` - Add enrichmentMode, providersUsed, totalCost
- Extended `JobContact` - Add emailSource, phoneSource, cost tracking, emailVerified, emailProvider, verificationCost

**API Contracts**:
- `POST /api/webhooks/wiza/enrichment-results` - Wiza async phone/email results
- `POST /api/webhooks/aiark/enrichment-results` - AI Ark async phone/email results
- Signature verification: Wiza (SHA256), AI Ark (HMAC-SHA256)

**Provider Configuration**:
- Email waterfall: Apollo → Wiza → AI Ark
- Phone waterfall: Wiza → AI Ark
- Email verification: Findymail (quality gate after email waterfall)
- Max 2,000 contacts per job
- 30-day cache TTL
- 5-minute webhook timeout per provider

**Quality Gates (US6)**:
- Email verification via Findymail: AWAITING_EMAIL_VERIFICATION → verify or skip
- Follows same pattern as DNC scrub: job pauses, Slack buttons, worker processes
- Sequential ordering in "All" mode: email verification runs before phone enrichment
- Verification results always fresh (no caching)

---

## Post-Design Constitution Check

**Re-Evaluation Date**: 2026-03-14
**Status**: ✅ All principles remain compliant

### Validated Compliance

**✅ Principle V: SOC 2 Compliance & Audit Logging**
- ProviderAttempt table logs all API calls with request/response
- ProviderWebhook table tracks all webhook deliveries
- Structured logging in CloudWatch with event types
- Immutable audit trail for cost attribution

**✅ Principle VI: Cost Tracking & Financial Model**
- ProviderCost table stores per-provider pricing
- ProviderAttempt.cost tracks actual cost per enrichment
- Job.totalCost aggregates all provider costs
- Cost breakdown query ready for FR-010 implementation

**✅ Principle VIII: Integration-Centric Design**
- Graceful provider fallback on failures (FR-016)
- 5-minute timeout per provider (FR-014)
- Retry logic via BullMQ (exponential backoff)
- Webhook idempotency prevents duplicate processing

**✅ Principle X: Enrichment as Foundation**
- Cache-first strategy (Redis 30-day TTL)
- Skip contacts with existing data (FR-026)
- Deduplication before enrichment (FR-019)
- Provider metadata preserved for future use

**✅ Principle XV: AWS-Only Infrastructure**
- All testing via deployed ECS service
- No local development server
- Quickstart.md emphasizes AWS-only deployment
- Database migrations applied via ECS task or bastion host

**✅ Principle XVII: MCP-First Research Workflow**
- Research phase used MCP tools (WebFetch for docs, exa for best practices)
- Provider API documentation thoroughly researched
- Webhook patterns based on 2024+ best practices
- Sources cited in research.md

**✅ Principle III: API-First Development**
- OpenAPI spec for webhooks defined before implementation
- REST patterns for provider callbacks
- Versioned endpoint paths
- Clear request/response contracts

### No New Violations

Design phase introduced no new architecture or patterns that violate constitution principles. All data models, API contracts, and deployment strategies align with existing project standards. US6 (email verification via Findymail) follows the established DNC scrub quality gate pattern, maintaining consistency.

### Action Items from Design

1. **Update spec FR-011**: Correct Wiza pricing to $0.05/email, $0.125/phone
2. **Confirm AI Ark pricing**: Contact sales to verify $0.14/email, $0.27/phone
3. **Confirm Findymail pricing**: Check account pricing page for per-verification cost
4. **Seed ProviderCost table**: Run seed script after migration (include Findymail when pricing confirmed)
5. **Configure provider webhooks**: Set webhook URLs in Wiza and AI Ark accounts
6. **Add FINDYMAIL_API_KEY**: Add to ECS task definition environment variables

---

## Next Phase: Task Generation

**Command**: `/speckit.tasks`
**Prerequisites**: All Phase 1 deliverables complete ✅
**Expected Output**: `tasks.md` with dependency-ordered implementation tasks

**Task Categories** (Preview):
1. **Database**: Prisma migration, seed scripts (including verification fields)
2. **Provider Clients**: Wiza API client, AI Ark API client, Findymail verification client
3. **Waterfall Logic**: Orchestrator, cost calculator, cache integration
4. **Webhook Handlers**: Wiza webhook route, AI Ark webhook route
5. **BullMQ Workers**: Provider enrichment worker, webhook processor, email verification worker
6. **Quality Gates**: Email verification Slack button handler, verification workflow
7. **Slack UI**: Real-time provider status updates, verification prompt
8. **Testing**: Unit tests, integration tests, cost validation, verification tests
9. **Deployment**: ECS task definition update, environment variables (including FINDYMAIL_API_KEY)
10. **Documentation**: Update README, API docs

---

## Summary

**Phase 0: Research** ✅
- Discovered Wiza pricing error in spec
- Researched Wiza, AI Ark APIs comprehensively
- Identified webhook best practices (idempotency, security, monitoring)
- Researched Findymail API for email verification (US6 addition)

**Phase 1: Design** ✅
- Designed 5-table data model for provider tracking
- Extended JobContact with emailVerified, emailProvider, verificationCost fields (US6)
- Added AWAITING_EMAIL_VERIFICATION state transition (US6)
- Added FINDYMAIL to Provider enum (US6)
- Created OpenAPI specs for webhook endpoints
- Defined provider configuration contracts (including Findymail)
- Added email verification quality gate configuration (US6)
- Documented setup, deployment, testing procedures (including Findymail)

**Constitution Compliance**: ✅ All applicable principles satisfied

**Ready for**: `/speckit.tasks` to generate implementation plan
