-- AlterTable: Add nullable client_id FK to workflow_templates
ALTER TABLE "workflow_templates" ADD COLUMN "client_id" UUID;

-- AddForeignKey
ALTER TABLE "workflow_templates" ADD CONSTRAINT "workflow_templates_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "managed_clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "workflow_templates_client_id_idx" ON "workflow_templates"("client_id");

-- CreateIndex
CREATE INDEX "workflow_templates_slack_team_id_trigger_type_client_id_idx" ON "workflow_templates"("slack_team_id", "trigger_type", "client_id");

-- CreateTable
CREATE TABLE "workflow_channel_mappings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "template_id" UUID NOT NULL,
    "slack_channel_id" TEXT NOT NULL,
    "slack_team_id" TEXT NOT NULL,
    "trigger_type" "WorkflowTriggerType" NOT NULL,
    "created_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workflow_channel_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "workflow_channel_mappings_template_id_idx" ON "workflow_channel_mappings"("template_id");

-- CreateIndex
CREATE INDEX "workflow_channel_mappings_slack_team_id_slack_channel_id_idx" ON "workflow_channel_mappings"("slack_team_id", "slack_channel_id");

-- CreateIndex (unique constraint)
CREATE UNIQUE INDEX "workflow_channel_mappings_slack_team_id_slack_channel_id_trig_key" ON "workflow_channel_mappings"("slack_team_id", "slack_channel_id", "trigger_type");

-- AddForeignKey
ALTER TABLE "workflow_channel_mappings" ADD CONSTRAINT "workflow_channel_mappings_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "workflow_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
