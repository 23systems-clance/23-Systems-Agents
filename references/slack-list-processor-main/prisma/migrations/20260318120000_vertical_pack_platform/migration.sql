-- CreateEnum
CREATE TYPE "AgentStatus" AS ENUM ('DRAFT', 'TESTING', 'PUBLISHED', 'DEPRECATED');

-- CreateEnum
CREATE TYPE "McpServerStatus" AS ENUM ('HEALTHY', 'ERROR', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "McpAuthType" AS ENUM ('API_KEY', 'OAUTH2', 'BEARER_TOKEN', 'BASIC_AUTH', 'NONE');

-- CreateEnum
CREATE TYPE "SkillStatus" AS ENUM ('DRAFT', 'TESTING', 'PUBLISHED', 'DEPRECATED');

-- CreateEnum
CREATE TYPE "SkillTriggerType" AS ENUM ('SLACK_COMMAND', 'API_CALL', 'SCHEDULED', 'EVENT', 'MANUAL');

-- CreateEnum
CREATE TYPE "SkillDeliveryChannel" AS ENUM ('SLACK_THREAD', 'EMAIL', 'CRM_SYNC', 'FILE_DOWNLOAD', 'WEBHOOK');

-- CreateEnum
CREATE TYPE "PackStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'DEPRECATED');

-- CreateEnum
CREATE TYPE "PackCategory" AS ENUM ('SALES', 'OPERATIONS', 'RESEARCH', 'EXECUTIVE', 'CUSTOM');

-- CreateEnum
CREATE TYPE "PackTier" AS ENUM ('FREE', 'STARTER', 'GROWTH', 'AGENCY');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('ACTIVE', 'PAST_DUE', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "SkillExecutionStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED', 'SPEND_LIMIT_BLOCKED');

-- AlterTable: Add daily spend fields to WorkspaceInstallation
ALTER TABLE "workspace_installations" ADD COLUMN "daily_spend_limit_usd" DECIMAL(10,2),
ADD COLUMN "daily_spend_used_usd" DECIMAL(10,2) NOT NULL DEFAULT 0,
ADD COLUMN "daily_spend_reset_at" TIMESTAMP(3);

-- CreateTable: agents
CREATE TABLE "agents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "status" "AgentStatus" NOT NULL DEFAULT 'DRAFT',
    "model_id" TEXT NOT NULL,
    "max_tokens" INTEGER NOT NULL,
    "credit_cost" DECIMAL(10,4) NOT NULL,
    "input_schema" JSONB,
    "output_schema" JSONB,
    "tool_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agents_pkey" PRIMARY KEY ("id")
);

-- CreateTable: agent_versions
CREATE TABLE "agent_versions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "agent_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "AgentStatus" NOT NULL,
    "system_prompt" TEXT NOT NULL,
    "model_id" TEXT NOT NULL,
    "max_tokens" INTEGER NOT NULL,
    "tool_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "input_schema" JSONB,
    "output_schema" JSONB,
    "change_note" TEXT,
    "published_at" TIMESTAMP(3),
    "published_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable: mcp_servers
CREATE TABLE "mcp_servers" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "base_url" TEXT NOT NULL,
    "auth_type" "McpAuthType" NOT NULL,
    "credentials" TEXT,
    "status" "McpServerStatus" NOT NULL DEFAULT 'UNKNOWN',
    "byok_enabled" BOOLEAN NOT NULL DEFAULT false,
    "rate_limit_rpm" INTEGER,
    "last_health_check" TIMESTAMP(3),
    "last_health_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mcp_servers_pkey" PRIMARY KEY ("id")
);

-- CreateTable: mcp_tools
CREATE TABLE "mcp_tools" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "server_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "input_schema" JSONB,
    "output_schema" JSONB,
    "credit_cost" DECIMAL(10,4) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mcp_tools_pkey" PRIMARY KEY ("id")
);

-- CreateTable: mcp_byok_credentials
CREATE TABLE "mcp_byok_credentials" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "server_id" UUID NOT NULL,
    "slack_team_id" TEXT NOT NULL,
    "credentials" TEXT NOT NULL,
    "is_valid" BOOLEAN NOT NULL DEFAULT true,
    "last_validated_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mcp_byok_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable: skills
