# Data Model: Vertical Pack Platform

**Feature**: 39-vertical-pack-platform
**Date**: 2026-03-18

## New Enums

```prisma
enum AgentStatus {
  DRAFT
  TESTING
  PUBLISHED
  DEPRECATED
}

enum McpServerStatus {
  HEALTHY
  ERROR
  UNKNOWN
}

enum McpAuthType {
  API_KEY
  OAUTH2
  BEARER_TOKEN
  BASIC_AUTH
  NONE
}

enum SkillStatus {
  DRAFT
  TESTING
  PUBLISHED
  DEPRECATED
}

enum SkillTriggerType {
  SLACK_COMMAND
  API_CALL
  SCHEDULED
  EVENT
  MANUAL
}

enum SkillDeliveryChannel {
  SLACK_THREAD
  EMAIL
  CRM_SYNC
  FILE_DOWNLOAD
  WEBHOOK
}

enum PackStatus {
  DRAFT
  PUBLISHED
  DEPRECATED
}

enum PackCategory {
  SALES
  OPERATIONS
  RESEARCH
  EXECUTIVE
  CUSTOM
}

enum PackTier {
  FREE
  STARTER
  GROWTH
  AGENCY
}

enum SubscriptionStatus {
  ACTIVE
  PAST_DUE
  CANCELLED
  EXPIRED
}

enum SkillExecutionStatus {
  QUEUED
  RUNNING
  COMPLETED
  FAILED
  CANCELLED
  SPEND_LIMIT_BLOCKED
}
```

## New Models

### Agent

The core reasoning unit. Backed by an LLM with a system prompt, tool access, and versioning.

```prisma
model Agent {
  id          String      @id @default(uuid()) @db.Uuid
  name        String
  slug        String      @unique
  description String?     @db.Text
  status      AgentStatus @default(DRAFT)
  modelId     String      @map("model_id")          // e.g., "claude-haiku-4-5-20251001"
  maxTokens   Int         @map("max_tokens")         // Per-invocation output token cap (FR-005a)
  creditCost  Decimal     @map("credit_cost") @db.Decimal(10, 4)  // Credits per invocation
  inputSchema Json?       @map("input_schema") @db.JsonB
  outputSchema Json?      @map("output_schema") @db.JsonB
  toolIds     String[]    @default([]) @map("tool_ids")  // McpTool IDs this agent can invoke
  createdAt   DateTime    @default(now()) @map("created_at")
  updatedAt   DateTime    @updatedAt @map("updated_at")

  // Relations
  versions    AgentVersion[]
  skills      Skill[]

  @@index([status])
  @@map("agents")
}
```

### AgentVersion

Immutable snapshot of an agent's configuration at a point in time. Skills pin to a specific version.

```prisma
model AgentVersion {
  id           String      @id @default(uuid()) @db.Uuid
  agentId      String      @map("agent_id") @db.Uuid
  version      Int
  status       AgentStatus
  systemPrompt String      @map("system_prompt") @db.Text
  modelId      String      @map("model_id")
  maxTokens    Int         @map("max_tokens")
  toolIds      String[]    @default([]) @map("tool_ids")
  inputSchema  Json?       @map("input_schema") @db.JsonB
  outputSchema Json?       @map("output_schema") @db.JsonB
  changeNote   String?     @map("change_note")
  publishedAt  DateTime?   @map("published_at")
  publishedBy  String?     @map("published_by") @db.Uuid  // AdminUser ID
  createdAt    DateTime    @default(now()) @map("created_at")

  // Relations
  agent        Agent       @relation(fields: [agentId], references: [id], onDelete: Cascade)
  skills       Skill[]     @relation("SkillAgentVersion")
  invocations  AgentInvocation[]

  @@unique([agentId, version])
  @@index([agentId, status])
  @@map("agent_versions")
}
```

### McpServer

An external service connection that exposes tools for agents to invoke.

