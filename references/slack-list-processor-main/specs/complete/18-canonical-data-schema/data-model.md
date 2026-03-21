# Data Model: Canonical Data Schema & CRM Adapter Pattern

**Feature**: 18-canonical-data-schema | **Date**: 2026-03-12

## New Enums

### CrmType

```prisma
enum CrmType {
  HUBSPOT
  ATTIO
  SALESFORCE
}
```

### CrmConnectionStatus

```prisma
enum CrmConnectionStatus {
  ACTIVE
  DISCONNECTED
  TOKEN_EXPIRED
  ERROR
}
```

### CrmPushStatus

```prisma
enum CrmPushStatus {
  PENDING
  SUCCESS
  FAILED
}
```

### SyncDirection

```prisma
enum SyncDirection {
  TO_CRM
  FROM_CRM
  BIDIRECTIONAL
}
```

## New Models

### CanonicalContact

CRM-agnostic contact record. Created on-demand during CRM import from `JobContact` data. Unique key: email. Upserted on re-enrichment.

```prisma
model CanonicalContact {
  id                String          @id @default(uuid()) @db.Uuid

  // Identity (unique key for upsert)
  email             String          @unique

  // Standard contact fields (16 total)
  firstName         String?         @map("first_name")
  lastName          String?         @map("last_name")
  jobTitle          String?         @map("job_title")
  company           String?
  domain            String?
  phone             String?
  mobilePhone       String?         @map("mobile_phone")
  linkedinUrl       String?         @map("linkedin_url")
  city              String?
  state             String?
  country           String?

  // Enrichment metadata
  enrichmentSource  String?         @map("enrichment_source")
  enrichmentDate    DateTime?       @map("enrichment_date")
  techSpendTier     String?         @map("tech_spend_tier")
  enrichmentJobId   String?         @map("enrichment_job_id") @db.Uuid

  // Source linkage
  jobContactId      String?         @map("job_contact_id") @db.Uuid

  // Audit
  createdAt         DateTime        @default(now()) @map("created_at")
  updatedAt         DateTime        @updatedAt @map("updated_at")

  // Relations
  pushRecords       CrmPushRecord[] @relation("ContactPushRecords")
  account           CanonicalAccount? @relation(fields: [domain], references: [domain])

  @@index([domain])
  @@index([enrichmentJobId])
  @@map("canonical_contacts")
}
```

### CanonicalAccount

CRM-agnostic account record. Created on-demand during CRM import from `JobCompany` data. Unique key: domain. Upserted on re-enrichment.

```prisma
model CanonicalAccount {
  id                String          @id @default(uuid()) @db.Uuid

  // Identity (unique key for upsert)
  domain            String          @unique

  // Standard account fields (12 total)
  companyName       String?         @map("company_name")
  industry          String?
  employeeCount     Int?            @map("employee_count")
  annualRevenue     Float?          @map("annual_revenue")
  city              String?
  state             String?
  country           String?
  technologies      String[]        @default([])
  cloudProvider     String?         @map("cloud_provider")
  trafficRank       Int?            @map("traffic_rank")
  techSpendTier     String?         @map("tech_spend_tier")

  // Source linkage
  jobCompanyId      String?         @map("job_company_id") @db.Uuid
  enrichmentJobId   String?         @map("enrichment_job_id") @db.Uuid

  // Audit
  createdAt         DateTime        @default(now()) @map("created_at")
  updatedAt         DateTime        @updatedAt @map("updated_at")

  // Relations
  contacts          CanonicalContact[]
  pushRecords       CrmPushRecord[] @relation("AccountPushRecords")

  @@index([companyName])
  @@index([enrichmentJobId])
  @@map("canonical_accounts")
}
```

### CrmConnection

CRM-agnostic connection record. Represents a client's connection to a specific CRM. Linked to CRM-specific config via the existing `HubSpotConnection` (for HubSpot type) or future adapter-specific tables.

```prisma
model CrmConnection {
  id                  String              @id @default(uuid()) @db.Uuid
  clientId            String              @map("client_id") @db.Uuid

  // CRM type and status
  crmType             CrmType             @map("crm_type")
  status              CrmConnectionStatus @default(ACTIVE)

  // Display
  displayName         String?             @map("display_name")

  // CRM-specific config reference
  hubspotConnectionId String?             @unique @map("hubspot_connection_id") @db.Uuid

  // Adapter config (for non-HubSpot CRMs or additional settings)
  adapterConfig       Json?               @map("adapter_config")

  // Audit
  createdAt           DateTime            @default(now()) @map("created_at")
  updatedAt           DateTime            @updatedAt @map("updated_at")

  // Relations
  client              ManagedClient       @relation(fields: [clientId], references: [id], onDelete: Cascade)
  hubspotConnection   HubSpotConnection?  @relation(fields: [hubspotConnectionId], references: [id])
  fieldMappings       CrmFieldMapping[]
  pushRecords         CrmPushRecord[]

  @@unique([clientId, crmType])
  @@index([crmType])
  @@map("crm_connections")
}
```

