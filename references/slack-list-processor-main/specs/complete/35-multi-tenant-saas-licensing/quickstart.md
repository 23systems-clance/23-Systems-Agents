# Quickstart: Multi-Tenant SaaS Licensing

**Branch**: `35-multi-tenant-saas-licensing` | **Date**: 2026-03-18
**Phase**: 1 — Design & Contracts

---

## Prerequisites

- Existing codebase on branch `35-multi-tenant-saas-licensing`
- AWS infrastructure running (ECS, RDS, ElastiCache, S3, CloudFront)
- Stripe account with API keys configured
- Resend account with verified sending domain
- Access to Slack app configuration at api.slack.com

## Implementation Order

The implementation follows a dependency chain. Each phase builds on the previous.

### Phase A: Foundation (no UI, backend only)

1. **Prisma schema migration** — Add new models (`LicenseKey`, `CreditPack`, `EnrichmentChannel`, `AnalysisChannel`) and extend existing models (`WorkspaceInstallation`, `BillingProfile`, `CreditTransaction`). Run migration against RDS.

2. **Platform owner auto-detection** — Add `PLATFORM_OWNER_TEAM_ID` env var. Create `src/services/workspace/platformOwner.ts` that checks workspace type on every `authorize()` call. Platform owner gets all feature flags enabled, billing exempt.

3. **Feature flag system** — Create `src/services/featureToggle/` with flag definitions, defaults, and workspace resolution. Extend `authorize.ts` to inject `context.featureFlags`. Create `requireFeature()` Bolt middleware.

4. **License key service** — Create `src/services/licensing/` with key generation (`SLKP-XXXX-XXXX-XXXX-XXXX`), validation, and activation logic.

### Phase B: Onboarding & Core UX

5. **OAuth scope update** — Add `channels:read` and `groups:read` to `REQUIRED_SCOPES` in `src/routes/oauth/install.ts`.

6. **Client onboarding wizard** — Create `src/services/workspace/onboardingWizard.ts` with state machine (PENDING → LICENSE_KEY → BILLING → CHANNELS → COMPLETE). Create `src/listeners/events/appHomeOpened.ts` for App Home rendering. Create `src/listeners/actions/onboardingWizard.ts` for step interactions.

7. **Credit cost preview** — Create `src/services/enrichment/creditPreview.ts` using existing `costCalculator.ts`. Create `src/listeners/actions/creditPreview.ts` for confirm/cancel/go-back buttons. Modify existing enrichment flow to insert preview step.

8. **Enrichment cancellation** — Create `src/services/enrichment/cancellation.ts` for pre-start and in-progress job cancellation with pro-rated credit adjustments.

### Phase C: Sharing & Channels

9. **Send Copy To** — Create `src/services/sendCopyTo/` with email (Resend) and Slack channel delivery. Create `src/listeners/actions/sendCopyTo.ts` for modal and delivery actions.

10. **Private enrichment channels** — Create `src/listeners/actions/channelRegistration.ts` for per-user private channel registration. Modify file detection to check `EnrichmentChannel` assignment before triggering enrichment.

11. **Channel listing (public + private)** — Implement `conversations.list({ types: 'public_channel,private_channel' })` with 5-minute cache per workspace.

### Phase D: Platform Owner Dashboard

12. **License key management UI** — Create admin API endpoints (`src/routes/admin/licensing.ts`) and admin dashboard page (`admin-dashboard/src/pages/licensing.tsx`).

13. **Workspace management UI** — Create admin API endpoints (`src/routes/admin/workspaceManagement.ts`) and dashboard page with feature toggle panel.

14. **Credit pack management** — Create admin API endpoints (`src/routes/admin/creditPacks.ts`) and dashboard page. Add Stripe webhook handler for `checkout.session.completed`.

### Phase E: Client Dashboard

15. **Client authentication** — Create `src/routes/client/auth.ts` with Slack OAuth login flow. Create `src/lib/clientAuth.ts` middleware. Add client routes to Express server.

16. **Client dashboard pages** — Create React pages in `admin-dashboard/src/pages/client/` for overview, billing, enrichment history, channels, and settings.

17. **Credit pack purchase flow** — Create Stripe Checkout session endpoint for clients. Wire up webhook for credit fulfillment.

### Phase F: Analysis & Optional Features

18. **ICP document processing** — Create `src/services/analyze/icpDocumentProcessor.ts` for extracting and storing ICP context. Create `AnalysisChannel` registration flow.

19. **Analysis report generation** — Extend `reportGenerator.ts` to incorporate workspace ICP context (definition, use cases, case studies) when generating reports.

20. **On-demand personality analysis** — Add "Analyze Personality" button to enrichment results (gated by `personalityAnalysis` feature flag). Uses existing AIARC integration.

21. **On-demand company intelligence** — Add "View Job Postings & News" button to enrichment results (gated by `icpAnalysis` feature flag). Uses existing Apollo integration.

## Key Files to Modify (Existing)

| File | Change |
|------|--------|
| `src/routes/oauth/install.ts` | Add `channels:read`, `groups:read` to scopes |
| `src/services/workspace/authorize.ts` | Inject feature flags into Bolt context |
| `src/services/billing/creditManager.ts` | Add `addCredits()` method for credit packs |
| `src/routes/admin/index.ts` | Mount new admin routes (licensing, feature toggles, workspace mgmt) |
| `src/routes/admin/stripeWebhook.ts` | Add credit pack purchase webhook handler |
| `src/server.ts` | Mount `/api/v1/client` router |
| `src/config/index.ts` | Add `platformOwnerTeamId`, `resend.fromEmail` config |
| `prisma/schema.prisma` | Add new models, extend existing models |
| `src/listeners/events/fileShared.ts` | Check enrichment channel assignment before triggering |
| `admin-dashboard/src/router.tsx` | Add new admin pages + client route tree |

## Environment Variables (New)

| Variable | Description | Example |
|----------|-------------|---------|
| `PLATFORM_OWNER_TEAM_ID` | Slack team ID for the platform owner workspace | `T01234567` |
| `RESEND_FROM_EMAIL` | Verified sender email for "Send Copy To" | `noreply@enrichbot.io` |
| `CLIENT_DASHBOARD_URL` | Base URL for client dashboard | `https://dt9zhghz3mtx8.cloudfront.net/client` |
| `SLACK_CLIENT_ID` | Slack app client ID (for client OAuth) | (already exists as `SLACK_CLIENT_ID` in OAuth config) |
| `SLACK_CLIENT_SECRET` | Slack app client secret (for client OAuth) | (already exists) |

## Verification Checklist

- [ ] Platform owner workspace auto-detected and all features enabled
- [ ] License key generated, validated, and single-use enforced
- [ ] Client onboarding flow completes: install → license → billing → channels → enrich
- [ ] Feature toggle changes take effect within 60 seconds
- [ ] Credit cost preview shown before enrichment
- [ ] Cancel/go back works at every enrichment step
- [ ] Send Copy To delivers via email and Slack channel
- [ ] Private enrichment channels registered and enforced per-user
- [ ] Client dashboard shows workspace-scoped data only (no cross-tenant leakage)
- [ ] Credit pack purchase adds credits immediately
- [ ] ICP analysis reports incorporate workspace context
- [ ] Personality analysis and company intelligence work as standalone on-demand actions
