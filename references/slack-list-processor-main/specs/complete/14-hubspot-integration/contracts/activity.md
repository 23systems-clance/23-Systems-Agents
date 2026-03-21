# API Contract: HubSpot Activity Sync (Pull + Push)

**Feature**: 14-hubspot-integration | **Date**: 2026-03-10

## Slash Command Contract: `/hubspot activity`

### Step 1: Date Range Selection

**Trigger:** User types `/hubspot activity` or `/hubspot activity user@example.com`

**Preconditions:**
- Channel must have active HubSpot connection

**Flow:**
```
/hubspot activity [optional email]
  │
  ├── 1. Validate HubSpot connection exists
  │
  ├── 2. Show date range preset buttons
  │      ├── "Today"
  │      ├── "Last 7 Days"
  │      └── "Custom" (opens date range input modal)
  │
  ├── 3. User selects preset or enters custom range
  │
  ├── 4. Query HubSpot Search API (batch) for engagements
  │      within selected date range
  │      ├── If email provided: scope to that contact
  │      └── If no email: scope to all HubSpotContactMappings
  │
  └── 5. Format and post activity summary to Slack
```

**Date Range Buttons (Block Kit):**
```json
{
  "blocks": [
    {
      "type": "section",
      "text": {
        "type": "mrkdwn",
        "text": "Select a date range for HubSpot activity:"
      }
    },
    {
      "type": "actions",
      "block_id": "hubspot_activity_date_range",
      "elements": [
        {
          "type": "button",
          "text": { "type": "plain_text", "text": "Today" },
          "action_id": "hubspot_activity_today",
          "value": "{\"email\":\"user@example.com\"}"
        },
        {
          "type": "button",
          "text": { "type": "plain_text", "text": "Last 7 Days" },
          "action_id": "hubspot_activity_7days",
          "value": "{\"email\":\"user@example.com\"}"
        },
        {
          "type": "button",
          "text": { "type": "plain_text", "text": "Custom" },
          "action_id": "hubspot_activity_custom",
          "value": "{\"email\":\"user@example.com\"}"
        }
      ]
    }
  ]
}
```

**Custom Date Range Modal (triggered by "Custom" button):**
```json
{
  "type": "modal",
  "callback_id": "hubspot_activity_custom_range",
  "title": { "type": "plain_text", "text": "Custom Date Range" },
  "submit": { "type": "plain_text", "text": "Get Activity" },
  "blocks": [
    {
      "type": "input",
      "block_id": "start_date",
      "label": { "type": "plain_text", "text": "Start Date" },
      "element": { "type": "datepicker", "action_id": "start_date_picker" }
    },
    {
      "type": "input",
      "block_id": "end_date",
      "label": { "type": "plain_text", "text": "End Date" },
      "element": { "type": "datepicker", "action_id": "end_date_picker" }
    }
  ]
}
```

---

### Step 2: Activity Summary Response

**Slack Response — Single Contact (Block Kit):**
```json
{
  "blocks": [
    {
      "type": "header",
      "text": { "type": "plain_text", "text": "HubSpot Activity: user@example.com" }
    },
    {
      "type": "section",
      "text": {
        "type": "mrkdwn",
        "text": "*Mar 8 – Mar 11, 2026*\n\n:phone: *Calls:* 2\n:email: *Emails:* 5\n:calendar: *Meetings:* 1\n\n*Total engagements:* 8"
      }
    },
    {
      "type": "divider"
    },
    {
      "type": "section",
      "text": {
        "type": "mrkdwn",
        "text": ":phone: *Call* — Mar 8, 2026\nOutcome: Connected | Duration: 5 min\nNotes: Discussed pricing options"
      }
    },
    {
      "type": "section",
      "text": {
        "type": "mrkdwn",
        "text": ":email: *Email* — Mar 7, 2026\nSubject: Follow-up on Q1 proposal\nStatus: Delivered"
      }
    },
    {
      "type": "section",
      "text": {
        "type": "mrkdwn",
        "text": ":calendar: *Meeting* — Mar 10, 2026\nTitle: Discovery Call\nTime: 2:00 PM - 2:30 PM EST"
      }
    },
    {
      "type": "context",
      "elements": [
        { "type": "mrkdwn", "text": "Activity from HubSpot • Queried via Search API (batch)" }
      ]
    }
  ]
}
```

