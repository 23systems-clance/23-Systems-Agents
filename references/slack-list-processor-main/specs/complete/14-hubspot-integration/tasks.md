# Tasks: HubSpot Integration — OAuth + Contact Import + Activity Sync + Webhooks

**Input**: Design documents from `/specs/14-hubspot-integration/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/oauth.md, contracts/import.md, contracts/activity.md, contracts/webhooks.md, quickstart.md
**Updated**: 2026-03-11 (reflects clarification-driven changes: date range presets, batch Search API, app-level webhooks, existing event source hooks)

**Tests**: Not explicitly requested in spec. Test tasks omitted. Verify via deployed ECS environment per quickstart.md.

**Organization**: Tasks grouped by user story. US1 + US2 form the MVP. US6 + US7 + US8 extend with activity sync and webhooks.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Install dependencies, add config, register slash command

- [x] T001 Install dependencies via `npm install @hubspot/api-client jsonwebtoken @types/jsonwebtoken`
- [x] T002 Add HubSpot OAuth config entries (`hubspotOAuth.clientId`, `hubspotOAuth.clientSecret`, `hubspotOAuth.redirectUri`) to `src/config/index.ts` reading from `HUBSPOT_OAUTH_CLIENT_ID`, `HUBSPOT_OAUTH_CLIENT_SECRET`, `HUBSPOT_OAUTH_REDIRECT_URI` env vars
- [x] T003 [P] Add new env vars (`HUBSPOT_OAUTH_CLIENT_ID`, `HUBSPOT_OAUTH_CLIENT_SECRET`, `HUBSPOT_OAUTH_REDIRECT_URI`) to `.env.example` (CloudFormation changes handled in T058)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Database models, OAuth service, and queue setup that ALL user stories depend on

**CRITICAL**: No user story work can begin until this phase is complete

- [x] T004 Add all HubSpot Prisma models (`HubSpotConnection`, `HubSpotImportJob`, `HubSpotContactMapping`, `HubSpotEngagementMapping`, `HubSpotSyncLog`) with enums (`HubSpotConnectionStatus`, `HubSpotImportStatus`, `HubSpotSyncType`) to `prisma/schema.prisma` per data-model.md. Add `hubspotConnection HubSpotConnection?` relation to existing `ManagedClient` model
- [x] T005 Generate and apply Prisma migration: `npx prisma migrate dev --name add-hubspot-oauth-models`
- [x] T006 [P] Create `src/services/hubspot/hubspotOAuth.ts` implementing `HubSpotOAuthService` interface from contracts/oauth.md: `generateAuthUrl()` (builds HubSpot OAuth URL with state JWT), `handleCallback()` (exchanges code for tokens, encrypts + stores in DB), `getAccessToken()` (loads from DB, auto-refreshes if within 5min of expiry), `disconnect()` (deletes connection), `getConnectionStatus()` (returns connection or null). Use `src/lib/tokenEncryption.ts` for encrypt/decrypt. Use `jsonwebtoken` for state JWT signed with `config.oauth.stateSecret`
- [x] T007 [P] Create `src/services/queue/queues.ts` additions: add `hubspotImportQueue` (queue name: `hubspot-import`, 3 attempts, exponential backoff 5s base) and `hubspotActivitySyncQueue` (queue name: `hubspot-activity-sync`, 3 attempts, exponential backoff 5s base) following existing queue pattern in that file
- [x] T008 [P] Create `src/routes/hubspot/oauth.ts` Express router with two routes: `GET /api/hubspot/oauth/callback` (validates state JWT, checks nonce in Redis, calls `hubspotOAuth.handleCallback()`, redirects to success page, posts Slack confirmation) and `GET /api/hubspot/oauth/success` (renders simple HTML success page). Per contracts/oauth.md
- [x] T009 Mount HubSpot OAuth router in `src/server.ts`: add `app.use('/api/hubspot/oauth', hubspotOAuthRouter)` (no auth middleware — security via state parameter)

**Checkpoint**: Foundation ready — HubSpot OAuth service, database models, queue, and callback route are in place

---

## Phase 3: User Story 1 — Connect HubSpot Account via Slack (Priority: P1) MVP

**Goal**: Client types `/hubspot connect` in their Slack channel, completes OAuth flow in browser, and sees confirmation message in Slack with portal name

**Independent Test**: Type `/hubspot connect` in a channel with a ChannelClientMapping → click "Connect HubSpot" button → authorize in HubSpot → verify confirmation message appears and `HubSpotConnection` record exists in DB

### Implementation for User Story 1

- [x] T010 [US1] Create `src/listeners/commands/hubspot.ts` with `registerHubspotCommand(app: App)` function. Parse `command.text` for subcommands (`connect`, `disconnect`, `status`, `import`, `activity`, `sync`, `help`). For `connect`: look up `ChannelClientMapping` → check no existing active connection → call `hubspotOAuth.generateAuthUrl()` → post ephemeral Block Kit message with "Connect HubSpot" button (URL-type button linking to auth URL). Handle error cases: no client mapping (error message), already connected (warning with portal name). Per contracts/oauth.md slash command contract
- [x] T011 [US1] Register the `/hubspot` command in `src/app.ts` by calling `registerHubspotCommand(app)` alongside existing command registrations
- [x] T012 [US1] Implement nonce storage in `src/services/hubspot/hubspotOAuth.ts` `generateAuthUrl()`: generate crypto-random nonce, store in Redis with key `hubspot:nonce:{nonce}` and 15-minute TTL, include in JWT state payload `{ clientId, channelId, userId, nonce }`
- [x] T013 [US1] Implement `handleCallback()` in `src/services/hubspot/hubspotOAuth.ts`: verify JWT state signature → extract nonce → check+delete nonce from Redis (prevent replay) → use `@hubspot/api-client` `oauth.tokensApi.create('authorization_code', ...)` to exchange code for tokens → fetch portal info via access token info endpoint → encrypt tokens via `tokenEncryption.encrypt()` → create `HubSpotConnection` record in DB with status ACTIVE
- [x] T014 [US1] Add Slack confirmation posting to OAuth callback route in `src/routes/hubspot/oauth.ts`: after `handleCallback()` succeeds, use Slack Web API client to post message to originating channel (from state JWT): "HubSpot connected for {clientName} (Portal: {portalId}). Use `/hubspot import` to import contacts."
- [x] T015 [US1] Implement `getAccessToken()` auto-refresh logic in `src/services/hubspot/hubspotOAuth.ts`: load `HubSpotConnection` → if `tokenExpiresAt > now + 5min` return decrypted token → else call HubSpot refresh endpoint via `oauth.tokensApi.create('refresh_token', ...)` → update DB with new encrypted tokens + new expiresAt + lastRefreshedAt → on `BAD_REFRESH_TOKEN` error set status to TOKEN_EXPIRED and post warning to client's Slack channel via ChannelClientMapping
- [x] T016 [US1] Add `help` subcommand handler in `src/listeners/commands/hubspot.ts`: respond ephemeral with formatted help text listing all subcommands per contracts/oauth.md

**Checkpoint**: User Story 1 complete — clients can connect their HubSpot accounts via OAuth from Slack

---

## Phase 4: User Story 2 — Import Contacts to HubSpot and Create a List (Priority: P1) MVP

**Goal**: User runs `/hubspot import` or clicks "Import to HubSpot" button on enrichment completion → selects file → enters naming → confirms mapping → contacts upserted in HubSpot + static list created

**Independent Test**: Connect HubSpot (US1) → run an enrichment job → click "Import to HubSpot" on completion message → enter client name and campaign name → confirm auto-detected mapping → verify contacts in HubSpot CRM and static list created with correct `LIST : MMDD [CLIENT] Campaign` name

**Depends on**: US1 (connection must exist)

### Implementation for User Story 2

- [x] T017 [P] [US2] Create `src/services/hubspot/hubspotPropertyMapping.ts` implementing `HubSpotPropertyMappingService`: `autoDetectMapping(csvHeaders: string[])` returns `Record<string, string>` using the fuzzy mapping dictionary from research.md (normalize headers to lowercase, match against known aliases for email, firstname, lastname, jobtitle, company, phone, mobilephone, linkedin, city, state, country, website). `getContactProperties(clientId: string)` fetches all contact properties (standard + custom) from client's HubSpot via Properties API using `getAccessToken()`. `ensureEnrichmentProperties(clientId: string)` creates custom property group "Enrichment Data" and properties (`enrichment_source`, `enrichment_date`, `tech_spend_tier` as enumeration, `enrichment_job_id`) if not already created (check `propertiesCreated` flag on HubSpotConnection, use try/catch for 409 Conflict)
- [x] T018 [P] [US2] Create `src/services/hubspot/hubspotImport.ts` implementing `HubSpotImportService`: `startImport(params)` creates `HubSpotImportJob` record in DB with status PENDING → enqueues BullMQ job on `hubspot-import` queue with `{ importJobId, clientId, channelId, threadTs }` → returns the DB record. `cancelImport(importJobId)` sets status to CANCELLED. `getImportHistory(clientId, limit)` returns recent imports for a client
- [x] T019 [US2] Add `import` subcommand handler in `src/listeners/commands/hubspot.ts`: check active HubSpot connection exists → query recent completed jobs (enrichment, filter, split) in this channel from `Job` table (last 30 days) → post Block Kit message with static_select dropdown of files (showing filename + contact count) and an "Upload new file" option that opens a file upload dialog per contracts/import.md Step 1 and FR-010
- [x] T020 [US2] Create `src/listeners/actions/hubspotImport.ts` and register action handler for `hubspot_file_selected` action: when user selects file from dropdown → download file from S3 → parse CSV headers → store in conversation state → open Slack modal for naming (client name + campaign name inputs) with `callback_id: hubspot_import_naming` per contracts/import.md Step 2
- [x] T021 [US2] Register view submission handler for `hubspot_import_naming` modal in `src/listeners/actions/hubspotImport.ts`: extract client name + campaign name from modal → run `autoDetectMapping()` on stored CSV headers → format list name as `LIST : MMDD [CLIENT] Campaign Name` → post column mapping preview to Slack thread with "Confirm & Import", "Map Columns", and "Cancel" buttons per contracts/import.md Step 3
- [x] T022 [US2] Register action handler for `hubspot_import_confirm` button in `src/listeners/actions/hubspotImport.ts`: create `HubSpotImportJob` record → call `hubspotImport.startImport()` to enqueue BullMQ job → post "Import started" acknowledgment to Slack thread
- [x] T023 [US2] Create `src/services/queue/workers/hubspotImportWorker.ts` implementing the async import processor: load HubSpotImportJob from DB → set status PROCESSING → get valid access token → call `ensureEnrichmentProperties()` → download + parse source file → if row count >5,000 post warning to Slack thread ("Large import: {count} rows. This may take several minutes.") → apply column mapping → chunk rows into batches of 100 → for each batch: call HubSpot batch upsert API (`/crm/v3/objects/contacts/batch/upsert` with `idProperty: "email"`) adding enrichment metadata properties → track created/updated/failed counts → post progress to Slack every 500 contacts → after all contacts: create static list via Lists API (`POST /crm/v3/lists` with `processingType: "MANUAL"`) → add contact IDs to list in batches of 100 (`PUT /crm/v3/lists/{listId}/memberships/add`) → update HubSpotImportJob with final counts + list ID + list URL → set status COMPLETED → post completion summary to Slack per contracts/import.md Step 5. Handle rate limits (429) with exponential backoff. Handle token refresh mid-import. On failure set status FAILED with error message
- [x] T024 [US2] Register the `hubspotImportWorker` in `src/app.ts` alongside existing workers: `workers.push(createHubSpotImportWorker(slackClient))`
- [x] T025 [US2] Modify `src/services/queue/workers/fileGeneration.ts` to add "Import to HubSpot" button to enrichment completion messages: after posting the file/download link, check if the channel has a `ChannelClientMapping` with an active `HubSpotConnection` → if yes, append an actions block with "Import to HubSpot" (primary, `action_id: hubspot_import_from_enrichment`, value contains enrichment jobId) and "Cancel" buttons per contracts/import.md inline import section. If no connection, skip the button (FR-022)
- [x] T026 [US2] Register action handler for `hubspot_import_from_enrichment` button in `src/listeners/actions/hubspotImport.ts`: extract enrichment jobId from button value → load job details (filename, S3 URL, row count) → parse CSV headers → store in conversation state → open naming modal (same as T020 flow, pre-populated with enrichment file info)
- [x] T027 [US2] Register action handler for `hubspot_import_cancel` and `hubspot_import_cancel_inline` buttons in `src/listeners/actions/hubspotImport.ts`: delete any pending conversation state, post ephemeral "Import cancelled"
- [x] T028 [US2] Register all hubspot action handlers in `src/app.ts` by calling the registration function from `src/listeners/actions/hubspotImport.ts`

**Checkpoint**: User Stories 1 + 2 complete — full OAuth → Import → List Creation flow works end-to-end. MVP is shippable.

---

## Phase 5: User Story 5 — Manual Column Mapping for Non-Standard Files (Priority: P2)

**Goal**: When auto-detection fails or user wants to override, a "Map Columns" modal shows all CSV columns with dropdowns of all HubSpot properties (standard + custom) fetched from the client's portal

**Independent Test**: Import a CSV with non-standard column names (e.g., "Person Email", "Full Name") → click "Map Columns" → see all HubSpot properties in dropdowns → map columns → verify import uses custom mapping

**Depends on**: US2 (import flow must exist)

### Implementation for User Story 5

- [x] T029 [US5] Register action handler for `hubspot_import_map_columns` button in `src/listeners/actions/hubspotImport.ts`: call `hubspotPropertyMapping.getContactProperties(clientId)` to fetch all properties from client's HubSpot → build Slack modal with one `static_select` dropdown per CSV column, each containing all HubSpot property options (grouped by property group) + "Ignore" option → pre-select auto-detected mappings where available → open modal with `callback_id: hubspot_column_mapping`. Note: Slack modals support max 100 blocks; if CSV has >50 columns, show most common + "Ignore rest" option
- [x] T030 [US5] Register view submission handler for `hubspot_column_mapping` modal in `src/listeners/actions/hubspotImport.ts`: extract user-selected mappings from modal state → validate at least email column is mapped (show validation error if not) → store final mapping in conversation state → call `hubspotImport.startImport()` with custom mapping → post "Import started" to thread
- [x] T031 [US5] Cache HubSpot property list in Redis (key: `hubspot:props:{clientId}`, TTL: 1 hour) in `src/services/hubspot/hubspotPropertyMapping.ts` `getContactProperties()` to avoid re-fetching on every mapping modal open

**Checkpoint**: User Story 5 complete — users can manually map any CSV column to any HubSpot property

---

## Phase 6: User Story 3 — Check HubSpot Connection Status (Priority: P2)

**Goal**: User types `/hubspot status` and sees connection health, portal info, and import stats

**Independent Test**: Connect HubSpot → run `/hubspot status` → verify portal name, ID, connection date, and import count are shown. Disconnect → run `/hubspot status` → verify "Not connected" message

**Depends on**: US1 (connection model must exist)

### Implementation for User Story 3

- [x] T032 [US3] Implement `status` subcommand in `src/listeners/commands/hubspot.ts`: look up `ChannelClientMapping` → load `HubSpotConnection` for that client → if ACTIVE: post Block Kit message with portal name, portal ID, connection date, connected by user, total imports count (query `HubSpotImportJob` count), last import date → if no connection: post "Not connected. Use `/hubspot connect`" → if TOKEN_EXPIRED: post warning with reconnect suggestion → if no client mapping: post "No client assigned to this channel"
- [x] T033 [US3] Build Block Kit message builder function for status display in `src/listeners/commands/hubspot.ts`: include section with fields for portal info, context block for connection metadata, and divider before import stats

**Checkpoint**: User Story 3 complete — connection status is visible via `/hubspot status`

---

## Phase 7: User Story 4 — Disconnect HubSpot Account (Priority: P3)

**Goal**: User types `/hubspot disconnect`, confirms via button, and connection is removed

**Independent Test**: Connect HubSpot → run `/hubspot disconnect` → click "Disconnect" confirmation → verify connection removed from DB and confirmation posted

**Depends on**: US1 (connection must exist to disconnect)

### Implementation for User Story 4

- [x] T034 [US4] Implement `disconnect` subcommand in `src/listeners/commands/hubspot.ts`: look up active `HubSpotConnection` → if exists, post confirmation prompt with "Disconnect" (danger style, `action_id: hubspot_disconnect_confirm`) and "Cancel" buttons → if no connection, post "No active HubSpot connection"
- [x] T035 [US4] Register action handler for `hubspot_disconnect_confirm` in `src/listeners/actions/hubspotImport.ts` (or separate file): call `hubspotOAuth.disconnect(clientId)` which deletes the `HubSpotConnection` record → post confirmation message "HubSpot disconnected for {clientName}"
- [x] T036 [US4] Register action handler for `hubspot_disconnect_cancel`: delete the confirmation message or post ephemeral "Disconnect cancelled"

**Checkpoint**: User Story 4 complete — full connection lifecycle (connect → status → disconnect) works

---

## Phase 8: User Story 6 — Pull Activity Data from HubSpot (Priority: P2)

**Goal**: User types `/hubspot activity` (optionally with an email). Bot shows preset date range buttons (Today, Last 7 Days, Custom). After selecting a range, bot queries HubSpot Search API in batch and returns a summary with counts, conversation notes, and engagement details

**Independent Test**: Create a meeting and call in HubSpot for a known contact → run `/hubspot activity user@example.com` → select "Last 7 Days" → verify activity summary appears with counts and engagement details

**Depends on**: US1 (connection must exist) + US2 (contact mappings from imports)

### Implementation for User Story 6

- [x] T037 [P] [US6] Create `src/services/hubspot/hubspotActivity.ts` implementing `HubSpotActivityService` from contracts/activity.md: `getContactActivity(params: { clientId, email, startDate, endDate })` looks up HubSpotContactMapping for the email → queries HubSpot Search API (`POST /crm/v3/objects/engagements/search`) filtering by `hs_timestamp` between startDate and endDate, scoped to that contact's hubspotContactId via associations → paginates with `after` cursor → returns formatted activity list with engagement type, timestamp, subject/notes/outcome. `getActivitySummary(params: { clientId, startDate, endDate })` loads all HubSpotContactMappings for client → queries HubSpot Search API in batch with `hs_timestamp` BETWEEN filter → paginates through all results → filters client-side to include only engagements associated with mapped contacts → returns `HubSpotActivitySummary` with counts (calls, emails, meetings), uniqueContacts, topContacts, recentNotes
- [x] T038 [US6] Add `activity` subcommand handler in `src/listeners/commands/hubspot.ts`: parse optional email argument from command text → validate active HubSpot connection → post Block Kit message with preset date range buttons: "Today" (`action_id: hubspot_activity_today`), "Last 7 Days" (`action_id: hubspot_activity_7days`), "Custom" (`action_id: hubspot_activity_custom`). Store optional email in each button's value as JSON `{"email":"user@example.com"}` (or `{"email":null}` if no email). Per contracts/activity.md Step 1
- [x] T039 [P] [US6] Create `src/listeners/actions/hubspotActivity.ts` and register action handlers for `hubspot_activity_today` and `hubspot_activity_7days` buttons: extract email from button value JSON → compute date range (today = start of today to now; 7 days = 7 days ago start-of-day to now) → look up ChannelClientMapping → if email provided call `getContactActivity({ clientId, email, startDate, endDate })`, else call `getActivitySummary({ clientId, startDate, endDate })` → format results as Block Kit message: for single contact show header with email, date range, counts (:phone: Calls, :email: Emails, :calendar: Meetings), then individual engagement details with dates/notes/outcomes; for all contacts show header, date range, aggregate counts, top contacts list, recent conversation notes → update original message to replace buttons with results. Per contracts/activity.md Step 2
- [x] T040 [US6] Register action handler for `hubspot_activity_custom` button in `src/listeners/actions/hubspotActivity.ts`: extract email from button value JSON → open Slack modal (`callback_id: hubspot_activity_custom_range`) with two datepicker inputs (Start Date `block_id: start_date`, End Date `block_id: end_date`). Store email and channelId in modal `private_metadata` as JSON. Per contracts/activity.md custom date range modal
- [x] T041 [US6] Register view submission handler for `hubspot_activity_custom_range` modal in `src/listeners/actions/hubspotActivity.ts`: extract start_date and end_date from modal state values → validate end_date >= start_date (show validation error if not) → extract email and channelId from private_metadata → call appropriate activity service method (`getContactActivity` or `getActivitySummary`) → format and post results to channel as Block Kit message (same format as T039)
- [x] T042 [US6] Register all hubspot activity action handlers in `src/app.ts` by calling the registration function from `src/listeners/actions/hubspotActivity.ts`
- [x] T043 [US6] Update `src/services/queue/workers/hubspotImportWorker.ts` (from T023): after each batch upsert response, create `HubSpotContactMapping` records for each successfully upserted contact (email → hubspotContactId mapping). Use upsert to handle re-imports of existing contacts. This ensures `/hubspot activity` can look up contacts by email

**Checkpoint**: User Story 6 complete — users can query HubSpot activity from Slack with flexible date ranges

---

## Phase 9: User Story 7 — Push Activity to HubSpot (Priority: P2)

**Goal**: Campaign activity (calls, emails, meetings) is automatically pushed to HubSpot as engagement records, with idempotency tracking. Hooks into existing per-client webhook receivers — no new webhook infrastructure

**Independent Test**: Complete a call for a campaign contact whose client has HubSpot connected → verify call engagement appears in HubSpot associated with the correct contact

**Depends on**: US1 (connection must exist) + contact mappings (from US2 imports or auto-upsert)

### Implementation for User Story 7

- [x] T044 [P] [US7] Add `pushActivity()` method to `src/services/hubspot/hubspotActivity.ts`: check idempotency (query HubSpotEngagementMapping for event) → look up or upsert contact by email (create HubSpotContactMapping if new) → create engagement in HubSpot via Engagements API (`POST /crm/v3/objects/engagements` with associations) → create HubSpotEngagementMapping record → create HubSpotSyncLog entry → update HubSpotConnection stats. Per contracts/activity.md
- [x] T045 [P] [US7] Create `src/services/queue/workers/hubspotActivityWorker.ts`: BullMQ worker for `hubspot-activity-sync` queue. Process job data (`HubSpotActivitySyncJobData` from contracts/activity.md): load connection → validate ACTIVE → call `pushActivity()` → handle rate limits (429) with exponential backoff → handle token refresh → on failure create HubSpotSyncLog with error
- [x] T046 [US7] Register the `hubspotActivityWorker` in `src/app.ts` alongside existing workers
- [x] T047 [US7] Add activity push trigger hooks to existing campaign call completion handler: after processing a call completion event, check ChannelClientMapping → HubSpotConnection → if ACTIVE, enqueue `hubspot-activity-sync` BullMQ job with `eventType: "call"`, `eventSource: "campaign"`, contactEmail, and call details (duration, outcome, notes). If no active connection, skip silently (no error)
- [x] T048 [US7] Add activity push trigger hooks to existing Instantly/HeyReach webhook handlers (`src/routes/webhooks/instantly.ts`, `src/routes/webhooks/heyreach.ts`): after processing a delivery/activity event, look up the contact's client via campaign → check for active HubSpotConnection → if yes, enqueue `hubspot-activity-sync` job with `eventType: "email"`, `eventSource: "instantly"` or `"heyreach"`, contactEmail, and email subject/body preview. If no active connection, skip silently
- [x] T049 [US7] Add activity push trigger hooks to existing meeting booking/calendar webhook handler: after processing a meeting booking event, check ChannelClientMapping → HubSpotConnection → if ACTIVE, enqueue `hubspot-activity-sync` BullMQ job with `eventType: "meeting"`, `eventSource: "calendar"`, contactEmail, and meeting details (title, start/end time, attendees). If no active connection, skip silently. Per FR-031
- [x] T050 [US7] Add `sync` subcommand handler in `src/listeners/commands/hubspot.ts`: validate connection → call `hubspotActivity.retrySyncs(clientId)` to re-queue failed/pending activity events → post acknowledgment with count of queued items. Per contracts/activity.md

**Checkpoint**: User Story 7 complete — campaign activity automatically flows to HubSpot via existing webhook receivers

---

## Phase 10: User Story 8 — Receive HubSpot Webhook Notifications (Priority: P3)

**Goal**: Deal stage changes in HubSpot trigger Slack notifications when they involve contacts imported/enriched by our platform. Webhook subscriptions are app-level (configured once during Developer App setup per quickstart.md) — NOT per-client

**Independent Test**: Update a deal stage in HubSpot for an imported contact → verify notification appears in client's Slack channel within 30 seconds

**Depends on**: US1 (connection) + US2 (contact mappings for checking if contact was enriched by us)

### Implementation for User Story 8

- [x] T051 [P] [US8] Create `src/routes/webhooks/hubspot.ts` Express router (follows existing `webhooks/{provider}.ts` pattern) with `POST /api/webhooks/hubspot` endpoint: validate X-HubSpot-Signature header using HMAC-SHA256(client_secret + request_body) → respond 200 immediately → process events asynchronously. Per contracts/webhooks.md
- [x] T052 [P] [US8] Create `src/services/hubspot/hubspotWebhook.ts` implementing `HubSpotWebhookService`: `validateSignature()` checks HMAC-SHA256 hash, `processEvents()` iterates event batch → for each `deal.propertyChange` where `propertyName="dealstage"`: look up HubSpotConnection by `portalId` from event payload → if no active connection found (unknown portal or DISCONNECTED status), skip event and log → fetch deal details from HubSpot API (include contact associations) → check if associated contact exists in HubSpotContactMapping → if yes, resolve client's Slack channel via ChannelClientMapping → post notification with deal name, stage, amount, contact info, and HubSpot link. Create HubSpotSyncLog entry. Per contracts/webhooks.md
- [x] T053 [US8] Mount webhook router in `src/server.ts`: add `app.use('/api/webhooks/hubspot', hubspotWebhookRouter)` — no auth middleware, security via signature validation. Check for existing HubSpot webhook route at `src/routes/webhooks/hubspot.ts` and merge if needed
- [x] T054 [US8] Add `getWebhookStatus()` diagnostic method to `src/services/hubspot/hubspotWebhook.ts`: query HubSpot Webhooks API (`GET /webhooks/v3/{appId}/subscriptions`) to check if the app-level `deal.propertyChange` subscription exists and is active. Expose result in `/hubspot status` output (T032) as "Webhooks: Active" or "Webhooks: Not configured". Note: Webhook subscriptions are configured once at the HubSpot Developer App level per quickstart.md Section 1 Step 6 — NO per-client subscription registration on connect/disconnect

**Checkpoint**: User Story 8 complete — deal stage changes trigger Slack notifications for enriched contacts

---

## Phase 11: Polish & Cross-Cutting Concerns

**Purpose**: Error handling hardening, logging, and deployment preparation

- [x] T055 [P] Add structured audit logging for all HubSpot operations in `src/services/hubspot/hubspotOAuth.ts`, `src/services/hubspot/hubspotImport.ts`, `src/services/hubspot/hubspotActivity.ts`, and `src/services/hubspot/hubspotWebhook.ts` to satisfy SOC 2 audit trail requirements (Constitution V): log OAuth events with actor (userId, clientId) and outcome (connect success/fail, disconnect, token refresh, refresh failure), import events (start, progress, complete, fail) with job metadata, activity sync events, webhook processing events, and API call metadata (endpoint, status code, duration) using existing logger pattern. Each audit log entry must include timestamp, actor, action, resource, and outcome. Do NOT log token values or full request/response payloads
- [x] T056 [P] Add error handling for edge cases in `src/services/queue/workers/hubspotImportWorker.ts`: handle file download failure (fail import, post error), handle mid-import token expiry (auto-refresh + retry batch), handle partial batch failure (log failed contacts, continue), handle list creation failure after contacts upserted (post warning with upserted count but no list)
- [x] T057 [P] Add error handling for edge cases in `src/services/queue/workers/hubspotActivityWorker.ts`: handle contact-not-found (upsert first, then retry engagement), handle rate limits, handle token refresh, handle HubSpot unavailable (retry with backoff)
- [x] T058 [P] Add new env vars to deploy infrastructure: update `infra/cloudformation.yml` (or equivalent) to include `HUBSPOT_OAUTH_CLIENT_ID`, `HUBSPOT_OAUTH_CLIENT_SECRET`, `HUBSPOT_OAUTH_REDIRECT_URI` as ECS task definition environment variables sourced from CloudFormation parameters
- [x] T059 Verify end-to-end flow on deployed ECS environment per `specs/14-hubspot-integration/quickstart.md` verification steps: OAuth connect → import → activity query (with date range presets) → activity push → webhook notification → status → disconnect

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately
- **Foundational (Phase 2)**: Depends on Phase 1 — BLOCKS all user stories
- **US1 Connect (Phase 3)**: Depends on Phase 2 — first MVP story
- **US2 Import (Phase 4)**: Depends on Phase 2 + US1 (needs a connection to import)
- **US5 Manual Mapping (Phase 5)**: Depends on US2 (extends import flow)
- **US3 Status (Phase 6)**: Depends on Phase 2 only (independent of US2)
- **US4 Disconnect (Phase 7)**: Depends on Phase 2 only (independent of US2)
- **US6 Activity Pull (Phase 8)**: Depends on US1 + US2 (needs connection + contact mappings)
- **US7 Activity Push (Phase 9)**: Depends on US1 (needs connection; auto-upserts contacts if no mapping)
- **US8 Webhooks (Phase 10)**: Depends on US1 + US2 (needs connection + contact mappings)
- **Polish (Phase 11)**: Depends on all user stories complete

### User Story Dependencies

```
Phase 1: Setup
    │
