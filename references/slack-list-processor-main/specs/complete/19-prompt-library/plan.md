# Implementation Plan: Prompt Library & AI Configuration Management

**Branch**: `19-prompt-library` | **Date**: 2026-03-12 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/19-prompt-library/spec.md`

## Summary

Extract 4 inline AI prompts (agent intent classifier, enrichment intent classifier, persona classifier, filter parser) into a database-backed prompt library with versioning (draft/published/archived), template variables with workspace overrides, an admin dashboard UI for editing and testing prompts, and Redis caching with compiled-in fallbacks. This enables prompt iteration without code deploys.

## Technical Context

**Language/Version**: TypeScript 5.x (Node.js backend + React frontend)
**Primary Dependencies**: Express 5.x, Prisma 7.x, @anthropic-ai/sdk, IORedis, React 19, TanStack React Query, shadcn/ui, Tailwind CSS 4
**Storage**: PostgreSQL (AWS RDS via Prisma), Redis (AWS ElastiCache via IORedis)
**Testing**: Manual testing against deployed ECS service (no local dev — constitution XV)
**Target Platform**: Web (ECS Fargate backend + CloudFront/S3 admin dashboard)
**Project Type**: Web application (backend + frontend)
**Performance Goals**: Prompt resolution <10ms (Redis hit), <50ms (DB fallback); 99.9% availability
**Constraints**: Single ECS task (Socket Mode), 5-min cache TTL, no local development
**Scale/Scope**: 4 prompts initially, ~10 template variables, ~5-20 workspaces

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

| Principle | Status | Notes |
|-----------|--------|-------|
| I. CRM-First | PASS | Prompts support enrichment/classification which feeds CRM workflow |
| II. Plugin Ecosystem | N/A | Prompt library is core infrastructure, not a plugin |
| III. API-First | PASS | Full REST API defined before UI (see contracts/prompts-api.yaml) |
| IV. Client Isolation | PASS | Workspace overrides scoped by workspaceId; no cross-workspace leakage |
| V. SOC 2 Audit | PASS | All publishes logged via existing auditLogger; immutable version history |
| VI. Cost Tracking | PASS | Test runs track token usage and estimated cost via existing costCalculator |
| VII. Deviation Prevention | PASS | No deviations from constitution identified |
| VIII. Integration-Centric | PASS | Prompts configure Claude API integration; no new external services |
| IX. Sequence-Driven | N/A | Not sequence-related |
| X. Enrichment as Foundation | PASS | Prompt library improves enrichment classification accuracy |
| XI. Context-First | PASS | Full codebase research completed (see research.md) |
| XII. Holistic Awareness | PASS | All 4 AI services identified; fallback strategy prevents breakage |
| XIII. Confirmation Required | PASS | Admin must explicitly publish; testing gate (FR-018) |
| XIV. UI/UX First | PASS | Admin dashboard pages follow existing shadcn/ui patterns |
| XV. AWS-Only | PASS | No local development; deploy via GitHub Actions CI/CD |
| XIX. GitHub Account | PASS | Using developerlabsai account |

**Gate result**: PASS — no violations.

## Project Structure

### Documentation (this feature)

```text
specs/19-prompt-library/
├── spec.md              # Feature specification
├── plan.md              # This file
├── research.md          # Phase 0: Research decisions
├── data-model.md        # Phase 1: Entity definitions
├── quickstart.md        # Phase 1: Architecture overview
├── contracts/
│   └── prompts-api.yaml # Phase 1: OpenAPI contract
├── checklists/
│   └── requirements.md  # Spec quality checklist
└── tasks.md             # Phase 2 output (/speckit.tasks)
```

### Source Code (repository root)

```text
# Backend (ECS Fargate)
prisma/
├── schema.prisma              # Add 6 new models (modify existing)
└── seed-prompts.ts            # Idempotent prompt seeding script

src/
├── services/ai/
│   ├── promptResolver.ts      # NEW: Runtime resolution (Redis → DB → fallback)
│   ├── defaultPrompts.ts      # NEW: Compiled-in fallback prompts
│   ├── templateEngine.ts      # NEW: {{variable}} resolution engine
│   ├── agentOrchestrator.ts   # MODIFY: Use promptResolver
│   ├── orchestrator.ts        # MODIFY: Use promptResolver
│   ├── personaClassifier.ts   # MODIFY: Use promptResolver
│   └── filterParser.ts        # MODIFY: Use promptResolver
├── routes/admin/
│   ├── prompts.ts             # NEW: Prompt CRUD + versions + test + variables
│   └── index.ts               # MODIFY: Mount prompts router
└── lib/
    └── auditLogger.ts         # MODIFY: Add prompt audit actions

# Frontend (CloudFront + S3)
admin-dashboard/src/
├── services/
│   └── prompts.ts             # NEW: API client for prompt endpoints
├── pages/prompts/
│   ├── PromptListPage.tsx     # NEW: Prompt library listing
│   ├── PromptDetailPage.tsx   # NEW: Edit + version management
│   ├── PromptTestPanel.tsx    # NEW: Test draft prompts
│   ├── PromptDiffView.tsx     # NEW: Version diff comparison
│   └── VariableOverridesPage.tsx # NEW: Workspace variable overrides
├── lib/
│   └── query-keys.ts          # MODIFY: Add prompt query keys
└── router.tsx                 # MODIFY: Add prompt routes
```

**Structure Decision**: Follows existing web application pattern (backend `src/` + frontend `admin-dashboard/src/`). No new top-level directories needed. All new files integrate into established directory structure.

## Phase 0 Artifacts

- [research.md](research.md) — 9 research decisions covering: versioning strategy, template variables, Redis caching, fallback strategy, seeding approach, optimistic locking, admin dashboard integration, audit logging, and test panel architecture.

## Phase 1 Artifacts

- [data-model.md](data-model.md) — 6 new Prisma models: Prompt, PromptVersion, PromptVariable, PromptVariableMapping, WorkspacePromptOverride, PromptTestRun. Includes state machine diagram and Redis cache schema.
- [contracts/prompts-api.yaml](contracts/prompts-api.yaml) — Full OpenAPI 3.0 specification with 15 endpoints covering prompt CRUD, version management, publishing, testing, diff, and workspace variable overrides.
- [quickstart.md](quickstart.md) — Architecture diagram, key files list, and implementation order guide.

## Complexity Tracking

> No constitution violations to justify. All principles pass.

_No entries required._
