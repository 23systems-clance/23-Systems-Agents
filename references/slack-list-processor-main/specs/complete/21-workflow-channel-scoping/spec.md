# Feature Specification: Workflow Channel Scoping

**Feature Branch**: `21-workflow-channel-scoping`
**Created**: 2026-03-11
**Status**: Draft
**Input**: User description: "Associate workflows with specific clients and Slack channels for per-client workflow routing with 3-tier resolution priority."

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Assign Workflow to Client (Priority: P1)

As an admin, I want to assign a workflow to a specific client so that when files are uploaded in any of that client's mapped channels, the correct client-specific workflow runs automatically.

**Why this priority**: This is the core value proposition. Most users think of workflows as "per client" since each client has different enrichment needs, campaign setups, and processing steps. Without this, all channels share one workflow regardless of client context.

**Independent Test**: Can be fully tested by creating a workflow, assigning it to a client via the workflow builder, uploading a file in a channel mapped to that client, and verifying the client-specific workflow executes instead of the team default.

**Acceptance Scenarios**:

1. **Given** a workflow exists with no client assignment, **When** an admin assigns it to "Acme Inc" via the workflow builder, **Then** the workflow is linked to Acme and appears in the Acme client detail page under "Associated Workflows."
2. **Given** a workflow is assigned to Acme and channels #acme-leads and #acme-outbound are mapped to Acme, **When** a BDR uploads a file in #acme-leads, **Then** the Acme-specific workflow executes (not the team default).
3. **Given** a workflow is assigned to Acme, **When** a BDR uploads a file in #general (which has no client mapping), **Then** the team-level fallback workflow executes instead.
4. **Given** a client already has an active workflow for FILE_UPLOAD, **When** an admin publishes a second FILE_UPLOAD workflow for the same client, **Then** the system shows a warning naming the existing workflow, auto-deactivates it, and activates the new one.

---

### User Story 2 - Override Workflow for Specific Channel (Priority: P2)

As an admin, I want to assign a specific workflow to a particular Slack channel, overriding the client default, so that specialized channels can have tailored processing even within the same client.

**Why this priority**: Provides fine-grained control for edge cases. Some clients may have a "standard" channel and a "VIP" channel that needs a different workflow (e.g., more enrichment steps, different campaign routing). This is the override layer that gives maximum flexibility.

**Independent Test**: Can be fully tested by mapping a channel directly to a workflow, uploading a file in that channel, and verifying the channel-specific workflow runs instead of the client-level default.

**Acceptance Scenarios**:

1. **Given** Acme has a default workflow and #acme-vip is mapped to Acme, **When** an admin maps #acme-vip directly to a "VIP Enrichment" workflow, **Then** uploads in #acme-vip use the VIP workflow while uploads in other Acme channels use the Acme default.
2. **Given** a channel is directly mapped to a workflow, **When** that workflow is archived/deactivated, **Then** the system falls back to the client-level workflow for that channel (or team default if no client workflow exists).
3. **Given** a channel already has a direct workflow mapping for FILE_UPLOAD, **When** an admin assigns a different FILE_UPLOAD workflow to the same channel, **Then** the old mapping is replaced with the new one (one workflow per channel per trigger type).
4. **Given** a channel has a direct FILE_UPLOAD workflow mapping, **When** an admin also maps a WEBHOOK workflow to the same channel, **Then** both mappings coexist and each triggers independently based on trigger type.

---

### User Story 3 - View Workflows in Client Detail Page (Priority: P2)

As an admin, I want to see all workflows associated with a client on the client detail page so I can understand what processing is configured for that client at a glance.

**Why this priority**: Essential for operational visibility. Without this, admins must search through the workflow list to understand which workflows belong to which client. This provides a direct navigation path from client to workflow.

**Independent Test**: Can be fully tested by navigating to a client detail page and verifying that workflows assigned to that client are listed with name, trigger type, version, and publication status, and that clicking a workflow navigates to the workflow builder.

**Acceptance Scenarios**:

1. **Given** a client has 2 assigned workflows (one FILE_UPLOAD, one WEBHOOK), **When** an admin views the client detail page, **Then** both workflows appear in an "Associated Workflows" section with name, trigger type, current version, and status.
2. **Given** a client has associated workflows, **When** an admin clicks a workflow row, **Then** they are navigated to the workflow builder for that workflow.
3. **Given** a client has no associated workflows, **When** an admin views the client detail page, **Then** the section displays an empty state message.

---

### User Story 4 - Filter Workflows by Client on List Page (Priority: P3)

As an admin, I want to see which client each workflow belongs to on the workflow list page so I can quickly identify and manage workflows across all clients.

**Why this priority**: Quality-of-life improvement for the admin experience. The list page is the primary entry point for workflow management and showing client context reduces navigation back-and-forth.

**Independent Test**: Can be fully tested by viewing the workflow list and verifying each workflow shows its assigned client name (or "Team Default" for unassigned workflows).

**Acceptance Scenarios**:

1. **Given** workflows exist with various client assignments, **When** an admin views the workflow list page, **Then** each workflow row displays the client name or "Team Default" label.
2. **Given** the workflow list page, **When** an admin filters by a specific client, **Then** only workflows assigned to that client are displayed.

---

### User Story 5 - Workflow Scope Configuration in Builder (Priority: P1)

As an admin, I want to configure a workflow's client assignment and channel overrides directly in the workflow builder so that scoping is managed alongside the workflow definition itself.

**Why this priority**: The workflow builder is where admins configure workflow behavior. Client and channel scoping is a natural extension of the workflow configuration and should live in the same place to maintain a cohesive editing experience.

