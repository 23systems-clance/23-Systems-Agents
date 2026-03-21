# Tasks: Dynamic Suggested Prompts

**Input**: Design documents from `/specs/23-dynamic-suggested-prompts/`
**Prerequisites**: plan.md ✅, spec.md ✅, research.md ✅, data-model.md ✅, contracts/ ✅

**Tests**: Automated test tasks are OPTIONAL per constitution XV (AWS-only deployment). Primary testing via ECS deployment and manual verification in Slack workspace. Unit tests with Vitest can be added post-MVP for core logic (promptGenerator, promptContext) if desired.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

---

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3, US4)
- Include exact file paths in descriptions

---

## Path Conventions

- **Single Node.js TypeScript project**: `src/`, `tests/` at repository root
- Paths assume existing Slack bot codebase structure

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and TypeScript interface definitions

- [X] T001 Create TypeScript interfaces from contracts/promptGenerator.ts in src/types/promptTypes.ts
- [X] T002 [P] Define prompt category enums and constants (including POWER_USER_JOB_COUNT = 10) in src/constants/promptCategories.ts
- [X] T003 [P] Create DEFAULT_PROMPTS static fallback array in src/constants/defaultPrompts.ts

**Checkpoint**: TypeScript types and constants defined - implementation can now begin

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T004 Create Prisma schema for PromptClickEvent model in prisma/schema.prisma (P3 analytics, can defer)
- [X] T005 Generate Prisma migration for PromptClickEvent table
- [X] T006 [P] Implement Redis cache service for prompt context in src/services/cache/promptCache.ts
- [X] T007 [P] Create error handling utilities for prompt generation failures in src/utils/promptErrors.ts
- [X] T008 [P] Add CloudWatch logging configuration for prompt generation metrics in src/utils/logger.ts

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - Activity-Aware Prompt Suggestions (Priority: P1) 🎯 MVP

**Goal**: Generate personalized prompts based on user's recent enrichment activity (active jobs, completed jobs, failed jobs)

**Independent Test**: Create enrichment jobs in different states (active, completed, failed) and open agent panel to verify prompts reflect the user's actual activity

### Implementation for User Story 1

**Step 1: Context Builder (User Activity)**

- [X] T009 [P] [US1] Implement fetchUserActivity() function in src/services/agent/promptContext.ts to query active jobs from database
- [X] T010 [P] [US1] Implement fetchCompletedJobs() function (48h window) in src/services/agent/promptContext.ts
- [X] T011 [P] [US1] Implement fetchFailedJobs() function (24h window) in src/services/agent/promptContext.ts
- [X] T012 [US1] Implement buildPromptContext() function that aggregates user activity in src/services/agent/promptContext.ts (depends on T009-T011)

**Step 2: Prompt Templates (Activity-Based)**

- [X] T013 [P] [US1] Create onboarding prompt templates (new user) in src/services/agent/promptTemplates.ts
- [X] T014 [P] [US1] Create active job prompt templates ("Check your running enrichment") in src/services/agent/promptTemplates.ts
- [X] T015 [P] [US1] Create failed job prompt templates ("Retry your failed enrichment") in src/services/agent/promptTemplates.ts
- [X] T016 [P] [US1] Create completed job follow-up templates ("Filter your last results") in src/services/agent/promptTemplates.ts
- [X] T017 [P] [US1] Create power user prompt templates (10+ jobs threshold) in src/services/agent/promptTemplates.ts

**Step 3: Prompt Generator (Core Algorithm)**

- [X] T018 [US1] Implement calculateScore() function with priority matrix (active=1000, failed=800, completed=400) in src/services/agent/promptGenerator.ts
- [X] T019 [US1] Implement addRecencyBonus() to boost recent activity scores in src/services/agent/promptGenerator.ts
- [X] T020 [US1] Implement applyDiversityFilter() to prevent prompt repetition in src/services/agent/promptGenerator.ts
- [X] T021 [US1] Implement generate() main function that produces exactly 4 prompts in src/services/agent/promptGenerator.ts (depends on T018-T020)

**Step 4: Event Handler Integration**

- [ ] T022 [US1] Modify assistantThreadStarted handler to call promptGenerator.generate() in src/listeners/events/assistantThreadStarted.ts
- [ ] T023 [US1] Add fallback to DEFAULT_PROMPTS on error in src/listeners/events/assistantThreadStarted.ts
- [ ] T024 [US1] Add performance logging (<500ms target) in src/listeners/events/assistantThreadStarted.ts

**Step 5: Redis Caching Integration**

