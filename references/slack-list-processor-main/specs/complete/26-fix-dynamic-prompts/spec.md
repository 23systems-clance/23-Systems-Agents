# Feature Specification: Fix Dynamic Suggested Prompts (Feature 23)

**Feature Branch**: `26-fix-dynamic-prompts`
**Created**: 2026-03-14
**Status**: Draft
**Parent Feature**: Feature 23 - Dynamic Suggested Prompts
**Input**: Audit report from `specs/23-dynamic-suggested-prompts/AUDIT-REPORT.md` identified that Feature 23 is 75% complete but non-functional due to disabled event handlers, schema gaps, and missing validations. This feature fixes all blocking issues to make dynamic prompts production-ready.

## Problem Statement

Feature 23 (Dynamic Suggested Prompts) was implemented and merged to main but is **NOT FUNCTIONAL** in production. The audit identified three critical blockers:

1. **Event handlers disabled** - Standalone `.disabled` files exist alongside working implementation in `assistant.ts`, causing confusion and preventing feature activation
2. **EnrichmentPreset schema incomplete** - Missing fields (`slackTeamId`, `slackChannelId`, `enrichmentType`) prevent channel-specific preset prompts from working
3. **Missing validations** - No verification that workspace config filtering (e.g., Apollo-disabled workspaces skip contact prompts) works correctly

Additionally, the feature lacks channel-specific caching optimizations (T038-T039) and has outdated task tracking in `tasks.md`.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Event Handler Integration (Priority: P0 - BLOCKING)

**Goal**: Ensure dynamic prompts are generated on `threadStarted` and `threadContextChanged` events without duplicate/conflicting code.

**Scenarios**:
1. **Given** the codebase has both `assistant.ts` (with working prompt generation) and `.disabled` event handler files, **When** a developer reviews the code, **Then** there is no confusion about which implementation is active, and duplicate code is removed.
2. **Given** a user opens the Slack agent panel, **When** the `threadStarted` event fires, **Then** dynamic prompts are generated and displayed (verified via CloudWatch logs showing prompt generation latency).
3. **Given** a user switches channels while the agent panel is open, **When** the `threadContextChanged` event fires, **Then** prompts update to reflect the new channel context (verified via logs showing channel-specific prompts).

**Independent Test**: Can be tested by opening the agent panel and checking Slack UI shows 4 suggested prompts (not static defaults), and CloudWatch logs show `PromptGenerationLatency` metric.

---

### User Story 2 - EnrichmentPreset Schema Fix (Priority: P1)

**Goal**: Enable channel-specific preset prompts by extending the EnrichmentPreset schema.

**Scenarios**:
1. **Given** the schema is extended with `slackTeamId`, `slackChannelId`, `enrichmentType`, **When** a preset is created and scoped to a channel, **Then** `fetchChannelPresets()` returns presets for that channel, and preset prompts appear in the suggestion list.
2. **Given** a user is in `#vcs-channel` with a preset "VCs in Silicon Valley", **When** they open the agent panel, **Then** one of the 4 prompts is "Run VCs in Silicon Valley" (clickable button).
3. **Given** a preset has `enrichmentType = 'contact'`, **When** displayed in a prompt, **Then** clicking it triggers contact enrichment (not technographic).

**Independent Test**: Create a test preset scoped to `#test-channel`, open agent in that channel, verify preset prompt appears with correct title and triggers correct enrichment type.

---

### User Story 3 - Workspace Config Validation (Priority: P1)

**Goal**: Ensure prompts respect workspace capabilities (e.g., no contact prompts if Apollo disabled).

**Scenarios**:
1. **Given** a workspace has Apollo disabled (maxApolloCredits = 0), **When** a user opens the agent panel, **Then** NO contact enrichment prompts appear (only technographic, tech report, general prompts).
2. **Given** a workspace is at 85% of monthly usage cap, **When** a user opens the agent panel, **Then** one of the 4 prompts is "Check workspace usage" with percentage.
3. **Given** a workspace has BuiltWith disabled, **When** a user opens the agent panel, **Then** NO technographic enrichment prompts appear.

**Independent Test**: Can be tested by creating test workspaces with different configs (Apollo disabled, usage at 85%) and verifying prompt output matches expected filters.

---

### User Story 4 - Channel-Specific Caching (Priority: P2)

**Goal**: Optimize prompt generation performance with channel-level caching.

