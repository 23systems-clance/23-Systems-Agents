# Implementation Plan: Performance Audit & Optimization

**Branch**: `30-performance-audit` | **Date**: 2026-03-17 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/30-performance-audit/spec.md`

## Summary

Comprehensive performance audit and optimization of the Slack List Processor codebase targeting five areas: (1) memory-efficient file generation for 5,000-row jobs via chunked database reads and streaming Excel/CSV output, (2) BullMQ job priority using row-count tiers, (3) stale job detection with 30-minute timeout, (4) database index optimization for critical query paths, and (5) custom CloudWatch metrics instrumentation for ongoing monitoring. The audit also addresses Slack message delivery reliability (retry with backoff), admin dashboard query performance, cache effectiveness tracking, and batch operation transaction safety.

## Technical Context

**Language/Version**: TypeScript 5.x (Node.js 20 LTS)
**Primary Dependencies**: @slack/bolt 4.6.0 (Socket Mode), BullMQ 5.x, Prisma 5.x, xlsx (SheetJS), csv-stringify, ioredis, aws-sdk (CloudWatch)
**Storage**: PostgreSQL via Prisma ORM (AWS RDS) + Redis (AWS ElastiCache) for cache and job queues
**Testing**: Manual verification via deployed ECS service (no local execution permitted)
**Target Platform**: AWS ECS Fargate (0.5 vCPU, 1 GB memory), single container
**Project Type**: Single project — Node.js backend + separate admin dashboard frontend
**Performance Goals**: <3s dashboard page loads, <200ms critical DB queries at 10x data, <80% memory during 5K-row jobs, 90%+ cache hit rate
**Constraints**: 1 GB container memory, single Socket Mode connection, worker concurrency of 1, no local testing
**Scale/Scope**: Up to 5,000 rows per job, ~10 concurrent workspaces, <10 admin dashboard users

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

| Principle | Status | Notes |
|-----------|--------|-------|
| I. CRM-First Architecture | N/A | This is optimization, not new feature development |
| II. Plugin Ecosystem | N/A | No plugin changes — optimizing core enrichment pipeline |
| III. API-First Development | PASS | No new APIs; optimizing existing admin endpoints |
| IV. Client Isolation | PASS | Cross-workspace cache is documented assumption; no isolation changes |
| V. SOC 2 / Audit Logging | PASS | CloudWatch metrics add observability; no audit log changes needed |
| VI. Cost Tracking | PASS | Cache optimization reduces API credit waste (SC-006); existing cost tracking preserved |
| VII. Deviation Prevention | PASS | Optimization aligns with existing architecture; no deviations |
| VIII. Integration-Centric | PASS | External API retry/backoff improves integration reliability |
| XIII. Confirmation-Required | PASS | No destructive changes; performance improvements are additive |
| XV. AWS-Only Infrastructure | PASS | All changes deployed via ECS; CloudWatch metrics native to AWS |
| XIX. GitHub Account Policy | PASS | Using developerlabsai account |

**Gate Result: PASS** — No violations. All changes are optimization of existing functionality within established architecture.

## Project Structure

### Documentation (this feature)

```text
specs/30-performance-audit/
├── plan.md              # This file
├── research.md          # Phase 0: Technology research and decisions
├── data-model.md        # Phase 1: Schema changes (indexes, new fields)
├── quickstart.md        # Phase 1: Implementation quickstart guide
├── contracts/           # Phase 1: Updated admin API contracts
│   └── admin-api.md     # Performance-related endpoint changes
└── tasks.md             # Phase 2 output (/speckit.tasks)
```

### Source Code (files to modify)

```text
src/
├── services/
│   ├── queue/
│   │   ├── queues.ts                    # Job priority tiers, queue config
│   │   ├── workers/
│   │   │   ├── enrichmentDispatcher.ts  # Stale job detection, metrics emission
│   │   │   ├── fileGenerationWorker.ts  # Chunked file generation, partial results
│   │   │   └── staleJobDetector.ts      # NEW: Periodic stale job cleanup worker
│   │   └── schedulers.ts               # NEW: BullMQ repeatable job for stale detection
│   ├── upload/
│   │   └── slackNotifier.ts            # Retry with exponential backoff
│   ├── slack/
│   │   └── enrichmentNotifications.ts  # Retry with backoff on message delivery
│   ├── builtwith/
│   │   └── domainCache.ts              # Cache validation improvements
│   ├── apollo/
│   │   ├── searchCache.ts              # Cache validation improvements
│   │   └── contactCache.ts             # Cache validation improvements
│   ├── admin/
│   │   └── aggregation.ts              # Query optimization, remove in-memory grouping
│   └── metrics/
│       └── cloudwatch.ts               # NEW: CloudWatch metrics emitter utility
├── routes/admin/
│   ├── errors.ts                       # Fix error trends in-memory aggregation
│   ├── usage.ts                        # Pagination enforcement
│   └── cache.ts                        # Cache effectiveness metrics
├── lib/
│   └── retryHelper.ts                  # NEW: Shared retry-with-backoff utility
└── middleware/
    └── queryTimer.ts                   # NEW: Prisma middleware for query timing

prisma/
└── migrations/                         # NEW: Index additions, schema changes
    └── YYYYMMDD_performance_indexes/
        └── migration.sql

admin-dashboard/src/                    # No changes (frontend out of scope)
```

**Structure Decision**: Existing single-project structure maintained. New files are limited to a CloudWatch metrics utility, a stale job detector worker, a retry helper, and a Prisma query timing middleware. All other changes modify existing files.

## Complexity Tracking

> No constitution violations to justify. All changes are optimization within existing architecture.
