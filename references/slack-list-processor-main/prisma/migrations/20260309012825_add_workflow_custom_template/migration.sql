-- CreateTable
CREATE TABLE "workflow_custom_templates" (
    "id" UUID NOT NULL,
    "slack_team_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "graph" JSONB NOT NULL,
    "node_count" INTEGER NOT NULL DEFAULT 0,
    "created_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workflow_custom_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "workflow_custom_templates_slack_team_id_idx" ON "workflow_custom_templates"("slack_team_id");
