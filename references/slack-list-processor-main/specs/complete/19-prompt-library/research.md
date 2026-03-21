# Research: Prompt Library & AI Configuration Management

**Feature**: 19-prompt-library
**Date**: 2026-03-12

## R-001: Prompt Versioning & Storage Strategy

**Decision**: Dedicated Prisma models (`Prompt` + `PromptVersion`) with version state machine (DRAFT → PUBLISHED → ARCHIVED).

**Rationale**: The codebase already uses Prisma for all data modeling (Job, AuditLog, WorkspaceSettings, etc.). A dedicated model with a separate version table mirrors the existing pattern (e.g., Workflow + WorkflowVersion in spec 9). Storing full prompt content per version enables diff comparisons and rollback without Git history dependency. JSONB fields for `modelConfig` and `toolDefinitions` match the existing `parsedIntent`/`settingsOverrides` patterns in the Job model.

**Alternatives considered**:
- **Single model with JSON version array**: Rejected — would grow unbounded and make querying active versions expensive.
- **Git-based versioning**: Rejected — requires code deploys to change prompts, which is the exact problem being solved.
- **External prompt management service (PromptLayer, Langfuse)**: Rejected — adds external dependency, egress costs, and doesn't integrate with existing admin dashboard.

## R-002: Template Variable Resolution

**Decision**: Simple regex-based `{{variableName}}` replacement with 3-tier priority: job context > workspace override > global default > empty string.

**Rationale**: The spec explicitly states "simple string replacement, not a full Handlebars engine." A regex like `/\{\{(\w+)\}\}/g` handles the required syntax. The 3-tier resolution mirrors how the existing `settingsOverrides` field on Job already allows per-job config to override workspace defaults. No need for conditionals, loops, or partials — these would add complexity without matching any current use case.

**Alternatives considered**:
- **Full Handlebars engine**: Rejected — overkill for variable substitution; adds 50KB dependency and potential security concerns with template injection.
- **Mustache.js**: Rejected — still heavier than needed; introduces concept of sections/partials we don't use.
- **Tagged template literals**: Rejected — not portable to non-TypeScript consumers (future workflow builder agents).

## R-003: Redis Caching Strategy for Prompts

**Decision**: Cache resolved prompts in Redis with 5-minute TTL. Cache key: `prompt:{slug}:v:published` for global, `prompt:{slug}:ws:{workspaceId}` for workspace-resolved. Invalidate on publish via explicit key deletion.

**Rationale**: The codebase already uses IORedis (`src/lib/redis.ts`) with BullMQ. Adding prompt caching follows the established pattern. 5-minute TTL balances freshness (admin publishes take effect within 5 min) with performance (avoids DB query per AI call). The existing `cacheConfig.ts` pattern can be extended. Active invalidation on publish means most changes propagate instantly — the TTL is only a safety net for edge cases.

**Alternatives considered**:
- **In-memory cache (Map/LRU)**: Rejected — doesn't survive ECS task restarts; also each ECS task would have its own stale cache if scaled to multiple tasks.
- **No cache (always query DB)**: Rejected — adds ~5-10ms latency per AI call; with 4 classifiers running frequently, this compounds.
- **Longer TTL (30 min)**: Rejected — too slow for admin iteration workflow; spec requires changes within 5 minutes.

## R-004: Fallback Strategy for Compiled-In Defaults

**Decision**: Keep current inline prompts as static constants exported from a `src/services/ai/defaultPrompts.ts` file. The prompt resolution service tries Redis → DB → fallback constant, in that order.

**Rationale**: The 4 existing inline prompts in agentOrchestrator.ts, orchestrator.ts, personaClassifier.ts, and filterParser.ts represent known-good configurations. Extracting them into a dedicated defaults file ensures they're available even if both Redis and PostgreSQL are down. This three-tier resolution (cache → DB → compiled default) gives 99.9%+ effective availability.

**Alternatives considered**:
- **No fallback (fail-closed)**: Rejected — classification failures break the entire bot; unacceptable for a production Slack integration.
- **Fallback to last-known-good from local file**: Rejected — ECS Fargate containers are ephemeral; local file state is unreliable.

