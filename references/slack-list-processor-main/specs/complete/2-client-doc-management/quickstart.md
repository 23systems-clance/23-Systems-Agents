# Quickstart: Client Document Management

**Feature Branch**: `2-client-doc-management`
**Date**: 2026-03-05
**Prerequisites**: Feature 1 (Slack List Processor) fully deployed and operational

## 1. Install New Dependencies

```bash
npm install mammoth turndown turndown-plugin-gfm pdf-parse gray-matter
npm install -D @types/turndown @types/pdf-parse
```

## 2. Environment Variables

Add the following to your `.env` file (existing variables from feature 1 remain unchanged):

```bash
# Document Management (Feature 2)
# No new required env vars -- uses existing S3, Redis, PostgreSQL, and Anthropic config.
# Optional: override defaults below.

# Maximum raw file upload size in bytes (default: 1048576 = 1 MB)
DOC_MAX_FILE_SIZE=1048576

# Maximum converted markdown size in bytes (default: 524288 = 500 KB)
DOC_MAX_MARKDOWN_SIZE=524288

# Maximum characters of document content injected as AI context (default: 4000)
DOC_MAX_CONTEXT_CHARS=4000

# Docs channel naming pattern regex (default: -docs$|-documents$)
DOC_CHANNEL_PATTERN=-docs$|-documents$
```

## 3. Database Migration

```bash
npx prisma migrate dev --name add-client-documents
```

This creates:
- `client_documents` table with slug, document_type, status, version, s3_key, parsed_settings, etc.
- `docs_channel_configs` table for explicit channel registration
- New enums: `DocumentType` (ICP, USE_CASE, SETTINGS, ONE_PAGER, UNKNOWN) and `DocumentStatus` (PROCESSING, ACTIVE, FAILED, ARCHIVED)
- New fields on `jobs` table: `document_slugs`, `settings_overrides`
- New audit actions: `doc_upload`, `doc_classify`, `doc_archive`, `doc_reference`

## 4. Create a Docs Channel in Slack

1. Create a new Slack channel named `#client-docs` (or any name ending in `-docs` or `-documents`).
2. Invite the bot to the channel.
3. The bot auto-detects the channel as a docs channel via naming convention.

**Alternative**: Register any channel explicitly by future admin command (not in v1 scope -- naming convention is the primary mechanism).

## 5. Verify Setup

### Upload a Markdown Document
1. Go to `#client-docs` in Slack.
2. Upload a file named `acme-icp.md` with sample ICP content.
3. Bot should respond in a thread with classification buttons (ICP, Use Case, Settings, One-Pager).
4. Click a document type button.
5. Bot confirms: "Indexed *acme-icp* | Type: ICP | Summary: ..."

### Upload a PDF One-Pager
1. Upload a PDF file (< 1 MB) to `#client-docs`.
2. Bot posts "Converting..." acknowledgment.
3. After conversion completes, bot presents classification buttons.
4. Confirm the type.

### List Documents
Type in any channel where the bot is present:
```
ENRICH docs
```
Bot responds with a grouped list of all active documents.

### Reference a Document in Enrichment
Upload a CSV list and type:
```
ENRICH this list using acme-icp
```
The bot injects the document content as AI context for the enrichment.

## 6. File Structure (New Modules)

```text
src/
├── listeners/
│   ├── events/
│   │   └── fileSharedDocument.ts    # Document upload detection
│   └── actions/
│       └── documentTypeConfirm.ts   # Type confirmation buttons
├── services/
│   └── document/
│       ├── classifier.ts            # Filename + AI classification
│       ├── converter.ts             # PDF/DOCX/XLSX → markdown
│       ├── indexer.ts               # S3 upload + DB upsert + TOC trigger
│       ├── tocGenerator.ts          # Table of contents materialization
│       └── referenceResolver.ts     # Fetch doc content for AI context
└── services/
    └── queue/
        └── workers/
            └── documentConversion.ts # BullMQ conversion worker
```

## 7. S3 Storage Layout

```
docs/{teamId}/{channelId}/{slug}.md                     # Current version markdown
docs/{teamId}/{channelId}/{slug}-v{N}.md                # Previous version archive
docs/{teamId}/{channelId}/table-of-contents.md          # Per-channel TOC
docs/{teamId}/{channelId}/originals/{slug}-{fileId}.ext  # Original uploaded file
```

## 8. Testing

```bash
# Run all tests
npx vitest run

# Run document-specific tests
npx vitest run tests/unit/services/document/
npx vitest run tests/integration/document.test.ts
```
