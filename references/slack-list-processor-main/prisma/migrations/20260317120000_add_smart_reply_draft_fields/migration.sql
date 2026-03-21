-- CreateEnum
CREATE TYPE "SmartReplyDraftStatus" AS ENUM ('GENERATING', 'READY', 'SENT', 'REJECTED', 'FAILED');

-- AlterTable: UniboxReply - add smart reply draft fields
ALTER TABLE "unibox_replies" ADD COLUMN "draft_body" TEXT;
ALTER TABLE "unibox_replies" ADD COLUMN "draft_status" "SmartReplyDraftStatus";
ALTER TABLE "unibox_replies" ADD COLUMN "draft_intent" TEXT;
ALTER TABLE "unibox_replies" ADD COLUMN "draft_generated_at" TIMESTAMP(3);
ALTER TABLE "unibox_replies" ADD COLUMN "draft_tokens_used" INTEGER;
ALTER TABLE "unibox_replies" ADD COLUMN "draft_cost_usd" DECIMAL(10,6);
ALTER TABLE "unibox_replies" ADD COLUMN "draft_error" TEXT;

-- AlterTable: CampaignContact - add personality enrichment fields
ALTER TABLE "campaign_contacts" ADD COLUMN "personality_data" JSONB;
ALTER TABLE "campaign_contacts" ADD COLUMN "personality_enriched_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "unibox_replies_draft_status_idx" ON "unibox_replies"("draft_status");
