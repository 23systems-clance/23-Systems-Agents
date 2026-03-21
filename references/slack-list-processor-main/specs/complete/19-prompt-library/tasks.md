# Tasks: Prompt Library & AI Configuration Management

**Input**: Design documents from `/specs/19-prompt-library/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/prompts-api.yaml, quickstart.md

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Schema, enums, and foundational configuration that all user stories depend on.

- [x] T001 Add PromptCategory and PromptVersionStatus enums to prisma/schema.prisma — values: `CLASSIFIER | PARSER | GENERATOR` and `DRAFT | PUBLISHED | ARCHIVED`
- [x] T002 Add Prompt model to prisma/schema.prisma with fields: id (uuid), slug (unique), displayName, description (text, optional), category (PromptCategory), modelConfig (JsonB), toolDefinitions (JsonB, optional), isActive (boolean, default true), createdAt, updatedAt. Map to table `prompts`. Add indexes on slug (unique), category, isActive
- [x] T003 Add PromptVersion model to prisma/schema.prisma with fields: id (uuid), promptId (FK → Prompt), version (int), content (text), status (PromptVersionStatus), publishedBy (optional), publishedAt (optional), changeNote (optional), createdAt. Map to table `prompt_versions`. Add unique composite index on (promptId, version) and index on (promptId, status). Add relation to Prompt
- [x] T004 Add PromptVariable model to prisma/schema.prisma with fields: id (uuid), name (unique), description (optional), defaultValue (text, optional), createdAt, updatedAt. Map to table `prompt_variables`. Add unique index on name
- [x] T005 Add PromptVariableMapping model to prisma/schema.prisma as implicit many-to-many join table between Prompt and PromptVariable with unique composite on (promptId, variableId). Map to table `prompt_variable_mappings`
- [x] T006 Add WorkspacePromptOverride model to prisma/schema.prisma with fields: id (uuid), workspaceId, variableId (FK → PromptVariable), overrideValue (text), createdAt, updatedAt. Map to table `workspace_prompt_overrides`. Add unique composite index on (workspaceId, variableId)
- [x] T007 Add PromptTestRun model to prisma/schema.prisma with fields: id (uuid), promptVersionId (FK → PromptVersion), inputText (text), outputResult (JsonB), tokensUsed (int), inputTokens (int), outputTokens (int), estimatedCostUsd (Decimal(10,6)), durationMs (int), testedBy, createdAt. Map to table `prompt_test_runs`. Add indexes on promptVersionId and createdAt
- [x] T008 Add prompt-specific audit actions to src/lib/auditLogger.ts — add to AuditAction type: `prompt_created`, `prompt_updated`, `prompt_version_created`, `prompt_published`, `prompt_archived`, `prompt_tested`, `prompt_variable_created`, `prompt_variable_updated`, `prompt_override_set`, `prompt_override_removed`
- [x] T008b Generate and apply Prisma migration — run `npx prisma migrate dev --name add-prompt-library` to create migration for all new models and enums. Verify migration applies cleanly and `npx prisma generate` succeeds. Depends on T001–T007

**Checkpoint**: Schema, audit actions, and migration applied. `npx prisma generate` confirms types available.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core backend services that MUST be complete before any user story can be implemented.

**CRITICAL**: No user story work can begin until this phase is complete.

- [x] T009 [P] Extract inline prompts from 4 AI services into src/services/ai/defaultPrompts.ts — export named constants for each prompt: `AGENT_INTENT_CLASSIFIER_PROMPT` (from agentOrchestrator.ts), `ENRICHMENT_INTENT_CLASSIFIER_PROMPT` (from orchestrator.ts), `PERSONA_CLASSIFIER_PROMPT` (from personaClassifier.ts), `FILTER_PARSER_PROMPT` (from filterParser.ts). Include system prompt text, model config (model name, temperature, maxTokens), and tool definition schemas for each
- [x] T010 [P] Implement template engine in src/services/ai/templateEngine.ts — export `resolveTemplateVariables(content: string, context: Record<string, string>): string` using regex `/\{\{(\w+)\}\}/g`. Implement 3-tier resolution: job context > workspace override > global default > empty string. Log warning for unresolved variables. Handle malformed syntax (missing closing braces) gracefully by passing raw text through
- [x] T011 Implement prompt resolver in src/services/ai/promptResolver.ts — export `resolvePrompt(slug: string, workspaceId?: string, jobContext?: Record<string, string>): Promise<ResolvedPrompt>`. Resolution chain: Redis cache → Prisma DB → compiled-in default (from defaultPrompts.ts). Cache resolved prompts in Redis with key `prompt:{slug}:published` (5-min TTL). Return `{ content, modelConfig, toolDefinitions, version }`. Include `invalidateCache(slug: string)` to delete `prompt:{slug}:*` keys on publish. Depends on T009, T010
- [x] T012 Create idempotent seed script in prisma/seed-prompts.ts — upsert 4 prompts (agent-intent-classifier, enrichment-intent-classifier, persona-classifier, filter-parser) with their v1 content, model configs, and tool definitions from defaultPrompts.ts. Set v1 status = PUBLISHED. Extract and seed template variables (personaTypes). Wire into prisma/seed.ts or package.json prisma.seed. Depends on T009
- [x] T013 Mount prompt admin router in src/routes/admin/index.ts — import and mount prompt routes at `/prompts` path after adminAuth middleware. Create empty src/routes/admin/prompts.ts with Express Router scaffold

**Checkpoint**: Foundation ready — prompt resolver can load from DB/cache/fallback, seed populates initial data. User story implementation can now begin.

---

## Phase 3: User Story 1 — Centralized Prompt Management (Priority: P1) — MVP

**Goal**: All AI prompts stored in a central library with version history. Admins can view, edit, create versions, publish, roll back, and see diffs — all without code deploys.

**Independent Test**: Modify the agent intent classifier prompt via the admin dashboard, publish it, and verify the agent uses the new prompt on the next Slack message.

### Backend API (US1)

- [x] T014 [US1] Implement prompt CRUD endpoints in src/routes/admin/prompts.ts — `GET /prompts` (list with category/search/isActive filters, include computed `usageCount` per prompt by counting ApiUsageLog entries where metadata contains the prompt slug), `POST /prompts` (create with slug uniqueness check, optional initialContent creates a DRAFT v1), `GET /prompts/:slug` (detail with versions, variables, published version), `PATCH /prompts/:slug` (update metadata: displayName, description, category, modelConfig, toolDefinitions). Follow existing admin route response patterns `{ prompts: [...], total: N }`. Add audit logging for prompt_created, prompt_updated
- [x] T015 [US1] Implement version management endpoints in src/routes/admin/prompts.ts — `GET /prompts/:slug/versions` (list with optional status filter), `POST /prompts/:slug/versions` (create new DRAFT, auto-increment version number, optional copyFromVersionId for rollback), `GET /prompts/:slug/versions/:versionId` (get specific version), `PATCH /prompts/:slug/versions/:versionId` (update DRAFT content with optimistic locking: require updatedAt in request body, return 409 Conflict if mismatch, return 422 if version is not DRAFT). Add audit logging for prompt_version_created
- [x] T016 [US1] Implement publish endpoint in src/routes/admin/prompts.ts — `POST /prompts/:slug/versions/:versionId/publish`. Validate version is DRAFT. In a Prisma transaction: set current PUBLISHED version to ARCHIVED, set target version to PUBLISHED with publishedBy and publishedAt. Call `promptResolver.invalidateCache(slug)` to bust Redis. Add audit logging for prompt_published and prompt_archived. Return 422 if version is not DRAFT
- [x] T017 [US1] Implement diff endpoint in src/routes/admin/prompts.ts — `GET /prompts/:slug/diff?from=uuid&to=uuid`. Install `diff` npm package (`npm install diff && npm install -D @types/diff`). Load both version contents, compute unified diff using `createTwoFilesPatch` from the `diff` library. Return `{ from: { version, content }, to: { version, content }, diff: string }`

### Refactor AI Services (US1)

- [x] T018 [P] [US1] Refactor src/services/ai/agentOrchestrator.ts to use promptResolver — replace inline system prompt and model config with `const resolved = await promptResolver.resolvePrompt('agent-intent-classifier', workspaceId)`. Use resolved.content as system prompt, resolved.modelConfig for model/temperature/maxTokens, resolved.toolDefinitions for tool schemas. Include prompt slug (`agent-intent-classifier`) in ApiUsageLog metadata so usage count can be computed. Keep inline prompt as import from defaultPrompts.ts for fallback reference only. Depends on T011
- [x] T019 [P] [US1] Refactor src/services/ai/orchestrator.ts to use promptResolver — replace inline system prompt with `promptResolver.resolvePrompt('enrichment-intent-classifier')`. Use resolved content and model config. Include prompt slug in ApiUsageLog metadata. Depends on T011
- [x] T020 [P] [US1] Refactor src/services/ai/personaClassifier.ts to use promptResolver — replace inline system prompt with `promptResolver.resolvePrompt('persona-classifier')`. Handle both single and batch classification paths. Include prompt slug in ApiUsageLog metadata. Keep static personaLookup table unchanged (deterministic fast path). Depends on T011
- [x] T021 [P] [US1] Refactor src/services/ai/filterParser.ts to use promptResolver — replace inline system prompt with `promptResolver.resolvePrompt('filter-parser')`. Note: column headers and sample data are injected at runtime as job context, not stored in the prompt template. Include prompt slug in ApiUsageLog metadata. Depends on T011

### Frontend (US1)

- [x] T022 [P] [US1] Create frontend API client in admin-dashboard/src/services/prompts.ts — export functions: `fetchPrompts(params)`, `fetchPromptBySlug(slug)`, `createPrompt(data)`, `updatePrompt(slug, data)`, `fetchVersions(slug)`, `createVersion(slug, data)`, `updateVersion(slug, versionId, data)`, `publishVersion(slug, versionId)`, `fetchDiff(slug, fromId, toId)`. Use existing axios `api` client from admin-dashboard/src/lib/api-client.ts. All endpoints under `/prompts`
- [x] T023 [P] [US1] Add prompt query keys to admin-dashboard/src/lib/query-keys.ts — add keys: `prompts.list(params)`, `prompts.detail(slug)`, `prompts.versions(slug)`, `prompts.diff(slug, from, to)`. Follow existing query key patterns
- [x] T024 [US1] Create PromptListPage in admin-dashboard/src/pages/prompts/PromptListPage.tsx — table listing all prompts with columns: name, slug, category (badge), status (published version status badge), current version number, last modified date. Include search input and category filter dropdown. Use existing shadcn/ui Table, Input, Select, Badge components. Link each row to `/prompts/:slug`. Depends on T022, T023
- [x] T025 [US1] Create PromptDetailPage in admin-dashboard/src/pages/prompts/PromptDetailPage.tsx — load prompt by slug from URL param. Show: prompt metadata (editable name, description, category), model config editor (model selector, temperature slider, maxTokens input), current published version content (read-only), draft version editor (textarea with template variable highlighting via regex `{{...}}`), version history list with status badges. Actions: "Create New Version" button (opens editor with copy from published), "Publish" button (with confirmation dialog), "Rollback" (select archived version, creates new draft with that content). Handle optimistic locking 409 errors with conflict dialog. Depends on T022, T023
- [x] T026 [US1] Create PromptDiffView component in admin-dashboard/src/pages/prompts/PromptDiffView.tsx — side-by-side or unified diff display. Accept two version IDs, fetch diff via API. Highlight additions (green) and deletions (red). Show version numbers and timestamps above each side. Integrate into PromptDetailPage version history (click "Compare" between any two versions). Depends on T022
- [x] T027 [US1] Add prompt routes to admin-dashboard/src/router.tsx — add `/prompts` (PromptListPage) and `/prompts/:slug` (PromptDetailPage) routes inside RequireAuth. Add "Prompt Library" item to sidebar navigation (use BookOpen or FileText icon from lucide-react). Follow existing lazy-loading pattern with React.lazy

**Checkpoint**: US1 complete. Admin can list prompts, create/edit versions, publish, rollback, see diffs. All 4 AI services load prompts from the library. Verify by editing a prompt in the dashboard, publishing, and confirming the AI service uses the new version.

---

## Phase 4: User Story 2 — Prompt Testing (Priority: P2)

**Goal**: Admins can test draft prompts against sample inputs before publishing, seeing classification results, token usage, and estimated cost.

**Independent Test**: Create a draft version of the agent classifier prompt, test it against 5 sample messages, and verify classification results are displayed with token usage and cost.

### Backend API (US2)

- [x] T028 [US2] Implement test execution endpoint in src/routes/admin/prompts.ts — `POST /prompts/:slug/versions/:versionId/test`. Accept `{ inputText, workspaceId? }`. Load version content and parent prompt's modelConfig/toolDefinitions. If workspaceId provided, resolve template variables with workspace overrides. Call Claude API using @anthropic-ai/sdk with the draft prompt as system message, inputText as user message, and tool definitions. Capture result, token usage (input/output), duration. Calculate cost via costCalculator.ts. Persist as PromptTestRun record AND insert into ApiUsageLog (service: AI_ORCHESTRATOR or new PROMPT_TEST value, with prompt slug in metadata) so test costs appear in the cost tracking dashboard. Add audit logging for prompt_tested. Return full PromptTestRun response
- [x] T029 [US2] Implement test run listing endpoint in src/routes/admin/prompts.ts — `GET /prompts/:slug/versions/:versionId/test-runs`. Return all test runs for that version ordered by createdAt desc. Include `{ testRuns: [...], total: N }` response format

### Frontend (US2)

- [x] T030 [US2] Create PromptTestPanel component in admin-dashboard/src/pages/prompts/PromptTestPanel.tsx — panel with: textarea for sample input text, optional workspace selector dropdown (fetch workspaces from existing API), "Run Test" button with loading state. Display test results: classified intent/output (formatted JSON), confidence score (if present), token usage (input/output/total), estimated cost (formatted as $X.XXXX), duration in ms. Show test run history list below with all previous runs for the current draft version. Use shadcn/ui Card, Button, Textarea, Select, Badge, Skeleton components
- [x] T031 [US2] Add test panel API functions to admin-dashboard/src/services/prompts.ts — export `runPromptTest(slug, versionId, data)` and `fetchTestRuns(slug, versionId)`. Add query keys `prompts.testRuns(slug, versionId)` to admin-dashboard/src/lib/query-keys.ts
- [x] T032 [US2] Integrate PromptTestPanel into PromptDetailPage — add a "Test" tab or expandable section in PromptDetailPage that shows PromptTestPanel for the current draft version. Only visible when a DRAFT version exists. Disable "Publish" button and show tooltip "Run at least one test before publishing" if FR-018 test gate is enabled and no test runs exist for the draft

**Checkpoint**: US2 complete. Admin can test any draft prompt with sample inputs. Test results display classification, tokens, and cost. Test history preserved per version. Publish gate enforced if configured.

---

## Phase 5: User Story 3 — Per-Workspace Prompt Overrides (Priority: P2)

**Goal**: Platform admins can customize template variable values per workspace, so client-specific context (persona types, industry terms) is injected into prompts without duplicating prompt versions.

**Independent Test**: Set a workspace-level override for {{personaTypes}} that includes a custom persona. Trigger the persona classifier and verify the custom persona is recognized.

### Backend API (US3)

- [x] T033 [US3] Implement variable CRUD endpoints in src/routes/admin/prompts.ts — `GET /prompts/variables` (list all variables with prompt count), `POST /prompts/variables` (create with name uniqueness, validate name pattern `^[a-zA-Z][a-zA-Z0-9_]*$`), `PATCH /prompts/variables/:variableId` (update description, defaultValue). Add audit logging for prompt_variable_created, prompt_variable_updated
- [x] T034 [US3] Implement workspace override endpoints in src/routes/admin/prompts.ts — `GET /prompts/variables/overrides` (list overrides, optional workspaceId filter), `PUT /prompts/variables/overrides` (upsert: create or update override for workspaceId + variableId combo), `DELETE /prompts/variables/overrides?workspaceId=X&variableId=Y` (remove override). Invalidate Redis cache for affected prompts on override change. Add audit logging for prompt_override_set, prompt_override_removed
- [x] T035 [US3] Integrate workspace override resolution into promptResolver.ts — update `resolvePrompt()` to: load workspace overrides from DB (or Redis cache) when workspaceId is provided, merge with global variable defaults, pass combined context to templateEngine.resolveTemplateVariables(). Cache workspace-resolved prompts under key `prompt:{slug}:ws:{workspaceId}` with 5-min TTL

### Frontend (US3)

- [x] T036 [US3] Add variable API functions to admin-dashboard/src/services/prompts.ts — export `fetchVariables()`, `createVariable(data)`, `updateVariable(variableId, data)`, `fetchOverrides(workspaceId?)`, `setOverride(data)`, `deleteOverride(workspaceId, variableId)`. Add query keys `prompts.variables`, `prompts.overrides(workspaceId)` to query-keys.ts
- [x] T037 [US3] Create VariableOverridesPage in admin-dashboard/src/pages/prompts/VariableOverridesPage.tsx — two sections: (1) Global Variables table with columns: name, description, default value, prompt count, edit button. Inline editing for description and default value. "Add Variable" button with dialog. (2) Workspace Overrides section: workspace selector dropdown, then table showing all variables with their override values for the selected workspace. Inline editing for override values. "Add Override" button. Clear override (delete) action. Use shadcn/ui Table, Dialog, Input, Button, Select components
- [x] T038 [US3] Add variable overrides route to admin-dashboard/src/router.tsx — add `/prompts/variables` route (VariableOverridesPage) inside RequireAuth. Add "Variables" sub-item under "Prompt Library" in sidebar navigation

**Checkpoint**: US3 complete. Admin can manage template variables, set global defaults, and configure per-workspace overrides. Prompts resolve with correct variable values based on workspace context.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Final integration, validation, and deployment.

- [x] T039 Verify FR-018 test-before-publish gate — ensure publish endpoint checks for at least one PromptTestRun for the draft version when gate is enabled. Add config flag (e.g., `PROMPT_TEST_REQUIRED=true` in environment) to make the gate configurable
- [x] T040 Verify optimistic locking works end-to-end — confirm PATCH version endpoint returns 409 when updatedAt mismatch, and frontend PromptDetailPage shows conflict dialog with "Reload" and "Overwrite" options
- [x] T041 Verify fallback chain — confirm promptResolver correctly falls back to compiled-in defaults when Redis and DB are both unavailable (test by temporarily returning errors from DB/Redis)
- [x] T042 [P] Build and deploy admin dashboard frontend — run `cd admin-dashboard && npm run build`, then `aws s3 sync dist/ s3://slkadmin-developerlabs-ai/ --delete`, then `aws cloudfront create-invalidation --distribution-id E30ZVBVU06GFUV --paths "/*"`
- [x] T043 End-to-end validation on deployed ECS — edit a prompt via admin dashboard → test with sample input → publish → send a Slack message that triggers the classifier → verify the new prompt was used (check CloudWatch logs for the resolved prompt version)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies — start immediately. Tasks T001–T007 are sequential (schema models build on each other). T008 is independent.
- **Phase 2 (Foundational)**: Depends on Phase 1 completion (Prisma schema must exist). T009 and T010 can run in parallel. T011 depends on T009 + T010. T012 depends on T009. T013 is independent.
- **Phase 3 (US1)**: Depends on Phase 2. Backend API (T014–T017) can start immediately. AI service refactors (T018–T021) depend on T011 and can run in parallel. Frontend (T022–T027) can start in parallel with backend.
- **Phase 4 (US2)**: Depends on Phase 3 backend (T014–T016 for prompt/version endpoints). Can overlap with US1 frontend.
- **Phase 5 (US3)**: Depends on Phase 2 (T011 resolver) and Phase 3 (T014 prompt CRUD). Can run in parallel with US2.
- **Phase 6 (Polish)**: Depends on all user stories being complete.

