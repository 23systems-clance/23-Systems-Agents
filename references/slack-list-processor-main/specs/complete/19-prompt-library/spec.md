# Feature Specification: Prompt Library & AI Configuration Management

**Feature Branch**: `19-prompt-library`
**Created**: 2026-03-10
**Status**: Draft
**Input**: Gap analysis from sales_engineer_agents_framework.md - Section 9.4: "Store reusable prompt fragments in a prompt library, not directly in every workflow. Add versioning: draft, test, published."

## Context

The Slack List Processor currently has 4 AI classifiers with prompts hardcoded inline in TypeScript files:
1. Agent Intent Classifier (src/services/ai/agentOrchestrator.ts) — 15 intents
2. Enrichment Intent Classifier (src/services/ai/orchestrator.ts) — 5 intents
3. Persona Classifier (src/services/ai/personaClassifier.ts) — persona type mapping
4. Filter Parser (src/services/ai/filterParser.ts) — NL to structured filter

Changing any prompt requires a code change, Docker rebuild, and ECS redeploy. There is no way to A/B test prompts, customize them per client, or roll back to a previous version. This feature extracts all prompts into a database-backed prompt library with versioning, admin UI, and per-workspace overrides.

## Clarifications

### Session 2026-03-10

- Q: Should prompts be editable by workspace admins or only platform admins? -> A: Platform admins only via the admin dashboard. Workspace-level overrides (e.g., client-specific persona lists) are set by platform admins per client.
- Q: Should prompts support variables/templates? -> A: Yes. Prompts should support Handlebars-style template variables (e.g., {{personaTypes}}, {{clientName}}) that are resolved at runtime.
- Q: Should there be a test mode for prompts? -> A: Yes. Admins should be able to test a draft prompt against sample input before publishing it.
- Q: How should prompt versioning work? -> A: Three states: draft (editable), published (active in production), archived (kept for history). Only one published version per prompt at a time.
- Q: Should the prompt library support the workflow builder's future agent nodes? -> A: Yes. When agent nodes are added (spec 9 future), they should reference prompts from the library by ID.

### Session 2026-03-12

- Q: How should the 4 existing inline prompts be seeded into the prompt library? -> A: Automated database migration on deploy. The migration ensures all 4 prompts exist as v1 published before the app starts resolving them.
- Q: How should concurrent draft editing be handled? -> A: Optimistic locking. The second admin to save sees a conflict warning and can choose to overwrite or reload the latest version.
- Q: What availability target should the prompt library meet? -> A: 99.9% availability for prompt resolution. The compiled-in fallback covers the remainder, so classification never fails due to library outage.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Centralized Prompt Management (Priority: P1)

As a platform administrator, I need all AI prompts stored in a central library with version history so that I can modify, test, and roll back prompts without code deploys.

**Why this priority**: The current inline prompts require code changes for any modification. This blocks rapid iteration on AI behavior, which is critical for classification accuracy.

**Independent Test**: Modify the agent intent classifier prompt via the admin dashboard, publish it, and verify the agent uses the new prompt on the next message.

**Acceptance Scenarios**:

1. **Given** the admin dashboard prompt library page, **When** an administrator views the library, **Then** they see all registered prompts with: name, description, current version, status (draft/published), last modified date, and usage count.
2. **Given** a published prompt, **When** an administrator creates a new version, **Then** the new version starts in "draft" status and the published version continues to be used in production.
3. **Given** a draft prompt version, **When** an administrator publishes it, **Then** it becomes the active version and the previous published version is automatically archived.
4. **Given** a published prompt with 3 archived versions, **When** an administrator needs to roll back, **Then** they can select any archived version and publish it (creating a new version with the old content).
5. **Given** any prompt change, **When** the version is published, **Then** an audit log entry records who published it, when, and what changed (diff).

---

### User Story 2 - Prompt Testing (Priority: P2)

As a platform administrator, I need to test draft prompts against sample inputs before publishing, so that I can verify classification accuracy without affecting production.

