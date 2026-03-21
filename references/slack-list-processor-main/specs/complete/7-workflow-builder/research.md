# Research: Visual Workflow Builder

**Feature**: 7-workflow-builder
**Date**: 2026-03-08

## 1. Visual Builder Library

**Decision**: `@xyflow/react` (React Flow v12+)

**Rationale**: MIT-licensed, TypeScript-first, active maintenance, best-in-class React flow/graph library. Supports custom nodes, edge routing, drag-and-drop from a palette, minimap, controls, and save/load via `toObject()`. Used by Stripe, Vercel, and many workflow builder products.

**Alternatives Considered**:
- JointJS — commercial license, heavier, overkill for this use case
- Flume — unmaintained since 2022
- Custom SVG/Canvas — enormous effort for drag-and-drop, panning, zooming, minimap
- `reactflow` (old package) — deprecated, renamed to `@xyflow/react` in v12

**Key API**:
- `ReactFlow` component, `useNodesState`, `useEdgesState`, `addEdge`
- `Handle`, `Panel`, `MiniMap`, `Controls`, `Background`
- `useReactFlow()` for `toObject()`, `fitView`, `screenToFlowPosition`
- `nodeTypes` object must be defined outside component (memo nodes for performance)
- Custom edges via `BaseEdge` + `getSmoothStepPath`

**Integration Notes**:
- CSS import: `@xyflow/react/dist/style.css`
- Custom nodes can use shadcn/ui Card, Badge, etc. directly
- Lazy-load the workflow builder route (~70KB gzipped total with dependencies)
- React 19 compatibility: verify via `npm view @xyflow/react peerDependencies` before install
- Default edge type: `smoothstep` (clean right-angle paths for workflow builders)

## 2. Workflow Graph Storage

**Decision**: Store full graph as single JSONB column on `WorkflowVersion` table

**Rationale**: Nodes and edges are never queried independently outside their workflow context. A single JSONB column gives atomic reads/writes, matches existing patterns (`parsedIntent`, `summaryJson`, `settings` JSONB columns in the codebase), and avoids complex join queries. PostgreSQL JSONB supports indexing if needed later.

**Alternatives Considered**:
- Separate `WorkflowNode` and `WorkflowEdge` Prisma models — normalized but adds query complexity for load/save
- Redis storage — no durability across ECS task restarts
- S3 JSON files — poor query performance, no ACID guarantees

**Graph JSON Structure**:
```json
{
  "nodes": [
    {
      "id": "uuid",
      "type": "TRIGGER | MESSAGE | BUTTON_CHOICE | ...",
      "label": "Display name",
      "position": { "x": 0, "y": 0 },
      "config": { /* type-specific config */ }
    }
  ],
  "edges": [
    {
      "id": "uuid",
      "sourceNodeId": "uuid",
      "targetNodeId": "uuid",
      "sourceHandle": "optional-handle-id",
      "condition": { "field": "...", "operator": "equals", "value": "..." },
      "label": "optional edge label"
    }
  ],
  "viewport": { "x": 0, "y": 0, "zoom": 1 }
}
```

## 3. DAG Validation (Cycle Detection)

**Decision**: Kahn's topological sort algorithm

**Rationale**: O(V+E) complexity, simultaneously validates acyclicity AND produces execution order. If the sorted output has fewer nodes than the total, the remaining nodes are in cycles. Simpler and more informative than pure DFS-based detection.

**Alternatives Considered**:
- DFS with coloring — works but doesn't produce execution order as a side effect
- `isValidConnection` only (prevent at edge creation time) — insufficient because paste/template operations can introduce cycles

**Implementation**: Run both client-side (in `isValidConnection` to prevent cycles at creation) and server-side (in validation before publish).

## 4. Workflow Execution Engine

**Decision**: Eager-advance with pause-on-interaction pattern, state in PostgreSQL

**Rationale**: The engine processes auto-advance nodes (TRIGGER, MESSAGE, CONDITION, ACTION) synchronously in a loop. When it hits an interactive node (BUTTON_CHOICE, FORM_MODAL) or DELAY, it persists state to PostgreSQL and stops. User input from Slack action handlers resumes the execution. This pattern mirrors AWS Step Functions with Task states.

**Alternatives Considered**:
- Purely event-driven (Redis pub/sub per step) — hard to debug, no durability
- All in Redis (extend existing ConversationState) — doesn't survive ECS restarts, no version pinning
- BullMQ job per node — excessive queue overhead for synchronous nodes

**State Machine**:
```
ACTIVE          → processing nodes automatically
WAITING_INPUT   → paused at BUTTON_CHOICE or FORM_MODAL
WAITING_DELAY   → paused at DELAY node, BullMQ delayed job scheduled
COMPLETED       → reached terminal node
FAILED          → unrecoverable error
EXPIRED         → 1-hour TTL exceeded
CANCELLED       → user or admin cancelled
```

## 5. Version Pinning

**Decision**: Each publish creates a new `WorkflowVersion` row. Executions FK to a specific version ID.

**Rationale**: Immutable versions ensure in-progress executions are never disrupted. New executions use the latest published version. This mirrors the existing `OnboardingPlan` versioning pattern.

**Publish Flow**:
1. Set current published version status to `ARCHIVED`
2. Create new version row with `version = prev + 1`, status `PUBLISHED`
3. In-progress executions reference their original version ID (unchanged)
4. New triggers resolve the latest `PUBLISHED` version

## 6. Execution Expiry

**Decision**: BullMQ repeatable job scans for expired executions every 5 minutes

**Rationale**: Polling is simpler than per-execution delayed jobs when handling potentially hundreds of concurrent executions. The `expiresAt` column is indexed for fast queries. Matches existing patterns with `registerRetentionRepeatableJobs`.

## 7. Slack Action Routing

**Decision**: Structured `action_id` format: `wf:{executionId}:{nodeId}:{buttonId}`

**Rationale**: Stateless routing — the execution context is fully encoded in the action_id. No Redis lookup needed to find which execution to resume. Matches existing action handler patterns.

## 8. Delay Node Implementation

**Decision**: BullMQ delayed jobs (not Redis key expiry or setTimeout)

**Rationale**: BullMQ delayed jobs survive ECS task restarts, have built-in retry, and use existing infrastructure. A DELAY node schedules a BullMQ job with the configured delay; when it fires, the worker resumes the execution.

## 9. Legacy Flow Compatibility

**Decision**: Phased migration with fallback. If no active workflow matches a trigger, fall back to existing hardcoded listeners.

**Rationale**: Allows gradual rollout. The 3 default templates replicate exact behavior of current hardcoded flows. Once templates are published, the legacy paths become dormant. The trigger detection order is: check for active workflow → fall back to legacy handler.

**Migration Path**:
1. Ship workflow engine + builder without touching legacy listeners
2. Create 3 default templates that mirror current flows
3. Publish templates → workflow engine handles new triggers
4. Legacy listeners check for active workflow first, skip if found
5. Eventually remove legacy listeners after validation period

## 10. Queue Isolation

**Decision**: Dedicated `workflow` BullMQ queue, separate from `enrichment` and `onboarding` queues

**Rationale**: Isolation prevents workflow operations (delays, expiry checks) from competing with enrichment or onboarding jobs. Matches existing pattern of separate queues per domain.