### User Story Dependencies

- **US1 (P1)**: Depends on Foundational (Phase 2) only — no dependency on other stories
- **US2 (P2)**: Depends on US1 backend (prompt/version CRUD must exist for test endpoints to reference)
- **US3 (P2)**: Depends on Phase 2 resolver; can start before US1 frontend is complete

### Parallel Opportunities

**Within Phase 2**:
- T009 (defaultPrompts) || T010 (templateEngine) — different files, no dependency
- T012 (seed) can start once T009 is done

**Within US1**:
- T018 || T019 || T020 || T021 — all 4 AI service refactors are independent files
- T022 (API client) || T023 (query keys) — different files
- Backend (T014–T017) || Frontend (T022–T023) — different codebases

**Across User Stories**:
- US2 backend (T028–T029) || US3 backend (T033–T035) — after US1 backend is done
- US2 frontend (T030–T032) || US3 frontend (T036–T038) — independent UI pages

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (T001–T008)
2. Complete Phase 2: Foundational (T009–T013)
3. Complete Phase 3: User Story 1 (T014–T027)
4. **STOP and VALIDATE**: Test by editing a prompt in admin dashboard, publishing, and verifying the AI service uses the new version in Slack
5. Deploy and verify in production

### Incremental Delivery

1. Setup + Foundational → Schema + core services ready
2. Add US1 → Prompt management with versioning → Deploy (MVP!)
3. Add US2 → Prompt testing before publish → Deploy
4. Add US3 → Per-workspace variable overrides → Deploy
5. Polish → Verify gates, fallbacks, end-to-end → Final deploy
6. Each story adds value without breaking previous stories
