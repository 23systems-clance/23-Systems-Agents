# Feature Specification: Visual Workflow Builder

**Feature Branch**: `7-workflow-builder`
**Created**: 2026-03-08
**Status**: Draft
**Input**: User description: "Visual Workflow Builder for Slack Enrichment Flows — a drag-and-drop builder in the admin dashboard (like ActiveCampaign/HubSpot) that lets non-technical users create, edit, and deploy Slack-based enrichment flows without code. Must build out both the backend API and the frontend UI."

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Build an Enrichment Workflow from a Template (Priority: P1)

An admin opens the Workflow Builder page in the dashboard and sees a library of pre-built templates (Company Enrichment, Contact Enrichment, Combined Enrichment). They select "Company Enrichment," which loads a fully configured flow onto the canvas: file upload trigger → list type selection → enrichment type buttons → purpose selection → job creation. The admin tweaks the button labels (e.g., changes "Get Technographics" to "Tech Stack Lookup"), saves the workflow, and publishes it. The next time a Slack user uploads a file, the bot renders this customized flow.

**Why this priority**: Templates provide immediate value by letting users get started without designing a flow from scratch. This validates the entire pipeline — frontend builder UI → backend API → database → Slack runtime engine.

**Independent Test**: Can be tested by opening the builder, loading a template, making a small edit, publishing, and uploading a file in Slack to verify the customized flow renders correctly.

**Acceptance Scenarios**:

1. **Given** an admin is on the Workflow Builder page, **When** they click a template card, **Then** the full flow loads on the canvas with all nodes pre-configured and connected.
2. **Given** a template flow is loaded, **When** the admin edits a button label on a node and clicks "Publish," **Then** the backend API saves the workflow version, marks it active, and the Slack bot uses the updated label in the next file upload interaction.
3. **Given** a published workflow exists, **When** a Slack user uploads a CSV/XLSX file, **Then** the Slack runtime engine reads the workflow config from the database via the backend API and renders the first step as a Block Kit message.

---

### User Story 2 - Create a Custom Workflow from Scratch (Priority: P2)

An admin clicks "New Workflow," which opens an empty canvas with a node palette on the left. They drag a Trigger node (file upload) onto the canvas, then add a Button Choice node with two options ("Company List" / "Contact List"), connect them, and continue building. They configure each node via a right-side panel — setting message text, button labels, enrichment parameters, and branching conditions. When finished, they validate the flow, save as draft, preview the Slack messages, and publish.

**Why this priority**: Custom flows unlock the full power of the builder for non-standard use cases — adding custom approval steps, restricting enrichment by channel, or collecting extra metadata.

**Independent Test**: Can be tested by creating a 3-node flow (Trigger → Message → Action), saving via the backend API, publishing, and triggering it from Slack.

**Acceptance Scenarios**:

1. **Given** an admin clicks "New Workflow," **When** they drag a Trigger node from the palette onto the canvas, **Then** the node appears on the canvas and the configuration panel opens on the right.
2. **Given** two nodes exist on the canvas, **When** the admin drags from one node's output handle to another node's input handle, **Then** a visual connection (edge) is created between them.
3. **Given** a workflow has incomplete nodes, **When** the admin clicks "Validate," **Then** the builder highlights incomplete nodes with error indicators and lists the issues.
4. **Given** a valid workflow, **When** the admin clicks "Save Draft," **Then** the frontend sends the full workflow graph (nodes, edges, positions, configs) to the backend API which persists it as a draft version.
5. **Given** a saved draft, **When** the admin clicks "Preview" on a Message node, **Then** a Slack Block Kit preview renders showing how the message will appear in Slack.

---

### User Story 3 - Manage Workflow Lifecycle (Priority: P2)

An admin navigates to the Workflows list page and sees all workflows with their status (Draft, Active, Archived) and key metrics (total runs, completion rate). They can clone an existing workflow, archive an old workflow, or edit a draft. When they edit an active workflow, the system creates a new draft version so the live workflow isn't disrupted.

