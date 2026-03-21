# API Contracts: Client Config Document Upload

**Feature**: 13-client-doc-upload | **Date**: 2026-03-10

## Base Path

All upload endpoints: `POST/GET/PUT/DELETE /api/v1/upload/*`
Auth: Upload token JWT via `?token=<jwt>` query parameter (not admin session).

Channel-client mapping endpoints: `POST/GET/DELETE /api/v1/admin/channel-mappings/*`
Auth: Admin session or X-Admin-Key header (existing admin auth).

---

## Upload Token Endpoints

### POST /api/v1/upload/validate-token

Validates the JWT token and returns channel context. Called on page load.

**Auth**: Token in query param `?token=<jwt>`

**Response 200:**
```json
{
  "valid": true,
  "teamId": "T12345",
  "channelId": "C12345",
  "channelName": "sales-acme",
  "userId": "U12345",
  "clientName": "Acme Corp",
  "clientId": "uuid-or-null"
}
```

**Response 401:**
```json
{
  "valid": false,
  "error": "Token expired. Please run /upload again in Slack."
}
```

---

## Config Document CRUD Endpoints

### GET /api/v1/upload/docs?token=<jwt>

Returns all config documents for the channel encoded in the token.

**Response 200:**
```json
{
  "channelId": "C12345",
  "channelName": "sales-acme",
  "clientName": "Acme Corp",
  "docs": [
    {
      "id": "uuid",
      "docType": "ICP",
      "displayLabel": "ICP - Enterprise SaaS Companies",
      "originalFileName": "Acme ICP 2026.docx",
      "version": 3,
      "contentPreview": "First 500 chars of markdown...",
      "uploadedByUserId": "U12345",
      "uploadedAt": "2026-03-10T10:00:00Z",
      "s3DownloadUrl": "/api/v1/upload/docs/uuid/download?token=<jwt>",
      "contentSizeBytes": 45200
    },
    {
      "id": null,
      "docType": "USE_CASES",
      "displayLabel": null,
      "originalFileName": null,
      "version": 0,
      "contentPreview": null,
      "uploadedByUserId": null,
      "uploadedAt": null,
      "s3DownloadUrl": null,
      "contentSizeBytes": null
    }
  ]
}
```

Notes: Always returns exactly 4 entries (one per doc type). Missing docs have `id: null`.

---

### POST /api/v1/upload/docs?token=<jwt>

Upload a config document. Accepts multipart/form-data.

**Request Body (multipart/form-data):**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `file` | File | Yes | The file to upload |
| `docType` | String | Yes | One of: ICP, USE_CASES, CAMPAIGNS, SETTINGS |

**Response 201:**
```json
{
  "id": "uuid",
  "docType": "ICP",
  "displayLabel": "ICP - Enterprise SaaS Companies",
  "originalFileName": "Acme ICP 2026.docx",
  "version": 3,
  "contentPreview": "First 500 chars of markdown...",
  "uploadedByUserId": "U12345",
  "uploadedAt": "2026-03-10T10:05:00Z",
  "s3DownloadUrl": "/api/v1/upload/docs/uuid/download?token=<jwt>",
  "contentSizeBytes": 45200
}
```

**Response 400:**
```json
{
  "error": "File is empty or could not be converted to readable text."
}
```

**Response 413:**
```json
{
  "error": "File exceeds the 10 MB size limit."
}
```

**Side Effects:**
- Converts file to Markdown via `convertToMarkdown()`
- Uploads original file to S3
- Auto-generates display label via Claude Haiku
- Posts Slack confirmation message to the channel

---

### GET /api/v1/upload/docs/:id/content?token=<jwt>

Returns full Markdown content for preview.

**Response 200:**
```json
{
  "id": "uuid",
  "docType": "ICP",
  "displayLabel": "ICP - Enterprise SaaS Companies",
  "markdownContent": "# Ideal Customer Profile\n\n## Target Companies\n..."
}
```

