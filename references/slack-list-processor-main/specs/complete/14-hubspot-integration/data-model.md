# Data Model: HubSpot Integration (OAuth + Import + Activity Sync + Webhooks)

**Feature**: 14-hubspot-integration | **Date**: 2026-03-10

## Entity Relationship Diagram

```
ManagedClient (existing)
  │
  ├── 1:1 ── HubSpotConnection (NEW)
  │              │
  │              ├── 1:N ── HubSpotImportJob (NEW)
  │              ├── 1:N ── HubSpotContactMapping (NEW)
  │              ├── 1:N ── HubSpotEngagementMapping (NEW)
  │              └── 1:N ── HubSpotSyncLog (NEW)
  │
  ├── 1:N ── ChannelClientMapping (existing)
  ├── 1:N ── Campaign (existing)
  └── N:M ── BdrClient (existing)
```

## New Models

### HubSpotConnection

Represents a client's OAuth connection to their HubSpot portal. One-to-one with ManagedClient.

```prisma
model HubSpotConnection {
  id                String    @id @default(uuid()) @db.Uuid
  clientId          String    @unique @map("client_id") @db.Uuid

  // OAuth tokens (encrypted at application layer via tokenEncryption.ts)
  accessToken       String    @map("access_token") @db.Text
  refreshToken      String    @map("refresh_token") @db.Text
  tokenExpiresAt    DateTime  @map("token_expires_at")

  // HubSpot portal info
  hubspotPortalId   String    @map("hubspot_portal_id")
  hubspotPortalName String?   @map("hubspot_portal_name")
  grantedScopes     String[]  @map("granted_scopes")

  // Connection lifecycle
  status            HubSpotConnectionStatus @default(ACTIVE)
  connectedBy       String    @map("connected_by")          // Slack user ID who authorized
  connectedAt       DateTime  @default(now()) @map("connected_at")
  disconnectedAt    DateTime? @map("disconnected_at")
  lastRefreshedAt   DateTime? @map("last_refreshed_at")

  // Custom properties provisioned flag
  propertiesCreated Boolean   @default(false) @map("properties_created")

  // Sync tracking
  lastSyncAt        DateTime? @map("last_sync_at")
  totalContactsSynced Int     @default(0) @map("total_contacts_synced")
  totalActivitiesLogged Int   @default(0) @map("total_activities_logged")
  totalSyncFailures Int       @default(0) @map("total_sync_failures")

  // Audit
  createdAt         DateTime  @default(now()) @map("created_at")
  updatedAt         DateTime  @updatedAt @map("updated_at")

  // Relations
  client            ManagedClient          @relation(fields: [clientId], references: [id], onDelete: Cascade)
  importJobs        HubSpotImportJob[]
  contactMappings   HubSpotContactMapping[]
  engagementMappings HubSpotEngagementMapping[]
  syncLogs          HubSpotSyncLog[]

  @@index([status])
  @@map("hubspot_connections")
}

enum HubSpotConnectionStatus {
  ACTIVE
  DISCONNECTED
  TOKEN_EXPIRED
  ERROR
}
```

**Field Details:**

