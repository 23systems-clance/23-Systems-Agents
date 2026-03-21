-- CreateEnum
CREATE TYPE "BillingStatus" AS ENUM ('PENDING', 'ACTIVE', 'SUSPENDED', 'DELINQUENT');

-- CreateEnum
CREATE TYPE "CreditTransactionType" AS ENUM ('MONTHLY_ALLOCATION', 'ENRICHMENT_DEDUCTION', 'OVERAGE_CHARGE', 'MANUAL_ADJUSTMENT', 'ROLLOVER_RESET');

-- AlterTable
ALTER TABLE "jobs" ADD COLUMN     "credit_rate_snapshot" JSONB;

-- CreateTable
CREATE TABLE "billing_profiles" (
    "id" UUID NOT NULL,
    "slack_team_id" TEXT NOT NULL,
    "status" "BillingStatus" NOT NULL DEFAULT 'PENDING',
    "billing_exempt" BOOLEAN NOT NULL DEFAULT false,
    "monthly_allowance" INTEGER NOT NULL,
    "credit_balance" INTEGER NOT NULL DEFAULT 0,
    "max_rollover_credits" INTEGER NOT NULL,
    "overage_rate_usd" DECIMAL(65,30) NOT NULL,
    "billing_cycle_day" INTEGER NOT NULL,
    "last_reset_at" TIMESTAMP(3),
    "billing_contact_user_id" TEXT,
    "billing_email" TEXT,
    "stripe_customer_id" TEXT,
    "stripe_payment_method_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "billing_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_transactions" (
    "id" UUID NOT NULL,
    "billing_profile_id" UUID NOT NULL,
    "type" "CreditTransactionType" NOT NULL,
    "amount" INTEGER NOT NULL,
    "balance_after" INTEGER NOT NULL,
    "reference_id" TEXT,
    "description" TEXT NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "credit_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_rate_configs" (
    "id" UUID NOT NULL,
    "builtwith_ctu_lookup_cost" INTEGER NOT NULL,
    "builtwith_domain_lookup_cost" INTEGER NOT NULL,
    "apollo_people_search_cost" INTEGER NOT NULL,
    "apollo_bulk_enrich_cost" INTEGER NOT NULL,
    "markup_percent" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "updated_by_admin_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "credit_rate_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "magic_links" (
    "id" UUID NOT NULL,
    "billing_profile_id" UUID NOT NULL,
    "token" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "magic_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "billing_profiles_slack_team_id_key" ON "billing_profiles"("slack_team_id");

-- CreateIndex
CREATE UNIQUE INDEX "billing_profiles_stripe_customer_id_key" ON "billing_profiles"("stripe_customer_id");

-- CreateIndex
CREATE INDEX "billing_profiles_status_idx" ON "billing_profiles"("status");

-- CreateIndex
CREATE INDEX "billing_profiles_billing_cycle_day_idx" ON "billing_profiles"("billing_cycle_day");

-- CreateIndex
CREATE INDEX "credit_transactions_billing_profile_id_idx" ON "credit_transactions"("billing_profile_id");

-- CreateIndex
CREATE INDEX "credit_transactions_type_idx" ON "credit_transactions"("type");

-- CreateIndex
CREATE INDEX "credit_transactions_created_at_idx" ON "credit_transactions"("created_at");

-- CreateIndex
CREATE INDEX "credit_transactions_reference_id_idx" ON "credit_transactions"("reference_id");

-- CreateIndex
CREATE INDEX "credit_rate_configs_is_active_idx" ON "credit_rate_configs"("is_active");

-- CreateIndex
CREATE UNIQUE INDEX "magic_links_token_key" ON "magic_links"("token");

-- CreateIndex
CREATE INDEX "magic_links_billing_profile_id_idx" ON "magic_links"("billing_profile_id");

-- CreateIndex
CREATE INDEX "magic_links_token_idx" ON "magic_links"("token");

-- CreateIndex
CREATE INDEX "magic_links_expires_at_idx" ON "magic_links"("expires_at");

-- AddForeignKey
ALTER TABLE "credit_transactions" ADD CONSTRAINT "credit_transactions_billing_profile_id_fkey" FOREIGN KEY ("billing_profile_id") REFERENCES "billing_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "magic_links" ADD CONSTRAINT "magic_links_billing_profile_id_fkey" FOREIGN KEY ("billing_profile_id") REFERENCES "billing_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Seed default CreditRateConfig
INSERT INTO "credit_rate_configs" ("id", "builtwith_ctu_lookup_cost", "builtwith_domain_lookup_cost", "apollo_people_search_cost", "apollo_bulk_enrich_cost", "markup_percent", "is_active", "created_at", "updated_at")
VALUES (gen_random_uuid(), 10, 5, 3, 2, 25, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
