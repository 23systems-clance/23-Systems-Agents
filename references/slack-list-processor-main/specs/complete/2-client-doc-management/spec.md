# Feature Specification: Client Document Management

**Feature Branch**: `2-client-doc-management`
**Created**: 2026-03-05
**Status**: Draft
**Input**: User description: "A document management layer within Slack that allows teams to upload, store, classify, and reference client documents for use during enrichment workflows"

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Upload and Index Markdown Documents (Priority: P1)

A team member uploads a markdown file (e.g., `acme-icp.md`) to the designated client documents channel in Slack. The bot detects the upload, reads the file content, automatically classifies it by document type (ICP, Use Case, Settings, or One-Pager), generates a short summary, and indexes it for future reference. The bot confirms the upload in a thread with the assigned label, document type, and a short description. The document is now available for reference in enrichment commands.

**Why this priority**: This is the foundation of the entire feature. Without document upload and indexing, no other capability (conversion, referencing, TOC) can function. Delivers immediate value by allowing teams to store reusable client context.

**Independent Test**: Can be fully tested by uploading a markdown file named `acme-icp.md` to the docs channel and verifying the bot responds with the document label, classified type, and summary. The document should then be retrievable by name.

**Acceptance Scenarios**:

1. **Given** a user uploads a `.md` file to a recognized docs channel, **When** the bot detects the upload via the file shared event, **Then** it reads the file content, determines a suggested document type (via filename convention or AI analysis), and responds in a thread with Slack interactive buttons showing the suggested type and asking the user to confirm or select a different type.
2. **Given** a user uploads a file with a name following the convention `icp-*.md`, `usecase-*.md`, `settings-*.md`, or `onepager-*.md`, **When** the bot presents the classification buttons, **Then** the suggested type is pre-selected based on the filename prefix.
3. **Given** a user uploads a file whose name does not follow any naming convention, **When** the bot processes the file, **Then** it uses AI to analyze the first portion of the content and suggests the best-match document type in the confirmation buttons.
4. **Given** the user confirms or selects a document type via buttons, **When** the bot receives the selection, **Then** it indexes the document with the chosen type and responds with: document label, confirmed document type, and a one-sentence summary.
5. **Given** a user uploads a markdown file that was previously uploaded with the same name, **When** the bot detects the duplicate name, **Then** it updates the existing document with the new content, increments the version number, and confirms: "Updated *acme-icp* to version 2."
6. **Given** a user uploads a file to a channel that is NOT a recognized docs channel, **When** the bot receives the file shared event, **Then** it routes the file to the existing enrichment workflow (no document management behavior).
7. **Given** a user uploads a file larger than the maximum allowed size (1 MB), **When** the bot checks the file, **Then** it rejects the upload with a message: "File exceeds the 1 MB size limit. Please reduce the file size and try again."

---

### User Story 2 - Auto-Convert Non-Markdown Files to Markdown (Priority: P1)

A team member uploads a PDF, Word document (DOCX), or Excel spreadsheet (XLSX) to the docs channel -- for example, a one-page product overview PDF. The bot detects the non-markdown file, acknowledges receipt, and processes it in the background. The file is converted to markdown format, classified, and indexed. The bot posts a follow-up message confirming the conversion with the resulting label, type, and summary.

**Why this priority**: Many client materials (one-pagers, briefs, spec sheets) exist as PDF or DOCX. Without auto-conversion, users would have to manually convert files before uploading, which creates friction and reduces adoption.

**Independent Test**: Can be fully tested by uploading a PDF one-pager to the docs channel and verifying the bot responds first with "Converting..." then with a confirmation showing the document was successfully converted, classified, and indexed.

**Acceptance Scenarios**:

