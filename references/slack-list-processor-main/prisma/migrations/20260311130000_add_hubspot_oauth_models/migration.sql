-- CreateEnum
CREATE TYPE "HubSpotConnectionStatus" AS ENUM ('ACTIVE', 'DISCONNECTED', 'TOKEN_EXPIRED', 'ERROR');

-- CreateEnum
CREATE TYPE "HubSpotImportStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "HubSpotSyncType" AS ENUM ('CONTACT_IMPORT', 'ACTIVITY_PUSH', 'ACTIVITY_PULL', 'WEBHOOK_EVENT');

-- CreateTable
CREATE TABLE "hubspot_connections" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id" UUID NOT NULL,
    "access_token" TEXT NOT NULL,
    "refresh_token" TEXT NOT NULL,
    "token_expires_at" TIMESTAMP(3) NOT NULL,
    "hubspot_portal_id" TEXT NOT NULL,
    "hubspot_portal_name" TEXT,
    "granted_scopes" TEXT[],
    "status" "HubSpotConnectionStatus" NOT NULL DEFAULT 'ACTIVE',
    "connected_by" TEXT NOT NULL,
    "connected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "disconnected_at" TIMESTAMP(3),
    "last_refreshed_at" TIMESTAMP(3),
    "properties_created" BOOLEAN NOT NULL DEFAULT false,
    "last_sync_at" TIMESTAMP(3),
    "total_contacts_synced" INTEGER NOT NULL DEFAULT 0,
    "total_activities_logged" INTEGER NOT NULL DEFAULT 0,
    "total_sync_failures" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hubspot_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hubspot_import_jobs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "connection_id" UUID NOT NULL,
    "source_file_name" TEXT NOT NULL,
    "source_file_url" TEXT,
    "source_row_count" INTEGER NOT NULL,
    "enrichment_job_id" UUID,
    "client_name" TEXT NOT NULL,
    "campaign_name" TEXT NOT NULL,
    "list_name" TEXT NOT NULL,
    "hubspot_list_id" TEXT,
    "hubspot_list_url" TEXT,
    "column_mapping" JSONB NOT NULL,
    "contacts_created" INTEGER NOT NULL DEFAULT 0,
    "contacts_updated" INTEGER NOT NULL DEFAULT 0,
    "contacts_failed" INTEGER NOT NULL DEFAULT 0,
    "contacts_total" INTEGER NOT NULL DEFAULT 0,
    "status" "HubSpotImportStatus" NOT NULL DEFAULT 'PENDING',
    "error_message" TEXT,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "slack_channel_id" TEXT NOT NULL,
    "slack_thread_ts" TEXT,
    "slack_user_id" TEXT NOT NULL,
    "bullmq_job_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hubspot_import_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hubspot_contact_mappings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "connection_id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "hubspot_contact_id" TEXT NOT NULL,
    "hubspot_company_id" TEXT,
    "last_synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "import_job_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hubspot_contact_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hubspot_engagement_mappings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "connection_id" UUID NOT NULL,
    "event_type" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "event_source" TEXT NOT NULL,
    "hubspot_engagement_id" TEXT NOT NULL,
    "hubspot_contact_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hubspot_engagement_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hubspot_sync_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "connection_id" UUID NOT NULL,
    "syncType" "HubSpotSyncType" NOT NULL,
    "direction" TEXT NOT NULL DEFAULT 'push',
    "records_processed" INTEGER NOT NULL DEFAULT 0,
    "records_created" INTEGER NOT NULL DEFAULT 0,
    "records_updated" INTEGER NOT NULL DEFAULT 0,
    "records_failed" INTEGER NOT NULL DEFAULT 0,
    "duration_ms" INTEGER,
    "error_message" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hubspot_sync_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "hubspot_connections_client_id_key" ON "hubspot_connections"("client_id");

-- CreateIndex
CREATE INDEX "hubspot_connections_status_idx" ON "hubspot_connections"("status");

-- CreateIndex
CREATE INDEX "hubspot_import_jobs_connection_id_idx" ON "hubspot_import_jobs"("connection_id");

-- CreateIndex
CREATE INDEX "hubspot_import_jobs_status_idx" ON "hubspot_import_jobs"("status");

-- CreateIndex
CREATE INDEX "hubspot_import_jobs_slack_channel_id_idx" ON "hubspot_import_jobs"("slack_channel_id");

-- CreateIndex
CREATE UNIQUE INDEX "hubspot_contact_mappings_connection_id_email_key" ON "hubspot_contact_mappings"("connection_id", "email");

-- CreateIndex
CREATE INDEX "hubspot_contact_mappings_hubspot_contact_id_idx" ON "hubspot_contact_mappings"("hubspot_contact_id");

-- CreateIndex
CREATE UNIQUE INDEX "hubspot_engagement_mappings_connection_id_event_type_event_i_key" ON "hubspot_engagement_mappings"("connection_id", "event_type", "event_id", "event_source");

-- CreateIndex
CREATE INDEX "hubspot_engagement_mappings_hubspot_contact_id_idx" ON "hubspot_engagement_mappings"("hubspot_contact_id");

-- CreateIndex
CREATE INDEX "hubspot_sync_logs_connection_id_idx" ON "hubspot_sync_logs"("connection_id");

-- CreateIndex
CREATE INDEX "hubspot_sync_logs_syncType_idx" ON "hubspot_sync_logs"("syncType");

-- CreateIndex
CREATE INDEX "hubspot_sync_logs_created_at_idx" ON "hubspot_sync_logs"("created_at");

-- AddForeignKey
ALTER TABLE "hubspot_connections" ADD CONSTRAINT "hubspot_connections_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "managed_clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hubspot_import_jobs" ADD CONSTRAINT "hubspot_import_jobs_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "hubspot_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hubspot_contact_mappings" ADD CONSTRAINT "hubspot_contact_mappings_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "hubspot_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hubspot_engagement_mappings" ADD CONSTRAINT "hubspot_engagement_mappings_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "hubspot_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hubspot_sync_logs" ADD CONSTRAINT "hubspot_sync_logs_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "hubspot_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;
