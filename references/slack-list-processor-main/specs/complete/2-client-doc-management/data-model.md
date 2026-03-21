# Data Model: Client Document Management

**Feature Branch**: `2-client-doc-management`
**Date**: 2026-03-05
**Database**: PostgreSQL (via Prisma ORM)

## Entity Relationship Diagram

```
ClientDocument (standalone, scoped by slack_team_id + slack_channel_id)
DocsChannelConfig (standalone, scoped by slack_team_id)
AuditLog (existing, extended with new actions)
```

## Entities

### ClientDocument

A stored reference document belonging to a docs channel. Central entity for the document management feature. Documents are scoped per channel -- the same slug may exist in different docs channels.

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | UUID | PK, auto-generated | Unique document identifier |
| slack_team_id | String | NOT NULL | Slack workspace/team ID for multi-tenant isolation |
| slack_channel_id | String | NOT NULL | Channel where the document was uploaded |
| slack_user_id | String | NOT NULL | User who uploaded the document |
| slack_file_id | String | NULLABLE | Slack file ID (for download reference) |
| slug | String | NOT NULL | URL-safe identifier derived from filename (e.g., "acme-icp"), unique within a channel |
| label | String | NOT NULL | Human-readable display name |
| summary | Text | NULLABLE | AI-generated one-sentence description |
| document_type | Enum | NOT NULL | `ICP`, `USE_CASE`, `SETTINGS`, `ONE_PAGER`, `UNKNOWN` |
| status | Enum | NOT NULL, default `PROCESSING` | `PROCESSING`, `ACTIVE`, `FAILED`, `ARCHIVED` |
| version | Integer | NOT NULL, default 1 | Current version number (incremented on re-upload) |
| s3_key | String | NOT NULL | S3 object key for the current markdown content |
| original_file_name | String | NOT NULL | Name of the uploaded file |
| original_mime_type | String | NOT NULL | MIME type of the original upload |
| content_size_bytes | Integer | NULLABLE | Size in bytes of the markdown content |
| error_message | Text | NULLABLE | Error details if conversion/indexing failed |
| slack_thread_ts | String | NULLABLE | Slack thread where the upload was acknowledged |
| parsed_settings | JSONB | NULLABLE | For SETTINGS type: parsed key-value pairs extracted from the document |
| created_at | DateTime | NOT NULL, auto | Record creation timestamp |
| updated_at | DateTime | NOT NULL, auto-update | Last modification timestamp |

**Indexes**:
- `@@unique([slack_team_id, slack_channel_id, slug])` -- Ensures unique slugs per channel for versioning via upsert
- `@@index([slack_team_id])` -- Team-scoped queries (cross-channel search for ENRICH references)
- `@@index([slack_team_id, slack_channel_id])` -- Channel-scoped queries (TOC, listing)
- `@@index([document_type])` -- Filter by type
- `@@index([status])` -- Filter by status
- `@@index([slack_team_id, document_type])` -- TOC generation (grouped by type)
- `@@index([slack_team_id, slug])` -- Cross-channel slug disambiguation lookup

**Table Name**: `client_documents`

### DocsChannelConfig

Tracks explicitly registered docs channels for a workspace (supplement to naming convention matching).

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | UUID | PK, auto-generated | Unique config record ID |
| slack_team_id | String | NOT NULL | Slack workspace/team ID |
| slack_channel_id | String | NOT NULL | Channel ID registered as a docs channel |
| channel_name | String | NULLABLE | Channel name at time of registration (for display) |
| registered_by_user_id | String | NOT NULL | User who registered this channel |
| is_active | Boolean | NOT NULL, default true | Whether this channel is currently active as a docs channel |
| created_at | DateTime | NOT NULL, auto | Record creation timestamp |
| updated_at | DateTime | NOT NULL, auto-update | Last modification timestamp |

**Indexes**:
- `@@unique([slack_team_id, slack_channel_id])` -- No duplicate registrations
- `@@index([slack_team_id, is_active])` -- Active docs channels for a team

**Table Name**: `docs_channel_configs`

## New Enums

### DocumentType

Classification category for uploaded documents.