### CrmFieldMapping

Per-connection field mapping. Defines how canonical fields translate to CRM-specific properties. Includes data type, optional transform rule, and overwrite behavior.

```prisma
model CrmFieldMapping {
  id                  String          @id @default(uuid()) @db.Uuid
  crmConnectionId     String          @map("crm_connection_id") @db.Uuid

  // Mapping definition
  canonicalField      String          @map("canonical_field")
  crmProperty         String          @map("crm_property")
  crmPropertyLabel    String?         @map("crm_property_label")
  dataType            String          @default("string") @map("data_type")

  // Behavior
  transformRule       String?         @map("transform_rule")
  isRequired          Boolean         @default(false) @map("is_required")
  syncDirection       SyncDirection   @default(TO_CRM) @map("sync_direction")
  overwriteExisting   Boolean         @default(true) @map("overwrite_existing")

  // Ordering
  displayOrder        Int             @default(0) @map("display_order")

  // Audit
  createdAt           DateTime        @default(now()) @map("created_at")
  updatedAt           DateTime        @updatedAt @map("updated_at")

  // Relations
  connection          CrmConnection   @relation(fields: [crmConnectionId], references: [id], onDelete: Cascade)

  @@unique([crmConnectionId, canonicalField])
  @@index([crmConnectionId])
  @@map("crm_field_mappings")
}
```

### CrmPushRecord

Tracks per-record push status to enable incremental imports. Links canonical records to CRM connections with timestamps and external CRM record IDs.

```prisma
model CrmPushRecord {
  id                  String          @id @default(uuid()) @db.Uuid
  crmConnectionId     String          @map("crm_connection_id") @db.Uuid

  // Canonical record reference (one of these will be set)
  canonicalContactId  String?         @map("canonical_contact_id") @db.Uuid
  canonicalAccountId  String?         @map("canonical_account_id") @db.Uuid

  // CRM-side reference
  crmRecordId         String?         @map("crm_record_id")

  // Push status
  pushStatus          CrmPushStatus   @default(PENDING) @map("push_status")
  lastPushedAt        DateTime?       @map("last_pushed_at")
  errorMessage        String?         @map("error_message") @db.Text

  // Audit
  createdAt           DateTime        @default(now()) @map("created_at")
  updatedAt           DateTime        @updatedAt @map("updated_at")

  // Relations
  connection          CrmConnection   @relation(fields: [crmConnectionId], references: [id], onDelete: Cascade)
  canonicalContact    CanonicalContact? @relation("ContactPushRecords", fields: [canonicalContactId], references: [id], onDelete: Cascade)
  canonicalAccount    CanonicalAccount? @relation("AccountPushRecords", fields: [canonicalAccountId], references: [id], onDelete: Cascade)

  @@unique([crmConnectionId, canonicalContactId])
  @@unique([crmConnectionId, canonicalAccountId])
  @@index([pushStatus])
  @@index([lastPushedAt])
  @@map("crm_push_records")
}
```

## Modified Models

### HubSpotConnection (existing)

Add optional back-reference to `CrmConnection`:

```prisma
// Add to existing HubSpotConnection model:
crmConnection     CrmConnection?
```

### ManagedClient (existing)

Add relation to CRM connections:

```prisma
// Add to existing ManagedClient model:
crmConnections    CrmConnection[]
```

## Entity Relationship Diagram

```
ManagedClient
  │
  ├── 1:many ── CrmConnection
  │               │
  │               ├── 1:1 ─── HubSpotConnection (for HUBSPOT type)
  │               │
  │               ├── 1:many ── CrmFieldMapping
  │               │               (canonicalField → crmProperty)
  │               │
  │               └── 1:many ── CrmPushRecord
  │                               │
  │                               ├── many:1 ── CanonicalContact
  │                               └── many:1 ── CanonicalAccount
  │
  └── (existing) ── HubSpotConnection
                      │
                      └── (existing) ── HubSpotImportJob, HubSpotContactMapping, etc.

CanonicalAccount
  │
  └── 1:many ── CanonicalContact (via domain)

JobCompany ──(source)──> CanonicalAccount (on-demand conversion)
JobContact ──(source)──> CanonicalContact (on-demand conversion)
```