**Independent Test**: Can be fully tested by opening the workflow builder, using the scope panel to assign a client and add channel overrides, saving, and verifying the assignments persist and are reflected in the workflow detail response.

**Acceptance Scenarios**:

1. **Given** an admin is editing a workflow in the builder, **When** they open the scope panel, **Then** they see a client dropdown (optional) and a channel list for direct channel overrides.
2. **Given** a workflow has no client assigned, **When** the admin selects a client from the dropdown, **Then** the workflow becomes a client-level default for that client.
3. **Given** a workflow is assigned to a client, **When** the admin adds channels via the channel picker, **Then** those channels are directly mapped to this workflow (channel-level override).
4. **Given** a workflow has channel overrides, **When** the admin removes a channel from the list, **Then** the direct mapping is deleted and the channel reverts to using the client-level default workflow.

---

### Edge Cases

- What happens when a channel has no client mapping and no direct workflow mapping? The system uses the team-level fallback workflow (no client assigned).
- What happens when a client is deactivated but has an active workflow? The workflow remains active. Client activation status does not affect workflow execution.
- What happens when a workflow assigned to a client is deleted? All channel-to-workflow mappings for that workflow are removed automatically. The channels revert to client-level or team-level fallback resolution.
- What happens when a channel is remapped from Client A to Client B? The channel automatically starts using Client B's workflow on the next trigger. Any direct channel-to-workflow mapping remains unchanged (it overrides client-level regardless).
- What happens when no workflow matches at any tier (no channel, no client, no team fallback)? No workflow executes. The system falls back to the legacy enrichment flow (existing behavior when no workflow is found).
- What happens with concurrent executions when workflow assignment changes mid-execution? Running executions continue with the workflow version they started with. Only new triggers use the updated resolution.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: System MUST support assigning a workflow to a specific client (optional, nullable relationship).
- **FR-002**: System MUST support mapping a specific Slack channel directly to a specific workflow, scoped per trigger type (one workflow per channel per trigger type maximum).
- **FR-003**: System MUST resolve workflows at trigger time using a 3-tier priority: (1) channel-specific mapping, (2) client-level workflow via channel-to-client mapping, (3) team-level fallback (no client assigned).
- **FR-004**: System MUST fall through to the next tier when the current tier's workflow is inactive, has no published version, or does not match the trigger type.
- **FR-005**: When publishing a workflow that conflicts with an existing active workflow (same trigger type and same client assignment, including both being team-level fallback), the system MUST auto-deactivate the existing workflow with a warning shown to the admin.
- **FR-006**: System MUST display associated workflows in the client detail page with name, trigger type, version, and publication status.
- **FR-007**: System MUST provide a scope configuration panel in the workflow builder for assigning client and channel overrides.
- **FR-008**: System MUST display the assigned client name (or "Team Default") on the workflow list page for each workflow.
- **FR-009**: System MUST cascade-delete channel-to-workflow mappings when the workflow is deleted.
- **FR-010**: System MUST preserve all existing workflows as team-level fallbacks (no client assigned) with no behavior change during migration.
- **FR-011**: System MUST allow filtering the workflow list by client.
- **FR-012**: System MUST allow removing a client assignment from a workflow, reverting it to a team-level fallback.

### Key Entities

- **WorkflowTemplate** (extended): Existing workflow definition entity, extended with an optional client relationship. A workflow can belong to zero or one client.
- **WorkflowChannelMapping** (new): A mapping between a Slack channel and a specific workflow, scoped by trigger type. Each channel can map to at most one workflow per trigger type. This provides the channel-level override in the 3-tier resolution.
- **ChannelClientMapping** (existing, unchanged): Maps channels to clients. Used in tier-2 resolution to determine which client a channel belongs to, then look up that client's workflow.
- **ManagedClient** (extended relation): Existing client entity, extended with a reverse relationship to see all associated workflows.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: Admins can assign a workflow to a client and see it reflected in the client detail page within a single session (no page refresh required).
- **SC-002**: When a file is uploaded in a channel mapped to a client with a specific workflow, the correct client-level workflow executes 100% of the time.
- **SC-003**: Channel-level workflow overrides take precedence over client-level defaults in all trigger scenarios.
- **SC-004**: Existing workflows continue to function identically after migration with zero manual intervention required.
- **SC-005**: Admins can configure workflow scope (client and channel overrides) in under 60 seconds using the builder panel.
- **SC-006**: The workflow list page clearly distinguishes client-assigned workflows from team defaults at a glance.
- **SC-007**: The 3-tier resolution adds less than 100ms additional latency to workflow trigger processing compared to the current single-tier lookup.

## Clarifications

### Session 2026-03-11

- Q: When publishing a workflow for a client+trigger that already has an active workflow, should the system auto-deactivate the existing one, block publishing, or show a confirm-swap dialog? → A: Auto-deactivate the existing workflow with a warning shown to the admin.
- Q: Should channel-to-workflow mappings be unique per channel (one workflow total) or per channel per trigger type? → A: Per channel per trigger type, allowing different workflow overrides for FILE_UPLOAD vs WEBHOOK on the same channel.

## Assumptions

- A channel can be mapped to one workflow per trigger type. This allows different workflow overrides for FILE_UPLOAD vs WEBHOOK on the same channel.
- The scope panel in the workflow builder is a collapsible sidebar section or panel within the existing builder layout, not a separate page.
- Channel names are resolved from Slack for display purposes (existing pattern in the codebase).
- The "filter by client" on the workflow list page is implemented as a dropdown filter, consistent with existing filter patterns (status tabs).
