# Implementation Plan: Multi-Tenant SaaS Licensing

**Branch**: `35-multi-tenant-saas-licensing` | **Date**: 2026-03-18 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/35-multi-tenant-saas-licensing/spec.md`

## Summary

Convert the internal Slack List Processor into a licensable multi-tenant SaaS product. The system keeps a single Slack app with per-workspace feature toggles controlled by the platform owner. New capabilities: license key activation, client onboarding wizard (billing -> channels -> enrich), credit cost preview with cancellation, "Send Copy To" (email/Slack), per-user private enrichment channels, ICP analysis channel with report generation, client-facing dashboard, and optional on-demand features (AIARC personality analysis, Apollo company intelligence). The existing billing, enrichment, and workspace systems are extended rather than replaced.

## Technical Context

**Language/Version**: TypeScript 5.x (existing codebase)
**Primary Dependencies**: @slack/bolt 4.6.0, Express 5.x, Prisma 7.x, BullMQ 5.x, Stripe 20.x, Resend 6.x, ioredis 5.x, @anthropic-ai/sdk 0.78.0
**Storage**: PostgreSQL (AWS RDS) via Prisma ORM + Redis (AWS ElastiCache)
**Testing**: Integration testing against deployed ECS service (no local development — Constitution XV)
**Target Platform**: AWS ECS Fargate (backend) + CloudFront/S3 (frontend dashboards)
**Project Type**: Web (Slack bot backend + React/Vite frontend dashboard)
**Performance Goals**: <10min client onboarding (SC-001), <60s feature toggle propagation (SC-004), <3s client dashboard load (SC-006), 50+ concurrent workspaces (SC-009)
**Constraints**: Single Socket Mode connection, AWS-only infrastructure, no local development/testing
**Scale/Scope**: 50+ client workspaces, 5,000 row max per enrichment job, permanent job history

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

| # | Principle | Status | Notes |
|---|-----------|--------|-------|
| I | CRM-First Architecture | N/A | Slack List Processor is an enrichment platform, not the BDR CRM. Enrichment data feeds into CRMs but this app is standalone. |
| II | Plugin Ecosystem | PARTIAL | Feature toggles per workspace function as a simplified plugin activation system. Full plugin manifest architecture is not required — feature flags on `WorkspaceInstallation.settings` are sufficient for module enable/disable. |
| III | API-First Development | PASS | API contracts defined in `/contracts/` before any UI implementation. Client dashboard and admin dashboard consume REST APIs. |
| IV | Client Isolation (Multi-Tenancy) | PASS | Core to this feature. All data scoped by `slackTeamId`. Client dashboard enforces workspace-level data isolation. No cross-workspace data leakage. |
| V | SOC 2 & Full Audit Logging | PASS | License key operations, feature toggle changes, credit adjustments, and onboarding events all logged to `AuditLog`. Immutable append-only trail. |
| VI | Cost Tracking & Financial Model | PASS | Existing credit system extended with credit packs and subscription tiers. All enrichment costs attributed to workspace. |
| VII | Deviation Prevention | PASS | This plan checks against constitution. Feature toggles prevent unfinished features from reaching clients. |
| VIII | Integration-Centric Design | PASS | Leverages existing integrations (Apollo, BuiltWith, AIARC, Stripe, Resend). No new external service dependencies. |
| IX | Sequence-Driven Workflows | N/A | Campaigns/sequences are toggled off for client MVP. Existing campaign system unchanged. |
| X | Enrichment as Foundation | PASS | Enrichment is the primary licensed feature. Credit preview and cancellation enhance the enrichment workflow. |
| XI | Context-First Decision Making | PASS | Full codebase analysis performed. Spec clarified via 5 Q&A sessions. Research phase validates decisions. |
| XII | Holistic System Awareness | PASS | Impact analysis: changes touch workspace installation, billing, enrichment listeners, admin dashboard, OAuth scopes. All connections mapped. |
| XIII | Confirmation-Required Workflow | PASS | Spec → Clarify → Plan → Tasks workflow followed. User approval at each gate. |
| XIV | UI/UX First Design | PASS | Client onboarding uses Slack-native UX (App Home, DMs, Block Kit). Client dashboard uses existing admin-dashboard patterns. |
| XV | AWS-Only Infrastructure | PASS | All infrastructure remains on AWS (ECS, RDS, ElastiCache, S3, CloudFront). No local development. |
| XVI | Developer Navigation Index | N/A | Applies to Next.js projects. Slack bot uses Express routes — already documented in admin dashboard. |
| XVII | MCP-First Research | PASS | Research completed on Slack scopes, feature toggle patterns, Stripe Checkout, license key generation, Resend attachments, App Home onboarding. |
| XVIII | (continued XVI) | N/A | See XVI. |
| XIX | GitHub Account Policy | PASS | All operations use `developerlabsai` account. |

**Gate Result**: PASS — No blocking violations. Principle II (Plugin Ecosystem) is a known acceptable deviation: the Slack bot uses workspace-level feature flags rather than the full plugin manifest pattern, which is appropriate for this runtime (Slack bot) vs. a web app with UI component injection.

## Project Structure

### Documentation (this feature)

```text
specs/35-multi-tenant-saas-licensing/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   ├── licensing-api.yaml
│   ├── client-dashboard-api.yaml
│   ├── feature-toggle-api.yaml
│   └── credit-pack-api.yaml
└── tasks.md             # Phase 2 output (/speckit.tasks)
```

### Source Code (repository root)

```text
src/
├── services/
│   ├── licensing/                  # NEW: License key CRUD & validation
│   │   ├── keyGenerator.ts         # Cryptographic key generation (SLKP-XXXX-XXXX-XXXX-XXXX)
│   │   ├── keyValidator.ts         # Key validation, single-use enforcement
│   │   └── licenseManager.ts       # Create/revoke/list license keys
│   ├── featureToggle/              # NEW: Per-workspace feature flag system
│   │   ├── featureFlags.ts         # Flag definitions, defaults, workspace resolution
│   │   └── featureGate.ts          # Bolt middleware for command/action gating
│   ├── billing/                    # EXTEND (existing)
│   │   ├── creditManager.ts        # EXTEND: Credit pack top-ups
│   │   ├── creditPackService.ts    # NEW: Credit pack definitions & purchase flow
│   │   └── subscriptionService.ts  # NEW: Subscription tier management
│   ├── workspace/                  # EXTEND (existing)
│   │   ├── onboardingWizard.ts     # NEW: Client onboarding state machine
│   │   ├── platformOwner.ts        # NEW: Platform owner auto-detection
│   │   └── authorize.ts            # EXTEND: Add feature flags to context
│   ├── enrichment/                 # EXTEND (existing)
│   │   ├── creditPreview.ts        # NEW: Pre-enrichment cost estimation
│   │   └── cancellation.ts         # NEW: Job cancellation with pro-rated credits
│   ├── sendCopyTo/                 # NEW: Result sharing
│   │   ├── emailSender.ts          # Resend-based email delivery with attachments
│   │   └── slackChannelSender.ts   # Cross-channel file sharing
│   └── analyze/                    # EXTEND (existing)
│       └── icpDocumentProcessor.ts # NEW: ICP document extraction & storage
├── listeners/
│   ├── actions/
│   │   ├── onboardingWizard.ts     # NEW: Onboarding step interactions
│   │   ├── creditPreview.ts        # NEW: Credit preview confirm/cancel/go-back
│   │   ├── sendCopyTo.ts           # NEW: Send copy to modal & delivery
│   │   ├── channelRegistration.ts  # NEW: Private enrichment channel registration
│   │   └── creditPackPurchase.ts   # NEW: In-Slack credit pack purchase
│   └── events/
│       └── appHomeOpened.ts        # NEW: App Home onboarding/dashboard view
├── routes/
│   ├── admin/                      # EXTEND (existing)
│   │   ├── licensing.ts            # NEW: License key management endpoints
│   │   ├── featureToggles.ts       # NEW: Feature toggle CRUD endpoints
│   │   └── workspaceManagement.ts  # NEW: Workspace overview with toggles
│   └── client/                     # NEW: Client dashboard API
│       ├── index.ts                # Client API router
│       ├── auth.ts                 # Slack OAuth client authentication
│       ├── billing.ts              # Client billing & credit pack purchase
│       ├── usage.ts                # Usage stats & enrichment history
│       ├── channels.ts             # Channel management for client admins
│       └── settings.ts             # Workspace settings for client admins
├── lib/
│   └── clientAuth.ts               # NEW: Client dashboard Slack OAuth middleware
└── types/
    ├── licensing.ts                # NEW: License key types
    └── featureFlags.ts             # NEW: Feature flag type definitions

