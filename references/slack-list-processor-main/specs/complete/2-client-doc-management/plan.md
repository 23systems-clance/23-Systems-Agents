# Implementation Plan: Client Document Management

**Branch**: `2-client-doc-management` | **Date**: 2026-03-05 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/2-client-doc-management/spec.md`

## Summary

Add a document management layer to the Slack enrichment bot that allows teams to upload, classify, store, and reference client documents (ICP profiles, use cases, settings, one-pagers) in dedicated docs channels. Documents are auto-converted from PDF/DOCX/XLSX to markdown (via mammoth + turndown + pdf-parse), indexed in PostgreSQL with S3-backed storage, and referenceable in ENRICH commands to inject client context into AI-driven enrichment. Settings documents use YAML front matter (parsed by gray-matter) to programmatically override bot defaults. A master table of contents is auto-generated and cached in Redis.

## Technical Context

**Language/Version**: TypeScript 5.x (strict mode, ES2022 target) -- same as feature 1
**Primary Dependencies**: @slack/bolt ^4.6.0, bullmq ^5.70.1, @anthropic-ai/sdk ^0.78.0, mammoth ^1.8.0 (new), turndown ^7.2.0 (new), turndown-plugin-gfm ^1.0.2 (new), pdf-parse ^1.1.1 (new), gray-matter ^4.0.3 (new), xlsx (existing), @aws-sdk/client-s3 (existing), ioredis (existing), @prisma/client (existing)
**Storage**: PostgreSQL (Prisma ORM) + Redis (BullMQ + caching) + S3 (markdown content + originals) -- extends existing infrastructure
**Testing**: Vitest
**Target Platform**: Node.js 18+ backend service (ECS Fargate)
**Project Type**: Single project (extends existing backend service)
**Performance Goals**: Acknowledge Slack uploads within 3 seconds; convert documents within 30 seconds; resolve document references within 500ms (Redis-cached TOC)
**Constraints**: 1 MB max raw file upload; 500 KB max converted markdown; 4,000 char max document context injection; multi-tenant isolation via slack_team_id; per-channel document scoping with cross-channel slug disambiguation
**Scale/Scope**: ~50 documents per team across multiple docs channels, ~5-10 uploads/day, single workspace deployment

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

| Principle | Status | Notes |
|-----------|--------|-------|
| I. CRM-First | DEVIATION | Same as feature 1 -- standalone Slack bot, not CRM plugin. Documents support enrichment workflows that feed into CRM later. |
| II. Plugin Ecosystem | DEVIATION | Same as feature 1 -- standalone service. Document management could become a plugin module in a future platform. |
| III. API-First | PASS | Slack interactive messages as primary UI. REST endpoints defined (future). All document operations go through defined contracts. |
| IV. Client Isolation | PASS | All queries scoped by `slack_team_id`. Documents isolated per docs channel (unique slugs per channel). S3 paths namespaced by team + channel. Cross-channel slug lookup with disambiguation on reference. |
| V. SOC 2 / Audit Logging | PASS | New audit actions: `doc_upload`, `doc_classify`, `doc_archive`, `doc_reference`. Permission checks on archive (uploader + admins only). |
| VI. Cost Tracking | PASS | AI classification calls logged via existing `ApiUsageLog`. Conversion jobs tracked in BullMQ. |
| VII. Deviation Prevention | PASS | Constitution check performed. Same deviations as feature 1, documented. |
| VIII. Integration-Centric | PASS | Extends existing Claude Haiku orchestrator with document context. Does not replace any existing capability. |
| IX. Sequence-Driven | N/A | Not applicable (no campaign sequences in this feature). |
| X. Enrichment as Foundation | PASS | Documents enhance enrichment quality by providing client-specific ICP, persona priorities, and configuration overrides. Settings docs can override decision_makers count and persona list. |
| XI. Context-First | PASS | Research completed (research.md). All unknowns resolved. |
| XII. Holistic Awareness | PASS | Document references stored on Job records (document_slugs, settings_overrides) for traceability. |
| XIII. Confirmation-Required | PASS | Always-confirm classification flow -- buttons shown for every upload regardless of AI confidence. Archive requires uploader or admin permission. |
| XIV. UI/UX First | PASS | Block Kit interactive buttons for classification. Formatted document lists. Threaded conversations for upload confirmations. |
| XV. Dev Nav Index | N/A | No web UI; Slack is the interface. |
| XVI. MCP Research | PASS | Research agent evaluated 7 libraries across 3 categories. Decisions documented in research.md. |

## Project Structure

### Documentation (this feature)

```text
specs/2-client-doc-management/
├── plan.md              # This file
├── research.md          # Phase 0 output - library decisions
├── data-model.md        # Phase 1 output - database schema
├── quickstart.md        # Phase 1 output - setup guide
├── contracts/
│   └── api-contracts.md # Phase 1 output - Slack & queue contracts
└── tasks.md             # Phase 2 output (/speckit.tasks command)
```

### Source Code (repository root)

```text
src/
├── app.ts                                # Extended: register document listeners + worker
├── config/
│   └── index.ts                          # Extended: DOC_* config vars
├── listeners/
│   ├── events/
│   │   ├── fileShared.ts                 # Existing: enrichment uploads (modified to check docs channel)
│   │   ├── fileSharedDocument.ts         # NEW: document upload detection + classification flow
│   │   └── message.ts                    # Extended: ENRICH docs / delete doc / refresh toc commands
│   └── actions/
│       └── documentTypeConfirm.ts        # NEW: doc_type_icp/use_case/settings/one_pager button handlers
├── services/
│   ├── ai/
│   │   ├── orchestrator.ts               # Extended: optional documentContext parameter
│   │   └── documentClassifier.ts         # NEW: classify_document tool (Claude Haiku)
│   ├── document/
│   │   ├── converter.ts                  # NEW: PDF/DOCX/XLSX → markdown conversion
│   │   ├── indexer.ts                    # NEW: S3 upload + DB upsert + TOC trigger
│   │   ├── tocGenerator.ts              # NEW: table-of-contents.md generation
│   │   ├── referenceResolver.ts         # NEW: slug → cross-channel search → S3 content fetch for AI context (with disambiguation)
│   │   └── settingsParser.ts            # NEW: YAML front matter parsing + validation
│   ├── queue/
│   │   ├── queues.ts                     # Extended: documentProcessingQueue definition
│   │   └── workers/
│   │       └── documentConversion.ts     # NEW: BullMQ worker for async conversion
│   └── state/
│       └── conversationStore.ts          # Existing: may extend for doc classification state
├── lib/
│   ├── auditLogger.ts                    # Extended: new doc_* audit actions
│   └── storage.ts                        # Existing: reused for S3 operations
└── models/
    └── index.ts                          # Extended: Prisma client with new models

