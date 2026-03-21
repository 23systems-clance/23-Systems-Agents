-- Add clientId column to channel_config_docs (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'channel_config_docs' AND column_name = 'client_id'
  ) THEN
    ALTER TABLE "channel_config_docs" ADD COLUMN "client_id" UUID;
  END IF;
END $$;

-- Backfill clientId from ChannelClientMapping for existing documents
UPDATE "channel_config_docs" AS ccd
SET "client_id" = ccm."client_id"
FROM "channel_client_mappings" AS ccm
WHERE ccd."slack_team_id" = ccm."slack_team_id"
  AND ccd."slack_channel_id" = ccm."slack_channel_id"
  AND ccd."client_id" IS NULL;

-- Add FK constraint (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'channel_config_docs_client_id_fkey'
  ) THEN
    ALTER TABLE "channel_config_docs" ADD CONSTRAINT "channel_config_docs_client_id_fkey"
      FOREIGN KEY ("client_id") REFERENCES "managed_clients"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- Add index for query performance (idempotent)
CREATE INDEX IF NOT EXISTS "channel_config_docs_client_id_idx" ON "channel_config_docs"("client_id");