```prisma
model McpServer {
  id             String          @id @default(uuid()) @db.Uuid
  name           String
  slug           String          @unique
  provider       String                                // e.g., "apollo", "builtwith", "hubspot"
  baseUrl        String          @map("base_url")
  authType       McpAuthType     @map("auth_type")
  credentials    String?         @db.Text              // Encrypted JSON blob
  status         McpServerStatus @default(UNKNOWN)
  byokEnabled    Boolean         @default(false) @map("byok_enabled")  // BYOK support (FR-009)
  rateLimitRpm   Int?            @map("rate_limit_rpm")                 // Requests per minute cap
  lastHealthCheck DateTime?      @map("last_health_check")
  lastHealthError String?        @map("last_health_error") @db.Text
  createdAt      DateTime        @default(now()) @map("created_at")
  updatedAt      DateTime        @updatedAt @map("updated_at")

  // Relations
  tools          McpTool[]
  byokCredentials McpByokCredential[]

  @@index([status])
  @@map("mcp_servers")
}
```

### McpTool

A specific capability exposed by an MCP server.

```prisma
model McpTool {
  id           String    @id @default(uuid()) @db.Uuid
  serverId     String    @map("server_id") @db.Uuid
  name         String                                // e.g., "lookup_contact", "get_tech_stack"
  description  String?   @db.Text
  inputSchema  Json?     @map("input_schema") @db.JsonB
  outputSchema Json?     @map("output_schema") @db.JsonB
  creditCost   Decimal   @default(0) @map("credit_cost") @db.Decimal(10, 4)
  createdAt    DateTime  @default(now()) @map("created_at")
  updatedAt    DateTime  @updatedAt @map("updated_at")

  // Relations
  server       McpServer @relation(fields: [serverId], references: [id], onDelete: Cascade)

  @@unique([serverId, name])
  @@index([serverId])
  @@map("mcp_tools")
}
```

### McpByokCredential

Per-workspace BYOK credentials for an MCP server.

```prisma
model McpByokCredential {
  id           String    @id @default(uuid()) @db.Uuid
  serverId     String    @map("server_id") @db.Uuid
  slackTeamId  String    @map("slack_team_id")
  credentials  String    @db.Text              // Encrypted JSON blob
  isValid      Boolean   @default(true) @map("is_valid")
  lastValidatedAt DateTime? @map("last_validated_at")
  createdAt    DateTime  @default(now()) @map("created_at")
  updatedAt    DateTime  @updatedAt @map("updated_at")

  // Relations
  server       McpServer @relation(fields: [serverId], references: [id], onDelete: Cascade)

  @@unique([serverId, slackTeamId])
  @@index([slackTeamId])
  @@map("mcp_byok_credentials")
}
```

### Skill

A composable execution unit combining an agent, MCP tools, trigger, and delivery.

```prisma
model Skill {
  id              String              @id @default(uuid()) @db.Uuid
  name            String
  slug            String              @unique
  description     String?             @db.Text
  status          SkillStatus         @default(DRAFT)
  agentId         String              @map("agent_id") @db.Uuid
  agentVersionId  String              @map("agent_version_id") @db.Uuid  // Pinned version (FR-011)
  triggerType     SkillTriggerType    @map("trigger_type")
  triggerConfig   Json?               @map("trigger_config") @db.JsonB    // Trigger-specific config
  deliveryChannels SkillDeliveryChannel[] @map("delivery_channels")
  deliveryConfig  Json?               @map("delivery_config") @db.JsonB
  mcpToolIds      String[]            @default([]) @map("mcp_tool_ids")  // McpTool IDs used
  inputMapping    Json?               @map("input_mapping") @db.JsonB
  outputMapping   Json?               @map("output_mapping") @db.JsonB
  creditCost      Decimal             @map("credit_cost") @db.Decimal(10, 4)
  retryPolicy     Json?               @map("retry_policy") @db.JsonB     // { maxRetries, backoff }
  chainEventName  String?             @map("chain_event_name")           // Event to publish on completion
  createdAt       DateTime            @default(now()) @map("created_at")
  updatedAt       DateTime            @updatedAt @map("updated_at")

  // Relations
  agent          Agent               @relation(fields: [agentId], references: [id])
  agentVersion   AgentVersion        @relation("SkillAgentVersion", fields: [agentVersionId], references: [id])
  packSkills     PackSkill[]
  executions     SkillExecution[]

  @@index([status])
  @@index([agentId])
  @@index([triggerType])
  @@map("skills")
}
```

### VerticalPack

A curated bundle of skills marketed for a specific use case.

