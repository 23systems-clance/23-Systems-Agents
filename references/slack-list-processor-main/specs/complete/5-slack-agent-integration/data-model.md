# Data Model: Slack Agent Integration

**Phase 1 Output** | **Date**: 2026-03-06

## New Models

### WorkspaceInstallation

Stores OAuth installation data for each client workspace. Created during OAuth callback, deleted 90 days after uninstall.

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | String | PK, cuid | Internal ID |
| slackTeamId | String | unique, indexed | Slack workspace team ID |
| slackTeamName | String | | Workspace display name |
| botToken | String | encrypted | Bot OAuth token (xoxb-...) |
| botId | String | | Bot user ID |
| botUserId | String | | Bot member ID |
| appId | String | | Slack app ID |
| installedByUserId | String | | Slack user ID of installing admin |
| scopes | String | | Comma-separated granted scopes |
| status | Enum | default ACTIVE | ACTIVE, SUSPENDED, UNINSTALLED |
| uninstalledAt | DateTime? | | When app was uninstalled |
| purgeAfter | DateTime? | | When to permanently delete (uninstalledAt + 90 days) |
| monthlySpendCapUsd | Decimal? | | Primary usage limit (dollars/month) |
| maxBuiltwithLookups | Int? | | Optional per-service guardrail |
| maxApolloCredits | Int? | | Optional per-service guardrail |
| maxAiTokens | Int? | | Optional per-service guardrail |
| onboardingComplete | Boolean | default false | Whether first-run setup is done |
| settings | Json? | | Workspace-specific configuration |
| createdAt | DateTime | auto | |
| updatedAt | DateTime | auto | |

**Relationships**: Has many AgentThread, Job (via slackTeamId), ApiUsageLog (via slackTeamId)

**State Transitions**: ACTIVE → SUSPENDED (manual) → ACTIVE | ACTIVE → UNINSTALLED → purged after 90 days

---

### AgentThread

Represents a single agent conversation in the side-panel. Links to jobs created within the conversation.

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | String | PK, cuid | Internal ID |
| slackThreadTs | String | indexed | Slack thread timestamp |
| slackChannelId | String | | DM channel ID |
| slackUserId | String | indexed | User who opened the thread |
| slackTeamId | String | indexed, FK | Workspace team ID |
| viewingChannelId | String? | | Channel user was viewing when thread started |
| viewingChannelName | String? | | Channel name for display |
| title | String? | | Thread title set by agent |
| status | Enum | default ACTIVE | ACTIVE, EXPIRED, PURGED |
| lastActivityAt | DateTime | auto | Last message timestamp |
| createdAt | DateTime | auto | |

**Relationships**: Belongs to WorkspaceInstallation (via slackTeamId). Has many ConversationTurn, AgentThreadJob.

**Indexes**: (slackTeamId, slackUserId), (slackTeamId, slackThreadTs), (status, lastActivityAt)

---

### ConversationTurn

Individual message in an agent thread. Purged after 7 days (audit summary generated first).

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | String | PK, cuid | Internal ID |
| agentThreadId | String | FK, indexed | Parent thread |
| role | Enum | | USER, ASSISTANT |
| content | String | | Message text |
| intent | String? | | Classified intent (if USER role) |
| confidence | Float? | | Classification confidence |
| extractedParams | Json? | | Structured params extracted from message |
| tokensInput | Int? | | LLM tokens used (input) |
| tokensOutput | Int? | | LLM tokens used (output) |
| createdAt | DateTime | auto, indexed | For purge queries |

**Relationships**: Belongs to AgentThread.

**Retention**: 7 days. Purged by scheduled worker after AgentThreadAudit is generated.

---

### AgentThreadAudit

Compact audit summary generated before conversation turns are purged. Permanent retention.

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | String | PK, cuid | Internal ID |
| agentThreadId | String | FK, unique | Parent thread |
| slackTeamId | String | indexed | Workspace for scoped queries |
| slackUserId | String | | User who initiated |
| threadTitle | String? | | Thread title at time of audit |
| turnCount | Int | | Total messages in thread |
| intentsClassified | Json | | Array of {intent, count} |
| jobsCreated | Json | | Array of job IDs created in thread |
| actionsPerformed | Json | | Array of {action, timestamp} (e.g., "enrichment_started", "filter_applied") |
| firstMessageAt | DateTime | | Earliest turn timestamp |
| lastMessageAt | DateTime | | Latest turn timestamp |
| totalAiTokensInput | Int | | Sum of all LLM input tokens |
| totalAiTokensOutput | Int | | Sum of all LLM output tokens |
| createdAt | DateTime | auto | When audit was generated |

**Relationships**: Belongs to AgentThread.

**Retention**: Permanent. Upon workspace uninstall, audit summaries are retained for a minimum of 1 year post-uninstall per SOC 2 compliance (constitution Principle V), then permanently deleted. NOT subject to the 90-day operational data disposal.

---

### AgentThreadJob

Junction table linking agent threads to jobs created within them.

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | String | PK, cuid | Internal ID |
| agentThreadId | String | FK, indexed | Parent thread |
| jobId | String | FK, indexed | Associated job |
| createdAt | DateTime | auto | When link was created |

**Relationships**: Belongs to AgentThread, belongs to Job.

**Unique**: (agentThreadId, jobId)

---

## Modified Models

### Job (existing)

| Change | Field | Details |
|--------|-------|---------|
| ADD | sourceInterface | Enum: TRIGGER, AGENT, COMMAND. Tracks whether job was created via traditional flow, agent, or slash command. Default: TRIGGER |

No other Job changes needed — `slackTeamId` is already indexed and present.

### ApiUsageLog (existing)

| Change | Field | Details |
|--------|-------|---------|
| ADD | slackTeamId | String, indexed. Mandatory for all new logs. Backfill existing logs from Job.slackTeamId |

This enables per-workspace usage aggregation without changing the existing logging pattern.

### DailyAggregate (existing)

Already has `slackTeamId` with unique constraint on (date, service, slackTeamId). No changes needed — metering queries can aggregate from this.

---

## New Enums

```prisma
enum WorkspaceStatus {
  ACTIVE
  SUSPENDED
  UNINSTALLED
}

enum AgentThreadStatus {
  ACTIVE
  EXPIRED    // Past 7-day retention, turns purged
  PURGED     // Audit generated, turns deleted
}

enum ConversationRole {
  USER
  ASSISTANT
}

enum JobSourceInterface {
  TRIGGER    // file_shared event, slash command button flows
  AGENT      // Agent side-panel conversation
  COMMAND    // Direct slash command (e.g., /enrich report)
}
```

---

## Entity Relationship Summary

```
WorkspaceInstallation (1) ──── (*) AgentThread
                                    │
                                    ├── (*) ConversationTurn [7-day retention]
                                    ├── (1) AgentThreadAudit [permanent]
                                    └── (*) AgentThreadJob ──── (*) Job [existing]
                                                                    │
                                                                    ├── (*) JobCompany
                                                                    ├── (*) JobContact
                                                                    └── (*) ApiUsageLog [+ slackTeamId]
```

---

## Migration Notes

1. **WorkspaceInstallation**: New table. Seed with current workspace's bot token for backward compatibility.
2. **AgentThread, ConversationTurn, AgentThreadAudit, AgentThreadJob**: New tables. No migration of existing data needed.
3. **ApiUsageLog.slackTeamId**: Backfill from associated Job records. Set as nullable initially, then enforce NOT NULL after backfill.
4. **Job.sourceInterface**: Default to TRIGGER for existing records. New agent-created jobs set to AGENT.
5. **Indexes**: Add compound indexes for workspace-scoped queries.
