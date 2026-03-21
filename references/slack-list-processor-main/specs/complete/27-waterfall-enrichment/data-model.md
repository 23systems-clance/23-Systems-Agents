# Data Model: Multi-Provider Waterfall Enrichment

**Feature**: 27-waterfall-enrichment
**Date**: 2026-03-14
**Phase**: Phase 1 (Design)

## Summary

Data model for tracking provider attempts, cost attribution, and webhook processing across Apollo, Wiza, and AI Ark enrichment providers. Extends existing Prisma schema with provider-specific tables while maintaining compatibility with current Job and JobContact models.

---

## Entity Relationship Diagram

```
┌─────────────┐           ┌──────────────────┐
│    Job      │──────1:N──│  JobContact      │
│             │           │                  │
│ - id        │           │ - id             │
│ - purpose   │           │ - email          │
│ - status    │     ┌─────│ - directPhone    │
└─────────────┘     │     │ - businessPhone  │
                    │     │ - emailSource    │
                    │     │ - phoneSource    │
                    │     └──────────────────┘
                    │              │
                    │              │
                    │              │1:N
                    │              │
                    │     ┌────────▼──────────┐
                    │     │ ProviderAttempt   │
                    │     │                   │
                    │     │ - id              │
                    │     │ - provider        │
                    │     │ - dataType        │
                    │     │ - status          │
                    │     │ - cost            │
                    │     │ - requestId       │
                    │     │ - createdAt       │
                    │     └───────────────────┘
                    │
                    │1:N
                    │
           ┌────────▼────────────┐
           │ ProviderWebhook     │
           │                     │
           │ - id                │
           │ - provider          │
           │ - requestId         │
           │ - status            │
           │ - payload           │
           │ - processedAt       │
           │ - retriesAttempted  │
           └─────────────────────┘

┌──────────────────┐
│ ProviderCost     │ (Configuration table)
│                  │
│ - id             │
│ - provider       │
│ - dataType       │
│ - costPerUnit    │
│ - effectiveDate  │
└──────────────────┘
```

---

## Entities

### 1. Job (Existing - Extended)

**Purpose**: Enrichment job tracking (existing model)
**Extensions**: Add provider tracking fields

```prisma
model Job {
  id                    String              @id @default(uuid())
  slackChannelId        String
  slackThreadTs         String
  slackTeamId           String
  slackUserId           String

  // Existing fields
  type                  JobType             // TECHNOGRAPHIC, CONTACT, COMBINED
  purpose               Purpose?            // JUST_A_LIST, EMAILING, COLD_CALLING, ALL, LINKEDIN
  status                JobStatus           // PENDING, PROCESSING, AWAITING_PHONES, COMPLETED, FAILED
  sourceFileName        String?
  sourceFileType        FileType?           // CSV, XLSX
  sourceFileS3Key       String?
  resultFileS3Key       String?

  // NEW: Provider tracking
  enrichmentMode        EnrichmentMode?     // EMAIL_ONLY, PHONE_ONLY, ALL
  providersUsed         String[]            // ["APOLLO", "WIZA"] - providers that returned data
  totalCost             Float?              @default(0)

  // Relationships
  contacts              JobContact[]
  providerAttempts      ProviderAttempt[]   // NEW
  providerWebhooks      ProviderWebhook[]   // NEW

  createdAt             DateTime            @default(now())
  updatedAt             DateTime            @updatedAt
}

enum EnrichmentMode {
  EMAIL_ONLY   // Apollo → Wiza → AI Ark for emails only
  PHONE_ONLY   // Wiza → AI Ark for phones only
  ALL          // Both email and phone waterfalls
}
```

**Validation Rules**:
- `enrichmentMode` must be set for waterfall enrichment jobs
- `providersUsed` array cannot exceed 3 elements (max providers)
- `totalCost` must be non-negative

**State Transitions**:
```
PENDING → PROCESSING (email enrichment starts)
        → AWAITING_EMAIL_VERIFICATION (emails complete, waiting for user's verify/skip decision)
        → AWAITING_PHONES (phones requested, waiting for phone webhooks)
        → AWAITING_DNC_DECISION (phones complete, waiting for DNC scrub decision)
        → COMPLETED (all enrichment complete)
        → FAILED (critical error)
```

