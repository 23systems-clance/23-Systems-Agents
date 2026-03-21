-- CreateEnum
CREATE TYPE "ErrorCategory" AS ENUM ('API_ERROR', 'QUEUE_ERROR', 'FILE_PROCESSING_ERROR', 'SLACK_ERROR', 'SYSTEM_ERROR');

-- CreateEnum
CREATE TYPE "ErrorLifecycleState" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED');

-- CreateEnum
CREATE TYPE "ReportType" AS ENUM ('COST_SUMMARY', 'USAGE_BREAKDOWN', 'CLIENT_REPORT', 'ERROR_SUMMARY');

-- CreateEnum
CREATE TYPE "ReportFrequency" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY');

-- CreateTable
CREATE TABLE "admin_users" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "api_key_hash" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admin_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "error_logs" (
    "id" UUID NOT NULL,
    "category" "ErrorCategory" NOT NULL,
    "service" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "stack_trace" TEXT,
    "job_id" UUID,
    "slack_user_id" TEXT,
    "slack_channel_id" TEXT,
    "slack_team_id" TEXT,
    "metadata" JSONB,
    "lifecycle_state" "ErrorLifecycleState" NOT NULL DEFAULT 'OPEN',
    "acknowledged_by" UUID,
    "acknowledged_at" TIMESTAMP(3),
    "resolved_by" UUID,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "error_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "budget_thresholds" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "threshold_amount_usd" DECIMAL(65,30) NOT NULL,
    "provider_scope" "ApiService",
    "slack_channel_id" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_triggered_at" TIMESTAMP(3),
    "last_triggered_month" TEXT,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "budget_thresholds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scheduled_reports" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "report_type" "ReportType" NOT NULL,
    "frequency" "ReportFrequency" NOT NULL,
    "slack_channel_id" TEXT NOT NULL,
    "filters" JSONB,
    "bullmq_job_key" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_run_at" TIMESTAMP(3),
    "last_error" TEXT,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scheduled_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_aggregates" (
    "id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "service" "ApiService" NOT NULL,
    "slack_team_id" TEXT NOT NULL,
    "total_requests" INTEGER NOT NULL DEFAULT 0,
    "total_cost_usd" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "total_tokens_input" INTEGER NOT NULL DEFAULT 0,
    "total_tokens_output" INTEGER NOT NULL DEFAULT 0,
    "total_credits_consumed" DECIMAL(65,30) NOT NULL DEFAULT 0,
    "error_count" INTEGER NOT NULL DEFAULT 0,
    "avg_duration_ms" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "daily_aggregates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "retention_configs" (
    "id" UUID NOT NULL,
    "data_type" TEXT NOT NULL,
    "retention_days" INTEGER NOT NULL,
    "last_purged_at" TIMESTAMP(3),
    "updated_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "retention_configs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "admin_users_email_key" ON "admin_users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "admin_users_api_key_hash_key" ON "admin_users"("api_key_hash");

-- CreateIndex
CREATE INDEX "error_logs_category_idx" ON "error_logs"("category");

-- CreateIndex
CREATE INDEX "error_logs_service_idx" ON "error_logs"("service");

-- CreateIndex
CREATE INDEX "error_logs_lifecycle_state_idx" ON "error_logs"("lifecycle_state");

-- CreateIndex
CREATE INDEX "error_logs_job_id_idx" ON "error_logs"("job_id");

-- CreateIndex
CREATE INDEX "error_logs_slack_team_id_idx" ON "error_logs"("slack_team_id");

-- CreateIndex
CREATE INDEX "error_logs_created_at_idx" ON "error_logs"("created_at");

-- CreateIndex
CREATE INDEX "budget_thresholds_is_active_idx" ON "budget_thresholds"("is_active");

-- CreateIndex
CREATE INDEX "budget_thresholds_provider_scope_idx" ON "budget_thresholds"("provider_scope");

-- CreateIndex
CREATE INDEX "budget_thresholds_created_by_idx" ON "budget_thresholds"("created_by");

-- CreateIndex
CREATE INDEX "scheduled_reports_is_active_idx" ON "scheduled_reports"("is_active");

-- CreateIndex
CREATE INDEX "scheduled_reports_frequency_idx" ON "scheduled_reports"("frequency");

-- CreateIndex
CREATE INDEX "scheduled_reports_created_by_idx" ON "scheduled_reports"("created_by");

-- CreateIndex
CREATE INDEX "daily_aggregates_date_idx" ON "daily_aggregates"("date");

-- CreateIndex
CREATE INDEX "daily_aggregates_service_idx" ON "daily_aggregates"("service");

-- CreateIndex
CREATE INDEX "daily_aggregates_slack_team_id_idx" ON "daily_aggregates"("slack_team_id");

-- CreateIndex
CREATE UNIQUE INDEX "daily_aggregates_date_service_slack_team_id_key" ON "daily_aggregates"("date", "service", "slack_team_id");

-- CreateIndex
CREATE UNIQUE INDEX "retention_configs_data_type_key" ON "retention_configs"("data_type");

-- CreateIndex
CREATE INDEX "jobs_slack_team_id_idx" ON "jobs"("slack_team_id");

-- AddForeignKey
ALTER TABLE "error_logs" ADD CONSTRAINT "error_logs_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "error_logs" ADD CONSTRAINT "error_logs_acknowledged_by_fkey" FOREIGN KEY ("acknowledged_by") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "error_logs" ADD CONSTRAINT "error_logs_resolved_by_fkey" FOREIGN KEY ("resolved_by") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_thresholds" ADD CONSTRAINT "budget_thresholds_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "admin_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scheduled_reports" ADD CONSTRAINT "scheduled_reports_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "admin_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "retention_configs" ADD CONSTRAINT "retention_configs_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