## R-005: Prompt Seeding via Database Migration

**Decision**: Prisma seed script (`prisma/seed.ts`) with idempotent upsert logic. Seeds 4 prompts with their v1 content, model configs, and tool definitions. Runs as part of the deploy pipeline.

**Rationale**: The clarification session confirmed automated migration on deploy. Prisma's `upsert` (findOrCreate pattern) ensures idempotency — re-running the seed won't duplicate prompts. The seed extracts prompt content, model config, and tool schemas from the current inline definitions to ensure exact parity on first deploy.

**Alternatives considered**:
- **Manual SQL migration**: Rejected — error-prone for large JSON tool definitions; Prisma seed is type-safe.
- **Admin UI manual entry**: Rejected — clarification explicitly chose automated approach.

## R-006: Optimistic Locking for Concurrent Edits

**Decision**: Add `updatedAt` timestamp check on save. Client sends the `updatedAt` value it loaded. Server rejects if DB `updatedAt` differs (409 Conflict response). Frontend shows conflict dialog: "This prompt was modified by another user. Reload or overwrite?"

**Rationale**: Clarification session chose optimistic locking. This is the simplest approach that prevents silent data loss. The existing Prisma model pattern already includes `updatedAt` on all models, so no schema changes needed for the lock field itself. The 409 response pattern is standard REST.

**Alternatives considered**:
- **Version counter instead of timestamp**: Considered but timestamp is already present on all Prisma models; adding a counter is redundant.
- **WebSocket-based real-time collaboration**: Rejected — massively overengineered for an admin tool used by 1-3 people.

## R-007: Admin Dashboard Integration Pattern

**Decision**: New admin route group at `/api/v1/admin/prompts` with subroutes. Frontend pages at `/prompts` (list), `/prompts/:slug` (detail/edit), `/prompts/:slug/test` (test panel), and `/prompts/variables` (workspace overrides). Uses existing adminAuth middleware, TanStack React Query, and shadcn/ui components.

**Rationale**: Mirrors exact patterns from existing admin features (campaigns, workflows, enrichment presets). The admin dashboard already has the full stack: auth middleware, API client with axios, React Query for data fetching, shadcn/ui for components, and the sidebar navigation pattern. Adding a new section follows the established convention.

**Key patterns to follow**:
- Route file: `src/routes/admin/prompts.ts` (like `campaigns.ts`, `workflows.ts`)
- Frontend service: `admin-dashboard/src/services/prompts.ts`
- Frontend pages: `admin-dashboard/src/pages/prompts/` directory
- Query keys: extend `admin-dashboard/src/lib/query-keys.ts`

## R-008: Audit Logging Integration

**Decision**: Add new audit actions: `prompt_created`, `prompt_version_created`, `prompt_published`, `prompt_archived`, `prompt_tested`, `prompt_variable_override_set`. Use existing `logAudit()` function with metadata containing prompt slug, version number, and diff summary.

**Rationale**: The existing audit logger (`src/lib/auditLogger.ts`) already has 80+ canonical actions and a fire-and-forget pattern. Adding prompt-specific actions follows the exact same pattern. The metadata field (JSON) can store diff information without schema changes.

## R-009: Test Panel Architecture

**Decision**: Test execution calls the actual Claude API via a dedicated test endpoint (`POST /api/v1/admin/prompts/:slug/test`). The endpoint accepts draft version ID and sample input, runs the prompt with the configured model/tools, and returns classification result + token usage + cost. Results are persisted in `PromptTestRun` table.

**Rationale**: The spec requires testing against real AI behavior. The existing `costCalculator.ts` provides token-to-cost conversion. Persisting test runs enables comparison across iterations (spec acceptance scenario: "all test results for that draft version are shown in a list").

**Cost considerations**: Each test consumes real Claude API tokens. At Haiku pricing ($0.0008/1K input, $0.004/1K output), a typical classifier test costs ~$0.001-0.003. With FR-018 requiring at least one test before publish, the minimum cost per prompt update is negligible.