**US6 Note**: In "All" mode, the flow is: PROCESSING → AWAITING_EMAIL_VERIFICATION → (user decides) → AWAITING_PHONES → AWAITING_DNC_DECISION → COMPLETED. Each quality gate is scoped to its own data type.

---

### 2. JobContact (Existing - Extended)

**Purpose**: Individual contact enrichment tracking
**Extensions**: Add provider source tracking

```prisma
model JobContact {
  id                    String              @id @default(uuid())
  jobId                 String
  job                   Job                 @relation(fields: [jobId], references: [id], onDelete: Cascade)

  // Existing fields
  originalData          Json                // Original CSV row
  email                 String?
  directPhone           String?
  businessPhone         String?
  firstName             String?
  lastName              String?
  fullName              String?
  title                 String?
  linkedInUrl           String?

  // NEW: Provider source tracking
  emailSource           Provider?           // Which provider found the email
  emailCost             Float?              // Cost to enrich email
  phoneSource           Provider?           // Which provider found the phone
  phoneCost             Float?              // Cost to enrich phone
  enrichmentAttempts    Int                 @default(0) // Number of provider attempts

  // NEW (US6): Email verification via Findymail
  emailVerified         Boolean?            // true=deliverable, false=undeliverable, null=not checked
  emailProvider         String?             // Email provider name (e.g., "Google", "Microsoft")
  verificationCost      Float?              // Cost of Findymail verification

  // Company data
  companyName           String?
  companyDomain         String?

  // Relationships
  providerAttempts      ProviderAttempt[]   // NEW

  createdAt             DateTime            @default(now())
  updatedAt             DateTime            @updatedAt

  @@index([jobId])
  @@index([email])
  @@index([companyDomain])
}

enum Provider {
  APOLLO
  WIZA
  AI_ARK
  FINDYMAIL  // US6: Email verification provider
}
```

**Validation Rules**:
- If `emailSource` is set, `email` must be non-null
- If `phoneSource` is set, at least one of `directPhone` or `businessPhone` must be non-null
- `emailCost` and `phoneCost` must be non-negative
- `enrichmentAttempts` must be ≤ 6 (max: 3 providers for email + 3 for phone, though actual max is 5: 3 email + 2 phone)

**Uniqueness**: Contacts are unique per job (composite key: jobId + contact identifier)

---

### 3. ProviderAttempt (NEW)

**Purpose**: Track each provider enrichment attempt for cost attribution and debugging
**Rationale**: Enables FR-004 (provider attribution), FR-017 (audit logging)

```prisma
model ProviderAttempt {
  id                    String              @id @default(uuid())
  jobId                 String
  job                   Job                 @relation(fields: [jobId], references: [id], onDelete: Cascade)
  contactId             String
  contact               JobContact          @relation(fields: [contactId], references: [id], onDelete: Cascade)

  provider              Provider            // APOLLO, WIZA, AI_ARK
  dataType              DataType            // EMAIL, PHONE
  status                AttemptStatus       // SUCCESS, FAILED, SKIPPED, TIMEOUT

  // Request tracking
  requestId             String?             // Provider's request ID (for webhook correlation)
  requestPayload        Json?               // API request sent
  responsePayload       Json?               // API response received

  // Cost tracking
  cost                  Float?              // Cost incurred (null if no charge)
  creditsConsumed       Int?                // Credits used (provider-specific)

  // Result tracking
  emailFound            String?             // Email if found
  phoneFound            String?             // Phone if found

  // Error tracking
  errorMessage          String?             // Error if attempt failed
  httpStatus            Int?                // HTTP status from provider

  // Timing
  startedAt             DateTime            @default(now())
  completedAt           DateTime?
  durationMs            Int?                // Processing duration in milliseconds

  createdAt             DateTime            @default(now())

  @@index([jobId])
  @@index([contactId])
  @@index([provider, dataType])
  @@index([requestId]) // For webhook correlation
}

enum DataType {
  EMAIL
  PHONE
}

enum AttemptStatus {
  SUCCESS       // Data found successfully
  FAILED        // Provider returned error
  SKIPPED       // Contact already has data, skipped this provider
  TIMEOUT       // Provider timed out
  NO_DATA       // Provider responded OK but no data found
}
```