CREATE TABLE "skills" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "status" "SkillStatus" NOT NULL DEFAULT 'DRAFT',
    "agent_id" UUID NOT NULL,
    "agent_version_id" UUID NOT NULL,
    "trigger_type" "SkillTriggerType" NOT NULL,
    "trigger_config" JSONB,
    "delivery_channels" "SkillDeliveryChannel"[] DEFAULT ARRAY[]::"SkillDeliveryChannel"[],
    "delivery_config" JSONB,
    "mcp_tool_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "input_mapping" JSONB,
    "output_mapping" JSONB,
    "credit_cost" DECIMAL(10,4) NOT NULL,
    "retry_policy" JSONB,
    "chain_event_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "skills_pkey" PRIMARY KEY ("id")
);

-- CreateTable: vertical_packs
CREATE TABLE "vertical_packs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "category" "PackCategory" NOT NULL,
    "status" "PackStatus" NOT NULL DEFAULT 'DRAFT',
    "tier" "PackTier" NOT NULL,
    "monthly_price_usd" DECIMAL(10,2),
    "credits_included" INTEGER NOT NULL,
    "overage_rate_usd" DECIMAL(10,4),
    "stripe_price_id" TEXT,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vertical_packs_pkey" PRIMARY KEY ("id")
);

-- CreateTable: pack_skills
CREATE TABLE "pack_skills" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "pack_id" UUID NOT NULL,
    "skill_id" UUID NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pack_skills_pkey" PRIMARY KEY ("id")
);

-- CreateTable: pack_subscriptions
CREATE TABLE "pack_subscriptions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "pack_id" UUID NOT NULL,
    "slack_team_id" TEXT NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
    "credits_included" INTEGER NOT NULL,
    "credits_used" INTEGER NOT NULL DEFAULT 0,
    "overage_rate_usd" DECIMAL(10,4),
    "current_period_start" TIMESTAMP(3) NOT NULL,
    "current_period_end" TIMESTAMP(3) NOT NULL,
    "stripe_subscription_id" TEXT,
    "cancelled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pack_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable: pack_credit_transactions
CREATE TABLE "pack_credit_transactions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "pack_subscription_id" UUID NOT NULL,
    "type" "CreditTransactionType" NOT NULL,
    "amount" INTEGER NOT NULL,
    "balance_after" INTEGER NOT NULL,
    "reference_id" TEXT,
    "description" TEXT NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pack_credit_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable: skill_executions
CREATE TABLE "skill_executions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "skill_id" UUID NOT NULL,
    "slack_team_id" TEXT NOT NULL,
    "slack_user_id" TEXT,
    "status" "SkillExecutionStatus" NOT NULL DEFAULT 'QUEUED',
    "trigger_type" "SkillTriggerType" NOT NULL,
    "trigger_source" TEXT,
    "input" JSONB,
    "output" JSONB,
    "credits_cost" DECIMAL(10,4) NOT NULL DEFAULT 0,
    "pack_subscription_id" UUID,
    "bullmq_job_id" TEXT,
    "error_message" TEXT,
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "execution_trace" JSONB,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "skill_executions_pkey" PRIMARY KEY ("id")
);

-- CreateTable: agent_invocations
CREATE TABLE "agent_invocations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "execution_id" UUID NOT NULL,
    "agent_version_id" UUID NOT NULL,
    "input" JSONB,
    "output" JSONB,
    "tokens_input" INTEGER NOT NULL DEFAULT 0,
    "tokens_output" INTEGER NOT NULL DEFAULT 0,
    "cost_usd" DECIMAL(10,6) NOT NULL DEFAULT 0,
    "model_id" TEXT NOT NULL,
    "duration_ms" INTEGER NOT NULL DEFAULT 0,
    "tool_calls_made" JSONB,
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_invocations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "agents_slug_key" ON "agents"("slug");
CREATE INDEX "agents_status_idx" ON "agents"("status");

