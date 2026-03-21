# Feature Specification: HubSpot Integration — OAuth + Contact Import + Activity Sync + Webhooks

**Feature Branch**: `14-hubspot-integration`
**Created**: 2026-03-10
**Status**: Draft
**Input**: User description: "Full HubSpot integration: (1) Per-client OAuth connection via Slack, (2) Contact import & static list creation from enrichment output files, (3) Bidirectional activity sync (pull meetings/calls/emails, push campaign activity), (4) Webhook notifications for deal stage changes"

## Clarifications

### Session 2026-03-10

- Q: Should activity sync (meetings, calls, emails) be included in this feature or deferred? → A: Yes, in scope. Activity sync (pull + push) and webhook notifications are included. Full bidirectional HubSpot integration in a single feature.
- Q: Who is authorized to run `/hubspot connect`? → A: The client themselves (external users invited to the channel). Any user in the channel can initiate the OAuth flow to connect their own HubSpot account.
- Q: How should HubSpot import be triggered after enrichment? → A: Add an "Import to HubSpot" button (with a "Cancel" button) to the enrichment completion message when a HubSpot connection exists. `/hubspot import` also remains available for standalone use.
- Q: Should the system create custom HubSpot properties and support mapping to them? → A: Yes. Create custom properties in HubSpot for enrichment metadata (e.g., tech_spend_tier, enrichment_source). The column mapping dropdown must fetch ALL properties from the client's HubSpot (standard + custom) so users can map CSV columns to any property.
- Q: Should the OAuth callback route through the existing ALB or a separate endpoint? → A: Existing ALB — add `/api/hubspot/oauth/callback` route to the Express server.

### Session 2026-03-11

- Q: How should HubSpot OAuth token encryption be handled? → A: Reuse the existing encryption utility (same pattern as `instantlyApiKey` on ManagedClient) for consistency — no new crypto module.
- Q: How does the system receive campaign activity events (calls, emails, meetings) for activity push? → A: Existing per-client webhook receivers already capture all campaign events (Instantly, HeyReach, etc.) via API endpoints. HubSpot activity push subscribes to these existing event flows — no new webhook infrastructure needed.
- Q: How should HubSpot webhook subscriptions for deal stage changes be managed? → A: One-time app-level subscription setup (configured during HubSpot Developer App registration); incoming events are routed to the correct client by portal ID at runtime. No per-client subscription registration on connect/disconnect.
- Q: How should `/hubspot activity` determine the time range for activity data? → A: Show preset buttons: "Today", "Last 7 Days", "Custom" (custom opens a date range input). Generate a summary with counts (calls, emails, meetings), conversation notes, and other relevant engagement details.
- Q: How should the system query HubSpot for activity data across all synced contacts? → A: Batch query via HubSpot Search API filtering by associated contact IDs (avoids N+1 per-contact calls).

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Connect HubSpot Account via Slack (Priority: P1)

A client (external user invited to the Slack channel) types `/hubspot connect`. The bot responds with a button linking to HubSpot's OAuth authorization page. The client clicks the link, logs into their own HubSpot account, reviews the requested permissions (contacts read/write, lists read/write), and grants access. HubSpot redirects back to the application's callback URL. The bot posts a confirmation message in the Slack channel: "HubSpot connected for [Client Name]." From that point on, all HubSpot operations in that channel use the client's own HubSpot account. Any user in the channel can initiate the connection, since the client controls what permissions they grant in HubSpot.

**Why this priority**: Without a connected HubSpot account, no import or list operations are possible. This is the foundational prerequisite for all other functionality.

**Independent Test**: Can be fully tested by running `/hubspot connect` in a channel, completing the OAuth flow, and verifying the bot confirms the connection. Delivers value by establishing the secure link between a Slack channel and a client's HubSpot portal.

**Acceptance Scenarios**:

1. **Given** a Slack channel mapped to a client with no HubSpot connection, **When** a user types `/hubspot connect`, **Then** the bot responds with a message containing a "Connect HubSpot" button linking to HubSpot's OAuth authorization page.
2. **Given** the user clicks the OAuth link and grants permissions in HubSpot, **When** HubSpot redirects to the callback URL with an auth code, **Then** the system exchanges the code for access and refresh tokens, stores them securely for the client, and posts a success message in the Slack channel.
3. **Given** a channel already has an active HubSpot connection, **When** a user types `/hubspot connect`, **Then** the bot responds that HubSpot is already connected and shows the connected portal name.
4. **Given** a Slack channel with no client mapping (no ChannelClientMapping), **When** a user types `/hubspot connect`, **Then** the bot responds with an error explaining a client must be assigned to the channel first.