- [X] T025 [US1] Integrate promptCache.get() to check for cached context before DB queries in src/services/agent/promptContext.ts
- [X] T026 [US1] Integrate promptCache.set() to cache PromptContext with 5-min sliding TTL in src/services/agent/promptContext.ts
- [ ] T027 [US1] Add cache invalidation on job state changes in src/services/queue/workers/technographic.ts, src/services/queue/workers/contact.ts, src/services/queue/workers/combined.ts

**Checkpoint**: At this point, User Story 1 should be fully functional - users see activity-aware prompts

**Acceptance Criteria**:
- ✅ Active job → "Check your running enrichment" appears in top 4
- ✅ Failed job (< 24h) → "Retry your failed enrichment" appears
- ✅ Completed job (< 48h) → Follow-up prompt appears
- ✅ No history → Onboarding prompts appear
- ✅ 10+ jobs → Power user prompts appear

---

## Phase 4: User Story 2 - Channel-Context Dynamic Prompts (Priority: P1)

**Goal**: Update prompts when user switches channels based on channel enrichment history, documents, and presets

**Independent Test**: Navigate between channels with different enrichment histories and documents, verify prompts update accordingly

### Implementation for User Story 2

**Step 1: Context Builder (Channel Context)**

- [ ] T028 [P] [US2] Implement fetchChannelHistory() to aggregate enrichment history per channel in src/services/agent/promptContext.ts
- [ ] T029 [P] [US2] Implement fetchChannelDocuments() to get ICP/Use Cases docs in src/services/agent/promptContext.ts
- [ ] T030 [P] [US2] Implement fetchChannelPresets() to get enrichment presets in src/services/agent/promptContext.ts
- [ ] T031 [US2] Update buildPromptContext() to include channel context when channelId present in src/services/agent/promptContext.ts (depends on T028-T030)

**Step 2: Prompt Templates (Channel-Specific)**

- [ ] T032 [P] [US2] Create channel history prompt templates ("View recent jobs in #channel-name") in src/services/agent/promptTemplates.ts
- [ ] T033 [P] [US2] Create document-based prompt templates ("Enrich using [doc-slug] settings") in src/services/agent/promptTemplates.ts
- [ ] T034 [P] [US2] Create preset prompt templates ("Run your [preset-name] enrichment") in src/services/agent/promptTemplates.ts

**Step 3: Event Handler for Channel Changes**

- [ ] T035 [US2] Modify assistantThreadContextChanged handler to call promptGenerator.generate() in src/listeners/events/assistantThreadContextChanged.ts
- [ ] T036 [US2] Implement last-write-wins logic to discard stale context changes in src/listeners/events/assistantThreadContextChanged.ts
- [ ] T037 [US2] Add fallback to DEFAULT_PROMPTS on error in src/listeners/events/assistantThreadContextChanged.ts

**Step 4: Caching for Channel Context**

- [ ] T038 [US2] Add separate cache key for channel context ({teamId}:channel:{channelId}:history) in src/services/cache/promptCache.ts
- [ ] T039 [US2] Invalidate channel cache on document upload or preset creation (if document upload listener exists in codebase)

**Checkpoint**: At this point, User Story 2 should be fully functional - prompts update when switching channels

**Acceptance Criteria**:
- ✅ Channel with documents → "Enrich using [doc-slug]" appears
- ✅ Channel with 5+ jobs → "View recent jobs in #channel" appears
- ✅ Channel with preset → "Run your [preset-name] enrichment" appears
- ✅ Channel with no history → General prompts appear
- ✅ Rapid channel switching → Only latest context's prompts shown

---

## Phase 5: User Story 3 - Workspace-Aware Prompt Personalization (Priority: P2)

**Goal**: Filter prompts based on workspace configuration (enabled services, usage limits, billing status)

**Independent Test**: Configure different workspace settings (disable Apollo, set low usage cap) and verify prompts exclude irrelevant suggestions

### Implementation for User Story 3

**Step 1: Context Builder (Workspace Config)**

- [ ] T040 [P] [US3] Implement fetchWorkspaceConfig() to get enabled services (Apollo, BuiltWith) in src/services/agent/promptContext.ts
- [ ] T041 [P] [US3] Implement calculateUsagePercentage() from ApiUsageLog in src/services/agent/promptContext.ts
- [ ] T042 [US3] Update buildPromptContext() to include workspace config in src/services/agent/promptContext.ts (depends on T040-T041)

**Step 2: Prompt Templates (Workspace-Specific)**

