# Data Model: Platform V2 - Workflow Builder Node Extensions

**Feature Branch**: `9-platform-v2`
**Date**: 2026-03-10
**File**: `prisma/schema.prisma`

---

## New Enums

### Extended WorkflowTriggerType

Add `WEBHOOK` to the existing enum:

```prisma
enum WorkflowTriggerType {
  FILE_UPLOAD
  KEYWORD
  SLASH_COMMAND
  MANUAL
  WEBHOOK        // NEW: External HTTP webhook trigger
}
```

### Extended WorkflowNodeType

Add 3 new node types to the existing enum:

```prisma
enum WorkflowNodeType {
  TRIGGER
  MESSAGE
  BUTTON_CHOICE
  FORM_MODAL
  ENRICHMENT
  CONDITION
  ACTION
  DELAY
  HUBSPOT         // NEW: HubSpot import/sync node
  PARSER          // NEW: Data parse/transform/filter node
  API_CALL        // NEW: Configurable HTTP request node
}
```

### New Enum: WorkflowActionType

Canonical action type enum for the enhanced ACTION node:

```prisma
enum WorkflowActionType {
  // Existing (currently stored as free-form strings in ActionNodeConfig.actionType)
  SEND_MESSAGE
  UPDATE_CONTEXT

  // NEW: Enhanced action blocks (spec 9)
  ASSIGN_TO_CAMPAIGN
  GET_EMAIL
  GET_PHONE
}
```

### New Enum: WebhookEndpointStatus

```prisma
enum WebhookEndpointStatus {
  ACTIVE
  INACTIVE
  REVOKED
}
```

### New Enum: HubSpotSyncMode

```prisma
enum HubSpotSyncMode {
  IMPORT
  SYNC
}
```

---

## New Models

### WebhookEndpoint

Generated webhook URL tied to a workflow's TRIGGER node. Created when a webhook-triggered workflow is published. Deactivated when the workflow is archived.

```prisma
/// A generated webhook URL tied to a workflow template's TRIGGER node.
/// Created on publish, deactivated on archive. Each endpoint has a unique
/// token (for URL routing) and HMAC secret (for payload validation).
model WebhookEndpoint {
  id                 String                @id @default(uuid()) @db.Uuid
  workflowTemplateId String                @map("workflow_template_id") @db.Uuid
  workflowVersionId  String                @map("workflow_version_id") @db.Uuid
  token              String                @unique
  hmacSecret         String                @map("hmac_secret")
  status             WebhookEndpointStatus @default(ACTIVE)
  description        String?               @db.Text
  allowedIps         String[]              @default([]) @map("allowed_ips")
  rateLimitPerMinute Int                   @default(60) @map("rate_limit_per_minute")
  lastCalledAt       DateTime?             @map("last_called_at")
  totalCalls         Int                   @default(0) @map("total_calls")
  createdAt          DateTime              @default(now()) @map("created_at")
  updatedAt          DateTime              @updatedAt @map("updated_at")

  // Relations
  template WorkflowTemplate @relation(fields: [workflowTemplateId], references: [id], onDelete: Cascade)
  version  WorkflowVersion  @relation(fields: [workflowVersionId], references: [id], onDelete: Cascade)
  logs     WebhookLog[]

  @@index([workflowTemplateId])
  @@index([status])
  @@index([token])
  @@map("webhook_endpoints")
}
```

**Required relation additions** to existing models:
- `WorkflowTemplate`: Add `webhookEndpoints WebhookEndpoint[]`
- `WorkflowVersion`: Add `webhookEndpoints WebhookEndpoint[]`

### WebhookLog

Audit log for all incoming webhook requests (both valid and rejected).

```prisma
/// Audit log for incoming webhook requests.
/// Logs both valid and rejected requests for security monitoring.
model WebhookLog {
  id               String    @id @default(uuid()) @db.Uuid
  webhookEndpointId String   @map("webhook_endpoint_id") @db.Uuid
  sourceIp         String    @map("source_ip")
  validated        Boolean   @default(false)
  signatureHeader  String?   @map("signature_header")
  payloadHash      String    @map("payload_hash")
  payloadSizeBytes Int       @map("payload_size_bytes")
  responseStatus   Int       @map("response_status")
  executionId      String?   @map("execution_id") @db.Uuid
  rejectionReason  String?   @map("rejection_reason")
  processingTimeMs Int?      @map("processing_time_ms")
  createdAt        DateTime  @default(now()) @map("created_at")

  // Relations
  webhookEndpoint WebhookEndpoint   @relation(fields: [webhookEndpointId], references: [id], onDelete: Cascade)
  execution       WorkflowExecution? @relation(fields: [executionId], references: [id], onDelete: SetNull)

  @@index([webhookEndpointId])
  @@index([validated])
  @@index([createdAt])
  @@index([executionId])
  @@map("webhook_logs")
}
```

**Required relation addition** to existing model:
- `WorkflowExecution`: Add `webhookLogs WebhookLog[]`

---

## Extended Models

### WorkflowExecution (extended)

