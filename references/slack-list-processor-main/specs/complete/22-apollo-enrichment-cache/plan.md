# Implementation Plan: Apollo Enrichment Cache

**Branch**: `22-apollo-enrichment-cache` | **Date**: 2026-03-11 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/22-apollo-enrichment-cache/spec.md`
**Dependency**: Feature 17 (Account-Level Research Cache) — shared infrastructure for domain normalizer, force-refresh toggle, admin dashboard cache patterns, and purge worker pattern.

## Summary

Add two persistent cache tiers for Apollo enrichment: (1) a search results cache keyed by normalized domain + filter hash that eliminates redundant people search API calls (saving time and rate-limit headroom), and (2) a contact enrichment cache keyed by Apollo person ID that eliminates redundant bulk enrichment credits (saving 1-2 credits per cached contact). Both caches integrate into the existing contact and combined enrichment workers. The Feature 17 "Use cached data" toggle applies to Apollo caches. Admin dashboard gains Apollo-specific cache metrics and TTL configuration.

## Technical Context

**Language/Version**: TypeScript 5.x (Node.js 20.x)
**Primary Dependencies**: @slack/bolt 4.6.0, Prisma ORM 5.x, BullMQ, Express
**Storage**: PostgreSQL (AWS RDS) via Prisma; Redis (AWS ElastiCache) for queues/sessions
**Testing**: Vitest
**Target Platform**: AWS ECS Fargate (Docker), Admin Dashboard on CloudFront+S3
**Project Type**: Web application (backend ECS + frontend Vite/React)
**Performance Goals**: Combined cache lookup <100ms per job; enrichment jobs with high overlap complete 30% faster
**Constraints**: Single ECS task (Socket Mode), no local dev; depends on Feature 17 being deployed first
**Scale/Scope**: Search cache: ~5k-20k entries (unique domain+filter combos); Contact cache: ~50k-200k entries over time (individual contacts)

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

| Principle | Status | Notes |
|-----------|--------|-------|
| I. CRM-First | PASS | Cache supports enrichment foundation (Principle X) and contact data quality |
| II. Plugin Ecosystem | JUSTIFIED DEVIATION | Same as Feature 17 — cache is core infrastructure below the plugin layer |
| III. API-First | PASS | Admin endpoints designed before UI (contracts/ below) |
| IV. Client Isolation | JUSTIFIED DEVIATION | Same as Feature 17 — Apollo search data is public, not tenant-specific. Sharing maximizes cache hit rate. |
| V. SOC 2 / Audit Logging | PASS | Cache purge, TTL changes, and admin actions logged to AuditLog |
| VI. Cost Tracking | PASS | Cache hits excluded from billing (FR-015); Apollo credit savings tracked in metrics |
| VII. Deviation Prevention | PASS | Deviations documented and justified |
| VIII. Integration-Centric | PASS | Wraps existing Apollo integration with caching layer |
| XV. AWS-Only | PASS | RDS PostgreSQL, no local development |
| XIX. GitHub Account | PASS | developerlabsai account |

## Project Structure

### Documentation (this feature)

```text
specs/22-apollo-enrichment-cache/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   └── api-contracts.md # Apollo cache admin API endpoints
└── tasks.md             # Phase 2 output (/speckit.tasks)
```

### Source Code (repository root)

```text
prisma/
└── schema.prisma                          # New models: ApolloSearchCache, ApolloContactCache
                                           # Extended CacheConfig: apolloSearchTtlDays, apolloContactTtlDays

src/
├── services/
│   ├── apollo/
│   │   ├── searchCache.ts                 # Search cache service (batchLookup, store, purge)
│   │   └── contactCache.ts                # Contact enrichment cache service
│   └── queue/
│       └── workers/
│           ├── contact.ts                 # Modified: check both caches before API calls
│           └── combined.ts                # Modified: same cache integration as contact worker
├── routes/
│   └── admin/
│       └── cache.ts                       # Extended: Apollo cache metrics, config, purge
├── listeners/
│   └── actions/
│       └── enrichmentType.ts              # Already modified by Feature 17 (force-refresh toggle)
└── lib/
    ├── domainNormalizer.ts                # Reused from Feature 17
    └── filterHasher.ts                    # New: deterministic hash of Apollo filter params

admin-dashboard/
└── src/
    ├── pages/
    │   └── CacheMetrics.tsx               # Extended: Apollo cache sections
    └── components/
        └── cache/
            ├── ApolloCacheStatsCard.tsx    # New: Apollo-specific hit rate, credits saved
            └── ApolloCacheConfigPanel.tsx  # New: search TTL, contact TTL, purge buttons

tests/
└── unit/
    ├── searchCache.test.ts                # Search cache service tests
    ├── contactCache.test.ts               # Contact cache service tests
    └── filterHasher.test.ts               # Filter hash determinism tests
```

**Structure Decision**: Follows existing project structure and Feature 17 patterns. Cache services live alongside Apollo services in `src/services/apollo/`. Admin routes extend the cache.ts route file from Feature 17. Frontend components extend the existing cache metrics page.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|-----------|--------------------------------------|
| Not a plugin (Principle II) | Same justification as Feature 17 — caching is cross-cutting infrastructure below the plugin layer. | Plugin isolation overhead is unnecessary for a database-level optimization consumed directly by enrichment workers. |
| Shared across workspaces (Principle IV) | Apollo people search returns identical results for a given domain + filter combo regardless of workspace. Contact enrichment data (name, email, title, LinkedIn) is public professional information. | Per-workspace isolation would multiply cache misses by N workspaces, reducing credit savings proportionally. |