| Field | Type | Purpose |
|-------|------|---------|
| `accessToken` | Text (encrypted) | HubSpot OAuth access token. Encrypted via AES-256-GCM before storage. Decrypted on demand for API calls. |
| `refreshToken` | Text (encrypted) | HubSpot OAuth refresh token. Used to obtain new access tokens when they expire (every 30 min). |
| `tokenExpiresAt` | DateTime | UTC timestamp when the current access token expires. Checked before each API call; if within 5 min of expiry, auto-refresh. |
| `hubspotPortalId` | String | The HubSpot portal (account) ID. Used for constructing portal-specific URLs. |
| `hubspotPortalName` | String? | Human-readable portal name. Fetched during OAuth flow for display in status messages. |
| `grantedScopes` | String[] | OAuth scopes actually granted by the client. May differ from requested scopes if client's plan doesn't support all. |
| `status` | Enum | Connection health. ACTIVE = working, DISCONNECTED = user revoked, TOKEN_EXPIRED = refresh failed, ERROR = other failure. |
| `connectedBy` | String | Slack user ID of the person who completed the OAuth flow. For audit purposes. |
| `propertiesCreated` | Boolean | Whether the custom "Enrichment Data" property group and properties have been created in this client's HubSpot. Set to true after first successful creation. |
| `lastSyncAt` | DateTime? | Last time any sync operation (contact push, activity push/pull) completed for this client. |
| `totalContactsSynced` | Int | Cumulative count of contacts synced to HubSpot (across all imports). |
| `totalActivitiesLogged` | Int | Cumulative count of engagement activities pushed to HubSpot. |
| `totalSyncFailures` | Int | Cumulative count of failed sync operations. Satisfies FR-043 failure count tracking. |
| _(removed: `webhookSubscriptionId`)_ | — | Webhook subscriptions are app-level, not per-client. No per-connection subscription tracking needed. |

**State Transitions:**

```
ACTIVE ──disconnect──> DISCONNECTED
ACTIVE ──refresh fails──> TOKEN_EXPIRED
TOKEN_EXPIRED ──reconnect──> ACTIVE
DISCONNECTED ──reconnect──> ACTIVE
ACTIVE ──API error──> ERROR
ERROR ──reconnect──> ACTIVE
```

---

### HubSpotImportJob

Tracks each contact import operation from CSV/XLSX to HubSpot.

```prisma
model HubSpotImportJob {
  id                String    @id @default(uuid()) @db.Uuid
  connectionId      String    @map("connection_id") @db.Uuid

  // Source file
  sourceFileName    String    @map("source_file_name")
  sourceFileUrl     String?   @map("source_file_url") @db.Text    // S3 URL
  sourceRowCount    Int       @map("source_row_count")
  enrichmentJobId   String?   @map("enrichment_job_id") @db.Uuid  // Link to originating Job if from enrichment

  // Import naming
  clientName        String    @map("client_name")
  campaignName      String    @map("campaign_name")
  listName          String    @map("list_name")                    // Full formatted name: LIST : MMDD [CLIENT] Campaign

  // HubSpot results
  hubspotListId     String?   @map("hubspot_list_id")
  hubspotListUrl    String?   @map("hubspot_list_url") @db.Text

  // Column mapping used
  columnMapping     Json      @map("column_mapping")               // { csvColumn: hubspotProperty } pairs

  // Counts
  contactsCreated   Int       @default(0) @map("contacts_created")
  contactsUpdated   Int       @default(0) @map("contacts_updated")
  contactsFailed    Int       @default(0) @map("contacts_failed")
  contactsTotal     Int       @default(0) @map("contacts_total")

  // Job tracking
  status            HubSpotImportStatus @default(PENDING)
  errorMessage      String?   @map("error_message") @db.Text
  startedAt         DateTime? @map("started_at")
  completedAt       DateTime? @map("completed_at")

  // Slack context
  slackChannelId    String    @map("slack_channel_id")
  slackThreadTs     String?   @map("slack_thread_ts")
  slackUserId       String    @map("slack_user_id")

  // BullMQ reference
  bullmqJobId       String?   @map("bullmq_job_id")

  // Audit
  createdAt         DateTime  @default(now()) @map("created_at")
  updatedAt         DateTime  @updatedAt @map("updated_at")

  // Relations
  connection        HubSpotConnection @relation(fields: [connectionId], references: [id], onDelete: Cascade)

  @@index([connectionId])
  @@index([status])
  @@index([slackChannelId])
  @@map("hubspot_import_jobs")
}

enum HubSpotImportStatus {
  PENDING
  PROCESSING
  COMPLETED
  FAILED
  CANCELLED
}
```

**Field Details:**