1. **Given** a user uploads a PDF file to the docs channel, **When** the bot detects the upload, **Then** it responds immediately with "Received *filename.pdf*. Converting to markdown..." and begins background conversion.
2. **Given** a PDF conversion completes successfully, **When** the markdown output is generated, **Then** the bot posts a follow-up message with: document label, classified type, one-sentence summary, and confirmation that it is now available for reference.
3. **Given** a user uploads a DOCX file to the docs channel, **When** the bot processes it, **Then** the content (headings, paragraphs, tables, lists) is converted to equivalent markdown formatting.
4. **Given** a user uploads an XLSX file to the docs channel, **When** the bot processes it, **Then** each sheet is converted to a markdown table with column headers preserved.
5. **Given** a file conversion fails (corrupted file, password-protected, unsupported encoding), **When** the conversion process errors, **Then** the bot posts an error message: "Failed to convert *filename.pdf*. Please upload a markdown version instead." with a clear explanation of the issue.
6. **Given** a converted markdown file exceeds the maximum markdown size (500 KB), **When** the conversion completes, **Then** the bot rejects it with a message suggesting the user upload a shorter or simplified version.
7. **Given** a user uploads a `.txt` file to the docs channel, **When** the bot processes it, **Then** the content is treated as plain markdown without conversion.

---

### User Story 3 - Reference Documents in Enrichment Commands (Priority: P1)

A sales team member uploads a company list CSV and replies with "ENRICH this list using acme-icp settings." The bot recognizes "acme-icp" as a reference to a stored document, retrieves its content, and passes it as context to the AI orchestrator. The AI uses the ICP criteria from the document to inform how it processes the enrichment -- for example, prioritizing certain persona types, filtering by industry, or applying custom classification rules defined in the ICP.

**Why this priority**: This is the reason the document management system exists. Referencing stored documents during enrichment transforms the bot from a generic enrichment tool into a client-context-aware system. Equal priority with upload because one is useless without the other.

**Independent Test**: Can be fully tested by first uploading an ICP document (e.g., defining target personas as "IT Leader" and "Engineering Leader"), then uploading a company list with "ENRICH this list using acme-icp", and verifying the enrichment results reflect the ICP criteria.

**Acceptance Scenarios**:

1. **Given** a user types "ENRICH this list using acme-icp settings", **When** the bot parses the command, **Then** it searches all docs channels for a document with slug "acme-icp". If found in exactly one channel, it retrieves its content. If found in multiple channels, it presents a disambiguation prompt listing the matching channels.
2. **Given** a referenced document exists and is active, **When** the enrichment job is created, **Then** the document's content is provided as additional context to the AI orchestrator for intent classification and parameter extraction.
3. **Given** a user references a document that does not exist, **When** the bot attempts to look up the slug, **Then** it responds: "Could not find document *acme-icp*. Available documents: [list]. Proceeding without document context." and continues the enrichment without document context.
4. **Given** a user references a document that has been archived, **When** the bot looks up the slug, **Then** it responds: "Document *acme-icp* has been archived. Available documents: [list]. Proceeding without document context."
5. **Given** a user references multiple documents (e.g., "ENRICH this list using acme-icp and security-usecase"), **When** the bot parses the command, **Then** it retrieves and combines the content from all referenced documents as context.
6. **Given** a referenced document's content exceeds the maximum context size, **When** the content is prepared for the AI orchestrator, **Then** it is truncated to fit within the context limit with a note that the document was abbreviated.

---

### User Story 4 - Auto-Generated Table of Contents (Priority: P2)

Whenever a document is uploaded, updated, or archived, the system automatically regenerates a master table of contents. The TOC lists all active documents grouped by type (ICP, Use Case, Settings, One-Pager), with each entry showing the document slug, a short description, the current version, and the last-updated date. Users can view the TOC at any time by asking the bot.

**Why this priority**: The TOC provides discoverability. Without it, teams would need to remember exact document names. However, the core upload/index and reference flows work without a TOC, making it secondary.

**Independent Test**: Can be fully tested by uploading 3-4 documents of different types, then asking the bot to show documents, and verifying the response lists all documents grouped by type with accurate metadata.

**Acceptance Scenarios**:

1. **Given** a new document is uploaded and indexed, **When** indexing completes, **Then** the system regenerates the table of contents to include the new entry under the correct type heading.
2. **Given** an existing document is updated (re-uploaded), **When** the version is incremented, **Then** the TOC entry for that document reflects the new version number and updated date.
3. **Given** a document is archived (deleted), **When** the archive operation completes, **Then** the TOC is regenerated without the archived document.
4. **Given** a team has 10 active documents across all types, **When** the TOC is generated, **Then** documents are grouped under headings: "ICP (Ideal Customer Profiles)", "Use Cases", "Settings", "One-Pagers", and "Other" -- with each entry showing: slug name, summary, version, and last-updated date.
5. **Given** a team has no active documents, **When** the TOC is requested, **Then** the system responds with "No documents have been uploaded yet. Upload files to the docs channel to get started."

---

### User Story 5 - Document Management Commands (Priority: P2)

Users can manage their team's document library through Slack commands. They can list all documents, archive (soft-delete) a document, and manually refresh the table of contents. These commands follow the existing "ENRICH" prefix convention.

**Why this priority**: Management commands are quality-of-life features. The core flows (upload, convert, reference) work without explicit management commands, but they are needed for day-to-day operations once the document library grows.

**Independent Test**: Can be fully tested by uploading several documents, then running each management command and verifying the expected response.

**Acceptance Scenarios**:

1. **Given** a user types "ENRICH docs" in any channel the bot is in, **When** the bot processes the command, **Then** it responds with a formatted list of all active documents for the user's team, grouped by type, showing slug, summary, and version.
2. **Given** a user who is the original uploader or a workspace admin types "ENRICH delete doc acme-icp", **When** the bot processes the command, **Then** it archives the document (soft-delete, not permanent removal) and responds: "Archived *acme-icp*. It will no longer be used as a reference."
3. **Given** a user who is NOT the original uploader or a workspace admin types "ENRICH delete doc acme-icp", **When** the bot checks permissions, **Then** it responds: "Only the original uploader or a workspace admin can archive this document."
4. **Given** a user types "ENRICH delete doc nonexistent-doc", **When** the bot looks up the slug, **Then** it responds: "Document *nonexistent-doc* not found. Use 'ENRICH docs' to see available documents."
5. **Given** a user types "ENRICH refresh toc", **When** the bot processes the command, **Then** it regenerates the table of contents and responds: "Table of contents regenerated. X active documents indexed."

---

### Edge Cases