---

### User Story 2 - Import Contacts to HubSpot and Create a List (Priority: P1)

A user in a client's Slack channel types `/hubspot import`. The bot shows a dropdown of recent enrichment, filter, and split result files available in that channel. The user selects a file. A modal appears asking for the client name and campaign/target list name. The bot auto-detects which CSV columns map to HubSpot contact properties (Email, First Name, Last Name, etc.) and shows a preview. The user confirms or adjusts the mapping. The bot imports the contacts into the client's HubSpot account (creating new contacts or updating existing ones by email match), creates a static list named `LIST : MMDD [CLIENT] Campaign Name / Target List`, adds all imported contacts to that list, and posts a completion summary with counts and a link to the HubSpot list.

**Why this priority**: This is the core value proposition — automating the manual process of exporting enrichment data and importing it into HubSpot. Equal priority with Story 1 since both are required for the complete workflow.

**Independent Test**: Can be tested by connecting a HubSpot account (Story 1), running `/hubspot import`, selecting a recent enrichment file, entering naming details, confirming the column mapping, and verifying contacts and the list appear in HubSpot.

**Acceptance Scenarios**:

1. **Given** a channel with an active HubSpot connection and recent completed enrichment jobs, **When** a user types `/hubspot import`, **Then** the bot shows a list of recent files (enrichment, filter, split results) with an option to upload a new file.
2. **Given** the user selects a file, **When** the bot parses the file headers, **Then** it auto-detects common column names (Email, Contact First Name, Contact Last Name, Job Title, Company, Mobile Number, Business Phone, LinkedIn URL) and maps them to HubSpot properties.
3. **Given** auto-detection successfully maps all key fields (email, first name, last name), **When** the mapping preview is shown, **Then** the user sees "Confirm & Import", "Map Columns", and "Cancel" buttons.
4. **Given** auto-detection fails to map some columns, **When** the user clicks "Map Columns", **Then** a modal opens showing all CSV columns with a dropdown per column listing all HubSpot contact properties plus an "Ignore" option.
5. **Given** the user confirms the mapping and naming, **When** the import executes, **Then** contacts are upserted in HubSpot (matched by email), a static list is created with the name `LIST : MMDD [CLIENT] Campaign Name / Target List`, all imported contacts are added to the list, and a summary is posted showing created/updated/failed counts with a link to the list.
6. **Given** a channel with no active HubSpot connection, **When** a user types `/hubspot import`, **Then** the bot responds that HubSpot is not connected and prompts them to run `/hubspot connect` first.

---

### User Story 3 - Check HubSpot Connection Status (Priority: P2)

A user types `/hubspot status` to check whether their channel has an active HubSpot connection. The bot responds with the connection status, the connected HubSpot portal name/ID, and when the connection was established.

**Why this priority**: Useful for troubleshooting and transparency, but not required for the core import flow.

**Independent Test**: Can be tested by running `/hubspot status` in both connected and unconnected channels and verifying correct status reporting.

**Acceptance Scenarios**:

1. **Given** a channel with an active HubSpot connection, **When** a user types `/hubspot status`, **Then** the bot shows the connected portal name, portal ID, connection date, and a `:white_check_mark:` status indicator.
2. **Given** a channel with no HubSpot connection, **When** a user types `/hubspot status`, **Then** the bot shows "Not connected" and suggests running `/hubspot connect`.
3. **Given** a channel with an expired/revoked HubSpot connection, **When** a user types `/hubspot status`, **Then** the bot shows an error state and suggests reconnecting.

---

### User Story 4 - Disconnect HubSpot Account (Priority: P3)

A user types `/hubspot disconnect` to remove the HubSpot connection for their channel's client. The bot confirms the action (with a confirmation button to prevent accidental disconnection) and deletes the stored credentials.

**Why this priority**: Administrative capability needed for cleanup and security, but used infrequently.

**Independent Test**: Can be tested by connecting a HubSpot account, then disconnecting it, and verifying the connection is removed and stored credentials are deleted.

**Acceptance Scenarios**:

