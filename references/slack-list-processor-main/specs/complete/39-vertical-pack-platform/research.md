# Research: Vertical Pack Platform

**Feature**: 39-vertical-pack-platform
**Date**: 2026-03-18
**Status**: Complete

## 1. Agent Registry — Versioning Pattern

**Decision**: Extend the existing `Prompt` + `PromptVersion` pattern to a new `Agent` + `AgentVersion` model pair.

**Rationale**: The codebase already has a versioned prompt system (`Prompt` → `PromptVersion` with DRAFT/PUBLISHED/ARCHIVED states, test runs, and variable mappings). The Agent Registry follows the same pattern but adds: model selection, tool assignments, input/output schemas, token cap, and credit cost policy. Reusing the same versioning pattern ensures consistency.

**Alternatives considered**:
- Extend existing `Prompt` model with agent fields → Rejected: would bloat the Prompt model and conflate two distinct concepts (a prompt template vs. an executable agent definition)
- Use JSONB for agent config without versioning → Rejected: no audit trail, no safe rollback, violates constitution principle VII (deviation prevention)

## 2. MCP Server Registry — Connection Management

**Decision**: New `McpServer` + `McpTool` models with health check via cron-based BullMQ repeatable job.

**Rationale**: The project already manages external API connections (Apollo, BuiltWith, HubSpot, Twilio) via per-client config fields on `ManagedClient`. The MCP Server Registry formalizes these as first-class objects with encrypted credentials, health monitoring, and BYOK support. This is a net-new model because existing API clients are hardcoded service files, not configurable registries.

**Alternatives considered**:
- Add columns to `ManagedClient` → Rejected: MCP servers are platform-wide resources, not client-specific; BYOK overrides are per-workspace, not per-client
- Store MCP config in Redis → Rejected: need persistent storage with audit trail; Redis is cache/queue only

## 3. Skill Composition — Execution Architecture

**Decision**: Skills execute as BullMQ jobs via a new `skill-execution` queue with dedicated `skillExecutionWorker.ts`.

**Rationale**: The project already uses BullMQ for all async processing (enrichment, campaigns, workflows, retention, etc.). Adding a new queue and worker for skill execution follows the established pattern. The worker orchestrates: credit check → agent invocation → MCP tool calls → output delivery → credit deduction → execution logging.

**Alternatives considered**:
- Execute skills synchronously in the API handler → Rejected: skills may take 30s+ (LLM calls, external API calls); would block Express
- Use the existing `workflow-execution` queue → Rejected: workflow execution has its own graph-based execution model; skill execution is simpler (linear pipeline)
- Use AWS Step Functions → Rejected: adds operational complexity; BullMQ already works for all async jobs

## 4. Credit Isolation — Per-Pack Billing

**Decision**: New `PackSubscription` model with its own credit balance, separate from the existing `BillingProfile.creditBalance`.

**Rationale**: The spec clarification requires credits isolated per pack subscription (no cross-pack sharing). The existing `BillingProfile` has a single `creditBalance` for enrichment. Pack subscriptions need independent credit tracking. When a workspace subscribes to a pack, a `PackSubscription` row is created with `creditsIncluded`, `creditsUsed`, and `overageRate`. The existing `CreditTransaction` ledger is extended with a `packSubscriptionId` FK to attribute transactions per pack.

**Alternatives considered**:
- Share credits across packs from existing `BillingProfile.creditBalance` → Rejected: stakeholder decision was isolated credits per pack
- Create a completely separate billing system → Rejected: can extend existing `CreditTransaction` ledger with a new FK; no need for parallel infrastructure

## 5. Multi-Pack Skill Resolution — Credit Debit Strategy

**Decision**: When a skill belongs to multiple packs and a workspace subscribes to multiple packs containing that skill, automatically debit from the pack with the most remaining credits.

**Rationale**: Per spec clarification (Q5). The `creditGate.ts` service queries all active `PackSubscription` rows for the workspace that include the skill, sorts by remaining credits descending, and debits from the top one.

**Alternatives considered**:
- Let the user choose which pack to debit → Rejected: adds UX friction for every skill invocation
- Debit from the cheapest overage rate → Rejected: stakeholder preferred "most remaining credits" as the heuristic

## 6. Agent Invocation — Token Cap Enforcement

