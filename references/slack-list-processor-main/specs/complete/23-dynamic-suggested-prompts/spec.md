# Feature Specification: Dynamic Suggested Prompts

**Feature Branch**: `23-dynamic-suggested-prompts`
**Created**: 2026-03-12
**Status**: Draft
**Input**: User description: "Enhance the Slack Agent/Assistant's suggested prompts from static defaults to a fully dynamic, context-aware system. When a user opens the agent side-panel or switches channels, the app should generate intelligent, personalized prompt suggestions based on the user's recent activity, active jobs, channel context, workspace configuration, and uploaded documents — replacing the current hardcoded DEFAULT_PROMPTS with an adaptive prompt engine."

## Clarifications

### Session 2026-03-12

- Q: Should prompt generation use rule-based logic, hybrid (rules + LLM), or full LLM-powered generation? → A: Pure rule-based — deterministic priority algorithm with prompt templates, no LLM calls. This keeps generation within the 500ms budget and avoids per-call AI costs.
- Q: How should the system detect a suggested prompt click vs. manual text input for analytics? → A: Message text matching — compare incoming message against the last-set prompts for the thread; exact match = click attribution. False positives from manually typing identical text are negligible.
- Q: What lookback window for completed jobs should influence follow-up prompts? → A: 48 hours — covers "yesterday's work" for users returning the next business day. Failed jobs remain at 24h. Active jobs have no time limit (always shown while running).
- Q: How long should prompt click analytics data (PromptClickEvent) be retained? → A: 90 days. Aligns with existing platform data retention patterns and provides sufficient data for monthly trend analysis.
- Q: Should the "power user" threshold (10+ enrichments) be hardcoded or configurable per workspace? → A: Hardcoded at 10. Internal UX heuristic, not a business rule. One-line code change if adjustment needed later.

## Current State

The existing implementation in `src/services/agent/assistant.ts` uses:
- `DEFAULT_PROMPTS`: 4 static prompts shown on every thread start (Enrich a list, Find contacts, Check job status, Tech report)
- `buildChannelAwarePrompts()`: Minimal channel awareness — only swaps in a "Jobs in #channel" prompt when a channel is detected, backfilling with 2-3 defaults

This delivers the same experience to every user regardless of their history, active work, or workspace context.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Activity-Aware Prompt Suggestions (Priority: P1)

When a user opens the agent side-panel, the system queries the user's recent activity (active jobs, completed jobs, uploaded files) and generates prompts relevant to their current state. A user with an active enrichment job sees "Check your running job" instead of the generic "Check job status." A user who just completed a contact enrichment sees "Filter your contact results" instead of "Find contacts."

**Why this priority**: This is the core value — transforming generic prompts into personalized, actionable suggestions that reduce cognitive load and accelerate the most likely next action.

**Independent Test**: Can be tested by creating enrichment jobs in different states (active, completed, failed) and opening the agent panel to verify prompts reflect the user's actual activity.

**Acceptance Scenarios**:

1. **Given** a user has an active enrichment job running, **When** they open the agent panel, **Then** one of the 4 suggested prompts is "Check your running enrichment" with a message referencing the active job type.
2. **Given** a user has no active jobs and no recent history, **When** they open the agent panel, **Then** the system falls back to onboarding-style prompts: "Upload a list to get started", "What can I help with?", "Generate a tech report", "View my enrichment history."
3. **Given** a user completed a technographic enrichment within the last 48 hours, **When** they open the agent panel, **Then** one prompt suggests "Filter your last tech enrichment" or "Add contacts to your enriched list" (combined follow-up).
4. **Given** a user has a failed job in the last 24 hours, **When** they open the agent panel, **Then** one prompt suggests "Retry your failed enrichment" with the job context.
5. **Given** a user has completed 10+ enrichments total (hardcoded threshold: `POWER_USER_JOB_COUNT = 10`), **When** they open the agent panel, **Then** prompts skew toward power-user actions (filter, split, download, usage query) rather than onboarding prompts.

---

### User Story 2 - Channel-Context Dynamic Prompts (Priority: P1)

When a user navigates to a channel while the agent panel is open (triggering `assistant_thread_context_changed`), the system generates prompts relevant to that channel's enrichment history, uploaded documents, and configured presets. A channel with an active ICP document shows "Enrich using your ICP settings." A channel with recent completed jobs shows "View jobs from #channel-name."

