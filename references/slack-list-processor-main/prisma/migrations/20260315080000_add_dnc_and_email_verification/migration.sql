-- Feature 27: DNC scrub + US6 Email verification quality gates

-- Add new enum values to Provider
ALTER TYPE "Provider" ADD VALUE IF NOT EXISTS 'FINDYMAIL';

-- Add new enum value to JobStatus
ALTER TYPE "JobStatus" ADD VALUE IF NOT EXISTS 'AWAITING_EMAIL_VERIFICATION';
ALTER TYPE "JobStatus" ADD VALUE IF NOT EXISTS 'AWAITING_DNC_DECISION';

-- Create CallStatus enum
DO $$ BEGIN
  CREATE TYPE "CallStatus" AS ENUM ('ACCEPTED_STATE', 'DO_NOT_CALL', 'UNKNOWN');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Create DncStatus enum
DO $$ BEGIN
  CREATE TYPE "DncStatus" AS ENUM ('NOT_CHECKED', 'CLEAN', 'ON_DNC_LIST');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Extend jobs table
ALTER TABLE "jobs" ADD COLUMN IF NOT EXISTS "email_verification_choice" TEXT;
ALTER TABLE "jobs" ADD COLUMN IF NOT EXISTS "emails_verified" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "jobs" ADD COLUMN IF NOT EXISTS "emails_unverified" INTEGER NOT NULL DEFAULT 0;

-- Extend job_contacts table
ALTER TABLE "job_contacts" ADD COLUMN IF NOT EXISTS "call_status" "CallStatus";
ALTER TABLE "job_contacts" ADD COLUMN IF NOT EXISTS "dnc_status" "DncStatus";
ALTER TABLE "job_contacts" ADD COLUMN IF NOT EXISTS "email_verified" BOOLEAN;
ALTER TABLE "job_contacts" ADD COLUMN IF NOT EXISTS "email_provider" TEXT;
ALTER TABLE "job_contacts" ADD COLUMN IF NOT EXISTS "verification_cost" DOUBLE PRECISION;
