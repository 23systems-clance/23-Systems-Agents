# Tasks: Client Document Management

**Input**: Design documents from `/specs/2-client-doc-management/`
**Prerequisites**: plan.md (required), spec.md (required), research.md, data-model.md, contracts/api-contracts.md, quickstart.md

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Install new dependencies and extend project configuration for document management.

- [x] T001 Install new runtime dependencies: `npm install mammoth turndown turndown-plugin-gfm pdf-parse gray-matter` and dev dependencies: `npm install -D @types/turndown @types/pdf-parse`
- [x] T002 Add DOC_* configuration variables to `src/config/index.ts`: `docMaxFileSize` (default 1048576), `docMaxMarkdownSize` (default 524288), `docMaxContextChars` (default 4000), `docChannelPattern` (default `-docs$|-documents$`)
- [x] T003 [P] Update `.env.example` with new DOC_* environment variable documentation

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Database schema, queue definitions, and shared utilities that ALL user stories depend on.

**CRITICAL**: No user story work can begin until this phase is complete.

- [x] T004 Add `DocumentType` enum (`ICP`, `USE_CASE`, `SETTINGS`, `ONE_PAGER`, `UNKNOWN`) and `DocumentStatus` enum (`PROCESSING`, `ACTIVE`, `FAILED`, `ARCHIVED`) to `prisma/schema.prisma`
- [x] T005 Add `ClientDocument` model to `prisma/schema.prisma` with all fields from data-model.md: id (UUID PK), slack_team_id, slack_channel_id, slack_user_id, slack_file_id, slug, label, summary, document_type, status, version, s3_key, original_file_name, original_mime_type, content_size_bytes, error_message, slack_thread_ts, parsed_settings (Json), created_at, updated_at. Include unique constraint `@@unique([slackTeamId, slackChannelId, slug])` (per-channel slug uniqueness) and all indexes from data-model.md including `@@index([slackTeamId, slug])` for cross-channel disambiguation lookup
- [x] T006 [P] Add `DocsChannelConfig` model to `prisma/schema.prisma` with fields from data-model.md: id (UUID PK), slack_team_id, slack_channel_id, channel_name, registered_by_user_id, is_active, created_at, updated_at. Include unique constraint `@@unique([slackTeamId, slackChannelId])` and composite index
- [x] T007 [P] Add `document_slugs` (String[]) and `settings_overrides` (Json) optional fields to the existing `Job` model in `prisma/schema.prisma`
- [x] T008 Run `npx prisma migrate dev --name add-client-documents` to generate and apply the migration
- [x] T009 Extend `AuditAction` type union in `src/lib/auditLogger.ts` with new actions: `doc_upload`, `doc_classify`, `doc_archive`, `doc_reference`
- [x] T010 Add `documentProcessingQueue` definition to `src/services/queue/queues.ts` following existing queue patterns (queue name: `document-processing`, same connection options and default job options as existing queues: 3 attempts, exponential backoff with 5s base)
- [x] T011 Create docs channel detection helper `src/services/document/channelDetector.ts` -- export `isDocsChannel(teamId: string, channelId: string, channelName?: string): Promise<boolean>` that checks (1) Redis cache `doc-channel:{teamId}` set, (2) DocsChannelConfig table for explicit registration, (3) channel name against `config.docChannelPattern` regex. Cache results in Redis set with 1hr TTL. **Note**: v1 relies on naming convention matching only. The DocsChannelConfig table supports future explicit registration (e.g., a "register docs channel" command) but no registration command is implemented in this feature scope

**Checkpoint**: Foundation ready -- database schema migrated, queue defined, channel detection working. User story implementation can begin.

---

## Phase 3: User Story 1 -- Upload and Index Markdown Documents (Priority: P1)

**Goal**: Users upload `.md` or `.txt` files to a docs channel. Bot detects the upload, classifies the document type (filename convention + AI fallback), presents confirmation buttons, and indexes the document in PostgreSQL + S3 on confirmation.

