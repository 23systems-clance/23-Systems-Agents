# Implementation Plan: AWS Infrastructure Hardening & Gap Resolution

**Branch**: `4-infra-hardening` | **Date**: 2026-03-05 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/4-infra-hardening/spec.md`

## Summary

Harden the existing AWS infrastructure (CloudFormation template, deploy script, application code) to resolve all 20 issues identified in the infrastructure audit. The work spans 4 areas: (1) move secrets to AWS Secrets Manager with `valueFrom` references in ECS, (2) add HTTPS/TLS everywhere (ALB listener, Redis encryption), (3) fix deployment safety (script parameter persistence, ECS Exec, migrations), and (4) improve resilience (graceful shutdown, health check tolerance, auto-scaling, multi-AZ NAT, WAF).

## Technical Context

**Language/Version**: TypeScript 5.9.x (Node.js 22 runtime)
**Primary Dependencies**: @slack/bolt 4.6.0, Express 5.2.1, BullMQ 5.70.1, Prisma 7.4.2, ioredis 5.10.0
**Storage**: PostgreSQL 16 (RDS), Redis 7.1 (ElastiCache), S3
**Testing**: Vitest 4.x
**Target Platform**: AWS ECS Fargate (Linux containers), CloudFormation IaC
**Project Type**: Single backend service (Slack bot + HTTP server + BullMQ workers)
**Performance Goals**: Health check response <5s, graceful shutdown within 30s, auto-scale at 70% CPU
**Constraints**: No downtime during migration for Slack Socket Mode; Redis migration from CacheCluster to ReplicationGroup requires data recreation; ACM certificate requires DNS validation before HTTPS is live
**Scale/Scope**: Single-service, 1-4 ECS tasks, ~$120-150/month infrastructure cost after hardening

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

The constitution is from the BDR Management Platform (Next.js/Supabase). This project is a standalone Slack service. Applicable principles:

| Principle | Applicable? | Status | Notes |
| --------- | ----------- | ------ | ----- |
| I. CRM-First | No | N/A | Standalone enrichment service |
| II. Plugin Ecosystem | No | N/A | No plugin architecture |
| III. API-First | Yes | Pass | REST API already exists with health, jobs, webhooks |
| IV. Client Isolation | No | N/A | Single-tenant Slack bot |
| V. SOC 2 Compliance | Yes | Pass | Audit logging exists; this feature strengthens security posture (secrets, encryption) |
| VI. Cost Tracking | Yes | Pass | FR-023 adds missing cost-tracking env vars to ECS |
| VII. Deviation Prevention | Yes | Pass | No deviations from constitution |
| VIII. Integration-Centric | Yes | Pass | Existing integrations preserved; WAF protects webhook endpoint |
| IX. Sequence-Driven | No | N/A | No campaign sequences |
| X. Enrichment as Foundation | No | N/A | Feature is infrastructure, not enrichment logic |
| XI. Context-First | Yes | Pass | Full codebase audit performed before spec/plan |
| XII. Holistic Awareness | Yes | Pass | Changes span infra, deploy script, and app code; all interconnections mapped |
| XIII. Confirmation-Required | Yes | Pass | Speckit workflow ensures approval at each phase |
| XIV. UI/UX First | No | N/A | No frontend |
| XV-XVII. Developer Navigation/MCP | Partial | Pass | MCP tools used for AWS documentation research |

**Gate Result: PASS** - No violations requiring justification.

## Project Structure

### Documentation (this feature)

```text
specs/4-infra-hardening/
├── spec.md              # Feature specification
├── plan.md              # This file
├── research.md          # Phase 0: AWS best practices research
├── data-model.md        # Phase 1: No new data models (infrastructure feature)
├── quickstart.md        # Phase 1: Step-by-step implementation guide
├── contracts/           # Phase 1: No new API contracts (existing endpoints unchanged)
│   └── README.md        # Explanation of why no new contracts
└── tasks.md             # Phase 2 output (via /speckit.tasks)
```

### Source Code (repository root)

```text
infra/
├── cloudformation.yaml     # PRIMARY: Major changes (secrets, HTTPS, WAF, NAT, auto-scaling, Redis)
├── deploy.sh               # FIX: Parameter persistence, remove secret logging
└── SETUP-GUIDE.md          # UPDATE: Document new setup requirements (ACM cert, ECS Exec)

src/
├── app.ts                  # ADD: Graceful shutdown handler (SIGTERM/SIGINT)
├── server.ts               # FIX: CORS restriction in production
├── config/index.ts         # UPDATE: Add corsAllowedOrigins config field
├── routes/health.ts        # FIX: Startup tolerance (200 + degraded status)
├── models/index.ts         # UNCHANGED (SSL handling already correct)
└── lib/redis.ts            # UNCHANGED (ioredis auto-detects TLS from rediss:// URL)

package.json                # FIX: Add pg to dependencies
Dockerfile                  # UPDATE: Inject version at build time
```

**Structure Decision**: Existing single-service structure preserved. Changes are distributed across infrastructure (CloudFormation), deployment tooling (deploy.sh), and targeted application code fixes. No new directories or architectural patterns introduced.

## Complexity Tracking

No constitution violations to justify. All changes align with existing patterns.