**Scenarios**:
1. **Given** a user switches to a channel they recently viewed, **When** `threadContextChanged` fires, **Then** channel context (history, documents) is loaded from cache instead of DB, reducing latency by 50-100ms.
2. **Given** a document is uploaded to a channel, **When** the upload completes, **Then** the channel's prompt cache is invalidated, ensuring the next prompt generation includes the new document.

**Independent Test**: Can be tested by monitoring CloudWatch `PromptCacheHit` metric increasing after channel context is cached, and verifying cache invalidation triggers on document upload.

---

### User Story 5 - Task Tracking Accuracy (Priority: P3)

**Goal**: Update `tasks.md` to reflect actual implementation status.

**Scenarios**:
1. **Given** tasks T022-T044 are implemented but marked incomplete in `tasks.md`, **When** the file is updated, **Then** all completed tasks are marked `[X]` and remaining gaps (T038-T039, T045-T046) are clearly identified.

**Independent Test**: Manual review of `tasks.md` against codebase implementation.

---

### Edge Cases

- What happens if the `.disabled` files contain different logic than `assistant.ts`? → Manual review before deletion; if different, migrate unique logic to `assistant.ts`.
- What if existing global presets conflict with new channel-scoped presets? → Channel-scoped presets take priority; global presets are fallback.
- What if workspace config validation reveals bugs in template `isApplicable()` logic? → Fix bugs in `promptTemplates.ts` as part of this feature.
- What if channel caching breaks existing prompt generation? → Make channel caching **optional** (feature flag in Redis key design).

## Requirements _(mandatory)_

### Functional Requirements

**Event Handler Cleanup**
- **FR-001**: System MUST have exactly ONE implementation of `threadStarted` and `threadContextChanged` handlers (no duplicates).
- **FR-002**: System MUST generate dynamic prompts on both events (verified via CloudWatch `PromptGenerationLatency` metric > 0).
- **FR-003**: System MUST permanently delete orphaned `.disabled` files after verifying `assistant.ts` implementation is complete (no archival, rely on git history).

**EnrichmentPreset Schema**
- **FR-004**: Schema MUST include `slackTeamId String?`, `slackChannelId String?`, `enrichmentType EnrichmentType?` to enable channel-scoped presets.
- **FR-005**: Migration MUST make new fields nullable to avoid breaking existing global presets (presets with null team/channel remain global).
- **FR-006**: `fetchChannelPresets()` MUST query by `slackTeamId` and `slackChannelId` and return channel-specific presets (no more empty arrays with TODO comments).

**Workspace Config Validation**
- **FR-007**: System MUST filter out contact prompts when workspace `apolloEnabled = false`.
- **FR-008**: System MUST filter out technographic prompts when workspace `builtWithEnabled = false`.
- **FR-009**: System MUST show usage warning prompt when workspace `usagePercentage >= 80`.
- **FR-010**: System MUST have manual QA validation verifying FR-007 through FR-009 with test workspaces in staging environment.

**Channel Caching**
- **FR-011**: System MUST cache channel history, documents, and presets separately from user context (different Redis keys).
- **FR-012**: System MUST invalidate channel cache when a document is uploaded or preset is created for that channel.
- **FR-013**: Channel cache MUST have same TTL as user context (5 minutes sliding window).

**Task Tracking**
- **FR-014**: System MUST update `tasks.md` to mark all completed tasks as `[X]` based on actual implementation status.
- **FR-015**: System MUST update Feature 23's `tasks.md` to mark previously incomplete tasks (T038-T039, T045-T046) as complete after Feature 26 fixes are implemented.

### Key Entities

- **No new entities** - This feature fixes existing Feature 23 implementation.
- **Modified entities**: EnrichmentPreset (schema extension confirmed), promptCache (channel-specific caching methods confirmed).

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: No `.disabled` files exist in `src/listeners/events/` directory.
- **SC-002**: CloudWatch logs show `PromptGenerationLatency` metric emitted on every `threadStarted` and `threadContextChanged` event (proving dynamic prompts are active).
- **SC-003**: `fetchChannelPresets()` returns channel-scoped presets correctly (no empty arrays or TODO comments).
- **SC-004**: Test workspace with Apollo disabled shows 0 contact-related prompts in suggested list.
- **SC-005**: Test workspace at 85% usage shows "Check workspace usage" prompt in top 4.
- **SC-006**: Feature 23's `tasks.md` (at `specs/23-dynamic-suggested-prompts/tasks.md`) shows T022-T044 marked complete (including T038-T039 fixed by Feature 26), and completion percentage is 95%+.
- **SC-007**: Channel cache hit rate is >50% after 24 hours of production use (verifying channel caching works).