1. **Given** a channel with an active HubSpot connection, **When** a user types `/hubspot disconnect`, **Then** the bot shows a confirmation prompt with "Disconnect" and "Cancel" buttons.
2. **Given** the user confirms disconnection, **When** the system processes the request, **Then** stored credentials (encrypted tokens) are deleted from the system and a confirmation message is posted.
3. **Given** a channel with no HubSpot connection, **When** a user types `/hubspot disconnect`, **Then** the bot responds that no connection exists.

---

### User Story 5 - Manual Column Mapping for Non-Standard Files (Priority: P2)

A user imports a CSV file with non-standard column names that the auto-detection cannot map. The user clicks "Map Columns" and sees a modal with every CSV column header listed alongside a dropdown of all available HubSpot contact properties (fetched from the connected HubSpot account). The user manually maps each relevant column and ignores the rest. The import proceeds with the custom mapping.

**Why this priority**: Essential for handling files that don't follow the standard enrichment output format, but most users will rely on auto-detection.

**Independent Test**: Can be tested by uploading a CSV with custom column names (e.g., "Person Email", "Full Name"), clicking "Map Columns", mapping them to HubSpot properties, and verifying the import uses the custom mapping.

**Acceptance Scenarios**:

1. **Given** a file with non-standard column names, **When** the user clicks "Map Columns", **Then** a modal displays all CSV columns with a dropdown of HubSpot contact properties fetched from the connected portal.
2. **Given** the mapping modal is open, **When** the user maps columns and submits, **Then** only mapped columns are included in the import and unmapped columns are ignored.
3. **Given** the user maps no columns to "email", **When** they submit the mapping, **Then** the system shows a validation error requiring at least an email mapping (since HubSpot upsert requires email as the unique identifier).

---

### User Story 6 - Pull Activity Data from HubSpot (Priority: P2)

A user types `/hubspot activity` (optionally with an email: `/hubspot activity user@example.com`). The bot responds with preset date range buttons: "Today", "Last 7 Days", and "Custom" (which opens a date range input). After selecting a range, the bot queries the client's HubSpot for engagement activity — meetings booked, calls made, emails sent — within that period. It generates a summary with counts (total calls, emails, meetings), conversation notes, and other relevant engagement details. If an email is provided, results are scoped to that contact; otherwise, results cover all contacts synced by our platform for that client. The bot displays the results in a formatted Slack Block Kit message.

**Why this priority**: Activity visibility closes the feedback loop — users can see if enriched contacts are being engaged in HubSpot. The import flow (Stories 1+2) delivers standalone value, so pulling activity is P2.

**Independent Test**: Can be tested by creating a meeting and a call in HubSpot for a known contact, then running `/hubspot activity user@example.com` and verifying the activities appear in the Slack response.

**Acceptance Scenarios**:

1. **Given** a client has a connected HubSpot, **When** a user types `/hubspot activity`, **Then** the bot responds with preset buttons: "Today", "Last 7 Days", "Custom" (custom opens a date range input). Optionally accepts an email parameter to scope results.
2. **Given** a date range is provided, **When** the bot queries HubSpot, **Then** it returns a summary showing: total calls, total emails, total meetings, conversation notes, and other relevant engagement details — formatted as a Slack Block Kit message.
3. **Given** a user provides an email (`/hubspot activity user@example.com`), **When** the bot queries HubSpot, **Then** results are scoped to that specific contact within the requested date range.
4. **Given** no email is provided, **When** the query runs, **Then** results cover all contacts synced by our platform for that client within the date range.
5. **Given** no activity exists for the specified date range/contact, **When** the query returns empty, **Then** the bot responds with "No activity found for the specified date range."
6. **Given** the client's HubSpot is not connected, **When** a user types `/hubspot activity`, **Then** the bot responds that HubSpot is not connected and prompts them to run `/hubspot connect`.

---

### User Story 7 - Push Activity to HubSpot (Priority: P2)

When campaign contacts receive activity through the platform — a call is completed in a campaign, an email is sent via Instantly or HeyReach, or a meeting is booked — the system automatically creates the corresponding engagement record in the client's HubSpot (a call log, email log, or meeting record) associated with the correct contact. This keeps HubSpot as the single source of truth for all outreach activity, eliminating manual data entry.

