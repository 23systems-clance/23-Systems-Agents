# Feature Specification: Vertical Pack Platform

**Feature Branch**: `39-vertical-pack-platform`
**Created**: 2026-03-18
**Status**: Draft
**Input**: User description: "Transform the Slack List Processor into a vertical pack platform where AI agents, MCP server connections, and composable skills are first-class primitives. Admins create curated vertical packs - bundled capabilities for specific use cases like outbound outreach, executive assistant, account research. The enrichment pipeline becomes Pack 1 on a platform that can host many vertical packs."

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Admin Registers and Manages Agents (Priority: P1)

A Dev Labs admin navigates to the admin dashboard and creates a new AI agent by defining its name, purpose description, system prompt, language model, available tools, expected input/output format, and credit cost policy. The admin tests the agent in a sandbox environment with sample input, reviews the output, and publishes the agent for use in skills. The admin can later update the agent's prompt or tools, which creates a new version while keeping the published version stable.

**Why this priority**: Agents are the foundational reasoning unit — nothing else (skills, packs) works without them. This establishes the core primitive that all other features depend on.

**Independent Test**: Can be fully tested by creating an agent in the admin UI, invoking it with sample input in sandbox mode, and verifying it returns structured output. Delivers immediate value by formalizing existing AI prompts into versioned, manageable objects.

**Acceptance Scenarios**:

1. **Given** an admin is logged into the dashboard, **When** they create a new agent with name, system prompt, model, and tools, **Then** the agent is saved in DRAFT status and appears in the agent list
2. **Given** a DRAFT agent exists, **When** the admin tests it with sample input, **Then** the system executes the agent and displays the output, token count, and latency
3. **Given** a tested agent exists, **When** the admin publishes it, **Then** the agent status changes to PUBLISHED and it becomes available for skill assignment
4. **Given** a PUBLISHED agent exists, **When** the admin edits the system prompt, **Then** a new version is created while the previous published version remains unchanged
5. **Given** agents exist in the registry, **When** the admin views the agent list, **Then** each agent displays its name, status, version, total invocations, and average cost

---

### User Story 2 - Admin Registers MCP Server Connections (Priority: P1)

A Dev Labs admin registers an external service (e.g., Apollo, BuiltWith, HubSpot) as an MCP server in the admin dashboard. They provide the connection name, provider, base URL, authentication type, credentials, and define the specific tools the server exposes (e.g., "lookup_contact", "get_tech_stack"). The system validates the connection and monitors its health. For BYOK-enabled servers, individual workspaces can provide their own API keys.

**Why this priority**: MCP servers are the data/tool layer that agents invoke. Without formalized external connections, agents can't access real data. This also enables BYOK model critical for Spec 36 virality.

**Independent Test**: Can be fully tested by registering an existing API integration (e.g., Apollo) as an MCP server, running a health check, and invoking a sample tool. Delivers value by making integrations composable and BYOK-ready.

**Acceptance Scenarios**:

1. **Given** an admin is on the MCP server management page, **When** they create a new server with provider, URL, auth type, and credentials, **Then** the server is saved and a health check runs automatically
2. **Given** an MCP server is registered, **When** the admin defines tools for it (name, description, input/output schema), **Then** those tools appear in the tool picker when creating agents and skills
3. **Given** an MCP server is marked as BYOK-enabled, **When** a workspace admin provides their own API key, **Then** that workspace's invocations use the workspace key instead of the platform key
4. **Given** registered MCP servers exist, **When** the system runs periodic health checks, **Then** servers with failed checks display ERROR status and trigger an admin notification
5. **Given** an MCP server has credentials, **When** credentials are stored, **Then** they are encrypted at rest and never displayed in plaintext in the UI

---

### User Story 3 - Admin Creates and Publishes Skills (Priority: P2)