## Assumptions

- The implementation in `assistant.ts` is correct and complete (as identified in audit).
- The `.disabled` files are duplicates and safe to delete (to be verified in Phase 0 research).
- Existing Prisma migrations for PromptClickEvent are already deployed to production database.
- Redis (ElastiCache) is available and has sufficient memory for channel-specific caching.

## Dependencies

- Existing Feature 23 implementation (`src/services/agent/promptGenerator.ts`, `promptContext.ts`, `promptTemplates.ts`, `assistant.ts`)
- Existing Redis cache service (`src/services/cache/promptCache.ts`)
- Existing Prisma schema (`prisma/schema.prisma`)
- Existing CloudWatch metrics (`src/utils/promptMetrics.ts`)
- Audit report (`specs/23-dynamic-suggested-prompts/AUDIT-REPORT.md`)

## Decisions Required Before Implementation

### Decision 1: EnrichmentPreset Schema - Fix or Remove? ✅ RESOLVED

**Question**: Should we extend the EnrichmentPreset schema to support channel-specific presets, or remove the feature entirely?

**Decision**: **Option A (Fix Schema)** - Confirmed via codebase analysis.

**Rationale**:
- Presets are actively used in production (admin UI, CRUD API, Slack handlers)
- Audit report misidentified them as unused orphaned code
- Removing would break existing production features
- Schema extension is 2-3 hours (minimal effort delta vs removal)
- Enables channel-scoped preset prompts ("Run VCs in Silicon Valley" in `#vcs-channel`)

**Implementation**:
- Add `slackTeamId String?`, `slackChannelId String?`, `enrichmentType EnrichmentType?` to EnrichmentPreset model
- Make fields nullable to preserve existing global presets
- Update `fetchChannelPresets()` to query by channel
- Effort: 2-3 hours

---

### Decision 2: Channel Caching - Implement Now or Defer? ✅ RESOLVED

**Question**: Should channel-specific caching (T038-T039) be part of this fix or deferred to a future optimization?

**Decision**: **Option A (Implement Now)** - Confirmed.

**Rationale**:
- Reduces DB queries by 50-70% on frequent `threadContextChanged` events
- Improves latency by 50-100ms (noticeable UX improvement)
- Completes Feature 23's US4 (Channel-Specific Caching)
- Only 2-3 hours additional effort (acceptable for performance gain)

**Implementation**:
- Add `getChannelContext()`, `setChannelContext()`, `invalidateChannel()` methods to `promptCache.ts`
- Use separate Redis keys: `{teamId}:channel:{channelId}:history`, `{teamId}:channel:{channelId}:documents`, `{teamId}:channel:{channelId}:presets`
- Same 5-minute TTL as user context
- Invalidate on document upload or preset creation
- Effort: 2-3 hours

---

### Decision 3: Testing Strategy - Manual or Automated? ✅ RESOLVED

**Question**: Should we add automated tests (Vitest) for workspace config validation, or rely on manual QA?

**Decision**: **Option B (Manual QA Only)** - Confirmed.

**Rationale**:
- AWS-only constitution (Principle XV) makes automated tests optional for AWS-deployed services
- Manual QA in staging is sufficient for validation testing (create test workspaces with Apollo disabled, verify prompts filter correctly)
- Prompt generation logic is deterministic (rule-based), easy to verify manually
- Saves 3-4 hours of effort, enabling faster deployment
- Automated tests can be added later if regressions become an issue

**Implementation**:
- Create test workspaces in staging with different configs:
  - Workspace A: Apollo disabled (`maxApolloCredits = 0`)
  - Workspace B: BuiltWith disabled (`maxBuiltwithLookups = 0`)
  - Workspace C: Usage at 85% (`usagePercentage = 85`)
- Open agent panel in each workspace, verify prompt filtering works
- Document test results in `tasks.md` completion notes
- Effort: 1 hour manual testing

---

### Decision 4: `.disabled` File Handling - Archive or Delete? ✅ RESOLVED

**Question**: Should the `.disabled` event handler files be archived or permanently deleted?

**Decision**: **Option B (Delete Permanently)** - Confirmed.

**Rationale**:
- `.disabled` files are duplicates of working code in `assistant.ts` (confirmed by audit)
- Git history preserves them for reference if needed (`git log --all --full-history -- <file>`)
- Archiving creates clutter and confusion
- Clean deletion follows dead code removal best practice

