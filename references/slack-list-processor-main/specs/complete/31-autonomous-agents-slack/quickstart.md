# Quickstart: Autonomous Agents with Slack Admin Interface

**Feature**: Spec 31 | **Date**: 2026-03-20 | **Spec**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md)

## Prerequisites

- [ ] Feature 39 (Vertical Pack Platform) deployed with Agent, Specialty, MCP Server infrastructure
- [ ] Staging environment operational (EC2 Docker Compose: app + redis + postgres + caddy)
- [ ] Staging Slack app ("List Processor - Staging") configured with Socket Mode
- [ ] AWS credentials with ECS, CloudWatch Logs, and S3 permissions
- [ ] GitHub token with repo write access (for issue creation by agents)
- [ ] `develop` branch CI/CD deploying to staging ECS cluster

## Deployment Steps

### Step 1: Database Migration

```bash
# Run Prisma migration for new models (Team, AuditAction, WorkerConfig, SystemEvent, etc.)
npx prisma migrate dev --name add-autonomous-agents-models
```

**Verify**: `npx prisma studio` shows new tables: `Team`, `TeamAgent`, `AuditAction`, `WorkerConfig`, `SystemEvent`, `CampaignMetrics`, `ConflictDecision`

**Verify**: `AdminUser` table has `slackUserId` column

### Step 2: Register Slack Slash Command

In Slack App configuration (api.slack.com/apps):
1. Navigate to "Slash Commands"
2. Create new command: `/admin`
3. Request URL: (not needed for Socket Mode - handled via `app.command()`)
4. Description: "Admin commands for job monitoring and system management"
5. Usage hint: "jobs | job <id> | cancel <id> | usage | errors | workers | audit | cache purge | config"

**Verify**: `/admin help` in Slack returns ephemeral message listing available subcommands

### Step 3: Link Admin Slack Users

```sql
-- Update AdminUser records with Slack user IDs
UPDATE "AdminUser" SET "slackUserId" = 'U0XXXXXXX' WHERE email = 'admin@example.com';
```

**Verify**: `/admin jobs` responds with job list (not "You do not have permission")

### Step 4: Seed Autonomous Agents

Create Platform Agent records for each autonomous agent via admin dashboard or seed script:

| Agent Name | Trigger Type | Schedule | Status |
|------------|-------------|----------|--------|
| Infrastructure Maintenance | SCHEDULED | Every 5 min | DRAFT |
| API Rate Limit Manager | SCHEDULED | Every 5 min | DRAFT |
| Anomaly Detector | SCHEDULED | Every 15 min | DRAFT |
| Root Cause Analyzer | EVENT | chain from Anomaly Detector | DRAFT |
| Auto-Remediation Executor | EVENT | chain from Root Cause Analyzer | DRAFT |
| Campaign Optimizer | SCHEDULED | Daily at 6 AM | DRAFT |
| CRM Conflict Resolver | EVENT | from hubspotImportWorker | DRAFT |

**Verify**: `GET /api/v1/admin/autonomous/agents` returns all 7 agents in DRAFT status

### Step 5: Create Quality Monitoring Team

```bash
curl -X POST /api/v1/admin/autonomous/teams \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Quality Monitoring",
    "slug": "quality-monitoring",
    "description": "Anomaly detection, root cause analysis, and auto-remediation cluster",
    "agentIds": ["<anomaly-detector-id>", "<root-cause-analyzer-id>", "<auto-remediation-executor-id>"]
  }'
```

**Verify**: `GET /api/v1/admin/autonomous/teams` shows Quality Monitoring team with 3 member agents

### Step 6: Publish Agents (Suggest-Only Mode)

Publish each agent through the admin dashboard or API. All agents start in suggest-only mode by default.

**Verify**: All agents show status=PUBLISHED, suggestOnlyMode=true

### Step 7: Set Environment Variables

Add to ECS task definition / Docker Compose:

```env
GITHUB_TOKEN=ghp_xxxx                    # For issue creation by agents
AUTONOMOUS_AGENTS_ENABLED=true           # Master kill switch
```

**Verify**: CloudWatch logs show "Autonomous agents initialized" on ECS task startup

## Verification Checklist

### Slack Admin Commands (SC-002: <5s response)