**Validation Rules**:
- If `status = SUCCESS`, at least one of `emailFound` or `phoneFound` must be set
- If `status = FAILED`, `errorMessage` must be set
- `cost` must be non-negative
- `durationMs` must be positive if `completedAt` is set

**Lifecycle**:
```
Created (startedAt) → API call → Response received (completedAt, durationMs calculated) → Status set
```

---

### 4. ProviderWebhook (NEW)

**Purpose**: Track webhook deliveries from Wiza and AI Ark for async phone enrichment
**Rationale**: FR-006, FR-007 (async phone delivery via webhooks), idempotency

```prisma
model ProviderWebhook {
  id                    String              @id @default(uuid())

  // Job correlation
  jobId                 String
  job                   Job                 @relation(fields: [jobId], references: [id], onDelete: Cascade)

  // Webhook metadata
  provider              Provider            // WIZA or AI_ARK (never APOLLO for phones)
  requestId             String              // Provider's request ID (for correlation with ProviderAttempt)
  webhookId             String              @unique // Provider's webhook delivery ID (for idempotency)

  // Payload
  rawPayload            Json                // Full webhook payload
  eventType             String?             // e.g., "enrichment.complete"

  // Status
  status                WebhookStatus       // RECEIVED, PROCESSING, PROCESSED, FAILED
  processedAt           DateTime?

  // Retry tracking
  retriesAttempted      Int                 @default(0)
  lastRetryAt           DateTime?

  // Error tracking
  errorMessage          String?

  // Security
  signatureVerified     Boolean             @default(false)
  receivedAt            DateTime            @default(now())

  createdAt             DateTime            @default(now())

  @@index([jobId])
  @@index([provider, requestId]) // For finding webhooks by provider request
  @@index([webhookId]) // For idempotency checks
}

enum WebhookStatus {
  RECEIVED      // Webhook received, acknowledged
  PROCESSING    // Worker processing webhook data
  PROCESSED     // Successfully processed
  FAILED        // Processing failed after retries
}
```

**Validation Rules**:
- `webhookId` must be unique (enforces idempotency)
- `provider` must be WIZA or AI_ARK (Apollo uses different phone webhook path)
- If `status = PROCESSED`, `processedAt` must be set
- `retriesAttempted` must be ≥ 0

**Idempotency**:
- Use `webhookId` as unique constraint
- On duplicate webhook delivery, return 200 OK without processing

**Lifecycle**:
```
RECEIVED (webhook arrives) → PROCESSING (queued worker) → PROCESSED (data applied) OR FAILED (retries exhausted)
```

---

### 5. ProviderCost (NEW)

**Purpose**: Store per-provider pricing configuration for cost calculation
**Rationale**: FR-011 (store pricing rates), enables FR-010 (cost breakdown)

```prisma
model ProviderCost {
  id                    String              @id @default(uuid())

  provider              Provider            // APOLLO, WIZA, AI_ARK
  dataType              DataType            // EMAIL, PHONE

  costPerUnit           Float               // Cost in USD per successful enrichment
  creditsPerUnit        Int?                // Credits consumed per unit (provider-specific)

  effectiveDate         DateTime            @default(now()) // When this pricing became effective
  expiresAt             DateTime?           // When this pricing expires (null = current)

  // Metadata
  notes                 String?             // e.g., "Corrected from spec pricing"

  createdAt             DateTime            @default(now())

  @@unique([provider, dataType, effectiveDate])
  @@index([provider, dataType])
}
```

**Initial Data** (based on research):
```typescript
// Migration seed data
[
  { provider: 'APOLLO', dataType: 'EMAIL', costPerUnit: 0.05 },
  { provider: 'WIZA', dataType: 'EMAIL', costPerUnit: 0.05, creditsPerUnit: 2 },
  { provider: 'WIZA', dataType: 'PHONE', costPerUnit: 0.125, creditsPerUnit: 5 },
  { provider: 'AI_ARK', dataType: 'EMAIL', costPerUnit: 0.14 }, // Estimate - confirm with sales
  { provider: 'AI_ARK', dataType: 'PHONE', costPerUnit: 0.27 }, // Estimate - confirm with sales
]
```