**Implementation**:
- Verify `assistant.ts` contains identical logic to `.disabled` files
- Delete `src/listeners/events/assistantThreadStarted.ts.disabled`
- Delete `src/listeners/events/assistantThreadContextChanged.ts.disabled`
- Update `.gitignore` if needed to prevent recreation
- Effort: 0.5 hours (verification + deletion)

---

## Proposed Scope for This Feature

Based on critical path analysis and clarification decisions, **finalized scope**:

### In Scope (Critical - 11-15 hours)
1. ✅ Verify and permanently delete `.disabled` event handler files (US1) - **0.5h**
2. ✅ EnrichmentPreset schema extension (US2) - **2-3h**
3. ✅ Channel-specific caching (US4) - **2-3h**
4. ✅ Workspace config validation testing (US3) - **2-3h** (fix bugs + manual QA 1h)
5. ✅ Update `tasks.md` (US5) - **1h**

### Out of Scope (Defer to Future)
6. ❌ Automated tests - **Manual QA sufficient**
7. ❌ Phase 7 polish tasks (T054-T061) - **Already deferred in Feature 23**

**Total Estimated Effort**: 11-15 hours
- Event handler cleanup: 0.5h
- Preset schema fix: 2-3h
- Channel caching: 2-3h
- Workspace validation fixes: 2-3h
- Manual QA: 1h
- Tasks.md update: 1h
- Buffer for integration: 2-3h

---

## Clarifications

### Session 2026-03-14

- Q: Are EnrichmentPresets currently used in any production workspace, or should we remove the incomplete preset feature entirely? → A: **Option A (Fix Schema)** - Presets are actively used in production (admin UI at `admin-dashboard/src/pages/enrichment.tsx`, CRUD API at `src/routes/admin/enrichmentPresets.ts`, Slack handlers at `src/listeners/actions/enrichmentPresetSelection.ts`). Audit report misidentified them as unused orphaned code. Extend schema with `slackTeamId String?`, `slackChannelId String?`, `enrichmentType EnrichmentType?` to enable channel-scoped preset prompts. Preserves production feature while completing Feature 23's US2.

- Q: Should channel-specific caching (T038-T039) be part of this fix or deferred to a future optimization? → A: **Option A (Implement Now)** - Add channel-specific Redis caching for history/documents/presets. Separate cache keys from user context (`{teamId}:channel:{channelId}:history`, `{teamId}:channel:{channelId}:documents`, `{teamId}:channel:{channelId}:presets`). Reduces DB queries by 50-70%, improves latency by 50-100ms on `threadContextChanged` events. Completes Feature 23's US4 (Channel-Specific Caching). Effort: 2-3 hours.

- Q: Should we add automated tests (Vitest) for workspace config validation (FR-007 through FR-009), or rely on manual QA? → A: **Option B (Manual QA Only)** - Test validation manually in staging with test workspaces (Apollo disabled, BuiltWith disabled, 85% usage). Follows AWS-only constitution (Principle XV) which makes automated tests optional for AWS-deployed services. Manual QA is sufficient for deterministic rule-based prompt generation logic. Saves 3-4 hours effort, enables faster deployment. Automated tests can be added later if regressions occur. Effort: 1 hour manual testing.

- Q: Should the `.disabled` event handler files be archived (moved to `src/archive/`) or permanently deleted? → A: **Option B (Delete Permanently)** - Remove `.disabled` files entirely after verifying `assistant.ts` contains the same logic. Git history preserves them for reference if ever needed (`git log --all --full-history -- <file>`). Clean deletion follows dead code removal best practice, reduces codebase clutter and maintenance burden. Files to delete: `assistantThreadStarted.ts.disabled`, `assistantThreadContextChanged.ts.disabled`.

- Q: Are there production workspaces with Apollo or BuiltWith disabled available for testing validation, or should we create dedicated test workspaces? → A: **Option B (Create Test Workspaces)** - Set up dedicated test workspaces via admin dashboard with controlled configs for validation: Workspace A (Apollo disabled: `maxApolloCredits = 0`), Workspace B (BuiltWith disabled: `maxBuiltwithLookups = 0`), Workspace C (85% usage: manually set `monthlySpendCapUsd` and create usage logs to reach 85%). Ensures repeatable test environment with exact configs needed for FR-007, FR-008, FR-009 validation. Test workspaces can be reused for future prompt validation. Setup: 5-10 minutes.
