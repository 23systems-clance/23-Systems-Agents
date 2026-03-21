# Implementation Plan: BDR Onboarding Agent

**Branch**: `7-bdr-onboarding-agent` | **Date**: 2026-03-08 | **Spec**: `specs/7-bdr-onboarding-agent/spec.md`
**Input**: Feature specification from `/specs/7-bdr-onboarding-agent/spec.md`

## Summary

Automated BDR onboarding system that delivers structured 2-4 week training programs via daily Slack DMs. Includes a drip builder and automation builder in the admin dashboard for creating onboarding plans with training videos, quizzes, practice tasks, resource links, and certification/reimbursement instructions. Tracks completion progress, supports a supervised campaign phase, and graduates BDRs to active campaign work via the existing BDR Manager Agent (Feature 6).

## Technical Context

**Language/Version**: TypeScript 5.x (strict mode, ESM with `.js` extensions in imports)
**Primary Dependencies**: @slack/bolt 4.6.0 (Socket Mode), Express 5.2.1, BullMQ 5.70.1, Prisma 7.4.2, React 19 + Vite (admin dashboard)
**Storage**: PostgreSQL via Prisma ORM (AWS RDS), AWS ElastiCache Redis (BullMQ + caching), AWS S3 (file storage)
**Testing**: Manual testing via deployed AWS ECS service (no local dev — Constitution XV)
**Target Platform**: ECS Fargate (prod-slack-list-processor cluster), admin dashboard served as static SPA
**Project Type**: Web application (Node.js backend + React frontend)
**Performance Goals**: Daily DMs delivered within 5-minute window of configured time (SC-002), 20 concurrent enrollments (SC-007)
**Constraints**: Single Socket Mode connection (no local dev), weekday-only delivery, spaced learning (one module per business day)
**Scale/Scope**: 20 concurrent onboarding enrollments, 2-4 week plans (10-20 modules each), 7 training item types, 4 automation types

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

| Principle | Status | Notes |
|-----------|--------|-------|
| I. CRM-First Architecture | PASS | Onboarding extends the BDR entity within the existing CRM workflow. BDRs graduate into Campaigns. |
| II. Plugin Ecosystem | N/A | This is a core feature extending BDR management, not a plugin. Justified: onboarding is tightly coupled to BDR lifecycle and campaign handoff. |
| III. API-First Development | PASS | All onboarding operations exposed via REST API before any UI. Contracts defined in this plan. |
| IV. Client Isolation | PASS | OnboardingPlans and Enrollments are workspace-scoped via slackTeamId. |
| V. SOC 2 Audit Logging | PASS | All onboarding actions (enrollment, completion, graduation) logged via existing auditLogger. |
| VI. Cost Tracking | N/A | Onboarding uses Slack DMs (no paid API calls beyond existing Slack usage). No incremental cost tracking needed. |
| VII. Deviation Prevention | PASS | Feature aligns with existing BDR management patterns. |
| VIII. Integration-Centric | PASS | Leverages existing Slack integration for DM delivery. Graduation hands off to Feature 6 campaign system. |
| IX. Sequence-Driven | PASS | Onboarding plans are essentially sequences of daily modules with progression logic. |
| X. Enrichment as Foundation | N/A | Onboarding does not involve data enrichment. |
| XI. Context-First | PASS | Full codebase exploration completed. Feature builds on existing BDR, campaign, and daily DM patterns. |
| XII. Holistic Awareness | PASS | Integration points mapped: Bdr model, campaign assignment (supervised phase), daily DM system, admin dashboard. |
| XIII. Confirmation-Required | PASS | Plan presented for review before implementation. |
| XIV. UI/UX First | PASS | Drip builder and progress dashboard designed for manager usability. |
| XV. AWS-Only Infrastructure | PASS | All deployment via ECS Fargate. No local dev. |
| XIX. GitHub Account Policy | PASS | All git operations use `developerlabsai` account. |

## Project Structure

### Documentation (this feature)

```text
specs/7-bdr-onboarding-agent/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   ├── onboarding-plans.md
│   ├── onboarding-enrollments.md
│   ├── onboarding-progress.md
│   └── content-library.md
└── tasks.md             # Phase 2 output (/speckit.tasks)
```

