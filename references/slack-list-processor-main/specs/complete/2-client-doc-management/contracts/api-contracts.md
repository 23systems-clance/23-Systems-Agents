# API Contracts: Client Document Management

**Feature Branch**: `2-client-doc-management`
**Date**: 2026-03-05

## 1. Slack Event Handlers

### 1.1 Document Upload Detection (file_shared)

**Trigger**: `file_shared` event in a recognized docs channel
**Handler**: `src/listeners/events/fileSharedDocument.ts`

**Flow**:
1. Receive `file_shared` event
2. Check if `channel_id` is a recognized docs channel (naming convention or registered)
3. If NOT a docs channel → fall through to existing `fileShared.ts` enrichment handler
4. If IS a docs channel → enter document management flow
5. Fetch file metadata via `client.files.info`
6. Validate MIME type is supported
7. Validate file size <= 1 MB
8. If markdown/text: download, classify (filename or AI), post classification buttons
9. If PDF/DOCX/XLSX: post "Converting..." acknowledgment, enqueue conversion job

**Supported MIME Types**:
```
text/markdown                                                          → .md
text/plain                                                             → .md, .txt
application/pdf                                                        → .pdf
application/vnd.openxmlformats-officedocument.wordprocessingml.document → .docx
application/vnd.openxmlformats-officedocument.spreadsheetml.sheet      → .xlsx
```

### 1.2 Document Type Confirmation (action: doc_type_confirm)

**Trigger**: User clicks a document type button after upload
**Handler**: `src/listeners/actions/documentTypeConfirm.ts`
**Action IDs**: `doc_type_icp`, `doc_type_use_case`, `doc_type_settings`, `doc_type_one_pager`, `doc_type_unknown`

**Request** (Slack action payload):
```json
{
  "type": "block_actions",
  "actions": [{
    "action_id": "doc_type_icp",
    "block_id": "doc_classify_<fileId>"
  }],
  "user": { "id": "U123", "team_id": "T456" },
  "channel": { "id": "C789" },
  "message": { "ts": "1234567890.123456" }
}
```

**Response** (Block Kit update):
```json
{
  "text": "Indexed *acme-icp*\nType: ICP\nSummary: Acme Corp targeting criteria for mid-market SaaS companies.\n\nReference in enrichment commands:\n`ENRICH this list using acme-icp`"
}
```

### 1.3 Document Management Commands (message)

**Trigger**: Message starting with "ENRICH" in the existing message listener
**Handler**: Extended `src/listeners/events/message.ts`

**New command patterns** (detected before intent classification):

| Pattern | Action |
|---------|--------|
| `ENRICH docs` | List all active documents for the team |
| `ENRICH delete doc <slug>` | Archive a document (permission check) |
| `ENRICH refresh toc` | Regenerate table of contents |
| `ENRICH this list using <slug>` | Reference detection (passed to orchestrator) |

### 1.4 Document Reference Detection

**Trigger**: ENRICH message containing document slug references
**Handler**: Extended `src/listeners/events/message.ts` (pre-orchestrator step)

**Detection patterns**:
```
ENRICH ... using <slug> ...
ENRICH ... with <slug> ...
ENRICH ... using <slug1> and <slug2> ...
```

**Flow**:
1. Parse ENRICH message for slug references using regex
2. For each potential slug, search `ClientDocument` table across all docs channels in the workspace (`slack_team_id` scoped, `status=ACTIVE`)
3. If slug found in exactly one channel → use that document
4. If slug found in multiple channels → post disambiguation prompt with channel names, wait for user selection
5. If slug not found → respond with "not found" message and list available documents
6. Fetch document content from S3
7. If SETTINGS type: parse YAML front matter → extract overrides
8. Pass combined document content as `documentContext` parameter to `classifyIntent()`
9. Store referenced slug list (with channel context) on the Job record

## 2. Slack Interactive Messages (Block Kit)

### 2.1 Document Classification Prompt

Posted after a document is uploaded and initial classification is determined.

```json
{
  "blocks": [
    {
      "type": "section",
      "text": {
        "type": "mrkdwn",
        "text": "Received *acme-icp.md*\n\nSuggested type: *ICP* (from filename)\n\nPlease confirm or select the correct document type:"
      }
    },
    {
      "type": "actions",
      "block_id": "doc_classify_<fileId>",
      "elements": [
        {
          "type": "button",
          "text": { "type": "plain_text", "text": "ICP" },
          "action_id": "doc_type_icp",
          "style": "primary"
        },
        {
          "type": "button",
          "text": { "type": "plain_text", "text": "Use Case" },
          "action_id": "doc_type_use_case"
        },
        {
          "type": "button",
          "text": { "type": "plain_text", "text": "Settings" },
          "action_id": "doc_type_settings"
        },
        {
          "type": "button",
          "text": { "type": "plain_text", "text": "One-Pager" },
          "action_id": "doc_type_one_pager"
        }
      ]
    }
  ]
}
```

### 2.2 Document List Response (ENRICH docs)

