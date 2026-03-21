-- CreateEnum
CREATE TYPE "CrmType" AS ENUM ('HUBSPOT', 'ATTIO', 'SALESFORCE');

-- CreateEnum
CREATE TYPE "CrmConnectionStatus" AS ENUM ('ACTIVE', 'DISCONNECTED', 'TOKEN_EXPIRED', 'ERROR');

-- CreateEnum
CREATE TYPE "CrmPushStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED');

-- CreateEnum
CREATE TYPE "SyncDirection" AS ENUM ('TO_CRM', 'FROM_CRM', 'BIDIRECTIONAL');

-- CreateTable
CREATE TABLE "canonical_contacts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" TEXT NOT NULL,
    "first_name" TEXT,
    "last_name" TEXT,
    "job_title" TEXT,
    "company" TEXT,
    "domain" TEXT,
    "phone" TEXT,
    "mobile_phone" TEXT,
    "linkedin_url" TEXT,
    "city" TEXT,
    "state" TEXT,
    "country" TEXT,
    "enrichment_source" TEXT,
    "enrichment_date" TIMESTAMP(3),
    "tech_spend_tier" TEXT,
    "enrichment_job_id" UUID,
    "job_contact_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "canonical_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "canonical_accounts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "domain" TEXT NOT NULL,
    "company_name" TEXT,
    "industry" TEXT,
    "employee_count" INTEGER,
    "annual_revenue" DOUBLE PRECISION,
    "city" TEXT,
    "state" TEXT,
    "country" TEXT,
    "technologies" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "cloud_provider" TEXT,
    "traffic_rank" INTEGER,
    "tech_spend_tier" TEXT,
    "job_company_id" UUID,
    "enrichment_job_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "canonical_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_connections" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "client_id" UUID NOT NULL,
    "crm_type" "CrmType" NOT NULL,
    "status" "CrmConnectionStatus" NOT NULL DEFAULT 'ACTIVE',
    "display_name" TEXT,
    "hubspot_connection_id" UUID,
    "adapter_config" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_field_mappings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "crm_connection_id" UUID NOT NULL,
    "canonical_field" TEXT NOT NULL,
    "crm_property" TEXT NOT NULL,
    "crm_property_label" TEXT,
    "data_type" TEXT NOT NULL DEFAULT 'string',
    "transform_rule" TEXT,
    "is_required" BOOLEAN NOT NULL DEFAULT false,
    "sync_direction" "SyncDirection" NOT NULL DEFAULT 'TO_CRM',
    "overwrite_existing" BOOLEAN NOT NULL DEFAULT true,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_field_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_push_records" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "crm_connection_id" UUID NOT NULL,
    "canonical_contact_id" UUID,
    "canonical_account_id" UUID,
    "crm_record_id" TEXT,
    "push_status" "CrmPushStatus" NOT NULL DEFAULT 'PENDING',
    "last_pushed_at" TIMESTAMP(3),
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_push_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "canonical_contacts_email_key" ON "canonical_contacts"("email");
CREATE INDEX "canonical_contacts_domain_idx" ON "canonical_contacts"("domain");
CREATE INDEX "canonical_contacts_enrichment_job_id_idx" ON "canonical_contacts"("enrichment_job_id");

-- CreateIndex
CREATE UNIQUE INDEX "canonical_accounts_domain_key" ON "canonical_accounts"("domain");
CREATE INDEX "canonical_accounts_company_name_idx" ON "canonical_accounts"("company_name");
CREATE INDEX "canonical_accounts_enrichment_job_id_idx" ON "canonical_accounts"("enrichment_job_id");

-- CreateIndex
CREATE UNIQUE INDEX "crm_connections_hubspot_connection_id_key" ON "crm_connections"("hubspot_connection_id");
CREATE UNIQUE INDEX "crm_connections_client_id_crm_type_key" ON "crm_connections"("client_id", "crm_type");
CREATE INDEX "crm_connections_crm_type_idx" ON "crm_connections"("crm_type");

-- CreateIndex
CREATE UNIQUE INDEX "crm_field_mappings_crm_connection_id_canonical_field_key" ON "crm_field_mappings"("crm_connection_id", "canonical_field");
CREATE INDEX "crm_field_mappings_crm_connection_id_idx" ON "crm_field_mappings"("crm_connection_id");

-- CreateIndex
CREATE UNIQUE INDEX "crm_push_records_crm_connection_id_canonical_contact_id_key" ON "crm_push_records"("crm_connection_id", "canonical_contact_id");
CREATE UNIQUE INDEX "crm_push_records_crm_connection_id_canonical_account_id_key" ON "crm_push_records"("crm_connection_id", "canonical_account_id");
CREATE INDEX "crm_push_records_push_status_idx" ON "crm_push_records"("push_status");
CREATE INDEX "crm_push_records_last_pushed_at_idx" ON "crm_push_records"("last_pushed_at");

-- AddForeignKey
ALTER TABLE "canonical_contacts" ADD CONSTRAINT "canonical_contacts_domain_fkey" FOREIGN KEY ("domain") REFERENCES "canonical_accounts"("domain") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_connections" ADD CONSTRAINT "crm_connections_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "managed_clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "crm_connections" ADD CONSTRAINT "crm_connections_hubspot_connection_id_fkey" FOREIGN KEY ("hubspot_connection_id") REFERENCES "hubspot_connections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_field_mappings" ADD CONSTRAINT "crm_field_mappings_crm_connection_id_fkey" FOREIGN KEY ("crm_connection_id") REFERENCES "crm_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_push_records" ADD CONSTRAINT "crm_push_records_crm_connection_id_fkey" FOREIGN KEY ("crm_connection_id") REFERENCES "crm_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "crm_push_records" ADD CONSTRAINT "crm_push_records_canonical_contact_id_fkey" FOREIGN KEY ("canonical_contact_id") REFERENCES "canonical_contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "crm_push_records" ADD CONSTRAINT "crm_push_records_canonical_account_id_fkey" FOREIGN KEY ("canonical_account_id") REFERENCES "canonical_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