**Why this priority**: Lifecycle management ensures production stability — admins can iterate without breaking live Slack interactions. Versioning prevents accidental disruptions.

**Independent Test**: Can be tested by creating a workflow, publishing it, editing it, and verifying the backend creates a new draft version while the original remains active.

**Acceptance Scenarios**:

1. **Given** a list of workflows exists, **When** the admin views the Workflows page, **Then** the frontend fetches from the backend API and displays each workflow's name, status, last modified date, total runs, and completion rate.
2. **Given** an active workflow, **When** the admin clicks "Edit," **Then** the backend API creates a new draft version while the active version remains unchanged.
3. **Given** a draft version exists alongside an active version, **When** the admin publishes the draft, **Then** the backend atomically swaps versions — draft becomes active, previous active is archived.
4. **Given** an active workflow, **When** the admin clicks "Clone," **Then** the backend creates a new draft with the same node configuration named "Copy of [Original Name]."

---

### User Story 4 - Monitor Workflow Execution Analytics (Priority: P3)

An admin opens a workflow's detail page and sees execution analytics: total runs, completion rate, average time to complete, and a funnel visualization showing drop-off at each step. Per-node metrics show which buttons users click most and where bottlenecks occur.

**Why this priority**: Analytics close the feedback loop. However, workflows deliver value even without analytics, making this lower priority.

**Independent Test**: Can be tested by running a workflow 5+ times in Slack, then viewing the analytics page to confirm metrics match actual interactions.

**Acceptance Scenarios**:

1. **Given** a workflow has been executed multiple times, **When** the admin views the analytics page, **Then** the frontend displays total runs, completion rate, and average completion time from the backend API.
2. **Given** a workflow with Button Choice nodes, **When** the admin views per-node analytics, **Then** they see the percentage of users who selected each button option.
3. **Given** a multi-step workflow, **When** the admin views the funnel visualization, **Then** they see execution counts per step and drop-off percentages.

---

### User Story 5 - Runtime Workflow Execution in Slack (Priority: P1)

A Slack user uploads a CSV file. The bot detects the file upload, calls the backend API to fetch the active workflow for that trigger type, and renders the first step as a Block Kit message. When the user clicks a button, the bot calls the backend to record the interaction and get the next node. This continues until the flow reaches a terminal action node (e.g., create enrichment job). The backend tracks execution state and the bot handles rendering.

**Why this priority**: Co-P1 with Story 1 — without the runtime engine (backend execution logic + Slack bot rendering), the builder has no output. They must ship together.

**Independent Test**: Can be tested by publishing a template workflow and running through it end-to-end in Slack — upload a file, click through each step, verify the enrichment job is created.

**Acceptance Scenarios**:

1. **Given** an active workflow with a file upload trigger, **When** a user uploads a CSV/XLSX in Slack, **Then** the bot calls the backend API to start an execution, receives the first node's config, and renders it as a Block Kit message.
2. **Given** the bot has rendered a Button Choice step, **When** the user clicks a button, **Then** the bot sends the interaction to the backend, which resolves the next node and returns its config.
3. **Given** a workflow with an Enrichment action node, **When** the flow reaches that node, **Then** the backend creates the enrichment job and queues it to BullMQ.
4. **Given** a user is mid-flow and leaves Slack, **When** they return and interact with the last message, **Then** the backend finds their existing execution and resumes from the last node.
5. **Given** a node fails, **When** the error occurs, **Then** the bot shows a user-friendly error message with a "Retry" button.

---

### User Story 6 - Backend API for Workflow CRUD and Execution (Priority: P1)

The backend exposes RESTful API endpoints for the full workflow lifecycle: create, read, update, delete workflows; manage versions; start/advance/complete executions; and query analytics. The frontend dashboard and the Slack bot both consume these APIs. All workflow data is persisted in PostgreSQL via Prisma. The API handles validation (circular reference detection, trigger conflict checks) and enforces business rules.

