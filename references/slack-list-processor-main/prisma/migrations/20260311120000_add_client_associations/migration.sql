-- Add slackTeamId to ManagedClient (required FK to WorkspaceInstallation)
-- Step 1: Add as NULLABLE first (idempotent — skip if column exists)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'managed_clients' AND column_name = 'slack_team_id'
  ) THEN
    ALTER TABLE "managed_clients" ADD COLUMN "slack_team_id" TEXT;
  END IF;
END $$;

-- Step 2: Backfill existing clients with the first workspace's teamId if available
UPDATE "managed_clients"
SET "slack_team_id" = (
  SELECT "slack_team_id" FROM "workspace_installations"
  LIMIT 1
)
WHERE "slack_team_id" IS NULL
  AND EXISTS (SELECT 1 FROM "workspace_installations");

-- Step 3: Column stays NULLABLE — workspace_installations may be empty

-- Step 4: Add FK constraint (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'managed_clients_slack_team_id_fkey'
  ) THEN
    ALTER TABLE "managed_clients" ADD CONSTRAINT "managed_clients_slack_team_id_fkey"
      FOREIGN KEY ("slack_team_id") REFERENCES "workspace_installations"("slack_team_id")
      ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- Step 5: Add index (idempotent)
CREATE INDEX IF NOT EXISTS "managed_clients_slack_team_id_idx" ON "managed_clients"("slack_team_id");

-- Add optional clientId to jobs (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'jobs' AND column_name = 'client_id'
  ) THEN
    ALTER TABLE "jobs" ADD COLUMN "client_id" UUID;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'jobs_client_id_fkey'
  ) THEN
    ALTER TABLE "jobs" ADD CONSTRAINT "jobs_client_id_fkey"
      FOREIGN KEY ("client_id") REFERENCES "managed_clients"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "jobs_client_id_idx" ON "jobs"("client_id");

-- Add optional clientId to credit_transactions (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'credit_transactions' AND column_name = 'client_id'
  ) THEN
    ALTER TABLE "credit_transactions" ADD COLUMN "client_id" UUID;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'credit_transactions_client_id_fkey'
  ) THEN
    ALTER TABLE "credit_transactions" ADD CONSTRAINT "credit_transactions_client_id_fkey"
      FOREIGN KEY ("client_id") REFERENCES "managed_clients"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "credit_transactions_client_id_idx" ON "credit_transactions"("client_id");
