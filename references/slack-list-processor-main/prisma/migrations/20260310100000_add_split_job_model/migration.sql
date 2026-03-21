-- CreateEnum
CREATE TYPE "SplitJobStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "SplitMode" AS ENUM ('HALF', 'QUARTERS', 'BY_COLUMN', 'CUSTOM');

-- CreateTable
CREATE TABLE "split_jobs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "slack_channel_id" TEXT NOT NULL,
    "slack_thread_ts" TEXT NOT NULL,
    "slack_user_id" TEXT NOT NULL,
    "slack_team_id" TEXT NOT NULL,
    "status" "SplitJobStatus" NOT NULL DEFAULT 'PENDING',
    "source_file_name" TEXT,
    "source_file_type" "SourceFileType",
    "source_row_count" INTEGER,
    "split_mode" "SplitMode" NOT NULL,
    "split_column" TEXT,
    "split_count" INTEGER NOT NULL,
    "client_name" TEXT,
    "campaign_name" TEXT,
    "result_file_urls" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "result_file_names" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "result_file_counts" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "error_message" TEXT,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "split_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "split_jobs_slack_channel_id_idx" ON "split_jobs"("slack_channel_id");

-- CreateIndex
CREATE INDEX "split_jobs_slack_user_id_idx" ON "split_jobs"("slack_user_id");

-- CreateIndex
CREATE INDEX "split_jobs_status_idx" ON "split_jobs"("status");