## TypeScript Interfaces (CRM Adapter Layer)

### CrmAdapter Interface

```typescript
export interface CrmUpsertResult {
  succeeded: number;
  failed: number;
  errors: Array<{ email: string; error: string }>;
  crmRecordIds: Map<string, string>; // email → crmRecordId
}

export interface CrmPropertyInfo {
  name: string;
  label: string;
  type: string;
  groupName: string;
  isCustom: boolean;
}

export interface CrmAdapterError {
  code: string;
  message: string;
  crmType: CrmType;
  retryable: boolean;
  details?: Record<string, unknown>;
}

export abstract class CrmAdapter {
  abstract readonly crmType: CrmType;

  abstract connect(connectionId: string): Promise<void>;
  abstract disconnect(connectionId: string): Promise<void>;
  abstract getConnectionStatus(connectionId: string): Promise<CrmConnectionStatus>;
  abstract upsertContacts(
    connectionId: string,
    contacts: CanonicalContact[],
    fieldMappings: CrmFieldMapping[]
  ): Promise<CrmUpsertResult>;
  abstract createList(connectionId: string, name: string): Promise<string>;
  abstract addContactsToList(
    connectionId: string,
    listId: string,
    crmContactIds: string[]
  ): Promise<void>;
  abstract getProperties(connectionId: string): Promise<CrmPropertyInfo[]>;
  abstract ensureCustomProperties(
    connectionId: string,
    properties: CrmPropertyInfo[]
  ): Promise<void>;

  // Shared base methods
  protected async withRetry<T>(
    fn: () => Promise<T>,
    maxRetries: number = 5
  ): Promise<T> { /* exponential backoff with jitter */ }

  protected normalizeError(err: unknown): CrmAdapterError { /* ... */ }
}
```

## Canonical Field Definitions

### Contact Fields (16)

| Canonical Field | Type | Source (JobContact) | HubSpot Default Mapping |
|----------------|------|---------------------|------------------------|
| email | string | email | email |
| firstName | string | firstName | firstname |
| lastName | string | lastName | lastname |
| jobTitle | string | title | jobtitle |
| company | string | companyName | company |
| domain | string | domain | website |
| phone | string | directPhone | phone |
| mobilePhone | string | mobilePhone | mobilephone |
| linkedinUrl | string | linkedinUrl | hs_linkedin_url |
| city | string | city | city |
| state | string | state | state |
| country | string | country | country |
| enrichmentSource | string | "Apollo"/"BuiltWith" | enrichment_source (custom) |
| enrichmentDate | datetime | job.completedAt | enrichment_date (custom) |
| techSpendTier | string | techSpendTier | tech_spend_tier (custom) |
| enrichmentJobId | uuid | jobId | enrichment_job_id (custom) |

### Account Fields (12)

| Canonical Field | Type | Source (JobCompany) | HubSpot Default Mapping |
|----------------|------|---------------------|------------------------|
| domain | string | domain | website (company) |
| companyName | string | name | name (company) |
| industry | string | industry | industry (company) |
| employeeCount | int | employeeCount | numberofemployees (company) |
| annualRevenue | float | annualRevenue | annualrevenue (company) |
| city | string | city | city (company) |
| state | string | state | state (company) |
| country | string | country | country (company) |
| technologies | string[] | technologies (JSON) | N/A (custom) |
| cloudProvider | string | cloudProvider | N/A (custom) |
| trafficRank | int | trafficRank | N/A (custom) |
| techSpendTier | string | techSpendTier | tech_spend_tier (company custom) |

## State Transitions

### CrmPushRecord.pushStatus

```
PENDING ──(import starts)──> [processing]
  │
  ├── success ──> SUCCESS (lastPushedAt updated, crmRecordId stored)
  │
  └── failure ──> FAILED (errorMessage stored)
       │
       └── retry ──> PENDING (on next import attempt)
```

### CrmConnection.status

```
(created) ──> ACTIVE
  │
  ├── OAuth refresh fails ──> TOKEN_EXPIRED
  │     └── re-auth ──> ACTIVE
  │
  ├── user disconnects ──> DISCONNECTED
  │     └── re-connect ──> ACTIVE
  │
  └── API error (persistent) ──> ERROR
        └── resolved ──> ACTIVE
```