**Response 404:**
```json
{
  "error": "Document not found."
}
```

---

### GET /api/v1/upload/docs/:id/download?token=<jwt>

Downloads the original uploaded file from S3.

**Response 200:** Binary file stream with headers:
```
Content-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document
Content-Disposition: attachment; filename="Acme ICP 2026.docx"
```

**Response 404:**
```json
{
  "error": "Original file not found."
}
```

---

### PUT /api/v1/upload/docs/:id/label?token=<jwt>

Rename the display label of a document.

**Request Body:**
```json
{
  "displayLabel": "ICP - Enterprise SaaS (Updated Q1)"
}
```

**Response 200:**
```json
{
  "id": "uuid",
  "docType": "ICP",
  "displayLabel": "ICP - Enterprise SaaS (Updated Q1)",
  "version": 3
}
```

**Validation:** `displayLabel` max 100 characters, non-empty.

---

### DELETE /api/v1/upload/docs/:id?token=<jwt>

Delete a config document. Hard delete (matches existing behavior).

**Response 200:**
```json
{
  "deleted": true,
  "docType": "ICP"
}
```

**Response 404:**
```json
{
  "error": "Document not found."
}
```

**Side Effects:**
- Deletes S3 original file
- Posts Slack confirmation message: "ICP document removed by <user>"

---

## Channel-Client Mapping Endpoints (Admin)

### GET /api/v1/admin/channel-mappings

List all channel-to-client mappings.

**Auth**: Admin session

**Query Params:** `?teamId=T12345` (optional filter)

**Response 200:**
```json
{
  "mappings": [
    {
      "id": "uuid",
      "slackTeamId": "T12345",
      "slackChannelId": "C12345",
      "channelName": "sales-acme",
      "clientId": "uuid",
      "clientName": "Acme Corp",
      "createdAt": "2026-03-10T10:00:00Z"
    }
  ]
}
```

---

### POST /api/v1/admin/channel-mappings

Create a channel-to-client mapping.

**Auth**: Admin session

**Request Body:**
```json
{
  "slackTeamId": "T12345",
  "slackChannelId": "C12345",
  "clientId": "uuid"
}
```

**Response 201:**
```json
{
  "id": "uuid",
  "slackTeamId": "T12345",
  "slackChannelId": "C12345",
  "clientId": "uuid",
  "clientName": "Acme Corp"
}
```

**Response 409:**
```json
{
  "error": "Channel already mapped to a client."
}
```

---

### DELETE /api/v1/admin/channel-mappings/:id

Remove a channel-to-client mapping.

**Auth**: Admin session

**Response 200:**
```json
{
  "deleted": true
}
```

---

## Slack Command

### /upload

**Registration**: `app.command('/upload', handler)`

**Behavior**:
1. `ack()` immediately
2. Generate JWT token with `{ teamId, channelId, userId, purpose: 'config-upload' }`
3. Build dashboard URL: `https://{dashboardDomain}/upload/{token}`
4. Respond ephemeral with Block Kit message containing the link

**Ephemeral Response Blocks:**
```json
{
  "response_type": "ephemeral",
  "blocks": [
    {
      "type": "section",
      "text": {
        "type": "mrkdwn",
        "text": ":page_facing_up: *Upload Config Documents*\nClick the link below to manage your channel's configuration documents (ICP, Use Cases, Campaigns, Settings)."
      }
    },
    {
      "type": "actions",
      "elements": [
        {
          "type": "button",
          "text": { "type": "plain_text", "text": "Open Upload Page" },
          "url": "https://{dashboardDomain}/upload/{token}",
          "style": "primary"
        }
      ]
    },
    {
      "type": "context",
      "elements": [
        {
          "type": "mrkdwn",
          "text": "This link expires in 24 hours."
        }
      ]
    }
  ]
}
```

**Error Cases:**
- DM context (no channel): Respond with "This command must be used in a channel."