**Why this priority**: Bidirectional sync completes the integration story. Logging activity back to HubSpot keeps CRM records current. However, the import flow (Stories 1+2) delivers standalone value first.

**Independent Test**: Can be tested by completing a call activity for a campaign contact whose client has HubSpot connected, then checking HubSpot to verify the call engagement was created with correct properties and contact association.

**Acceptance Scenarios**:

1. **Given** a campaign contact receives a call marked as completed, **When** the client has HubSpot connected, **Then** the system creates a call engagement in HubSpot associated with the contact, including call duration, outcome, and notes.
2. **Given** an email is sent to a contact via Instantly or HeyReach, **When** a webhook confirms delivery, **Then** the system creates an email engagement in HubSpot with subject, body preview, and timestamp.
3. **Given** a meeting is booked for a contact, **When** the booking is confirmed, **Then** the system creates a meeting engagement in HubSpot with title, start/end time, and attendees.
4. **Given** the same activity has already been logged to HubSpot, **When** a duplicate event arrives, **Then** the system skips the duplicate using idempotency tracking (stored engagement IDs).
5. **Given** the client's HubSpot is not connected, **When** a campaign activity completes, **Then** the system skips the HubSpot sync gracefully (no error, no retry — the activity is simply not synced).

---

### User Story 8 - Receive HubSpot Webhook Notifications (Priority: P3)

The system subscribes to HubSpot webhook events for connected clients — specifically deal stage changes. When a relevant event occurs (e.g., a deal moves to "Closed Won" for a contact that was enriched/imported by our platform), the system posts a notification in the client's Slack channel. This provides real-time visibility into pipeline movement for enriched contacts.

**Why this priority**: Webhooks provide real-time visibility but require additional infrastructure (public webhook endpoint, signature validation). App-level subscriptions are configured once — not per-client. The polling approach in Story 6 covers on-demand activity queries; webhooks add a real-time layer.

**Independent Test**: Can be tested by updating a deal stage in HubSpot for an imported contact and verifying the notification appears in the client's Slack channel within 30 seconds.

**Acceptance Scenarios**:

1. **Given** a HubSpot Developer App is configured, **When** webhook subscriptions are set up (one-time app-level setup), **Then** `deal.propertyChange` (dealstage) events are delivered to `/api/webhooks/hubspot` for all connected portals.
2. **Given** a deal moves to "Closed Won" in HubSpot, **When** the webhook fires, **Then** the system checks if the associated contact was imported/enriched by our platform, and if so, posts a notification in the client's Slack channel with deal name, stage, and contact info.
3. **Given** a webhook arrives, **When** the system validates the X-HubSpot-Signature header, **Then** invalid signatures are rejected with 401.
4. **Given** a client disconnects HubSpot, **When** the disconnect flow runs, **Then** the system deletes local credentials only. Webhook subscriptions remain at the app level (events for disconnected portals are ignored by portal ID lookup).

---

### Edge Cases

- What happens when the HubSpot OAuth token expires mid-import? System should auto-refresh using the refresh token and retry the failed batch.
- What happens when the CSV has duplicate email addresses? HubSpot upsert handles deduplication by email — last row wins for property values.
- What happens when the HubSpot API rate limit is hit during a large import? System should respect 429 responses with exponential backoff (existing circuit breaker pattern).
- What happens when a contact import partially fails (some contacts succeed, some fail)? System should report per-contact success/failure counts and not roll back successful contacts.
- What happens when someone tries `/hubspot connect` but the channel has no client mapping? System should show an error directing them to set up the channel-client mapping first.
- What happens when a HubSpot list with the same name already exists? System should create the list with the given name (HubSpot allows duplicate list names) and note the list ID in the summary.
- What happens when the file has more than 5,000 contacts? System should warn the user about large imports and proceed with batched processing, showing progress updates.
- What happens when the OAuth callback URL receives an invalid or expired auth code? System should show a friendly error in Slack and prompt the user to try `/hubspot connect` again.
- What happens when a contact in HubSpot has no engagement activity? `/hubspot activity` should respond with "No recent activity found" rather than an error.
- What happens when a campaign activity fires but the contact doesn't exist in HubSpot yet? System should create the contact first (upsert by email), then attach the engagement.
- What happens when duplicate campaign activity events arrive (e.g., webhook retries from Instantly)? System tracks engagement IDs to prevent duplicate logging (idempotency).
- What happens when HubSpot's webhook endpoint receives events for unrecognized portals? System should ignore events from portals without active connections and respond 200 (to prevent HubSpot retries).
- What happens when the HubSpot webhook subscription is misconfigured at the app level? This is an ops issue resolved during initial app setup — not a per-client concern. The system logs unroutable events and responds 200 to prevent HubSpot retries.

