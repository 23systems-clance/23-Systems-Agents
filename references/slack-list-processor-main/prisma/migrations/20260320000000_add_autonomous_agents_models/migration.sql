-- Feature 31: Autonomous Agents with Slack Admin Interface
-- Adds new enums, extends existing models, and creates new tables.

-- New enums
CREATE TYPE "TeamStatus" AS ENUM ('ACTIVE', 'INACTIVE');
CREATE TYPE "Severity" AS ENUM ('INFO', 'WARNING', 'HIGH', 'CRITICAL');
CREATE TYPE "AuditOutcome" AS ENUM ('AUTO_EXECUTED', 'SUGGESTED', 'APPROVED', 'REJECTED', 'ESCALATED');
CREATE TYPE "ConflictOutcome" AS ENUM ('AUTO_MERGED', 'APPROVED', 'REJECTED', 'ESCALATED');
CREATE TYPE "PendingActionStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'EXPIRED');

-- Extend existing enums
ALTER TYPE "SkillExecutionStatus" ADD VALUE 'AWAITING_APPROVAL';
ALTER TYPE "AdminRole" ADD VALUE 'EDITOR' BEFORE 'VIEWER';

-- Extend AdminUser model
ALTER TABLE "admin_users" ADD COLUMN "slack_user_id" TEXT;
CREATE UNIQUE INDEX "admin_users_slack_user_id_key" ON "admin_users"("slack_user_id");

-- Extend Agent model
ALTER TABLE "agents" ADD COLUMN "suggest_only_mode" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "agents" ADD COLUMN "suggest_only_approvals" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "agents" ADD COLUMN "suggest_only_rejections" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "agents" ADD COLUMN "last_run_at" TIMESTAMP(3);
ALTER TABLE "agents" ADD COLUMN "actions_today" INTEGER NOT NULL DEFAULT 0;

-- Create Team table
CREATE TABLE "teams" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "status" "TeamStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "teams_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "teams_slug_key" ON "teams"("slug");
CREATE INDEX "teams_status_idx" ON "teams"("status");

-- Create TeamAgent junction table
CREATE TABLE "team_agents" (
    "id" UUID NOT NULL,
    "team_id" UUID NOT NULL,
    "agent_id" UUID NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "team_agents_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "team_agents_team_id_agent_id_key" ON "team_agents"("team_id", "agent_id");
CREATE INDEX "team_agents_team_id_idx" ON "team_agents"("team_id");
CREATE INDEX "team_agents_agent_id_idx" ON "team_agents"("agent_id");
ALTER TABLE "team_agents" ADD CONSTRAINT "team_agents_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "team_agents" ADD CONSTRAINT "team_agents_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Create AuditAction table
CREATE TABLE "audit_actions" (
    "id" UUID NOT NULL,
    "agent_name" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "severity" "Severity" NOT NULL,
    "metadata" JSONB NOT NULL,
    "specialty_execution_id" UUID,
    "outcome" "AuditOutcome" NOT NULL,
    "admin_user_id" UUID,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "audit_actions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "audit_actions_agent_name_timestamp_idx" ON "audit_actions"("agent_name", "timestamp");
CREATE INDEX "audit_actions_timestamp_idx" ON "audit_actions"("timestamp");
CREATE INDEX "audit_actions_outcome_timestamp_idx" ON "audit_actions"("outcome", "timestamp");
CREATE INDEX "audit_actions_severity_timestamp_idx" ON "audit_actions"("severity", "timestamp");
ALTER TABLE "audit_actions" ADD CONSTRAINT "audit_actions_specialty_execution_id_fkey" FOREIGN KEY ("specialty_execution_id") REFERENCES "skill_executions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "audit_actions" ADD CONSTRAINT "audit_actions_admin_user_id_fkey" FOREIGN KEY ("admin_user_id") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Create WorkerConfig table
CREATE TABLE "worker_configs" (
    "id" UUID NOT NULL,
    "worker_name" TEXT NOT NULL,
    "concurrency" INTEGER NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "updated_by" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    CONSTRAINT "worker_configs_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "worker_configs_worker_name_key" ON "worker_configs"("worker_name");
CREATE INDEX "worker_configs_worker_name_idx" ON "worker_configs"("worker_name");

-- Create SystemEvent table
CREATE TABLE "system_events" (
    "id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "severity" "Severity" NOT NULL,
    "message" TEXT NOT NULL,
    "metadata" JSONB NOT NULL,
    "agent_name" TEXT,
    "acknowledged" BOOLEAN NOT NULL DEFAULT false,
    "acknowledged_by" TEXT,
    "acknowledged_at" TIMESTAMP(3),
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "system_events_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "system_events_type_timestamp_idx" ON "system_events"("type", "timestamp");
CREATE INDEX "system_events_severity_timestamp_idx" ON "system_events"("severity", "timestamp");
CREATE INDEX "system_events_acknowledged_timestamp_idx" ON "system_events"("acknowledged", "timestamp");

-- Create CampaignMetrics table
CREATE TABLE "campaign_metrics" (
    "id" UUID NOT NULL,
    "campaign_id" TEXT NOT NULL,
    "sendHour" INTEGER NOT NULL,
    "open_rate" DOUBLE PRECISION NOT NULL,
    "response_rate" DOUBLE PRECISION NOT NULL,
    "send_count" INTEGER NOT NULL,
    "ab_test_variant" TEXT,
    "last_updated" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "campaign_metrics_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "campaign_metrics_campaign_id_sendHour_ab_test_variant_key" ON "campaign_metrics"("campaign_id", "sendHour", "ab_test_variant");
CREATE INDEX "campaign_metrics_campaign_id_idx" ON "campaign_metrics"("campaign_id");

-- Create ConflictDecision table
CREATE TABLE "conflict_decisions" (
    "id" UUID NOT NULL,
    "conflict_id" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "features" JSONB NOT NULL,
    "outcome" "ConflictOutcome" NOT NULL,
    "admin_user_id" UUID,
    "metadata" JSONB,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "conflict_decisions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "conflict_decisions_outcome_timestamp_idx" ON "conflict_decisions"("outcome", "timestamp");
CREATE INDEX "conflict_decisions_conflict_id_idx" ON "conflict_decisions"("conflict_id");
ALTER TABLE "conflict_decisions" ADD CONSTRAINT "conflict_decisions_admin_user_id_fkey" FOREIGN KEY ("admin_user_id") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Create PendingAction table
CREATE TABLE "pending_actions" (
    "id" UUID NOT NULL,
    "agent_name" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "metadata" JSONB NOT NULL,
    "specialty_execution_id" UUID,
    "status" "PendingActionStatus" NOT NULL DEFAULT 'PENDING',
    "reviewed_by" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "pending_actions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "pending_actions_status_created_at_idx" ON "pending_actions"("status", "created_at");
CREATE INDEX "pending_actions_agent_name_status_idx" ON "pending_actions"("agent_name", "status");
ALTER TABLE "pending_actions" ADD CONSTRAINT "pending_actions_specialty_execution_id_fkey" FOREIGN KEY ("specialty_execution_id") REFERENCES "skill_executions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
