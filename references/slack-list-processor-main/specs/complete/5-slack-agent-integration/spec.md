# Feature Specification: Slack Agent Integration

**Feature Branch**: `5-slack-agent-integration`
**Created**: 2026-03-06
**Status**: Draft
**Input**: User description: "Add full-featured AI agent capabilities to the existing Slack List Processor bot using Slack's Agents & AI Apps platform. This enables a conversational side-panel interface alongside the existing trigger-based flows, with streaming responses, task visualization, multi-turn conversation, public distribution, and per-workspace usage metering."

## Clarifications

### Session 2026-03-06

- Q: Where does enrichment data reside for client workspaces? → A: Central storage with workspace-scoped access controls. All enrichment data (company data, contacts, files) is stored in the central database. Each workspace can only access its own data via workspace-scoped queries. This extends the existing database architecture rather than introducing per-workspace storage.
- Q: How does the system identify workspace administrators? → A: Use Slack's native workspace admin/owner roles. Anyone who is a Slack admin or owner can manage agent settings, view usage, and configure limits. No custom role system needed.
- Q: What are usage limits based on? → A: Both — monthly dollar-amount cap as the primary limit, with optional per-service call count limits as secondary guardrails. The dollar cap aggregates estimated costs across all services. Per-service limits (e.g., max Apollo credits/mo) can optionally be configured as additional guardrails. Either limit being reached blocks new enrichment jobs.
- Q: How long does conversation history persist? → A: 7-day full retention in database, then summarized and purged. Full conversation turns are stored for 7 days. At purge time, a compact audit summary is generated (user, workspace, actions taken, jobs referenced, timestamps) and retained permanently. This supports SOC 2 audit trail requirements without unbounded storage growth. Job records, usage logs, and enrichment results are retained permanently regardless. Conversation content does not need to be exported to clients — audit summaries and permanent job/usage records satisfy SOC 2 audit trail requirements. Client data export (enrichment results, job history, usage) is handled separately via the uninstall/data portability flow.
- Q: What happens to workspace data after uninstall? → A: 90-day grace period. All workspace-scoped data (enrichment results, job history, usage records, audit summaries) is retained for 90 days after uninstall to allow re-install recovery and final billing. Clients can request a data export during this window. After 90 days, all workspace-scoped data is permanently deleted. This provides a clear data disposal policy for SOC 2 compliance.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Conversational Enrichment via Agent Side-Panel (Priority: P1)

A user opens the AI agent side-panel in Slack and types a natural language request like "I need to enrich a company list with technographics and find IT decision makers." The agent understands the intent, asks clarifying questions if needed (e.g., "How many contacts per company?"), and guides the user through the enrichment process conversationally — without requiring the user to memorize slash commands or button sequences.

**Why this priority**: This is the core value proposition — transforming the existing rigid trigger-based flow into a natural conversational interface. It makes the product accessible to users who have never used it before.

**Independent Test**: Can be fully tested by opening the agent panel, typing an enrichment request, and verifying the agent classifies intent, asks clarifications, accepts a file upload, and initiates the enrichment job.

**Acceptance Scenarios**:

1. **Given** a user opens the agent side-panel for the first time, **When** the panel loads, **Then** the agent displays a greeting and up to 4 suggested prompts (e.g., "Enrich a company list", "Find decision makers", "Check job status", "Generate a tech report").
2. **Given** a user types "I want to find contacts at healthcare companies", **When** the agent processes the message, **Then** it classifies the intent as contact enrichment and asks the user to upload a file.
3. **Given** the agent has classified intent with low confidence (below threshold), **When** multiple interpretations are possible, **Then** the agent asks a clarifying question with up to 3 options before proceeding.
4. **Given** a user uploads a CSV/XLSX file in the agent thread, **When** the file is received, **Then** the agent validates the file structure, confirms enrichment parameters, and starts the job — reporting progress inline.
5. **Given** the user provides all required inputs (file, enrichment type, purpose), **When** the job is submitted, **Then** the agent confirms submission with a job ID and estimated timeline.

---

### User Story 2 - Real-Time Streaming & Task Visualization (Priority: P1)

While an enrichment job runs, the agent provides real-time streaming updates showing each pipeline step as visual task cards. The user sees exactly what the system is doing — parsing the file, looking up technologies via BuiltWith, finding contacts via Apollo, generating the output file — with live status indicators.

**Why this priority**: Transparency during long-running enrichment jobs (which can take minutes to hours) is critical for user trust and reduces "is it working?" support requests.