**Independent Test**: Upload `acme-icp.md` to a channel ending in `-docs`. Bot should reply with classification buttons. Click a type button. Bot confirms with label, type, and summary. Document appears in DB as ACTIVE.

### Implementation for User Story 1

- [x] T012 [P] [US1] Create AI document classifier `src/services/ai/documentClassifier.ts` -- export `classifyDocument(content: string, filename: string): Promise<{documentType, confidence, suggestedLabel, summary}>`. Implement `CLASSIFY_DOCUMENT_TOOL` per contracts section 4.1, use Claude 3.5 Haiku (`claude-haiku-4-5-20251001`) with forced tool_choice, max_tokens 200. Follow existing orchestrator.ts pattern for Anthropic client usage
- [x] T013 [P] [US1] Create filename convention classifier helper in `src/services/document/filenameClassifier.ts` -- export `classifyByFilename(filename: string): DocumentType | null` that matches prefixes: `icp-*` -> ICP, `usecase-*` -> USE_CASE, `settings-*` -> SETTINGS, `onepager-*` -> ONE_PAGER. Also export `generateSlug(filename: string): string` that strips extension, lowercases, replaces non-alphanumeric with hyphens
- [x] T014 [P] [US1] Create document indexer `src/services/document/indexer.ts` -- export `indexDocument(params: {teamId, channelId, userId, slug, label, summary, documentType, s3Key, originalFileName, originalMimeType, contentSizeBytes, threadTs}): Promise<ClientDocument>`. Implement upsert on `[teamId, channelId, slug]` unique constraint: if existing record found in same channel, increment version, archive previous S3 key to `docs/{teamId}/{channelId}/{slug}-v{N}.md`, update all fields. Set status to ACTIVE. Log `doc_classify` audit event
- [x] T015 [US1] Create `src/listeners/events/fileSharedDocument.ts` -- export `registerDocumentUploadListener(app: App)`. On `file_shared` event: (1) call `isDocsChannel()` -- if false, return (let existing fileShared.ts handle), (2) fetch file info via `client.files.info`, (3) validate MIME type is `text/markdown` or `text/plain`, (4) validate file size <= `config.docMaxFileSize`, (5) download file content via `url_private_download`, (6) classify via filename convention first, then AI fallback, (7) post Block Kit classification buttons per contracts section 2.1 with `block_id: doc_classify_{fileId}`, (8) store pending classification state in Redis hash `doc-classify:{channelId}:{threadTs}` with 1hr TTL (fileId, slug, channelId, content S3 key, suggested type, label, summary), (9) upload markdown to S3 at `docs/{teamId}/{channelId}/{slug}.md`, (10) log `doc_upload` audit event. For unsupported MIME types, post error message listing supported types. For oversized files, post size limit error
- [x] T016 [US1] Create `src/listeners/actions/documentTypeConfirm.ts` -- export `registerDocumentTypeConfirmHandlers(app: App)`. Register action handlers for action IDs: `doc_type_icp`, `doc_type_use_case`, `doc_type_settings`, `doc_type_one_pager`, `doc_type_unknown`. On button click: (1) extract fileId from `block_id` (`doc_classify_{fileId}`), (2) retrieve pending state from Redis hash `doc-classify:{channelId}:{threadTs}`, (3) map action_id to DocumentType enum, (4) call `indexDocument()` with confirmed type, (5) update original message to remove buttons and show confirmation per contracts section 1.2 response format, (6) delete Redis pending state
- [x] T017 [US1] Modify existing `src/listeners/events/fileShared.ts` to add an early return when `isDocsChannel()` returns true (route to document handler instead of enrichment handler). Import and call `isDocsChannel` at the top of the handler before any enrichment logic
- [x] T018 [US1] Register new listeners in `src/app.ts`: import and call `registerDocumentUploadListener(app)` and `registerDocumentTypeConfirmHandlers(app)` in the listener registration section