## Requirements _(mandatory)_

### Functional Requirements

**OAuth Connection:**

- **FR-001**: System MUST provide a `/hubspot` slash command with subcommands: `connect`, `disconnect`, `status`, `import`, `activity`, `sync`, and `help`.
- **FR-002**: System MUST generate a HubSpot OAuth authorization URL with scopes for contacts (read/write), lists (read/write), contact schemas/properties (read/write), deals (read), and engagements (read/write) when a user runs `/hubspot connect`. Use `optional_scope` for non-critical scopes (deals, engagements) so connections succeed even if the client's HubSpot plan doesn't support them.
- **FR-003**: System MUST provide a public callback endpoint at `/api/hubspot/oauth/callback` (routed via the existing ALB) to receive the OAuth authorization code from HubSpot after user approval.
- **FR-004**: System MUST exchange the authorization code for access and refresh tokens and store them encrypted, associated with the client (via ChannelClientMapping).
- **FR-005**: System MUST automatically refresh expired access tokens using the stored refresh token before making HubSpot API calls.
- **FR-006**: System MUST delete stored credentials (encrypted tokens) when a user runs `/hubspot disconnect`. Note: HubSpot does not provide a token revocation endpoint; disconnection deletes local credentials only.
- **FR-007**: System MUST show the current connection status (connected/disconnected, portal name, connection date) when a user runs `/hubspot status`.
- **FR-008**: System MUST require a valid ChannelClientMapping before allowing `/hubspot connect` — the channel must be associated with a client.
- **FR-009**: System MUST isolate each client's HubSpot credentials — one client's tokens MUST NOT be accessible to another client's channels.

**Contact Import & List Creation:**

- **FR-010**: System MUST show recent enrichment, filter, and split result files in the channel when a user runs `/hubspot import`, with an option to upload a new file.
- **FR-011**: System MUST collect a client name and campaign/target list name via a Slack modal before importing.
- **FR-012**: System MUST auto-detect CSV column to HubSpot property mappings for standard enrichment output columns (Email, Contact First Name, Contact Last Name, Job Title, Company Name, Mobile Number, Business Phone, LinkedIn URL, Contact City, Contact State, Contact Country).
- **FR-013**: System MUST provide a "Map Columns" button that opens a modal showing all CSV columns with dropdowns of ALL HubSpot contact properties (standard + custom) fetched from the connected portal via the Properties API, plus an "Ignore" option per column.
- **FR-014**: System MUST require at minimum an email column mapping before allowing an import to proceed.
- **FR-015**: System MUST upsert contacts in HubSpot using email as the unique identifier (creating new contacts or updating existing ones).
- **FR-016**: System MUST create a HubSpot static (manual) list with the name format: `LIST : MMDD [CLIENT] Campaign Name / Target List`.
- **FR-017**: System MUST add all successfully imported contacts to the created static list.
- **FR-018**: System MUST process imports in batches to respect HubSpot API rate limits.
- **FR-019**: System MUST post a completion summary in the Slack thread showing: import name, list name, contacts created, contacts updated, contacts failed, and a link to the HubSpot list.
- **FR-020**: System MUST show progress updates during large imports.
- **FR-021**: System MUST block `/hubspot import` if no active HubSpot connection exists for the channel and prompt the user to connect first.
- **FR-022**: System MUST add an "Import to HubSpot" button and a "Cancel" button to the enrichment job completion message when the channel's client has an active HubSpot connection. Clicking "Import to HubSpot" initiates the same import flow as `/hubspot import` using the just-completed enrichment file. The button MUST NOT appear when no active connection exists.
- **FR-024**: System MUST create custom HubSpot contact properties on first connection (or first import) for enrichment metadata: `enrichment_source`, `enrichment_date`, `tech_spend_tier`, `enrichment_job_id`. Properties are created in a custom property group named "Enrichment Data".
- **FR-025**: System MUST fetch the full list of contact properties (standard + custom) from the client's HubSpot via the Properties API when rendering the column mapping modal, ensuring users can map to any property including client-created custom fields.

