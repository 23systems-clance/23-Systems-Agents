# Data Model: Prompt Library & AI Configuration Management

**Feature**: 19-prompt-library
**Date**: 2026-03-12

## New Enums

### PromptCategory
```
CLASSIFIER | PARSER | GENERATOR
```
- CLASSIFIER: Intent classifiers (agentOrchestrator, orchestrator, personaClassifier)
- PARSER: Natural language parsers (filterParser)
- GENERATOR: Future text generation prompts (workflow builder agents)

### PromptVersionStatus
```
DRAFT | PUBLISHED | ARCHIVED
```
- State machine: DRAFT → PUBLISHED → ARCHIVED
- Only one PUBLISHED version per prompt at any time
- DRAFT is editable; PUBLISHED and ARCHIVED are read-only
- Publishing a DRAFT automatically archives the current PUBLISHED version

## New Models

### Prompt

The top-level prompt definition. Each prompt has a unique slug used for programmatic lookup.

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | UUID | PK, auto | Primary key |
| slug | String | Unique, indexed | Programmatic identifier (e.g., `agent-intent-classifier`) |
| displayName | String | Required | Human-readable name |
| description | String (text) | Optional | Purpose description |
| category | PromptCategory | Required | CLASSIFIER, PARSER, or GENERATOR |
| modelConfig | JSONB | Required | `{ model: string, temperature?: number, maxTokens: number }` |
| toolDefinitions | JSONB | Optional | Claude tool-use schemas (array of tool objects) |
| isActive | Boolean | Default: true | Soft-delete flag |
| createdAt | DateTime | Auto | Creation timestamp |
| updatedAt | DateTime | Auto | Last modification timestamp |

**Indexes**: `slug` (unique), `category`, `isActive`

**Relationships**:
- Has many `PromptVersion` (versions)
- Has many `PromptVariable` (via join table `PromptVariableMapping`)

### PromptVersion

A versioned snapshot of a prompt's content. Immutable once published.

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | UUID | PK, auto | Primary key |
| promptId | UUID | FK → Prompt.id | Parent prompt |
| version | Int | Auto-increment per prompt | Version number (1, 2, 3...) |
| content | String (text) | Required | Full system prompt text with {{variable}} placeholders |
| status | PromptVersionStatus | Required | DRAFT, PUBLISHED, or ARCHIVED |
| publishedBy | String | Optional | Admin user ID who published |
| publishedAt | DateTime | Optional | When published |
| changeNote | String | Optional | Human-readable change description |
| createdAt | DateTime | Auto | Creation timestamp |

**Indexes**: `(promptId, version)` unique composite, `(promptId, status)` for active version lookup

**Constraints**:
- Unique constraint: only one version per prompt can have status = PUBLISHED
- Version numbers auto-increment within a prompt (not globally)

**Relationships**:
- Belongs to `Prompt`
- Has many `PromptTestRun`

### PromptVariable

A reusable template variable definition with a global default value.

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | UUID | PK, auto | Primary key |
| name | String | Unique, indexed | Variable name (e.g., `personaTypes`) — used in `{{name}}` syntax |
| description | String | Optional | What this variable represents |
| defaultValue | String (text) | Optional | Global default value |
| createdAt | DateTime | Auto | Creation timestamp |
| updatedAt | DateTime | Auto | Last modification timestamp |

**Indexes**: `name` (unique)

**Relationships**:
- Has many `Prompt` (via join table `PromptVariableMapping`)
- Has many `WorkspacePromptOverride`

### PromptVariableMapping

Join table linking prompts to the variables they use.

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| promptId | UUID | FK → Prompt.id | Prompt using this variable |
| variableId | UUID | FK → PromptVariable.id | Variable being used |

**Indexes**: `(promptId, variableId)` unique composite

### WorkspacePromptOverride

Per-workspace variable value overrides.

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | UUID | PK, auto | Primary key |
| workspaceId | String | Required, indexed | Slack workspace/team ID |
| variableId | UUID | FK → PromptVariable.id | Variable being overridden |
| overrideValue | String (text) | Required | Workspace-specific value |
| createdAt | DateTime | Auto | Creation timestamp |
| updatedAt | DateTime | Auto | Last modification timestamp |

**Indexes**: `(workspaceId, variableId)` unique composite

**Relationships**:
- References `PromptVariable`

### PromptTestRun

Records each test execution of a draft prompt.

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | UUID | PK, auto | Primary key |
| promptVersionId | UUID | FK → PromptVersion.id | Version tested |
| inputText | String (text) | Required | Sample input used |
| outputResult | JSONB | Required | Full classification/parse result |
| tokensUsed | Int | Required | Total tokens consumed |
| inputTokens | Int | Required | Input tokens |
| outputTokens | Int | Required | Output tokens |
| estimatedCostUsd | Decimal(10,6) | Required | Cost in USD |
| durationMs | Int | Required | Execution time in ms |
| testedBy | String | Required | Admin user ID who ran the test |
| createdAt | DateTime | Auto | Execution timestamp |

**Indexes**: `promptVersionId`, `createdAt`

**Relationships**:
- Belongs to `PromptVersion`

## State Machine: PromptVersion Lifecycle

```
                    ┌─────────────────┐
                    │     DRAFT       │
                    │   (editable)    │
                    └────────┬────────┘
                             │ publish()
                             ▼
                    ┌─────────────────┐
        ┌──────────│   PUBLISHED     │──────────┐
        │          │   (active)      │          │
        │          └─────────────────┘          │
        │                                        │
        │ new version published                  │ rollback (copies content
        │ (automatic archive)                    │ to new DRAFT version)
        ▼                                        │
┌─────────────────┐                              │
│    ARCHIVED     │──────────────────────────────┘
│   (read-only)   │
└─────────────────┘
```

**Transitions**:
1. **Create** → New version starts as DRAFT
2. **Publish** → DRAFT becomes PUBLISHED; existing PUBLISHED becomes ARCHIVED (atomic transaction)
3. **Rollback** → Copies ARCHIVED version content into a new DRAFT version (does not change the archived version itself)

## Seeded Data (Migration)

Four prompts seeded on initial deploy:

| Slug | Category | Source File |
|------|----------|-------------|
| `agent-intent-classifier` | CLASSIFIER | agentOrchestrator.ts |
| `enrichment-intent-classifier` | CLASSIFIER | orchestrator.ts |
| `persona-classifier` | CLASSIFIER | personaClassifier.ts |
| `filter-parser` | PARSER | filterParser.ts |

Each seeded with:
- v1 content = current inline prompt text
- v1 status = PUBLISHED
- modelConfig = current model/temperature/maxTokens from each file
- toolDefinitions = current tool schemas from each file
- Variables extracted: `personaTypes` (persona classifier), column headers (filter parser — runtime only)

## Redis Cache Schema

| Key Pattern | Value | TTL |
|-------------|-------|-----|
| `prompt:{slug}:published` | JSON: `{ content, modelConfig, toolDefinitions, version }` | 5 min |
| `prompt:{slug}:ws:{workspaceId}` | JSON: resolved prompt with workspace overrides applied | 5 min |

**Invalidation**: On publish, delete `prompt:{slug}:*` keys (glob pattern via Redis SCAN).