**Independent Test**: Can be tested by initiating an enrichment job through the agent and verifying that streaming text and task cards appear in real-time as each pipeline stage progresses.

**Acceptance Scenarios**:

1. **Given** an enrichment job has been submitted via the agent, **When** the job begins processing, **Then** the agent displays a task plan with steps: File Parsing, Domain Enrichment, Contact Lookup, File Generation — each with a status indicator (pending, in progress, complete, error).
2. **Given** a pipeline step transitions from pending to in-progress, **When** the status changes, **Then** the agent updates the task card in real-time without posting a new message.
3. **Given** the agent is generating an AI response (intent classification, report narrative), **When** the LLM produces tokens, **Then** text streams progressively into the conversation rather than appearing all at once.
4. **Given** a pipeline step encounters an error (e.g., BuiltWith rate limit), **When** the error occurs, **Then** the task card shows error status with a human-readable explanation and suggested action.
5. **Given** the enrichment job completes, **When** the output file is ready, **Then** the agent posts the file in the thread with a summary of results (rows processed, contacts found, companies enriched).

---

### User Story 3 - Multi-Turn Conversation with Memory (Priority: P1)

The agent maintains conversation context across multiple messages within a thread. If a user asks to enrich a list, then later in the same thread asks "now filter out companies with fewer than 50 employees," the agent understands the reference to the previous enrichment and applies the filter to that job's results.

**Why this priority**: Multi-turn memory is what makes this an agent rather than a chatbot. Without it, users must repeat context in every message, which is worse than the existing button-based flow.

**Independent Test**: Can be tested by having a multi-message conversation in a single agent thread where later messages reference earlier context, and verifying the agent correctly resolves references.

**Acceptance Scenarios**:

1. **Given** a user has completed an enrichment request in the current thread, **When** they say "filter the results to only include companies in California", **Then** the agent applies the filter to the most recent enrichment results without asking which job.
2. **Given** a user has discussed enrichment parameters across 5+ messages, **When** they say "go ahead and start it", **Then** the agent correctly assembles all previously discussed parameters (enrichment type, purpose, persona filters, row limits) and initiates the job.
3. **Given** a user asks "what's the status?", **When** a job was initiated in the current thread, **Then** the agent reports the status of that specific job without asking for a job ID.
4. **Given** the conversation has exceeded the context window limit, **When** a new message arrives, **Then** the agent gracefully summarizes earlier context and continues the conversation without losing critical parameters.

---

### User Story 4 - Channel Context Awareness (Priority: P2)

When the user opens the agent while viewing a specific Slack channel, the agent is aware of which channel they are in. The agent tailors its suggested prompts and behavior based on channel context — for example, if the user is in a sales channel, the agent might suggest "Find contacts at companies discussed here."

**Why this priority**: Channel awareness differentiates the agent from a generic chatbot and ties it naturally into existing Slack workflows.

**Independent Test**: Can be tested by opening the agent from different channels and verifying that suggested prompts and context-aware responses change based on the channel.

**Acceptance Scenarios**:

1. **Given** the user opens the agent while viewing a channel, **When** the agent thread starts, **Then** the agent receives the channel context and adjusts suggested prompts accordingly.
2. **Given** the user navigates to a different channel while the agent panel is open, **When** Slack delivers an `assistant_thread_context_changed` event (triggered by explicit panel interaction, not passive navigation), **Then** the agent updates its awareness and can reference the new channel if asked.
3. **Given** the user asks "summarize recent enrichment jobs in this channel", **When** the channel has associated enrichment history, **Then** the agent retrieves and summarizes jobs that originated from that channel.

---

### User Story 5 - Job Status & History via Agent (Priority: P2)

Users can ask the agent about their enrichment job history, check on running jobs, stop jobs, and retrieve past results. This replaces the need to remember `/enrich history` and `/enrich stop` commands.

**Why this priority**: Status checking is the second most common user action after initiating enrichments. Making it conversational significantly improves usability.

**Independent Test**: Can be tested by asking the agent about job status and history in natural language and verifying accurate results.

**Acceptance Scenarios**:

1. **Given** the user asks "what jobs are running?", **When** active jobs exist, **Then** the agent lists all in-progress jobs with job ID, type, progress percentage, and estimated completion.
2. **Given** the user asks "stop job 42", **When** the job is in a cancellable state, **Then** the agent confirms cancellation and stops the job.
3. **Given** the user asks "show me my last 5 enrichments", **When** job history exists, **Then** the agent displays a summary table of recent jobs with type, status, row counts, and completion time.
4. **Given** the user asks "download the results from my last enrichment", **When** the output file exists, **Then** the agent retrieves and shares the file in the thread.