```prisma
model VerticalPack {
  id              String      @id @default(uuid()) @db.Uuid
  name            String
  slug            String      @unique
  description     String?     @db.Text
  category        PackCategory
  status          PackStatus  @default(DRAFT)
  tier            PackTier
  monthlyPriceUsd Decimal?    @map("monthly_price_usd") @db.Decimal(10, 2)
  creditsIncluded Int         @map("credits_included")
  overageRateUsd  Decimal?    @map("overage_rate_usd") @db.Decimal(10, 4)  // Per-credit overage
  stripePriceId   String?     @map("stripe_price_id")
  displayOrder    Int         @default(0) @map("display_order")
  createdAt       DateTime    @default(now()) @map("created_at")
  updatedAt       DateTime    @updatedAt @map("updated_at")

  // Relations
  packSkills    PackSkill[]
  subscriptions PackSubscription[]

  @@index([status])
  @@index([category])
  @@map("vertical_packs")
}
```

### PackSkill

Many-to-many junction between packs and skills.

```prisma
model PackSkill {
  id        String   @id @default(uuid()) @db.Uuid
  packId    String   @map("pack_id") @db.Uuid
  skillId   String   @map("skill_id") @db.Uuid
  sortOrder Int      @default(0) @map("sort_order")
  createdAt DateTime @default(now()) @map("created_at")

  // Relations
  pack  VerticalPack @relation(fields: [packId], references: [id], onDelete: Cascade)
  skill Skill        @relation(fields: [skillId], references: [id], onDelete: Cascade)

  @@unique([packId, skillId])
  @@index([packId])
  @@index([skillId])
  @@map("pack_skills")
}
```

### PackSubscription

A workspace's active subscription to a vertical pack. Tracks per-pack credits (FR-019).

```prisma
model PackSubscription {
  id                String             @id @default(uuid()) @db.Uuid
  packId            String             @map("pack_id") @db.Uuid
  slackTeamId       String             @map("slack_team_id")
  status            SubscriptionStatus @default(ACTIVE)
  creditsIncluded   Int                @map("credits_included")
  creditsUsed       Int                @default(0) @map("credits_used")
  overageRateUsd    Decimal?           @map("overage_rate_usd") @db.Decimal(10, 4)
  currentPeriodStart DateTime          @map("current_period_start")
  currentPeriodEnd   DateTime          @map("current_period_end")
  stripeSubscriptionId String?         @map("stripe_subscription_id")
  cancelledAt       DateTime?          @map("cancelled_at")
  createdAt         DateTime           @default(now()) @map("created_at")
  updatedAt         DateTime           @updatedAt @map("updated_at")

  // Relations
  pack             VerticalPack      @relation(fields: [packId], references: [id])
  creditTransactions PackCreditTransaction[]

  @@unique([packId, slackTeamId])
  @@index([slackTeamId])
  @@index([status])
  @@map("pack_subscriptions")
}
```

### PackCreditTransaction

Append-only credit ledger for pack subscriptions (extends CreditTransaction pattern).

```prisma
model PackCreditTransaction {
  id                 String   @id @default(uuid()) @db.Uuid
  packSubscriptionId String   @map("pack_subscription_id") @db.Uuid
  type               CreditTransactionType
  amount             Int      // Positive = addition, negative = deduction
  balanceAfter       Int      @map("balance_after")
  referenceId        String?  @map("reference_id")  // SkillExecution ID
  description        String   @db.Text
  metadata           Json?    @db.JsonB
  createdAt          DateTime @default(now()) @map("created_at")

  // Relations
  packSubscription PackSubscription @relation(fields: [packSubscriptionId], references: [id], onDelete: Cascade)

  @@index([packSubscriptionId])
  @@index([type])
  @@index([createdAt])
  @@map("pack_credit_transactions")
}
```

### SkillExecution

A full end-to-end run of a skill, tracking the entire pipeline.