| Value | Description |
|-------|-------------|
| `ICP` | Ideal Customer Profile -- targeting criteria and audience definitions |
| `USE_CASE` | Enrichment scenarios and workflow descriptions |
| `SETTINGS` | Parsed configuration with key-value overrides for bot defaults |
| `ONE_PAGER` | Marketing materials, product overviews, sales collateral |
| `UNKNOWN` | Unclassified document |

### DocumentStatus

Processing lifecycle state for a document.

| Value | Description |
|-------|-------------|
| `PROCESSING` | Conversion or indexing in progress |
| `ACTIVE` | Ready for use and referenceable |
| `FAILED` | Conversion or indexing failed |
| `ARCHIVED` | Soft-deleted by user (no longer referenceable) |

## State Transitions

### ClientDocument.status

```
PROCESSING --> ACTIVE      (conversion + indexing succeeds)
PROCESSING --> FAILED      (conversion or indexing fails)
ACTIVE     --> ARCHIVED    (user archives via "ENRICH delete doc")
ACTIVE     --> PROCESSING  (user re-uploads same slug, new version starts)
ARCHIVED   --> (terminal)  (no unarchive in v1; future enhancement)
FAILED     --> PROCESSING  (user re-uploads same slug, retry starts)
```

## Settings Document Schema

Settings documents follow YAML front matter convention for machine-readable key-value pairs. The front matter block is extracted and parsed into `parsed_settings` JSONB field.

### Recognized Settings Keys

| Key | Type | Description | Default Override |
|-----|------|-------------|-----------------|
| `decision_makers` | number | Number of decision makers per company | 2 (system default) |
| `personas` | string[] | Prioritized list of persona types to target | All persona types |
| `max_rows` | number | Maximum rows to process for this client | 1000 (system default) |
| `instantly_campaign_id` | string | Instantly.ai campaign ID for future integration | None |
| `purpose` | string | Default list purpose (COLD_CALLING, EMAILING, etc.) | None (prompt user) |

### Example Settings Document

```markdown
---
decision_makers: 3
personas:
  - IT Leader
  - Engineering Leader
  - CEO
max_rows: 2000
instantly_campaign_id: camp_abc123
---

# Acme Corp Settings

Additional context and notes about Acme Corp enrichment preferences.
This free-text section is passed as AI context alongside the parsed settings.
```

Unrecognized keys in the YAML front matter are stored in `parsed_settings` but not applied as programmatic overrides. They are passed as AI context for future extensibility.

## Existing Entities Extended

### AuditLog (existing)

The `AuditAction` type union in `src/lib/auditLogger.ts` is extended with:

| New Action | Description |
|------------|-------------|
| `doc_upload` | User uploaded a document to a docs channel |
| `doc_classify` | User confirmed or selected a document type via buttons |
| `doc_archive` | User archived a document via "ENRICH delete doc" |
| `doc_reference` | User referenced a document in an ENRICH command |

### Job (existing, optional extension)

| New Field | Type | Constraints | Description |
|-----------|------|-------------|-------------|
| document_slugs | String[] | NULLABLE, default [] | Slugs of documents referenced in this enrichment job |
| settings_overrides | JSONB | NULLABLE | Parsed settings applied from a referenced SETTINGS document |

## S3 Storage Layout

```
docs/{teamId}/{channelId}/{slug}.md                    # Current version markdown
docs/{teamId}/{channelId}/{slug}-v{N}.md               # Previous version archive
docs/{teamId}/{channelId}/table-of-contents.md         # Per-channel TOC
docs/{teamId}/{channelId}/originals/{slug}-{fileId}.ext # Original uploaded file (non-markdown)
```

## Redis Keys

| Key Pattern | Type | TTL | Description |
|-------------|------|-----|-------------|
| `toc:{teamId}:{channelId}` | String | 300s (5 min) | Cached per-channel table of contents markdown |
| `doc-channel:{teamId}` | Set | 3600s (1 hr) | Cached set of docs channel IDs for quick lookup |
| `doc-classify:{channelId}:{threadTs}` | Hash | 3600s (1 hr) | Pending classification confirmation state |