Add `nodeProgress` JSONB field for real-time batch progress tracking:

```prisma
model WorkflowExecution {
  // ... existing fields ...

  /// Per-node batch progress tracking. Stored as JSONB map of nodeId -> NodeProgress.
  /// Updated during batch operations (HUBSPOT sync, ENRICHMENT, API_CALL batches).
  nodeProgress   Json?               @map("node_progress") @db.JsonB

  /// Source identifier for webhook-triggered executions.
  /// Stores the webhook endpoint token that initiated this execution.
  webhookToken   String?             @map("webhook_token")

  // NEW Relations
  webhookLogs    WebhookLog[]
}
```

The `nodeProgress` JSONB field stores:

```typescript
interface ExecutionNodeProgress {
  [nodeId: string]: {
    nodeType: string;
    label?: string;
    status: 'pending' | 'running' | 'completed' | 'failed';
    total: number;
    processed: number;
    succeeded: number;
    failed: number;
    skipped: number;
    startedAt?: string;
    completedAt?: string;
    lastUpdatedAt: string;
    errorSample?: string[];
  };
}
```

### WorkflowTemplate (extended)

Add relation to webhook endpoints:

```prisma
model WorkflowTemplate {
  // ... existing fields ...

  // NEW Relations
  webhookEndpoints WebhookEndpoint[]
}
```

### WorkflowVersion (extended)

Add relation to webhook endpoints:

```prisma
model WorkflowVersion {
  // ... existing fields ...

  // NEW Relations
  webhookEndpoints WebhookEndpoint[]
}
```

---

## TypeScript Type Extensions

### New Node Config Types

Add to `src/services/workflow/types.ts`:

```typescript
/** Webhook trigger type extension for TriggerNodeConfig. */
// TriggerNodeConfig.triggerType union gets 'webhook' added:
// triggerType: 'file_upload' | 'keyword' | 'slash_command' | 'manual' | 'webhook';

/** HubSpot node configuration. */
export interface HubSpotNodeConfig {
  type: 'HUBSPOT';
  mode: 'import' | 'sync';

  // Import mode fields
  listId?: string;
  importProperties?: string[];

  // Sync mode fields
  syncMatchFields?: Array<'email' | 'domain' | 'company_name'>;
  fuzzyThreshold?: number;       // 0-100, default 85
  createNewRecords?: boolean;    // default true
  updateExisting?: boolean;      // default true
  fieldMapping?: Array<{
    source: string;              // field from workflow context
    target: string;              // HubSpot property name
    transform?: string;          // optional transform function
  }>;

  // Common
  clientId?: string;             // ManagedClient ID for multi-tenant HubSpot
  outputVariable?: string;
}

/** Parser node configuration. */
export interface ParserNodeConfig {
  type: 'PARSER';
  parseMode: 'json' | 'csv';

  // JSON mode
  jsonRootPath?: string;         // e.g., "data.contacts"

  // CSV mode
  csvDelimiter?: string;         // default ","
  csvHasHeaders?: boolean;       // default true

  // Field mapping
  fieldMappings?: Array<{
    sourceField: string;
    targetField: string;
    transform?: string;          // transform function name
    transformArgs?: string[];
  }>;

  // Transformation rules
  transformations?: Array<{
    field: string;
    function: string;            // e.g., "properCase", "normalizeDomain"
    args?: string[];
  }>;

  // Filter criteria
  filters?: Array<{
    field: string;
    operator: string;            // reuses EdgeCondition operators + extensions
    value?: string | number | boolean;
    logic?: 'AND' | 'OR';       // default AND
  }>;

  inputVariable?: string;        // context variable with raw data
  outputVariable?: string;       // context variable for parsed output
}

/** API Call node configuration. */
export interface ApiCallNodeConfig {
  type: 'API_CALL';
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  url: string;                   // supports {{variable}} interpolation
  headers?: Record<string, string>;
  bodyTemplate?: string;         // JSON string with {{variable}} interpolation
  authType?: 'none' | 'api_key' | 'bearer' | 'hmac';
  authConfig?: {
    headerName?: string;         // for api_key auth
    token?: string;              // for bearer auth
    secret?: string;             // for hmac auth
  };

  // Response handling
  responseMapping?: Array<{
    responsePath: string;        // e.g., "data.contacts[].email"
    contextVariable: string;     // variable name in workflow context
  }>;
  responseSchema?: Array<{       // auto-discovered after test execution
    path: string;
    type: string;
    isArray: boolean;
    sampleValue?: unknown;
  }>;

  // Retry config
  maxRetries?: number;           // default 3
  retryDelayMs?: number;         // default 1000 (exponential backoff base)
  timeoutMs?: number;            // default 30000

  outputVariable?: string;
}
```

### Updated NodeConfig Union

```typescript
export type NodeConfig =
  | TriggerNodeConfig
  | MessageNodeConfig
  | ButtonChoiceNodeConfig
  | FormModalNodeConfig
  | EnrichmentNodeConfig
  | ConditionNodeConfig
  | ActionNodeConfig
  | DelayNodeConfig
  | HubSpotNodeConfig      // NEW
  | ParserNodeConfig        // NEW
  | ApiCallNodeConfig;      // NEW
```