**Activity Sync (Pull):**

- **FR-026**: System MUST show preset date range buttons ("Today", "Last 7 Days", "Custom") when a user runs `/hubspot activity`. "Custom" opens a date range input. Optionally accepts an email to scope results to a specific contact.
- **FR-027**: System MUST generate an activity summary for the specified date range including: total calls, total emails, total meetings, conversation notes, and other relevant engagement details. When no email is provided, results cover all contacts synced by our platform for that client. Activity data MUST be fetched via HubSpot's Search API in batch (filtering by associated contact IDs) — not per-contact API calls.
- **FR-028**: System MUST display activity summaries in formatted Slack Block Kit messages with counts, conversation notes, and engagement details.

**Activity Sync (Push):**

- **FR-029**: System MUST push call completion events to HubSpot as call engagements when campaign contacts receive calls, including call duration, outcome, and notes.
- **FR-030**: System MUST push email delivery events to HubSpot as email engagements when emails are sent via Instantly or HeyReach, including subject, body preview, and timestamp.
- **FR-031**: System MUST push meeting bookings to HubSpot as meeting engagements, including title, start/end time, and attendees. Meeting bookings are captured via existing campaign calendar/scheduling webhook receivers (same event flow as call completions and email sends).
- **FR-032**: System MUST track synced engagement IDs to prevent duplicate activity logging (idempotency). If a duplicate event arrives, the system skips it.
- **FR-033**: System MUST upsert the contact in HubSpot (by email) before creating an engagement if the contact doesn't already exist in HubSpot.
- **FR-034**: System MUST queue activity push operations as BullMQ jobs (`hubspot-activity-sync`) so campaign workflows are not blocked by HubSpot API latency or failures.
- **FR-035**: System MUST support manual re-sync via `/hubspot sync` for cases where automatic activity sync failed or was skipped.

**Webhook Notifications:**

- **FR-036**: System MUST receive HubSpot webhook events at `/api/webhooks/hubspot` (via the existing ALB).
- **FR-037**: System MUST validate webhook signatures using the X-HubSpot-Signature header and the app's client secret.
- **FR-038**: System MUST process deal stage change events and notify the client's Slack channel when an enriched/imported contact's deal reaches key stages (e.g., "Closed Won").
- **FR-039**: System MUST handle webhook batches (up to 100 events) and respond within 5 seconds.
- **FR-040**: Webhook subscriptions for `deal.propertyChange` events are configured once at the HubSpot Developer App level (not per-client). The system routes incoming events to the correct client by portal ID. No subscription registration or deactivation occurs on connect/disconnect.

**Error Handling & Resilience:**

- **FR-041**: System MUST retry failed HubSpot API calls (activity sync, webhooks) with exponential backoff (max 3 retries).
- **FR-042**: System MUST gracefully degrade when HubSpot is unavailable — campaign workflows complete normally; only the HubSpot sync is deferred.
- **FR-043**: System MUST track sync history per client: total contacts synced, total activities logged, last sync time, and failure count.

### Key Entities

- **HubSpotConnection**: Represents a client's OAuth connection to HubSpot. Links to ManagedClient. Contains encrypted access token, encrypted refresh token, token expiry timestamp, HubSpot portal ID, portal name, connection status, connection date, last sync timestamp, and sync statistics.
- **HubSpotImportJob**: Tracks each import operation. Contains the source file reference, client name, campaign name, import name, list name, HubSpot list ID, contact counts (created, updated, failed, total), column mapping used, status, and timestamps. Links to the Slack channel and thread.
- **HubSpotContactMapping**: Links internal contacts (by email) to HubSpot contact IDs and company IDs. Enables activity association and reverse lookups. Stores email, HubSpot contact ID, HubSpot company ID, client ID, and last synced timestamp.
- **HubSpotEngagementMapping**: Links internal activity events (call completions, email sends, meeting bookings) to HubSpot engagement IDs. Prevents duplicate activity logging (idempotency). Stores internal event type + ID, HubSpot engagement ID, engagement type, and created timestamp.
- **HubSpotSyncLog**: Record of each sync operation (contact push, activity push, activity pull). Stores sync type, client ID, records processed/created/updated/failed, duration, error details, and timestamp. Used for sync history and debugging.

### Assumptions