**Why this priority**: The backend API is the foundation — both the frontend builder and the Slack runtime depend on it. Without the API, neither the UI nor the bot can function.

**Independent Test**: Can be tested by calling API endpoints directly (via curl) to create a workflow, add nodes, publish, start an execution, advance through nodes, and query analytics — all without the frontend.

**Acceptance Scenarios**:

1. **Given** the backend API is running, **When** a client sends a create workflow request with a name and trigger type, **Then** the API creates a new workflow record with a draft version and returns the workflow ID.
2. **Given** a draft workflow exists, **When** a client sends an update with a nodes/edges payload, **Then** the API validates the graph (no circular refs, all nodes complete) and persists it.
3. **Given** a valid draft, **When** a client sends a publish request, **Then** the API atomically promotes the draft to active, archives any previously active version, and returns the new status.
4. **Given** an active workflow, **When** the Slack bot sends an execute request with trigger data, **Then** the API creates an execution record, resolves the first node, and returns its config.
5. **Given** an in-progress execution, **When** a client sends an advance request with user interaction data, **Then** the API records the interaction, resolves the next node via edge traversal, and returns the next node's config.

---

### Edge Cases

- What happens when a user uploads a file but no active workflow has a matching trigger? The backend returns a "no workflow" response and the bot falls back to the legacy hardcoded flow during migration.
- What happens when an admin publishes a new version while a user is mid-flow? In-progress executions continue on the version they started with; only new triggers use the new version.
- What happens when a workflow has a circular reference? The backend's validation rejects circular paths before allowing publish.
- What happens when a Slack user clicks a button from an expired execution? The backend returns "execution expired" and the bot tells the user to start a new one.
- What happens when two active workflows have conflicting triggers? The backend enforces one active workflow per trigger type and returns a conflict error.
- What happens when an admin deletes a node connected to other nodes? The frontend removes connected edges and highlights disconnected nodes.
- What happens when the backend API is unavailable during a Slack interaction? The bot catches the error and shows "Service temporarily unavailable, please try again."

## Requirements _(mandatory)_

### Functional Requirements

#### Frontend — Visual Builder (Dashboard)

- **FR-001**: System MUST provide a drag-and-drop canvas where admins can place, move, and connect workflow nodes.
- **FR-002**: System MUST provide a node palette (left sidebar) containing all available node types that can be dragged onto the canvas.
- **FR-003**: System MUST provide a configuration panel (right sidebar) that opens when a node is selected, allowing admins to set node-specific properties.
- **FR-004**: System MUST support visual connections (edges) between nodes, created by dragging from an output handle to an input handle.
- **FR-005**: System MUST support branching paths — a single node can have multiple outgoing edges, each labeled with the condition/choice that triggers it.
- **FR-006**: System MUST provide a "Validate" function that checks the workflow for structural errors and highlights issues visually on the canvas.
- **FR-007**: System MUST provide a Slack Block Kit preview for Message and Button Choice nodes.
- **FR-008**: System MUST support undo/redo for all canvas operations.
- **FR-009**: System MUST support canvas controls: zoom in/out, pan, fit-to-screen, and a minimap.
- **FR-010**: System MUST provide auto-layout functionality to arrange nodes in a clean layout.
- **FR-011**: System MUST display a workflow list page showing all workflows with status, last modified date, and execution metrics fetched from the backend API.
- **FR-012**: System MUST provide "Save Draft," "Publish," "Clone," and "Archive" actions that call the corresponding backend API endpoints.

#### Frontend — Node Types

