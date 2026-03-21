# Implementation Plan: Workflow Channel Scoping

**Branch**: `21-workflow-channel-scoping` | **Date**: 2026-03-11 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/21-workflow-channel-scoping/spec.md`

## Summary

Add client-level and channel-level scoping to workflows so that different clients can have dedicated workflows, and specific channels can override the client default. The core change is a 3-tier workflow resolution at trigger time: (1) channel-specific mapping, (2) client-level workflow, (3) team-level fallback. This extends the existing `WorkflowTemplate` with an optional `clientId` FK and introduces a new `WorkflowChannelMapping` join table scoped by trigger type.

## Technical Context

**Language/Version**: TypeScript 5.x (Node.js backend + React/Vite frontend)
**Primary Dependencies**: @slack/bolt v4.6, Prisma ORM, Express.js (backend), React + Vite + shadcn/ui (admin dashboard)
**Storage**: PostgreSQL via AWS RDS (Prisma ORM)
**Testing**: Manual testing against deployed AWS ECS service (no local dev)
**Target Platform**: AWS ECS Fargate (backend), CloudFront + S3 (admin dashboard)
**Project Type**: Web application (backend + separate frontend)
**Performance Goals**: 3-tier resolution adds <100ms latency vs current single lookup
**Constraints**: Single Socket Mode connection (ECS only), no local testing
**Scale/Scope**: ~10 clients, ~50 channels, ~20 workflows max

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

| Principle | Status | Notes |
|-----------|--------|-------|
| I. CRM-First Architecture | PASS | Extends workflow engine, no CRM conflicts |
| II. Plugin Ecosystem | PASS | Not a plugin; extends core workflow routing |
| III. API-First Development | PASS | API contracts defined before UI work |
| IV. Client Isolation | PASS | Strengthens isolation by scoping workflows per-client |
| V. SOC 2 / Audit Logging | PASS | Audit logging via existing `logAudit()` on all mutations |
| VI. Cost Tracking | N/A | No paid API calls introduced |
| VII. Deviation Prevention | PASS | Aligns with constitution |
| XIII. Confirmation-Required | PASS | Auto-deactivate on publish shows warning first |
| XIV. UI/UX First Design | PASS | Scope panel follows progressive disclosure |
| XV. AWS-Only Infrastructure | PASS | No local dev changes |
| XIX. GitHub Account Policy | PASS | Using `developerlabsai` |

No violations. Complexity Tracking section not needed.

## Project Structure

### Documentation (this feature)

```text
specs/21-workflow-channel-scoping/
├── plan.md              # This file
├── spec.md              # Feature specification
├── research.md          # Phase 0: research decisions
├── data-model.md        # Phase 1: schema changes
├── quickstart.md        # Phase 1: dev quickstart
├── contracts/           # Phase 1: API contracts
│   └── api-contracts.md
├── checklists/
│   └── requirements.md  # Spec quality checklist
└── tasks.md             # Phase 2: implementation tasks (via /speckit.tasks)
```

### Source Code (repository root)

```text
# Backend (Node.js + Express + Prisma)
prisma/
└── schema.prisma                          # Add WorkflowChannelMapping model, extend WorkflowTemplate

src/
├── services/workflow/
│   ├── workflowEngine.ts                  # New resolveWorkflowTemplate() + update startExecution()
│   └── workflowService.ts                 # Update createWorkflow, listWorkflows, getWorkflow, publishVersion
├── routes/admin/
│   ├── workflows.ts                       # New channel mapping endpoints, client assignment endpoint
│   └── clientManagement.ts                # Add workflows to client detail response
└── lib/
    └── clientLookup.ts                    # Existing resolveClientId (unchanged, reused in tier-2)

# Admin Dashboard (React + Vite + shadcn/ui)
admin-dashboard/src/
├── pages/
│   ├── workflow-builder.tsx               # Add WorkflowScopePanel
│   ├── workflows.tsx                      # Add client column + filter
│   └── managed-clients.tsx                # Add Associated Workflows card
├── components/workflow/
│   └── WorkflowScopePanel.tsx             # NEW: client selector + channel mapper
├── services/
│   ├── workflows.ts                       # Add client/channel mapping API functions
│   └── managed-clients.ts                 # Update detail type to include workflows
└── types/
    └── api.ts                             # Extend workflow + client types
```

**Structure Decision**: Existing web application structure with backend (`src/`) and frontend (`admin-dashboard/src/`). No new directories beyond one new component file.
