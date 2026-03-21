# Tasks: Fix Dynamic Suggested Prompts (Feature 26)

**Input**: Implementation plan from `/specs/26-fix-dynamic-prompts/plan.md`
**Prerequisites**: spec.md ✅, plan.md ✅
**Target**: Make Feature 23 production-ready by fixing all P0/P1 blockers

**Tests**: Manual QA in staging per constitution XV (AWS-only deployment). Create 3 test workspaces to validate workspace config filtering. Monitor CloudWatch metrics for performance validation.

**Organization**: Tasks are grouped by phase for sequential execution.

---

## Format: `[ID] [P?] [Phase] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Phase]**: Which implementation phase (P1-P5)
- Include exact file paths in descriptions

---

## Phase 1: Event Handler Cleanup (0.5h)

**Purpose**: Remove duplicate `.disabled` files, verify single implementation

- [ ] T001 [P1] Compare assistantThreadStarted.ts.disabled with assistant.ts lines 65-88 to verify identical logic
- [ ] T002 [P1] Compare assistantThreadContextChanged.ts.disabled with assistant.ts lines 191-217 to verify identical logic
- [ ] T003 [P1] Delete src/listeners/events/assistantThreadStarted.ts.disabled permanently
- [ ] T004 [P1] Delete src/listeners/events/assistantThreadContextChanged.ts.disabled permanently
- [ ] T005 [P1] Verify CloudWatch logs show PromptGenerationLatency metric (confirms prompts working)

**Checkpoint**: No `.disabled` files exist, event handlers verified working

---

## Phase 2: EnrichmentPreset Schema Extension (2-3h)

**Purpose**: Enable channel-scoped preset prompts

- [ ] T006 [P2] Add slackTeamId String? field to EnrichmentPreset model in prisma/schema.prisma
- [ ] T007 [P2] Add slackChannelId String? field to EnrichmentPreset model in prisma/schema.prisma
- [ ] T008 [P2] Add enrichmentType EnrichmentType? field to EnrichmentPreset model in prisma/schema.prisma
- [ ] T009 [P2] Add @@index([slackTeamId, slackChannelId]) to EnrichmentPreset model in prisma/schema.prisma
- [ ] T010 [P2] Generate Prisma migration: npx prisma migrate dev --name add_channel_scoping_to_presets
- [ ] T011 [P2] Add enrichmentType field to PresetSummary interface in src/types/promptTypes.ts
- [ ] T012 [P2] Update fetchChannelPresets() in src/services/agent/promptContext.ts to query by slackTeamId and slackChannelId with OR fallback (channel > team > global)
- [ ] T013 [P2] Update preset_run template render() in src/services/agent/promptTemplates.ts to include enrichmentType in message

**Checkpoint**: Preset schema extended, fetchChannelPresets() returns channel-scoped presets

---

## Phase 3: Channel-Specific Caching (2-3h)

**Purpose**: Optimize performance with channel-level Redis caching

**Step 1: Add Cache Methods**

- [ ] T014 [P] [P3] Add getChannelHistory() method to PromptContextCache class in src/services/cache/promptCache.ts
- [ ] T015 [P] [P3] Add setChannelHistory() method to PromptContextCache class in src/services/cache/promptCache.ts
- [ ] T016 [P] [P3] Add getChannelDocuments() method to PromptContextCache class in src/services/cache/promptCache.ts
- [ ] T017 [P] [P3] Add setChannelDocuments() method to PromptContextCache class in src/services/cache/promptCache.ts
- [ ] T018 [P] [P3] Add getChannelPresets() method to PromptContextCache class in src/services/cache/promptCache.ts
- [ ] T019 [P] [P3] Add setChannelPresets() method to PromptContextCache class in src/services/cache/promptCache.ts
- [ ] T020 [P] [P3] Add invalidateChannel() method to PromptContextCache class in src/services/cache/promptCache.ts

**Step 2: Integrate Caching in Context Builder**

- [ ] T021 [P3] Update fetchChannelHistory() in src/services/agent/promptContext.ts to check cache first, set cache after DB query
- [ ] T022 [P3] Update fetchChannelDocuments() in src/services/agent/promptContext.ts to check cache first, set cache after DB query
- [ ] T023 [P3] Update fetchChannelPresets() in src/services/agent/promptContext.ts to check cache first, set cache after DB query (depends on T012)

**Step 3: Cache Invalidation**

- [ ] T024 [P3] Add promptContextCache.invalidateChannel() call in src/listeners/events/fileSharedDocument.ts after document upload completes
- [ ] T025 [P3] Search codebase for preset creation handlers and add cache invalidation (if preset creation via Slack exists)

**Checkpoint**: Channel caching implemented, cache hit rate >50% after 24h

---

## Phase 4: Workspace Config Validation (2-3h)

**Purpose**: Verify and fix workspace capability filtering

**Step 1: Audit Templates**

- [ ] T026 [P4] Audit all templates in src/services/agent/promptTemplates.ts for contact prompts, ensure apolloEnabled check exists in isApplicable()
- [ ] T027 [P4] Audit all templates in src/services/agent/promptTemplates.ts for technographic prompts, ensure builtWithEnabled check exists in isApplicable()
- [ ] T028 [P4] Verify usage_check template in src/services/agent/promptTemplates.ts has usagePercentage >= 80 check