**Checkpoint**: Markdown document upload, classification, and indexing fully functional. Users can upload `.md` files to a docs channel, confirm the type via buttons, and documents are stored in S3 + PostgreSQL.

---

## Phase 4: User Story 2 -- Auto-Convert Non-Markdown Files to Markdown (Priority: P1)

**Goal**: Users upload PDF, DOCX, or XLSX files to docs channels. Bot acknowledges receipt with "Converting...", runs async conversion via BullMQ, and posts classification buttons after conversion completes.

**Independent Test**: Upload a PDF one-pager to a docs channel. Bot posts "Converting..." immediately. After a few seconds, bot posts classification buttons for the converted markdown. Confirm the type and verify the document is indexed.

### Implementation for User Story 2

- [x] T019 [P] [US2] Create document converter `src/services/document/converter.ts` -- export `convertToMarkdown(buffer: Buffer, mimeType: string, fileName: string): Promise<{markdown: string, warnings: string[]}>`. Implement three conversion paths: (1) PDF via `pdf-parse` -- extract text, wrap in minimal markdown, (2) DOCX via `mammoth.convertToHtml()` then `turndown` with GFM plugin for tables, strip base64 images, (3) XLSX via `xlsx` -- iterate sheets, convert each to markdown table using `XLSX.utils.sheet_to_json()` and format as GFM table with headers. Validate output size <= `config.docMaxMarkdownSize`. Throw descriptive errors for password-protected files, corrupted files, etc.
- [x] T020 [US2] Create BullMQ worker `src/services/queue/workers/documentConversion.ts` -- export `createDocumentConversionWorker(slackClient: WebClient): Worker`. Implement `DocumentConversionJobData` interface per contracts section 3.1. Worker flow: (1) download file from Slack via `url_private_download` with bot token, (2) call `convertToMarkdown()`, (3) upload converted markdown to S3 at `docs/{teamId}/{channelId}/{slug}.md`, (4) upload original to `docs/{teamId}/{channelId}/originals/{slug}-{fileId}.ext`, (5) classify via filename + AI, (6) post classification buttons in thread, (7) store pending state in Redis. On failure: update thread with error message, create ClientDocument record with status FAILED and error_message. Use 3 attempts with exponential backoff (5s base)
- [x] T021 [US2] Extend `src/listeners/events/fileSharedDocument.ts` to handle non-markdown MIME types: for `application/pdf`, `application/vnd.openxmlformats-officedocument.wordprocessingml.document`, and `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` -- (1) post "Received *{filename}*. Converting to markdown..." acknowledgment in thread, (2) create ClientDocument record with status PROCESSING, (3) enqueue `DocumentConversionJobData` on `documentProcessingQueue`, (4) log `doc_upload` audit event. For `.txt` files (text/plain), treat as pass-through (same as markdown path)
- [x] T022 [US2] Register document conversion worker in `src/app.ts`: import and call `createDocumentConversionWorker(slackClient)` in the main startup function alongside existing workers

**Checkpoint**: Full document conversion pipeline operational. PDF, DOCX, and XLSX files can be uploaded, converted asynchronously, and indexed.

---

## Phase 5: User Story 3 -- Reference Documents in Enrichment Commands (Priority: P1)

**Goal**: Users reference stored documents in ENRICH commands (e.g., "ENRICH this list using acme-icp"). Bot resolves slugs, fetches content from S3, and passes it as AI context to the orchestrator. Settings documents have their YAML front matter parsed for programmatic overrides.

**Independent Test**: Upload and index an ICP document. Then upload a company list CSV and type "ENRICH this list using acme-icp". Verify the enrichment job's `document_slugs` field contains "acme-icp" and the AI orchestrator received the document content as context.

### Implementation for User Story 3