A Dev Labs admin creates a new skill by selecting an agent, choosing which MCP tools the skill can use, defining the trigger type (Slack command, API call, schedule, or event), mapping inputs and outputs, selecting delivery channels (Slack thread, email, CRM, download), and setting the credit cost. The admin tests the skill end-to-end with a sample trigger, then publishes it for inclusion in vertical packs.

**Why this priority**: Skills are the unit of execution that end users interact with. Once agents and MCP servers exist, skills compose them into usable capabilities. This is the layer that turns infrastructure into product.

**Independent Test**: Can be fully tested by creating a skill that combines an existing agent with an MCP tool, triggering it via a test command, and verifying the output is delivered to the specified channel. Delivers value by making new capabilities deployable without code changes.

**Acceptance Scenarios**:

1. **Given** published agents and MCP servers exist, **When** an admin creates a skill selecting an agent, MCP tools, trigger type, and delivery channel, **Then** the skill is saved in DRAFT status
2. **Given** a DRAFT skill exists, **When** the admin triggers a test execution, **Then** the system runs the full pipeline (trigger → agent invocation → tool calls → output delivery) and displays the execution trace
3. **Given** a tested skill exists, **When** the admin publishes it, **Then** the skill becomes available for inclusion in vertical packs
4. **Given** a published skill has a credit cost defined, **When** a user invokes the skill, **Then** the credit cost is checked before execution and deducted upon completion
5. **Given** a skill execution fails, **When** the system encounters an error, **Then** the execution is logged with the error, credits are not deducted, and the retry policy is applied

---

### User Story 4 - Admin Bundles Skills into Vertical Packs (Priority: P2)

A Dev Labs admin creates a vertical pack by giving it a name, description, category (sales, operations, research, executive), selecting published skills to include, setting a pricing tier (Free, Starter, Growth, Agency), monthly price, included credits, and overage rate. The admin previews how the pack appears in the client-facing catalog, then publishes it. Workspaces can subscribe to packs through the catalog.

**Why this priority**: Packs are the commercial unit — they turn skills into products that workspaces pay for. This is where platform revenue comes from beyond enrichment credits.

**Independent Test**: Can be fully tested by bundling existing skills into a pack, publishing it, subscribing a test workspace, and verifying the workspace gains access to all skills in the pack. Delivers value by enabling new revenue streams through packaged capabilities.

**Acceptance Scenarios**:

1. **Given** published skills exist, **When** an admin creates a pack with selected skills, pricing, and category, **Then** the pack is saved in DRAFT status
2. **Given** a DRAFT pack exists, **When** the admin previews it, **Then** the catalog view displays the pack name, description, included skills, and pricing
3. **Given** a PUBLISHED pack exists, **When** a workspace admin views the pack catalog, **Then** they can see available packs and subscribe via payment
4. **Given** a workspace is subscribed to a pack, **When** a user in that workspace invokes a skill from the pack, **Then** the skill executes successfully and credits are deducted from the pack subscription
5. **Given** a workspace's pack subscription has exhausted included credits, **When** a user invokes a skill, **Then** the overage rate is applied and the execution proceeds (if payment method is on file)

---

### User Story 5 - Enrichment Pipeline Migrated to Pack #1 (Priority: P3)

The existing enrichment pipeline (file upload, waterfall enrichment, tech stack lookup, email verification) is refactored so that each capability becomes a formal skill backed by registered agents and MCP servers. These skills are bundled into the "Enrichment Pack" — the first vertical pack on the platform. Existing workspace subscriptions and credit balances migrate seamlessly. End users experience no change in functionality.

**Why this priority**: This proves the platform architecture works with a real, production-tested workflow. It's P3 because the existing enrichment pipeline works — this is a refactor, not new functionality. It should only happen after the platform primitives are stable.

**Independent Test**: Can be fully tested by running the same enrichment workflows (file upload, single contact lookup, tech report) through the new platform architecture and comparing results with the current implementation. Zero user-facing changes.