### Source Code (new files for this feature)

```text
# Backend — New Services
src/services/onboarding/
├── planService.ts           # CRUD for OnboardingPlan, versioning, duplication
├── moduleService.ts         # Module management within plans
├── enrollmentService.ts     # Enroll BDR, lifecycle transitions
├── deliveryService.ts       # Daily module DM delivery via Slack
├── progressService.ts       # Module completion, quiz scoring, progress %
├── automationService.ts     # Check-in, reminder, weekly summary scheduling
├── graduationService.ts     # Graduation review, handoff to Feature 6
└── contentLibraryService.ts # Shared content library CRUD

# Backend — New Routes (Admin API)
src/routes/admin/
├── onboardingPlans.ts       # GET/POST/PUT/DELETE plans
├── onboardingEnrollments.ts # GET/POST/PUT enrollments
├── onboardingProgress.ts    # GET progress, POST completion
└── contentLibrary.ts        # GET/POST/PUT/DELETE library items

# Backend — BDR Routes (Slack-facing)
src/routes/bdr/
└── onboarding.ts            # BDR-facing: mark complete, quiz submit, check-in respond

# Backend — Queue Worker
src/services/queue/workers/
└── onboardingWorker.ts      # BullMQ worker for daily delivery, automation triggers

# Slack Interactions
src/listeners/actions/
├── onboardingComplete.ts    # Handle "Mark Complete" button clicks
├── onboardingQuiz.ts        # Handle quiz answer submissions
├── onboardingCheckin.ts     # Handle check-in responses
└── graduationReview.ts      # Handle manager graduation approve/extend/reject

# Frontend — Admin Dashboard Pages
admin-dashboard/src/pages/
├── onboarding-plans.tsx     # Plan list + drip builder
├── onboarding-plan-detail.tsx # Drip builder / editor for single plan
├── onboarding-enrollments.tsx # Enrollment list + management
├── onboarding-progress.tsx  # BDR progress dashboard
└── content-library.tsx      # Content library manager

# Frontend — Admin Dashboard Services
admin-dashboard/src/services/
├── onboarding-plans.ts      # API client for plans
├── onboarding-enrollments.ts # API client for enrollments
├── onboarding-progress.ts   # API client for progress
└── content-library.ts       # API client for library
```

### Existing Files to Modify

```text
# Database
prisma/schema.prisma         # Add 7 new models (OnboardingPlan, OnboardingModule, etc.)

# Queue Registration
src/services/queue/queues.ts # Add onboardingQueue + repeatable jobs

# Route Mounting
src/routes/admin/index.ts    # Mount onboarding admin routes
src/routes/bdr/index.ts      # Mount BDR onboarding routes
src/server.ts                # (if new top-level route needed)

# Slack Listeners
src/app.ts                   # Register onboarding action listeners

# Admin Dashboard
admin-dashboard/src/router.tsx              # Add onboarding page routes
admin-dashboard/src/components/layout/AppSidebar.tsx  # Add sidebar nav items
admin-dashboard/src/lib/query-keys.ts       # Add onboarding query keys
admin-dashboard/src/types/api.ts            # Add onboarding TypeScript types

# Infrastructure
infra/cloudformation.yaml    # Add onboarding-specific env vars (if any)
infra/deploy.sh              # Update deploy script (if any new env vars)
```

**Structure Decision**: Follows existing project patterns — services in `src/services/onboarding/`, admin routes in `src/routes/admin/`, BDR routes in `src/routes/bdr/`, Slack listeners in `src/listeners/actions/`, frontend pages in `admin-dashboard/src/pages/`. BullMQ worker follows the campaignDispatcher pattern with job-name-based routing.

## Complexity Tracking

No constitution violations detected. The feature:
- Extends the existing BDR entity (not a new tenant concept)
- Follows established daily DM delivery patterns from Feature 6
- Uses existing auth (admin for dashboard, bdrAuth for BDR-facing)
- Deploys on existing ECS infrastructure
- No new external API integrations (Slack DMs already in use)
