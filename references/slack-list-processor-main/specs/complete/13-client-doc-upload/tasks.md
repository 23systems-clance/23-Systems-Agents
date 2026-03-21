# Tasks: Client Config Document Upload via Dashboard

**Input**: Design documents from `/specs/13-client-doc-upload/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/api-contracts.md, quickstart.md

**Tests**: Not explicitly requested — test tasks omitted. Manual testing via deployed ECS + CloudFront.

**Organization**: Tasks grouped by user story for independent implementation and testing.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story (US1, US2, US3, US4)
- Exact file paths included in descriptions

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Install dependencies and prepare database schema changes

- [x] T001 Install multer dependency for multipart file uploads in package.json (`npm install multer @types/multer`)
- [x] T002 Add new fields to ChannelConfigDoc model in prisma/schema.prisma: `displayLabel`, `s3Key`, `originalMimeType`, `contentSizeBytes` (all optional)
- [x] T003 Add ChannelClientMapping model to prisma/schema.prisma with fields: `id`, `slackTeamId`, `slackChannelId`, `clientId` (FK to ManagedClient), `createdByUserId`, timestamps; unique constraint on `(slackTeamId, slackChannelId)`
- [x] T004 Add `channelMappings ChannelClientMapping[]` relation to ManagedClient model in prisma/schema.prisma
- [x] T005 Generate and apply Prisma migration: `npx prisma migrate dev --name add-upload-fields-and-channel-client-mapping`

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Token service and auth middleware that ALL user stories depend on

**CRITICAL**: No user story work can begin until this phase is complete

- [x] T006 Create upload token service in src/services/upload/tokenService.ts — export `generateUploadToken(teamId, channelId, userId): string` and `validateUploadToken(token): UploadTokenPayload | null` using jsonwebtoken with `config.session.secret`, 24h expiry, payload `{ teamId, channelId, userId, purpose: 'config-upload' }`
- [x] T007 Create upload auth middleware in src/lib/uploadAuth.ts — extract JWT from `?token=` query param, validate via `validateUploadToken()`, attach `req.uploadContext = { teamId, channelId, userId }` to request; return 401 with JSON error on invalid/expired tokens
- [x] T008 Update configDocService in src/services/analyze/configDocService.ts — extend `upsertConfigDoc()` to accept and store `displayLabel`, `s3Key`, `originalMimeType`, `contentSizeBytes`; extend `getConfigDoc()` and `getAllConfigDocs()` to return new fields; extend `deleteConfigDoc()` to also delete S3 file via `deleteFile()` from src/lib/storage.ts
- [x] T009 [P] Create auto-label generation function in src/services/upload/labelGenerator.ts — call Claude Haiku with prompt "Summarize this document in 5-10 words as a label, starting with the document type" on first 2000 chars of markdown; fallback to `"{DocType} - {originalFilename}"` on AI failure; track API usage cost

**Checkpoint**: Foundation ready — token generation, validation, storage service, and label generation all functional

---

## Phase 3: User Story 1 — Slack /upload Command (Priority: P1) MVP

**Goal**: User types `/upload` in Slack and receives an ephemeral message with a clickable link to the dashboard upload page

**Independent Test**: Type `/upload` in any Slack channel → verify ephemeral message appears with a valid URL containing a JWT token

### Implementation for User Story 1

- [x] T010 [US1] Create /upload slash command handler in src/listeners/commands/upload.ts — `ack()` immediately, generate JWT via `generateUploadToken()`, build dashboard URL `https://{dashboardDomain}/upload/{token}`, respond ephemeral with Block Kit message containing "Open Upload Page" button and "This link expires in 24 hours" context; handle DM error case
- [x] T011 [US1] Register upload command in src/app.ts — import and call `registerUploadCommand(app)` alongside existing command registrations
- [x] T012 [US1] Add dashboard domain config to src/config/index.ts — `dashboardUrl: env('DASHBOARD_URL', 'https://dt9zhghz3mtx8.cloudfront.net')` for constructing upload links

**Checkpoint**: `/upload` command works in Slack and produces a valid link. Link points to dashboard but page doesn't exist yet (that's US2).

---

## Phase 4: User Story 2 — Upload Documents via Dashboard (Priority: P1) MVP

**Goal**: User clicks the link from Slack, lands on the upload page, sees 4 document slots, and can upload files that get converted to Markdown and stored

**Independent Test**: Navigate to `/upload/{validToken}` → see 4 doc type slots → upload a .docx file → verify it's converted to Markdown, stored in DB, and original uploaded to S3

### Backend API for User Story 2