| Field | Type | Purpose |
|-------|------|---------|
| `columnMapping` | JSON | Stores the mapping used for this import: `{ "Email": "email", "Contact First Name": "firstname", ... }`. Enables audit and re-import with same mapping. |
| `hubspotListId` | String? | HubSpot's internal list ID. Set after list creation. Null if import failed before list creation. |
| `hubspotListUrl` | String? | Direct URL to the list in HubSpot: `https://app.hubspot.com/contacts/{portalId}/objects/0-1/views/{listId}/list` |
| `enrichmentJobId` | UUID? | Links to the `Job` model if this import was triggered from an enrichment completion (vs. standalone `/hubspot import`). |
| `bullmqJobId` | String? | BullMQ job ID for correlating queue events with database records. |

**State Transitions:**

```
PENDING ──worker picks up──> PROCESSING
PROCESSING ──all batches done──> COMPLETED
PROCESSING ──unrecoverable error──> FAILED
PENDING ──user cancels──> CANCELLED
PROCESSING ──user cancels──> CANCELLED
```

---

### HubSpotContactMapping

Links internal contacts (by email) to HubSpot contact IDs. Enables activity association, deduplication, and reverse lookups.

```prisma
model HubSpotContactMapping {
  id                String    @id @default(uuid()) @db.Uuid
  connectionId      String    @map("connection_id") @db.Uuid

  // Contact identity
  email             String
  hubspotContactId  String    @map("hubspot_contact_id")
  hubspotCompanyId  String?   @map("hubspot_company_id")

  // Sync metadata
  lastSyncedAt      DateTime  @default(now()) @map("last_synced_at")
  importJobId       String?   @map("import_job_id") @db.Uuid        // Which import created this mapping

  // Audit
  createdAt         DateTime  @default(now()) @map("created_at")
  updatedAt         DateTime  @updatedAt @map("updated_at")

  // Relations
  connection        HubSpotConnection @relation(fields: [connectionId], references: [id], onDelete: Cascade)

  @@unique([connectionId, email])
  @@index([hubspotContactId])
  @@map("hubspot_contact_mappings")
}
```

**Field Details:**

| Field | Type | Purpose |
|-------|------|---------|
| `email` | String | Contact email — primary lookup key. Unique per connection. |
| `hubspotContactId` | String | HubSpot's internal contact record ID. Used for creating engagements and list membership. |
| `hubspotCompanyId` | String? | HubSpot company ID associated with this contact. Set if company matching is performed. |
| `importJobId` | UUID? | Links to the HubSpotImportJob that first created or updated this mapping. |

---

### HubSpotEngagementMapping

Tracks engagement records pushed to HubSpot to prevent duplicate activity logging (idempotency).

```prisma
model HubSpotEngagementMapping {
  id                  String    @id @default(uuid()) @db.Uuid
  connectionId        String    @map("connection_id") @db.Uuid

  // Internal event reference
  eventType           String    @map("event_type")          // "call", "email", "meeting"
  eventId             String    @map("event_id")            // Internal event/activity ID
  eventSource         String    @map("event_source")        // "campaign", "instantly", "heyreach"

  // HubSpot engagement
  hubspotEngagementId String    @map("hubspot_engagement_id")
  hubspotContactId    String    @map("hubspot_contact_id")

  // Audit
  createdAt           DateTime  @default(now()) @map("created_at")

  // Relations
  connection          HubSpotConnection @relation(fields: [connectionId], references: [id], onDelete: Cascade)

  @@unique([connectionId, eventType, eventId, eventSource])
  @@index([hubspotContactId])
  @@map("hubspot_engagement_mappings")
}
```

**Field Details:**

| Field | Type | Purpose |
|-------|------|---------|
| `eventType` | String | Type of activity: "call", "email", or "meeting". |
| `eventId` | String | Internal ID of the activity event (campaign activity ID, Instantly webhook ID, etc.). |
| `eventSource` | String | Origin system: "campaign", "instantly", "heyreach". Used with eventType + eventId for dedup. |
| `hubspotEngagementId` | String | HubSpot's internal engagement record ID. Proves the activity was logged. |

---

### HubSpotSyncLog

Records each sync operation for history, debugging, and statistics display in `/hubspot status`.