**Validation Rules**:
- `costPerUnit` must be positive
- At most one active pricing record per (provider, dataType) where `expiresAt` is null
- Historical pricing must have `expiresAt` < current pricing's `effectiveDate`

**Usage**:
```typescript
// Get current pricing
const pricing = await prisma.providerCost.findFirst({
  where: {
    provider: 'WIZA',
    dataType: 'EMAIL',
    effectiveDate: { lte: new Date() },
    OR: [
      { expiresAt: null },
      { expiresAt: { gte: new Date() } }
    ]
  },
  orderBy: { effectiveDate: 'desc' }
});
```

---

## Indexes

### Performance Optimization

**JobContact**:
- `@@index([jobId])` - Fast lookup of all contacts for a job
- `@@index([email])` - Deduplication checks
- `@@index([companyDomain])` - Domain-based grouping

**ProviderAttempt**:
- `@@index([jobId])` - All attempts for a job
- `@@index([contactId])` - Attempt history per contact
- `@@index([provider, dataType])` - Provider-specific queries
- `@@index([requestId])` - Webhook correlation

**ProviderWebhook**:
- `@@index([jobId])` - All webhooks for a job
- `@@index([provider, requestId])` - Find webhook by provider request
- `@@unique([webhookId])` - Idempotency enforcement

**ProviderCost**:
- `@@index([provider, dataType])` - Pricing lookups
- `@@unique([provider, dataType, effectiveDate])` - Prevent duplicate pricing records

---

## Migrations

### Migration Strategy

1. **Add new tables**: ProviderAttempt, ProviderWebhook, ProviderCost
2. **Extend Job**: Add enrichmentMode, providersUsed, totalCost
3. **Extend JobContact**: Add emailSource, emailCost, phoneSource, phoneCost, enrichmentAttempts
4. **Seed ProviderCost**: Insert initial pricing data
5. **Add indexes**: Create performance indexes
6. **Backfill**: Set enrichmentMode = 'ALL' for existing jobs where purpose = 'ALL' or 'COLD_CALLING'

### Migration File (Prisma)