- A HubSpot Developer App will be registered with the required OAuth scopes before this feature is deployed. The app's client ID and client secret will be stored as environment variables.
- The OAuth callback endpoint and webhook endpoint will be routed through the existing ALB that serves the admin dashboard API routes.
- Token encryption at rest will reuse the existing encryption utility (same pattern as `instantlyApiKey` on ManagedClient) with AES-256 and key stored in environment variables. No new crypto module — single encryption pattern across the codebase.
- The global `HUBSPOT_API_KEY` currently in config will remain as a fallback for existing campaign contact import functionality and will be phased out in a future migration once all clients have OAuth connections.
- HubSpot's list names do not need to be unique — the system will create lists with the specified name even if a list with the same name already exists.
- HubSpot's `optional_scope` parameter handles cases where a client's HubSpot plan doesn't support engagement or deal scopes — the connection succeeds with reduced capabilities.
- HubSpot webhook subscriptions are configured at the app level — all connected clients share the same webhook endpoint, and events are routed to the correct client by portal ID.
- Existing per-client webhook receivers already capture all campaign activity events (Instantly, HeyReach, etc.) via API endpoints. The HubSpot activity push feature hooks into these existing event flows — no new webhook infrastructure is required.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: Users can connect their HubSpot account via Slack in under 2 minutes (from typing `/hubspot connect` to seeing the confirmation message).
- **SC-002**: Contact imports of up to 5,000 rows complete within 5 minutes, with progress updates visible in the Slack thread.
- **SC-003**: Auto-detection correctly maps standard enrichment output columns without manual intervention for 90% or more of imports.
- **SC-004**: 100% of imported contacts are findable in HubSpot by email after a successful import.
- **SC-005**: The created HubSpot list contains all successfully imported contacts and follows the naming convention `LIST : MMDD [CLIENT] Campaign Name / Target List`.
- **SC-006**: Each client's HubSpot connection is fully isolated — no cross-client data access is possible.
- **SC-007**: Expired tokens are automatically refreshed without requiring the user to reconnect, achieving 99%+ uptime for established connections.
- **SC-008**: Failed individual contacts in a batch do not block the rest of the import — partial success is reported with clear counts.
- **SC-009**: Activity queries via `/hubspot activity` return results within 5 seconds after date range selection.
- **SC-010**: Webhook notifications for deal stage changes appear in Slack within 30 seconds of the HubSpot event.
- **SC-011**: Campaign activity (calls, emails, meetings) is pushed to HubSpot within 2 minutes of completion, without blocking the campaign workflow.
- **SC-012**: Duplicate activity events are not logged — idempotency tracking achieves 100% deduplication.

## Scope Boundaries

### In Scope

- **OAuth Flow**: Full OAuth 2.0 authorization code flow via `/hubspot connect`
- **Token Management**: Encrypted storage, automatic refresh, disconnect/revoke
- **Contact Import**: Manual import of enrichment/filter/split result files via `/hubspot import`
- **Column Mapping**: Auto-detection + manual mapping of CSV columns to HubSpot properties
- **List Creation**: Static list creation with `LIST : MMDD [CLIENT] Campaign Name / Target List` naming
- **Activity Pull**: Query HubSpot for meetings, calls, emails via `/hubspot activity`
- **Activity Push**: Auto-log call completions, email sends, meeting bookings from campaigns to HubSpot
- **Webhook Notifications**: Receive deal stage change events and notify Slack channels
- **Connection Management**: Status check, disconnect, sync, help subcommands
- **Custom Properties**: Create enrichment-specific properties in the client's HubSpot
- **Sync History**: Track and display sync statistics per client
- **Error Handling**: Token refresh, rate limiting, partial failure, graceful degradation

### Out of Scope

- **Fully automatic contact sync on enrichment completion**: Contact import requires user confirmation via button click (not zero-touch auto-sync)
- **Custom field mapping UI in admin dashboard**: Column mapping is in-Slack only
- **HubSpot deal creation** from enrichment data
- **Multi-portal support**: One HubSpot portal per client
- **Bidirectional contact sync**: No pulling HubSpot contacts into our platform
- **HubSpot Marketplace listing**: Operational, not engineering
- **HubSpot ticket, task, or note sync**
- **Real-time contact sync (streaming)**: Batch sync only
- **HubSpot form submission tracking**
