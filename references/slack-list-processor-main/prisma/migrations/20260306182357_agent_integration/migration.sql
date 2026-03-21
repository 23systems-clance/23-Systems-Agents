/*
  Warnings:

  - You are about to drop the `session` table. If the table is not empty, all the data it contains will be lost.

*/
-- CreateEnum
CREATE TYPE "WorkspaceStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'UNINSTALLED');

-- CreateEnum
CREATE TYPE "AgentThreadStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'PURGED');

-- CreateEnum
CREATE TYPE "ConversationRole" AS ENUM ('USER', 'ASSISTANT');

-- CreateEnum
CREATE TYPE "JobSourceInterface" AS ENUM ('TRIGGER', 'AGENT', 'COMMAND');

-- AlterTable
ALTER TABLE "api_usage_logs" ADD COLUMN     "slack_team_id" TEXT;

-- AlterTable
ALTER TABLE "jobs" ADD COLUMN     "source_interface" "JobSourceInterface" NOT NULL DEFAULT 'TRIGGER';

-- DropTable
DROP TABLE "session";

-- CreateTable
CREATE TABLE "workspace_installations" (
    "id" TEXT NOT NULL,
    "slack_team_id" TEXT NOT NULL,
    "slack_team_name" TEXT NOT NULL,
    "bot_token" TEXT NOT NULL,
    "bot_id" TEXT NOT NULL,
    "bot_user_id" TEXT NOT NULL,
    "app_id" TEXT NOT NULL,
    "installed_by_user_id" TEXT NOT NULL,
    "scopes" TEXT NOT NULL,
    "status" "WorkspaceStatus" NOT NULL DEFAULT 'ACTIVE',
    "uninstalled_at" TIMESTAMP(3),
    "purge_after" TIMESTAMP(3),
    "monthly_spend_cap_usd" DECIMAL(65,30),
    "max_builtwith_lookups" INTEGER,
    "max_apollo_credits" INTEGER,
    "max_ai_tokens" INTEGER,
    "onboarding_complete" BOOLEAN NOT NULL DEFAULT false,
    "settings" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workspace_installations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_threads" (
    "id" TEXT NOT NULL,
    "slack_thread_ts" TEXT NOT NULL,
    "slack_channel_id" TEXT NOT NULL,
    "slack_user_id" TEXT NOT NULL,
    "slack_team_id" TEXT NOT NULL,
    "viewing_channel_id" TEXT,
    "viewing_channel_name" TEXT,
    "title" TEXT,
    "status" "AgentThreadStatus" NOT NULL DEFAULT 'ACTIVE',
    "last_activity_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_threads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation_turns" (
    "id" TEXT NOT NULL,
    "agent_thread_id" TEXT NOT NULL,
    "role" "ConversationRole" NOT NULL,
    "content" TEXT NOT NULL,
    "intent" TEXT,
    "confidence" DOUBLE PRECISION,
    "extracted_params" JSONB,
    "tokens_input" INTEGER,
    "tokens_output" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_turns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_thread_audits" (
    "id" TEXT NOT NULL,
    "agent_thread_id" TEXT NOT NULL,
    "slack_team_id" TEXT NOT NULL,
    "slack_user_id" TEXT NOT NULL,
    "thread_title" TEXT,
    "turn_count" INTEGER NOT NULL,
    "intents_classified" JSONB NOT NULL,
    "jobs_created" JSONB NOT NULL,
    "actions_performed" JSONB NOT NULL,
    "first_message_at" TIMESTAMP(3) NOT NULL,
    "last_message_at" TIMESTAMP(3) NOT NULL,
    "total_ai_tokens_input" INTEGER NOT NULL,
    "total_ai_tokens_output" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_thread_audits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_thread_jobs" (
    "id" TEXT NOT NULL,
    "agent_thread_id" TEXT NOT NULL,
    "job_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_thread_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "workspace_installations_slack_team_id_key" ON "workspace_installations"("slack_team_id");

-- CreateIndex
CREATE INDEX "agent_threads_slack_team_id_slack_user_id_idx" ON "agent_threads"("slack_team_id", "slack_user_id");

-- CreateIndex
CREATE INDEX "agent_threads_slack_team_id_slack_thread_ts_idx" ON "agent_threads"("slack_team_id", "slack_thread_ts");

-- CreateIndex
CREATE INDEX "agent_threads_status_last_activity_at_idx" ON "agent_threads"("status", "last_activity_at");

-- CreateIndex
CREATE INDEX "conversation_turns_agent_thread_id_idx" ON "conversation_turns"("agent_thread_id");

-- CreateIndex
CREATE INDEX "conversation_turns_created_at_idx" ON "conversation_turns"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "agent_thread_audits_agent_thread_id_key" ON "agent_thread_audits"("agent_thread_id");

-- CreateIndex
CREATE INDEX "agent_thread_audits_slack_team_id_idx" ON "agent_thread_audits"("slack_team_id");

-- CreateIndex
CREATE INDEX "agent_thread_jobs_agent_thread_id_idx" ON "agent_thread_jobs"("agent_thread_id");

-- CreateIndex
CREATE INDEX "agent_thread_jobs_job_id_idx" ON "agent_thread_jobs"("job_id");

-- CreateIndex
CREATE UNIQUE INDEX "agent_thread_jobs_agent_thread_id_job_id_key" ON "agent_thread_jobs"("agent_thread_id", "job_id");

-- CreateIndex
CREATE INDEX "api_usage_logs_slack_team_id_idx" ON "api_usage_logs"("slack_team_id");

-- AddForeignKey
ALTER TABLE "agent_threads" ADD CONSTRAINT "agent_threads_slack_team_id_fkey" FOREIGN KEY ("slack_team_id") REFERENCES "workspace_installations"("slack_team_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_turns" ADD CONSTRAINT "conversation_turns_agent_thread_id_fkey" FOREIGN KEY ("agent_thread_id") REFERENCES "agent_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_thread_audits" ADD CONSTRAINT "agent_thread_audits_agent_thread_id_fkey" FOREIGN KEY ("agent_thread_id") REFERENCES "agent_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_thread_jobs" ADD CONSTRAINT "agent_thread_jobs_agent_thread_id_fkey" FOREIGN KEY ("agent_thread_id") REFERENCES "agent_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_thread_jobs" ADD CONSTRAINT "agent_thread_jobs_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