- [x] T023 [P] [US3] Create settings parser `src/services/document/settingsParser.ts` -- export `parseSettings(markdownContent: string): {settings: Record<string, unknown>, content: string}`. Use `gray-matter` to extract YAML front matter. Validate recognized keys against schema: `decision_makers` (number, 1-10), `personas` (string[]), `max_rows` (number, 1-5000), `instantly_campaign_id` (string), `purpose` (string). Return parsed settings object and remaining content separately. Unrecognized keys pass through in the settings object
- [x] T024 [P] [US3] Create reference resolver `src/services/document/referenceResolver.ts` -- export `resolveDocumentReferences(teamId: string, slugs: string[]): Promise<{documents: ResolvedDocument[], notFound: string[], archived: string[], ambiguous: AmbiguousSlug[]}>` where `ResolvedDocument = {slug, channelId, documentType, content, parsedSettings?}` and `AmbiguousSlug = {slug, channels: {channelId, channelName}[]}`. For each slug: (1) query ClientDocument by `[teamId, slug]` across ALL channels where status=ACTIVE, (2) if found in exactly one channel, download content from S3 at `docs/{teamId}/{channelId}/{slug}.md`, (3) if found in multiple channels, add to ambiguous list with channel details, (4) if document_type is SETTINGS, call `parseSettings()` to extract overrides, (5) truncate content to `config.docMaxContextChars`. Return documents, not-found slugs, archived slugs, and ambiguous slugs requiring user disambiguation
- [x] T025 [US3] Create slug extraction helper in `src/services/document/referenceResolver.ts` -- export `extractSlugsFromMessage(message: string): string[]`. Parse ENRICH message for slug references using regex patterns: `using\s+([\w-]+)`, `with\s+([\w-]+)`, `using\s+([\w-]+)\s+and\s+([\w-]+)`. Return array of unique potential slugs
- [x] T026 [US3] Extend `src/services/ai/orchestrator.ts` -- add optional `documentContext?: string` parameter to `classifyIntent()`. When provided, append to system prompt: `--- Referenced Document Context ---\n{documentContext}\n\nUse this context to better understand the user's enrichment preferences...` per contracts section 4.2
- [x] T027 [US3] Extend `src/listeners/events/message.ts` to add document reference detection before the existing intent classification flow. When an ENRICH message is detected: (1) call `extractSlugsFromMessage()`, (2) if slugs found, call `resolveDocumentReferences()`, (3) if ambiguous slugs (same slug in multiple channels), post disambiguation prompt with Slack interactive buttons listing matching channel names and wait for user selection, (4) if notFound or archived slugs, post warning message listing them with available alternatives, (5) combine resolved document contents into a single `documentContext` string, (6) if any resolved doc is SETTINGS type, extract `parsedSettings` as settings overrides, (7) pass `documentContext` to `classifyIntent()`, (8) store `document_slugs` (with channel context) and `settings_overrides` on the Job record when created, (9) log `doc_reference` audit event for each resolved document slug (per FR-012)

**Checkpoint**: Document references work end-to-end. Users can reference ICP/Use Case documents for AI context and Settings documents for programmatic overrides in enrichment commands.

---

## Phase 6: User Story 4 -- Auto-Generated Table of Contents (Priority: P2)

**Goal**: System auto-generates a `table-of-contents.md` in S3 whenever documents are created, updated, or archived. TOC is cached in Redis for fast reads. Groups documents by type with slug, summary, version, and last-updated date.

**Independent Test**: Upload 3 documents of different types (ICP, Use Case, One-Pager). Verify S3 contains `docs/{teamId}/table-of-contents.md` with all three listed under correct type headings. Archive one and verify TOC updates to exclude it.

### Implementation for User Story 4