**Slack Response — All Contacts Summary (Block Kit):**
```json
{
  "blocks": [
    {
      "type": "header",
      "text": { "type": "plain_text", "text": "HubSpot Activity Summary" }
    },
    {
      "type": "section",
      "text": {
        "type": "mrkdwn",
        "text": "*Mar 4 – Mar 11, 2026*\n\n:phone: *Calls:* 12\n:email: *Emails:* 34\n:calendar: *Meetings:* 5\n\n*Total engagements:* 51 across 28 contacts"
      }
    },
    {
      "type": "section",
      "text": {
        "type": "mrkdwn",
        "text": "*Most Active Contacts:*\n1. jane@acme.com — 8 engagements\n2. john@acme.com — 5 engagements\n3. alice@acme.com — 4 engagements"
      }
    },
    {
      "type": "section",
      "text": {
        "type": "mrkdwn",
        "text": "*Recent Conversation Notes:*\n• jane@acme.com (Mar 10): Discussed pricing, requested proposal\n• john@acme.com (Mar 9): Left voicemail, follow up Thursday"
      }
    }
  ]
}
```

---

### Manual Re-sync: `/hubspot sync`

**Trigger:** User types `/hubspot sync`

**Flow:**
```
/hubspot sync
  │
  ├── 1. Validate HubSpot connection exists
  │
  ├── 2. Check for pending unsynced activity events
  │
  ├── 3. Enqueue BullMQ job (hubspot-activity-sync) for batch retry
  │
  └── 4. Post acknowledgment to Slack
```

**Slack Response:**
```
Syncing activity to HubSpot... Found 3 pending events. You'll be notified when complete.
```

---

## Activity Push (Automatic)

### Push Triggers

Activity is pushed to HubSpot automatically when these events occur:

| Event | Source | HubSpot Engagement Type |
|-------|--------|------------------------|
| Call completed | Campaign workflow | `CALL` |
| Email delivered | Instantly/HeyReach webhook | `EMAIL` |
| Meeting booked | Calendar integration | `MEETING` |

### BullMQ Job: `hubspot-activity-sync`

```typescript
interface HubSpotActivitySyncJobData {
  connectionId: string;      // HubSpotConnection UUID
  eventType: 'call' | 'email' | 'meeting';
  eventId: string;           // Internal event/activity ID
  eventSource: string;       // "campaign", "instantly", "heyreach"
  contactEmail: string;      // Contact to associate engagement with
  engagementData: {
    // Call-specific
    callDuration?: number;   // seconds
    callOutcome?: string;    // "CONNECTED", "NO_ANSWER", "LEFT_VOICEMAIL", etc.
    callNotes?: string;
    // Email-specific
    emailSubject?: string;
    emailBodyPreview?: string;
    emailDirection?: 'OUTBOUND' | 'INBOUND';
    // Meeting-specific
    meetingTitle?: string;
    meetingStartTime?: string; // ISO 8601
    meetingEndTime?: string;   // ISO 8601
    meetingAttendees?: string[];
    // Common
    timestamp: string;         // ISO 8601 when the activity occurred
  };
}
```

### Worker Processing Steps