**Acceptance Scenarios**:

1. **Given** the enrichment pipeline is migrated, **When** a user uploads a CSV in Slack, **Then** the enrichment runs through the Skill execution pipeline using registered agents and MCP servers, producing identical results
2. **Given** the Enrichment Pack exists, **When** a workspace previously had enrichment access, **Then** they are automatically subscribed to the Enrichment Pack with their existing credit balance preserved
3. **Given** the enrichment skills use MCP servers, **When** a BYOK workspace provides their own Apollo key, **Then** enrichment uses the workspace's key and no platform credits are deducted
4. **Given** the enrichment migration is complete, **When** viewing the admin dashboard, **Then** enrichment skills show execution metrics (invocations, credits, success rate) alongside all other skills

---

### User Story 6 - Skill Execution Logging and Analytics (Priority: P3)

Admins can view comprehensive execution logs for all agent invocations and skill executions across the platform. Each execution displays the trigger source, input data, agent reasoning, MCP tool calls made, output produced, credits consumed, and execution time. Aggregate analytics show usage patterns per skill, per pack, per workspace, and cost breakdowns.

**Why this priority**: Observability is critical for a platform — admins need to understand what's running, how much it costs, and where problems occur. This is P3 because it's valuable but not blocking for core functionality.

**Independent Test**: Can be fully tested by running several skill executions and verifying the logs capture full traces. Analytics can be verified by checking aggregate metrics match individual execution records.

**Acceptance Scenarios**:

1. **Given** a skill has been executed, **When** an admin views the execution log, **Then** they see the trigger type, input, agent used, MCP tools called, output, credits consumed, latency, and status
2. **Given** multiple executions have occurred, **When** an admin views skill analytics, **Then** they see total invocations, success rate, average latency, total credits consumed, and cost trends
3. **Given** a pack has subscribers, **When** an admin views pack analytics, **Then** they see subscription count, active users, credit usage vs. included credits, overage revenue, and churn rate
4. **Given** a workspace is subscribed to packs, **When** the workspace admin views their usage dashboard, **Then** they see credits remaining, skills used, and execution history for their workspace

---

### Edge Cases