- **FR-013**: System MUST support **Trigger nodes** with configurable trigger types: file upload detection, keyword match, slash command, and manual trigger.
- **FR-014**: System MUST support **Message nodes** with configurable message text and Block Kit formatting.
- **FR-015**: System MUST support **Button Choice nodes** with configurable button labels (2-5 buttons) where each button creates a separate branch path.
- **FR-016**: System MUST support **Form/Modal nodes** that define Slack modal dialogs with configurable input fields.
- **FR-017**: System MUST support **Enrichment nodes** with configurable enrichment type (Technographic, Contact, Combined) and parameters.
- **FR-018**: System MUST support **Condition nodes** that branch based on data evaluation (row count, column presence, file type).
- **FR-019**: System MUST support **Action nodes** for system operations: create enrichment job, upload file to S3, send Slack notification message, update execution context variables.
- **FR-020**: System MUST support **Delay nodes** that pause execution for a configured duration (seconds).

#### Frontend — Template Library

- **FR-021**: System MUST provide at least three pre-built workflow templates: Company Enrichment, Contact Enrichment, and Combined Enrichment.
- **FR-022**: System MUST allow admins to load a template onto the canvas as a starting point and customize it.
- **FR-023**: System MUST allow admins to save their own workflows as custom templates for reuse.

#### Backend — Workflow CRUD API

- **FR-024**: Backend MUST expose RESTful endpoints to create, read, update, and delete workflow templates.
- **FR-025**: Backend MUST expose endpoints to manage workflow versions: create draft, update draft, publish, archive, restore.
- **FR-026**: Backend MUST validate workflow graphs on save and publish: detect circular references, disconnected nodes, incomplete configurations, and trigger conflicts.
- **FR-027**: Backend MUST enforce that only one workflow can be active per trigger type.
- **FR-028**: Backend MUST support cloning a workflow — creating a new draft with a deep copy of all nodes, edges, and configuration.
- **FR-029**: Backend MUST persist workflow data with full audit fields (created/updated timestamps, created by user).

#### Backend — Workflow Execution Engine

- **FR-030**: Backend MUST expose an endpoint to start a workflow execution given a trigger type and context data.
- **FR-031**: Backend MUST resolve the active workflow for a given trigger type and create an execution record with the initial node.
- **FR-032**: Backend MUST expose an endpoint to advance an execution — accepting user interaction data, recording it, traversing the correct edge, and returning the next node's configuration.
- **FR-033**: Backend MUST track execution state per conversation: current node, collected inputs, branch decisions, and timestamps.
- **FR-034**: Backend MUST support execution resumption — finding an existing in-progress execution for a user/channel/thread.
- **FR-035**: Backend MUST handle version transitions — in-progress executions continue on the version they started with.
- **FR-036**: Backend MUST execute action nodes: creating enrichment jobs (enqueuing to BullMQ), sending Slack messages, uploading files.
- **FR-037**: Backend MUST provide error handling for each node execution with retry-able error responses.

#### Backend — Analytics API

- **FR-038**: Backend MUST track and expose execution metrics per workflow: total runs, completions, failures, average completion time.
- **FR-039**: Backend MUST track and expose per-node metrics: execution count, time spent, choice distribution for Button Choice nodes.
- **FR-040**: Backend MUST expose an endpoint to retrieve funnel data: step-by-step execution counts and drop-off percentages.

#### Slack Runtime (Bot Layer)

- **FR-041**: Slack bot MUST detect trigger events and call the backend API to start or resume a workflow execution.
- **FR-042**: Slack bot MUST render Block Kit messages based on node configurations returned by the backend API.
- **FR-043**: Slack bot MUST capture user interactions and forward them to the backend API to advance the execution.
- **FR-044**: Slack bot MUST handle error responses from the backend by showing user-friendly messages with retry options.
- **FR-045**: Slack bot MUST fall back to the legacy hardcoded flow if no active workflow is configured for a trigger type.

#### Workflow Lifecycle

- **FR-046**: System MUST support workflow statuses: Draft, Active, and Archived.
- **FR-047**: System MUST support versioning — editing an active workflow creates a new draft version while the active version remains live.
- **FR-048**: System MUST support publishing a draft version, which atomically swaps it to Active and archives the previous version.

### Key Entities

