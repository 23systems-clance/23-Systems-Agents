-- AlterTable
ALTER TABLE "campaigns" ADD COLUMN     "client_id" UUID;

-- CreateTable
CREATE TABLE "managed_clients" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "instantly_api_key" TEXT,
    "heyreach_api_key" TEXT,
    "hubspot_api_key" TEXT,
    "hubspot_portal_id" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "managed_clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bdrs" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "slack_user_id" TEXT NOT NULL,
    "slack_team_id" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bdrs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bdr_clients" (
    "id" UUID NOT NULL,
    "bdr_id" UUID NOT NULL,
    "client_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bdr_clients_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "managed_clients_slug_key" ON "managed_clients"("slug");

-- CreateIndex
CREATE INDEX "managed_clients_is_active_idx" ON "managed_clients"("is_active");

-- CreateIndex
CREATE INDEX "bdrs_slack_user_id_idx" ON "bdrs"("slack_user_id");

-- CreateIndex
CREATE INDEX "bdrs_is_active_idx" ON "bdrs"("is_active");

-- CreateIndex
CREATE UNIQUE INDEX "bdrs_slack_user_id_slack_team_id_key" ON "bdrs"("slack_user_id", "slack_team_id");

-- CreateIndex
CREATE INDEX "bdr_clients_bdr_id_idx" ON "bdr_clients"("bdr_id");

-- CreateIndex
CREATE INDEX "bdr_clients_client_id_idx" ON "bdr_clients"("client_id");

-- CreateIndex
CREATE UNIQUE INDEX "bdr_clients_bdr_id_client_id_key" ON "bdr_clients"("bdr_id", "client_id");

-- CreateIndex
CREATE INDEX "campaigns_client_id_idx" ON "campaigns"("client_id");

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "managed_clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bdr_clients" ADD CONSTRAINT "bdr_clients_bdr_id_fkey" FOREIGN KEY ("bdr_id") REFERENCES "bdrs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bdr_clients" ADD CONSTRAINT "bdr_clients_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "managed_clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