---

### User Story 6 - Tech Reports via Agent (Priority: P2)

Users can request technology reports through the agent conversationally. Instead of remembering `/enrich report Salesforce`, they can say "show me which companies in my last enrichment use Salesforce" and the agent generates the report.

**Why this priority**: Technology reports are a key differentiator of the product. Making them conversational unlocks follow-up queries like "now compare that with HubSpot usage."

**Independent Test**: Can be tested by requesting a tech report through the agent and verifying the report is generated with correct data.

**Acceptance Scenarios**:

1. **Given** the user says "generate a technology report for Salesforce", **When** enrichment data exists, **Then** the agent initiates a tech report job and streams the analysis narrative.
2. **Given** a tech report is displayed, **When** the user asks "what about HubSpot?", **Then** the agent generates a comparison or new report without requiring the user to re-specify the data source.
3. **Given** a cached report exists for the requested technology, **When** the user makes the request, **Then** the agent asks whether to use cached results or regenerate.

---

### User Story 7 - Per-Workspace Usage Metering & Billing (Priority: P3)

When the agent is installed across multiple client workspaces, each workspace's API usage (BuiltWith calls, Apollo credits, Claude tokens) is tracked independently. Workspace administrators can view their usage summary, and the system supports configurable usage limits per workspace.

**Why this priority**: Required for commercial viability when distributing to clients. Without metering, there is no way to attribute costs or enforce usage limits.

**Independent Test**: Can be tested by running enrichments from two different workspaces and verifying usage is tracked separately with correct attribution.

**Acceptance Scenarios**:

1. **Given** an enrichment job runs in a client workspace, **When** API calls are made to BuiltWith, Apollo, or Claude, **Then** each call is logged with the workspace ID, timestamp, cost estimate, and job reference.
2. **Given** a workspace administrator asks the agent "show our usage this month", **When** usage data exists, **Then** the agent displays a breakdown by service (BuiltWith lookups, Apollo credits, Claude tokens) with estimated costs.
3. **Given** a workspace has a configured usage limit, **When** the limit is reached, **Then** the agent informs the user that the workspace quota has been exceeded and prevents new enrichment jobs.
4. **Given** the system operator needs a cross-workspace usage report, **When** the report is requested via the admin dashboard, **Then** a consolidated view shows usage per workspace with cost attribution.

---

### User Story 8 - Public Distribution & Client Onboarding (Priority: P3)

The Slack agent is publicly distributable — clients can install it in their workspace via a direct install link or through the Slack Marketplace. The onboarding experience guides new workspace admins through initial setup.

**Why this priority**: Distribution is the mechanism that enables the business model. Without it, the agent only works in the development workspace.

**Independent Test**: Can be tested by installing the app in a test workspace via the public install link and verifying the onboarding flow completes successfully.

**Acceptance Scenarios**:

1. **Given** a client clicks the public install link, **When** the OAuth flow completes, **Then** the app is installed in their workspace with required scopes and the agent appears in their side-panel.
2. **Given** a new workspace installs the app, **When** the first user opens the agent, **Then** a welcome message explains what the agent can do and walks through initial setup.
3. **Given** a workspace admin needs to configure settings, **When** they interact with the agent or App Home, **Then** they can set usage limits, default enrichment parameters, and notification preferences.
4. **Given** a workspace is on Slack's free plan, **When** they attempt to install, **Then** the install page clearly communicates that a paid Slack plan is required for full agent functionality.

---

### Edge Cases