```prisma
// prisma/migrations/27_add_waterfall_enrichment/migration.sql

-- Add enums
CREATE TYPE "Provider" AS ENUM ('APOLLO', 'WIZA', 'AI_ARK');
CREATE TYPE "DataType" AS ENUM ('EMAIL', 'PHONE');
CREATE TYPE "AttemptStatus" AS ENUM ('SUCCESS', 'FAILED', 'SKIPPED', 'TIMEOUT', 'NO_DATA');
CREATE TYPE "WebhookStatus" AS ENUM ('RECEIVED', 'PROCESSING', 'PROCESSED', 'FAILED');
CREATE TYPE "EnrichmentMode" AS ENUM ('EMAIL_ONLY', 'PHONE_ONLY', 'ALL');

-- Extend Job table
ALTER TABLE "Job" ADD COLUMN "enrichmentMode" "EnrichmentMode";
ALTER TABLE "Job" ADD COLUMN "providersUsed" TEXT[] DEFAULT '{}';
ALTER TABLE "Job" ADD COLUMN "totalCost" DOUBLE PRECISION DEFAULT 0;

-- Extend JobContact table
ALTER TABLE "JobContact" ADD COLUMN "emailSource" "Provider";
ALTER TABLE "JobContact" ADD COLUMN "emailCost" DOUBLE PRECISION;
ALTER TABLE "JobContact" ADD COLUMN "phoneSource" "Provider";
ALTER TABLE "JobContact" ADD COLUMN "phoneCost" DOUBLE PRECISION;
ALTER TABLE "JobContact" ADD COLUMN "enrichmentAttempts" INTEGER DEFAULT 0;

-- Create ProviderAttempt table
CREATE TABLE "ProviderAttempt" (
  "id" TEXT PRIMARY KEY,
  "jobId" TEXT NOT NULL,
  "contactId" TEXT NOT NULL,
  "provider" "Provider" NOT NULL,
  "dataType" "DataType" NOT NULL,
  "status" "AttemptStatus" NOT NULL,
  "requestId" TEXT,
  "requestPayload" JSONB,
  "responsePayload" JSONB,
  "cost" DOUBLE PRECISION,
  "creditsConsumed" INTEGER,
  "emailFound" TEXT,
  "phoneFound" TEXT,
  "errorMessage" TEXT,
  "httpStatus" INTEGER,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  "durationMs" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ProviderAttempt_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE,
  CONSTRAINT "ProviderAttempt_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "JobContact"("id") ON DELETE CASCADE
);

CREATE INDEX "ProviderAttempt_jobId_idx" ON "ProviderAttempt"("jobId");
CREATE INDEX "ProviderAttempt_contactId_idx" ON "ProviderAttempt"("contactId");
CREATE INDEX "ProviderAttempt_provider_dataType_idx" ON "ProviderAttempt"("provider", "dataType");
CREATE INDEX "ProviderAttempt_requestId_idx" ON "ProviderAttempt"("requestId");

-- Create ProviderWebhook table
CREATE TABLE "ProviderWebhook" (
  "id" TEXT PRIMARY KEY,
  "jobId" TEXT NOT NULL,
  "provider" "Provider" NOT NULL,
  "requestId" TEXT NOT NULL,
  "webhookId" TEXT NOT NULL UNIQUE,
  "rawPayload" JSONB NOT NULL,
  "eventType" TEXT,
  "status" "WebhookStatus" NOT NULL,
  "processedAt" TIMESTAMP(3),
  "retriesAttempted" INTEGER DEFAULT 0,
  "lastRetryAt" TIMESTAMP(3),
  "errorMessage" TEXT,
  "signatureVerified" BOOLEAN DEFAULT false,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ProviderWebhook_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE CASCADE
);

CREATE INDEX "ProviderWebhook_jobId_idx" ON "ProviderWebhook"("jobId");
CREATE INDEX "ProviderWebhook_provider_requestId_idx" ON "ProviderWebhook"("provider", "requestId");
CREATE INDEX "ProviderWebhook_webhookId_idx" ON "ProviderWebhook"("webhookId");

-- Create ProviderCost table
CREATE TABLE "ProviderCost" (
  "id" TEXT PRIMARY KEY,
  "provider" "Provider" NOT NULL,
  "dataType" "DataType" NOT NULL,
  "costPerUnit" DOUBLE PRECISION NOT NULL,
  "creditsPerUnit" INTEGER,
  "effectiveDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3),
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ProviderCost_provider_dataType_effectiveDate_key" UNIQUE ("provider", "dataType", "effectiveDate")
);

CREATE INDEX "ProviderCost_provider_dataType_idx" ON "ProviderCost"("provider", "dataType");

-- Seed ProviderCost with current pricing
INSERT INTO "ProviderCost" ("id", "provider", "dataType", "costPerUnit", "creditsPerUnit", "notes") VALUES
  (gen_random_uuid(), 'APOLLO', 'EMAIL', 0.05, NULL, 'Existing Apollo email pricing'),
  (gen_random_uuid(), 'WIZA', 'EMAIL', 0.05, 2, 'Corrected from spec: 2 credits × $0.025 = $0.05'),
  (gen_random_uuid(), 'WIZA', 'PHONE', 0.125, 5, 'Corrected from spec: 5 credits × $0.025 = $0.125'),
  (gen_random_uuid(), 'AI_ARK', 'EMAIL', 0.14, NULL, 'Estimate - confirm with AI Ark sales'),
  (gen_random_uuid(), 'AI_ARK', 'PHONE', 0.27, NULL, 'Estimate - confirm with AI Ark sales');
```

---

## Cache Schema (Redis)

### Enrichment Cache

**Key Pattern**: `enrichment:{dataType}:{domain}:{name}`
**TTL**: 30 days (2,592,000 seconds)

