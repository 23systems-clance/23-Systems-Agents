# Implementation Plan: Smart Reply Assistant

**Branch**: `29-smart-reply-assistant` | **Date**: 2026-03-17 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/29-smart-reply-assistant/spec.md`

## Summary

Add AI-powered smart reply drafting to the UniBox, on-demand AI Ark personality enrichment (via dashboard button and Slack command), a contact details page with personality visualization, Slack reply notifications (DM to assigned BDRs + originating channel), and personality data export (HubSpot CRM sync + CSV). The system classifies inbound reply intent, generates contextual draft replies using Claude Haiku 4.5, and optionally personalizes drafts using AI Ark personality profiles.

## Technical Context

**Language/Version**: TypeScript 5.x (Node.js 20+)
**Primary Dependencies**: Express 5.2, @slack/bolt 4.6, @anthropic-ai/sdk 0.78, BullMQ 5.70, @prisma/client 7.4, @hubspot/api-client 13.4
**Storage**: PostgreSQL via Prisma ORM (AWS RDS), Redis via ElastiCache (BullMQ + cache)
**Testing**: Manual integration testing against deployed AWS ECS service
**Target Platform**: Web (Express API + React SPA admin dashboard)
**Project Type**: Web application (backend `src/` + frontend `admin-dashboard/`)
**Performance Goals**: Draft generation <30s (SC-001), contact detail page <3s load (SC-005)
**Constraints**: Single ECS task (Socket Mode), AI Ark rate limit 5 req/s, Claude Haiku ~$0.001/draft, <$5/month at 100 replies/day
**Scale/Scope**: ~100 replies/day, ~1,000 contacts/campaign, 1 workspace

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

| Principle | Status | Notes |
|-----------|--------|-------|
| I. CRM-First Architecture | PASS | Extends CampaignContact with personality data; pushes to HubSpot CRM |
| II. Plugin Ecosystem | DEVIATION | Feature built into core, not as plugin. Justified: tightly coupled to UniBox, webhook pipeline, and queue system |
| III. API-First Development | PASS | All functionality via Express API endpoints before UI |
| IV. Client Isolation | PASS | All queries scoped by workspace/campaign; no cross-tenant risk |
| V. SOC 2 Audit Logging | PASS | Draft generation cost tracked (FR-009); webhook events already logged |
| VI. Cost Tracking | PASS | Token usage + USD cost per draft (draftTokensUsed, draftCostUsd fields) |
| VII. Deviation Prevention | PASS | Plan reviewed against constitution |
| VIII. Integration-Centric | PASS | Orchestrates AI Ark, Claude Haiku, Instantly, HubSpot - doesn't replace them |
| IX. Sequence-Driven Workflows | N/A | On-demand enrichment decoupled from campaign sequence flow |
| X. Enrichment as Foundation | PASS | On-demand personality enrichment extends existing enrichment patterns |
| XI. Context-First | PASS | Research phase covers all unknowns |
| XII. Holistic System Awareness | PASS | Impact mapped: webhook -> queue -> AI -> UniBox -> Slack -> dashboard |
| XIII. Confirmation-Required | PASS | Plan presented for approval before implementation |
| XIV. UI/UX First Design | PASS | SmartReplyDraft component designed for progressive disclosure |
| XV. AWS-Only Infrastructure | PASS | All runs on ECS Fargate; no local execution |
| XIX. GitHub Account Policy | PASS | Will use developerlabsai account |

## Existing Infrastructure (Reuse)

Key codebase discoveries that reduce scope:

| Component | Location | Impact |
|-----------|----------|--------|
| `CampaignBdr` junction table | `prisma/schema.prisma` | FR-022a (BDR assignment) already exists — no new schema needed |
| `PersonalityAnalysis` cache model | `prisma/schema.prisma` | Global personality cache keyed by LinkedIn URL already exists |
| `personalityAnalysis()` function | `src/services/aiark/client.ts` | AI Ark API integration already built with retry + rate limiting |
| `personalityRouter` | `src/routes/bdr/personality.ts` | On-demand enrichment with cache, returns HTML page |
| `/enrich` command | `src/listeners/commands/enrich.ts` | Subcommand routing already exists (help, history, stop, report) |
| `renderPersonalityHtml()` | `src/services/personality/renderer.js` | Personality visualization HTML renderer |

## Project Structure

### Documentation (this feature)

```text
specs/29-smart-reply-assistant/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
└── tasks.md             # Phase 2 output (/speckit.tasks)
```

### Source Code (repository root)

```text
# Backend (Express + BullMQ)
src/
├── services/
│   ├── ai/
│   │   ├── smartReplyGenerator.ts          # NEW - AI draft generation + intent classification
│   │   └── defaultPrompts.ts              # MODIFY - add smart-reply-generator prompt
│   ├── aiark/
│   │   └── client.ts                      # EXISTING - personalityAnalysis() already built
│   ├── campaign/
│   │   └── personalityCrmSync.ts          # NEW - HubSpot personality push + CSV export
│   ├── hubspot/
│   │   └── hubspotClient.ts               # MODIFY - add custom property creation methods
│   └── queue/
│       ├── queues.ts                      # MODIFY - add smartReplyQueue
│       └── workers/
│           └── smartReplyWorker.ts         # NEW - BullMQ worker for draft generation
├── routes/
│   ├── webhooks/
│   │   └── instantly.ts                   # MODIFY - enqueue draft + Slack notification
│   ├── bdr/
│   │   ├── unibox.ts                      # MODIFY - add draft accept/dismiss/regenerate
│   │   └── personality.ts                 # MODIFY - add JSON enrichment endpoint
│   └── admin/
│       ├── contacts.ts                    # NEW - contact detail API
│       └── campaigns.ts                   # MODIFY - add CRM sync + CSV export endpoints
├── listeners/
│   └── commands/
│       └── enrich.ts                      # MODIFY - add personality subcommand
├── app.ts                                 # MODIFY - register smart reply worker
└── prisma/
    └── schema.prisma                      # MODIFY - SmartReplyDraftStatus enum + fields

# Frontend (React + Vite admin dashboard)
admin-dashboard/src/
├── components/
│   └── bdr/
│       └── SmartReplyDraft.tsx             # NEW - draft review panel component
├── pages/
│   ├── bdr/
│   │   └── unibox.tsx                     # MODIFY - integrate SmartReplyDraft panel
│   └── contact-detail.tsx                 # NEW - personality visualization page
├── services/
│   ├── bdr-unibox.ts                      # MODIFY - add draft types + API functions
│   └── contact-detail.ts                  # NEW - contact detail API service
└── router.tsx                             # MODIFY - add contact detail route
```

**Structure Decision**: Extends existing web application structure. Backend in `src/`, frontend in `admin-dashboard/src/`. No new projects or directories at root level.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|-----------|--------------------------------------|
| Plugin bypass (Constitution II) | Smart reply is deeply integrated into webhook pipeline, queue system, and UniBox UI - all core infrastructure | Plugin isolation would require event bus hooks for webhook->queue->AI->DB flow, adding latency and complexity without modularity benefit |
