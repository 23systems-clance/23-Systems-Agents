# Implementation Plan: Campaign Management Enhancements

**Branch**: `8-campaign-management` | **Date**: 2026-03-09 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/8-campaign-management/spec.md`

## Summary

Complete the campaign management system by adding: edit UI with BDR assignment, client organization with filtering, delete/archive campaigns, contact quality stats (email/phone/linkedin/multi-channel breakdown), external campaign linking via Instantly/HeyReach APIs, and DNC-aware contact import. No schema migrations needed - all changes use existing Prisma models.

## Technical Context

**Language/Version**: TypeScript 5.x (Node.js backend + React frontend)
**Primary Dependencies**: Express 4.x (backend), React 18 + Vite (admin-dashboard), @tanstack/react-query, shadcn/ui, Prisma ORM
**Storage**: PostgreSQL via Prisma (AWS RDS), Redis (AWS ElastiCache) for BullMQ
**Testing**: Manual testing via deployed ECS service (no local dev server)
**Target Platform**: Web (SPA admin dashboard) + ECS Fargate backend
**Project Type**: Web application (backend + frontend)
**Performance Goals**: All operations < 3 seconds (SC-007)
**Constraints**: Single Socket Mode connection (ECS only), no local server
**Scale/Scope**: Admin tool, ~10 concurrent users max

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

| Principle | Status | Notes |
| --------- | ------ | ----- |
| I. CRM-First | PASS | Campaigns are core CRM entities |
| III. API-First | PASS | All endpoints designed before UI (contracts/campaign-api.md) |
| IV. Client Isolation | PASS | Campaigns scoped by slackTeamId + clientId |
| V. SOC 2 Audit Logging | PASS | Delete/archive operations will be logged |
| VI. Cost Tracking | N/A | No new paid API calls beyond existing Instantly/HeyReach |
| VIII. Integration-Centric | PASS | Leverages existing Instantly/HeyReach clients |
| XIII. Confirmation-Required | PASS | Delete/archive use confirmation dialogs |
| XIV. UI/UX First | PASS | Follows existing BDR/Client management patterns |
| XV. AWS-Only | PASS | All testing via deployed ECS, no local dev |
| XIX. GitHub Account | PASS | Using developerlabsai account |

**Post-Design Re-check**: All gates still pass. No schema changes needed, no new infrastructure.

## Project Structure

### Documentation (this feature)

```text
specs/8-campaign-management/
├── plan.md              # This file
├── spec.md              # Feature specification
├── research.md          # Phase 0 research
├── data-model.md        # Data model documentation
├── quickstart.md        # Implementation quickstart
├── contracts/           # API contracts
│   └── campaign-api.md
├── checklists/
│   └── requirements.md
└── tasks.md             # Phase 2 output (/speckit.tasks)
```

### Source Code (repository root)

```text
src/
├── routes/admin/
│   ├── campaigns.ts              # MODIFY: add DELETE, client filter, quality stats, validation errors
│   └── clientManagement.ts       # MODIFY: add external campaign listing endpoint
├── services/
│   ├── campaign/
│   │   ├── campaignService.ts    # MODIFY: add delete/archive, update activation validation
│   │   ├── contactImport.ts      # MODIFY: add DNC check to canCall logic
│   │   ├── statsAggregator.ts    # MODIFY: add getContactQualityStats()
│   │   └── types.ts              # MODIFY: add ContactQualityStats type
│   ├── instantly/
│   │   ├── instantlyClient.ts    # MODIFY: add listCampaigns(apiKey)
│   │   └── types.ts              # MODIFY: add InstantlyCampaignListItem
│   └── heyreach/
│       ├── heyreachClient.ts     # MODIFY: add listCampaigns(apiKey)
│       └── types.ts              # MODIFY: add HeyReachCampaignListItem
└── lib/
    └── clientApiService.ts       # NEW: decrypt client API keys for per-client calls

admin-dashboard/src/
├── services/
│   └── campaigns.ts              # MODIFY: add delete, archive, quality, external campaigns
├── pages/
│   ├── campaigns.tsx             # MODIFY: add client filter
│   ├── campaign-detail.tsx       # MODIFY: add edit/delete/archive buttons, quality card, client display
│   └── campaign-create.tsx       # MODIFY: add BDR multi-select, client dropdown
└── components/campaigns/
    └── CampaignEditDialog.tsx    # NEW: edit dialog with BDR/client/external campaign linking
```

**Structure Decision**: Follows existing web application pattern with backend (`src/`) and frontend (`admin-dashboard/src/`). All modifications extend existing files. Only 2 new files created.

## Complexity Tracking

No constitution violations requiring complexity tracking. UI/UX review (/speckit.ux) deferred - feature follows existing Dialog/AlertDialog patterns from managed-bdrs.tsx and managed-clients.tsx, no novel UI paradigms introduced.
