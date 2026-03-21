-- AlterTable
ALTER TABLE "channel_config_docs" ADD COLUMN "display_label" TEXT,
ADD COLUMN "s3_key" TEXT,
ADD COLUMN "original_mime_type" TEXT,
ADD COLUMN "content_size_bytes" INTEGER;

-- CreateTable
CREATE TABLE "channel_client_mappings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "slack_team_id" TEXT NOT NULL,
    "slack_channel_id" TEXT NOT NULL,
    "client_id" UUID NOT NULL,
    "created_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "channel_client_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "channel_client_mappings_client_id_idx" ON "channel_client_mappings"("client_id");

-- CreateIndex
CREATE UNIQUE INDEX "channel_client_mappings_slack_team_id_slack_channel_id_key" ON "channel_client_mappings"("slack_team_id", "slack_channel_id");

-- AddForeignKey
ALTER TABLE "channel_client_mappings" ADD CONSTRAINT "channel_client_mappings_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "managed_clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
