-- Platform V2: Node Extensions (Spec 9)
-- Adds WEBHOOK trigger, HUBSPOT/PARSER/API_CALL node types,
-- WebhookEndpoint + WebhookLog models, execution progress tracking.

-- Add new values to WorkflowTriggerType enum
ALTER TYPE "WorkflowTriggerType" ADD VALUE IF NOT EXISTS 'WEBHOOK';

-- Add new values to WorkflowNodeType enum
ALTER TYPE "WorkflowNodeType" ADD VALUE IF NOT EXISTS 'HUBSPOT';
ALTER TYPE "WorkflowNodeType" ADD VALUE IF NOT EXISTS 'PARSER';
ALTER TYPE "WorkflowNodeType" ADD VALUE IF NOT EXISTS 'API_CALL';

-- Create WebhookEndpointStatus enum
DO $$ BEGIN
  CREATE TYPE "WebhookEndpointStatus" AS ENUM ('ACTIVE', 'INACTIVE');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Create WebhookEndpoint table
CREATE TABLE IF NOT EXISTS "WebhookEndpoint" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "templateId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "hmacSecret" TEXT NOT NULL,
    "description" TEXT,
    "status" "WebhookEndpointStatus" NOT NULL DEFAULT 'ACTIVE',
    "totalCalls" INTEGER NOT NULL DEFAULT 0,
    "lastCalledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WebhookEndpoint_pkey" PRIMARY KEY ("id")
);

-- Create WebhookLog table
CREATE TABLE IF NOT EXISTS "WebhookLog" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "endpointId" TEXT NOT NULL,
    "sourceIp" TEXT NOT NULL,
    "validated" BOOLEAN NOT NULL DEFAULT false,
    "payloadHash" TEXT NOT NULL,
    "responseStatus" INTEGER NOT NULL,
    "executionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookLog_pkey" PRIMARY KEY ("id")
);

-- Add nodeProgress and webhookToken columns to WorkflowExecution
ALTER TABLE "WorkflowExecution" ADD COLUMN IF NOT EXISTS "nodeProgress" JSONB;
ALTER TABLE "WorkflowExecution" ADD COLUMN IF NOT EXISTS "webhookToken" TEXT;

-- Create unique index on WebhookEndpoint token
CREATE UNIQUE INDEX IF NOT EXISTS "WebhookEndpoint_token_key" ON "WebhookEndpoint"("token");

-- Create index on WebhookEndpoint templateId + status
CREATE INDEX IF NOT EXISTS "WebhookEndpoint_templateId_status_idx" ON "WebhookEndpoint"("templateId", "status");

-- Create index on WebhookLog endpointId
CREATE INDEX IF NOT EXISTS "WebhookLog_endpointId_idx" ON "WebhookLog"("endpointId");

-- Create index on WebhookLog executionId
CREATE INDEX IF NOT EXISTS "WebhookLog_executionId_idx" ON "WebhookLog"("executionId");

-- Add foreign key constraints
ALTER TABLE "WebhookEndpoint" ADD CONSTRAINT "WebhookEndpoint_templateId_fkey"
  FOREIGN KEY ("templateId") REFERENCES "WorkflowTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WebhookEndpoint" ADD CONSTRAINT "WebhookEndpoint_versionId_fkey"
  FOREIGN KEY ("versionId") REFERENCES "WorkflowVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WebhookLog" ADD CONSTRAINT "WebhookLog_endpointId_fkey"
  FOREIGN KEY ("endpointId") REFERENCES "WebhookEndpoint"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "WebhookLog" ADD CONSTRAINT "WebhookLog_executionId_fkey"
  FOREIGN KEY ("executionId") REFERENCES "WorkflowExecution"("id") ON DELETE SET NULL ON UPDATE CASCADE;
