-- CreateEnum
CREATE TYPE "WorkflowTriggerType" AS ENUM ('FILE_UPLOAD', 'KEYWORD', 'SLASH_COMMAND', 'MANUAL');

-- CreateEnum
CREATE TYPE "WorkflowVersionStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "WorkflowExecutionStatus" AS ENUM ('ACTIVE', 'WAITING_INPUT', 'WAITING_DELAY', 'COMPLETED', 'FAILED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "WorkflowNodeType" AS ENUM ('TRIGGER', 'MESSAGE', 'BUTTON_CHOICE', 'FORM_MODAL', 'ENRICHMENT', 'CONDITION', 'ACTION', 'DELAY');

-- AlterTable
ALTER TABLE "daily_bdr_activities" ADD COLUMN     "supervised" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "workflow_templates" (
    "id" UUID NOT NULL,
    "slack_team_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "trigger_type" "WorkflowTriggerType" NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT false,
    "created_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workflow_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_versions" (
    "id" UUID NOT NULL,
    "template_id" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "WorkflowVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "graph" JSONB NOT NULL,
    "published_at" TIMESTAMP(3),
    "published_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workflow_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workflow_executions" (
    "id" UUID NOT NULL,
    "version_id" UUID NOT NULL,
    "slack_team_id" TEXT NOT NULL,
    "slack_user_id" TEXT NOT NULL,
    "slack_channel_id" TEXT NOT NULL,
    "slack_thread_ts" TEXT,
    "status" "WorkflowExecutionStatus" NOT NULL DEFAULT 'ACTIVE',
    "current_node_id" TEXT,
    "context" JSONB NOT NULL DEFAULT '{}',
    "nodeHistory" JSONB NOT NULL DEFAULT '[]',
    "error_message" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workflow_executions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "workflow_templates_slack_team_id_idx" ON "workflow_templates"("slack_team_id");

-- CreateIndex
CREATE INDEX "workflow_templates_slack_team_id_trigger_type_idx" ON "workflow_templates"("slack_team_id", "trigger_type");

-- CreateIndex
CREATE INDEX "workflow_versions_template_id_status_idx" ON "workflow_versions"("template_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_versions_template_id_version_key" ON "workflow_versions"("template_id", "version");

-- CreateIndex
CREATE INDEX "workflow_executions_slack_team_id_slack_user_id_idx" ON "workflow_executions"("slack_team_id", "slack_user_id");

-- CreateIndex
CREATE INDEX "workflow_executions_slack_channel_id_slack_thread_ts_idx" ON "workflow_executions"("slack_channel_id", "slack_thread_ts");

-- CreateIndex
CREATE INDEX "workflow_executions_status_idx" ON "workflow_executions"("status");

-- CreateIndex
CREATE INDEX "workflow_executions_expires_at_idx" ON "workflow_executions"("expires_at");

-- CreateIndex
CREATE INDEX "workflow_executions_version_id_idx" ON "workflow_executions"("version_id");

-- AddForeignKey
ALTER TABLE "workflow_versions" ADD CONSTRAINT "workflow_versions_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "workflow_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workflow_executions" ADD CONSTRAINT "workflow_executions_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "workflow_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
