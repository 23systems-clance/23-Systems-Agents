-- CreateEnum
CREATE TYPE "CampaignType" AS ENUM ('EMAIL', 'PHONE', 'LINKEDIN', 'MULTI_CHANNEL');

-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'COMPLETED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "StepType" AS ENUM ('EMAIL', 'PHONE', 'LINKEDIN');

-- CreateEnum
CREATE TYPE "ContactCampaignStatus" AS ENUM ('ACTIVE', 'PAUSED', 'COMPLETED', 'RESPONDED', 'SKIPPED', 'REMOVED');

-- CreateEnum
CREATE TYPE "StepExecutionStatus" AS ENUM ('PENDING', 'FIRED', 'WAITING_WEBHOOK', 'COMPLETED', 'SKIPPED', 'FAILED');

-- CreateEnum
CREATE TYPE "WebhookSource" AS ENUM ('INSTANTLY', 'HEYREACH');

-- CreateEnum
CREATE TYPE "ReplyChannel" AS ENUM ('EMAIL', 'LINKEDIN');

-- CreateTable
CREATE TABLE "campaigns" (
    "id" UUID NOT NULL,
    "slack_team_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "campaign_type" "CampaignType" NOT NULL,
    "status" "CampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "icp_definition" TEXT,
    "meeting_link" TEXT,
    "call_script" TEXT,
    "email_sequence_copy" TEXT,
    "linkedin_sequence_copy" TEXT,
    "hubspot_list_id" TEXT,
    "external_list_id" TEXT,
    "instantly_campaign_id" TEXT,
    "heyreach_campaign_id" TEXT,
    "total_contacts" INTEGER NOT NULL DEFAULT 0,
    "active_contacts" INTEGER NOT NULL DEFAULT 0,
    "completed_contacts" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign_sequence_steps" (
    "id" UUID NOT NULL,
    "campaign_id" UUID NOT NULL,
    "step_order" INTEGER NOT NULL,
    "step_type" "StepType" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "campaign_sequence_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign_contacts" (
    "id" UUID NOT NULL,
    "campaign_id" UUID NOT NULL,
    "hubspot_contact_id" TEXT,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "email" TEXT,
    "email_verified" BOOLEAN NOT NULL DEFAULT false,
    "mobile_phone" TEXT,
    "direct_phone" TEXT,
    "linkedin_url" TEXT,
    "company_name" TEXT,
    "job_title" TEXT,
    "current_step_index" INTEGER NOT NULL DEFAULT 0,
    "status" "ContactCampaignStatus" NOT NULL DEFAULT 'ACTIVE',
    "status_reason" TEXT,
    "resolved_phone" TEXT,
    "can_email" BOOLEAN NOT NULL DEFAULT false,
    "can_call" BOOLEAN NOT NULL DEFAULT false,
    "can_linkedin" BOOLEAN NOT NULL DEFAULT false,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "last_activity_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campaign_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign_contact_step_executions" (
    "id" UUID NOT NULL,
    "campaign_contact_id" UUID NOT NULL,
    "step_index" INTEGER NOT NULL,
    "step_type" "StepType" NOT NULL,
    "status" "StepExecutionStatus" NOT NULL DEFAULT 'PENDING',
    "result" TEXT,
    "external_id" TEXT,
    "fired_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "campaign_contact_step_executions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign_bdrs" (
    "id" UUID NOT NULL,
    "campaign_id" UUID NOT NULL,
    "slack_user_id" TEXT NOT NULL,
    "slack_team_id" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "campaign_bdrs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_events" (
    "id" UUID NOT NULL,
    "source" "WebhookSource" NOT NULL,
    "event_type" TEXT NOT NULL,
    "campaign_id" UUID,
    "contact_email" TEXT,
    "contact_linkedin_url" TEXT,
    "raw_payload" JSONB NOT NULL,
    "processed" BOOLEAN NOT NULL DEFAULT false,
    "processed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "unibox_replies" (
    "id" UUID NOT NULL,
    "campaign_id" UUID NOT NULL,
    "campaign_contact_id" UUID,
    "channel" "ReplyChannel" NOT NULL,
    "from_name" TEXT,
    "from_email" TEXT,
    "from_linkedin_url" TEXT,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "raw_payload" JSONB,
    "external_id" TEXT,
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "received_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "unibox_replies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_bdr_activities" (
    "id" UUID NOT NULL,
    "campaign_id" UUID NOT NULL,
    "slack_user_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "emails_sent" INTEGER NOT NULL DEFAULT 0,
    "linkedin_actions_sent" INTEGER NOT NULL DEFAULT 0,
    "calls_completed" INTEGER NOT NULL DEFAULT 0,
    "email_replies_received" INTEGER NOT NULL DEFAULT 0,
    "linkedin_replies_received" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "daily_bdr_activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "eod_reports" (
    "id" UUID NOT NULL,
    "campaign_id" UUID,
    "slack_user_id" TEXT NOT NULL,
    "slack_team_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "stats" JSONB NOT NULL,
    "bdr_notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "eod_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "campaigns_slack_team_id_idx" ON "campaigns"("slack_team_id");

-- CreateIndex
CREATE INDEX "campaigns_status_idx" ON "campaigns"("status");

-- CreateIndex
CREATE INDEX "campaigns_created_at_idx" ON "campaigns"("created_at");

-- CreateIndex
CREATE INDEX "campaign_sequence_steps_campaign_id_idx" ON "campaign_sequence_steps"("campaign_id");

-- CreateIndex
CREATE UNIQUE INDEX "campaign_sequence_steps_campaign_id_step_order_key" ON "campaign_sequence_steps"("campaign_id", "step_order");

-- CreateIndex
CREATE INDEX "campaign_contacts_campaign_id_idx" ON "campaign_contacts"("campaign_id");

-- CreateIndex
CREATE INDEX "campaign_contacts_status_idx" ON "campaign_contacts"("status");

-- CreateIndex
CREATE INDEX "campaign_contacts_campaign_id_current_step_index_idx" ON "campaign_contacts"("campaign_id", "current_step_index");

-- CreateIndex
CREATE INDEX "campaign_contacts_campaign_id_status_idx" ON "campaign_contacts"("campaign_id", "status");

-- CreateIndex
CREATE INDEX "campaign_contact_step_executions_campaign_contact_id_idx" ON "campaign_contact_step_executions"("campaign_contact_id");

-- CreateIndex
CREATE INDEX "campaign_contact_step_executions_status_idx" ON "campaign_contact_step_executions"("status");

-- CreateIndex
CREATE INDEX "campaign_contact_step_executions_campaign_contact_id_step_i_idx" ON "campaign_contact_step_executions"("campaign_contact_id", "step_index");

-- CreateIndex
CREATE INDEX "campaign_bdrs_campaign_id_idx" ON "campaign_bdrs"("campaign_id");

-- CreateIndex
CREATE INDEX "campaign_bdrs_slack_user_id_idx" ON "campaign_bdrs"("slack_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "campaign_bdrs_campaign_id_slack_user_id_key" ON "campaign_bdrs"("campaign_id", "slack_user_id");

-- CreateIndex
CREATE INDEX "webhook_events_source_processed_idx" ON "webhook_events"("source", "processed");

-- CreateIndex
CREATE INDEX "webhook_events_contact_email_idx" ON "webhook_events"("contact_email");

-- CreateIndex
CREATE INDEX "webhook_events_campaign_id_idx" ON "webhook_events"("campaign_id");

-- CreateIndex
CREATE INDEX "webhook_events_created_at_idx" ON "webhook_events"("created_at");

-- CreateIndex
CREATE INDEX "unibox_replies_campaign_id_idx" ON "unibox_replies"("campaign_id");

-- CreateIndex
CREATE INDEX "unibox_replies_campaign_contact_id_idx" ON "unibox_replies"("campaign_contact_id");

-- CreateIndex
CREATE INDEX "unibox_replies_is_read_idx" ON "unibox_replies"("is_read");

-- CreateIndex
CREATE INDEX "unibox_replies_received_at_idx" ON "unibox_replies"("received_at");

-- CreateIndex
CREATE INDEX "daily_bdr_activities_slack_user_id_date_idx" ON "daily_bdr_activities"("slack_user_id", "date");

-- CreateIndex
CREATE INDEX "daily_bdr_activities_campaign_id_idx" ON "daily_bdr_activities"("campaign_id");

-- CreateIndex
CREATE UNIQUE INDEX "daily_bdr_activities_campaign_id_slack_user_id_date_key" ON "daily_bdr_activities"("campaign_id", "slack_user_id", "date");

-- CreateIndex
CREATE INDEX "eod_reports_slack_user_id_date_idx" ON "eod_reports"("slack_user_id", "date");

-- CreateIndex
CREATE INDEX "eod_reports_slack_team_id_date_idx" ON "eod_reports"("slack_team_id", "date");

-- AddForeignKey
ALTER TABLE "campaign_sequence_steps" ADD CONSTRAINT "campaign_sequence_steps_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_contacts" ADD CONSTRAINT "campaign_contacts_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_contact_step_executions" ADD CONSTRAINT "campaign_contact_step_executions_campaign_contact_id_fkey" FOREIGN KEY ("campaign_contact_id") REFERENCES "campaign_contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_bdrs" ADD CONSTRAINT "campaign_bdrs_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unibox_replies" ADD CONSTRAINT "unibox_replies_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unibox_replies" ADD CONSTRAINT "unibox_replies_campaign_contact_id_fkey" FOREIGN KEY ("campaign_contact_id") REFERENCES "campaign_contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_bdr_activities" ADD CONSTRAINT "daily_bdr_activities_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "eod_reports" ADD CONSTRAINT "eod_reports_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;
