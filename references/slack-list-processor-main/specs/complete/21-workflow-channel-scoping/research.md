# Research: Workflow Channel Scoping

**Feature**: 21-workflow-channel-scoping
**Date**: 2026-03-11

## R1: 3-Tier Workflow Resolution Strategy

**Decision**: Implement a cascading resolution function `resolveWorkflowTemplate()` that checks three tiers in order: channel mapping → client workflow → team fallback.

**Rationale**: This pattern follows the specificity cascade used in CSS and permission systems. The most specific match wins, with graceful fallback to less specific tiers. Each tier is an independent database lookup, making the logic easy to test and debug.

**Alternatives considered**:
- Single merged priority field on WorkflowTemplate: Rejected because it conflates two different concepts (client scope and channel override) into a single dimension.
- Graph-based routing with conditions: Rejected as over-engineered. The 3-tier model covers all stated requirements with simple, predictable behavior.

## R2: WorkflowChannelMapping Uniqueness Scope

**Decision**: Unique constraint on `(slackTeamId, slackChannelId, triggerType)` — one workflow per channel per trigger type.

**Rationale**: Allows a channel to have different workflow overrides for FILE_UPLOAD vs WEBHOOK triggers independently, which was confirmed as the desired behavior in spec clarification. The trigger type is stored on the mapping itself (denormalized from the linked WorkflowTemplate) to enforce the constraint at the database level.

**Alternatives considered**:
- Unique on `(slackTeamId, slackChannelId)` only: Simpler but prevents future trigger-type-specific overrides. Rejected per clarification answer.
- No uniqueness (allow multiple mappings per channel per trigger): Would require priority/ordering logic. Rejected for complexity.

## R3: Publish Conflict Resolution

**Decision**: Auto-deactivate the existing active workflow when publishing a new one with the same `(triggerType, clientId)` pair. Show a warning to the admin naming the workflow being deactivated.

**Rationale**: This matches the existing single-active-workflow pattern in `publishVersion()` and provides a smooth admin experience without blocking the publishing action. The warning gives visibility into what changed.

**Alternatives considered**:
- Block publishing: Adds friction — admin must manually archive first. Rejected.
- Confirm-swap dialog: Extra step without clear benefit over a warning. Rejected.

## R4: Schema Extension vs. New Table for Client Assignment

**Decision**: Add nullable `clientId` FK directly on `WorkflowTemplate` (not a join table).

**Rationale**: A workflow belongs to zero or one client (1:N from ManagedClient to WorkflowTemplate). A join table would be needed for M:N, but the spec explicitly states a workflow belongs to at most one client. A simple FK is the correct model.

**Alternatives considered**:
- WorkflowClientMapping join table: Unnecessary for 1:N relationship. Rejected.
- Embedding client scope in the workflow graph as a condition node: Mixes runtime behavior with administrative configuration. Rejected.

## R5: Admin Dashboard Scope Panel Placement

**Decision**: Add a collapsible "Scope" panel as a new section in the workflow builder's right sidebar (below NodeConfigPanel), visible only when no node is selected or as a top-level tab.

**Rationale**: The right sidebar is where configuration happens in the builder. Adding scope there follows the existing pattern (node config → slack preview). A dedicated panel keeps it discoverable but not intrusive.

**Alternatives considered**:
- Top-bar dropdown: Too small for channel management with add/remove actions. Rejected.
- Separate settings page: Breaks the "configure in context" principle. Rejected.
- Modal dialog: Hides the canvas and breaks flow. Rejected.

## R6: Observability for Tier Resolution

**Decision**: Log the resolved tier (1/2/3) and matched template ID at `info` level in `resolveWorkflowTemplate()`. Include in WorkflowExecution context for display in execution detail view.

**Rationale**: When admins ask "why did this workflow run?", the execution detail should show which resolution tier was used. This was flagged as deferred in clarification but is low-effort to implement alongside the resolution function.

## R7: Migration Strategy

**Decision**: Zero-data-migration approach. Adding nullable `clientId` to WorkflowTemplate means all existing workflows automatically have `clientId = NULL`, making them team-level fallbacks. The new `WorkflowChannelMapping` table starts empty. No backfill needed.

**Rationale**: The tier-3 fallback query (`clientId IS NULL`) exactly matches the current `findFirst` behavior. Existing workflows continue working identically with no migration script needed.