```prisma
model HubSpotSyncLog {
  id                String    @id @default(uuid()) @db.Uuid
  connectionId      String    @map("connection_id") @db.Uuid

  // Sync details
  syncType          HubSpotSyncType
  direction         String    @default("push")               // "push" or "pull"

  // Results
  recordsProcessed  Int       @default(0) @map("records_processed")
  recordsCreated    Int       @default(0) @map("records_created")
  recordsUpdated    Int       @default(0) @map("records_updated")
  recordsFailed     Int       @default(0) @map("records_failed")

  // Metadata
  durationMs        Int?      @map("duration_ms")
  errorMessage      String?   @map("error_message") @db.Text
  metadata          Json?                                     // Additional context (e.g., import job ID, trigger source)

  // Audit
  createdAt         DateTime  @default(now()) @map("created_at")

  // Relations
  connection        HubSpotConnection @relation(fields: [connectionId], references: [id], onDelete: Cascade)

  @@index([connectionId])
  @@index([syncType])
  @@index([createdAt])
  @@map("hubspot_sync_logs")
}

enum HubSpotSyncType {
  CONTACT_IMPORT
  ACTIVITY_PUSH
  ACTIVITY_PULL
  WEBHOOK_EVENT
}
```

**Field Details:**

| Field | Type | Purpose |
|-------|------|---------|
| `syncType` | Enum | Type of sync: contact import, activity push/pull, or webhook event processing. |
| `direction` | String | Whether data flowed to HubSpot ("push") or from HubSpot ("pull"). |
| `durationMs` | Int? | How long the sync took in milliseconds. For performance monitoring. |
| `metadata` | JSON? | Flexible context: import job ID, trigger source, contact email for activity queries, etc. |

---

## Modified Models

### ManagedClient (existing — add relation)

```prisma
model ManagedClient {
  // ... existing fields ...

  // NEW relation
  hubspotConnection HubSpotConnection?

  // ... existing relations ...
}
```

**Note**: The existing `hubspotApiKey` and `hubspotPortalId` fields on ManagedClient remain for backward compatibility with the legacy campaign contact import. They will be phased out in a future migration.

---

## Indexes & Performance

| Table | Index | Purpose |
|-------|-------|---------|
| `hubspot_connections` | `client_id` (UNIQUE) | 1:1 lookup from ManagedClient |
| `hubspot_connections` | `status` | Filter active connections |
| `hubspot_import_jobs` | `connection_id` | List imports per client |
| `hubspot_import_jobs` | `status` | Filter by job status |
| `hubspot_import_jobs` | `slack_channel_id` | Find imports in a channel |
| `hubspot_contact_mappings` | `connection_id, email` (UNIQUE) | Dedup contacts per client |
| `hubspot_contact_mappings` | `hubspot_contact_id` | Reverse lookup from HubSpot ID |
| `hubspot_engagement_mappings` | `connection_id, event_type, event_id, event_source` (UNIQUE) | Idempotency check |
| `hubspot_engagement_mappings` | `hubspot_contact_id` | Find engagements for a contact |
| `hubspot_sync_logs` | `connection_id` | Sync history per client |
| `hubspot_sync_logs` | `sync_type` | Filter by operation type |
| `hubspot_sync_logs` | `created_at` | Recent sync queries |

---

## Data Volume Estimates

| Entity | Expected Records | Growth Rate |
|--------|-----------------|-------------|
| HubSpotConnection | 10-50 | 1-2 per week (new clients) |
| HubSpotImportJob | 100-500 per month | 5-20 imports per client per month |
| HubSpotContactMapping | 1,000-50,000 | Grows with imports (up to 5,000 per import) |
| HubSpotEngagementMapping | 500-5,000 per month | Depends on campaign activity volume |
| HubSpotSyncLog | 200-1,000 per month | One per sync operation |

Storage impact is minimal for connections/imports. Contact mappings may grow significantly over time. Consider archival for HubSpotSyncLog after 90 days if volume becomes an issue.