- [x] T028 [US4] Create TOC generator `src/services/document/tocGenerator.ts` -- export `generateTableOfContents(teamId: string, channelId: string): Promise<string>`. Query all ClientDocuments where `slack_team_id = teamId AND slack_channel_id = channelId AND status = ACTIVE`, group by `document_type`, format as markdown with headings per type ("ICP (Ideal Customer Profiles)", "Use Cases", "Settings", "One-Pagers", "Other"). Each entry: `- \`{slug}\` -- {summary} (v{version}, updated {date})`. Upload to S3 at `docs/{teamId}/{channelId}/table-of-contents.md`. Cache in Redis key `toc:{teamId}:{channelId}` with 300s TTL. Return the markdown string. If no documents in this channel, return "No documents have been uploaded yet" message
- [x] T029 [US4] Add TOC regeneration trigger calls to `src/services/document/indexer.ts` -- call `generateTableOfContents(teamId, channelId)` after successful document indexing (create/update)
- [x] T030 [US4] Add TOC regeneration trigger to document archive flow (will be added in US5 T032) -- ensure `generateTableOfContents(teamId, channelId)` is called after archiving

**Checkpoint**: TOC auto-generates on every document state change. S3 and Redis always have current TOC.

---

## Phase 7: User Story 5 -- Document Management Commands (Priority: P2)

**Goal**: Users manage documents via ENRICH commands: list all docs, archive a doc (with permission check), and refresh TOC manually.

**Independent Test**: Upload 3 documents. Type "ENRICH docs" and verify all 3 appear grouped by type. Type "ENRICH delete doc {slug}" as the uploader and verify it archives. Type "ENRICH docs" again and verify it no longer appears. Type "ENRICH refresh toc" and verify TOC regeneration confirmation.

### Implementation for User Story 5

- [x] T031 [P] [US5] Create document list formatter `src/services/document/listFormatter.ts` -- export `formatDocumentList(teamId: string): Promise<KnownBlock[]>`. Query all active ClientDocuments for the team across all docs channels, group by channel then by document_type, format as Block Kit blocks per contracts section 2.2 (header per channel with channel name, section with mrkdwn text grouped by type, context block with count). If no documents, return "No documents uploaded yet" message. **Note**: Pagination for 100+ documents is out of scope for v1 (target is ~50 docs/team). If the list exceeds Slack's block limit (50 blocks), truncate with a "showing first N documents" footer
- [x] T032 [P] [US5] Create document archive service `src/services/document/archiver.ts` -- export `archiveDocument(teamId: string, slug: string, requestingUserId: string): Promise<{success: boolean, error?: string}>`. Flow: (1) look up ClientDocument by `[teamId, slug]` across all channels -- if found in multiple channels, return error with disambiguation needed, (2) if not found, return error "not found", (3) check permission: `requestingUserId === doc.slackUserId` OR user is workspace admin (check via `client.users.info` for `is_admin`), (4) if no permission, return error "permission denied", (5) update status to ARCHIVED, (6) log `doc_archive` audit event, (7) call `generateTableOfContents(teamId, doc.slackChannelId)` to regenerate channel TOC, (8) return success
- [x] T033 [US5] Extend `src/listeners/events/message.ts` to detect and handle document management commands BEFORE the existing intent classification flow. Add regex detection for: (1) `^ENRICH\s+docs\s*$` -> call `formatDocumentList()`, post as reply, (2) `^ENRICH\s+delete\s+doc\s+([\w-]+)\s*$` -> call `archiveDocument()` with extracted slug, post result message, (3) `^ENRICH\s+refresh\s+toc\s*$` -> call `generateTableOfContents()`, post "Table of contents regenerated. X active documents indexed." These patterns must be checked and handled before any file/enrichment processing logic
- [x] T034 [US5] Pass the Slack `WebClient` to the archive service for admin permission checking -- ensure `archiveDocument` has access to `client.users.info` API to verify `is_admin` on the requesting user. Import the Slack client from the event context in the message handler

**Checkpoint**: Full document management command suite operational. Users can list, archive (with permission checks), and refresh TOC.

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Edge case handling, error resilience, and integration validation across all user stories.

