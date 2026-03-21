# API Contract: HubSpot Contact Import & List Creation

**Feature**: 14-hubspot-integration | **Date**: 2026-03-10

## Slash Command Contract: `/hubspot import`

### Flow Overview

```
/hubspot import
  │
  ├── 1. Show file selection (recent enrichment/filter/split files)
  │
  ├── 2. User selects file
  │      └── Parse CSV headers
  │
  ├── 3. Show naming modal (client name, campaign name)
  │
  ├── 4. Show column mapping preview (auto-detected + manual override)
  │      ├── "Confirm" → proceed with auto-detected mapping
  │      ├── "Map Columns" → open full mapping modal
  │      └── Email column required (validation gate)
  │
  ├── 5. Enqueue BullMQ job (hubspot-import)
  │
  └── 6. Worker processes import async
         ├── Batch upsert contacts (100/batch)
         ├── Create static list
         ├── Add contacts to list
         ├── Post progress updates to Slack thread
         └── Post completion summary
```

### Step 1: File Selection

**Trigger:** User types `/hubspot import`

**Preconditions:**
- Channel must have active HubSpot connection (error if not)

**Slack Message (Block Kit):**
```json
{
  "blocks": [
    {
      "type": "section",
      "text": {
        "type": "mrkdwn",
        "text": "Select a file to import to HubSpot:"
      }
    },
    {
      "type": "actions",
      "block_id": "hubspot_file_select",
      "elements": [
        {
          "type": "static_select",
          "placeholder": { "type": "plain_text", "text": "Choose a file..." },
          "action_id": "hubspot_file_selected",
          "options": [
            {
              "text": { "type": "plain_text", "text": "enrichment-output-2026-03-10.csv (142 contacts)" },
              "value": "job_uuid_1"
            }
          ]
        }
      ]
    }
  ]
}
```

**File sources (in dropdown):**
- Completed enrichment jobs in this channel (from `Job` table, last 30 days)
- Completed filter jobs in this channel
- Completed split jobs in this channel

---

### Step 2: Naming Modal

**Trigger:** User selects a file from dropdown (`hubspot_file_selected` action)

**Slack Modal:**
```json
{
  "type": "modal",
  "callback_id": "hubspot_import_naming",
  "title": { "type": "plain_text", "text": "Import to HubSpot" },
  "submit": { "type": "plain_text", "text": "Next" },
  "blocks": [
    {
      "type": "input",
      "block_id": "client_name",
      "label": { "type": "plain_text", "text": "Client Name" },
      "element": {
        "type": "plain_text_input",
        "action_id": "client_name_input",
        "placeholder": { "type": "plain_text", "text": "e.g., Acme Corp" }
      }
    },
    {
      "type": "input",
      "block_id": "campaign_name",
      "label": { "type": "plain_text", "text": "Campaign / Target List Name" },
      "element": {
        "type": "plain_text_input",
        "action_id": "campaign_name_input",
        "placeholder": { "type": "plain_text", "text": "e.g., Q1 ICP Outreach" }
      }
    },
    {
      "type": "section",
      "text": {
        "type": "mrkdwn",
        "text": "*List will be named:*\n`LIST : MMDD [CLIENT] Campaign Name / Target List`"
      }
    }
  ],
  "private_metadata": "{\"jobId\":\"uuid\",\"channelId\":\"C123\",\"threadTs\":\"123.456\"}"
}
```

---

### Step 3: Column Mapping Preview

**Trigger:** User submits naming modal (`hubspot_import_naming` view submission)

**Auto-detection runs → posts mapping preview in thread:**

