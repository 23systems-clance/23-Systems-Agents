-- CreateEnum
CREATE TYPE "JobType" AS ENUM ('TECHNOGRAPHIC', 'CONTACT', 'COMBINED', 'TECH_REPORT');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('PENDING', 'PROCESSING', 'AWAITING_PHONES', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "PersonaType" AS ENUM ('IT_LEADER', 'ENGINEERING_LEADER', 'FINANCE_LEADER', 'SALES_LEADER', 'FOUNDER_OWNER', 'CEO', 'OPERATIONS_LEADER', 'HR_LEADER', 'CUSTOMER_SUCCESS_LEADER', 'MARKETING_LEADER', 'PRODUCT_LEADER', 'COMPLIANCE_LEADER', 'RESEARCH_LEADER', 'NON_LEADER');

-- CreateEnum
CREATE TYPE "TechSpendTier" AS ENUM ('TIER_1', 'TIER_2', 'TIER_3', 'UNCLASSIFIED');

-- CreateEnum
CREATE TYPE "SourceFileType" AS ENUM ('CSV', 'XLSX');

-- CreateEnum
CREATE TYPE "ListPurpose" AS ENUM ('COLD_CALLING', 'EMAILING', 'JUST_A_LIST', 'LINKEDIN');

-- CreateEnum
CREATE TYPE "ApiService" AS ENUM ('BUILTWITH', 'APOLLO', 'AI_ORCHESTRATOR');

-- CreateEnum
CREATE TYPE "EnrichmentStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "ContactEnrichmentStatus" AS ENUM ('PENDING', 'ENRICHED', 'PHONE_PENDING', 'COMPLETE', 'FAILED');

-- CreateEnum
CREATE TYPE "PhoneLookupStatus" AS ENUM ('PENDING', 'RECEIVED', 'TIMED_OUT');

-- CreateTable
CREATE TABLE "jobs" (
    "id" UUID NOT NULL,
    "slack_channel_id" TEXT NOT NULL,
    "slack_thread_ts" TEXT NOT NULL,
    "slack_user_id" TEXT NOT NULL,
    "slack_team_id" TEXT NOT NULL,
    "job_type" "JobType" NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "source_file_name" TEXT,
    "source_file_url" TEXT,
    "source_file_type" "SourceFileType",
    "source_row_count" INTEGER,
    "result_file_url" TEXT,
    "result_file_name" TEXT,
    "purpose" "ListPurpose",
    "is_cosell" BOOLEAN NOT NULL DEFAULT false,
    "cosell_provider" TEXT,
    "list_owner" TEXT,
    "additional_context" TEXT,
    "enrich_instruction" TEXT,
    "parsed_intent" JSONB,
    "error_message" TEXT,
    "companies_processed" INTEGER NOT NULL DEFAULT 0,
    "companies_failed" INTEGER NOT NULL DEFAULT 0,
    "contacts_found" INTEGER NOT NULL DEFAULT 0,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_companies" (
    "id" UUID NOT NULL,
    "job_id" UUID NOT NULL,
    "row_index" INTEGER NOT NULL,
    "domain" TEXT,
    "company_name" TEXT,
    "resolved_domain" TEXT,
    "location_country" TEXT,
    "location_state" TEXT,
    "location_city" TEXT,
    "traffic_rank" INTEGER,
    "cloud_provider_primary" TEXT,
    "cloud_providers_all" TEXT,
    "tech_spend_tier" "TechSpendTier",
    "tech_spend_score" INTEGER,
    "technology_count" INTEGER NOT NULL DEFAULT 0,
    "enterprise_tech_count" INTEGER NOT NULL DEFAULT 0,
    "enrichment_status" "EnrichmentStatus" NOT NULL DEFAULT 'PENDING',
    "error_message" TEXT,
    "raw_builtwith_response" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "job_companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_technologies" (
    "id" UUID NOT NULL,
    "job_company_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "tag" TEXT,
    "categories" TEXT[],
    "first_detected" TIMESTAMP(3),
    "last_detected" TIMESTAMP(3),
    "is_enterprise" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "company_technologies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "job_contacts" (
    "id" UUID NOT NULL,
    "job_id" UUID NOT NULL,
    "job_company_id" UUID NOT NULL,
    "full_name" TEXT,
    "first_name" TEXT,
    "last_name" TEXT,
    "email" TEXT,
    "direct_phone" TEXT,
    "business_phone" TEXT,
    "job_title" TEXT,
    "persona_type" "PersonaType" NOT NULL,
    "seniority_level" TEXT,
    "linkedin_url" TEXT,
    "apollo_person_id" TEXT,
    "is_decision_maker" BOOLEAN NOT NULL DEFAULT true,
    "timezone_utc" TEXT,
    "timezone_label" TEXT,
    "enrichment_status" "ContactEnrichmentStatus" NOT NULL DEFAULT 'PENDING',
    "phone_received_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "job_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pending_phone_lookups" (
    "id" UUID NOT NULL,
    "job_id" UUID NOT NULL,
    "job_contact_id" UUID NOT NULL,
    "apollo_request_id" TEXT NOT NULL,
    "status" "PhoneLookupStatus" NOT NULL DEFAULT 'PENDING',
    "phone_data" JSONB,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "received_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pending_phone_lookups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tech_report_caches" (
    "id" UUID NOT NULL,
    "query_hash" TEXT NOT NULL,
    "technology" TEXT NOT NULL,
    "country" TEXT,
    "state_region" TEXT,
    "company_size" TEXT,
    "traffic_level" TEXT,
    "result_count" INTEGER NOT NULL,
    "result_file_url" TEXT NOT NULL,
    "requested_by_user_id" TEXT NOT NULL,
    "requested_in_channel" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tech_report_caches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tech_report_cache_entries" (
    "id" UUID NOT NULL,
    "cache_id" UUID NOT NULL,
    "domain" TEXT NOT NULL,
    "company_name" TEXT,
    "country" TEXT,
    "state_region" TEXT,
    "city" TEXT,
    "traffic_rank" INTEGER,
    "technology_detected" TEXT NOT NULL,

    CONSTRAINT "tech_report_cache_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_usage_logs" (
    "id" UUID NOT NULL,
    "job_id" UUID NOT NULL,
    "service" "ApiService" NOT NULL,
    "endpoint" TEXT NOT NULL,
    "request_count" INTEGER NOT NULL DEFAULT 1,
    "credits_consumed" DECIMAL(65,30),
    "tokens_input" INTEGER,
    "tokens_output" INTEGER,
    "estimated_cost_usd" DECIMAL(65,30),
    "response_status" INTEGER,
    "duration_ms" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "api_usage_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "actor_user_id" TEXT NOT NULL,
    "actor_team_id" TEXT,
    "target_type" TEXT,
    "target_id" TEXT,
    "channel_id" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "jobs_slack_channel_id_idx" ON "jobs"("slack_channel_id");

-- CreateIndex
CREATE INDEX "jobs_slack_user_id_idx" ON "jobs"("slack_user_id");

-- CreateIndex
CREATE INDEX "jobs_status_idx" ON "jobs"("status");

-- CreateIndex
CREATE INDEX "jobs_job_type_idx" ON "jobs"("job_type");

-- CreateIndex
CREATE INDEX "jobs_created_at_idx" ON "jobs"("created_at");

-- CreateIndex
CREATE INDEX "job_companies_job_id_idx" ON "job_companies"("job_id");

-- CreateIndex
CREATE INDEX "job_companies_domain_idx" ON "job_companies"("domain");

-- CreateIndex
CREATE INDEX "job_companies_enrichment_status_idx" ON "job_companies"("enrichment_status");

-- CreateIndex
CREATE UNIQUE INDEX "job_companies_job_id_row_index_key" ON "job_companies"("job_id", "row_index");

-- CreateIndex
CREATE INDEX "company_technologies_job_company_id_idx" ON "company_technologies"("job_company_id");

-- CreateIndex
CREATE INDEX "company_technologies_name_idx" ON "company_technologies"("name");

-- CreateIndex
CREATE INDEX "job_contacts_job_id_idx" ON "job_contacts"("job_id");

-- CreateIndex
CREATE INDEX "job_contacts_job_company_id_idx" ON "job_contacts"("job_company_id");

-- CreateIndex
CREATE INDEX "job_contacts_persona_type_idx" ON "job_contacts"("persona_type");

-- CreateIndex
CREATE INDEX "job_contacts_enrichment_status_idx" ON "job_contacts"("enrichment_status");

-- CreateIndex
CREATE UNIQUE INDEX "pending_phone_lookups_apollo_request_id_key" ON "pending_phone_lookups"("apollo_request_id");

-- CreateIndex
CREATE INDEX "pending_phone_lookups_job_id_idx" ON "pending_phone_lookups"("job_id");

-- CreateIndex
CREATE INDEX "pending_phone_lookups_status_idx" ON "pending_phone_lookups"("status");

-- CreateIndex
CREATE UNIQUE INDEX "tech_report_caches_query_hash_key" ON "tech_report_caches"("query_hash");

-- CreateIndex
CREATE INDEX "tech_report_caches_technology_idx" ON "tech_report_caches"("technology");

-- CreateIndex
CREATE INDEX "tech_report_caches_created_at_idx" ON "tech_report_caches"("created_at");

-- CreateIndex
CREATE INDEX "tech_report_cache_entries_cache_id_idx" ON "tech_report_cache_entries"("cache_id");

-- CreateIndex
CREATE INDEX "tech_report_cache_entries_domain_idx" ON "tech_report_cache_entries"("domain");

-- CreateIndex
CREATE INDEX "api_usage_logs_job_id_idx" ON "api_usage_logs"("job_id");

-- CreateIndex
CREATE INDEX "api_usage_logs_service_idx" ON "api_usage_logs"("service");

-- CreateIndex
CREATE INDEX "api_usage_logs_created_at_idx" ON "api_usage_logs"("created_at");

-- AddForeignKey
ALTER TABLE "job_companies" ADD CONSTRAINT "job_companies_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_technologies" ADD CONSTRAINT "company_technologies_job_company_id_fkey" FOREIGN KEY ("job_company_id") REFERENCES "job_companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_contacts" ADD CONSTRAINT "job_contacts_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "job_contacts" ADD CONSTRAINT "job_contacts_job_company_id_fkey" FOREIGN KEY ("job_company_id") REFERENCES "job_companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pending_phone_lookups" ADD CONSTRAINT "pending_phone_lookups_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pending_phone_lookups" ADD CONSTRAINT "pending_phone_lookups_job_contact_id_fkey" FOREIGN KEY ("job_contact_id") REFERENCES "job_contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tech_report_cache_entries" ADD CONSTRAINT "tech_report_cache_entries_cache_id_fkey" FOREIGN KEY ("cache_id") REFERENCES "tech_report_caches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "api_usage_logs" ADD CONSTRAINT "api_usage_logs_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