- [ ] `/admin jobs` returns recent enrichment jobs with status
- [ ] `/admin jobs running` filters to running jobs only
- [ ] `/admin job <id>` shows detailed job info (progress, stage, rows)
- [ ] `/admin cancel <id>` shows confirmation button, cancels on confirm
- [ ] `/admin usage daily` shows API quota consumption
- [ ] `/admin errors` shows recent error summary
- [ ] `/admin workers` shows worker status with queue depth
- [ ] `/admin audit 24` shows autonomous agent actions from past 24 hours
- [ ] `/admin cache purge all` shows confirmation, purges on confirm
- [ ] Non-admin user gets "You do not have permission" error
- [ ] VIEWER role cannot execute `/admin cancel` or `/admin cache purge`

### Authorization (SC-012: 0 unauthorized access)

- [ ] User without `slackUserId` in AdminUser table is rejected
- [ ] VIEWER can read (jobs, usage, errors) but not write (cancel, purge, config)
- [ ] EDITOR can cancel jobs but not purge cache or modify config
- [ ] ADMIN can perform all actions

### Infrastructure Maintenance Agent (SC-005: >=90% success)

- [ ] Agent detects simulated ECS task failure via CloudWatch event
- [ ] Transient failure (OOM) classified with confidence >=0.85
- [ ] Auto-restart executed (in auto-execute mode) or suggested (in suggest-only mode)
- [ ] AuditAction record created with action, confidence, metadata
- [ ] SystemEvent created with type "infrastructure_auto_heal"
- [ ] After 3 failed restarts, escalates to GitHub issue instead of restarting
- [ ] Code bug failure (exit code 1) creates GitHub issue with CloudWatch log link

### API Rate Limit Manager (SC-006: 0 quota exceeded)

- [ ] Agent reads API usage from apiUsage table every 5 minutes
- [ ] Concurrency adjusted based on quota thresholds (<50%=10, 50-75%=5, 75-90%=3, >90%=0)
- [ ] WorkerConfig table upserted with new concurrency, rationale
- [ ] Paused workers (concurrency=0) auto-resume after 15 minutes
- [ ] 5+ adjustments in 1 hour triggers escalation alert

### Quality Monitoring Cluster (SC-008: <15min detection, <5% false positive)

- [ ] Anomaly Detector detects >5% failure rate in hourly jobs
- [ ] Root Cause Analyzer triggered via chain event with anomaly details
- [ ] Root Cause Analyzer classifies error pattern from CloudWatch logs
- [ ] Auto-Remediation applies known fix (confidence >=0.85) or creates GitHub issue (<0.50)
- [ ] All three agents show as members of Quality Monitoring team

### Campaign Optimizer (SC-007: >=10% engagement improvement)

- [ ] Agent aggregates DM open rates by send hour over past 30 days
- [ ] Optimal send time identified with statistical significance (p<0.05)
- [ ] Campaign schedule updated when confidence >=0.85
- [ ] A/B test assigns 50/50 split and declares winner after 100 sends
- [ ] Insufficient data (<100 sends) defers optimization

### CRM Conflict Resolver (SC-009: >=70% auto-merge, <5% rejection)

- [ ] Agent processes flagged HubSpot sync conflicts
- [ ] Confidence scoring uses email similarity, company name edit distance, phone match
- [ ] High confidence (>=0.85) auto-merges in auto-execute mode
- [ ] Medium confidence (0.50-0.84) presents Approve/Reject in Slack
- [ ] Low confidence (<0.50) escalates to admin dashboard
- [ ] Admin feedback updates confidence model weights
- [ ] >30% rejection rate disables auto-merge mode

### Suggest-Only Mode (SC-013)

- [ ] All agents start in suggest-only mode after publish
- [ ] Suggested actions appear in Slack with Approve/Reject buttons
- [ ] Approved actions execute and increment approval counter
- [ ] Rejected actions are logged and increment rejection counter
- [ ] Agent graduates to auto-execute at >=90% approval over 50+ actions
- [ ] Admin dashboard shows progress: "42/50 reviewed, 95% approval"

### Audit Trail (SC-003: 100% coverage)

- [ ] Every agent action creates an AuditAction record
- [ ] `/admin audit 24` displays all actions from past 24 hours
- [ ] AuditAction includes: agentName, action, confidence, outcome, metadata
- [ ] Admin dashboard audit trail page is filterable by agent, severity, outcome

### Socket Mode (SC-010: 0 conflicts)

- [ ] Admin commands and autonomous agents coexist without event splitting
- [ ] No "No file found" errors in CloudWatch logs
- [ ] Single ECS task per environment (staging/production)

### Budget (SC-014: $30-50/month)

- [ ] CloudWatch metrics show agent execution costs within budget
- [ ] AgentInvocation records track per-call LLM costs
- [ ] Total monthly cost = sum of all AgentInvocation.costUsd
