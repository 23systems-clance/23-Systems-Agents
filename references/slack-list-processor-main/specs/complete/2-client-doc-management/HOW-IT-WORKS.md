# Client Document Management -- How It Works

## Overview

This feature enables users to upload reference documents (ICP definitions, use cases, settings, one-pagers) to designated Slack "docs channels." Documents are converted to markdown, classified by AI, indexed in PostgreSQL, stored in S3, and can be referenced in enrichment commands to provide AI context and programmatic overrides.

---

## Architecture at a Glance

```
Slack Channel (ending in -docs/-documents)
  │
  ├── file_shared event
  │     ├── .md / .txt  ─────────────────────────────────────> Direct processing
  │     │                                                       │
  │     └── .pdf / .docx / .xlsx ──> BullMQ queue ──> Worker ──┘
  │                                                             │
  │                                                    ┌────────┘
  │                                                    ▼
  │                                            Classify (filename + AI)
  │                                                    │
  │                                                    ▼
  │                                          Post classification buttons
  │                                                    │
  │                                            User clicks button
  │                                                    │
  │                                                    ▼
  │                                           indexDocument() ──> PostgreSQL
  │                                                  │              + S3
  │                                                  └──> Regenerate TOC
  │
  ├── "VAULT docs"            ──> List all documents (Block Kit)
  ├── "VAULT delete doc X"    ──> Archive document (permission-checked)
  ├── "VAULT refresh toc"     ──> Regenerate TOC for all channels
  └── "ENRICH ... using X"    ──> Resolve doc refs for AI context
```

---

## Core Components

### 1. Channel Detection (`src/services/document/channelDetector.ts`)

Determines whether a Slack channel is a "docs channel" via three checks:

1. **Redis cache** -- `doc-channel:{teamId}` set (1hr TTL)
2. **DocsChannelConfig table** -- explicit registrations (future admin command)
3. **Regex match** -- channel name against `config.doc.channelPattern` (default: `-docs$|-documents$`)

Positive results are cached in Redis for fast repeated lookups. Returns `false` on errors to avoid accidentally routing enrichment uploads into the doc flow.

### 2. File Upload Listener (`src/listeners/events/fileSharedDocument.ts`)

Handles `file_shared` events in docs channels. Registered *before* the enrichment file handler in `app.ts` so it gets first pick.

**Validation checks:**
- Skip bot's own uploads
- MIME type must be in the supported set
- File size must be under `config.doc.maxFileSize` (default 1 MB)

**Two processing paths:**

| File type | Path |
|-----------|------|
| `.md`, `.txt` | Download, classify, post buttons, store Redis state |
| `.pdf`, `.docx`, `.xlsx` | Post "Converting..." ack, create PROCESSING record, enqueue BullMQ job |

### 3. Filename Classifier (`src/services/document/filenameClassifier.ts`)

Instant, zero-cost classification by filename prefix:

| Prefix | Document Type |
|--------|--------------|
| `icp-` | ICP |
| `usecase-` | USE_CASE |
| `settings-` | SETTINGS |
| `onepager-` | ONE_PAGER |
| *(other)* | `null` (falls through to AI) |

Also exports `generateSlug()` which strips extensions, lowercases, and normalizes to URL-safe hyphens.

### 4. AI Classifier (`src/services/ai/documentClassifier.ts`)

Falls back to Claude Haiku 4.5 when filename convention doesn't match. Uses forced tool_choice with a `classify_document` tool schema that returns:

```json
{
  "document_type": "ICP | USE_CASE | SETTINGS | ONE_PAGER | UNKNOWN",
  "confidence": 0.95,
  "suggested_label": "Acme ICP",
  "summary": "Targeting criteria for enterprise software companies"
}
```

Content is truncated to 2000 chars to conserve tokens. Cost/usage data is returned for tracking.

### 5. Document Converter (`src/services/document/converter.ts`)

Converts non-markdown files to markdown:

| Format | Library | Approach |
|--------|---------|----------|
| PDF | `pdf-parse` | Text extraction, wrapped in minimal markdown |
| DOCX | `mammoth` + `turndown` | HTML intermediate, GFM plugin for tables |
| XLSX | `xlsx` (SheetJS) | Each sheet becomes a GFM markdown table |

