-- CreateEnum
CREATE TYPE "PromptCategory" AS ENUM ('CLASSIFIER', 'PARSER', 'GENERATOR');

-- CreateEnum
CREATE TYPE "PromptVersionStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateTable
CREATE TABLE "prompts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "slug" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "description" TEXT,
    "category" "PromptCategory" NOT NULL,
    "model_config" JSONB NOT NULL,
    "tool_definitions" JSONB,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "prompts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prompt_versions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "prompt_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "status" "PromptVersionStatus" NOT NULL,
    "published_by" TEXT,
    "published_at" TIMESTAMP(3),
    "change_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prompt_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prompt_variables" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "description" TEXT,
    "default_value" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "prompt_variables_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prompt_variable_mappings" (
    "prompt_id" UUID NOT NULL,
    "variable_id" UUID NOT NULL,

    CONSTRAINT "prompt_variable_mappings_pkey" PRIMARY KEY ("prompt_id","variable_id")
);

-- CreateTable
CREATE TABLE "workspace_prompt_overrides" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" TEXT NOT NULL,
    "variable_id" UUID NOT NULL,
    "override_value" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workspace_prompt_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prompt_test_runs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "prompt_version_id" UUID NOT NULL,
    "input_text" TEXT NOT NULL,
    "output_result" JSONB NOT NULL,
    "tokens_used" INTEGER NOT NULL,
    "input_tokens" INTEGER NOT NULL,
    "output_tokens" INTEGER NOT NULL,
    "estimated_cost_usd" DECIMAL(10,6) NOT NULL,
    "duration_ms" INTEGER NOT NULL,
    "tested_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prompt_test_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "prompts_slug_key" ON "prompts"("slug");

-- CreateIndex
CREATE INDEX "prompts_category_idx" ON "prompts"("category");

-- CreateIndex
CREATE INDEX "prompts_is_active_idx" ON "prompts"("is_active");

-- CreateIndex
CREATE UNIQUE INDEX "prompt_versions_prompt_id_version_key" ON "prompt_versions"("prompt_id", "version");

-- CreateIndex
CREATE INDEX "prompt_versions_prompt_id_status_idx" ON "prompt_versions"("prompt_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "prompt_variables_name_key" ON "prompt_variables"("name");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_prompt_overrides_workspace_id_variable_id_key" ON "workspace_prompt_overrides"("workspace_id", "variable_id");

-- CreateIndex
CREATE INDEX "workspace_prompt_overrides_workspace_id_idx" ON "workspace_prompt_overrides"("workspace_id");

-- CreateIndex
CREATE INDEX "prompt_test_runs_prompt_version_id_idx" ON "prompt_test_runs"("prompt_version_id");

-- CreateIndex
CREATE INDEX "prompt_test_runs_created_at_idx" ON "prompt_test_runs"("created_at");

-- AddForeignKey
ALTER TABLE "prompt_versions" ADD CONSTRAINT "prompt_versions_prompt_id_fkey" FOREIGN KEY ("prompt_id") REFERENCES "prompts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prompt_variable_mappings" ADD CONSTRAINT "prompt_variable_mappings_prompt_id_fkey" FOREIGN KEY ("prompt_id") REFERENCES "prompts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prompt_variable_mappings" ADD CONSTRAINT "prompt_variable_mappings_variable_id_fkey" FOREIGN KEY ("variable_id") REFERENCES "prompt_variables"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_prompt_overrides" ADD CONSTRAINT "workspace_prompt_overrides_variable_id_fkey" FOREIGN KEY ("variable_id") REFERENCES "prompt_variables"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prompt_test_runs" ADD CONSTRAINT "prompt_test_runs_prompt_version_id_fkey" FOREIGN KEY ("prompt_version_id") REFERENCES "prompt_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
