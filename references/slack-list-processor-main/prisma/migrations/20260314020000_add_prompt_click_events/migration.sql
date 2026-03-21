-- Feature 23: Dynamic Suggested Prompts
-- Migration: Add PromptClickEvent model for analytics

-- CreateEnum
CREATE TYPE "PromptContextType" AS ENUM ('DEFAULT', 'CHANNEL', 'ACTIVITY', 'WORKSPACE');

-- CreateTable
CREATE TABLE "prompt_click_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" TEXT NOT NULL,
    "team_id" TEXT NOT NULL,
    "channel_id" TEXT,
    "thread_ts" TEXT NOT NULL,
    "prompt_title" TEXT NOT NULL,
    "prompt_position" INTEGER NOT NULL,
    "context_type" "PromptContextType" NOT NULL,
    "metadata" JSONB,
    "clicked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prompt_click_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "prompt_click_events_team_id_user_id_clicked_at_idx" ON "prompt_click_events"("team_id", "user_id", "clicked_at");

-- CreateIndex
CREATE INDEX "prompt_click_events_clicked_at_idx" ON "prompt_click_events"("clicked_at");

-- CreateIndex
CREATE INDEX "prompt_click_events_prompt_title_clicked_at_idx" ON "prompt_click_events"("prompt_title", "clicked_at");

-- CreateIndex
CREATE INDEX "prompt_click_events_context_type_clicked_at_idx" ON "prompt_click_events"("context_type", "clicked_at");

-- AddForeignKey
ALTER TABLE "prompt_click_events" ADD CONSTRAINT "prompt_click_events_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "workspace_installations"("slack_team_id") ON DELETE CASCADE ON UPDATE CASCADE;