---

## Migration Plan

### Migration: `add_webhook_endpoints`

```sql
-- Add WEBHOOK to WorkflowTriggerType enum
ALTER TYPE "WorkflowTriggerType" ADD VALUE 'WEBHOOK';

-- Add HUBSPOT, PARSER, API_CALL to WorkflowNodeType enum
ALTER TYPE "WorkflowNodeType" ADD VALUE 'HUBSPOT';
ALTER TYPE "WorkflowNodeType" ADD VALUE 'PARSER';
ALTER TYPE "WorkflowNodeType" ADD VALUE 'API_CALL';

-- Create WebhookEndpointStatus enum
CREATE TYPE "WebhookEndpointStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'REVOKED');

-- Create webhook_endpoints table
CREATE TABLE "webhook_endpoints" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workflow_template_id" UUID NOT NULL,
  "workflow_version_id" UUID NOT NULL,
  "token" TEXT NOT NULL,
  "hmac_secret" TEXT NOT NULL,
  "status" "WebhookEndpointStatus" NOT NULL DEFAULT 'ACTIVE',
  "description" TEXT,
  "allowed_ips" TEXT[] DEFAULT '{}',
  "rate_limit_per_minute" INTEGER NOT NULL DEFAULT 60,
  "last_called_at" TIMESTAMP(3),
  "total_calls" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "webhook_endpoints_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "webhook_endpoints_token_key" UNIQUE ("token")
);

-- Create webhook_logs table
CREATE TABLE "webhook_logs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "webhook_endpoint_id" UUID NOT NULL,
  "source_ip" TEXT NOT NULL,
  "validated" BOOLEAN NOT NULL DEFAULT false,
  "signature_header" TEXT,
  "payload_hash" TEXT NOT NULL,
  "payload_size_bytes" INTEGER NOT NULL,
  "response_status" INTEGER NOT NULL,
  "execution_id" UUID,
  "rejection_reason" TEXT,
  "processing_time_ms" INTEGER,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "webhook_logs_pkey" PRIMARY KEY ("id")
);

-- Add nodeProgress and webhookToken to workflow_executions
ALTER TABLE "workflow_executions" ADD COLUMN "node_progress" JSONB;
ALTER TABLE "workflow_executions" ADD COLUMN "webhook_token" TEXT;

-- Create indexes
CREATE INDEX "webhook_endpoints_workflow_template_id_idx" ON "webhook_endpoints"("workflow_template_id");
CREATE INDEX "webhook_endpoints_status_idx" ON "webhook_endpoints"("status");
CREATE INDEX "webhook_endpoints_token_idx" ON "webhook_endpoints"("token");
CREATE INDEX "webhook_logs_webhook_endpoint_id_idx" ON "webhook_logs"("webhook_endpoint_id");
CREATE INDEX "webhook_logs_validated_idx" ON "webhook_logs"("validated");
CREATE INDEX "webhook_logs_created_at_idx" ON "webhook_logs"("created_at");
CREATE INDEX "webhook_logs_execution_id_idx" ON "webhook_logs"("execution_id");

-- Add foreign keys
ALTER TABLE "webhook_endpoints"
  ADD CONSTRAINT "webhook_endpoints_workflow_template_id_fkey"
  FOREIGN KEY ("workflow_template_id") REFERENCES "workflow_templates"("id")
  ON DELETE CASCADE;

ALTER TABLE "webhook_endpoints"
  ADD CONSTRAINT "webhook_endpoints_workflow_version_id_fkey"
  FOREIGN KEY ("workflow_version_id") REFERENCES "workflow_versions"("id")
  ON DELETE CASCADE;

ALTER TABLE "webhook_logs"
  ADD CONSTRAINT "webhook_logs_webhook_endpoint_id_fkey"
  FOREIGN KEY ("webhook_endpoint_id") REFERENCES "webhook_endpoints"("id")
  ON DELETE CASCADE;

ALTER TABLE "webhook_logs"
  ADD CONSTRAINT "webhook_logs_execution_id_fkey"
  FOREIGN KEY ("execution_id") REFERENCES "workflow_executions"("id")
  ON DELETE SET NULL;
```

---

## Entity Relationship Summary

```
WorkflowTemplate (existing)
  |-- 1:N --> WorkflowVersion (existing)
  |             |-- 1:N --> WorkflowExecution (existing, extended with nodeProgress)
  |             |             |-- 1:N --> WebhookLog (NEW)
  |             |-- 1:N --> WebhookEndpoint (NEW)
  |-- 1:N --> WebhookEndpoint (NEW)
                  |-- 1:N --> WebhookLog (NEW)
```

The new node types (HUBSPOT, PARSER, API_CALL) do not require their own database tables. Their configuration is stored in the workflow graph JSONB (`WorkflowVersion.graph`) and their runtime state is stored in the execution context JSONB (`WorkflowExecution.context` and `WorkflowExecution.nodeProgress`).
