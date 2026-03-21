# Quickstart: Prompt Library & AI Configuration Management

**Feature**: 19-prompt-library
**Date**: 2026-03-12

## Overview

This feature extracts 4 inline AI prompts into a database-backed prompt library with versioning, admin UI, template variables, and per-workspace overrides. The goal is to enable prompt iteration without code deploys.

## Architecture Summary

```
┌──────────────────────────────────────────────────────────┐
│                   Admin Dashboard                         │
│  /prompts (list) → /prompts/:slug (edit) → Test Panel    │
│  /prompts/variables (global + workspace overrides)        │
└──────────────────┬───────────────────────────────────────┘
                   │ axios → /api/v1/admin/prompts/*
                   ▼
┌──────────────────────────────────────────────────────────┐
│                Backend (Express + Prisma)                  │
│                                                           │
│  src/routes/admin/prompts.ts       ← CRUD + publish + test│
│  src/services/ai/promptResolver.ts ← Runtime resolution   │
│  src/services/ai/defaultPrompts.ts ← Compiled fallbacks   │
└─────┬──────────────┬──────────────┬──────────────────────┘
      │              │              │
      ▼              ▼              ▼
┌──────────┐  ┌──────────┐  ┌──────────────┐
│ PostgreSQL│  │  Redis   │  │ Claude API   │
│ (Prisma)  │  │ (cache)  │  │ (test runs)  │
└──────────┘  └──────────┘  └──────────────┘
```

## Key Files to Create

### Backend
| File | Purpose |
|------|---------|
| `prisma/schema.prisma` | Add Prompt, PromptVersion, PromptVariable, PromptVariableMapping, WorkspacePromptOverride, PromptTestRun models |
| `prisma/seed-prompts.ts` | Idempotent seeding of 4 existing prompts as v1 published |
| `src/services/ai/promptResolver.ts` | Runtime prompt resolution: Redis cache → DB → compiled fallback |
| `src/services/ai/defaultPrompts.ts` | Extracted inline prompts as static constants (fallback) |
| `src/services/ai/templateEngine.ts` | `{{variable}}` resolution with 3-tier priority |
| `src/routes/admin/prompts.ts` | Admin REST endpoints for prompt CRUD, versions, testing, variables |
| `src/lib/auditLogger.ts` | Add prompt-specific audit actions (modify existing file) |

### Frontend (admin-dashboard)
| File | Purpose |
|------|---------|
| `src/services/prompts.ts` | API client functions for prompt endpoints |
| `src/pages/prompts/PromptListPage.tsx` | List all prompts with search/filter |
| `src/pages/prompts/PromptDetailPage.tsx` | View/edit prompt with version management |
| `src/pages/prompts/PromptTestPanel.tsx` | Test draft prompts against sample input |
| `src/pages/prompts/PromptDiffView.tsx` | Side-by-side version comparison |
| `src/pages/prompts/VariableOverridesPage.tsx` | Manage workspace variable overrides |
| `src/lib/query-keys.ts` | Add prompt query keys (modify existing file) |
| `src/router.tsx` | Add prompt routes (modify existing file) |

### Modify Existing AI Services
| File | Change |
|------|--------|
| `src/services/ai/agentOrchestrator.ts` | Replace inline prompt with `promptResolver.resolve('agent-intent-classifier')` |
| `src/services/ai/orchestrator.ts` | Replace inline prompt with `promptResolver.resolve('enrichment-intent-classifier')` |
| `src/services/ai/personaClassifier.ts` | Replace inline prompt with `promptResolver.resolve('persona-classifier')` |
| `src/services/ai/filterParser.ts` | Replace inline prompt with `promptResolver.resolve('filter-parser')` |

## Implementation Order

1. **Schema + Migration** — Add Prisma models, run migration
2. **Default Prompts + Seed** — Extract inline prompts, create seed script
3. **Prompt Resolver + Template Engine** — Core runtime services
4. **Admin API Routes** — CRUD, versioning, publish, test endpoints
5. **Refactor AI Services** — Swap inline prompts for resolver calls
6. **Admin Dashboard UI** — List, detail, editor, test panel, variables
7. **Integration Testing** — End-to-end: edit → test → publish → verify in Slack

## Key Decisions

- **Template syntax**: `{{variableName}}` with simple regex replacement (no Handlebars engine)
- **Resolution priority**: job context > workspace override > global default > empty string
- **Cache**: Redis with 5-min TTL, active invalidation on publish
- **Fallback**: Compiled-in defaults when both Redis and DB are unavailable
- **Concurrency**: Optimistic locking via `updatedAt` check on save (409 Conflict)
- **Seeding**: Automated Prisma seed on deploy (idempotent upsert)
- **Testing**: Real Claude API calls; costs tracked in PromptTestRun + ApiUsageLog
- **Availability target**: 99.9% for prompt resolution
