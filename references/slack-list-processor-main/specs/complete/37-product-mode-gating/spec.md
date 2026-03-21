# Feature Specification: Product Mode Feature Gating

**Feature Branch**: `37-product-mode-gating`
**Created**: 2026-03-18
**Status**: Draft
**Input**: User description: "Strip the Slack List Processor to core enrichment using a PRODUCT_MODE=enrichment environment variable that gates all non-enrichment features behind feature flags. No code deletion — conditional route mounting, conditional worker registration, and admin dashboard page hiding. This is Step 1 of the Virality Playbook (PB-VR-2026)."

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Deploy Enrichment-Only Product (Priority: P1)

An operator deploys the application with `PRODUCT_MODE=enrichment`. The system starts up with only the core enrichment pipeline, billing, CRM integration, file processing, and admin management features active. All non-enrichment capabilities (Power Dialer, Campaign Management, Workflow Builder, BDR Management, Smart Reply, Salesfloor, Recording Library, Onboarding) are completely hidden and inaccessible — no routes respond, no workers consume jobs, and no dashboard pages render.

**Why this priority**: This is the entire purpose of the feature. Without this working correctly, the enrichment-only product cannot be shipped to the Slack App Directory or offered as a standalone tool. It is the foundation of the Virality Playbook.

**Independent Test**: Deploy with `PRODUCT_MODE=enrichment`, attempt to access any gated route (e.g., `/api/v1/dialer`, `/api/v1/campaigns`, `/api/v1/bdr`) — all return 404. Verify enrichment upload-to-export flow works end to end.

**Acceptance Scenarios**:

1. **Given** PRODUCT_MODE is set to `enrichment`, **When** the application starts, **Then** only enrichment-related routes, workers, and dashboard pages are active; gated routes return 404, gated workers do not register, gated dashboard pages do not appear in navigation.
2. **Given** PRODUCT_MODE is set to `enrichment`, **When** a user uploads a CSV and triggers enrichment, **Then** the full enrichment pipeline (technographic classification, email waterfall, phone lookup, file generation, CRM export) executes successfully.
3. **Given** PRODUCT_MODE is set to `enrichment`, **When** a user navigates to the admin dashboard, **Then** only enrichment-relevant pages (overview, usage, billing, errors, clients, users, settings, enrichment config, cache metrics, prompt library, provider costs, credit rates, CRM connections, jobs) are visible in the sidebar navigation.

---

### User Story 2 - Full Mode Backward Compatibility (Priority: P1)

An operator deploys the application with `PRODUCT_MODE=full` (or with no PRODUCT_MODE set — defaults to `full`). The system behaves exactly as it does today with all features enabled. No regressions, no behavior changes, no missing routes or workers.

**Why this priority**: Equal to P1 because the existing full-featured deployment must not break. Current customers and internal operations depend on all features working.

**Independent Test**: Deploy with `PRODUCT_MODE=full` (or unset). Run the existing test suite. Verify every route, worker, and dashboard page works identically to pre-gating behavior.

**Acceptance Scenarios**:

1. **Given** PRODUCT_MODE is set to `full`, **When** the application starts, **Then** all routes, workers, and dashboard pages are active — identical behavior to the current production deployment.
2. **Given** PRODUCT_MODE is not set (environment variable absent), **When** the application starts, **Then** the system defaults to `full` mode with all features enabled.
3. **Given** PRODUCT_MODE is set to `full`, **When** any existing API endpoint is called, **Then** the response is identical to pre-gating behavior with no regressions.

---

### User Story 3 - Admin Dashboard Adapts to Product Mode (Priority: P2)

When running in enrichment mode, the admin dashboard sidebar, navigation, and routing only show enrichment-relevant pages. There are no dead links, no hidden-but-accessible pages, and no confusing references to features that don't exist in this mode. The dashboard feels purpose-built for enrichment.

**Why this priority**: The dashboard is the management interface for the product. A cluttered dashboard with broken links or references to unavailable features creates a poor user experience and undermines the "focused enrichment tool" positioning.

**Independent Test**: Load the admin dashboard in enrichment mode. Click every sidebar link — all navigate to functional pages. Search for any gated page URL manually — returns a redirect to overview or a "feature not available" message.

**Acceptance Scenarios**:

1. **Given** the admin dashboard is running in enrichment mode, **When** the sidebar renders, **Then** only the following page groups appear: Overview, Enrichment, Billing, CRM, Cache, Prompts, Users, Settings, Jobs, Errors.
2. **Given** a user manually enters a URL for a gated page (e.g., `/campaigns`, `/workflows`, `/salesfloor`), **When** the page attempts to load, **Then** the user is redirected to the overview page or shown a "feature not available in this product mode" message.
3. **Given** the admin dashboard is running in full mode, **When** the sidebar renders, **Then** all pages appear exactly as they do today — no changes to the full mode experience.

