# Implementation Plan: Visual Workflow Builder

**Branch**: `7-workflow-builder` | **Date**: 2026-03-08 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `specs/7-workflow-builder/spec.md`

## Summary

A visual drag-and-drop workflow builder in the admin dashboard that lets non-technical admins create, edit, and deploy Slack-based enrichment flows without code. Includes backend REST API for workflow CRUD and version management, a graph-based execution engine that drives Slack interactions, and execution analytics. Uses @xyflow/react for the canvas UI, PostgreSQL JSONB for graph storage, and a pause-on-interaction execution model with BullMQ for async operations.

## Technical Context

**Language/Version**: TypeScript 5.x
**Primary Dependencies**:
- Backend: Express.js, Prisma ORM, @slack/bolt (Socket Mode), BullMQ
- Frontend: React 19, Vite 7, Radix UI (shadcn/ui), TanStack Query, @xyflow/react
**Storage**: PostgreSQL via Prisma ORM (AWS RDS), Redis (AWS ElastiCache) for queues
**Testing**: Manual testing via deployed AWS ECS service
**Target Platform**: Web (admin dashboard) + Slack bot (ECS Fargate)
**Project Type**: Web (Express backend + Vite React frontend)
**Performance Goals**: API < 500ms (SC-009), canvas renders 50 nodes without lag (SC-010)
**Constraints**: AWS-only deployment, single Socket Mode connection, no local dev server
**Scale/Scope**: Max ~50 nodes per workflow, multiple concurrent executions per team

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

| Principle | Status | Notes |
|-----------|--------|-------|
| I. CRM-First | N/A | Slack bot extends enrichment, not CRM module |
| II. Plugin Architecture | DEVIATION | This project is a monolithic Slack bot, not a plugin-based platform. Workflow builder is a core feature, not a plugin. See Complexity Tracking. |
| III. API-First | PASS | API contracts defined before UI (see contracts/) |
| IV. Client Isolation | PASS | All workflows scoped by `slackTeamId` |
| V. SOC 2 / Audit Logging | PASS | Existing `logAudit()` used for all CRUD operations |
| VI. Cost Tracking | PASS | Enrichment nodes reuse existing cost tracking; workflow ops are free |
| VII. Deviation Prevention | PASS | This analysis documents all deviations |
| XI. Context-First | PASS | Research phase completed, existing patterns analyzed |
| XIV. UI/UX First | PASS | Visual builder follows shadcn/ui patterns |
| XV. AWS-Only | PASS | Deploy via `./infra/deploy.sh --update` |

## Project Structure

### Documentation (this feature)

```text
specs/7-workflow-builder/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   ├── workflow-crud.md
│   ├── workflow-execution.md
│   └── workflow-analytics.md
├── checklists/
│   └── requirements.md
└── tasks.md             # Phase 2 output (/speckit.tasks)
```

### Source Code (repository root)

```text
# Backend (existing Express server)
src/
├── services/
│   └── workflow/
│       ├── workflowService.ts         # CRUD operations (create, update, publish, archive, clone)
│       ├── workflowEngine.ts          # Execution engine (start, advance, resume, expire)
│       ├── workflowValidator.ts       # Graph validation (cycles, disconnected nodes, completeness)
│       ├── workflowTemplates.ts       # Default template definitions (Company, Contact, Combined)
│       ├── workflowSlackRenderer.ts   # Block Kit message builder for each node type
│       └── types.ts                   # TypeScript types for graph, nodes, edges, configs
├── routes/admin/
│   └── workflows.ts                   # Admin CRUD + analytics API endpoints
├── listeners/actions/
│   └── workflowAction.ts             # Slack action handler for workflow button/form interactions
├── services/queue/
│   ├── queues.ts                      # (extend) Add workflow queue + repeatable jobs
│   └── workers/
│       └── workflowWorker.ts          # BullMQ worker for delays, expiry, execution processing

# Frontend (existing Vite admin dashboard)
admin-dashboard/src/
├── pages/
│   ├── workflows.tsx                  # Workflow list page (US3)
│   ├── workflow-builder.tsx           # Visual builder canvas (US1, US2)
│   └── workflow-analytics.tsx         # Execution analytics page (US4)
├── services/
│   └── workflows.ts                   # API client for workflow endpoints
├── components/
│   └── workflow/
│       ├── WorkflowCanvas.tsx         # ReactFlow wrapper with canvas controls
│       ├── NodePalette.tsx            # Draggable node type sidebar
│       ├── NodeConfigPanel.tsx        # Right-side configuration panel
│       ├── nodes/                     # Custom ReactFlow node components
│       │   ├── TriggerNode.tsx
│       │   ├── MessageNode.tsx
│       │   ├── ButtonChoiceNode.tsx
│       │   ├── FormModalNode.tsx
│       │   ├── EnrichmentNode.tsx
│       │   ├── ConditionNode.tsx
│       │   ├── ActionNode.tsx
│       │   └── DelayNode.tsx
│       ├── edges/
│       │   └── ConditionalEdge.tsx
│       ├── TemplateLibrary.tsx        # Template selection dialog
│       ├── WorkflowValidation.tsx     # Validation results panel
│       └── SlackPreview.tsx           # Block Kit preview component

# Database
prisma/
└── schema.prisma                      # (extend) Add WorkflowTemplate, WorkflowVersion, WorkflowExecution
```

**Structure Decision**: Extends the existing monolith — new `services/workflow/` directory for backend, new `components/workflow/` + pages for frontend. Follows established patterns from `services/onboarding/`, `services/campaign/`, etc.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|--------------------------------------|
| Not a plugin (Principle II) | This project is a standalone Slack bot, not the BDR Management Platform. The plugin architecture applies to the Next.js platform, not this Express service. | Plugin architecture would add unnecessary complexity to a single-purpose Slack bot. |