- **WorkflowTemplate**: A named workflow definition containing metadata (name, description, trigger type), status, and a reference to its versions. Represents the "blueprint" of a Slack interaction flow.
- **WorkflowVersion**: A point-in-time snapshot of a WorkflowTemplate's configuration. Contains the complete node/edge graph, version number, status (Draft/Active/Archived), and canvas layout positions.
- **WorkflowExecution**: A single run of a workflow by a specific Slack user in a specific channel/thread. Tracks current node, workflow version used, collected inputs, branch decisions, timestamps, and completion status. Contains a `nodeHistory` JSONB array that records per-node execution data (node ID, enter/exit timestamps, user input, output) — this powers per-node analytics without a separate table.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: Non-technical admins can create and publish a new enrichment workflow in under 15 minutes using the visual builder, without writing any code.
- **SC-002**: All three default enrichment flows (Company, Contact, Combined) are available as one-click templates.
- **SC-003**: Published workflows render correctly in Slack with the same interaction quality as the current hardcoded flows.
- **SC-004**: Workflow changes can be deployed without application restarts or code deploys — publishing from the dashboard immediately takes effect.
- **SC-005**: 90% of workflow executions complete successfully without errors or system-caused drop-off.
- **SC-006**: Workflow analytics accurately reflect execution data within 1% accuracy.
- **SC-007**: Publishing a new version never disrupts in-progress executions on the previous version.
- **SC-008**: Validation catches 100% of structural errors before publishing.
- **SC-009**: Backend API responds to all workflow requests in under 500ms under normal load.
- **SC-010**: Frontend builder loads and renders a workflow with up to 50 nodes without UI lag.

## Assumptions

- Admins are authenticated via the existing admin dashboard login system.
- The existing Slack bot infrastructure (Socket Mode, Block Kit, event listeners) will be extended, not replaced.
- Only one workflow can be active per trigger type to prevent conflicts.
- Migration is phased — legacy listeners remain as fallback if no workflow is configured for a trigger type.
- The visual builder is desktop-only for editing; the workflows list is responsive for mobile viewing.
- Workflow executions expire after 1 hour of inactivity (the `expiresAt` timestamp resets to `now + 1 hour` on each user interaction via `resumeWithInput`).
- The 3 default templates mirror the exact behavior of current hardcoded enrichment flows.
- Analytics are eventually consistent (under 1 minute delay).
- Backend API endpoints live under the existing Express server alongside current admin routes.
- Frontend workflow builder pages are added to the existing admin dashboard React app.

## Scope Boundaries

### In Scope

- **Frontend**: Visual drag-and-drop workflow builder (canvas, node palette, config panel, template library, workflow list, analytics views)
- **Backend**: RESTful API for workflow CRUD, version management, execution engine, graph validation, analytics
- **Slack Runtime**: Bot integration that calls backend API to start/advance executions and renders Block Kit
- **Database**: New Prisma models for workflow templates, versions, executions, node executions
- **8 node types**: Trigger, Message, Button Choice, Form/Modal, Enrichment, Condition, Action, Delay
- **3 pre-built enrichment templates**
- **Workflow versioning and lifecycle** (Draft/Active/Archived)
- **Execution tracking and analytics**
- **Migration compatibility** with existing hardcoded enrichment flows

### Out of Scope

- Workflows for non-Slack channels (email, SMS, web)
- Custom code/script nodes — all logic is declarative via node configuration
- Multi-workflow orchestration (one workflow triggering another)
- User-facing workflow builder (admin-only)
- Real-time collaborative editing
- AI-assisted workflow generation
- Webhook-based triggers from external systems

## Dependencies

- Existing admin dashboard frontend (React 19, Vite, Radix UI, TanStack Query, Recharts)
- Existing backend server (Express, Prisma, PostgreSQL)
- Existing Slack bot (Socket Mode, Block Kit, event listeners)
- Existing enrichment infrastructure (BullMQ, BuiltWith, Apollo, file generation workers)
- Existing conversation state management (Redis-backed)
