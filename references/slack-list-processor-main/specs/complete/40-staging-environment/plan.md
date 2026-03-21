# Implementation Plan: Staging Environment

**Branch**: `40-staging-environment` | **Date**: 2026-03-19 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/40-staging-environment/spec.md`

## Summary

Set up a complete staging environment for the Slack List Processor that mirrors production. The existing CloudFormation template is already parameterized with `EnvironmentName` (prod/staging). The main work is: (1) deploying a second CloudFormation stack with staging parameters, (2) extending the GitHub Actions CI/CD workflow to support branch-based deployments (`develop` → staging, `main` → production), (3) creating a second Slack app for staging, (4) setting up a staging admin dashboard on a separate CloudFront + S3 distribution, and (5) adding deployment failure Slack notifications.

## Technical Context

**Language/Version**: TypeScript 5.x (Node.js runtime on ECS Fargate)
**Primary Dependencies**: @slack/bolt v4.6.0 (Socket Mode), BullMQ, Prisma ORM, Express
**Storage**: PostgreSQL (AWS RDS), Redis (AWS ElastiCache), S3 (file storage)
**Testing**: Manual testing against deployed staging environment (no local dev)
**Target Platform**: AWS ECS Fargate (Linux containers)
**Project Type**: Infrastructure / DevOps (CloudFormation, GitHub Actions, AWS CLI)
**Performance Goals**: Staging deployment completes within 15 minutes of push
**Constraints**: Must not affect production; staging cost under $90/month
**Scale/Scope**: 2 environments (staging + production), same codebase, same CloudFormation template

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

| Principle | Status | Notes |
|-----------|--------|-------|
| I. CRM-First Architecture | N/A | Infrastructure change, no CRM impact |
| II. Plugin Ecosystem | N/A | No plugin changes |
| III. API-First Development | PASS | No new APIs; existing APIs deployed to staging |
| IV. Client Isolation | PASS | Staging is a separate environment with its own DB; no cross-tenant risk |
| V. SOC 2 / Audit Logging | PASS | Staging has separate CloudWatch log groups; audit trail maintained |
| VI. Cost Tracking | PASS | Staging uses shared API keys; costs tracked via same credit pool |
| VII. Deviation Prevention | PASS | Single template, parameterized; no architectural deviation |
| VIII. Integration-Centric | PASS | Shared API keys for BuiltWith/Apollo; same integration patterns |
| IX. Sequence-Driven | N/A | No workflow changes |
| X. Enrichment as Foundation | N/A | Same enrichment pipeline, different env |
| XI. Context-First | PASS | Explored existing infra before planning |
| XII. Holistic System | PASS | Staging mirrors full system, not a partial deploy |
| XIII. Confirmation-Required | PASS | Deploy script requires explicit invocation |
| XIV. UI/UX First | N/A | No UI changes |
| XV. AWS-Only Infrastructure | PASS | Staging runs on AWS ECS Fargate only |
| XVI. Developer Navigation | N/A | No route changes |
| XVII. MCP-First Research | PASS | Researched CloudFormation, GitHub Actions patterns |
| XVIII. Developer Navigation (cont.) | N/A | No route changes |
| XIX. GitHub Account Policy | PASS | All operations via `developerlabsai` |
| XX. Bullet-Proof Automation | PASS | CI/CD uses Trigger-Route (Pattern 1) with failure notifications |

**Automation Pattern Classification**: Pattern 1 (Trigger-Route) — Push to branch triggers linear CI/CD path ending in deployment. Failure notification via Slack (FR-011) covers the "alert at LAST step" rule.

**Gate Result**: PASS — No violations. Proceed to Phase 0.

## Project Structure

### Documentation (this feature)

```text
specs/40-staging-environment/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output (minimal - infra-focused feature)
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output (no new API contracts)
└── tasks.md             # Phase 2 output (/speckit.tasks)
```

### Source Code (repository root)

```text
infra/
├── cloudformation.yaml          # EXISTING - already parameterized with EnvironmentName
├── deploy.sh                    # EXISTING - parameterize ENV_NAME for staging
├── cloudfront-config.json       # EXISTING (production) - create staging variant
└── staging-cloudfront-config.json  # NEW - staging admin dashboard CloudFront config

.github/workflows/
├── deploy.yml                   # MODIFY - add develop branch trigger, environment matrix
└── deploy-admin.yml             # NEW - admin dashboard deploy workflow (staging + prod)
```

**Structure Decision**: This is an infrastructure/DevOps feature. No application source code changes. All modifications are to infrastructure templates (`infra/`), CI/CD workflows (`.github/workflows/`), and deployment scripts.

## Complexity Tracking

No constitution violations. No complexity tracking entries needed.