```json
{
  "blocks": [
    {
      "type": "header",
      "text": { "type": "plain_text", "text": "Column Mapping Preview" }
    },
    {
      "type": "section",
      "text": {
        "type": "mrkdwn",
        "text": "*Auto-detected mappings:*\n• Email → `email`\n• Contact First Name → `firstname`\n• Contact Last Name → `lastname`\n• Job Title → `jobtitle`\n• Company Name → `company`\n• Mobile Number → `mobilephone`\n\n*Unmapped columns (will be ignored):*\n• Domain\n• Tech Stack\n• Revenue Range"
      }
    },
    {
      "type": "actions",
      "elements": [
        {
          "type": "button",
          "text": { "type": "plain_text", "text": "Confirm & Import" },
          "style": "primary",
          "action_id": "hubspot_import_confirm",
          "value": "{\"importId\":\"uuid\"}"
        },
        {
          "type": "button",
          "text": { "type": "plain_text", "text": "Map Columns" },
          "action_id": "hubspot_import_map_columns",
          "value": "{\"importId\":\"uuid\"}"
        },
        {
          "type": "button",
          "text": { "type": "plain_text", "text": "Cancel" },
          "style": "danger",
          "action_id": "hubspot_import_cancel",
          "value": "{\"importId\":\"uuid\"}"
        }
      ]
    }
  ]
}
```

---

### Step 3b: Manual Column Mapping Modal

**Trigger:** User clicks "Map Columns" (`hubspot_import_map_columns` action)

**Slack Modal:**

```json
{
  "type": "modal",
  "callback_id": "hubspot_column_mapping",
  "title": { "type": "plain_text", "text": "Map Columns" },
  "submit": { "type": "plain_text", "text": "Apply Mapping" },
  "blocks": [
    {
      "type": "input",
      "block_id": "map_email",
      "label": { "type": "plain_text", "text": "Email (CSV column)" },
      "element": {
        "type": "static_select",
        "action_id": "map_email_select",
        "options": [
          { "text": { "type": "plain_text", "text": "email" }, "value": "email" },
          { "text": { "type": "plain_text", "text": "firstname" }, "value": "firstname" }
        ]
      }
    }
  ]
}
```

**Note**: Slack modals are limited to 100 block elements. For files with many columns, the modal shows one dropdown per CSV column, each containing HubSpot properties fetched from the client's portal (standard + custom). An "Ignore" option is included in each dropdown.

**Validation**: At least the email column must be mapped. Modal submission fails with error if no email mapping.

---

### Step 4: Import Execution (BullMQ Worker)

**Trigger:** User clicks "Confirm & Import" or submits column mapping modal

**BullMQ Job:**

```typescript
interface HubSpotImportJobData {
  importJobId: string;       // HubSpotImportJob UUID
  clientId: string;          // ManagedClient UUID
  channelId: string;         // Slack channel for progress updates
  threadTs: string;          // Slack thread for progress updates
}
```

**Worker Processing Steps:**

1. Load `HubSpotImportJob` and `HubSpotConnection` from DB
2. Get valid access token (auto-refresh if needed)
3. Ensure custom properties exist in HubSpot (`propertiesCreated` flag)
4. Download and parse source file from S3
5. Apply column mapping to transform CSV rows → HubSpot contact objects
6. Batch upsert contacts (100 per batch):
   ```
   POST /crm/v3/objects/contacts/batch/upsert
   {
     "inputs": [
       {
         "idProperty": "email",
         "id": "user@example.com",
         "properties": {
           "email": "user@example.com",
           "firstname": "Jane",
           "lastname": "Doe",
           "enrichment_source": "Slack List Processor",
           "enrichment_date": "2026-03-10",
           "tech_spend_tier": "Tier 1",
           "enrichment_job_id": "job-uuid"
         }
       }
     ]
   }
   ```
7. Collect contact IDs from upsert results
8. Create static list:
   ```
   POST /crm/v3/lists
   {
     "name": "LIST : 0310 [ACME] Q1 ICP Outreach",
     "processingType": "MANUAL",
     "objectTypeId": "0-1"
   }
   ```
9. Add contacts to list (100 per call):
   ```
   PUT /crm/v3/lists/{listId}/memberships/add
   {
     "recordIdsToAdd": ["id1", "id2", ...]
   }
   ```
10. Update `HubSpotImportJob` with results
11. Post completion summary to Slack thread

**Progress Updates (posted every 500 contacts):**

```
Importing to HubSpot... 500/2,000 contacts processed.
```