Phase 2: Foundational
    │
    ├──> US1: Connect (P1) ──> US2: Import (P1) ──> US5: Manual Mapping (P2)
    │                │                │
    │                │                ├──> US6: Activity Pull (P2)
    │                │                │
    │                │                └──> US8: Webhooks (P3)
    │                │
    │                └──> US7: Activity Push (P2) [can parallel with US2]
    │
    ├──> US3: Status (P2)     [independent, can parallel with US2]
    │
    └──> US4: Disconnect (P3) [independent, can parallel with US2]
```

### Within Each User Story

- Config/models before services
- Services before command/action handlers
- Core flow before edge cases
- Queue setup before worker

### Parallel Opportunities

**Phase 2** (after Phase 1):
- T006 (OAuth service), T007 (queue setup), T008 (callback route) can all run in parallel

**Phase 4** (US2, after US1):
- T017 (property mapping service) and T018 (import service) can run in parallel — different files, no dependencies

**Phase 6 + 7** (after Phase 2):
- US3 (status) and US4 (disconnect) can run in parallel with US2/US5 — they only depend on foundational models, not on import logic

**Phase 8** (US6, after US2):
- T037 (activity service) and T039 (button action handlers) can run in parallel — T037 is the service, T039 is the action handler in a different file

**Phase 8 + 9 + 10** (after US2):
- US6 (activity pull) and US8 (webhooks) can run in parallel — different files
- US7 (activity push) can start after US1 — does not require US2 imports (auto-upserts contacts)
- T044 (push method) extends the same file as T037 (activity service) — run sequentially or coordinate

---

## Implementation Strategy

### MVP First (US1 + US2)

1. Complete Phase 1: Setup (T001-T003)
2. Complete Phase 2: Foundational (T004-T009)
3. Complete Phase 3: US1 Connect (T010-T016)
4. **VALIDATE**: Test OAuth flow end-to-end on ECS
5. Complete Phase 4: US2 Import (T017-T028)
6. **VALIDATE**: Test full import flow — `/hubspot import` + inline button
7. **MVP SHIPPABLE** — deploy and demo

### Full Integration Delivery

1. Setup + Foundational → Foundation ready
2. US1 Connect → Test independently → Deploy (OAuth works)
3. US2 Import → Test independently → Deploy (**MVP complete**)
4. US5 Manual Mapping → Extends import for non-standard files
5. US3 Status + US4 Disconnect → Connection lifecycle complete
6. US6 Activity Pull (with date range presets + batch Search API) + US7 Activity Push → Bidirectional activity sync
7. US8 Webhooks (app-level subscriptions, no per-client registration) → Real-time deal notifications
8. Polish → Production-ready

### Task Summary

| Phase | Story | Tasks | Parallel |
|-------|-------|-------|----------|
| Phase 1: Setup | — | 3 | 1 |
| Phase 2: Foundational | — | 6 | 3 |
| Phase 3: US1 Connect | P1 | 7 | 0 |
| Phase 4: US2 Import | P1 | 12 | 2 |
| Phase 5: US5 Manual Mapping | P2 | 3 | 0 |
| Phase 6: US3 Status | P2 | 2 | 0 |
| Phase 7: US4 Disconnect | P3 | 3 | 0 |
| Phase 8: US6 Activity Pull | P2 | 7 | 2 |
| Phase 9: US7 Activity Push | P2 | 7 | 2 |
| Phase 10: US8 Webhooks | P3 | 4 | 2 |
| Phase 11: Polish | — | 5 | 4 |
| **Total** | | **59** | **16** |
