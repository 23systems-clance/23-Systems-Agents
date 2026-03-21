# Implementation Plan: Pre-Enrichment Lead Quality Gating

**Branch**: `16-lead-quality-gating` | **Date**: 2026-03-11 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/16-lead-quality-gating/spec.md`

## Summary

Add a deterministic pre-enrichment quality gate that filters out low-quality rows (personal emails, missing company data, competitor/suppression domains, duplicates) BEFORE any BuiltWith or Apollo API calls are made. The gate runs in-process after file parsing, produces a filtering summary for Slack, generates a downloadable CSV of rejected rows, and supports per-workspace configuration via the admin dashboard.

## Technical Context

**Language/Version**: TypeScript 5.x (Node.js 20 LTS)
**Primary Dependencies**: @slack/bolt 4.6.0 (Socket Mode), BullMQ, Prisma ORM, csv-parse, xlsx (SheetJS)
**Storage**: PostgreSQL (AWS RDS) for config & results metadata; AWS S3 for filtered-rows CSV; AWS ElastiCache Redis for BullMQ
**Testing**: Vitest (unit tests for gate logic, domain normalization, deduplication)
**Target Platform**: AWS ECS Fargate (single-container deployment)
**Project Type**: Single backend service + separate admin dashboard frontend (React/Vite on CloudFront)
**Performance Goals**: Quality gate adds <2s for 5,000-row files; zero additional API latency
**Constraints**: Must not break existing enrichment pipeline; must be backward-compatible (new workspaces get defaults); no AI/LLM usage (purely deterministic)
**Scale/Scope**: Files up to 5,000 rows; ~20 active workspaces; configurable per workspace

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

| Principle | Status | Notes |
|-----------|--------|-------|
| I. CRM-First | PASS | Quality gate supports enrichment foundation workflow |
| II. Plugin Ecosystem | PASS | Quality gate is a core enrichment feature, not a plugin. It modifies the existing enrichment pipeline inline (no new service boundary). Follows existing `src/services/` structure. |
| III. API-First | PASS | Admin configuration exposed via REST API before any UI. Contracts defined in Phase 1. |
| IV. Client Isolation | PASS | QualityGateConfig scoped per ManagedClient (workspace). Suppression lists workspace-scoped. No cross-tenant data. |
| V. SOC 2 Audit Logging | PASS | Quality gate results logged per job. Filtered row counts tracked in job record. Config changes auditable via existing audit patterns. |
| VI. Cost Tracking | PASS | Core purpose is reducing API costs. Savings reflected in reduced ApiUsageLog entries. Job record tracks filtered vs. passed row counts. |
| VII. Deviation Prevention | PASS | No deviation from existing architecture. Feature adds to enrichment pipeline, does not restructure it. |
| VIII. Integration-Centric | PASS | Reduces calls to BuiltWith + Apollo integrations (cost optimization). |
| X. Enrichment as Foundation | PASS | Quality gate IS enrichment infrastructure — filters junk before enrichment. |
| XII. Holistic System Awareness | PASS | Gate affects: file parsing → enrichment queue → job summary → result file. All connection points mapped. |
| XV. AWS-Only Infrastructure | PASS | Runs on ECS Fargate. S3 for filtered CSV. No local execution. |
| XIX. GitHub Account Policy | PASS | All operations under `developerlabsai`. |

**All gates pass. No violations requiring justification.**

## Project Structure

### Documentation (this feature)

```text
specs/16-lead-quality-gating/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   ├── quality-gate-config.md
│   └── quality-gate-results.md
└── tasks.md             # Phase 2 output (via /speckit.tasks)
```

### Source Code (repository root)

```text
src/
├── services/
│   ├── qualityGate/
│   │   ├── qualityGate.ts          # Core gate logic: runQualityGate()
│   │   ├── filters/
│   │   │   ├── personalEmail.ts    # Personal email domain filter
│   │   │   ├── missingCompany.ts   # Missing company/domain filter
│   │   │   ├── suppression.ts      # Suppression domain list filter
│   │   │   ├── duplicateDomain.ts  # Domain deduplication
│   │   │   └── duplicateEmail.ts   # Exact email dedup
│   │   ├── config.ts               # Load/merge workspace config with defaults
│   │   ├── filteredCsv.ts          # Generate + upload filtered-rows CSV to S3
│   │   └── types.ts                # Shared types
│   ├── file/
│   │   └── domainUtils.ts          # Extended: stripSubdomain(), isPersonalDomain()
│   └── queue/
│       └── workers/
│           └── combined.ts         # Modified: use uniqueDomains for BuiltWith dedup (US3)
├── routes/
│   └── admin/
│       └── qualityGateConfig.ts    # CRUD API for per-workspace gate settings
├── listeners/
│   └── events/
│       └── message.ts              # Modified: call runQualityGate() before enqueue

admin-dashboard/src/
├── pages/
│   └── clients/
│       └── QualityGateSettings.tsx  # Admin UI for per-workspace config
├── services/
│   └── qualityGateConfig.ts         # API client for gate config
```

**Structure Decision**: Single backend service. Quality gate logic lives in `src/services/qualityGate/` with individual filter modules. Admin API extends existing `src/routes/admin/` pattern. Frontend extends existing admin dashboard.

## Complexity Tracking

> No violations. Table intentionally empty.