- [x] T013 [US2] Create upload API router in src/routes/upload/index.ts — mount `uploadAuth` middleware on all routes; implement `POST /api/v1/upload/validate-token` (returns channel context + client name from ChannelClientMapping if exists); implement `GET /api/v1/upload/docs` (returns 4 doc slots with status, always exactly 4 entries)
- [x] T014 [US2] Implement file upload endpoint in src/routes/upload/index.ts — `POST /api/v1/upload/docs` with multer single file middleware (10MB limit); validate file type (.txt, .md, .csv, .docx, .pdf, .xlsx); convert to Markdown via `convertToMarkdown()`; upload original to S3 via `uploadFile()` with key `config-docs/{teamId}/{channelId}/{docType}/v{version}/{filename}`; generate display label via `generateLabel()`; upsert via `configDocService.upsertConfigDoc()`; return created doc
- [x] T015 [US2] Mount upload router in src/server.ts — add `app.use('/api/v1/upload', uploadRouter)` BEFORE admin auth middleware (upload routes use their own token auth)

### Frontend for User Story 2

- [x] T016 [P] [US2] Create upload API service in admin-dashboard/src/services/upload.ts — functions: `validateToken(token)`, `fetchDocs(token)`, `uploadDoc(token, docType, file)` using axios with base URL `/api/v1/upload` and `?token=` query param
- [x] T017 [P] [US2] Add upload query keys in admin-dashboard/src/lib/query-keys.ts — add `upload: { context: (token) => ['upload', 'context', token], docs: (token) => ['upload', 'docs', token] }`
- [x] T018 [US2] Create upload page in admin-dashboard/src/pages/upload.tsx — extract token from `useParams()`, validate on mount via `validateToken()`, show expired/error state if invalid; display channel name + client name header; render 4 doc type cards (ICP, Use Cases, Campaigns, Settings) each showing status (uploaded with version/date or "Missing"); file input per card for uploading; loading states during upload; success toast on completion
- [x] T019 [US2] Add public route in admin-dashboard/src/router.tsx — add `{ path: '/upload/:token', element: <UploadPage /> }` OUTSIDE the `RequireAuth` layout (alongside `/login` route); lazy-load with Suspense

**Checkpoint**: Full upload flow works end-to-end: `/upload` in Slack → click link → see doc slots → upload file → stored in DB + S3

---

## Phase 5: User Story 3 — View and Manage Documents (Priority: P2)

**Goal**: Users can preview Markdown content, download original files, rename display labels, and delete documents from the upload page

**Independent Test**: Upload a document → preview its Markdown content → download the original file → rename the label → delete the document → verify it's removed

### Backend API for User Story 3

- [x] T020 [P] [US3] Implement content preview endpoint in src/routes/upload/index.ts — `GET /api/v1/upload/docs/:id/content` returns full Markdown content for the doc; validate doc belongs to token's channel
- [x] T021 [P] [US3] Implement file download endpoint in src/routes/upload/index.ts — `GET /api/v1/upload/docs/:id/download` streams original file from S3 with correct Content-Type and Content-Disposition headers; validate doc belongs to token's channel
- [x] T022 [P] [US3] Implement label rename endpoint in src/routes/upload/index.ts — `PUT /api/v1/upload/docs/:id/label` accepts `{ displayLabel }` body (max 100 chars, non-empty); updates label without changing version
- [x] T023 [P] [US3] Implement delete endpoint in src/routes/upload/index.ts — `DELETE /api/v1/upload/docs/:id` hard-deletes doc from DB and S3 original file; validate doc belongs to token's channel

### Frontend for User Story 3

- [x] T024 [P] [US3] Add management API functions in admin-dashboard/src/services/upload.ts — `fetchDocContent(token, docId)`, `downloadDoc(token, docId)`, `renameDocLabel(token, docId, label)`, `deleteDoc(token, docId)`
- [x] T025 [US3] Add preview modal to upload page in admin-dashboard/src/pages/upload.tsx — click on uploaded doc card opens a dialog/drawer showing rendered Markdown content with a "Download Original" button; use shadcn Dialog component
- [x] T026 [US3] Add inline label rename to upload page in admin-dashboard/src/pages/upload.tsx — click on display label makes it editable (inline text input); blur or Enter saves via `renameDocLabel()`; show save indicator
- [x] T027 [US3] Add delete functionality to upload page in admin-dashboard/src/pages/upload.tsx — delete button on each uploaded doc card; shadcn AlertDialog for confirmation; on confirm call `deleteDoc()` and invalidate query cache

**Checkpoint**: Full document management: preview, download, rename, delete all working on the upload page

---

## Phase 6: User Story 4 — Slack Confirmation After Upload (Priority: P3)

**Goal**: After uploading or deleting a document via the dashboard, a confirmation message appears in the originating Slack channel

**Independent Test**: Upload a document via the dashboard → check the Slack channel for a confirmation message with doc type and version

### Implementation for User Story 4

