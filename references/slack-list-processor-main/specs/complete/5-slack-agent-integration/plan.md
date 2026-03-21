# Implementation Plan: Slack Agent Integration

**Branch**: `5-slack-agent-integration` | **Date**: 2026-03-06 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/5-slack-agent-integration/spec.md`

## Summary

Add a full-featured AI agent to the existing Slack List Processor using Slack's Agents & AI Apps platform. The agent provides a conversational side-panel interface (via the `Assistant` class in `@slack/bolt` v4.6.0) alongside all existing trigger-based flows. Key capabilities: multi-turn conversation with memory, real-time streaming responses with task visualization cards, channel context awareness, multi-workspace public distribution via OAuth, per-workspace usage metering with dollar-amount caps, and SOC 2-aligned data retention with 7-day conversation purge and permanent audit summaries.

## Technical Context

**Language/Version**: TypeScript 5.9.3 (target: ES2022, module: NodeNext)
**Primary Dependencies**: @slack/bolt 4.6.0 (Socket Mode), @anthropic-ai/sdk 0.78.0, Express 5.2.1, BullMQ 5.70.1
**Storage**: PostgreSQL via Prisma 7.4.2 (AWS RDS) + Redis via ioredis 5.10.0 (AWS ElastiCache) + AWS S3
**Testing**: Manual via deployed ECS (no local test runner — AWS-only deployment model)
**Target Platform**: AWS ECS Fargate (Docker container, single Socket Mode connection)
**Project Type**: Single project (Node.js server)
**Performance Goals**: <2s streaming start (SC-003), <5s task card updates (SC-004), 50 concurrent conversations (SC-005)
**Constraints**: 512 CPU / 1024 MB ECS task, single Socket Mode connection, 1-hour Redis TTL (to be extended for agent threads)
**Scale/Scope**: Initial target 10-20 client workspaces, ~50 concurrent agent conversations

**Key Existing Patterns**:
- `slackTeamId` already indexed on Job, ErrorLog, DailyAggregate, ClientDocument — multi-tenant scoping partially in place
- Tool Use pattern established in orchestrator.ts (classify_intent) and personaClassifier.ts (classify_persona)
- Conversation state in Redis with ConversationState interface + 1-hour TTL (trigger flows only — agent threads use separate contextStore with 24-hour TTL)
- 5 BullMQ queues with dispatcher routing pattern
- Cost tracking via ApiUsageLog (service, tokens, estimatedCostUsd)
- Admin dashboard scaffolding exists (feature 3 branch)

**Terminology Glossary**:
- **Workspace** (spec) = **slackTeamId** (code/data model) = Slack team/workspace identifier
- **Agent thread** (spec) = **AgentThread** (model) = Single conversation in the agent side-panel, identified by `slackThreadTs`
- **Trigger flow** (spec) = Existing file_shared event, slash command, and action handler flows (pre-agent)
- **Context store** (code) = Redis-backed agent thread state (24-hour TTL), distinct from trigger-flow conversation state (1-hour TTL)

**Critical Architecture Decision: Socket Mode vs HTTP Mode**:
- Current: Socket Mode (single connection, no public endpoints for Slack events)
- For public distribution: Must add HTTP mode with OAuth InstallProvider OR use hybrid approach (Socket Mode for events + separate Express OAuth routes)
- Socket Mode supports multi-workspace via custom `authorize` function but is NOT allowed on Slack Marketplace
- Recommended: Hybrid — keep Socket Mode for event delivery (simpler, already working), add Express OAuth endpoints for install flow. Transition to full HTTP mode only if Marketplace listing is pursued.

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

| Principle | Status | Notes |
|-----------|--------|-------|
| I. CRM-First Architecture | N/A | Standalone service, not part of BDR CRM platform |
| II. Plugin Ecosystem | N/A | Standalone Slack service, not a WordPress-style plugin |
| III. API-First Development | PASS | Agent surface is an API consumer; existing REST endpoints preserved |
| IV. Client Isolation (Multi-Tenancy) | PASS | Workspace-scoped access controls on central DB; slackTeamId on all models |
| V. SOC 2 Compliance & Audit Logging | PASS | 7-day conversation retention + permanent audit summaries; all API calls logged; 90-day post-uninstall operational data disposal; audit summaries and usage logs retained minimum 1 year post-uninstall per constitution |
| VI. Cost Tracking & Financial Model | PASS | Per-workspace usage metering with dollar caps + per-service guardrails; extends existing ApiUsageLog |
| VII. Deviation Prevention | PASS | Plan checked against constitution; backward compatibility preserved |
| VIII. Integration-Centric Design | PASS | Reuses existing BuiltWith/Apollo/Claude integrations; adds Slack streaming API |
| IX. Sequence-Driven Workflows | N/A | Not a campaign/sequence feature |
| X. Enrichment as Foundation | PASS | Agent is a new interface to existing enrichment pipeline |
| XI. Context-First Decision Making | PASS | Research phase completed; clarifications resolved |
| XII. Holistic System Awareness | PASS | Agent integrates with existing queues, state store, AI services, DB models |
| XIII. Confirmation-Required Workflow | PASS | Agent confirms parameters before initiating jobs |
| XIV. UI/UX First Design | PASS | Suggested prompts, streaming, task visualization — follows Slack's agent UX patterns |
| XV. AWS-Only Infrastructure | PASS | Deploys via existing ECS Fargate; no local server |
| XVI. Developer Navigation Index | N/A | No web UI routes added (Express health endpoint already exists) |
| XVII. MCP-First Research | PASS | Slack API docs, Bolt JS docs, streaming API researched |

**Gate Result: PASS** — No violations. Principles I, II, IX, XVI are N/A (standalone Slack service, not CRM platform).

**Cross-Feature Dependency**: Feature 4 (Infra Hardening) should be deployed before this feature's Phase 10 (OAuth/Distribution). HTTPS is required for OAuth redirect URI, Secrets Manager pattern should be followed for new secrets, auto-scaling supports concurrent conversation target, and WAF protects public OAuth endpoints.

## Project Structure

### Documentation (this feature)

```text
specs/5-slack-agent-integration/
├── plan.md              # This file
├── research.md          # Phase 0: Technical research decisions
├── data-model.md        # Phase 1: New/modified Prisma models
├── quickstart.md        # Phase 1: Setup & deployment guide
├── contracts/           # Phase 1: Internal API contracts
│   ├── agent-intents.md     # Agent intent classification schema
│   ├── streaming-protocol.md # Streaming & task card protocol
│   └── oauth-install.md     # OAuth installation flow
└── tasks.md             # Phase 2 output (/speckit.tasks)
```

### Source Code (repository root)

```text
src/
├── services/
│   ├── agent/                    # NEW: Agent-specific logic
│   │   ├── assistant.ts          # Assistant class registration & handlers
│   │   ├── conversationManager.ts # Multi-turn context assembly
│   │   ├── streamingHelper.ts    # Chat streaming wrapper (start/append/stop)
│   │   ├── taskVisualizer.ts     # Pipeline task card management
│   │   ├── intentRouter.ts       # Route classified intents to actions
│   │   └── contextStore.ts       # Custom ThreadContextStore (Redis-backed)
│   ├── workspace/                # NEW: Multi-workspace management
│   │   ├── installationStore.ts  # Prisma-backed InstallationStore
│   │   ├── authorize.ts          # Custom authorize function for multi-workspace
│   │   └── onboarding.ts         # First-run onboarding flow
│   ├── metering/                 # NEW: Usage metering & limits
│   │   ├── usageTracker.ts       # Per-workspace API usage tracking
│   │   ├── limitEnforcer.ts      # Dollar cap & service limit checks
│   │   └── usageReporter.ts      # Usage summary generation
│   ├── retention/                # NEW: Data retention & audit
│   │   ├── conversationPurge.ts  # 7-day purge + audit summary generation
│   │   ├── workspaceDisposal.ts  # 90-day post-uninstall cleanup
│   │   └── dataExporter.ts       # Workspace data export
│   ├── ai/                       # EXISTING: Extended
│   │   ├── orchestrator.ts       # Extended with agent-specific intents
│   │   └── agentOrchestrator.ts  # NEW: Multi-turn agent LLM orchestration
│   ├── state/
│   │   └── conversationStore.ts  # UNCHANGED: Existing trigger-flow state (agent uses separate contextStore.ts)
│   └── queue/
│       └── workers/
│           ├── conversationPurge.ts  # NEW: Scheduled 7-day purge worker
│           └── workspaceDisposal.ts  # NEW: Scheduled 90-day disposal worker
├── routes/
│   └── oauth/                    # NEW: OAuth install endpoints
│       ├── install.ts            # GET /slack/install
│       └── callback.ts           # GET /slack/oauth_redirect
├── listeners/
│   └── events/
│       └── appUninstalled.ts     # NEW: Handle app_uninstalled event
├── lib/
│   └── agentAuth.ts              # NEW: Slack admin role checking utility
├── app.ts                        # MODIFIED: Register assistant, OAuth routes, new workers
├── server.ts                     # MODIFIED: Add OAuth routes to Express
└── config/
    └── index.ts                  # MODIFIED: Add OAuth client ID/secret config

prisma/
└── schema.prisma                 # MODIFIED: New models (WorkspaceInstallation, AgentThread, etc.)
```

**Structure Decision**: Extends existing single-project structure. New directories (`agent/`, `workspace/`, `metering/`, `retention/`) follow the existing service-layer pattern. No new top-level projects.

## Complexity Tracking

> No constitution violations to justify.