**Why this priority**: Publishing an untested prompt could break intent classification for all users. Testing provides a safety net.

**Independent Test**: Create a draft version of the agent classifier prompt, test it against 5 sample messages, and verify the classification results are displayed.

**Acceptance Scenarios**:

1. **Given** a draft prompt version, **When** an administrator clicks "Test", **Then** they see a test panel with an input field for sample text and a "Run Test" button.
2. **Given** the test panel, **When** an administrator enters a sample message and clicks "Run Test", **Then** the system runs the draft prompt against the sample input using the configured model and displays the classification result.
3. **Given** a test result, **When** the administrator views it, **Then** they see: the classified intent/output, confidence score, token usage, and estimated cost.
4. **Given** multiple test runs, **When** an administrator reviews them, **Then** all test results for that draft version are shown in a list for comparison.

---

### User Story 3 - Per-Workspace Prompt Overrides (Priority: P2)

As a platform administrator, I need to customize specific prompt variables per workspace so that client-specific context (persona types, industry terms, company names) can be injected without creating separate prompt versions.

**Why this priority**: Different clients have different ICP definitions, persona types, and industry terminology. Template variables allow customization without duplicating entire prompts.

**Independent Test**: Set a workspace-level variable override for {{personaTypes}} that includes a custom persona. Trigger the persona classifier and verify the custom persona is recognized.

**Acceptance Scenarios**:

1. **Given** a prompt with template variable {{personaTypes}}, **When** the prompt is resolved at runtime, **Then** the variable is replaced with the workspace's configured persona type list (or the global default if no override exists).
2. **Given** a workspace-level variable override, **When** an administrator sets {{companyName}} to "Acme Corp" for workspace W1, **Then** all prompts using {{companyName}} in workspace W1 resolve to "Acme Corp".
3. **Given** a workspace with no overrides, **When** a prompt with template variables runs, **Then** all variables resolve to their global default values.
4. **Given** a template variable that has no value (no default and no override), **When** the prompt is resolved, **Then** the variable placeholder is removed (empty string) and a warning is logged.

---

### Edge Cases

- What happens when a published prompt is deleted? Prompts cannot be deleted, only archived. The system always needs a fallback.
- What happens when the prompt library database is unavailable? The system falls back to the compiled-in default prompts (the current inline prompts become the emergency fallback).
- What happens when a template variable is malformed (missing closing braces)? The system logs a warning and passes the raw text through without replacement.
- What happens when two administrators try to publish different drafts simultaneously? The last publish wins. Both actions are logged in the audit trail.
- What happens when two administrators edit the same draft simultaneously? Optimistic locking detects the conflict on save. The second admin is warned and can overwrite or reload the latest version.
- What happens when a prompt's token count exceeds the model's context window? The test panel warns about token count. The system truncates context history, not the system prompt.

## Requirements _(mandatory)_

### Functional Requirements

**Prompt Storage**
- **FR-001**: System MUST store all AI prompts in a database-backed prompt library, not inline in code.
- **FR-002**: Each prompt MUST have: a unique slug (identifier), display name, description, category (classifier, parser, generator), model configuration (model name, temperature, max tokens), and tool definitions (if applicable).
- **FR-003**: System MUST support prompt versioning with states: draft (editable), published (active), archived (read-only).
- **FR-004**: Only one version of a prompt MUST be in "published" state at any time.
- **FR-005**: System MUST maintain a complete version history for each prompt (no deletions).

**Template Variables**
- **FR-006**: Prompts MUST support Handlebars-style template variables (e.g., {{variableName}}).
- **FR-007**: Template variables MUST be resolvable at runtime from: global defaults, workspace-level overrides, and job-level context.
- **FR-008**: Resolution priority MUST be: job context > workspace override > global default > empty string.

