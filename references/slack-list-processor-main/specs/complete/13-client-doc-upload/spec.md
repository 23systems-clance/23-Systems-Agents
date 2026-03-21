# Feature Specification: Client Config Document Upload via Dashboard

**Feature Branch**: `13-client-doc-upload`
**Created**: 2026-03-10
**Status**: Draft
**Input**: User description: "Slack /upload command that sends a link to the admin dashboard where clients can upload config documents (ICP, Use Cases, Campaigns, Settings) directly, associated to that client channel"

## Clarifications

### Session 2026-03-10

- Q: Should config docs be associated with a ManagedClient entity or remain channel-scoped? → A: Both — store by channel (team + channel) but display the client name on the upload page if a ManagedClient link exists for that channel.
- Q: Should upload/delete permissions be restricted to certain users? → A: No — any channel member who can type `/upload` can manage config documents. No role-based restrictions.
- Q: How should the system determine which ManagedClient a channel belongs to? → A: Explicit mapping — a simple channel-to-client lookup that admins configure in the dashboard.
- Q: How should uploaded files be stored and consumed? → A: All uploaded files are converted to Markdown (.md) for `/analyze` readability. The original file is also retained so users can download the source document (e.g., the one-pager PDF/DOCX). The original filename is preserved for reference.
- Q: How should documents be labeled/named? → A: System auto-generates a descriptive display label summarizing the document content (e.g., "ICP - Enterprise SaaS Companies"). Users can also manually rename the label from the upload page.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Slack User Requests Upload Link (Priority: P1)

A Slack user in a channel types `/upload` and receives a message with a clickable link to the admin dashboard's document upload page. The link carries context about which channel/team initiated the request so uploaded documents are automatically associated with that channel. If the channel is linked to a ManagedClient, the client name is displayed on the upload page for clarity.

**Why this priority**: This is the core interaction — without the Slack command producing a dashboard link, the entire feature is unusable.

**Independent Test**: Can be fully tested by typing `/upload` in any Slack channel and verifying a message appears with a valid, clickable dashboard URL.

**Acceptance Scenarios**:

1. **Given** a user is in a Slack channel, **When** they type `/upload`, **Then** the bot responds (visible only to that user) with a message containing a clickable link to the dashboard upload page, pre-associated with that channel.
2. **Given** a user types `/upload` in a DM with the bot, **When** no channel context exists, **Then** the bot responds with an error message explaining this command must be used in a channel.
3. **Given** a user types `/upload`, **When** the bot responds, **Then** the link includes a secure, time-limited token that identifies the team, channel, and requesting user.

---

### User Story 2 - Upload Config Documents via Dashboard (Priority: P1)

A user clicks the link from Slack and lands on a dedicated upload page in the admin dashboard. The page shows the four config document types (ICP, Use Cases, Campaigns, Settings) with their current status (uploaded/missing) and allows the user to upload or replace documents for each type.

**Why this priority**: This is the other half of the core flow — the actual upload experience. Without this, the link from Slack leads nowhere useful.

**Independent Test**: Can be tested by navigating directly to the upload page with a valid token and uploading a document for each type.

**Acceptance Scenarios**:

1. **Given** a user clicks a valid upload link, **When** the page loads, **Then** they see the channel name (and client name if a ManagedClient is linked) plus four document slots (ICP, Use Cases, Campaigns, Settings) showing current status (uploaded with version number, or missing).
2. **Given** a user is on the upload page, **When** they select a file and upload it for a document type, **Then** the file is converted to Markdown, the Markdown content is stored associated with the correct team/channel, the original file is retained for download, the version increments, and a success confirmation appears.
3. **Given** a user uploads a document for a type that already has one, **When** the upload completes, **Then** the previous version is replaced and the version number increments.
4. **Given** a user clicks an expired or invalid upload link, **When** the page loads, **Then** they see a clear error message explaining the link has expired and instructing them to run `/upload` again in Slack.

---

### User Story 3 - View and Manage Existing Documents (Priority: P2)

On the upload page, users can see which documents are already uploaded, preview their contents, and delete documents they want to remove.

**Why this priority**: Viewing and managing existing documents enhances the experience but the core value (uploading) works without it.

**Independent Test**: Can be tested by uploading a document, then returning to the page and verifying the document appears with preview and delete options.

**Acceptance Scenarios**:

1. **Given** a channel has previously uploaded config documents, **When** a user visits the upload page, **Then** each uploaded document shows its display label, original filename, version number, upload date, and who uploaded it. Users can click the label to rename it.
2. **Given** a user wants to preview a document, **When** they click on an uploaded document, **Then** they can see the Markdown-rendered content of the document and have an option to download the original file.
3. **Given** a user wants to remove a document, **When** they click delete on an uploaded document, **Then** a confirmation dialog appears and upon confirming the document is removed.

---

### User Story 4 - Slack Confirmation After Upload (Priority: P3)

After a user successfully uploads or updates documents via the dashboard, a notification is posted back to the originating Slack channel thread confirming what was uploaded.

**Why this priority**: This closes the loop between Slack and the dashboard, but uploads work fine without this feedback mechanism.

**Independent Test**: Can be tested by uploading a document via the dashboard and verifying a confirmation message appears in the Slack channel.

**Acceptance Scenarios**:

1. **Given** a user uploads a document via the dashboard, **When** the upload completes, **Then** a message is posted in the originating Slack channel confirming the document type and version uploaded.
2. **Given** a user uploads multiple documents in one session, **When** each upload completes, **Then** each triggers its own Slack confirmation message.

