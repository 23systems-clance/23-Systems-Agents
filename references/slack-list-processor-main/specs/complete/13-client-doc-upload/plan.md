# Implementation Plan: Client Config Document Upload via Dashboard

**Branch**: `13-client-doc-upload` | **Date**: 2026-03-10 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/13-client-doc-upload/spec.md`

## Summary

Add a `/upload` Slack slash command that responds with an ephemeral message containing a secure, time-limited link to the admin dashboard. The dashboard page lets users upload, preview, rename, download, and delete config documents (ICP, Use Cases, Campaigns, Settings) for their channel. Uploaded files are converted to Markdown server-side and stored in the database; originals are retained in S3 for download. Auto-generated display labels summarize content. If a ManagedClient is linked to the channel via an explicit admin-configured mapping, the client name is shown on the upload page.

## Technical Context

**Language/Version**: TypeScript 5.x (Node.js backend, React frontend)
**Primary Dependencies**:
- Backend: @slack/bolt 4.6.0 (Socket Mode), Express 4.x, BullMQ, Prisma ORM
- Frontend: React 18 + React Router 7, Vite, shadcn/ui, TanStack React Query, axios
**Storage**: PostgreSQL (RDS) for data, Redis (ElastiCache) for state, S3 for file storage
**Testing**: Manual against deployed AWS ECS service (no local testing)
**Target Platform**: Web (Slack bot + SPA admin dashboard on CloudFront)
**Project Type**: Web application (backend ECS + frontend CloudFront+S3)
**Performance Goals**: Upload page loads <3s, upload completes <30s, token validation <1s
**Constraints**: Single Socket Mode connection (ECS only), 10MB file size limit, 24h token expiry
**Scale/Scope**: 4 doc types per channel, moderate usage (tens of channels, not thousands)

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

| Principle | Status | Notes |
|-----------|--------|-------|
| I. CRM-First | PASS | Config docs support enrichment/analysis workflow |
| II. Plugin Ecosystem | N/A | This is a core feature, not a plugin |
| III. API-First | PASS | API contracts defined before UI; dashboard consumes REST API |
| IV. Client Isolation | PASS | Docs scoped by teamId+channelId; token prevents cross-channel access |
| V. SOC 2 Audit Logging | PASS | All uploads, deletes, and label changes logged with actor context |
| VI. Cost Tracking | PASS | AI label generation uses Claude API — cost tracked per call |
| VII. Deviation Prevention | PASS | No deviations from constitution |
| VIII. Integration-Centric | PASS | Integrates Slack commands with dashboard UI |
| IX. Sequence-Driven | N/A | Not a campaign/sequence feature |
| X. Enrichment Foundation | PASS | Config docs feed into /analyze enrichment reports |
| XI. Context-First | PASS | Existing codebase thoroughly researched |
| XII. Holistic System Awareness | PASS | Impacts /analyze (reads config docs), dashboard (new page), Slack (new command) |
| XIII. Confirmation-Required | PASS | Delete requires confirmation dialog |
| XIV. UI/UX First | PASS | Simple 4-slot upload page with clear status indicators |
| XV. AWS-Only | PASS | ECS backend, CloudFront frontend, S3 file storage, RDS database |
| XIX. GitHub Account | PASS | Using developerlabsai account |

## Project Structure

### Documentation (this feature)

```text
specs/13-client-doc-upload/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   └── api-contracts.md
└── tasks.md             # Phase 2 output (/speckit.tasks)
```

### Source Code (repository root)

```text
# Backend (ECS Fargate)
src/
├── listeners/commands/
│   └── upload.ts                    # NEW: /upload slash command handler
├── routes/
│   └── upload/
│       └── index.ts                 # NEW: Upload API routes (token validation, CRUD, file upload)
├── services/
│   ├── analyze/
│   │   └── configDocService.ts      # MODIFIED: Add S3 key, display label, original filename fields
│   └── upload/
│       └── tokenService.ts          # NEW: JWT token generation/validation for upload links
├── lib/
│   └── uploadAuth.ts                # NEW: Upload token auth middleware for Express routes

# Frontend (CloudFront + S3)
admin-dashboard/src/
├── pages/
│   └── upload.tsx                   # NEW: Config document upload page
├── services/
│   └── upload.ts                    # NEW: API client for upload endpoints
├── lib/
│   └── query-keys.ts               # MODIFIED: Add upload query keys
└── router.tsx                       # MODIFIED: Add /upload/:token route (public, no admin auth)

# Database
prisma/
└── schema.prisma                    # MODIFIED: Add fields to ChannelConfigDoc, add ChannelClientMapping model
```

**Structure Decision**: Web application pattern — backend Express API routes consumed by React SPA frontend. The upload page is a public route (token-authorized, not session-authorized) in the existing admin dashboard app.

## Complexity Tracking

No constitution violations. No complexity justifications needed.
