# Implementation Plan: Account-Level Research Cache

**Branch**: `17-account-research-cache` | **Date**: 2026-03-11 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/17-account-research-cache/spec.md`

## Summary

Add a PostgreSQL-backed, domain-keyed cache for BuiltWith enrichment results with configurable TTL (default 60 days). The cache is shared across all workspaces (BuiltWith data is public company data) and integrates into the existing technographic enrichment worker. On cache hit, the worker skips the BuiltWith API call and reuses stored results. A "Use cached data" toggle in the Slack enrichment confirmation flow allows users to force fresh lookups. Admin dashboard gains cache metrics (hit rate, entries, estimated savings) and configuration (TTL, purge). A daily scheduled job purges expired entries.

## Technical Context

**Language/Version**: TypeScript 5.x (Node.js 20.x)
**Primary Dependencies**: @slack/bolt 4.6.0, Prisma ORM 5.x, BullMQ, Express
**Storage**: PostgreSQL (AWS RDS) via Prisma; Redis (AWS ElastiCache) for queues/sessions
**Testing**: Vitest
**Target Platform**: AWS ECS Fargate (Docker), Admin Dashboard on CloudFront+S3
**Project Type**: Web application (backend ECS + frontend Vite/React)
**Performance Goals**: Cache lookup <50ms per domain; batch lookups for up to 5,000 domains per job
**Constraints**: Single ECS task (Socket Mode), no local dev; cache stored in RDS (not Redis) for persistence and JSONB support
**Scale/Scope**: 100k+ cached domains over time; 10-50 enrichment jobs/day across workspaces

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

| Principle | Status | Notes |
|-----------|--------|-------|
| I. CRM-First | PASS | Cache supports enrichment foundation (Principle X) |
| II. Plugin Ecosystem | JUSTIFIED DEVIATION | Cache is core infrastructure, not a plugin. It serves the BuiltWith integration but is a cross-cutting performance optimization layer. See Complexity Tracking. |
| III. API-First | PASS | Admin endpoints designed before UI (contracts/ below) |
| IV. Client Isolation | JUSTIFIED DEVIATION | Cache is shared across workspaces. BuiltWith technographic data is public company data, not tenant-specific. Sharing maximizes cache hit rate. See Complexity Tracking. |
| V. SOC 2 / Audit Logging | PASS | Cache purge, TTL changes, and admin actions logged to AuditLog |
| VI. Cost Tracking | PASS | Cache hits excluded from billing (FR-008); savings tracked in metrics |
| VII. Deviation Prevention | PASS | Two deviations documented and justified |
| VIII. Integration-Centric | PASS | Wraps existing BuiltWith integration with caching layer |
| XV. AWS-Only | PASS | RDS PostgreSQL, no local development |
| XIX. GitHub Account | PASS | developerlabsai account |

## Project Structure

### Documentation (this feature)

```text
specs/17-account-research-cache/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   └── api-contracts.md # Cache admin API endpoints
└── tasks.md             # Phase 2 output (/speckit.tasks)
```

### Source Code (repository root)

```text
prisma/
└── schema.prisma                          # New models: DomainEnrichmentCache, CacheConfig

src/
├── services/
│   ├── builtwith/
│   │   └── domainCache.ts                 # Cache lookup/store/purge service
│   └── queue/
│       └── workers/
│           ├── technographic.ts           # Modified: check cache before API call
│           └── cachePurge.ts              # New: daily expired entry cleanup worker
├── routes/
│   └── admin/
│       └── cache.ts                       # New: cache metrics, config, purge endpoints
├── listeners/
│   └── actions/
│       └── enrichmentType.ts              # Modified: add "Use cached data" toggle
└── lib/
    └── domainNormalizer.ts                # New: shared domain normalization utility

admin-dashboard/
└── src/
    ├── pages/
    │   └── CacheMetrics.tsx               # New: cache dashboard page
    └── components/
        └── cache/
            ├── CacheStatsCard.tsx          # New: hit rate, entries, savings
            └── CacheConfigPanel.tsx        # New: TTL config, purge button

tests/
└── unit/
    ├── domainCache.test.ts                # Cache service unit tests
    └── domainNormalizer.test.ts           # Normalization unit tests
```

**Structure Decision**: Follows existing project structure. Cache service lives alongside BuiltWith services in `src/services/builtwith/`. Admin routes extend `src/routes/admin/`. Frontend components added to admin-dashboard. New worker follows existing BullMQ worker pattern.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|-----------|--------------------------------------|
| Not a plugin (Principle II) | Cache is a cross-cutting performance optimization for BuiltWith API calls. It operates below the plugin abstraction layer. | Making it a plugin would add unnecessary lifecycle hooks and isolation overhead for what is essentially a database-level optimization. The cache service is consumed by the technographic worker directly. |
| Shared across workspaces (Principle IV) | BuiltWith returns identical technographic data regardless of which workspace requests it. Domain "acme.com" has the same tech stack for all tenants. | Per-workspace isolation would reduce cache hit rate by N-fold (one cache per workspace) and multiply BuiltWith API costs proportionally. The spec clarification explicitly chose shared caching. |