**Prompt Resolution at Runtime**
- **FR-009**: The AI services (agentOrchestrator, orchestrator, personaClassifier, filterParser) MUST load prompts from the library at runtime instead of using inline strings.
- **FR-010**: Prompt loading MUST be cached in Redis with a short TTL (5 minutes) to avoid database queries on every AI call.
- **FR-011**: When the prompt library is unavailable, the system MUST fall back to compiled-in default prompts.

**Admin Interface**
- **FR-012**: The admin dashboard MUST provide a prompt library page listing all prompts with search and filter by category.
- **FR-013**: The admin dashboard MUST provide a prompt editor with syntax highlighting for template variables.
- **FR-014**: The admin dashboard MUST provide a test panel for running draft prompts against sample inputs.
- **FR-015**: The admin dashboard MUST provide a version history view with diff between versions.
- **FR-016**: The admin dashboard MUST provide a workspace variable override configuration page.

**Audit & Safety**
- **FR-017**: All prompt publishes MUST be recorded in the audit log with: admin identity, prompt slug, version number, and timestamp.
- **FR-018**: System MUST prevent publishing a prompt that has not been tested at least once (configurable: can be disabled).

### Key Entities

- **Prompt**: A registered AI prompt. Contains: slug (unique), displayName, description, category (CLASSIFIER, PARSER, GENERATOR), modelConfig (JSONB: model, temperature, maxTokens), toolDefinitions (JSONB, optional), createdAt, updatedAt.
- **PromptVersion**: A versioned snapshot of a prompt's content. Contains: promptId, version (integer, auto-increment), content (text - the full system prompt), status (DRAFT, PUBLISHED, ARCHIVED), publishedBy, publishedAt, createdAt.
- **PromptVariable**: A template variable definition. Contains: name (unique, e.g., "personaTypes"), description, defaultValue. Related to Prompt via PromptVariableMapping join table (many-to-many — a variable can be used across multiple prompts).
- **PromptVariableMapping**: Join table linking Prompt to PromptVariable. Contains: promptId (FK → Prompt), variableId (FK → PromptVariable).
- **WorkspacePromptOverride**: A workspace-level variable override. Contains: workspaceId, variableId (FK → PromptVariable), overrideValue.
- **PromptTestRun**: A test execution record. Contains: promptVersionId, inputText, outputResult (JSONB), tokensUsed, inputTokens, outputTokens, estimatedCostUsd (Decimal), durationMs, testedBy, createdAt. Test costs are also recorded in ApiUsageLog for the cost tracking dashboard.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: All 4 AI classifiers load prompts from the library at runtime (zero inline prompts remaining in production code paths).
- **SC-002**: Prompt changes take effect within 5 minutes of publishing (Redis cache TTL).
- **SC-003**: Prompt library fallback activates correctly when the database is unavailable (zero classification failures due to library outage).
- **SC-004**: Administrators can modify, test, and publish a prompt in under 5 minutes via the admin dashboard.
- **SC-005**: Complete version history is preserved for all prompts (zero data loss on version transitions).
- **SC-006**: Per-workspace variable overrides correctly customize prompt behavior for the target workspace only (zero cross-workspace leakage).
- **SC-007**: Prompt resolution achieves 99.9% availability; compiled-in fallback ensures zero classification failures during the remaining downtime.

## Assumptions

- The 4 existing inline prompts are seeded as "v1 published" versions via an automated database migration that runs on deploy, ensuring prompts exist before the app resolves them.
- The compiled-in default prompts remain in the codebase as emergency fallbacks but are not used in normal operation.
- Redis prompt caching uses a 5-minute TTL to balance freshness with performance. Cache is invalidated on publish.
- The prompt editor is a simple text area with template variable highlighting, not a full IDE.
- Tool definitions (for Claude's tool use) are stored alongside the prompt in JSONB format. The tool schema is part of the prompt configuration.
- Template variable resolution uses simple string replacement (not a full Handlebars engine). Only {{variableName}} syntax is supported.
- The "test prompt" feature calls the actual Claude API with the draft prompt, consuming real tokens. Test costs are tracked in ApiUsageLog.