**Why this priority**: Channel context is the primary signal Slack provides during `threadContextChanged` events. Leveraging it makes the agent feel integrated into the user's Slack workflow rather than a disconnected sidebar.

**Independent Test**: Can be tested by navigating between channels with different enrichment histories and documents, and verifying prompts update accordingly.

**Acceptance Scenarios**:

1. **Given** a user navigates to a channel with uploaded config documents (ICP, Use Cases), **When** the `threadContextChanged` event fires, **Then** one prompt suggests "Enrich using [doc-slug] settings" referencing the most recent document.
2. **Given** a user navigates to a channel with 5+ completed enrichments, **When** the event fires, **Then** one prompt is "View recent jobs in #channel-name" and another suggests enrichment based on the most common type used in that channel.
3. **Given** a user navigates to a channel with an active enrichment preset, **When** the event fires, **Then** one prompt offers "Run your [preset-name] enrichment."
4. **Given** a user navigates to a channel with no enrichment history, **When** the event fires, **Then** prompts default to general enrichment suggestions (upload a list, generate a tech report).
5. **Given** the user navigates channels rapidly (within 2 seconds), **When** multiple `threadContextChanged` events fire, **Then** only the most recent event's prompts are applied (debounce/last-write-wins).

---

### User Story 3 - Workspace-Aware Prompt Personalization (Priority: P2)

Prompts adapt based on workspace-level configuration: which enrichment services are enabled, usage limits, and billing status. A workspace approaching its monthly usage cap sees "Check your workspace usage" as a prompt. A workspace without Apollo configured never sees contact-related prompts.

**Why this priority**: Prevents confusion by not suggesting actions the workspace cannot perform. Surfaces billing awareness proactively.

**Independent Test**: Can be tested by configuring different workspace settings (disable Apollo, set low usage cap) and verifying prompts exclude irrelevant suggestions and surface warnings.

**Acceptance Scenarios**:

1. **Given** a workspace has Apollo credits disabled or exhausted, **When** a user opens the agent panel, **Then** no prompts suggest contact enrichment — only technographic and tech report prompts appear.
2. **Given** a workspace is at 80%+ of its monthly usage cap, **When** a user opens the agent panel, **Then** one prompt is "Check workspace usage" to surface awareness.
3. **Given** a workspace has a custom enrichment preset configured, **When** a user opens the agent panel, **Then** one prompt suggests "Run [preset-name] enrichment."

---

### User Story 4 - Prompt Analytics & Optimization (Priority: P3)

Track which suggested prompts users click vs. ignore. Aggregate click-through rates per prompt type and context to inform future prompt ordering and content.

**Why this priority**: Data-driven optimization — understanding which prompts drive engagement enables continuous improvement. Lower priority because it requires US1-US3 to be live first.

**Independent Test**: Can be tested by clicking various suggested prompts and verifying click events are recorded with prompt metadata (title, context type, position).

**Acceptance Scenarios**:

1. **Given** a user clicks a suggested prompt, **When** the message is sent to the agent thread, **Then** the system records a prompt click event with: prompt title, prompt position (1-4), context type (default/channel/activity), user ID, workspace ID, timestamp.
2. **Given** prompt analytics have been collected for 7+ days, **When** an admin views the dashboard, **Then** they see click-through rates per prompt type and can identify low-performing prompts.
3. **Given** a prompt type has <5% click-through rate over 30 days, **When** the next prompt generation runs, **Then** that prompt type is deprioritized in the rotation.

---

### Edge Cases

- What happens when the database query for recent jobs times out? Fall back to `DEFAULT_PROMPTS` (current static set). Log the timeout for monitoring. Never delay the panel opening waiting for prompt data.
- What happens when a user has activity across 20+ channels? Prompt generation only considers the currently-viewed channel context, not all channels. User-level activity considers only the last 10 jobs.
- What happens when Redis is unavailable? Fall back to static `DEFAULT_PROMPTS`. The prompt generation service should not block on cache availability.
- How are prompts ordered when multiple signals compete? Priority order: (1) active job prompts, (2) failed job recovery, (3) recent completion follow-ups, (4) channel-specific, (5) workspace-specific, (6) general defaults. Always exactly 4 prompts, never fewer.
- What happens when the user's team has no enrichment history at all? Show onboarding prompts: "Upload a list to get started", "What can I help with?", "Generate a tech report for any technology", "Learn what I can do."

## Requirements _(mandatory)_

### Functional Requirements