---

### Edge Cases

- What happens when the upload link token expires mid-upload (user started filling the page but took too long)? The upload should still succeed if the token was valid when the page loaded — token validation happens at page load, not at upload time.
- What happens when two users from the same channel both run `/upload` and upload the same document type simultaneously? Last write wins — the later upload overwrites the earlier one and gets the higher version number.
- What happens when the uploaded file is empty or contains no readable text? The system rejects the upload with a clear error message.
- What happens when the uploaded file exceeds the size limit? The system rejects the upload before processing with a clear "file too large" message.
- What happens when the dashboard is unreachable when `/upload` is run? The Slack message is still sent with the link — dashboard availability is independent.
- What happens when a channel has no ManagedClient mapping? The upload page works normally but omits the client name — documents are still stored by channel.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: System MUST provide a `/upload` slash command in Slack that returns an ephemeral message with a link to the dashboard upload page.
- **FR-002**: The upload link MUST contain a secure, time-limited token (24-hour expiry) encoding team ID, channel ID, and requesting user ID.
- **FR-003**: The dashboard upload page MUST display four document type slots: ICP, Use Cases, Campaigns, and Settings.
- **FR-004**: Each document slot MUST show the current status: display label, original filename, version, upload date, and uploader for existing documents, or "Missing" for unuploaded types.
- **FR-005**: Users MUST be able to upload text-based files (.txt, .md, .csv, .docx, .pdf, .xlsx) for each document type.
- **FR-006**: System MUST convert all uploaded files to Markdown (.md) format and store the Markdown content associated with the correct team and channel. If the channel is linked to a ManagedClient, the upload page MUST display the client name prominently.
- **FR-007**: Uploading a document for a type that already exists MUST replace the content and increment the version number.
- **FR-008**: System MUST validate uploaded files are non-empty and within a 10 MB size limit.
- **FR-009**: The upload page MUST be accessible without Slack authentication — the token in the URL is the authorization.
- **FR-010**: Users MUST be able to preview the text content of existing documents on the upload page.
- **FR-011**: Users MUST be able to delete individual config documents from the upload page.
- **FR-012**: Expired or invalid tokens MUST show a clear error page directing the user to run `/upload` again.
- **FR-013**: System MUST retain the original uploaded file (stored in S3) alongside the converted Markdown content, preserving the original filename.
- **FR-014**: Users MUST be able to download the original uploaded file from the upload page and from Slack (via a download link).
- **FR-015**: The `/analyze` command MUST read the Markdown-converted content (not the original file) when generating reports. The original filename and display label MUST be available for reference in the analysis context.
- **FR-016**: System MUST auto-generate a descriptive display label for each uploaded document by summarizing its content (e.g., "ICP - Enterprise SaaS Companies", "Campaign - Q1 Outbound").
- **FR-017**: Users MUST be able to manually rename the display label of any uploaded document from the upload page.
- **FR-018**: The original filename MUST always be preserved separately from the display label, so users know what file was uploaded regardless of renaming.

### Key Entities

- **Upload Token**: A secure, time-limited credential encoding team ID, channel ID, user ID, and expiry timestamp. Used to authorize dashboard access without requiring separate login.
- **Config Document**: A document associated with a specific team and channel, categorized as one of four types (ICP, Use Cases, Campaigns, Settings). Stored as Markdown-converted content (for `/analyze` consumption) plus the original file in S3 (for download). Tracks version, uploader, original filename, and display label. Storage remains channel-scoped; the ManagedClient relationship is used for display purposes only.
- **Managed Client**: An existing business client entity that may be linked to a channel via an explicit channel-to-client mapping configured by admins in the dashboard. When present, the client name is shown on the upload page to provide business context.
- **Channel-Client Mapping**: An admin-configured association between a Slack channel and a ManagedClient. Channels without a mapping still function fully — the upload page simply omits the client name.
- **Document Type**: One of four categories — ICP (Ideal Customer Profile), Use Cases, Campaigns, or Settings — each channel can have one active document per type.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: Users can go from typing `/upload` in Slack to completing a document upload in under 2 minutes.
- **SC-002**: 100% of uploaded documents are correctly associated with the originating Slack channel, and display the linked client name when a ManagedClient exists.
- **SC-003**: Upload page loads and displays document status within 3 seconds of clicking the link.
- **SC-004**: Invalid or expired links show an error page within 1 second (no loading spinners followed by cryptic errors).
- **SC-005**: Config documents uploaded via the dashboard are immediately available to the `/analyze` command.

## Assumptions

- The admin dashboard (CloudFront + S3) is the right host for this upload page, reusing existing infrastructure.
- The existing `ChannelConfigDoc` database model and config doc service will be reused for storage — no new storage model is needed. The existing `ManagedClient` model is queried for display purposes only (no schema changes needed).
- 24-hour token expiry is a reasonable default for upload links — long enough for users who get distracted, short enough for security.
- The `/upload` command replaces the existing `/analyze upload <type>` flow as the primary way to manage config documents. The `/analyze upload` subcommand can be deprecated in a future iteration.
- File parsing for .docx, .pdf, and .xlsx reuses existing file parsing infrastructure already in the codebase. Conversion to Markdown happens server-side at upload time.
- Original uploaded files are stored in S3 for download; Markdown-converted content is stored in the database for `/analyze` consumption.
- No separate user authentication is needed for the upload page — the signed token in the URL is sufficient authorization.