- What happens when a user uploads a file that exceeds the 5,000 row limit through the agent panel? The agent informs the user of the limit and offers to process the first 5,000 rows or suggests splitting the file.
- How does the agent handle concurrent conversations from the same user across multiple threads? Each agent thread maintains independent state. The agent does not cross-contaminate context between threads.
- What happens if the agent's LLM call fails mid-stream? The streaming stops gracefully, the agent posts an error message, and offers to retry.
- How does the agent handle a workspace being deactivated or uninstalled? Running jobs complete but no new jobs are accepted. All workspace data is retained for 90 days (grace period for re-install and final billing). Clients can request a data export during this window. After 90 days, workspace-scoped operational data is permanently purged. Audit summaries and usage logs are retained for a minimum of 1 year post-uninstall per SOC 2 compliance, then permanently deleted.
- What happens when conversation state storage is unavailable? The agent responds with a service degradation message and falls back to stateless single-turn mode.
- How does the agent handle rate limiting from Slack's API? Exponential backoff for streaming calls. Task card updates are batched to avoid hitting message update rate limits.
- What if a user tries to interact with the agent without the required workspace permissions? The agent explains which permissions are needed and directs them to a workspace admin.
- What happens when a user returns to a thread after the 7-day retention window? The agent informs the user that the conversation history has expired and suggests starting a new thread. The audit summary is available to admins but not surfaced in the agent conversation.
- What happens when Redis (agent context store) is unavailable? The agent falls back to stateless single-turn mode: each message is classified independently without accumulated parameters or conversation history. The agent informs the user that context memory is temporarily unavailable and suggests re-stating their full request.

## Requirements _(mandatory)_

### Functional Requirements

**Agent Core**
- **FR-001**: System MUST register a Slack Assistant that responds to thread started, context changed, and direct message events.
- **FR-002**: System MUST display up to 4 context-aware suggested prompts when a user opens the agent side-panel.
- **FR-003**: System MUST classify user intent from natural language messages using AI-powered classification with confidence scoring.
- **FR-004**: System MUST support multi-turn conversations by maintaining conversation turn history within each agent thread.
- **FR-005**: System MUST handle file uploads within the agent thread and route them through the existing file validation and parsing pipeline.

**Streaming & Visualization**
- **FR-006**: System MUST stream AI-generated responses progressively so users see text appear incrementally.
- **FR-007**: System MUST display enrichment pipeline progress as visual task cards with status indicators (pending, in progress, complete, error).
- **FR-008**: System MUST update task card status in real-time as pipeline stages transition without posting duplicate messages.

**Conversation Intelligence**
- **FR-009**: System MUST ask clarifying questions when intent classification confidence falls below a configurable threshold.
- **FR-010**: System MUST resolve references to previous context within the same thread (e.g., "filter those results" refers to the most recent enrichment).
- **FR-011**: System MUST support all existing enrichment types through the conversational interface: technographic, contact, combined, and tech reports.
- **FR-012**: System MUST support job status queries, job cancellation, history retrieval, and result file downloads via natural language.

**Channel Context**
- **FR-013**: System MUST receive and store the channel context when a user opens or navigates channels with the agent panel open.
- **FR-014**: System MUST use channel context to personalize suggested prompts and enable channel-scoped queries (e.g., "jobs in this channel").

**Multi-Workspace Distribution**
- **FR-015**: System MUST support public distribution via OAuth install flow, allowing any Slack workspace to install the agent.
- **FR-016**: System MUST isolate data between workspaces via workspace-scoped access controls on centrally stored data — no workspace can access another workspace's jobs, files, or usage data.
- **FR-017**: System MUST store and manage OAuth tokens securely for each installed workspace.
- **FR-018**: System MUST provide a first-run onboarding experience for newly installed workspaces.

**Usage Metering & Limits**
- **FR-019**: System MUST track API usage per workspace per service with call counts, token counts, and estimated costs.
- **FR-020**: System MUST enforce a configurable monthly dollar-amount spending cap per workspace as the primary limit, with optional per-service call count limits (e.g., max BuiltWith lookups, Apollo credits) as secondary guardrails. Users MUST be notified at 80% and 100% of any limit. New enrichment jobs MUST be blocked when any limit is reached.
- **FR-021**: System MUST expose usage summaries to users identified as Slack workspace admins or owners via the agent conversational interface.
- **FR-022**: System MUST provide a cross-workspace usage report for system operators via the admin dashboard.
- **FR-023**: System MUST allow workspace administrators (Slack admin/owner) to configure workspace settings via the agent conversational interface: monthly spending cap, per-service limits, and default enrichment parameters.
- **FR-024**: System MUST allow system operators to configure workspace settings via the admin dashboard API for any workspace.