- [x] T028 [US4] Create Slack notification helper in src/services/upload/slackNotifier.ts — export `notifyConfigDocUpload(teamId, channelId, docType, version, displayLabel, userId)` and `notifyConfigDocDelete(teamId, channelId, docType, userId)` using the Slack WebClient from app.ts; post to channel (not ephemeral, visible to all)
- [x] T029 [US4] Wire Slack notifications into upload route in src/routes/upload/index.ts — call `notifyConfigDocUpload()` after successful POST /docs; call `notifyConfigDocDelete()` after successful DELETE /docs/:id; notifications are fire-and-forget (don't block response on Slack API failure)

**Checkpoint**: Upload/delete actions on dashboard trigger visible Slack channel messages

---

## Phase 7: Admin Channel-Client Mapping Management

**Purpose**: Allow admins to link Slack channels to ManagedClient entities for display on the upload page

- [x] T030 [P] Create channel-client mapping CRUD routes in src/routes/admin/channelMappings.ts — `GET /` lists all mappings with client names (optional `?teamId=` filter); `POST /` creates mapping (409 if channel already mapped); `DELETE /:id` removes mapping
- [x] T031 Mount channel-mappings router in src/routes/admin/index.ts — `adminRouter.use('/channel-mappings', channelMappingsRouter)` (uses existing admin auth + rate limiting)
- [x] T032 [P] Add channel-mapping API service in admin-dashboard/src/services/channelMappings.ts — `fetchMappings()`, `createMapping(teamId, channelId, clientId)`, `deleteMapping(id)` using admin API client
- [x] T033 Add channel-client mapping UI to admin dashboard — either extend admin-dashboard/src/pages/clients.tsx with a "Link Channel" action per client, or create a dedicated admin-dashboard/src/pages/channel-mappings.tsx page; list existing mappings with delete option; form to create new mapping (select client + enter channel ID)

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Integration verification and cleanup

- [x] T034 Update /analyze report generator in src/services/analyze/reportGenerator.ts — ensure `getAllConfigDocs()` returns `displayLabel` and `originalFileName` alongside content; pass both to AI narrative generator as context metadata
- [x] T035 Verify CORS configuration in src/server.ts — ensure `CORS_ALLOWED_ORIGINS` includes the CloudFront dashboard domain for upload API calls
- [x] T036 Add audit logging for config doc operations in src/routes/upload/index.ts — log upload, delete, and label rename actions with userId, teamId, channelId, docType using existing logger
- [ ] T037 Push to GitHub and deploy — push branch to trigger CI/CD for ECS; build and deploy admin dashboard frontend to CloudFront+S3; verify end-to-end flow

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies — start immediately
- **Phase 2 (Foundational)**: Depends on Phase 1 (schema must be migrated first)
- **Phase 3 (US1)**: Depends on Phase 2 (needs token service)
- **Phase 4 (US2)**: Depends on Phase 2 (needs token auth + config doc service); can run in parallel with Phase 3
- **Phase 5 (US3)**: Depends on Phase 4 (needs upload endpoints and page to exist)
- **Phase 6 (US4)**: Depends on Phase 4 (needs upload route to wire notifications into)
- **Phase 7 (Admin Mapping)**: Depends on Phase 1 (needs ChannelClientMapping model); can run in parallel with Phases 3-6
- **Phase 8 (Polish)**: Depends on Phases 3-7 completion

### User Story Dependencies

- **US1 (Slack command)**: Independent — only needs token service from Phase 2
- **US2 (Upload page)**: Independent — only needs token auth + config doc service from Phase 2
- **US3 (View/Manage)**: Depends on US2 (extends the upload page and API)
- **US4 (Slack confirmation)**: Depends on US2 (hooks into upload/delete route handlers)

### Within Each User Story

- Backend before frontend (API must exist before UI calls it)
- Router/middleware before route handlers
- Service layer before route handlers that use it
- Core functionality before integration/polish

### Parallel Opportunities

- T009 (label generator) can run in parallel with T006-T008
- T016, T017 (frontend service + query keys) can run in parallel with T013-T015 (backend API)
- T020, T021, T022, T023 (US3 backend endpoints) can all run in parallel
- T030, T032 (admin mapping backend + frontend service) can run in parallel
- Phase 7 (admin mapping) can run entirely in parallel with Phases 3-6

---

## Implementation Strategy

### MVP First (User Stories 1 + 2)

1. Complete Phase 1: Setup (schema + dependency)
2. Complete Phase 2: Foundational (token service, auth middleware, config doc service)
3. Complete Phase 3: US1 — `/upload` command works in Slack
4. Complete Phase 4: US2 — Upload page works end-to-end
5. **STOP and VALIDATE**: Test full flow: `/upload` → click link → upload file → verify stored
6. Deploy MVP

### Incremental Delivery

1. Setup + Foundational → Foundation ready
2. US1 + US2 → Test end-to-end → Deploy (MVP!)
3. US3 → Preview, download, rename, delete → Deploy
4. US4 → Slack confirmations → Deploy
5. Admin Mapping → Channel-client links → Deploy
6. Polish → /analyze integration, audit logging → Final deploy