---

### Step 5: Completion Summary

**Slack Message (Block Kit):**

```json
{
  "blocks": [
    {
      "type": "header",
      "text": { "type": "plain_text", "text": "HubSpot Import Complete" }
    },
    {
      "type": "section",
      "text": {
        "type": "mrkdwn",
        "text": "*List:* `LIST : 0310 [ACME] Q1 ICP Outreach`\n*Created:* 120 contacts\n*Updated:* 22 contacts\n*Failed:* 0 contacts\n*Total:* 142 contacts"
      }
    },
    {
      "type": "section",
      "text": {
        "type": "mrkdwn",
        "text": "<https://app.hubspot.com/contacts/12345/objects/0-1/views/456/list|View list in HubSpot>"
      }
    }
  ]
}
```

---

## Inline Import (Enrichment Completion Button)

### Trigger

Added to the enrichment job completion message in `fileGeneration.ts` when:
1. The channel has a `ChannelClientMapping`
2. The mapped `ManagedClient` has an active `HubSpotConnection`

### Button Block (appended to existing completion message)

```json
{
  "type": "actions",
  "elements": [
    {
      "type": "button",
      "text": { "type": "plain_text", "text": "Import to HubSpot" },
      "style": "primary",
      "action_id": "hubspot_import_from_enrichment",
      "value": "{\"jobId\":\"enrichment-job-uuid\"}"
    },
    {
      "type": "button",
      "text": { "type": "plain_text", "text": "Cancel" },
      "action_id": "hubspot_import_cancel_inline"
    }
  ]
}
```

**Flow:** Clicking "Import to HubSpot" opens the naming modal (Step 2), pre-populating the file from the completed enrichment job. The rest of the flow is identical to `/hubspot import`.

---

## Internal Service Contracts

### HubSpotImportService

```typescript
interface HubSpotImportService {
  /** Start an import job: create DB record, enqueue BullMQ job */
  startImport(params: {
    connectionId: string;
    sourceFile: { name: string; url: string; rowCount: number };
    clientName: string;
    campaignName: string;
    columnMapping: Record<string, string>;
    enrichmentJobId?: string;
    slackContext: { channelId: string; threadTs: string; userId: string };
  }): Promise<HubSpotImportJob>;

  /** Cancel a pending/in-progress import */
  cancelImport(importJobId: string): Promise<void>;

  /** Get import history for a client */
  getImportHistory(clientId: string, limit?: number): Promise<HubSpotImportJob[]>;
}
```

### HubSpotPropertyMappingService

```typescript
interface HubSpotPropertyMappingService {
  /** Fetch all contact properties from client's HubSpot (standard + custom) */
  getContactProperties(clientId: string): Promise<HubSpotProperty[]>;

  /** Auto-detect column mappings from CSV headers */
  autoDetectMapping(csvHeaders: string[]): Record<string, string>;

  /** Ensure custom enrichment properties exist in client's HubSpot */
  ensureEnrichmentProperties(clientId: string): Promise<void>;
}

interface HubSpotProperty {
  name: string;           // Internal name (e.g., "firstname")
  label: string;          // Display label (e.g., "First Name")
  type: string;           // "string", "number", "date", "enumeration"
  groupName: string;      // Property group
  isCustom: boolean;      // Whether it's a custom property
}
```

---

## Error Handling

| Error | Source | Handling |
|-------|--------|----------|
| Rate limited (429) | HubSpot API | Exponential backoff, retry batch after delay |
| Token expired mid-import | HubSpot API | Auto-refresh token, retry failed batch |
| Refresh token invalid | HubSpot API | Mark connection as TOKEN_EXPIRED, post error to Slack, fail import |
| Contact upsert fails (individual) | HubSpot API | Log error, increment `contactsFailed`, continue with next batch |
| List creation fails | HubSpot API | Fail entire import (contacts already upserted remain in HubSpot) |
| File download fails | S3 | Fail import with error message |
| Slack modal timeout | Slack | User must re-initiate `/hubspot import` |