**Data Retention & Audit**
- **FR-025**: System MUST retain full conversation turn history for 7 days per agent thread.
- **FR-026**: System MUST generate a compact audit summary (user, workspace, actions taken, jobs referenced, timestamps) before purging conversation turns older than 7 days. Audit summaries MUST be retained permanently.
- **FR-027**: Job records, API usage logs, and enrichment results MUST be retained permanently regardless of conversation purge cycles. Upon workspace uninstall, job records and enrichment results follow the 90-day disposal policy (FR-028). API usage logs and audit summaries follow the 1-year minimum retention policy (FR-028, constitution Principle V).
- **FR-028**: Upon workspace uninstall, system MUST retain all workspace-scoped data for 90 days. Clients MUST be able to request a data export during this grace period. After 90 days, workspace-scoped operational data (enrichment results, job records, agent threads, conversation turns, files) MUST be permanently deleted. However, audit summaries (AgentThreadAudit) and API usage logs (ApiUsageLog, DailyAggregate) MUST be retained for a minimum of 1 year post-uninstall per SOC 2 compliance requirements (constitution Principle V), then permanently deleted.
- **FR-029**: System MUST provide a data export capability for workspace data (enrichment results, job history, usage records) upon client request or uninstall.

**Backward Compatibility**
- **FR-030**: System MUST preserve all existing trigger-based flows (file upload events, slash commands, action handlers) without modification.
- **FR-031**: System MUST allow the agent surface and traditional trigger surface to coexist — users can choose either interaction method.

### Key Entities

- **AgentThread**: Represents a single conversation in the agent side-panel. Tracks thread identity, workspace, user, conversation turns, and associated job references.
- **WorkspaceInstallation**: Represents a client workspace that has installed the agent. Stores authentication credentials, installation date, configuration preferences, and usage limits.
- **ApiUsageLog** (existing, extended): Tracks API consumption per workspace per service call. Extended with slackTeamId for workspace attribution. Aggregated daily via DailyAggregate for billing period summaries. Usage limits stored on WorkspaceInstallation.
- **ConversationTurn**: An individual message exchange within an agent thread. Stores role (user/assistant), content, timestamp, and any extracted parameters (intent, entities).

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: Users can complete an enrichment request through the agent side-panel in 3 or fewer conversational turns (excluding file upload).
- **SC-002**: Agent correctly classifies user intent on the first attempt at least 85% of the time, with clarification questions resolving the remaining cases.
- **SC-003**: Streaming responses begin appearing within 2 seconds of the user sending a message.
- **SC-004**: Task visualization cards update within 5 seconds of each pipeline stage transition.
- **SC-005**: The agent supports at least 50 concurrent conversations across all installed workspaces without degradation (defined as: response time >2x baseline, error rate >1%, or message drops).
- **SC-006**: Usage metering captures 100% of API calls with correct workspace attribution.
- **SC-007**: A new client workspace can install the agent and complete their first enrichment within 10 minutes of clicking the install link.
- **SC-008**: All existing trigger-based flows continue to function identically after agent integration — zero regressions.
- **SC-009**: Per-workspace usage reports are accurate to within 1% of actual API consumption.
- **SC-010**: Agent handles context references correctly (e.g., "those results", "that job") at least 90% of the time within multi-turn conversations.

## Assumptions

- Client workspaces are on Slack paid plans (Pro or above) which support the Agents & AI Apps feature set.
- The existing deployment infrastructure can handle the additional load from agent conversations alongside existing trigger-based processing.
- The current Slack Bolt framework version includes or can be upgraded to support the Assistant class and streaming capabilities.
- API keys for enrichment services (BuiltWith, Apollo) are managed centrally in the initial release. Per-client API keys may be a future enhancement.
- Usage metering is for cost attribution and internal billing — no automated payment collection is in scope.
- Full conversation turn history is retained for 7 days in the database. After 7 days, a compact audit summary is generated and retained permanently before conversation turns are purged. Users returning after 7 days will need to re-establish context.
- The existing admin dashboard will be extended to show cross-workspace usage, rather than building a separate operator dashboard.

## Dependencies

- Slack Agents & AI Apps platform features (generally available on paid plans)
- Slack chat streaming capabilities (GA since October 2025)
- Existing enrichment pipeline (BuiltWith, Apollo, job queue workers)
- Existing AI orchestrator (intent classification, persona classification, filter parsing)
- Admin dashboard (feature 3) for cross-workspace usage reporting
- **Infrastructure Hardening (feature 4)**: HTTPS/TLS is prerequisite for OAuth redirect URI. Secrets Manager pattern should be followed for new secrets (SLACK_CLIENT_SECRET, TOKEN_ENCRYPTION_KEY, etc.). Auto-scaling (feature 4 US4) supports SC-005 concurrent conversation target. WAF (feature 4 US6) protects public OAuth endpoints. Feature 4 should be deployed before Feature 5's Phase 10 (OAuth/Distribution).