1. Load `HubSpotConnection` and validate ACTIVE status
2. Get valid access token (auto-refresh if needed)
3. **Idempotency check**: Query `HubSpotEngagementMapping` for `(connectionId, eventType, eventId, eventSource)` — skip if already logged
4. **Contact lookup**: Check `HubSpotContactMapping` for the email — if no mapping exists, upsert contact in HubSpot by email, then create mapping
5. Create engagement in HubSpot:
   ```
   POST /crm/v3/objects/engagements
   {
     "properties": {
       "hs_engagement_type": "CALL",
       "hs_timestamp": "2026-03-10T14:00:00Z",
       "hs_call_duration": "300000",
       "hs_call_disposition": "CONNECTED",
       "hs_call_body": "Discussed pricing options"
     },
     "associations": [
       {
         "to": { "id": "{hubspotContactId}" },
         "types": [{ "associationCategory": "HUBSPOT_DEFINED", "associationTypeId": 194 }]
       }
     ]
   }
   ```
6. Create `HubSpotEngagementMapping` record (idempotency marker)
7. Create `HubSpotSyncLog` record
8. Update `HubSpotConnection.totalActivitiesLogged` and `lastSyncAt`

### Error Handling

| Error | Source | Handling |
|-------|--------|----------|
| Contact not found in HubSpot | HubSpot API | Upsert contact by email first, then retry engagement creation |
| Rate limited (429) | HubSpot API | Exponential backoff, retry after delay |
| Token expired | HubSpot API | Auto-refresh token, retry |
| Duplicate engagement | Idempotency check | Skip silently (already logged) |
| HubSpot unavailable | HubSpot API | Retry with backoff (max 3 attempts), log failure in HubSpotSyncLog |
| Client not connected | DB lookup | Skip sync gracefully, no error |

---

## Internal Service Contract

### HubSpotActivityService

```typescript
interface HubSpotActivityService {
  /** Query HubSpot for activity for a specific contact within a date range */
  getContactActivity(params: {
    clientId: string;
    email: string;
    startDate: Date;
    endDate: Date;
  }): Promise<HubSpotActivity[]>;

  /**
   * Get activity summary across all synced contacts within a date range.
   * Uses HubSpot Search API (batch) filtering by associated contact IDs
   * to avoid N+1 per-contact calls.
   */
  getActivitySummary(params: {
    clientId: string;
    startDate: Date;
    endDate: Date;
  }): Promise<HubSpotActivitySummary>;

  /** Push a single activity event to HubSpot */
  pushActivity(params: {
    connectionId: string;
    eventType: 'call' | 'email' | 'meeting';
    eventId: string;
    eventSource: string;
    contactEmail: string;
    engagementData: Record<string, any>;
  }): Promise<void>;

  /** Retry all failed/pending activity syncs for a client */
  retrySyncs(clientId: string): Promise<{ queued: number }>;
}

interface HubSpotActivity {
  type: 'call' | 'email' | 'meeting';
  timestamp: Date;
  subject?: string;
  outcome?: string;
  duration?: number;
  notes?: string;
  contactEmail?: string;
}

interface HubSpotActivitySummary {
  dateRange: { start: Date; end: Date };
  totalEngagements: number;
  calls: number;
  emails: number;
  meetings: number;
  uniqueContacts: number;
  topContacts: { email: string; count: number }[];
  recentNotes: { email: string; date: Date; note: string }[];
}
```

### Batch Query Approach (HubSpot Search API)

For all-contacts summary queries, the system uses HubSpot's Search API to fetch engagements in batch:

```
POST /crm/v3/objects/engagements/search
{
  "filterGroups": [{
    "filters": [
      {
        "propertyName": "hs_timestamp",
        "operator": "BETWEEN",
        "highValue": "2026-03-11T23:59:59Z",
        "value": "2026-03-04T00:00:00Z"
      }
    ]
  }],
  "properties": ["hs_engagement_type", "hs_timestamp", "hs_call_body", "hs_email_subject", "hs_meeting_title"],
  "limit": 100,
  "after": 0
}
```

Results are filtered client-side to include only engagements associated with contacts in `HubSpotContactMapping` for this client. Pagination via `after` cursor handles large result sets.
