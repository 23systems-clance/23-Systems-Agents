-- Feature 27: Multi-Provider Waterfall Enrichment
-- Migration created: 2026-03-14

-- Add enums
CREATE TYPE "Provider" AS ENUM ('APOLLO', 'WIZA', 'AI_ARK');
CREATE TYPE "DataType" AS ENUM ('EMAIL', 'PHONE');
CREATE TYPE "AttemptStatus" AS ENUM ('SUCCESS', 'FAILED', 'SKIPPED', 'TIMEOUT', 'NO_DATA');
CREATE TYPE "WebhookStatus" AS ENUM ('RECEIVED', 'PROCESSING', 'PROCESSED', 'FAILED');
CREATE TYPE "EnrichmentMode" AS ENUM ('EMAIL_ONLY', 'PHONE_ONLY', 'ALL');

-- Extend Job table
ALTER TABLE "jobs" ADD COLUMN "enrichment_mode" "EnrichmentMode";
ALTER TABLE "jobs" ADD COLUMN "providers_used" TEXT[] DEFAULT '{}';
ALTER TABLE "jobs" ADD COLUMN "total_cost" DOUBLE PRECISION DEFAULT 0;

-- Extend JobContact table
ALTER TABLE "job_contacts" ADD COLUMN "email_source" "Provider";
ALTER TABLE "job_contacts" ADD COLUMN "email_cost" DOUBLE PRECISION;
ALTER TABLE "job_contacts" ADD COLUMN "phone_source" "Provider";
ALTER TABLE "job_contacts" ADD COLUMN "phone_cost" DOUBLE PRECISION;
ALTER TABLE "job_contacts" ADD COLUMN "enrichment_attempts" INTEGER DEFAULT 0;

-- Create ProviderAttempt table
CREATE TABLE "provider_attempts" (
  "id" UUID PRIMARY KEY,
  "job_id" UUID NOT NULL,
  "contact_id" UUID NOT NULL,
  "provider" "Provider" NOT NULL,
  "data_type" "DataType" NOT NULL,
  "status" "AttemptStatus" NOT NULL,
  "request_id" TEXT,
  "request_payload" JSONB,
  "response_payload" JSONB,
  "cost" DOUBLE PRECISION,
  "credits_consumed" INTEGER,
  "email_found" TEXT,
  "phone_found" TEXT,
  "error_message" TEXT,
  "http_status" INTEGER,
  "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMP(3),
  "duration_ms" INTEGER,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "provider_attempts_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE,
  CONSTRAINT "provider_attempts_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "job_contacts"("id") ON DELETE CASCADE
);

CREATE INDEX "provider_attempts_job_id_idx" ON "provider_attempts"("job_id");
CREATE INDEX "provider_attempts_contact_id_idx" ON "provider_attempts"("contact_id");
CREATE INDEX "provider_attempts_provider_data_type_idx" ON "provider_attempts"("provider", "data_type");
CREATE INDEX "provider_attempts_request_id_idx" ON "provider_attempts"("request_id");

-- Create ProviderWebhook table
CREATE TABLE "provider_webhooks" (
  "id" UUID PRIMARY KEY,
  "job_id" UUID NOT NULL,
  "provider" "Provider" NOT NULL,
  "request_id" TEXT NOT NULL,
  "webhook_id" TEXT NOT NULL UNIQUE,
  "raw_payload" JSONB NOT NULL,
  "event_type" TEXT,
  "status" "WebhookStatus" NOT NULL,
  "processed_at" TIMESTAMP(3),
  "retries_attempted" INTEGER DEFAULT 0,
  "last_retry_at" TIMESTAMP(3),
  "error_message" TEXT,
  "signature_verified" BOOLEAN DEFAULT false,
  "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "provider_webhooks_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE
);

CREATE INDEX "provider_webhooks_job_id_idx" ON "provider_webhooks"("job_id");
CREATE INDEX "provider_webhooks_provider_request_id_idx" ON "provider_webhooks"("provider", "request_id");
CREATE INDEX "provider_webhooks_webhook_id_idx" ON "provider_webhooks"("webhook_id");

-- Create ProviderCost table
CREATE TABLE "provider_costs" (
  "id" UUID PRIMARY KEY,
  "provider" "Provider" NOT NULL,
  "data_type" "DataType" NOT NULL,
  "cost_per_unit" DOUBLE PRECISION NOT NULL,
  "credits_per_unit" INTEGER,
  "effective_date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMP(3),
  "notes" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "provider_costs_provider_data_type_effective_date_key" UNIQUE ("provider", "data_type", "effective_date")
);

CREATE INDEX "provider_costs_provider_data_type_idx" ON "provider_costs"("provider", "data_type");

-- Seed ProviderCost with current pricing
INSERT INTO "provider_costs" ("id", "provider", "data_type", "cost_per_unit", "credits_per_unit", "notes") VALUES
  (gen_random_uuid(), 'APOLLO', 'EMAIL', 0.05, NULL, 'Existing Apollo email pricing'),
  (gen_random_uuid(), 'WIZA', 'EMAIL', 0.05, 2, 'Corrected pricing: 2 credits × $0.025 = $0.05'),
  (gen_random_uuid(), 'WIZA', 'PHONE', 0.125, 5, 'Corrected pricing: 5 credits × $0.025 = $0.125'),
  (gen_random_uuid(), 'AI_ARK', 'EMAIL', 0.14, NULL, 'Estimate - confirm with AI Ark sales'),
  (gen_random_uuid(), 'AI_ARK', 'PHONE', 0.27, NULL, 'Estimate - confirm with AI Ark sales');
