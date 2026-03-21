# Data Model: Client Config Document Upload

**Feature**: 13-client-doc-upload | **Date**: 2026-03-10

## Entity Changes

### Modified: ChannelConfigDoc

The existing `ChannelConfigDoc` model gains new fields for original file retention, display labels, and S3 storage.

**New Fields:**

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `displayLabel` | String | No | null | AI-generated or user-edited descriptive label |
| `s3Key` | String | No | null | S3 object key for the original uploaded file |
| `originalMimeType` | String | No | null | MIME type of the original uploaded file |
| `contentSizeBytes` | Int | No | null | Size of the original file in bytes |

**Existing Fields (unchanged):**

| Field | Type | Description |
|-------|------|-------------|
| `id` | UUID | Primary key |
| `slackTeamId` | String | Slack workspace ID |
| `slackChannelId` | String | Slack channel ID |
| `docType` | ConfigDocType enum | ICP, USE_CASES, CAMPAIGNS, SETTINGS |
| `content` | Text | Markdown-converted content (consumed by /analyze) |
| `uploadedByUserId` | String | Slack user ID of uploader |
| `originalFileName` | String? | Original filename of uploaded file |
| `version` | Int | Auto-incrementing version (default 1) |
| `createdAt` | DateTime | Creation timestamp |
| `updatedAt` | DateTime | Last update timestamp |

**Unique Constraint**: `(slackTeamId, slackChannelId, docType)` — one active doc per type per channel.

**Prisma Schema Addition:**
```prisma
model ChannelConfigDoc {
  // ... existing fields ...
  displayLabel     String?  @map("display_label")
  s3Key            String?  @map("s3_key")
  originalMimeType String?  @map("original_mime_type")
  contentSizeBytes Int?     @map("content_size_bytes")
}
```

---

### New: ChannelClientMapping

Maps a Slack channel to a ManagedClient for display purposes on the upload page.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | UUID | Yes | Primary key |
| `slackTeamId` | String | Yes | Slack workspace ID |
| `slackChannelId` | String | Yes | Slack channel ID |
| `clientId` | UUID | Yes | FK to ManagedClient |
| `createdByUserId` | String | Yes | Admin who created the mapping |
| `createdAt` | DateTime | Yes | Creation timestamp |
| `updatedAt` | DateTime | Yes | Last update timestamp |

**Unique Constraint**: `(slackTeamId, slackChannelId)` — one client per channel.

**Relationships:**
- `clientId` → `ManagedClient.id` (CASCADE on delete)

**Prisma Schema:**
```prisma
model ChannelClientMapping {
  id               String   @id @default(uuid()) @db.Uuid
  slackTeamId      String   @map("slack_team_id")
  slackChannelId   String   @map("slack_channel_id")
  clientId         String   @map("client_id") @db.Uuid
  createdByUserId  String   @map("created_by_user_id")
  createdAt        DateTime @default(now()) @map("created_at")
  updatedAt        DateTime @updatedAt @map("updated_at")

  client ManagedClient @relation(fields: [clientId], references: [id], onDelete: Cascade)

  @@unique([slackTeamId, slackChannelId])
  @@index([clientId])
  @@map("channel_client_mappings")
}
```

**ManagedClient Addition:**
```prisma
model ManagedClient {
  // ... existing fields ...
  channelMappings ChannelClientMapping[]
}
```

---

## Upload Token (JWT — not a database entity)

| Claim | Type | Description |
|-------|------|-------------|
| `teamId` | String | Slack workspace ID |
| `channelId` | String | Slack channel ID |
| `userId` | String | Slack user ID who ran /upload |
| `purpose` | String | Always `"config-upload"` |
| `iat` | Number | Issued-at timestamp |
| `exp` | Number | Expiry (iat + 24 hours) |

Signed with `config.session.secret` using `jsonwebtoken` library (already a dependency).

---

## State Transitions

### Config Document Lifecycle

```
[Missing] → Upload file → [Active v1]
[Active vN] → Upload new file → [Active v(N+1)] (replaces content + S3 file)
[Active vN] → Rename label → [Active vN] (only label changes, version unchanged)
[Active vN] → Delete → [Missing]
```

No soft-delete — hard delete matches existing `deleteConfigDoc()` behavior.

---

## Validation Rules

| Rule | Constraint |
|------|-----------|
| File size | Max 10 MB |
| File type | .txt, .md, .csv, .docx, .pdf, .xlsx |
| Content | Must produce non-empty Markdown after conversion |
| Display label | Max 100 characters |
| Doc type | Must be one of: ICP, USE_CASES, CAMPAIGNS, SETTINGS |
| Token expiry | 24 hours from generation |
| Channel uniqueness | One doc per type per channel (upsert) |