```prisma
model SkillExecution {
  id               String               @id @default(uuid()) @db.Uuid
  skillId          String               @map("skill_id") @db.Uuid
  slackTeamId      String               @map("slack_team_id")
  slackUserId      String?              @map("slack_user_id")
  status           SkillExecutionStatus @default(QUEUED)
  triggerType      SkillTriggerType     @map("trigger_type")
  triggerSource    String?              @map("trigger_source")       // e.g., Slack channel ID, API caller
  input            Json?                @db.JsonB
  output           Json?                @db.JsonB
  creditsCost      Decimal              @default(0) @map("credits_cost") @db.Decimal(10, 4)
  packSubscriptionId String?            @map("pack_subscription_id") @db.Uuid
  bullmqJobId      String?              @map("bullmq_job_id")
  errorMessage     String?              @map("error_message") @db.Text
  retryCount       Int                  @default(0) @map("retry_count")
  executionTrace   Json?                @map("execution_trace") @db.JsonB  // Full trace: agent calls, tool calls
  startedAt        DateTime?            @map("started_at")
  completedAt      DateTime?            @map("completed_at")
  createdAt        DateTime             @default(now()) @map("created_at")

  // Relations
  skill            Skill                @relation(fields: [skillId], references: [id])
  agentInvocations AgentInvocation[]

  @@index([skillId])
  @@index([slackTeamId])
  @@index([status])
  @@index([createdAt])
  @@index([packSubscriptionId])
  @@map("skill_executions")
}
```

### AgentInvocation

A single LLM call within a skill execution.

```prisma
model AgentInvocation {
  id               String    @id @default(uuid()) @db.Uuid
  executionId      String    @map("execution_id") @db.Uuid
  agentVersionId   String    @map("agent_version_id") @db.Uuid
  input            Json?     @db.JsonB
  output           Json?     @db.JsonB
  tokensInput      Int       @default(0) @map("tokens_input")
  tokensOutput     Int       @default(0) @map("tokens_output")
  costUsd          Decimal   @default(0) @map("cost_usd") @db.Decimal(10, 6)
  modelId          String    @map("model_id")
  durationMs       Int       @default(0) @map("duration_ms")
  toolCallsMade    Json?     @map("tool_calls_made") @db.JsonB  // MCP tool calls + results
  errorMessage     String?   @map("error_message") @db.Text
  createdAt        DateTime  @default(now()) @map("created_at")

  // Relations
  execution       SkillExecution @relation(fields: [executionId], references: [id], onDelete: Cascade)
  agentVersion    AgentVersion   @relation(fields: [agentVersionId], references: [id])

  @@index([executionId])
  @@index([agentVersionId])
  @@index([createdAt])
  @@map("agent_invocations")
}
```

## Extended Existing Models

### WorkspaceInstallation (add fields)

```prisma
// Add to existing WorkspaceInstallation model:
dailySpendLimitUsd   Decimal?  @map("daily_spend_limit_usd") @db.Decimal(10, 2)
dailySpendUsedUsd    Decimal   @default(0) @map("daily_spend_used_usd") @db.Decimal(10, 2)
dailySpendResetAt    DateTime? @map("daily_spend_reset_at")
```

## Entity Relationships

```
Agent 1──* AgentVersion
AgentVersion 1──* Skill (pinned version)
AgentVersion 1──* AgentInvocation

McpServer 1──* McpTool
McpServer 1──* McpByokCredential

Skill *──1 Agent (current agent)
Skill *──1 AgentVersion (pinned version)
Skill *──* VerticalPack (via PackSkill)
Skill 1──* SkillExecution

VerticalPack *──* Skill (via PackSkill)
VerticalPack 1──* PackSubscription

PackSubscription 1──* PackCreditTransaction
PackSubscription *──1 VerticalPack

SkillExecution *──1 Skill
SkillExecution 1──* AgentInvocation

WorkspaceInstallation (extended with daily spend fields)
```

## State Transitions

### Agent Lifecycle
```
DRAFT → TESTING → PUBLISHED → DEPRECATED
                 ↘ DRAFT (new version from published)
```

### Skill Lifecycle
```
DRAFT → TESTING → PUBLISHED → DEPRECATED
```

### Pack Lifecycle
```
DRAFT → PUBLISHED → DEPRECATED
```

### Skill Execution Lifecycle
```
QUEUED → RUNNING → COMPLETED
                  → FAILED
                  → CANCELLED
QUEUED → SPEND_LIMIT_BLOCKED (daily limit hit)
```

### Pack Subscription Lifecycle
```
ACTIVE → PAST_DUE → ACTIVE (payment resolved)
ACTIVE → CANCELLED
ACTIVE → EXPIRED (billing period end, deprecated pack)
PAST_DUE → CANCELLED
```