- What happens when an agent's published version is referenced by active skills but the admin deprecates it? Skills continue using the pinned version; admin receives a warning to update affected skills.
- What happens when an MCP server goes offline during a skill execution? The execution fails gracefully, logs the error, credits are not deducted, and the retry policy is applied based on skill configuration.
- What happens when a workspace's credit balance reaches zero mid-execution? The current execution completes (credits go negative/overage). If a payment method is on file, subsequent invocations continue at the overage rate. If no payment method is on file, subsequent invocations are blocked until credits are replenished.
- What happens when a pack is deprecated while workspaces are subscribed? Existing subscribers retain access until their current billing period ends. No new subscriptions are allowed.
- What happens when the same MCP tool is used by multiple skills executing concurrently? Each execution gets its own tool invocation — rate limiting is applied per-MCP-server based on provider limits.
- What happens when an admin creates a skill with an agent that requires MCP tools not yet registered? The skill validation fails at creation time with a clear error identifying the missing tools.
- What happens when BYOK credentials provided by a workspace are invalid? The skill execution fails with a clear error indicating invalid credentials. The admin is notified. Platform managed keys are NOT used as fallback (to avoid unexpected charges).
- What happens when a chained skill fails midway through a chain? Each skill in the chain is an independent execution. If Skill B (triggered by Skill A's output) fails, Skill A's execution remains successful and its credits are still deducted. Skill B's credits are not deducted. The chain stops at the failure point; no downstream skills execute.
- What happens when a workspace hits its daily spend limit mid-chain? The currently executing skill completes, but subsequent chained skills are blocked. The workspace admin is notified that the daily limit was reached.

## Clarifications

### Session 2026-03-18

- Q: Can skills chain (output of one skill triggers another)? How are credits handled? → A: Yes, skills can chain. Each skill in the chain is a separate execution with its own credit deduction. The triggering skill's output becomes the chained skill's input via an event-based trigger.
- Q: When a workspace subscribes to multiple packs, are credits pooled or isolated per pack? → A: Credits are isolated per pack subscription. Each pack has its own included credits and overage tracking. No cross-pack credit sharing.
- Q: Do skills auto-upgrade to the latest agent version or pin to a specific version? → A: Skills pin to a specific agent version. Admins are notified when a newer published version is available so they can review and upgrade deliberately.
- Q: What cost guardrails exist against runaway LLM usage? → A: Both per-agent max token cap (rejects invocations exceeding the agent's configured limit) and per-workspace daily spend limit (pauses all skill executions when the workspace hits its daily cap). Both are required.
- Q: Can a skill belong to multiple packs? If so, which pack's credits are debited? → A: Yes, skills can belong to multiple packs. When a workspace subscribes to multiple packs containing the same skill, credits are automatically debited from the pack with the most remaining credits.

## Requirements _(mandatory)_

### Functional Requirements

**Agent Registry**
- **FR-001**: System MUST allow admins to create agents with name, description, system prompt, model selection, tool assignments, input/output schemas, and credit cost policy
- **FR-002**: System MUST support agent versioning where edits create new versions and published versions are immutable
- **FR-003**: System MUST provide a sandbox mode for testing agents with sample input before publishing
- **FR-004**: System MUST log every agent invocation with input, output, tokens used, cost, latency, and status
- **FR-005**: System MUST support agent lifecycle states: DRAFT, TESTING, PUBLISHED, DEPRECATED
- **FR-005a**: System MUST enforce a per-agent max token cap; invocations that would exceed the configured limit are rejected before execution

**MCP Server Registry**
- **FR-006**: System MUST allow admins to register external services as MCP servers with provider, URL, auth type, credentials, and tool definitions
- **FR-007**: System MUST encrypt MCP server credentials at rest and never display them in plaintext
- **FR-008**: System MUST run periodic health checks on registered MCP servers and display status in the dashboard
- **FR-009**: System MUST support BYOK mode where workspaces provide their own API keys for specific MCP servers
- **FR-010**: System MUST enforce per-server rate limits to respect provider API constraints

**Skills**
- **FR-011**: System MUST allow admins to create skills by composing a specific agent version, MCP tools, trigger type, input/output mappings, delivery channels, and credit cost. Skills pin to the selected agent version and do not auto-upgrade.
- **FR-011a**: System MUST notify admins when a skill references an agent version that is not the latest published version, enabling deliberate upgrade review
- **FR-012**: System MUST support skill triggers: Slack command, API call, scheduled execution, event-based (including chained from another skill's output), and manual
- **FR-013**: System MUST deliver skill output to configured channels: Slack thread, email, CRM sync, file download, or webhook. **MVP scope**: Slack thread and webhook delivery implemented first; email, CRM sync, and file download are deferred to a future phase
- **FR-014**: System MUST check the relevant pack subscription's credit balance before skill execution and deduct credits from that pack's allocation only on successful completion
- **FR-015**: System MUST provide end-to-end test execution for skills in a sandbox environment

**Vertical Packs**
- **FR-016**: System MUST allow admins to bundle published skills into vertical packs with name, description, category, pricing tier, and credit allocation. A skill may belong to multiple packs.
- **FR-016a**: When a workspace subscribes to multiple packs containing the same skill, the system MUST automatically debit credits from the pack subscription with the most remaining credits
- **FR-017**: System MUST present a client-facing pack catalog where workspace admins can browse, compare, and subscribe to packs
- **FR-018**: System MUST gate skill access based on workspace pack subscriptions — users can only invoke skills included in their subscribed packs
- **FR-019**: System MUST support pack-level billing with isolated credits per pack subscription — each pack has its own included credits, usage tracking, and overage rate (no cross-pack credit sharing)
- **FR-020**: System MUST handle pack subscription lifecycle: subscribe, cancel, and renewal. **Deferred**: Upgrade and downgrade between tiers are deferred to a future phase

**Execution & Observability**
- **FR-021**: System MUST execute skills asynchronously through the existing job queue, with results delivered upon completion
- **FR-022**: System MUST log full execution traces for every skill invocation (trigger → agent → tools → output → delivery)
- **FR-023**: System MUST provide aggregate analytics: usage per skill, per pack, per workspace, cost breakdowns, and success rates
- **FR-024**: System MUST apply retry policies for failed skill executions based on skill-level configuration
- **FR-025**: System MUST enforce a configurable per-workspace daily spend limit; when the limit is reached, all skill executions for that workspace are paused until the next day or until an admin raises the limit

**Migration**
- **FR-026**: System MUST migrate the existing enrichment pipeline into platform skills without any user-facing functionality changes
- **FR-027**: System MUST migrate existing workspace subscriptions and credit balances to the Enrichment Pack seamlessly

### Key Entities

- **Agent**: A reasoning unit powered by an LLM with a specific purpose, system prompt, tool access, and versioning. Each agent has a defined input/output schema and cost policy.
- **MCP Server**: An external service connection (API, database, webhook) that exposes one or more tools for agents to invoke. Supports platform-managed and BYOK credentials.
- **MCP Tool**: A specific capability on an MCP server (e.g., "lookup_contact" on Apollo). Defined by name, description, and input/output schema.
- **Skill**: A composable unit combining an agent, MCP tools, a trigger mechanism, and delivery channels into a packaged capability. Skills are the execution unit users interact with.
- **Vertical Pack**: A curated bundle of skills marketed for a specific use case (outbound, executive, research). Packs are the commercial unit with their own pricing and credit allocation.
- **Pack Subscription**: A workspace's active subscription to a vertical pack, tracking billing period, credits used, credits included, and payment status.
- **Agent Invocation**: A single execution of an agent, recording input, output, tokens, cost, and performance metrics.
- **Skill Execution**: A full end-to-end run of a skill from trigger to delivery, encompassing one or more agent invocations and MCP tool calls.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: Admins can create, test, and publish a new agent in under 10 minutes through the dashboard
- **SC-002**: Admins can register an MCP server and verify its health in under 5 minutes
- **SC-003**: Admins can compose a skill from existing agents and MCP tools and test it end-to-end in under 15 minutes
- **SC-004**: Admins can create and publish a new vertical pack (bundling existing skills) in under 10 minutes
- **SC-005**: Workspace admins can browse the pack catalog, subscribe to a pack, and invoke a skill in under 3 minutes
- **SC-006**: The enrichment pipeline migration produces identical results to the current implementation for 100% of test cases
- **SC-007**: 95% of skill executions complete successfully (excluding external API failures)
- **SC-008**: Full execution traces are available for 100% of skill invocations within 5 seconds of completion
- **SC-009**: Platform supports 10+ published agents, 20+ published skills, and 3+ published packs within the first quarter
- **SC-010**: Multi-pack subscribers (workspaces subscribing to 2+ packs) reach 15% of paid users within 3 months of launch

### Assumptions

- The existing admin authentication and authorization system (Spec 35) is sufficient for platform admin operations
- The existing billing system (Stripe integration, credit packs) can be extended for pack-level subscriptions without a full rewrite
- The existing BullMQ job queue infrastructure has sufficient capacity for additional skill execution workloads
- The existing prompt library / content library in the admin dashboard will evolve into the agent prompt management system
- Dev Labs admins create all agents, MCP servers, skills, and packs initially — admin-created pack tooling for external users is a future phase
- The Chrome Extension (Spec 36) and free public tools (Spec 36) will become triggers for skills in the platform, but Spec 36 ships first