- [x] T035 [P] Handle edge case: empty/near-empty conversion output in `src/services/document/converter.ts` -- if converted markdown is less than 50 characters, post a warning: "Converted document contains minimal text content and may not be useful as a reference."
- [x] T036 [P] Handle edge case: unsupported file types in `src/listeners/events/fileSharedDocument.ts` -- for files with MIME types not in the supported list, post a message listing supported formats (`.md`, `.txt`, `.pdf`, `.docx`, `.xlsx`)
- [x] T037 [P] Handle edge case: partial slug matching in `src/services/document/referenceResolver.ts` -- when exact slug not found, query for slugs containing the search term and suggest similar matches in the "not found" response
- [x] T038 [P] Handle edge case: concurrent uploads with same slug in `src/services/document/indexer.ts` -- use Prisma transaction with serializable isolation or optimistic locking via version field to prevent race conditions on upsert
- [x] T039 Validate quickstart.md end-to-end flow: (1) upload a markdown ICP file, confirm type, (2) upload a PDF one-pager, wait for conversion, confirm type, (3) type "ENRICH docs" to list, (4) type "ENRICH this list using {slug}" to verify reference resolution, (5) type "ENRICH delete doc {slug}" to verify archive

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies -- can start immediately
- **Foundational (Phase 2)**: Depends on Phase 1 (npm install must complete before DB migration). T005/T006/T007 depend on T004 (enums before models). T008 depends on T005/T006/T007 (all models before migration)
- **User Story 1 (Phase 3)**: Depends on Phase 2 complete. No dependency on other user stories
- **User Story 2 (Phase 4)**: Depends on Phase 2 complete AND Phase 3 (US1) -- reuses fileSharedDocument.ts listener, documentTypeConfirm handler, and indexer from US1
- **User Story 3 (Phase 5)**: Depends on Phase 2 complete AND Phase 3 (US1) -- requires documents to exist for reference testing
- **User Story 4 (Phase 6)**: Depends on Phase 3 (US1) complete -- needs indexer to trigger TOC generation
- **User Story 5 (Phase 7)**: Depends on Phase 3 (US1) and Phase 6 (US4) -- archive triggers TOC regeneration
- **Polish (Phase 8)**: Depends on all user stories being complete

### User Story Dependencies

```
Phase 1: Setup
    ↓
Phase 2: Foundational
    ↓
Phase 3: US1 (Upload & Index Markdown) ← MVP
    ↓ \
    ↓  Phase 6: US4 (Table of Contents)
    ↓      ↓
    ↓  Phase 7: US5 (Management Commands)
    ↓
Phase 4: US2 (Auto-Convert Non-Markdown)
Phase 5: US3 (Reference in Enrichment)
    ↓
Phase 8: Polish
```

### Within Each User Story

- Utility services (classifier, converter, parser) before event handlers
- Event handlers before action handlers
- Core flow before app.ts registration

### Parallel Opportunities

**Phase 2**: T006, T007 can run in parallel (independent schema additions). T009 can run in parallel with T008 (different files)
**Phase 3**: T012, T013, T014 can run in parallel (independent service files)
**Phase 4**: T019 can start as soon as Phase 2 completes (independent converter module)
**Phase 5**: T023, T024 can run in parallel (independent service files)
**Phase 7**: T031, T032 can run in parallel (independent service files)
**Phase 8**: T035, T036, T037, T038 can all run in parallel (different files)

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (T001-T003)
2. Complete Phase 2: Foundational (T004-T011)
3. Complete Phase 3: User Story 1 (T012-T018)
4. **STOP and VALIDATE**: Upload a `.md` file to a docs channel, confirm type via buttons, verify document indexed in DB and stored in S3
5. Deploy/demo if ready

### Incremental Delivery

1. Setup + Foundational -> Foundation ready
2. Add US1 (Upload & Index) -> Test independently -> **Deploy (MVP!)**
3. Add US2 (Auto-Convert) -> Test PDF/DOCX/XLSX uploads -> Deploy
4. Add US3 (References) -> Test ENRICH with document context -> Deploy
5. Add US4 (TOC) -> Test auto-generation -> Deploy
6. Add US5 (Commands) -> Test list/delete/refresh -> Deploy
7. Polish -> Edge cases and hardening -> Final deploy
