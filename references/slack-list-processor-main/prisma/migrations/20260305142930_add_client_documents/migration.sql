-- CreateEnum
CREATE TYPE "ConfigDocType" AS ENUM ('ICP', 'USE_CASES', 'CAMPAIGNS', 'SETTINGS');

-- CreateEnum
CREATE TYPE "FilterJobStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('ICP', 'USE_CASE', 'SETTINGS', 'ONE_PAGER', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('PROCESSING', 'ACTIVE', 'FAILED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "AnalysisJobStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- AlterEnum
ALTER TYPE "ListPurpose" ADD VALUE 'ALL';

-- AlterTable
ALTER TABLE "jobs" ADD COLUMN     "document_slugs" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "settings_overrides" JSONB;

-- CreateTable
CREATE TABLE "channel_config_docs" (
    "id" UUID NOT NULL,
    "slack_team_id" TEXT NOT NULL,
    "slack_channel_id" TEXT NOT NULL,
    "doc_type" "ConfigDocType" NOT NULL,
    "content" TEXT NOT NULL,
    "uploaded_by_user_id" TEXT NOT NULL,
    "original_file_name" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "channel_config_docs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "filter_jobs" (
    "id" UUID NOT NULL,
    "slack_channel_id" TEXT NOT NULL,
    "slack_thread_ts" TEXT NOT NULL,
    "slack_user_id" TEXT NOT NULL,
    "slack_team_id" TEXT NOT NULL,
    "status" "FilterJobStatus" NOT NULL DEFAULT 'PENDING',
    "source_file_name" TEXT,
    "source_file_type" "SourceFileType",
    "source_row_count" INTEGER,
    "result_row_count" INTEGER,
    "filter_criteria" JSONB,
    "filter_mode" TEXT,
    "result_file_url" TEXT,
    "result_file_name" TEXT,
    "error_message" TEXT,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "filter_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analysis_jobs" (
    "id" UUID NOT NULL,
    "slack_channel_id" TEXT NOT NULL,
    "slack_thread_ts" TEXT NOT NULL,
    "slack_user_id" TEXT NOT NULL,
    "slack_team_id" TEXT NOT NULL,
    "status" "AnalysisJobStatus" NOT NULL DEFAULT 'PENDING',
    "source_job_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "source_file_names" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "company_count" INTEGER,
    "contact_count" INTEGER,
    "has_icp" BOOLEAN NOT NULL DEFAULT false,
    "has_use_cases" BOOLEAN NOT NULL DEFAULT false,
    "has_campaigns" BOOLEAN NOT NULL DEFAULT false,
    "has_settings" BOOLEAN NOT NULL DEFAULT false,
    "top_opportunity_count" INTEGER,
    "result_pdf_url" TEXT,
    "result_pdf_file_name" TEXT,
    "summary_json" JSONB,
    "error_message" TEXT,
    "bullmq_job_id" TEXT,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "analysis_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_documents" (
    "id" UUID NOT NULL,
    "slack_team_id" TEXT NOT NULL,
    "slack_channel_id" TEXT NOT NULL,
    "slack_user_id" TEXT NOT NULL,
    "slack_file_id" TEXT,
    "slug" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "summary" TEXT,
    "document_type" "DocumentType" NOT NULL,
    "status" "DocumentStatus" NOT NULL DEFAULT 'PROCESSING',
    "version" INTEGER NOT NULL DEFAULT 1,
    "s3_key" TEXT NOT NULL,
    "original_file_name" TEXT NOT NULL,
    "original_mime_type" TEXT NOT NULL,
    "content_size_bytes" INTEGER,
    "error_message" TEXT,
    "slack_thread_ts" TEXT,
    "parsed_settings" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "client_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "docs_channel_configs" (
    "id" UUID NOT NULL,
    "slack_team_id" TEXT NOT NULL,
    "slack_channel_id" TEXT NOT NULL,
    "channel_name" TEXT,
    "registered_by_user_id" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "docs_channel_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analysis_api_usage_logs" (
    "id" UUID NOT NULL,
    "analysis_job_id" UUID NOT NULL,
    "endpoint" TEXT NOT NULL,
    "tokens_input" INTEGER,
    "tokens_output" INTEGER,
    "estimated_cost_usd" DECIMAL(65,30),
    "duration_ms" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "analysis_api_usage_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "channel_config_docs_slack_team_id_slack_channel_id_idx" ON "channel_config_docs"("slack_team_id", "slack_channel_id");

-- CreateIndex
CREATE UNIQUE INDEX "channel_config_docs_slack_team_id_slack_channel_id_doc_type_key" ON "channel_config_docs"("slack_team_id", "slack_channel_id", "doc_type");

-- CreateIndex
CREATE INDEX "filter_jobs_slack_channel_id_idx" ON "filter_jobs"("slack_channel_id");

-- CreateIndex
CREATE INDEX "filter_jobs_slack_user_id_idx" ON "filter_jobs"("slack_user_id");

-- CreateIndex
CREATE INDEX "filter_jobs_status_idx" ON "filter_jobs"("status");

-- CreateIndex
CREATE INDEX "analysis_jobs_slack_channel_id_idx" ON "analysis_jobs"("slack_channel_id");

-- CreateIndex
CREATE INDEX "analysis_jobs_slack_user_id_idx" ON "analysis_jobs"("slack_user_id");

-- CreateIndex
CREATE INDEX "analysis_jobs_status_idx" ON "analysis_jobs"("status");

-- CreateIndex
CREATE INDEX "client_documents_slack_team_id_idx" ON "client_documents"("slack_team_id");

-- CreateIndex
CREATE INDEX "client_documents_slack_team_id_slack_channel_id_idx" ON "client_documents"("slack_team_id", "slack_channel_id");

-- CreateIndex
CREATE INDEX "client_documents_document_type_idx" ON "client_documents"("document_type");

-- CreateIndex
CREATE INDEX "client_documents_status_idx" ON "client_documents"("status");

-- CreateIndex
CREATE INDEX "client_documents_slack_team_id_document_type_idx" ON "client_documents"("slack_team_id", "document_type");

-- CreateIndex
CREATE INDEX "client_documents_slack_team_id_slug_idx" ON "client_documents"("slack_team_id", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "client_documents_slack_team_id_slack_channel_id_slug_key" ON "client_documents"("slack_team_id", "slack_channel_id", "slug");

-- CreateIndex
CREATE INDEX "docs_channel_configs_slack_team_id_is_active_idx" ON "docs_channel_configs"("slack_team_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "docs_channel_configs_slack_team_id_slack_channel_id_key" ON "docs_channel_configs"("slack_team_id", "slack_channel_id");

-- CreateIndex
CREATE INDEX "analysis_api_usage_logs_analysis_job_id_idx" ON "analysis_api_usage_logs"("analysis_job_id");

-- AddForeignKey
ALTER TABLE "analysis_api_usage_logs" ADD CONSTRAINT "analysis_api_usage_logs_analysis_job_id_fkey" FOREIGN KEY ("analysis_job_id") REFERENCES "analysis_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