- What happens when a user uploads a password-protected PDF? The system should report a conversion failure with a message explaining that password-protected files cannot be processed and suggest uploading an unprotected version.
- What happens when a user uploads a file type that is not supported (e.g., `.pptx`, `.png`, `.zip`)? The system should ignore the upload in the docs channel and inform the user of supported file types.
- What happens when two users upload files with the same name at nearly the same time? The system should process them sequentially to avoid race conditions, with the second upload creating version 2.
- What happens when no docs channels are configured (no naming convention set and no channels explicitly registered)? The document management listener should be inactive, and all file uploads follow the existing enrichment flow. A warning should be logged at startup.
- What happens when a user references a document slug that partially matches multiple documents (e.g., "acme" matches "acme-icp" and "acme-usecase")? The system should require exact slug matches and suggest similar document names if no exact match is found.
- What happens when the same slug exists in multiple docs channels (e.g., "settings" in both `#acme-docs` and `#bigcorp-docs`)? The system should present a disambiguation prompt asking the user to choose which channel's document to use.
- What happens when conversion produces empty or near-empty markdown (e.g., an image-only PDF)? The system should warn the user that the converted document contains minimal text and may not be useful as a reference.
- What happens when a team has a large number of documents (100+)? The "ENRICH docs" command should paginate results or summarize by type count with an option to filter.
- What happens when a user uploads a very small file (< 100 bytes)? The system should process it normally -- small configuration files or brief ICPs are valid use cases.
- What happens when a designated docs channel is deleted or the bot is removed from it? The system should handle the missing channel gracefully, logging an error and disabling document management for that channel. Other docs channels continue operating normally.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: System MUST detect file uploads in designated client document channels. Multiple channels per workspace are supported -- channels are identified either by a configurable naming convention (e.g., channels ending in `-docs`) or by explicit registration. Files uploaded to any recognized docs channel are routed to the document management workflow. Files uploaded to non-docs channels follow the existing enrichment workflow. Each docs channel may represent a different client or document category.
- **FR-002**: System MUST support uploading and processing files in the following formats: Markdown (`.md`), Plain Text (`.txt`), PDF (`.pdf`), Word Document (`.docx`), and Excel Spreadsheet (`.xlsx`).
- **FR-003**: System MUST classify each uploaded document into one of the following types: ICP (Ideal Customer Profile), Use Case, Settings, One-Pager, or Unknown. Classification MUST first attempt filename convention matching (e.g., `icp-*.md` maps to ICP) and fall back to AI-based content analysis when the filename is ambiguous. Regardless of classification method or confidence level, the system MUST always present the suggested document type to the user via Slack interactive buttons and ask them to confirm or select the correct type before indexing the document.
- **FR-004**: System MUST automatically convert non-markdown files (PDF, DOCX, XLSX) to markdown format in the background. The conversion MUST preserve document structure (headings, paragraphs, tables, lists) to the extent possible for each source format. The original file is retained alongside the converted version.
- **FR-005**: System MUST maintain a master table of contents that lists all active documents for a team, grouped by document type. Each entry MUST include: document slug, short description, current version number, and last-updated date. The TOC MUST be regenerated automatically whenever a document is created, updated, or archived.
- **FR-006**: System MUST allow users to reference stored documents in enrichment commands using the document slug (e.g., "ENRICH this list using acme-icp settings"). The referenced document's content MUST be retrieved and provided as additional context to the AI orchestrator during intent classification and enrichment processing.
- **FR-006a**: When a referenced document is of type "Settings", the system MUST parse recognized key-value pairs from the document and apply them as programmatic overrides to bot defaults for that enrichment job. Recognized settings include (but are not limited to): `decision_makers` (number per company), `personas` (prioritized list), `max_rows`, and integration fields such as `instantly_campaign_id`. Unrecognized keys MUST be ignored gracefully and passed as AI context. The defined schema of recognized keys MUST be extensible to support future integrations.
- **FR-007**: System MUST support document versioning. When a file with the same slug is uploaded again, the system MUST update the existing record with new content, increment the version number, and retain the previous version for archival purposes.
- **FR-008**: System MUST enforce a maximum file size of 1 MB for raw uploaded files. For converted markdown content, the maximum size MUST be 500 KB. Files exceeding these limits MUST be rejected with a clear error message.
- **FR-009**: System MUST support document management commands: listing all documents ("ENRICH docs"), archiving a document ("ENRICH delete doc <slug>"), and manually refreshing the table of contents ("ENRICH refresh toc"). Archiving a document MUST be restricted to the original uploader or Slack workspace admins. Other users attempting to archive MUST receive a permission error message.
- **FR-010**: System MUST isolate documents by docs channel. Each docs channel is its own document silo -- slugs MUST be unique within a channel, but the same slug MAY exist in different docs channels. Documents uploaded in one workspace MUST NOT be visible to or referenceable by another workspace. When a user references a document slug in an ENRICH command, the system MUST search all docs channels in the workspace. If the slug matches exactly one channel, the document is used automatically. If the slug exists in multiple channels, the system MUST present the user with a disambiguation prompt listing the matching channels before proceeding.
- **FR-011**: System MUST generate an AI-produced one-sentence summary for each uploaded document, to be displayed in confirmations and the table of contents.
- **FR-012**: System MUST log all document management actions (upload, archive, reference) for audit purposes, consistent with the existing audit logging pattern.
- **FR-013**: System MUST handle graceful degradation when a referenced document cannot be found or retrieved. The enrichment workflow MUST continue without document context and inform the user that the reference could not be resolved.
- **FR-014**: System MUST acknowledge document uploads within 3 seconds. For files requiring conversion, an immediate acknowledgment MUST be sent followed by a completion or failure notification after processing.
- **FR-015**: System MUST truncate document content to a configurable maximum size before injecting it as AI context, to ensure the AI orchestrator's context window is not exceeded.

### Key Entities

