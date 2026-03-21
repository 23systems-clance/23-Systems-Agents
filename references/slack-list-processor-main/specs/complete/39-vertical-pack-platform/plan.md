# Implementation Plan: Vertical Pack Platform

**Branch**: `39-vertical-pack-platform` | **Date**: 2026-03-18 | **Spec**: [spec.md](specs/39-vertical-pack-platform/spec.md)
**Input**: Feature specification from `/specs/39-vertical-pack-platform/spec.md`

## Summary

Transform the Slack List Processor into a vertical pack platform where AI agents, MCP server connections, and composable skills are first-class primitives. Admins create agents (reasoning units), register MCP servers (external tool connections), compose skills (agent + tools + trigger + delivery), and bundle skills into vertical packs (commercial products). The existing enrichment pipeline becomes Pack #1 on a platform that hosts many vertical capabilities. Credits are isolated per pack subscription with per-agent token caps and per-workspace daily spend limits.

## Technical Context

**Language/Version**: TypeScript 5.x (strict mode)
**Primary Dependencies**: Express 5.x, @slack/bolt 4.6.0 (Socket Mode), @anthropic-ai/sdk 0.78+, @prisma/client 7.x, BullMQ 5.x, ioredis 5.x, Stripe 20.x
**Storage**: PostgreSQL (AWS RDS) via Prisma ORM, Redis (AWS ElastiCache) for job queue + cache
**Testing**: Vitest
**Target Platform**: AWS ECS Fargate (Docker container), Admin Dashboard on CloudFront + S3 (React/Vite SPA)
**Project Type**: Web application (Express API backend + React/Vite admin frontend)
**Performance Goals**: Skill execution completes within 30s for simple skills, <5min for complex multi-tool skills; Admin CRUD <200ms p95
**Constraints**: Single ECS task (Socket Mode limitation); all testing via deployed AWS environment; no local development server
**Scale/Scope**: 10+ agents, 20+ skills, 3+ packs in first quarter; 50+ workspace subscriptions; thousands of skill executions/month

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

The constitution (`/.specify/memory/constitution.md`) was written for the BDR Management Platform, a separate project with a different tech stack (Next.js, Supabase, shadcn/ui). This project (Slack List Processor) has its own established stack (Express, Prisma/PostgreSQL, React/Vite). The **principles** of the constitution apply; the **specific technology mandates** do not.

### Principles Assessment

| Principle | Status | Notes |
|-----------|--------|-------|
| I. CRM-First Architecture | N/A | This is a different product. Platform primitives (agents, skills, packs) are the core, not CRM. |
| II. Plugin Ecosystem | DEVIATION | This project uses `src/services/` not `src/plugins/`. Agent/MCP/Skill registries follow the same modularity goal via service layers. |
| III. API-First Development | PASS | All platform CRUD exposed via Express REST API before admin dashboard UI. OpenAPI contracts defined in Phase 1. |
| IV. Client Isolation (Multi-Tenancy) | PASS | Skills execute within workspace context. Pack subscriptions scoped by `slackTeamId`. Credits isolated per pack per workspace. |
| V. SOC 2 Compliance & Full Audit Logging | PASS | Every agent invocation and skill execution creates an immutable execution log. Full trace from trigger → agent → tools → output. |
| VI. Cost Tracking & Financial Model | PASS | Per-agent token tracking, per-skill credit costs, per-pack billing with credit isolation. Cost attribution to workspace + pack. |
| VII. Deviation Prevention | PASS | Agent versioning (DRAFT→PUBLISHED) prevents silent prompt changes. Skills pin to specific agent versions. |
| VIII. Integration-Centric Design | PASS | MCP Server Registry formalizes external integrations. Health checks, rate limiting, BYOK support. |
| IX. Sequence-Driven Workflows | N/A | Not applicable to platform primitives; retained for campaign features. |
| X. Enrichment as Foundation | PASS | Enrichment becomes Pack #1 (User Story 5). Migration preserves all existing functionality. |
| XIV. UI/UX First Design | PASS | Admin dashboard pages designed for progressive disclosure (Agent → MCP → Skill → Pack workflow). |
| XV. AWS-Only Infrastructure | PASS | All execution on ECS Fargate. No local server. BullMQ workers for async skill execution. |
| XIX. GitHub Account Policy | PASS | `developerlabsai` account only. |

### Technology Deviations from Constitution