admin-dashboard/src/
├── pages/
│   ├── licensing.tsx               # NEW: License key management page
│   ├── workspace-management.tsx    # NEW: Multi-workspace overview
│   └── feature-toggles.tsx         # NEW: Per-workspace feature toggle editor
│
│   # Client Dashboard (separate route tree, same app)
│   ├── client/
│   │   ├── login.tsx               # Slack OAuth login for clients
│   │   ├── overview.tsx            # Client credit balance & stats
│   │   ├── billing.tsx             # Billing management & credit packs
│   │   ├── enrichment-history.tsx  # Job history for workspace
│   │   ├── channels.tsx            # Enrichment channel management
│   │   └── settings.tsx            # Workspace preferences
├── services/
│   ├── licensing-api.ts            # NEW: License key API client
│   ├── feature-toggles-api.ts      # NEW: Feature toggle API client
│   ├── workspace-management-api.ts # NEW: Workspace management API client
│   └── client-api.ts               # NEW: Client dashboard API client
└── components/
    ├── FeatureTogglePanel.tsx       # NEW: Feature flag toggle grid
    ├── LicenseKeyTable.tsx          # NEW: License key list with actions
    ├── WorkspaceCard.tsx            # NEW: Workspace summary card
    ├── CreditPreviewCard.tsx        # NEW: Credit balance display
    └── OnboardingStatusBadge.tsx    # NEW: Onboarding progress indicator