-- CreateIndex
CREATE UNIQUE INDEX "agent_versions_agent_id_version_key" ON "agent_versions"("agent_id", "version");
CREATE INDEX "agent_versions_agent_id_status_idx" ON "agent_versions"("agent_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "mcp_servers_slug_key" ON "mcp_servers"("slug");
CREATE INDEX "mcp_servers_status_idx" ON "mcp_servers"("status");

-- CreateIndex
CREATE UNIQUE INDEX "mcp_tools_server_id_name_key" ON "mcp_tools"("server_id", "name");
CREATE INDEX "mcp_tools_server_id_idx" ON "mcp_tools"("server_id");

-- CreateIndex
CREATE UNIQUE INDEX "mcp_byok_credentials_server_id_slack_team_id_key" ON "mcp_byok_credentials"("server_id", "slack_team_id");
CREATE INDEX "mcp_byok_credentials_slack_team_id_idx" ON "mcp_byok_credentials"("slack_team_id");

-- CreateIndex
CREATE UNIQUE INDEX "skills_slug_key" ON "skills"("slug");
CREATE INDEX "skills_status_idx" ON "skills"("status");
CREATE INDEX "skills_agent_id_idx" ON "skills"("agent_id");
CREATE INDEX "skills_trigger_type_idx" ON "skills"("trigger_type");

-- CreateIndex
CREATE UNIQUE INDEX "vertical_packs_slug_key" ON "vertical_packs"("slug");
CREATE INDEX "vertical_packs_status_idx" ON "vertical_packs"("status");
CREATE INDEX "vertical_packs_category_idx" ON "vertical_packs"("category");

-- CreateIndex
CREATE UNIQUE INDEX "pack_skills_pack_id_skill_id_key" ON "pack_skills"("pack_id", "skill_id");
CREATE INDEX "pack_skills_pack_id_idx" ON "pack_skills"("pack_id");
CREATE INDEX "pack_skills_skill_id_idx" ON "pack_skills"("skill_id");

-- CreateIndex
CREATE UNIQUE INDEX "pack_subscriptions_pack_id_slack_team_id_key" ON "pack_subscriptions"("pack_id", "slack_team_id");
CREATE INDEX "pack_subscriptions_slack_team_id_idx" ON "pack_subscriptions"("slack_team_id");
CREATE INDEX "pack_subscriptions_status_idx" ON "pack_subscriptions"("status");

-- CreateIndex
CREATE INDEX "pack_credit_transactions_pack_subscription_id_idx" ON "pack_credit_transactions"("pack_subscription_id");
CREATE INDEX "pack_credit_transactions_type_idx" ON "pack_credit_transactions"("type");
CREATE INDEX "pack_credit_transactions_created_at_idx" ON "pack_credit_transactions"("created_at");

-- CreateIndex
CREATE INDEX "skill_executions_skill_id_idx" ON "skill_executions"("skill_id");
CREATE INDEX "skill_executions_slack_team_id_idx" ON "skill_executions"("slack_team_id");
CREATE INDEX "skill_executions_status_idx" ON "skill_executions"("status");
CREATE INDEX "skill_executions_created_at_idx" ON "skill_executions"("created_at");
CREATE INDEX "skill_executions_pack_subscription_id_idx" ON "skill_executions"("pack_subscription_id");

-- CreateIndex
CREATE INDEX "agent_invocations_execution_id_idx" ON "agent_invocations"("execution_id");
CREATE INDEX "agent_invocations_agent_version_id_idx" ON "agent_invocations"("agent_version_id");
CREATE INDEX "agent_invocations_created_at_idx" ON "agent_invocations"("created_at");

-- AddForeignKey
ALTER TABLE "agent_versions" ADD CONSTRAINT "agent_versions_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mcp_tools" ADD CONSTRAINT "mcp_tools_server_id_fkey" FOREIGN KEY ("server_id") REFERENCES "mcp_servers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mcp_byok_credentials" ADD CONSTRAINT "mcp_byok_credentials_server_id_fkey" FOREIGN KEY ("server_id") REFERENCES "mcp_servers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skills" ADD CONSTRAINT "skills_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skills" ADD CONSTRAINT "skills_agent_version_id_fkey" FOREIGN KEY ("agent_version_id") REFERENCES "agent_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pack_skills" ADD CONSTRAINT "pack_skills_pack_id_fkey" FOREIGN KEY ("pack_id") REFERENCES "vertical_packs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pack_skills" ADD CONSTRAINT "pack_skills_skill_id_fkey" FOREIGN KEY ("skill_id") REFERENCES "skills"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pack_subscriptions" ADD CONSTRAINT "pack_subscriptions_pack_id_fkey" FOREIGN KEY ("pack_id") REFERENCES "vertical_packs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pack_credit_transactions" ADD CONSTRAINT "pack_credit_transactions_pack_subscription_id_fkey" FOREIGN KEY ("pack_subscription_id") REFERENCES "pack_subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "skill_executions" ADD CONSTRAINT "skill_executions_skill_id_fkey" FOREIGN KEY ("skill_id") REFERENCES "skills"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_invocations" ADD CONSTRAINT "agent_invocations_execution_id_fkey" FOREIGN KEY ("execution_id") REFERENCES "skill_executions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_invocations" ADD CONSTRAINT "agent_invocations_agent_version_id_fkey" FOREIGN KEY ("agent_version_id") REFERENCES "agent_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