---

### User Story 4 - Gated API Endpoints Return Clear Responses (Priority: P2)

When running in enrichment mode, any API call to a gated endpoint returns a clear, consistent error response indicating the feature is not available in this product mode. This applies to both direct API calls and any Slack bot interactions that would trigger gated features.

**Why this priority**: External integrations and Slack commands should get deterministic, informative errors rather than ambiguous 500s or silently dropped requests.

**Independent Test**: In enrichment mode, call `/api/v1/dialer/sessions` and `/api/v1/campaigns` — both return a structured error with a clear "feature not available" message and the appropriate status code.

**Acceptance Scenarios**:

1. **Given** PRODUCT_MODE is `enrichment`, **When** an API call is made to a gated route, **Then** the system returns a 404 status with a JSON body: `{ "error": "Feature not available in current product mode" }`.
2. **Given** PRODUCT_MODE is `enrichment`, **When** a Slack command or interaction attempts to trigger a gated feature, **Then** the bot responds with a user-friendly message explaining the feature is not available.

---

### User Story 5 - Runtime Mode Inspection (Priority: P3)

An administrator can verify which product mode the application is running in via the admin dashboard and the health check endpoint. This enables quick troubleshooting when features appear missing.

**Why this priority**: Operational visibility. Without this, support and ops teams cannot quickly determine why certain features are unavailable.

**Independent Test**: Hit the health check endpoint — response includes `productMode: "enrichment"` or `productMode: "full"`. Check admin dashboard header/footer — displays current product mode.

**Acceptance Scenarios**:

1. **Given** the application is running in any product mode, **When** the health check endpoint is called, **Then** the response includes the current `productMode` value.
2. **Given** the admin dashboard is loaded, **When** the user views the header or settings page, **Then** the current product mode is displayed.

---

### Edge Cases

- What happens when PRODUCT_MODE is set to an invalid value (e.g., `PRODUCT_MODE=premium`)? System should default to `full` mode and log a warning.
- What happens when a gated worker has jobs already in the queue when switching to enrichment mode? Existing jobs should remain in the queue but not be processed; they resume if mode switches back to `full`.
- What happens when a webhook fires for a gated feature (e.g., Twilio call status) in enrichment mode? The webhook endpoint returns 404; the external service handles retries per its own policy.
- What happens when the admin dashboard frontend is built for one mode but the backend is running a different mode? The dashboard should fetch the current product mode from the API at startup and adapt dynamically.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: System MUST support a `PRODUCT_MODE` configuration with two valid values: `enrichment` and `full`.
- **FR-002**: System MUST default to `full` mode when `PRODUCT_MODE` is not set or is set to an unrecognized value.
- **FR-003**: In `enrichment` mode, the system MUST NOT mount or respond to any gated API routes (38 route files covering: Power Dialer, Campaigns, BDR Management, Workflow triggers, Twilio/Deepgram webhooks, Instantly/HeyReach webhooks, and associated admin endpoints for recordings, salesfloor, onboarding, analytics, reports, contacts, channel mappings, thresholds, dialer config, and content library).
- **FR-004**: In `enrichment` mode, the system MUST NOT register or start any gated background workers (7 workers: campaignDispatcher, onboardingWorker, dialerCallbackWorker, dialerInactivityWorker, recordingProcessingWorker, smartReplyWorker, workflowWorker).
- **FR-005**: In `enrichment` mode, the admin dashboard MUST hide all gated pages from navigation (33 pages covering: active calls, dialer, salesfloor, recordings, campaigns, workflows, BDR management, onboarding, content library, contacts, channel mappings, thresholds, reports, analytics).
- **FR-006**: In `enrichment` mode, the admin dashboard MUST prevent direct URL access to gated pages by redirecting to the overview page or displaying a "feature not available" notice.
- **FR-007**: In `full` mode, the system MUST behave identically to the current production deployment with all features enabled and no regressions.
- **FR-008**: The health check endpoint MUST include the current `productMode` in its response.
- **FR-009**: System MUST NOT delete, remove, or modify any existing code — gating is achieved exclusively through conditional logic (route mounting, worker registration, navigation filtering).
- **FR-010**: Gated API routes MUST return HTTP 404 with a structured JSON error message indicating the feature is unavailable in the current product mode.
- **FR-011**: The admin dashboard MUST fetch the current product mode from the backend API and adapt its navigation and routing accordingly (not hardcoded at build time).

### Key Entities