**Value** (JSON):
```json
{
  "email": "john@company.com",
  "provider": "apollo",
  "cost": 0.05,
  "timestamp": 1710412800,
  "expiresAt": 1713004800
}
```

**Phone Cache**:
```json
{
  "phone": "+15551234567",
  "type": "mobile",
  "provider": "wiza",
  "cost": 0.125,
  "timestamp": 1710412800,
  "expiresAt": 1713004800
}
```

**Usage**:
```typescript
// Check cache before API call
const cacheKey = `enrichment:email:${domain}:${name}`;
const cached = await redis.get(cacheKey);

if (cached) {
  const data = JSON.parse(cached);
  if (data.expiresAt > Date.now() / 1000) {
    return data.email; // Use cached data
  }
}

// If not cached or expired, call API and cache result
const email = await provider.findEmail({ name, domain });
await redis.setex(cacheKey, 2592000, JSON.stringify({
  email,
  provider: 'apollo',
  cost: 0.05,
  timestamp: Math.floor(Date.now() / 1000),
  expiresAt: Math.floor(Date.now() / 1000) + 2592000
}));
```

---

## Data Flow

### Email Enrichment Flow

```
1. JobContact created (email = null)
2. Check cache: enrichment:email:{domain}:{name}
3. If cached → Update JobContact, skip API
4. If not cached:
   a. Try Apollo API
      → ProviderAttempt created (provider=APOLLO, dataType=EMAIL, status=PENDING)
      → API call
      → If found: ProviderAttempt updated (status=SUCCESS, emailFound=..., cost=0.05)
                  JobContact updated (email=..., emailSource=APOLLO, emailCost=0.05)
                  Cache result
                  DONE
      → If not found: ProviderAttempt updated (status=NO_DATA)
   b. Try Wiza API (same pattern as Apollo)
   c. Try AI Ark API (same pattern as Apollo)
   d. If all fail: JobContact.email remains null, no emailSource
```

### Phone Enrichment Flow (Async)

```
1. JobContact created (directPhone = null)
2. Try Wiza API
   → ProviderAttempt created (provider=WIZA, dataType=PHONE, status=PENDING, requestId=123)
   → API call with callback_url
   → Wiza returns 200 { id: 123, status: "queued" }
   → ProviderAttempt updated (status=PENDING) [waiting for webhook]
   → Job status → AWAITING_PHONES

[Later: Webhook arrives]
3. POST /api/webhooks/wiza/enrichment-results
   → ProviderWebhook created (provider=WIZA, requestId=123, webhookId=abc, status=RECEIVED)
   → Acknowledge 200 OK
   → Queue webhook processing job

4. Webhook worker processes:
   → Find ProviderAttempt by requestId=123
   → If phone found: Update ProviderAttempt (status=SUCCESS, phoneFound=..., cost=0.125)
                     Update JobContact (directPhone=..., phoneSource=WIZA, phoneCost=0.125)
                     Update ProviderWebhook (status=PROCESSED)
   → If phone not found: Try AI Ark API (same pattern)
```

---

## Alternatives Considered

### Alternative 1: Single EnrichmentAttempt Table
**Rejected**: Combining provider attempts and webhooks into one table creates complex schema with many nullable fields. Separate tables provide better clarity and indexing.

### Alternative 2: Store Pricing in Code
**Rejected**: Hardcoding pricing prevents runtime updates and historical cost analysis. Database storage enables pricing changes without deployment.

### Alternative 3: No Provider Source Tracking
**Rejected**: FR-004 explicitly requires tracking which provider found each data point for cost attribution and debugging.

### Alternative 4: Synchronous Polling for Phones
**Rejected**: Webhook pattern is more efficient and aligns with provider APIs. Polling would require complex job scheduling and higher latency.

---

## Next Steps

1. **Generate Prisma schema file**: Apply data model to `prisma/schema.prisma`
2. **Create migration**: `npx prisma migrate dev --name add_waterfall_enrichment`
3. **Generate Prisma client**: `npx prisma generate`
4. **Design API contracts**: OpenAPI spec for webhook endpoints in `/contracts/webhooks.yaml`
5. **Create quickstart.md**: Development setup instructions