Handles password-protected files with friendly errors. Validates converted output doesn't exceed `config.doc.maxMarkdownSize` (default 500 KB). Warns on near-empty output (< 50 chars).

### 6. Conversion Worker (`src/services/queue/workers/documentConversion.ts`)

BullMQ worker on the `document-processing` queue (concurrency: 2).

**Job flow:**
1. Download original file from Slack
2. Convert to markdown
3. Upload markdown to S3: `docs/{teamId}/{channelId}/{slug}.md`
4. Upload original to S3: `docs/{teamId}/{channelId}/originals/{slug}-{fileId}.{ext}`
5. Classify (filename + AI)
6. Post classification buttons in thread
7. Store pending state in Redis

**On failure:** Posts error in thread and creates a FAILED ClientDocument record.

### 7. Type Confirmation Handler (`src/listeners/actions/documentTypeConfirm.ts`)

Handles button clicks for `doc_type_icp`, `doc_type_use_case`, `doc_type_settings`, `doc_type_one_pager`, `doc_type_unknown`.

**Flow:**
1. Retrieve pending state from Redis (`doc-classify:{channelId}:{messageTs}`)
2. If expired (>1hr), reply "session expired"
3. Call `indexDocument()` with confirmed type
4. Update Slack message: remove buttons, show confirmation with slug reference example
5. Delete Redis state

### 8. Document Indexer (`src/services/document/indexer.ts`)

Upserts documents into PostgreSQL with version archival, wrapped in a Prisma interactive transaction to handle concurrent uploads.

**Re-upload flow (same slug in same channel):**
1. Download previous version from S3
2. Archive to `docs/{teamId}/{channelId}/{slug}-v{N}.md`
3. Increment version
4. Update all fields, set status = ACTIVE

After indexing: logs `doc_classify` audit event and fire-and-forget regenerates the channel TOC.

### 9. Settings Parser (`src/services/document/settingsParser.ts`)

Extracts YAML front matter from SETTINGS documents using `gray-matter`. Validates recognized keys:

| Key | Type | Constraints |
|-----|------|-------------|
| `decision_makers` | number | 1--10 |
| `personas` | string[] | -- |
| `max_rows` | number | 1--5000 |
| `instantly_campaign_id` | string | -- |
| `purpose` | string | -- |

Unrecognized keys pass through for extensibility and AI context.

### 10. Reference Resolver (`src/services/document/referenceResolver.ts`)

Resolves document slug references from ENRICH messages. Searches across ALL docs channels in the workspace.

**Slug extraction patterns:**
- `"using slug1 and slug2"` -- captures both
- `"using slug"` -- single reference
- `"with slug"` -- alternative syntax

Stop words (this, that, the, etc.) are filtered out.

**Resolution per slug:**

| Condition | Result |
|-----------|--------|
| Found in 1 channel | Download from S3, truncate to 4000 chars, return content |
| Found in multiple channels | Added to `ambiguous` list for disambiguation |
| Not found, but archived exists | Added to `archived` list |
| Not found at all | Added to `notFound` list; similar slugs suggested |

SETTINGS documents have their YAML front matter parsed and returned as `parsedSettings`.

### 11. TOC Generator (`src/services/document/tocGenerator.ts`)

Auto-generates a table of contents for each docs channel whenever documents are created, updated, or archived.

**Format:**
```markdown
# Table of Contents

*8 active documents*

## ICP (Ideal Customer Profiles)
- `icp-acme` -- Enterprise targeting criteria (v3, updated 2025-03-01)
- `icp-techco` -- Mid-market tech companies (v1, updated 2025-02-28)

## Use Cases
- `usecase-cold-calling` -- Outbound campaign workflow (v2, updated 2025-03-01)

## Settings
- `settings-default` -- Default enrichment config (v1, updated 2025-02-25)
```

Uploaded to S3 at `docs/{teamId}/{channelId}/table-of-contents.md` and cached in Redis (`toc:{teamId}:{channelId}`, 5min TTL).

### 12. List Formatter (`src/services/document/listFormatter.ts`)