**Prompt Generation Engine**
- **FR-001**: System MUST generate exactly 4 suggested prompts per `threadStarted` or `threadContextChanged` event, never fewer.
- **FR-002**: System MUST query the user's recent activity to inform prompt selection: active jobs (no time limit), completed jobs within 48h, failed jobs within 24h, capped at 10 most recent jobs total.
- **FR-003**: System MUST query channel-specific context (enrichment history, uploaded documents, presets) when channel context is available.
- **FR-004**: System MUST query workspace configuration (enabled services, usage limits, billing status) to filter out irrelevant prompts.
- **FR-005**: System MUST complete prompt generation within 500ms. If any data query exceeds this budget, fall back to cached or static prompts.
- **FR-006**: System MUST implement a pure rule-based, deterministic priority algorithm with prompt templates. No LLM/AI calls during prompt generation. Priority order: active jobs > failed recovery > recent follow-ups > channel context > workspace context > general defaults.

**Prompt Categories**
- **FR-007**: System MUST support these prompt categories: onboarding (new user), enrichment (technographic, contact, combined), job management (status, cancel, download, retry), follow-up (filter, split, add contacts), reporting (tech report, usage), and channel-specific (jobs in channel, use preset, use document).
- **FR-008**: Each prompt MUST have a `title` (short label, max 25 chars) and `message` (full message sent to agent, max 150 chars).

**Caching & Performance**
- **FR-009**: System MUST cache prompt generation inputs (user activity summary, channel context) in Redis with a 5-minute TTL to avoid repeated DB queries within the same session.
- **FR-010**: System MUST implement last-write-wins for rapid `threadContextChanged` events, discarding stale prompt generation if a newer event arrives.

**Fallback Behavior**
- **FR-011**: System MUST fall back to static default prompts when any dependency (Redis, PostgreSQL) is unavailable.
- **FR-012**: System MUST log prompt generation failures for monitoring without blocking the user experience.

**Analytics (P3)**
- **FR-013**: System MUST detect prompt clicks by comparing incoming `userMessage` text against the last-set prompts for the thread (exact match = click attribution). System MUST record prompt click events including prompt metadata, position, and context type.
- **FR-014**: System MUST aggregate prompt analytics daily for dashboard display.

### Key Entities

- **PromptContext**: Ephemeral object representing the aggregated signals (user activity, channel state, workspace config) used to generate prompts. Not persisted — rebuilt per event.
- **PromptClickEvent**: Records when a user clicks a suggested prompt. Fields: userId, teamId, channelId, promptTitle, promptPosition, contextType, timestamp. Stored for analytics. Retention: 90 days, purged by the existing retention worker.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: Prompt generation completes within 500ms p95 for `threadStarted` and `threadContextChanged` events.
- **SC-002**: Users with active jobs see a job-relevant prompt 100% of the time (no generic "Check job status" when specific job context exists).
- **SC-003**: Users navigating to a channel with config documents see a document-referencing prompt within the top 4 suggestions.
- **SC-004**: Static fallback prompts are served in <50ms when dependencies are unavailable.
- **SC-005**: Zero regressions to existing agent functionality — all 13 intent handlers continue working correctly.
- **SC-006**: Prompt click-through rate (P3 analytics) provides actionable data within 14 days of deployment.

## Assumptions

- The existing `setSuggestedPrompts` Slack API method supports dynamic prompt updates on both `threadStarted` and `threadContextChanged` events (confirmed — already implemented).
- Slack allows a maximum of 4 suggested prompts per call (confirmed — existing implementation enforces this).
- The "Dynamic" setting in Slack app configuration simply means the app controls prompts programmatically via event handlers, not that Slack calls a separate API endpoint on the app.
- User activity data (jobs, files, documents) is already queryable via existing Prisma models and does not require new database tables for prompt generation.
- Redis is available for caching prompt context but is not required — static fallback provides acceptable UX.

## Dependencies

- Existing agent assistant implementation (`src/services/agent/assistant.ts`)
- Existing agent orchestrator (`src/services/ai/agentOrchestrator.ts`)
- Existing context store (`src/services/agent/contextStore.ts`)
- Existing conversation manager (`src/services/agent/conversationManager.ts`)
- Existing Prisma models: EnrichmentJob, ConfigDocument, EnrichmentPreset, WorkspaceInstallation, ApiUsageLog
- Redis for prompt context caching (ElastiCache)
- Admin dashboard (feature 3) for prompt analytics display (P3)
