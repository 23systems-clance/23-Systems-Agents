-- AlterEnum (idempotent — value may already exist from prior migration)
ALTER TYPE "WebhookSource" ADD VALUE IF NOT EXISTS 'HUBSPOT';