**Step 2: Fix Missing Filters**

- [ ] T029 [P4] Add workspace config checks to any templates missing them in src/services/agent/promptTemplates.ts

**Step 3: Create Test Workspaces**

- [ ] T030 [P] [P4] Create test workspace A via admin dashboard with maxApolloCredits = 0 (Apollo disabled)
- [ ] T031 [P] [P4] Create test workspace B via admin dashboard with maxBuiltwithLookups = 0 (BuiltWith disabled)
- [ ] T032 [P4] Create test workspace C via admin dashboard with usage at 85% (set monthlySpendCapUsd and create usage logs)

**Step 4: Manual QA Testing (1h)**

- [ ] T033 [P4] Test workspace A: Open agent, verify NO contact prompts appear, document results (depends on T030)
- [ ] T034 [P4] Test workspace B: Open agent, verify NO technographic prompts appear, document results (depends on T031)
- [ ] T035 [P4] Test workspace C: Open agent, verify "Check workspace usage" prompt appears, document results (depends on T032)

**Checkpoint**: Workspace filtering verified via manual QA, results documented

---

## Phase 5: Update Feature 23 tasks.md (1h)

**Purpose**: Reflect actual implementation status

- [ ] T036 [P5] Mark T022-T027 as complete in specs/23-dynamic-suggested-prompts/tasks.md (event handler integration + caching)
- [ ] T037 [P5] Mark T028-T031 as complete in specs/23-dynamic-suggested-prompts/tasks.md (channel context - Feature 26 fixes)
- [ ] T038 [P5] Mark T032-T034 as complete in specs/23-dynamic-suggested-prompts/tasks.md (channel templates - Feature 26 fixes)
- [ ] T039 [P5] Mark T035-T037 as complete in specs/23-dynamic-suggested-prompts/tasks.md (threadContextChanged handler)
- [ ] T040 [P5] Mark T038-T039 as complete in specs/23-dynamic-suggested-prompts/tasks.md (channel caching - Feature 26)
- [ ] T041 [P5] Mark T040-T044 as complete in specs/23-dynamic-suggested-prompts/tasks.md (workspace config)
- [ ] T042 [P5] Mark T045-T046 as complete in specs/23-dynamic-suggested-prompts/tasks.md (workspace validation - Feature 26)
- [ ] T043 [P5] Update completion percentage calculation (should be ~58/61 = 95%)

**Checkpoint**: tasks.md accurately reflects codebase state

---

## Cross-Cutting Concerns

**Deployment**

- [ ] T044 Create feature branch: git checkout -b 26-fix-dynamic-prompts
- [ ] T045 Commit all changes with proper message: "feat(prompts): fix Feature 23 blockers - preset schema, caching, validation"
- [ ] T046 Push to origin (triggers GitHub Actions CI/CD): git push origin 26-fix-dynamic-prompts
- [ ] T047 Monitor CloudWatch logs after deployment for PromptGenerationLatency metric
- [ ] T048 Monitor cache hit rate (PromptCacheHit vs PromptCacheMiss) after 24h

**Documentation**

- [ ] T049 [P] Document preset schema changes in specs/26-fix-dynamic-prompts/CHANGELOG.md
- [ ] T050 [P] Document channel caching architecture in specs/26-fix-dynamic-prompts/CHANGELOG.md

---

## Dependencies & Execution Order

### Sequential Dependencies

```
Phase 1 (Event Handler Cleanup)
     ↓
Phase 2 (Preset Schema)
     ↓
Phase 3 (Channel Caching) → Must follow Phase 2 (T023 depends on T012)
     ↓
Phase 4 (Workspace Validation)
     ↓
Phase 5 (Update tasks.md)
     ↓
Deployment & Monitoring
```

### Within-Phase Parallelization

**Phase 1**: T001-T002 can run in parallel (file comparisons)
**Phase 2**: T006-T009 can run in parallel (schema edits)
**Phase 3**: T014-T020 can run in parallel (cache method additions)
**Phase 4**: T030-T031 can run in parallel (test workspace creation)
**Phase 5**: T036-T042 can run in parallel (task marking)

---

## Task Summary

**Total Tasks**: 50
- Phase 1 (Event Handler Cleanup): 5 tasks
- Phase 2 (Preset Schema): 8 tasks
- Phase 3 (Channel Caching): 12 tasks
- Phase 4 (Workspace Validation): 10 tasks
- Phase 5 (Update tasks.md): 8 tasks
- Cross-Cutting (Deployment & Docs): 7 tasks

**Parallel Opportunities**: ~20 tasks can run concurrently
**Estimated Timeline**: 11-15 hours across 5 phases

---

## Implementation Strategy

### Recommended Order

**Day 1** (3-4h):
- Phase 1: Event Handler Cleanup (0.5h)
- Phase 2: Preset Schema Extension (2-3h)

**Day 2** (4-5h):
- Phase 3: Channel Caching (2-3h)
- Phase 4: Workspace Validation (2h) - Create test workspaces, audit templates

**Day 3** (4-6h):
- Phase 4 continued: Manual QA (1h)
- Phase 5: Update tasks.md (1h)
- Deployment & Testing (2-4h)

---

**Next Steps**: Begin Phase 1 (Event Handler Cleanup) or run `/speckit.analyze` to check consistency across spec, plan, tasks.