**Decision**: Per-agent `maxTokens` field enforced at invocation time by passing `max_tokens` parameter to the Anthropic SDK.

**Rationale**: The Anthropic SDK already supports `max_tokens` in the message creation API. The agent's configured cap is applied before each invocation. If the estimated input tokens (from the skill's input payload) plus the agent's `maxTokens` output cap exceed the model's context window, the invocation is rejected pre-flight.

**Alternatives considered**:
- Post-invocation check (reject after the call) → Rejected: wastes API cost; the goal is to prevent runaway usage, not detect it after
- Global token cap across all agents → Rejected: different agents serve different purposes with different token needs

## 7. Daily Spend Limit — Workspace-Level Enforcement

**Decision**: New `dailySpendLimitUsd` field on `WorkspaceInstallation` + `dailySpendUsedUsd` tracking field reset by a cron job at midnight UTC.

**Rationale**: Per spec clarification (Q4). The `spendLimiter.ts` service checks `dailySpendUsedUsd < dailySpendLimitUsd` before every skill execution. On completion, the actual cost (tokens × model rate) is added to `dailySpendUsedUsd`. A BullMQ repeatable job resets all workspaces' daily spend counters at midnight UTC.

**Alternatives considered**:
- Per-pack daily limits → Rejected: spec says per-workspace; simpler to manage one limit
- Track in Redis only → Rejected: need persistent audit trail; use Redis as cache + PG as source of truth

## 8. Skill Chaining — Event-Based Trigger

**Decision**: Skill chaining uses the existing event-based trigger type. A skill's output is published to a BullMQ event, and downstream skills subscribed to that event trigger automatically.

**Rationale**: Per spec clarification (Q1), each chained skill is an independent execution with its own credit deduction. The simplest implementation: when a skill completes, if other skills have `triggerType: EVENT` with a matching event source, they are enqueued as new BullMQ jobs. No special chaining state machine needed.

**Alternatives considered**:
- DAG-based execution graph (like workflow engine) → Rejected: over-engineered for skill chaining; skills are independent executions
- Direct function calls between skills → Rejected: loses async benefits, can't track credits per skill, can't enforce spend limits between steps

## 9. Existing Infrastructure Leverage

**Decision**: Maximize reuse of existing patterns rather than building parallel systems.

| Platform Need | Existing Pattern to Extend |
|--------------|---------------------------|
| Agent versioning | `Prompt` → `PromptVersion` pattern (DRAFT/PUBLISHED states, test runs) |
| Execution queue | BullMQ worker pattern (`src/services/queue/workers/`) |
| Credit tracking | `CreditTransaction` ledger (append-only, per-workspace) |
| Feature gating | `WorkspaceInstallation.featureFlags` JSON field |
| API auth (admin) | `express-session` + `AdminUser` model (existing admin routes) |
| API auth (client) | `MagicLink` + session-based auth (existing client routes) |
| Credential encryption | Extend existing pattern (API keys stored as encrypted text in PG) |
| Health monitoring | BullMQ repeatable jobs (like `scheduledReport`, `retentionPurge`) |
| Cost calculation | `src/services/ai/costCalculator.ts` pattern |

## 10. Migration Strategy — Enrichment as Pack #1

**Decision**: The migration is a database + code refactoring exercise, not a runtime migration. Existing enrichment continues working during development. The cutover happens atomically via a Prisma migration + code deploy.

**Rationale**: Enrichment is production-critical. The migration creates Agent/MCP/Skill/Pack records that represent the existing pipeline, then redirects the enrichment flow through the skill execution engine. Existing `BillingProfile.creditBalance` is converted to an Enrichment Pack subscription balance.

**Migration steps**:
1. Create Agent records for existing AI functions (intent classifier, document classifier, opportunity scorer, report analyzer)
2. Create MCP Server records for existing integrations (Apollo, BuiltWith, Findymail, Wiza)
3. Create Skill records that compose agents + MCP tools (file enrichment, tech lookup, contact enrichment)
4. Create the Enrichment Pack bundling all enrichment skills
5. For each workspace with a `BillingProfile`, create a `PackSubscription` to the Enrichment Pack with the migrated credit balance
6. Redirect enrichment dispatcher to route through skill execution engine