```

**Structure Decision**: Extends the existing single-project structure. The client dashboard is hosted within the same admin-dashboard React app with a separate `/client/*` route tree and distinct authentication (Slack OAuth vs. admin session). This avoids a second CloudFront distribution while maintaining strict client/admin separation via route-level auth guards.

## Complexity Tracking

| Deviation | Why Needed | Simpler Alternative Rejected Because |
|-----------|-----------|--------------------------------------|
| Plugin Ecosystem (Principle II) simplified to feature flags | Slack bot runtime doesn't support UI component injection or route registration patterns. Per-workspace JSON flags on `WorkspaceInstallation.settings` provide the same enable/disable capability. | Full plugin manifest with lifecycle hooks is over-engineered for binary feature toggles. |
| Client dashboard in same app as admin dashboard | Avoids second CloudFront/S3 deployment, second build pipeline, and duplicated component library. | Separate app would require duplicating auth, routing, UI components, and deployment infrastructure for a simpler feature set. |
| New OAuth scopes required | Must add `channels:read` and `groups:read` to list both public and private channels. Existing installs need scope re-authorization. | Cannot list private channels without `groups:read`. No alternative API available. |
| UI/UX review (Principle XIV) skipped | Onboarding uses Slack-native Block Kit patterns; client dashboard follows existing admin-dashboard conventions. No custom design work needed. | Running a formal UX review would add overhead without design divergence from established Slack and admin-dashboard patterns. |
