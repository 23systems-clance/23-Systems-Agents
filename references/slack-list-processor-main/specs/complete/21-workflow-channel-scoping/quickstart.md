# Quickstart: Workflow Channel Scoping

**Feature**: 21-workflow-channel-scoping
**Date**: 2026-03-11

## Prerequisites

- Branch: `21-workflow-channel-scoping`
- AWS ECS deployment (never run locally)
- At least one ManagedClient with channel mappings already configured
- At least one existing WorkflowTemplate (becomes team-level fallback after migration)

## Implementation Order

### Step 1: Schema Changes
1. Add `clientId` FK to `WorkflowTemplate` in `prisma/schema.prisma`
2. Add `WorkflowChannelMapping` model to `prisma/schema.prisma`
3. Add `workflows` relation to `ManagedClient`
4. Push to GitHub → ECS entrypoint runs `prisma db push` on startup

### Step 2: Backend - Core Resolution Logic
1. Add `resolveWorkflowTemplate()` to `src/services/workflow/workflowEngine.ts`
2. Update `startExecution()` to use the new resolver instead of direct `findFirst`
3. Add tier resolution logging

### Step 3: Backend - Service Layer Updates
1. Update `createWorkflow()` in `workflowService.ts` to accept `clientId`
2. Update `listWorkflows()` to include client info and accept `clientId` filter
3. Update `getWorkflow()` to include client and channel mappings
4. Update `publishVersion()` conflict check to scope by `clientId`
5. Update `publishVersion()` to auto-deactivate conflicting workflow with warning

### Step 4: Backend - API Routes
1. Add `PUT /workflows/:id/client` endpoint
2. Add `GET/POST/DELETE /workflows/:id/channels` endpoints
3. Update `GET /workflows` response with client fields and filter
4. Update `POST /workflows` to accept `client_id`
5. Update `GET /workflows/:id` to include channel mappings
6. Update `GET /clients/:id` to include workflows

### Step 5: Frontend - Types and Services
1. Extend workflow types in `admin-dashboard/src/types/api.ts`
2. Add workflow channel/client API functions in `admin-dashboard/src/services/workflows.ts`
3. Update client detail types in `admin-dashboard/src/services/managed-clients.ts`

### Step 6: Frontend - Workflow List Page
1. Add "Client" column to workflow table
2. Add client filter dropdown

### Step 7: Frontend - Workflow Builder Scope Panel
1. Create `WorkflowScopePanel.tsx` component
2. Integrate into workflow-builder.tsx right sidebar
3. Client dropdown with search
4. Channel list with add/remove via existing `SlackChannelPicker`

### Step 8: Frontend - Client Detail Page
1. Add "Associated Workflows" card to client detail view
2. Display workflow name, trigger type, version, status
3. Click-to-navigate to workflow builder

## Verification

### After Schema Deploy (Step 1)
- Check CloudWatch logs for successful `prisma db push`
- Verify existing workflows still trigger normally (team-level fallback)

### After Backend Deploy (Steps 2-4)
- Existing FILE_UPLOAD workflows still fire on file upload (regression check)
- `GET /api/v1/admin/workflows` returns `client_id: null` for all existing workflows
- `PUT /api/v1/admin/workflows/:id/client` assigns a client
- `POST /api/v1/admin/workflows/:id/channels` maps a channel
- Upload file in mapped channel → correct workflow runs

### After Frontend Deploy (Steps 5-8)
- Workflow list shows "Team Default" for existing workflows
- Scope panel visible in builder, can assign client and channels
- Client detail page shows associated workflows
- Full E2E: assign workflow to client → upload file in client's channel → correct workflow runs

## Key Files to Modify

| File | Change |
|------|--------|
| `prisma/schema.prisma` | Add clientId to WorkflowTemplate, add WorkflowChannelMapping model |
| `src/services/workflow/workflowEngine.ts` | Add resolveWorkflowTemplate(), update startExecution() |
| `src/services/workflow/workflowService.ts` | Update create/list/get/publish functions |
| `src/routes/admin/workflows.ts` | New channel/client endpoints, update existing responses |
| `src/routes/admin/clientManagement.ts` | Add workflows to client detail |
| `admin-dashboard/src/types/api.ts` | Extend WorkflowListItem, WorkflowDetail, ManagedClientDetail |
| `admin-dashboard/src/services/workflows.ts` | Add channel/client API functions |
| `admin-dashboard/src/pages/workflows.tsx` | Add client column + filter |
| `admin-dashboard/src/pages/workflow-builder.tsx` | Integrate scope panel |
| `admin-dashboard/src/components/workflow/WorkflowScopePanel.tsx` | NEW component |
| `admin-dashboard/src/pages/managed-clients.tsx` | Add workflows card |