Formats all active documents for a team as Slack Block Kit blocks, grouped by channel then by type. Respects Slack's 50-block limit with truncation footer.

### 13. Document Archiver (`src/services/document/archiver.ts`)

Soft-deletes documents by setting status to ARCHIVED.

**Permission check:** Only the original uploader or a workspace admin can archive.

After archiving: logs `doc_archive` audit event and regenerates the channel TOC.

---

## Data Flow: Complete Upload-to-Reference Lifecycle

### Step 1: Upload

```
User uploads "acme-icp.md" to #client-docs
  → file_shared event
  → isDocsChannel() returns true
  → Download content from Slack
  → classifyByFilename("acme-icp.md") → null (no prefix match)
  → classifyDocument(content) → {type: ICP, label: "Acme ICP", summary: "..."}
  → Upload to S3: docs/T123/C456/acme-icp.md
  → Post buttons: [ICP*] [Use Case] [Settings] [One-Pager]
  → Store state in Redis (1hr TTL)
```

### Step 2: Confirm

```
User clicks [ICP]
  → Retrieve state from Redis
  → indexDocument({slug: "acme-icp", type: ICP, ...})
    → INSERT ClientDocument (version 1, status ACTIVE)
    → Regenerate TOC
  → Update message: "Indexed `acme-icp` -- Type: ICP"
  → Delete Redis state
```

### Step 3: Reference in Enrichment

```
User: "ENRICH this list using acme-icp and settings-default"
  → extractSlugsFromMessage() → ["acme-icp", "settings-default"]
  → resolveDocumentReferences(teamId, slugs)
    → acme-icp: download from S3, truncate to 4000 chars
    → settings-default: download, parse YAML → {decision_makers: 3, ...}
  → Build documentContext string
  → Pass to AI orchestrator as additional context
  → Apply settingsOverrides to Job record
  → Log doc_reference audit events
```

### Step 4: Re-upload (Version Bump)

```
User uploads updated "acme-icp.md" to same channel
  → Same upload flow
  → User confirms [ICP]
  → indexDocument() detects existing record
    → Archive v1: docs/T123/C456/acme-icp-v1.md
    → UPDATE ClientDocument: version=2, new content
    → Regenerate TOC
```

### Step 5: Archive

```
User: "VAULT delete doc acme-icp"
  → Permission check (uploader or admin)
  → UPDATE status = ARCHIVED
  → Regenerate TOC (doc removed from listing)
  → Future references return "archived" status
```

---

## Database Schema

### ClientDocument

| Field | Type | Notes |
|-------|------|-------|
| id | UUID | Primary key |
| slackTeamId | String | Workspace scope |
| slackChannelId | String | Channel scope |
| slackUserId | String | Uploader |
| slug | String | URL-safe identifier |
| label | String | Human-readable name |
| summary | String? | AI-generated one-liner |
| documentType | DocumentType | ICP, USE_CASE, SETTINGS, ONE_PAGER, UNKNOWN |
| status | DocumentStatus | PROCESSING, ACTIVE, FAILED, ARCHIVED |
| version | Int | Increments on re-upload |
| s3Key | String | Current markdown location |
| parsedSettings | Json? | YAML front matter for SETTINGS docs |
| contentSizeBytes | Int? | Markdown size |

**Unique constraint:** `[slackTeamId, slackChannelId, slug]` -- same slug can exist in different channels.

### DocsChannelConfig

Stores explicitly registered docs channels. Currently populated only by the regex-matching flow; future admin commands will insert directly.

---

## Redis Key Patterns

| Key | Type | TTL | Purpose |
|-----|------|-----|---------|
| `doc-channel:{teamId}` | SET | 1hr | Cached docs channel IDs |
| `doc-classify:{channelId}:{messageTs}` | HASH | 1hr | Pending classification state |
| `toc:{teamId}:{channelId}` | STRING | 5min | Cached TOC markdown |

---

## S3 Key Patterns

