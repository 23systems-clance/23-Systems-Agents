# API Contract: HubSpot Webhook Notifications

**Feature**: 14-hubspot-integration | **Date**: 2026-03-10

## Webhook Endpoint

### `POST /api/webhooks/hubspot`

**Purpose:** Receive HubSpot webhook events for deal stage changes and notify the client's Slack channel.

**Route:** Express router mounted at `/api/webhooks/hubspot` in `src/routes/hubspot/webhooks.ts`

**Authentication:** HubSpot webhook signature validation (X-HubSpot-Signature)

---

### Request Format (from HubSpot)

HubSpot sends webhook events as batches:

```json
[
  {
    "eventId": 1,
    "subscriptionId": 12345,
    "portalId": 67890,
    "appId": 11111,
    "occurredAt": 1709913600000,
    "subscriptionType": "deal.propertyChange",
    "attemptNumber": 0,
    "objectId": 456789,
    "propertyName": "dealstage",
    "propertyValue": "closedwon",
    "changeSource": "CRM",
    "sourceId": "user:123"
  }
]
```

### Processing Flow

```
POST /api/webhooks/hubspot
  │
  ├── 1. Validate X-HubSpot-Signature header
  │      └── HMAC-SHA256(client_secret + request_body)
  │      └── Reject with 401 if invalid
  │
  ├── 2. Respond 200 immediately (within 5 seconds)
  │
  ├── 3. Process events asynchronously:
  │      │
  │      ├── For each event in batch:
  │      │    │
  │      │    ├── 3a. Look up HubSpotConnection by portalId
  │      │    │       └── Skip if no active connection
  │      │    │
  │      │    ├── 3b. Filter for deal.propertyChange where
  │      │    │       propertyName = "dealstage"
  │      │    │
  │      │    ├── 3c. Fetch deal details from HubSpot API
  │      │    │       └── GET /crm/v3/objects/deals/{objectId}
  │      │    │       └── Include associations (contacts)
  │      │    │
  │      │    ├── 3d. Check if associated contact exists in
  │      │    │       HubSpotContactMapping (was imported by us)
  │      │    │       └── Skip notification if contact wasn't enriched/imported
  │      │    │
  │      │    ├── 3e. Resolve client's Slack channel via
  │      │    │       ChannelClientMapping
  │      │    │
  │      │    └── 3f. Post notification to Slack channel
  │      │
  │      └── 4. Log event processing in HubSpotSyncLog
```

### Signature Validation

```typescript
function validateHubSpotSignature(
  clientSecret: string,
  requestBody: string,
  signatureHeader: string
): boolean {
  const hash = crypto
    .createHash('sha256')
    .update(clientSecret + requestBody)
    .digest('hex');
  return hash === signatureHeader;
}
```

### Slack Notification (Block Kit)

**Deal stage change notification:**

```json
{
  "blocks": [
    {
      "type": "section",
      "text": {
        "type": "mrkdwn",
        "text": ":tada: *Deal Update* — Closed Won!\n\n*Deal:* Enterprise License Agreement\n*Amount:* $45,000\n*Contact:* Jane Doe (jane@acme.com)\n*Stage:* Closed Won\n\n<https://app.hubspot.com/contacts/67890/deal/456789|View deal in HubSpot>"
      }
    },
    {
      "type": "context",
      "elements": [
        { "type": "mrkdwn", "text": "Via HubSpot webhook • Mar 10, 2026" }
      ]
    }
  ]
}
```

---

## Webhook Subscription Management

### App-Level Setup (One-Time, During Developer App Configuration)

Webhook subscriptions are configured **once at the HubSpot Developer App level** — NOT per-client. All connected portals share the same subscription. Events are routed to the correct client by `portalId` in the event payload.

```
POST /webhooks/v3/{appId}/subscriptions
{
  "eventType": "deal.propertyChange",
  "propertyName": "dealstage",
  "active": true
}
```

This is done during initial HubSpot Developer App setup (see quickstart.md) and does not need to be repeated.

### On Connect (`/hubspot connect`)

No webhook-related actions. The app-level subscription already delivers events for all portals.

### On Disconnect (`/hubspot disconnect`)

No webhook-related actions. The webhook handler ignores events for portals without an active `HubSpotConnection` (looked up by `portalId`). Events for disconnected portals receive a 200 response to prevent HubSpot retries.

---

## Internal Service Contract

### HubSpotWebhookService

```typescript
interface HubSpotWebhookService {
  /** Validate webhook signature */
  validateSignature(requestBody: string, signatureHeader: string): boolean;

  /** Process a batch of webhook events */
  processEvents(events: HubSpotWebhookEvent[]): Promise<void>;

  /** Ensure webhook subscriptions are registered for the app */
  ensureSubscriptions(): Promise<void>;
}

interface HubSpotWebhookEvent {
  eventId: number;
  subscriptionId: number;
  portalId: number;
  appId: number;
  occurredAt: number;
  subscriptionType: string;
  objectId: number;
  propertyName?: string;
  propertyValue?: string;
}
```

---

## Error Handling

| Error | Source | Handling |
|-------|--------|----------|
| Invalid signature | Webhook validation | Reject with 401, log security warning |
| Unknown portal | DB lookup | Skip event, respond 200 (prevent HubSpot retries) |
| Deal fetch fails | HubSpot API | Log error, skip notification for this event |
| Contact not in our mappings | DB lookup | Skip notification (deal is for a non-enriched contact) |
| Slack post fails | Slack API | Log error, event still marked as processed |
| Batch too large | HubSpot | Process sequentially, respond 200 within 5s deadline |
