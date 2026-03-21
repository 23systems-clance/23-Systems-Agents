# Quickstart: Visual Workflow Builder

**Feature**: 7-workflow-builder
**Date**: 2026-03-08

## Prerequisites

- Admin dashboard running (deployed to ECS)
- Slack bot connected via Socket Mode
- PostgreSQL with Prisma migrations applied
- Redis available for BullMQ workflow queue

## Test Scenario 1: Load Template and Publish (US1)

**Goal**: Verify an admin can load a template, customize it, and publish it.

### Steps

1. **Open Workflows page**: Navigate to `/workflows` in the admin dashboard.
2. **Create from template**: Click "New Workflow" → select "Company Enrichment" template.
3. **Verify template loads**: Canvas should show ~6 nodes (Trigger → List Type Selection → Enrichment Type → Purpose → Job Creation → Confirmation) with edges connected.
4. **Edit a label**: Click the "Enrichment Type" button choice node → in the right panel, change "Get Technographics" to "Tech Stack Lookup".
5. **Save draft**: Click "Save Draft" — API call to `PUT /api/v1/admin/workflows/:id/versions/:vid`.
6. **Validate**: Click "Validate" — should return `{ valid: true }`.
7. **Publish**: Click "Publish" — API call to `POST /api/v1/admin/workflows/:id/publish`.
8. **Verify in Slack**: Upload a CSV file in Slack → bot should render the first step using the workflow config (not the hardcoded flow). Button label should say "Tech Stack Lookup".

### Expected Results

- Workflow appears in the list with status "Published"
- Slack interaction renders using the workflow engine, not legacy listeners
- The customized button label appears correctly

## Test Scenario 2: Create Custom Workflow (US2)

**Goal**: Verify an admin can build a workflow from scratch.

### Steps

1. **New blank workflow**: Click "New Workflow" → "Start from scratch".
2. **Add trigger**: Drag "Trigger" node from palette → configure as `FILE_UPLOAD`.
3. **Add message**: Drag "Message" node → connect from trigger → configure with text "File received! What would you like to do?".
4. **Add button choice**: Drag "Button Choice" node → connect from message → add 2 buttons: "Enrich Companies" and "Just Download".
5. **Add enrichment**: Drag "Enrichment" node → connect from "Enrich Companies" button output.
6. **Add action**: Drag "Action" node → connect from "Just Download" button output.
7. **Validate**: Click "Validate" — should pass.
8. **Save and publish**: Save draft, then publish.
9. **Test in Slack**: Upload a file → verify the custom message and buttons appear.

### Expected Results

- 5-node workflow created and published
- Drag-and-drop, connection, and configuration all work smoothly
- Slack renders the custom flow correctly

## Test Scenario 3: Version Management (US3)

**Goal**: Verify editing an active workflow creates a new version without disrupting live flow.

### Steps

1. **Start with published workflow** from Scenario 1.
2. **Click "Edit"**: Should create a new draft version (v2) while v1 remains active.
3. **Verify Slack still works**: Upload a file → should use v1 (published version).
4. **Edit the draft**: Add a new node to the flow.
5. **Publish v2**: The draft becomes published, v1 becomes archived.
6. **Verify Slack uses v2**: Upload a file → should show the new node.
7. **Verify in-progress executions**: If a user was mid-flow on v1 when v2 was published, they should continue on v1.

### Expected Results

- Version numbers increment correctly
- Active version is never disrupted during editing
- In-progress executions stay on their original version

## Test Scenario 4: Workflow Execution in Slack (US5)

**Goal**: Verify end-to-end workflow execution including resume and error handling.

### Steps

1. **Publish a workflow** with at least 3 interactive steps.
2. **Upload a file in Slack**: Bot should start the workflow and show the first step.
3. **Click a button**: Bot should advance to the next step.
4. **Wait 5 minutes, then click**: Execution should still be valid (within 1-hour expiry).
5. **Complete the flow**: Should reach the enrichment action and create a job.
6. **Verify execution record**: Call `GET /api/v1/admin/workflows/:id/executions` — should show the completed execution with full node history.

### Expected Results

- Each step renders correct Block Kit messages
- Button clicks advance the flow correctly
- Enrichment jobs are created at action nodes
- Execution record shows complete history

## Test Scenario 5: Analytics (US4)

**Goal**: Verify execution analytics are accurate.

### Steps

1. **Run a workflow 5+ times** with varying paths (some complete, some abandoned).
2. **View analytics page**: Navigate to `/workflows/:id/analytics`.
3. **Verify summary**: Total runs, completion rate, average duration should match actual interactions.
4. **View funnel**: Step-by-step counts should show correct drop-off.
5. **View per-node metrics**: For Button Choice nodes, choice distribution should match actual clicks.

### Expected Results

- Analytics accurately reflect execution data
- Funnel visualization shows correct drop-off percentages
- Per-node choice distribution matches actual interactions

## Test Scenario 6: Legacy Fallback (Edge Case)

**Goal**: Verify the bot falls back to hardcoded flow when no workflow is configured.

### Steps

1. **Ensure no workflow is published** for `FILE_UPLOAD` trigger type.
2. **Upload a file in Slack**: Should use the existing hardcoded enrichment flow.
3. **Publish a workflow** for `FILE_UPLOAD`.
4. **Upload another file**: Should now use the workflow engine.
5. **Archive the workflow**.
6. **Upload a file again**: Should fall back to hardcoded flow.

### Expected Results

- Graceful fallback to legacy listeners
- No errors when switching between workflow-driven and legacy flows

## API Quick-Test Commands

```bash
BASE_URL="https://your-ecs-url/api/v1/admin"

# List templates
curl -s "$BASE_URL/workflows/templates" | jq

# Create workflow from template
curl -s -X POST "$BASE_URL/workflows" \
  -H "Content-Type: application/json" \
  -d '{"slack_team_id":"T12345","name":"Test Flow","trigger_type":"FILE_UPLOAD","created_by_user_id":"U12345","from_template":"company_enrichment"}' | jq

# Get workflow with graph
curl -s "$BASE_URL/workflows/{workflowId}/versions/{versionId}" | jq

# Validate workflow
curl -s -X POST "$BASE_URL/workflows/{workflowId}/validate" | jq

# Publish workflow
curl -s -X POST "$BASE_URL/workflows/{workflowId}/publish" \
  -H "Content-Type: application/json" \
  -d '{"published_by_user_id":"U12345"}' | jq

# Get analytics
curl -s "$BASE_URL/workflows/{workflowId}/analytics?teamId=T12345&period=30d" | jq

# Get funnel
curl -s "$BASE_URL/workflows/{workflowId}/analytics/funnel?teamId=T12345" | jq
```