- **Product Mode**: A system-wide configuration value (`enrichment` | `full`) that determines which features are active. Read once at startup, exposed via health check and admin API.
- **Feature Gate**: A logical grouping of routes, workers, and dashboard pages that are collectively enabled or disabled based on the product mode. Each gated feature maps to one or more route files, worker registrations, and dashboard pages.
- **Gated Route**: An API endpoint that is conditionally mounted based on product mode. When gated, returns 404 with a structured error.
- **Gated Worker**: A background job processor that is conditionally registered based on product mode. When gated, the worker is never started and its queue is not consumed.
- **Gated Dashboard Page**: A frontend page that is conditionally included in navigation and routing based on product mode. When gated, the page is hidden from the sidebar and inaccessible via direct URL.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: Application starts successfully in `enrichment` mode with zero errors related to missing gated dependencies.
- **SC-002**: All 38 gated route files return 404 in enrichment mode — verified by hitting each endpoint.
- **SC-003**: All 7 gated workers do not consume any jobs in enrichment mode — verified by checking worker registration logs.
- **SC-004**: All 33 gated dashboard pages are hidden from navigation and inaccessible in enrichment mode.
- **SC-005**: Full enrichment pipeline (upload → parse → classify → enrich → generate → export → CRM sync) completes successfully in enrichment mode with no functional difference from full mode.
- **SC-006**: Switching from `enrichment` to `full` mode (via redeployment with updated environment variable) restores all features with no data loss or corruption.
- **SC-007**: Application in `full` mode passes all existing functional tests with zero regressions.
- **SC-008**: The admin dashboard adapts to product mode dynamically (no rebuild required to switch modes).

## Assumptions

- The `PRODUCT_MODE` environment variable is set at deployment time and does not change during runtime (requires redeployment to switch modes).
- The admin dashboard fetches product mode from the backend at startup (not baked into the build).
- No database schema changes are required — gating is purely at the application routing and worker registration layer.
- BYOK (Bring Your Own Keys) toggle and data expiration system are separate follow-up features, not part of this spec.
- The existing `featureToggle` service may be leveraged or extended for product mode gating, but the product mode is a higher-level gate that supersedes individual feature toggles.
- HeyReach webhook is categorized as GATE (LinkedIn campaign automation), not KEEP.

## Scope Boundaries

### In Scope
- Conditional route mounting in the server based on PRODUCT_MODE
- Conditional worker registration in the queue system based on PRODUCT_MODE
- Admin dashboard navigation and routing adaptation based on PRODUCT_MODE
- Health check endpoint enhancement to report current product mode
- Clear error responses for gated endpoints

### Out of Scope
- Code deletion or removal of any existing feature code
- BYOK (Bring Your Own Keys) API key management
- Data expiration / automatic data purge system
- Chrome Extension development
- Slack App Directory submission
- Pricing tier implementation
- Per-feature granular toggles (this is a binary full/enrichment mode switch)
- Database schema changes

## Dependencies

- Virality Playbook (spec 36) — this feature is Step 1 of that playbook
- Current `featureToggle` service in `src/services/featureToggle/` — may be extended
- Admin dashboard routing configuration in `admin-dashboard/src/`
- Worker registration logic in `src/services/queue/`

## Inventory Reference

### Routes to GATE (38 files)

**Power Dialer (9 files):**
`src/routes/dialer/` — index, calls, callbacks, device, disposition, queue, recordings, sessions, token

**Campaigns (1 file):**
`src/routes/campaigns.ts`

**BDR Management (7 files):**
`src/routes/bdr/` — index, calls, onboarding, personality, stats, tasks, unibox

**Webhooks — Gated (4 files):**
`src/routes/webhooks/` — instantly, twilio, deepgram, workflow

**Admin — Gated (17 files):**
`src/routes/admin/` — activeCalls, analytics, bdrManagement, callQuality, campaigns, channelMappings, clientManagement, contentLibrary, contacts, demoDailyDm, dialer-config, licensing, onboardingPlans, onboardingEnrollments, onboardingProgress, recordings, recording-reviews, reports, salesfloor, savedViews, thresholds, uncallable, workflows, workspaceManagement

### Workers to GATE (7 files)
`src/services/queue/workers/` — campaignDispatcher, dialerCallbackWorker, dialerInactivityWorker, onboardingWorker, recordingProcessingWorker, smartReplyWorker, workflowWorker

### Dashboard Pages to GATE (33 files)
`admin-dashboard/src/pages/` — active-calls, analytics, bdr-activity, bdr/calls, bdr/dialer, bdr/stats, bdr/tasks, bdr/unibox, campaign-create, campaign-detail, campaigns, channel-mappings, contact-detail, content-library, dialer-analytics, eod-reports, managed-bdrs, onboarding-enrollments, onboarding-plan-detail, onboarding-plans, onboarding-progress, recording-detail, recordings, reports, salesfloor, thresholds, workflow-analytics, workflow-builder, workflow-execution-detail, workflow-style-test, workflows

### Service Directories to GATE (10 directories)
`src/services/` — dialer, campaign, workflow, onboarding, personality, qualityGate, heyreach, instantly, findymail, wiza