- **Client Document**: A stored reference document belonging to a docs channel. Contains: unique slug (URL-safe identifier derived from filename, unique within the docs channel), display label, document type classification, one-sentence summary, processing status (processing/active/failed/archived), current version number, storage location for markdown content, original filename, original file format, content size, upload channel (used as the scoping boundary), uploading user, and timestamps.
- **Document Type**: A classification category for documents. Types: ICP (Ideal Customer Profile -- targeting criteria and audience definitions), Use Case (enrichment scenarios and workflow descriptions), Settings (parsed configuration with a defined schema of key-value pairs that override bot defaults and store integration-specific fields such as `instantly_campaign_id` for future platform integrations), One-Pager (marketing materials, product overviews, sales collateral), Unknown (unclassified documents).
- **Table of Contents**: A materialized summary of all active documents for a team, organized by document type. Regenerated on every document state change.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: Users can upload a markdown document and receive confirmation of indexing within 5 seconds.
- **SC-002**: Non-markdown file conversion (PDF, DOCX, XLSX) completes within 30 seconds for files under 1 MB.
- **SC-003**: Document type classification accuracy is 90% or higher when using AI-based content analysis (measured against human-assigned types).
- **SC-004**: Users can reference a stored document in an enrichment command and the AI orchestrator receives the document content as context in 100% of cases where the document exists and is active.
- **SC-005**: The table of contents accurately reflects the current state of all documents within 10 seconds of any document state change.
- **SC-006**: Zero cross-workspace document leakage -- documents from one Slack workspace are never visible to or referenceable by another workspace. Within a workspace, documents are scoped per docs channel.
- **SC-007**: 95% of supported file conversions (PDF, DOCX, XLSX) produce usable markdown output that preserves the document's key content and structure.
- **SC-008**: Document management commands (list, delete, refresh) respond within 3 seconds.

## Clarifications

### Session 2026-03-05

- Q: How should "Settings" documents influence enrichment behavior? → A: Parsed configuration -- Settings docs follow a defined schema with key-value pairs that programmatically override bot defaults when referenced. Settings also support integration-specific fields (e.g., `instantly_campaign_id`) for future platform integrations such as Instantly.ai campaign assignment.
- Q: Who can archive/delete documents? → A: Uploader + admins -- only the user who originally uploaded a document or Slack workspace admins can archive it. Other users receive a permission error.
- Q: Should the system support multiple docs channels per workspace? → A: Yes, multiple channels. Any channel matching a configurable naming convention (e.g., `*-docs`) or explicitly registered channels act as docs channels. Each channel can represent a different client or category.
- Q: When AI classifies a document with low confidence, what should happen? → A: Always ask -- regardless of confidence level, always present the AI's best guess to the user via Slack interactive buttons and ask them to confirm or select the correct document type before indexing.
- Q: Should documents be scoped per-channel or workspace-wide? → A: Per-channel isolation. Each docs channel is its own document silo. Slugs are unique within a channel but the same slug may exist in different channels. When a user references a document in an ENRICH command, the bot searches all docs channels; if the slug is found in exactly one channel it is used automatically, if found in multiple channels the bot asks the user to disambiguate.

## Assumptions

- Client document channels are standard Slack channels that the bot has been invited to. Multiple docs channels are supported per workspace, identified by a configurable naming convention (e.g., `*-docs`) or explicit channel registration. Each docs channel is its own document silo -- slugs are unique within a channel. When referencing documents via ENRICH commands, the bot searches all docs channels and disambiguates if the same slug exists in multiple channels.
- Teams will upload a manageable number of documents (typically under 100 active documents per team). The system is not designed to be a large-scale document management system.
- PDF files uploaded are primarily text-based documents (reports, one-pagers, briefs). Image-heavy PDFs (scanned documents, infographics) will produce limited text output from conversion.
- DOCX files follow standard formatting. Complex features (embedded macros, ActiveX controls, advanced formatting) may not convert perfectly but core content (text, tables, lists) will be preserved.
- The existing AI orchestrator (Claude 3.5 Haiku) has sufficient capability to classify document types and generate summaries from document content.
- Document content used as AI context will be truncated to fit within reasonable token limits. Very large documents may lose information during truncation.
- The existing object storage (S3) infrastructure is available and has sufficient capacity for document storage.
- The existing audit logging and API usage tracking infrastructure will be extended to cover document management actions.