- [ ] T043 [P] [US3] Create usage warning prompt templates ("Check workspace usage" for 80%+ usage) in src/services/agent/promptTemplates.ts
- [ ] T044 [P] [US3] Create workspace preset prompt templates ("Run [workspace-preset] enrichment") in src/services/agent/promptTemplates.ts

**Step 3: Filtering Logic**

- [ ] T045 [US3] Update isApplicable() checks in all templates to respect workspace config (e.g., skip contact prompts if Apollo disabled) in src/services/agent/promptTemplates.ts
- [ ] T046 [US3] Add workspace config validation in promptGenerator.generate() in src/services/agent/promptGenerator.ts

**Checkpoint**: At this point, User Story 3 should be fully functional - prompts respect workspace configuration

**Acceptance Criteria**:
- ✅ Apollo disabled → No contact enrichment prompts appear
- ✅ 80%+ usage → "Check workspace usage" appears
- ✅ Workspace preset → Preset prompt appears

---

## Phase 6: User Story 4 - Prompt Analytics & Optimization (Priority: P3) ⚙️ OPTIONAL

**Goal**: Track prompt clicks for analytics and future optimization

**Independent Test**: Click various suggested prompts and verify click events are recorded with metadata

**Note**: This phase is OPTIONAL and can be deferred to post-MVP

### Implementation for User Story 4

**Step 1: Click Detection**

- [ ] T047 [P] [US4] Implement getLastPromptsForThread() to retrieve prompts shown in thread in src/services/agent/conversationManager.ts
- [ ] T048 [P] [US4] Store generated prompts in thread context after setSuggestedPrompts() in src/listeners/events/assistantThreadStarted.ts
- [ ] T049 [US4] Implement detectPromptClick() by comparing message text to last prompts in src/services/agent/promptAnalytics.ts

**Step 2: Event Recording**

- [ ] T050 [US4] Implement recordClick() to insert PromptClickEvent in database in src/services/agent/promptAnalytics.ts
- [ ] T051 [US4] Integrate detectPromptClick() in assistantUserMessage handler in src/listeners/events/assistantUserMessage.ts (or existing message handler)

**Step 3: Analytics Aggregation**

- [ ] T052 [P] [US4] Create daily aggregation query for click-through rates in src/services/analytics/promptAggregation.ts
- [ ] T053 [P] [US4] Implement retention worker to purge PromptClickEvent records older than 90 days (search for existing retention worker in codebase; if none exists, create standalone BullMQ job)

**Checkpoint**: At this point, User Story 4 should be fully functional - prompt clicks tracked for analytics

**Acceptance Criteria**:
- ✅ Clicked prompt → PromptClickEvent record created
- ✅ Event includes: promptTitle, promptPosition, contextType, userId, teamId, timestamp
- ✅ 90-day retention enforced

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Final enhancements, error handling, monitoring, and documentation

- [ ] T054 [P] Add comprehensive error handling for all database query failures (fall back to static prompts)
- [ ] T055 [P] Add CloudWatch custom metrics for prompt generation latency (p50, p95, p99)
- [ ] T056 [P] Add CloudWatch custom metrics for cache hit rate
- [ ] T057 [P] Add CloudWatch alarms for high latency (p95 > 800ms) and low cache hit (<60%)
- [ ] T058 [P] Document prompt template format and how to add new categories in quickstart.md (already done)
- [ ] T059 [P] Document algorithm tuning parameters in quickstart.md (already done)
- [ ] T060 Review and optimize database indexes on EnrichmentJob (slackUserId, status, createdAt)
- [ ] T061 Add deployment instructions for ECS in quickstart.md (already done)

**Checkpoint**: Feature complete and production-ready

---

## Dependencies & Execution Order

### Story Completion Order

```
Phase 1 (Setup) → Phase 2 (Foundation)
                       ↓
           ┌───────────┴───────────┐
           ↓                       ↓
    Phase 3 (US1)            Phase 4 (US2)
    Activity-Aware           Channel-Context
           ↓                       ↓
           └───────────┬───────────┘
                       ↓
                 Phase 5 (US3)
              Workspace-Aware
                       ↓
                 Phase 6 (US4) ← OPTIONAL (P3)
                  Analytics
                       ↓
                 Phase 7 (Polish)
```

**MVP Scope**: Phase 1 + Phase 2 + Phase 3 (US1 only)
- Delivers core value: Activity-aware prompts
- 27 tasks total for MVP
- Can ship and iterate

**Full P1 Scope**: MVP + Phase 4 (US2)
- Adds channel-context awareness
- 39 tasks total
- Complete P1 feature set

