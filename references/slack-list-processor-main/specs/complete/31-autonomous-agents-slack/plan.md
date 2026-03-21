# Implementation Plan: Autonomous Agents with Slack Admin Interface

**Branch**: `31-autonomous-agents-slack` | **Date**: 2026-03-20 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/31-autonomous-agents-slack/spec.md`

## Summary

Implement 5 autonomous operational agents (Infrastructure Maintenance, API Rate Limit Manager, Quality Monitoring cluster, Campaign Optimizer, CRM Conflict Resolver) using the existing Feature 39 Platform Agent/Specialty infrastructure with SCHEDULED and EVENT trigger types. Add Slack `/admin` slash command for mobile admin access to job monitoring, audit trails, and system management. Introduce the Team entity for grouping collaborating agents (clusters). All audit logging uses database-only AuditAction table (no Git commits from containers). Agents start in suggest-only mode and graduate to auto-execute after >=90% admin approval rate over 50+ actions.

## Technical Context

**Language/Version**: TypeScript 5.x
**Primary Dependencies**: @slack/bolt v4.6.0, Prisma ORM, BullMQ, AWS SDK v3 (@aws-sdk/client-ecs, @aws-sdk/client-cloudwatch-logs), Octokit REST, simple-statistics
**Storage**: PostgreSQL (AWS RDS) via Prisma, Redis (AWS ElastiCache) via BullMQ
**Testing**: Against deployed AWS staging service (no local testing per constitution XV)
**Target Platform**: ECS Fargate (production), EC2 Docker Compose (staging)
**Project Type**: Backend service (Slack bot + REST API + admin dashboard)
**Performance Goals**: Admin commands <5s p95 (SC-002), Agent dashboard <60s latency (SC-011)
**Constraints**: $30-50/month AWS budget for agent workload (SC-014), single Socket Mode connection per environment
**Scale**: Single workspace, ~50-200 daily agent executions initially, 5,000 row hard max per enrichment job

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

| Principle | Status | Notes |
|-----------|--------|-------|
| I. CRM-First | PASS | Agents support CRM workflows (enrichment, campaign optimization, CRM sync) |
| II. Plugin Ecosystem | N/A | Slack List Processor is standalone, not BDR Platform plugin architecture |
| III. API-First | PASS | All admin commands backed by REST APIs; contracts defined before UI |
| IV. Client Isolation | PASS | Single workspace; admin roles enforce access control |
| V. SOC 2 / Audit Logging | PASS | AuditAction table + SpecialtyExecution provide full audit trail |
| VI. Cost Tracking | PASS | Feature 39 AgentInvocation tracks tokens, cost per LLM call |
| VII. Deviation Prevention | PASS | Suggest-only mode gates all autonomous actions during rollout |
| VIII. Integration-Centric | PASS | Agents integrate with existing BuiltWith, Apollo, HubSpot APIs |
| XV. AWS-Only | PASS | All execution on ECS Fargate; no local testing |
| XIX. GitHub Account | PASS | developerlabsai account only |
| XX. Automation Patterns | PASS | All agents classified below |

### Automation Pattern Classification (Constitution XX)

| Agent | Patterns Used | Safety Rules Applied |
|-------|--------------|---------------------|
| Infrastructure Maintenance | Pattern 6 (Watcher) + Pattern 2 (Filter-Fan) | Catch-all for unclassified failures (escalate to GitHub issue); max 3 restart attempts (Loop exit condition) |
| API Rate Limit Manager | Pattern 6 (Watcher) + Pattern 1 (Trigger-Route) | Failure alert on quota exceeded; concurrency=0 auto-resumes after 15min (Loop exit) |
| Quality Monitoring Cluster | Pattern 6 (Watcher) + Pattern 2 (Filter-Fan) + Pattern 1 (Trigger-Route) | Catch-all for unknown error patterns (GitHub issue); anomaly data included in all alerts |
| Campaign Optimizer | Pattern 6 (Watcher) + Pattern 3 (Collector) + Pattern 5 (Transformer) | Minimum data thresholds (100 sends); AI output is structured JSON (confidence + recommendation) |
| CRM Conflict Resolver | Pattern 5 (Transformer) + Pattern 2 (Filter-Fan) + Pattern 4 (Loop) | ML output validated against confidence thresholds; learning loop has accuracy floor (70%); auto-merge disabled if rejection rate >30% |

## Project Structure

### Documentation (this feature)

```text
specs/31-autonomous-agents-slack/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   ├── admin-commands-api.yaml
│   └── autonomous-agents-api.yaml
└── tasks.md             # Phase 2 output (/speckit.tasks)
```

### Source Code (repository root)

```text
src/
├── slack/
│   └── commands/
│       └── admin.ts                    # /admin slash command handler + subcommand router
├── services/
│   ├── platform/                       # Existing Feature 39 platform services
│   │   ├── agentRegistry.ts            # (existing) - Agent CRUD
│   │   ├── skillComposer.ts            # (existing, rename to specialtyComposer) - Specialty CRUD
│   │   ├── skillExecutor.ts            # (existing, rename to specialtyExecutor) - Execution pipeline
│   │   └── ...
│   └── autonomous/                     # NEW: Autonomous agent domain services
│       ├── index.ts                    # Barrel export
│       ├── confidenceGate.ts           # Confidence-based execution (auto/suggest/escalate)
│       ├── auditRecorder.ts            # AuditAction table writes
│       ├── suggestOnlyManager.ts       # Suggest-only mode, approval tracking, graduation
│       ├── systemEventEmitter.ts       # SystemEvent creation + admin dashboard notification
│       ├── teamManager.ts             # Team/Cluster CRUD
│       ├── agents/
│       │   ├── infrastructureMaintenance.ts   # ECS failure classification + restart logic
│       │   ├── apiRateLimitManager.ts         # Quota monitoring + concurrency adjustment
│       │   ├── anomalyDetector.ts             # Job completion rate analysis + anomaly detection
│       │   ├── rootCauseAnalyzer.ts           # CloudWatch log analysis + error classification
│       │   ├── autoRemediationExecutor.ts     # Known fix application + GitHub issue creation
│       │   ├── campaignOptimizer.ts           # Send time optimization + A/B testing
│       │   └── crmConflictResolver.ts         # Conflict scoring + merge decisions
│       └── tools/
│           ├── ecsOperations.ts               # AWS ECS RunTask, StopTask, DescribeTasks
│           ├── cloudWatchLogs.ts              # CloudWatch FilterLogEvents
│           ├── githubIssues.ts                # Octokit issue creation
│           └── statisticalTests.ts            # Chi-square, significance testing
├── routes/
│   └── admin/
│       ├── autonomous.ts               # NEW: Admin dashboard APIs for autonomous agents
│       └── teams.ts                    # NEW: Team/Cluster management APIs
└── lib/
    └── autonomous/
        └── types.ts                    # Type definitions for autonomous agent domain