```json
{
  "blocks": [
    {
      "type": "header",
      "text": { "type": "plain_text", "text": "Client Documents" }
    },
    {
      "type": "section",
      "text": {
        "type": "mrkdwn",
        "text": "*ICP (Ideal Customer Profiles)*\n- `acme-icp` -- Acme Corp targeting criteria (v2)\n- `globex-icp` -- Globex Corp ICP for enterprise (v1)\n\n*Use Cases*\n- `security-usecase` -- Security enrichment scenario (v1)\n\n*Settings*\n- `acme-settings` -- Acme Corp configuration (v3)\n\n*One-Pagers*\n- `product-overview` -- Product overview for cold outreach (v1)"
      }
    },
    {
      "type": "context",
      "elements": [
        { "type": "mrkdwn", "text": "5 active documents | Use `ENRICH delete doc <name>` to archive" }
      ]
    }
  ]
}
```

## 3. BullMQ Job Contracts

### 3.1 Document Conversion Queue

**Queue name**: `document-processing`

**Job data interface**:
```typescript
interface DocumentConversionJobData {
  /** Slack team ID for multi-tenant isolation. */
  teamId: string;
  /** Channel where the document was uploaded. */
  channelId: string;
  /** Thread timestamp for posting conversion result. */
  threadTs: string;
  /** Slack user ID of the uploader. */
  userId: string;
  /** Slack file ID for downloading the original file. */
  slackFileId: string;
  /** Original filename. */
  fileName: string;
  /** MIME type of the original file. */
  mimeType: string;
  /** User-confirmed document type (if already confirmed before conversion). */
  confirmedDocumentType?: 'ICP' | 'USE_CASE' | 'SETTINGS' | 'ONE_PAGER' | 'UNKNOWN';
}
```

**Worker**: `src/services/queue/workers/documentConversion.ts`

**Flow**:
1. Download file from Slack via `url_private_download` with bot token
2. Convert to markdown using appropriate converter (by MIME type)
3. Validate converted markdown size <= 500 KB
4. Upload markdown to S3 (`docs/{teamId}/{slug}.md`)
5. If document type not yet confirmed: classify via AI, post buttons
6. If document type already confirmed: index directly, post confirmation

**Default job options**: 3 attempts, exponential backoff (5s base)

## 4. AI Tool Contracts

### 4.1 Document Classifier

**Tool name**: `classify_document`
**Model**: Claude 3.5 Haiku (claude-haiku-4-5-20251001)
**Max tokens**: 200

```typescript
const CLASSIFY_DOCUMENT_TOOL: Anthropic.Messages.Tool = {
  name: 'classify_document',
  description: 'Classify an uploaded document into a document type and generate a summary',
  input_schema: {
    type: 'object',
    properties: {
      document_type: {
        type: 'string',
        enum: ['ICP', 'USE_CASE', 'SETTINGS', 'ONE_PAGER', 'UNKNOWN'],
        description: 'The classified document type',
      },
      confidence: {
        type: 'number',
        description: 'Classification confidence between 0 and 1',
      },
      suggested_label: {
        type: 'string',
        description: 'A short human-readable label for the document',
      },
      summary: {
        type: 'string',
        description: 'One-sentence description of the document content',
      },
    },
    required: ['document_type', 'confidence', 'suggested_label', 'summary'],
  },
};
```

**System prompt**:
```
You are a document classifier for a sales enrichment platform. Users upload documents to configure how company lists are enriched. Classify each document into exactly one type:

1. ICP (Ideal Customer Profile) - Targeting criteria, audience definitions, company filters
2. USE_CASE - Enrichment scenarios, workflow descriptions, campaign strategies
3. SETTINGS - Configuration with key-value pairs (decision makers count, personas, integrations)
4. ONE_PAGER - Marketing materials, product overviews, sales collateral, company briefs
5. UNKNOWN - Does not clearly match any category

Generate a concise one-sentence summary suitable for a table of contents.
```

### 4.2 Extended Intent Classifier (existing, modified)

The existing `classifyIntent()` function gains an optional `documentContext` parameter:

```typescript
export async function classifyIntent(
  userMessage: string,
  documentContext?: string,
): Promise<IntentResult>;
```

When `documentContext` is provided, it is appended to the system prompt:

```
--- Referenced Document Context ---
{documentContext}

Use this context to better understand the user's enrichment preferences. If the context includes ICP criteria, persona priorities, or configuration settings, incorporate them into your classification and parameter extraction.
```

## 5. REST API Endpoints (optional, future)

### 5.1 List Documents

`GET /api/v1/documents`

**Headers**: `X-API-Key: <api_key>`
**Query params**: `?team_id=T456&type=ICP&status=ACTIVE`

**Response**: `200 OK`
```json
{
  "documents": [
    {
      "id": "uuid",
      "slug": "acme-icp",
      "label": "Acme ICP",
      "documentType": "ICP",
      "summary": "Acme Corp targeting criteria for mid-market SaaS",
      "status": "ACTIVE",
      "version": 2,
      "uploadedBy": "U123",
      "channelId": "C789",
      "createdAt": "2026-03-05T10:00:00Z",
      "updatedAt": "2026-03-05T14:30:00Z"
    }
  ],
  "total": 1
}
```

### 5.2 Get Document Content

`GET /api/v1/documents/:slug`

**Headers**: `X-API-Key: <api_key>`
**Query params**: `?team_id=T456`

**Response**: `200 OK`
```json
{
  "document": {
    "slug": "acme-icp",
    "label": "Acme ICP",
    "documentType": "ICP",
    "summary": "...",
    "version": 2,
    "content": "# Acme ICP\n\n## Target Companies\n..."
  }
}
```