**Full P2 Scope**: Full P1 + Phase 5 (US3)
- Adds workspace configuration filtering
- 46 tasks total
- Production-ready with all P1+P2 stories

**Full Feature**: All phases including P3
- Adds analytics for optimization
- 61 tasks total
- Complete feature with metrics

### Task Dependencies

**Within Phase 3 (US1)**:
- T009-T011 can run in parallel (different queries)
- T012 depends on T009-T011 (aggregates results)
- T013-T017 can run in parallel (different templates)
- T018-T020 can run in sequence or parallel (algorithm components)
- T021 depends on T018-T020 (uses all components)
- T022-T024 depend on T021 (integration)
- T025-T027 depend on T012 (caching layer)

**Cross-Phase**:
- Phase 4 (US2) can start after Phase 3 completes
- Phase 5 (US3) can start after Phase 4 completes
- Phase 6 (US4) can start anytime after Phase 2 (independent)
- Phase 7 can run in parallel with later phases

---

## Parallel Execution Opportunities

### Phase 1 (Setup)
- T002 and T003 can run in parallel (different files)

### Phase 2 (Foundation)
- T006, T007, T008 can run in parallel (different services)
- T004-T005 must run in sequence (migration depends on schema)

### Phase 3 (US1)
**Parallel Group 1**: T009, T010, T011 (different queries)
**Parallel Group 2**: T013, T014, T015, T016, T017 (different templates)
**Parallel Group 3**: T018, T019, T020 (algorithm components - can parallelize with care)

### Phase 4 (US2)
**Parallel Group 1**: T028, T029, T030 (different queries)
**Parallel Group 2**: T032, T033, T034 (different templates)

### Phase 5 (US3)
**Parallel Group 1**: T040, T041 (different queries)
**Parallel Group 2**: T043, T044 (different templates)

### Phase 6 (US4)
**Parallel Group 1**: T047, T048 (different concerns)
**Parallel Group 2**: T052, T053 (analytics queries)

### Phase 7 (Polish)
- T054, T055, T056, T057, T058, T059 can all run in parallel (different concerns)

**Total Parallel Opportunities**: ~25 tasks can run concurrently across the project

---

## Implementation Strategy

### MVP First Approach (Recommended)

**Week 1**: Phase 1 + Phase 2 + Phase 3 (T001-T027)
- Delivers: Activity-aware prompts working end-to-end
- Testable: Users see personalized prompts based on job history
- Shippable: Core value delivered, can gather feedback

**Week 2**: Phase 4 (T028-T039)
- Delivers: Channel-context awareness
- Testable: Prompts update when switching channels
- Shippable: Full P1 feature set complete

**Week 3**: Phase 5 + Phase 7 (T040-T046, T054-T061)
- Delivers: Workspace configuration + Polish
- Testable: Prompts respect workspace limits
- Shippable: Production-ready with monitoring

**Post-MVP** (Optional): Phase 6 (T047-T053)
- Delivers: Analytics for optimization
- Testable: Click events tracked
- Iterative: Can add based on usage data

---

## Task Summary

**Total Tasks**: 61
- Phase 1 (Setup): 3 tasks
- Phase 2 (Foundation): 5 tasks
- Phase 3 (US1 - Activity-Aware): 19 tasks 🎯 MVP
- Phase 4 (US2 - Channel-Context): 12 tasks
- Phase 5 (US3 - Workspace-Aware): 7 tasks
- Phase 6 (US4 - Analytics): 7 tasks ⚙️ OPTIONAL
- Phase 7 (Polish): 8 tasks

**MVP Scope** (Phases 1-3): 27 tasks
**P1 Scope** (Phases 1-4): 39 tasks
**P2 Scope** (Phases 1-5): 46 tasks
**Full Feature** (All phases): 61 tasks

**Parallel Opportunities**: ~25 tasks can run concurrently
**Independent Stories**: US1, US2, US3 can each be tested independently
**Estimated Timeline**: 2-3 weeks for P1+P2, 3-4 weeks for full feature

---

## Format Validation

✅ All tasks follow checklist format: `- [ ] [ID] [P?] [Story?] Description`
✅ All task IDs sequential (T001-T061)
✅ All user story tasks labeled ([US1], [US2], [US3], [US4])
✅ All parallelizable tasks marked with [P]
✅ All tasks include file paths in descriptions
✅ Independent test criteria provided for each story
✅ MVP scope clearly identified (Phase 3 - US1)

---

**Next Steps**: Run `/speckit.implement` to begin executing tasks, or manually select tasks to work on in priority order.