admin-dashboard/
└── src/
    └── pages/
        ├── autonomous/                 # NEW: Autonomous agent dashboard pages
        │   ├── AgentList.tsx           # Agent list with status + suggest-only progress
        │   ├── AgentDetail.tsx         # Agent detail with audit trail + executions
        │   ├── TeamList.tsx            # Team/Cluster list
        │   ├── TeamDetail.tsx          # Team detail with member agents
        │   ├── AuditTrail.tsx          # Filterable audit trail view
        │   └── SystemEvents.tsx        # System events feed
        └── ...
```

**Terminology Note**: The Prisma schema and database tables still use the original "Skill" naming (`Skill`, `SkillExecution`, `skill_executions`). At the application layer, these are referred to as "Specialty" and "SpecialtyExecution". File names like `skillExecutor.ts` and `skillComposer.ts` retain the old naming; a full rename is deferred to avoid churn. Code in this feature uses "Specialty" in comments, types, and new identifiers.

**Structure Decision**: Single backend project following existing patterns. New autonomous agent code lives in `src/services/autonomous/` as a domain module, separate from `src/services/platform/` (which provides the underlying Agent/Specialty infrastructure). Slack command handler in `src/slack/commands/admin.ts`. Admin dashboard frontend gets new pages in `admin-dashboard/src/pages/autonomous/`.

## Complexity Tracking

No constitution violations requiring justification. All design decisions align with established principles.

## Implementation Phases

### Phase 1: Foundation (Slack Admin Commands + Database)
- Prisma schema: Add Team, TeamAgent, AuditAction, WorkerConfig, SystemEvent, CampaignMetrics, ConflictDecision models
- Prisma schema: Add slackUserId to AdminUser, suggest-only fields to Agent
- Slack `/admin` slash command registration and subcommand router
- Admin authorization middleware (RBAC via AdminUser.slackUserId)
- Core admin commands: jobs, job, cancel, usage, errors, workers, audit
- AuditAction recorder service
- SystemEvent emitter service

### Phase 2: Autonomous Agent Infrastructure
- Confidence gate service (auto/suggest/escalate branching)
- Suggest-only mode manager (approval tracking, graduation logic)
- Team/Cluster manager service
- SCHEDULED trigger support in Specialty executor (BullMQ repeatable jobs)
- EVENT trigger chaining via chainEventName
- Admin dashboard APIs for autonomous agent management

### Phase 3: Individual Agents (P2-P3)
- Infrastructure Maintenance Agent (ECS watcher + classifier + restarter)
- API Rate Limit Manager Agent (quota monitor + concurrency adjuster)
- MCP tools: ECS operations, CloudWatch logs, GitHub issues

### Phase 4: Quality Monitoring Cluster (P5)
- Anomaly Detector Agent
- Root Cause Analyzer Agent
- Auto-Remediation Executor Agent
- Quality Monitoring Team entity
- Chain event wiring (Anomaly → RCA → Remediation)

### Phase 5: Campaign + CRM Agents (P6-P7)
- Campaign Optimizer Agent (send time + A/B testing)
- CRM Conflict Resolver Agent (confidence scoring + learning loop)
- Statistical testing utilities
- String similarity utilities

### Phase 6: Admin Dashboard Frontend
- Autonomous agent list/detail pages
- Team/Cluster views
- Audit trail browser
- System events feed
- Suggest-only progress indicators