| Constitution Says | This Project Uses | Justification |
|-------------------|-------------------|---------------|
| Next.js 14+ (App Router) | Express 5.x + React/Vite | Established stack; Socket Mode Slack bot requires persistent server, not serverless |
| Supabase | PostgreSQL (AWS RDS) via Prisma | Established stack; AWS-native infrastructure |
| shadcn/ui | React/Vite admin dashboard | Established stack; admin dashboard already built |
| NextAuth.js | express-session + custom admin auth | Established stack; admin auth already implemented |
| src/plugins/ directory | src/services/ directory | Established project structure; modularity via services not plugins |

All technology deviations are pre-existing — this feature builds on the established codebase, not the BDR Management Platform constitution's technology mandates.

## Project Structure

### Documentation (this feature)

```text
specs/39-vertical-pack-platform/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   ├── agents-api.yaml
│   ├── mcp-servers-api.yaml
│   ├── skills-api.yaml
│   ├── packs-api.yaml
│   └── executions-api.yaml
└── tasks.md             # Phase 2 output (/speckit.tasks)
```

### Source Code (repository root)

```text
# Backend (Express API + BullMQ workers)
src/
├── services/
│   ├── platform/
│   │   ├── agentRegistry.ts        # Agent CRUD + versioning
│   │   ├── mcpServerRegistry.ts    # MCP server CRUD + health checks
│   │   ├── skillComposer.ts        # Skill creation + composition
│   │   ├── packManager.ts          # Pack bundling + subscription lifecycle
│   │   ├── skillExecutor.ts        # Skill execution engine
│   │   ├── agentInvoker.ts         # Agent invocation with token cap enforcement
│   │   ├── mcpToolRunner.ts        # MCP tool invocation via registered servers
│   │   ├── creditGate.ts           # Per-pack credit check + deduction
│   │   └── spendLimiter.ts         # Per-workspace daily spend limit enforcement
│   ├── billing/                    # Existing billing infrastructure (extended)
│   └── queue/
│       └── workers/
│           └── skillExecutionWorker.ts  # BullMQ worker for async skill execution
├── routes/
│   ├── admin/
│   │   ├── agents.ts               # Admin agent CRUD endpoints
│   │   ├── mcpServers.ts           # Admin MCP server CRUD endpoints
│   │   ├── skills.ts               # Admin skill CRUD endpoints
│   │   ├── packs.ts                # Admin pack CRUD endpoints
│   │   └── executions.ts           # Execution logs + analytics endpoints
│   └── client/
│       ├── packs.ts                # Client pack catalog + subscription
│       └── skills.ts               # Client skill invocation
└── lib/
    └── platform/
        └── types.ts                # Shared TypeScript interfaces for platform primitives

# Frontend (React/Vite admin dashboard)
admin-dashboard/
└── src/
    ├── pages/
    │   ├── AgentRegistry.tsx        # Agent list + CRUD
    │   ├── AgentDetail.tsx          # Agent edit + test + version history
    │   ├── McpServers.tsx           # MCP server list + CRUD
    │   ├── McpServerDetail.tsx      # MCP server edit + tools + health
    │   ├── SkillComposer.tsx        # Skill creation + testing
    │   ├── SkillDetail.tsx          # Skill edit + execution history
    │   ├── PackManager.tsx          # Pack list + CRUD
    │   ├── PackDetail.tsx           # Pack edit + skill assignment + analytics
    │   ├── PackCatalog.tsx          # Client-facing pack catalog
    │   └── ExecutionLogs.tsx        # Execution trace viewer + analytics
    └── components/
        └── platform/
            ├── AgentSandbox.tsx      # Agent test sandbox UI
            ├── SkillTestRunner.tsx   # Skill end-to-end test UI
            ├── ExecutionTrace.tsx    # Single execution trace viewer
            └── CreditUsageChart.tsx  # Credit usage visualization
```

**Structure Decision**: Web application pattern. Backend extends existing `src/services/` and `src/routes/` structure with a new `platform/` namespace. Frontend extends existing `admin-dashboard/` with new pages and components under a `platform/` namespace. No new top-level directories needed.

## Complexity Tracking

| Deviation | Why Needed | Simpler Alternative Rejected Because |
|-----------|-----------|--------------------------------------|
| New platform service layer (`src/services/platform/`) | 8 new services needed for agent, MCP, skill, pack primitives | Putting in existing services would create naming collisions and blur boundaries |
| Per-pack credit isolation (not shared pool) | Spec clarification requires isolated credits per pack subscription | Shared pool was considered but rejected by stakeholder for clearer billing attribution |
| Agent version pinning on skills | Skills must pin to specific agent version to prevent silent behavior changes | Auto-upgrade was considered but rejected for production stability |