prisma/
├── schema.prisma                         # Extended: ClientDocument, DocsChannelConfig, new enums
└── migrations/
    └── YYYYMMDD_add_client_documents/    # NEW migration

tests/
├── unit/
│   └── services/
│       └── document/
│           ├── converter.test.ts         # PDF/DOCX/XLSX conversion tests
│           ├── settingsParser.test.ts    # YAML front matter parsing tests
│           ├── tocGenerator.test.ts      # TOC generation tests
│           └── classifier.test.ts        # Document classification tests
├── integration/
│   └── document.test.ts                  # End-to-end document flow tests
└── contract/
    └── documentActions.test.ts           # Slack action payload contract tests
```

**Structure Decision**: Single project (extends existing backend service). New modules organized under `src/services/document/` for clear separation from enrichment services. Follows same patterns as feature 1 (listeners → services → queue workers).

## Complexity Tracking

| Deviation | Why Needed | Simpler Alternative Rejected Because |
|-----------|-----------|--------------------------------------|
| Standalone service (not CRM plugin) | Same as feature 1 -- Slack bot operates independently | Building as a plugin requires BDR Management Platform to be deployed first |
| 5 new runtime dependencies | mammoth, turndown, turndown-plugin-gfm, pdf-parse, gray-matter needed for document conversion and settings parsing | No single library handles all formats; each is best-in-class for its role |
| pdf-parse (unmaintained) | Only practical Node.js PDF text extraction library | pdfjs-dist directly is more code for same result; pdf2md too immature; officeparser loses structure |
