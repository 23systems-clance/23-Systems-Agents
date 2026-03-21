# Implementation Plan: Feature 26 - Fix Dynamic Suggested Prompts

**Branch**: `26-fix-dynamic-prompts` | **Date**: 2026-03-14 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/26-fix-dynamic-prompts/spec.md` with 5 clarifications resolved

## Summary

Fix the non-functional Feature 23 (Dynamic Suggested Prompts) by: (1) deleting orphaned `.disabled` event handler files, (2) extending EnrichmentPreset schema with channel scoping fields, (3) implementing channel-specific Redis caching for 50-100ms latency improvement, (4) validating workspace config filtering with manual QA, and (5) updating Feature 23's tasks.md to reflect 95%+ completion. All P0/P1 blockers addressed to make dynamic prompts production-ready.

## Technical Context

**Language/Version**: TypeScript 5.x with Node.js 18+ (ECS Fargate runtime)
**Primary Dependencies**: @slack/bolt v4.6.0 (Socket Mode), Prisma ORM, BullMQ + Redis, AWS SDK
**Storage**: PostgreSQL (AWS RDS) for job/activity data, Redis (ElastiCache) for prompt context cache, S3 for file storage
**Testing**: Manual QA in staging (AWS-only constitution makes tests optional)
**Target Platform**: AWS ECS Fargate (`prod-slack-list-processor` cluster) - Slack bot with Socket Mode
**Performance Goals**: <500ms p95 for prompt generation (already met), >50% channel cache hit rate after 24h, <50ms fallback
**Constraints**:
- Exactly 4 prompts per event (Slack API limit)
- Redis cache with 5-minute TTL (already implemented)
- Pure rule-based prompt generation (no LLM calls)
- Single ECS task runtime (AWS-only deployment)
- Existing presets must not break (nullable schema fields)
**Scale/Scope**: Multi-workspace Slack app, ~10 enrichment job types, existing production feature with admin UI

## Constitution Check

_GATE: Must pass before implementation begins._

### ✅ Applicable Principles (from BDR Management Platform Constitution)

**✅ XV. AWS-Only Infrastructure (Slack List Processor)** - COMPLIANT
- Feature fixes existing AWS ECS Fargate implementation
- No local development server
- All testing against deployed AWS service
- **Action**: Ensure fixes follow AWS-only deployment pattern

**✅ XIX. GitHub Account Policy** - COMPLIANT
- Use `developerlabsai` GitHub account for all operations
- Check `gh auth status` before git operations
- **Action**: Verify correct account before commits/PRs

**✅ V. SOC 2 Compliance & Full Audit Logging** - COMPLIANT
- EnrichmentPreset schema changes logged via Prisma migrations
- Cache operations logged via CloudWatch
- Manual QA results documented
- **Action**: Ensure all changes are auditable

**✅ VI. Cost Tracking & Financial Model** - COMPLIANT
- No new LLM costs (fixes existing feature)
- No new external API calls
- Channel caching reduces DB query costs
- **Action**: Document zero incremental cost

**✅ XI. Context-First Decision Making** - COMPLIANT
- 5 clarification questions answered before implementation
- All decisions documented with rationale
- **Action**: Proceed with implementation

**✅ XIII. Confirmation-Required Workflow** - COMPLIANT
- Plan approved by user before implementation
- **Action**: Proceed

### ✅ GATE STATUS: PASS

No violations. All decisions made. Ready to proceed.

---

## Implementation Approach

### Phase 1: Event Handler Cleanup (0.5h)

**Files**:
- DELETE: `src/listeners/events/assistantThreadStarted.ts.disabled`
- DELETE: `src/listeners/events/assistantThreadContextChanged.ts.disabled`
- VERIFY: `src/services/agent/assistant.ts` (lines 65-88, 191-217)

**Tasks**:
1. Compare `.disabled` files with `assistant.ts` (verify identical logic)
2. Delete `.disabled` files permanently
3. Verify CloudWatch logs show `PromptGenerationLatency` metric

---

### Phase 2: EnrichmentPreset Schema Extension (2-3h)

**Files**:
- MODIFY: `prisma/schema.prisma`
- MODIFY: `src/services/agent/promptContext.ts` (fetchChannelPresets)
- MODIFY: `src/services/agent/promptTemplates.ts` (preset template)
- MODIFY: `src/types/promptTypes.ts` (add enrichmentType to PresetSummary)

**Schema Changes**:
```prisma
model EnrichmentPreset {
  // ... existing fields ...

  // NEW FIELDS (Feature 26)
  slackTeamId       String?  @map("slack_team_id")
  slackChannelId    String?  @map("slack_channel_id")
  enrichmentType    EnrichmentType? @map("enrichment_type")

  // ... rest of fields ...

  @@index([slackTeamId, slackChannelId]) // NEW INDEX
}
```

**Implementation**:
1. Update schema
2. Generate migration: `npx prisma migrate dev --name add_channel_scoping_to_presets`
3. Update `fetchChannelPresets()` with OR query (channel > team > global)
4. Update preset template to include `enrichmentType` in message

---

### Phase 3: Channel-Specific Caching (2-3h)

**Files**:
- MODIFY: `src/services/cache/promptCache.ts` (add 6 methods)
- MODIFY: `src/services/agent/promptContext.ts` (integrate cache checks)
- MODIFY: `src/listeners/events/fileSharedDocument.ts` (cache invalidation)

**New Cache Methods**:
```typescript
getChannelHistory(teamId, channelId): Promise<ChannelHistory | null>
setChannelHistory(teamId, channelId, history): Promise<void>
getChannelDocuments(teamId, channelId): Promise<DocumentSummary[] | null>
setChannelDocuments(teamId, channelId, docs): Promise<void>
getChannelPresets(teamId, channelId): Promise<PresetSummary[] | null>
setChannelPresets(teamId, channelId, presets): Promise<void>
invalidateChannel(teamId, channelId): Promise<void>
```

**Cache Keys**:
- `{teamId}:channel:{channelId}:history`
- `{teamId}:channel:{channelId}:documents`
- `{teamId}:channel:{channelId}:presets`

---

### Phase 4: Workspace Config Validation (2-3h)

**Files**:
- MODIFY: `src/services/agent/promptTemplates.ts` (add workspace filters to isApplicable)

**Tasks**:
1. Audit all templates for workspace config checks
2. Add `apolloEnabled` check to contact-related prompts
3. Add `builtWithEnabled` check to technographic prompts
4. Verify usage warning prompt checks `usagePercentage >= 80`
5. Create 3 test workspaces (Apollo disabled, BuiltWith disabled, 85% usage)
6. Manual QA testing (1h) - document results

---

### Phase 5: Update tasks.md (1h)

**Files**:
- MODIFY: `specs/23-dynamic-suggested-prompts/tasks.md`

**Tasks**:
1. Mark T001-T027 as complete
2. Mark T028-T030, T032-T033, T035-T037 as complete
3. Mark T038-T039 as complete (Feature 26)
4. Mark T040-T046 as complete (Feature 26)
5. Calculate completion: ~58/61 tasks (95%)

---

## Verification & Testing

**End-to-End Test**:
1. Create feature branch: `git checkout -b 26-fix-dynamic-prompts`
2. Make all changes
3. Commit and push (triggers CI/CD deployment)
4. Check CloudWatch logs for `PromptGenerationLatency` metric
5. Test preset prompts in `#test-channel`
6. Test workspace filtering with 3 test workspaces
7. Monitor cache hit rate after 24h

**Rollback Plan**:
- Revert migration if needed
- Git revert code changes
- Redeploy via CI/CD

---

## Success Criteria

- ✅ No `.disabled` files in `src/listeners/events/`
- ✅ CloudWatch shows prompt generation active
- ✅ Preset prompts work in channels
- ✅ Workspace filtering verified via manual QA
- ✅ Cache hit rate >50% after 24h
- ✅ tasks.md shows 95%+ completion

**Total Effort**: 11-15 hours