| Pattern | Example | Purpose |
|---------|---------|---------|
| `docs/{teamId}/{channelId}/{slug}.md` | `docs/T123/C456/acme-icp.md` | Current version |
| `docs/{teamId}/{channelId}/{slug}-v{N}.md` | `docs/T123/C456/acme-icp-v1.md` | Archived version |
| `docs/{teamId}/{channelId}/originals/{slug}-{fileId}.{ext}` | `docs/T123/C456/originals/overview-F789.pdf` | Original upload |
| `docs/{teamId}/{channelId}/table-of-contents.md` | `docs/T123/C456/table-of-contents.md` | Generated TOC |

---

## Slack Commands

| Command | Description |
|---------|-------------|
| `VAULT docs` | List all documents grouped by channel and type |
| `VAULT delete doc {slug}` | Archive a document (owner/admin only) |
| `VAULT refresh toc` | Regenerate table of contents for all channels |
| `ENRICH ... using {slug}` | Reference document(s) in enrichment for AI context |

---

## Audit Trail

All actions logged to the AuditLog table (append-only):

| Action | When |
|--------|------|
| `doc_upload` | File uploaded to docs channel |
| `doc_classify` | Document type confirmed and indexed |
| `doc_reference` | Document referenced in enrichment command |
| `doc_archive` | Document archived |

---

## Error Handling

| Scenario | Behavior |
|----------|----------|
| Unsupported file type | Post error listing supported formats |
| File too large (>1MB) | Post size limit error |
| Password-protected PDF/XLSX | Friendly error asking for unprotected version |
| Conversion output too large (>500KB) | Worker posts size limit error, creates FAILED record |
| Conversion output near-empty (<50 chars) | Warning that content may not be useful |
| Classification buttons expired (>1hr) | "Session expired, please re-upload" |
| Slug not found during reference | Added to notFound; similar slugs suggested |
| Slug ambiguous (multiple channels) | Added to ambiguous list for user disambiguation |
| Concurrent uploads with same slug | Prisma transaction prevents race conditions |
| Archive permission denied | Error message identifying required permissions |

---

## Configuration (`config.doc`)

| Variable | Default | Description |
|----------|---------|-------------|
| `maxFileSize` | 1,048,576 (1 MB) | Maximum raw upload size |
| `maxMarkdownSize` | 524,288 (500 KB) | Maximum converted markdown size |
| `maxContextChars` | 4,000 | Max chars per document injected into AI context |
| `channelPattern` | `-docs$\|-documents$` | Regex for auto-detecting docs channels |

---

## File Map

```
src/
├── config/index.ts                              # doc.* config section
├── lib/
│   ├── auditLogger.ts                           # doc_upload/classify/reference/archive actions
│   ├── redis.ts                                 # Shared Redis client
│   └── storage.ts                               # S3 upload/download/presign
├── listeners/
│   ├── actions/
│   │   └── documentTypeConfirm.ts               # Classification button handlers
│   └── events/
│       ├── fileShared.ts                         # Early return for docs channels
│       ├── fileSharedDocument.ts                 # Document upload detection + processing
│       └── message.ts                            # VAULT docs/delete/refresh commands + ENRICH ref resolution
├── services/
│   ├── ai/
│   │   ├── documentClassifier.ts                # Claude Haiku classification
│   │   └── orchestrator.ts                      # Extended with documentContext param
│   ├── document/
│   │   ├── archiver.ts                          # Permission-checked archival
│   │   ├── channelDetector.ts                   # Docs channel detection (Redis + DB + regex)
│   │   ├── converter.ts                         # PDF/DOCX/XLSX → markdown
│   │   ├── filenameClassifier.ts                # Prefix-based classification + slug generation
│   │   ├── indexer.ts                           # Upsert with version archival (transactional)
│   │   ├── listFormatter.ts                     # Block Kit document list
│   │   ├── referenceResolver.ts                 # Cross-channel slug resolution
│   │   ├── settingsParser.ts                    # YAML front matter extraction
│   │   └── tocGenerator.ts                      # Auto-generated table of contents
│   └── queue/
│       ├── queues.ts                            # documentProcessingQueue definition
│       └── workers/
│           └── documentConversion.ts            # BullMQ conversion worker
├── types/
│   └── vendor.d.ts                              # turndown-plugin-gfm types
└── app.ts                                       # Listener + worker registration

prisma/
└── schema.prisma                                # ClientDocument, DocsChannelConfig, DocumentType, DocumentStatus
```
