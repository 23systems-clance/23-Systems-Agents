# Feature Specification: Power Dialer

**Feature Branch**: `22-power-dialer`
**Created**: 2026-03-12
**Status**: Draft
**Input**: User description: "Browser-based power dialer with Twilio telephony, voicemail detection, call transcription, 60-second connected call timer, disposition tracking, and CRM sync (HubSpot). Built into the admin dashboard as a dialer widget for BDRs."

## User Scenarios & Testing _(mandatory)_

### User Story 1 - BDR Power Dials a Call List (Priority: P1)

A BDR opens the admin dashboard, navigates to their assigned call list (populated from campaign phone steps or manual queue), and clicks "Start Dialing." The system automatically dials the first number using Twilio via WebRTC in the browser. The BDR hears the call ringing through their headset. If someone picks up, a configurable connected-call timer starts (default 45 seconds) to confirm it's a connected call (not a brief voicemail greeting). After the call ends, a disposition modal appears and the BDR selects the outcome (Connected, Voicemail, No Answer, Wrong Number, etc.). The system auto-advances to the next number in the queue.

**Why this priority**: This is the core value proposition — automated sequential dialing with minimal BDR friction. Without this, there is no power dialer.

**Independent Test**: Can be fully tested by loading a call list with 5 test numbers, starting the dialer, completing calls, and verifying auto-advance behavior. Delivers immediate productivity gain for BDRs.

**Acceptance Scenarios**:

1. **Given** a BDR has an assigned call list with 10 contacts, **When** they click "Start Dialing", **Then** the system dials the first number via WebRTC and the BDR hears ringing through their browser.
2. **Given** a call is ringing, **When** a human answers, **Then** a configurable connected-call timer starts (default 45s) and the call is marked as "connected" after the timer elapses.
3. **Given** a call ends (either party hangs up), **When** the call was connected, **Then** a disposition modal appears with outcome options.
4. **Given** the BDR submits a disposition, **When** there are remaining contacts in the queue, **Then** the system automatically dials the next number within 3 seconds.
5. **Given** a BDR is on an active call, **When** they click "End Call", **Then** the call is terminated and the disposition modal appears.

---

### User Story 2 - Automatic Voicemail Detection and Skip (Priority: P1)

When the system dials a number and reaches voicemail (detected via Twilio's Answering Machine Detection), it automatically hangs up and advances to the next number in the queue. The skipped contact is logged with a "Voicemail - Auto Skipped" disposition. No BDR interaction is required for voicemail calls.

**Why this priority**: Voicemail detection is essential to the power dialer value prop. Without it, BDRs waste time listening to voicemail greetings, which defeats the purpose of auto-dialing.

**Independent Test**: Can be tested by dialing numbers known to go to voicemail and verifying the system auto-hangs up within 5 seconds of AMD detection and advances to the next contact.

**Acceptance Scenarios**:

1. **Given** the system dials a number, **When** Twilio AMD detects an answering machine, **Then** the call is automatically terminated within 2 seconds.
2. **Given** a voicemail is detected and the call is terminated, **When** the queue has remaining contacts, **Then** the system auto-dials the next number.
3. **Given** a voicemail is auto-skipped, **When** the call session is logged, **Then** the disposition is recorded as "Voicemail - Auto Skipped" with no BDR action required.

---

### User Story 3 - Call Recording and Transcription (Priority: P2)

All connected calls (where a human answered and the connected-call timer was met) are recorded via Twilio. After the call ends, the recording is sent to a transcription service (Deepgram or AssemblyAI). The transcript is stored in the database and attached to the call record. The BDR and managers can view the transcript in the admin dashboard.

**Why this priority**: Recording and transcription provide coaching value and compliance documentation. Important but not blocking for the core dialing workflow.

**Independent Test**: Can be tested by making a connected call, verifying the recording is captured, and confirming the transcript appears in the call detail view within 5 minutes of call completion.

**Acceptance Scenarios**:

1. **Given** a call is connected (human answered, connected-call timer met), **When** recording is enabled, **Then** Twilio records the call and stores the recording URL.
2. **Given** a call recording is complete, **When** the recording webhook fires, **Then** the system sends the recording to the transcription service.
3. **Given** transcription is complete, **When** the transcript is returned, **Then** it is stored in the database and visible in the call detail view.
4. **Given** a call was auto-skipped (voicemail), **When** checking call records, **Then** no recording or transcript exists for that call.

---

### User Story 4 - Call Listening / Manager Monitoring (Priority: P2)

A manager can view active calls in the admin dashboard and join any call in listen-only mode (coach mode). The BDR and the contact cannot hear the manager. The manager can optionally "barge in" to join the conversation if needed.

**Why this priority**: Call monitoring is a key coaching tool for BDR managers. Important for quality assurance but not required for the BDR's individual dialing workflow.

**Independent Test**: Can be tested by having one user dial a number and a second user (manager) join the call in listen-only mode, verifying audio is one-way.

**Acceptance Scenarios**:

1. **Given** a BDR is on an active call, **When** a manager clicks "Listen" on the active calls dashboard, **Then** the manager hears the call audio without being heard by either party.
2. **Given** a manager is listening to a call, **When** they click "Barge In", **Then** both the BDR and contact can hear the manager.
3. **Given** a manager is monitoring, **When** the call ends, **Then** the manager's session is automatically terminated.

---

### User Story 5 - Disposition Sync to HubSpot (Priority: P1)

After a BDR dispositions a call, the system syncs the call activity to HubSpot via the existing HubSpot integration. The disposition maps to HubSpot's call outcome field. The call duration, recording URL, transcript, and notes are attached to the HubSpot engagement. The contact's timeline in HubSpot reflects the call activity.

**Why this priority**: CRM sync is essential — without it, call data lives only in this platform and BDR managers lose visibility in their primary CRM.

**Independent Test**: Can be tested by making a call, dispositioning it, and verifying the corresponding HubSpot engagement appears on the contact's timeline with correct disposition, duration, and notes.

**Acceptance Scenarios**:

1. **Given** a BDR dispositions a call as "Connected - Interested", **When** the client has a HubSpot connection, **Then** a call engagement is created in HubSpot with outcome "Connected" and notes containing the disposition detail.
2. **Given** a call has a recording and transcript, **When** syncing to HubSpot, **Then** the recording URL is attached to the engagement and the transcript is included in the notes.
3. **Given** the HubSpot API returns an error during sync, **When** the sync fails, **Then** the system retries up to 3 times with exponential backoff and logs the failure.
4. **Given** a call was auto-skipped (voicemail), **When** the skip is synced to HubSpot, **Then** a call engagement is created with outcome "No Answer" and type "Voicemail".

---

### User Story 6 - Dialer Queue Management (Priority: P2)

A BDR can view their call queue, skip contacts, pause the auto-dialer, resume dialing, and reorder the queue. Managers can assign call lists to BDRs from campaigns or manual uploads. The queue persists across browser sessions.

**Why this priority**: Queue management provides control and flexibility but the core auto-dial flow works without manual queue manipulation.

**Independent Test**: Can be tested by loading a queue, skipping 2 contacts, pausing, closing the browser, reopening, and verifying the queue state is preserved.

**Acceptance Scenarios**:

1. **Given** a BDR has a call queue, **When** they click "Skip" on a contact, **Then** the contact is moved to the end of the queue and the next contact is dialed.
2. **Given** a BDR clicks "Pause", **When** the current call ends, **Then** the system does not auto-dial the next number.
3. **Given** a BDR closes the browser with 5 remaining contacts, **When** they reopen the dashboard, **Then** the queue shows the same 5 contacts in the same order.
4. **Given** a manager assigns a campaign call list to a BDR, **When** the BDR opens the dialer, **Then** the assigned contacts appear in their queue.

---

### User Story 7 - Call Recording Library & Manager Review (Priority: P2)

Managers can access a searchable Call Recording Library in the admin dashboard that displays all recorded calls across their BDRs. The library supports filtering by BDR, campaign, date range, disposition, and call duration. Managers can star/favorite exemplary calls for training purposes, flag calls for coaching review, and add coaching notes to any recording. BDRs can browse their own recordings to self-review. Starred calls appear in a "Favorites" collection that can be shared with the team for onboarding and training.

**Why this priority**: The recording library is what makes call recordings actionable — without it, recordings pile up unsearched. Critical for coaching culture but not blocking the core dialing workflow.

**Independent Test**: Can be tested by making 10 calls with varying dispositions, then navigating to the library, filtering by disposition and BDR, starring 2 calls, adding coaching notes to 1, and verifying all data persists.

**Acceptance Scenarios**:

1. **Given** a manager opens the Call Recording Library, **When** they filter by BDR "John" and disposition "Connected - Interested", **Then** only John's connected-interested calls are shown with recording playback, transcript, duration, and date.
2. **Given** a manager clicks the star icon on a recording, **When** they navigate to the "Favorites" tab, **Then** the starred call appears in the favorites collection.
3. **Given** a manager opens a call detail, **When** they add a coaching note ("Great objection handling at 2:15"), **Then** the note is saved and visible to the BDR and other managers.
4. **Given** a manager flags a call for review, **When** the BDR opens their recordings, **Then** the flagged call shows a "Manager Review" badge with the coaching notes.
5. **Given** a BDR opens the library, **When** they browse recordings, **Then** they only see their own calls (not other BDRs' recordings).

---

### User Story 8 - Scheduled Callbacks & Missed Call Tracking (Priority: P2)

A BDR is on a call and the contact says "call me back Thursday at 2 PM." The BDR dispositions the call as "Connected - Callback Requested" and schedules a callback with date/time. The system adds the callback to the BDR's queue and surfaces a reminder notification at the scheduled time. When a callback comes due, a toast notification appears in the dialer ("Callback due: John Smith - Call back") and the contact is auto-inserted at the top of the active queue. Managers can see callback metrics (scheduled, completed, missed, callback-to-connect rate) in analytics. If a BDR misses an inbound call from a known contact, a missed call notification appears with a one-click "Call back" action.

**Why this priority**: Callbacks are a core sales workflow — prospects who request callbacks convert at higher rates. Tracking callback metrics separately from cold dials gives managers visibility into follow-up discipline.

**Independent Test**: Schedule 3 callbacks at different times, verify reminders fire, complete 2 callbacks, let 1 expire, and confirm analytics show 2 completed / 1 missed.

**Acceptance Scenarios**:

1. **Given** a BDR dispositions a call as "Callback Requested", **When** they set a callback date/time, **Then** the system creates a scheduled callback record linked to the contact and BDR.
2. **Given** a callback is scheduled for 2:00 PM, **When** the time arrives, **Then** a toast notification appears in the dialer widget with the contact name and "Call back" button.
3. **Given** a callback reminder fires, **When** the BDR clicks "Call back", **Then** the contact is dialed immediately (inserted at top of queue, bypassing current position).
4. **Given** a callback was scheduled but not completed within 30 minutes of the scheduled time, **When** the window expires, **Then** the callback is marked as "Missed" and remains in the queue with a "Missed Callback" badge.
5. **Given** an inbound call is received from a known contact's number, **When** the BDR is on another call or unavailable, **Then** a missed call notification appears with the contact name and a "Call back" action.
6. **Given** a manager views analytics, **When** they check the Callbacks KPI, **Then** they see total scheduled callbacks, completed callbacks, missed callbacks, and callback-to-connect rate.

---

### User Story 9 - Dialer Analytics Dashboard (Priority: P2)

A manager opens the Dialer Analytics page in the admin dashboard and sees a comprehensive performance overview with 5 tabs: Rep Performance, List Performance, Account Performance, Objections, and When to Call. The default view shows Rep Performance with KPI summary cards (Dials, Callbacks, Connects, Conversations, Meetings) and conversion funnel rates (Dial to connect %, Callback to connect %, Connect to conversation %, Conversation to meeting %). Below the KPIs is a detailed rep performance table with per-BDR metrics including dial counts, conversion rates, callbacks, and time tracking (dial time, talk time, pause time, session time). The List Performance tab shows the same metrics broken down by call list/campaign, with an additional disposition breakdown per list. All views support date range filtering, a "Save View" feature, and a "View Call History" link to the full call log.

**Why this priority**: Analytics close the feedback loop — without visibility into rep performance, list effectiveness, and conversion funnels, managers cannot coach effectively or optimize campaigns.

**Independent Test**: After 50+ calls across 2 BDRs and 3 lists, verify all KPI cards compute correctly, rep table rows match individual BDR totals, list performance rows match list-level totals, and date filtering narrows results accurately.

**Acceptance Scenarios**:

1. **Given** a manager opens Dialer Analytics, **When** the page loads, **Then** the Rep Performance tab is shown by default with KPI summary cards for Dials, Callbacks, Connects, Conversations, and Meetings.
2. **Given** the Rep Performance tab is active, **When** viewing conversion rate cards, **Then** the system shows Dial to connect %, Callback to connect %, Bridged to connect %, Connect to conversation %, and Conversation to meeting %.
3. **Given** the Rep Performance tab is active, **When** viewing the rep table, **Then** each row shows: Rep name, Dials, Dial to connect %, Bridged to connect %, Outbound connects, Connect to conversation %, Conversations, Conversation to meeting %, Meetings, Callbacks, Callback to connect %, Callback connects, Dial time, Talk time, Pause time, Session time.
4. **Given** the manager clicks the "List Performance" tab, **When** the tab loads, **Then** a table shows: List name, Dials, Dial to connect %, Bridged to connect %, Outbound connects, Connect to conversation %, Conversations, Conversation to meeting %, Meetings, Callbacks, Callback to connect %, Callback connects, Dial time, Talk time — one row per list/campaign.
5. **Given** the manager is on the List Performance tab, **When** they expand a list row, **Then** a disposition breakdown shows call counts per disposition type (Connected - Interested, Connected - Not Interested, Voicemail, No Answer, Wrong Number, etc.) for that list.
6. **Given** the manager selects a date range filter (e.g., "This month"), **When** the filter is applied, **Then** all KPI cards, tables, and charts update to reflect only calls within that date range.
7. **Given** the manager clicks "Save View", **When** they provide a view name, **Then** the current tab + filters are saved and appear in a saved views dropdown for quick access.
8. **Given** the manager clicks "View Call History", **When** the page navigates, **Then** the full call log is shown with individual call records (contact, BDR, disposition, duration, timestamp).

---

### User Story 10 - Salesfloor Dashboard / Live Activity Monitor (Priority: P2)

A manager opens the Salesfloor Dashboard to see a real-time overview of all BDR activity across the calling floor. Each active BDR shows as a card with their current status (On Call, Idle, Paused, Dispositioning), the contact they're speaking with (name, company, phone), live call duration, and session stats (dials today, connects today). The manager can click any active call to listen in (coach mode) or barge in. The dashboard auto-refreshes and shows when a BDR has been idle for too long (highlighted after 5 minutes idle). The Salesfloor also shows a "Team Pulse" bar with aggregate KPIs: Total Active BDRs, Total Dials (today), Total Connects (today), and Average Dial-to-Connect %. Managers can filter by team or BDR.

**Why this priority**: The Salesfloor gives managers live visibility into calling activity without interrupting BDRs. Essential for coaching in real-time and identifying reps who are stuck or idle.

**Independent Test**: Have 3 BDRs start dialing sessions simultaneously. Manager opens Salesfloor, verifies all 3 appear with correct statuses. One BDR connects a call — verify the card updates to "On Call" with contact info. Manager clicks "Listen" — verify coach mode works. One BDR pauses — verify card shows "Paused."

**Acceptance Scenarios**:

1. **Given** a manager opens the Salesfloor Dashboard, **When** 3 BDRs have active sessions, **Then** 3 BDR cards are displayed with name, current status, session stats, and call queue progress.
2. **Given** a BDR is on an active call, **When** the manager views their card, **Then** the card shows "On Call" status, contact name/company, phone number, live call duration counter, and "Listen" / "Barge" action buttons.
3. **Given** a BDR has been idle (no active call, not paused) for more than 5 minutes, **When** the manager views the Salesfloor, **Then** the BDR's card is highlighted with an "Idle" warning indicator.
4. **Given** the Salesfloor is open, **When** the Team Pulse bar is displayed, **Then** it shows: Total Active BDRs, Total Dials Today, Total Connects Today, and Avg Dial-to-Connect %.
5. **Given** a BDR ends their session, **When** the Salesfloor refreshes, **Then** the BDR's card disappears from the active view and their session stats are preserved in the analytics.

---

### Edge Cases

- What happens when Twilio returns a "number not in service" error? → Log as "Invalid Number" disposition, auto-advance.
- What happens when the BDR's internet connection drops mid-call? → Twilio maintains the call server-side; reconnection shows call status. If unrecoverable, log as "Dropped Call."
- What happens when the BDR's microphone/speaker is not available? → Show error before dialing starts, do not initiate call.
- What happens when all numbers in the queue are exhausted? → Show "Queue Complete" summary with call stats (connected, voicemail, no answer counts).
- What happens when AMD is uncertain (neither human nor machine detected within timeout)? → Default to treating as human — let BDR hear audio and decide.
- What happens when two BDRs have the same contact in their queue? → Allow it (different campaigns may target same contact), but show a warning if the contact was called within the last 24 hours.
- What happens when the Twilio account runs out of credit? → Circuit breaker trips, dialer is disabled, admin is notified.
- What happens when a call exceeds 30 minutes? → Auto-warn at 25 minutes, auto-disconnect at 30 minutes with disposition prompt.
- What happens when the HubSpot connection is expired/revoked? → Queue calls for sync, notify admin, allow dialing to continue without sync.
- What happens when the transcription service is down? → Recording is still saved; transcription is retried via BullMQ with exponential backoff.
- What happens when a scheduled callback time arrives but the BDR is on another call? → Toast notification queues; callback contact is inserted at position 2 (next after current call). BDR sees notification after current call ends.
- What happens when a BDR schedules a callback but is not online at the scheduled time? → Callback remains in "Pending" status. When BDR starts a new session, all due/overdue callbacks are loaded at the top of the queue. After 30 min overdue, marked "Missed."
- What happens when a contact is both in the callback queue and the regular queue? → Callback takes priority. Regular queue item is marked as "Superseded by callback" and skipped.
- What happens when the BDR's microphone is disconnected mid-session? → WebRTC device fires an error event. Show "Microphone disconnected" warning. Auto-pause the dialer. Resume requires mic re-selection.
- What happens when a BDR is auto-ended for inactivity but had queued contacts? → Session stats are saved. Queue state persists. BDR can start a new session and the queue picks up where it left off.
- What happens when a "Removed prospect" is re-added but they were removed from multiple campaigns? → Re-add applies only to the current queue/session. Other campaign queues remain filtered until explicitly re-added there.
- What happens when a DNC contact's phone number appears under a different contact record? → DNC is keyed by phone number (not contact ID). Any contact with that phone number is flagged as uncallable.
- What happens when HubSpot refresh finds a contact was deleted in HubSpot? → Contact is moved to "Uncallable" with reason "Deleted in CRM." Not auto-removed from queue in case of accidental CRM deletion.
- What happens when the Salesfloor dashboard has 20+ active BDRs? → Pagination or scrollable card grid. Team Pulse bar remains fixed at top. Performance: polling batches all BDR statuses in a single API call.
- What happens when analytics date range spans months with high call volume (10,000+ records)? → API enforces a 90-day max range for MVP. Large queries use database cursors. Consider pre-aggregation tables post-MVP.

## Clarifications

### Session 2026-03-12

- Q: Should Twilio be a single platform-owned account (shared) or per-client Twilio accounts? → A: Single platform Twilio account, dedicate phone numbers per client from the pool.
- Q: What level of compliance handling should the dialer implement? → A: Full compliance (Orum-level) — automated recording consent disclosure + DNC list check (upstream via enrichment) + per-state two-party consent rules + TCPA time-of-day calling windows + opt-out tracking. This is our platform for internal use; we want feature parity with Orum.
- Q: Which transcription provider should the system use? → A: Deepgram — faster, cheaper (~$0.0043/min), real-time capable, strong phone audio quality.
- Q: What caller ID strategy should the dialer use? → A: Local presence dialing — system auto-selects a number from the pool matching the contact's area code to maximize answer rates. Falls back to the client's primary number if no local match exists.
- Q: Who should have access to call recordings and transcripts? → A: Role-based — BDRs see only their own recordings, managers see their assigned BDRs' recordings, admins see all.

## Requirements _(mandatory)_

### Functional Requirements

**Telephony Core**
- **FR-001**: System MUST initiate outbound calls via Twilio Programmable Voice using WebRTC in the browser (Twilio Client SDK).
- **FR-002**: System MUST support Twilio Answering Machine Detection (AMD) with async mode for all outbound calls.
- **FR-003**: System MUST auto-terminate calls within 2 seconds of AMD detecting a voicemail/answering machine.
- **FR-004**: System MUST implement a configurable connected call timer (default 45 seconds, adjustable per client from 15s to 120s) that starts when a human answers to distinguish connected calls from brief voicemail greetings.
- **FR-005**: System MUST support call controls: dial, hang up, mute/unmute, hold/resume.
- **FR-006**: System MUST use Twilio Conference rooms (not direct calls) to enable manager monitoring and barge-in.

**Recording & Transcription**
- **FR-007**: System MUST record all connected calls (human answered, connected-call timer threshold met) via Twilio call recording.
- **FR-008**: System MUST send completed recordings to Deepgram for post-call transcription.
- **FR-009**: System MUST store recording URLs and transcripts in the database, linked to the call session record.
- **FR-010**: System MUST NOT record calls that were auto-skipped (voicemail) or not answered.

**Power Dialer Logic**
- **FR-011**: System MUST auto-advance to the next contact in the queue after disposition is submitted (or after voicemail auto-skip).
- **FR-012**: System MUST support queue operations: skip contact, pause auto-dial, resume auto-dial.
- **FR-013**: System MUST persist queue state across browser sessions (server-side state).
- **FR-014**: System MUST prevent dialing a contact who was called within the last 24 hours (configurable cooldown) with a warning override.

**Disposition**
- **FR-015**: System MUST display a disposition modal after every connected call ends.
- **FR-016**: System MUST support configurable disposition types: Connected - Interested, Connected - Not Interested, Connected - Callback Requested, Voicemail - Auto Skipped, Voicemail - Left Message, No Answer, Wrong Number, Do Not Call, Invalid Number (auto-set on Twilio error), Dropped Call (auto-set on network failure).
- **FR-017**: System MUST allow BDRs to add free-text notes during disposition.
- **FR-018**: System MUST map dispositions to HubSpot call outcomes for CRM sync.

**CRM Sync**
- **FR-019**: System MUST sync call activities to HubSpot as call engagements via the existing HubSpot integration (OAuth per client).
- **FR-020**: System MUST include call duration, disposition, recording permalink, transcript summary, and BDR notes in the HubSpot engagement.
- **FR-021**: System MUST handle HubSpot sync failures with retry logic (3 retries, exponential backoff) and error logging.
- **FR-022**: System MUST support CRM-agnostic sync interface to allow future Attio/Salesforce integration.

**Dialer Session Management**
- **FR-073**: System MUST provide a "Start Session" button that initializes the WebRTC device, verifies microphone/speaker permissions, and begins the auto-dial queue.
- **FR-074**: System MUST allow BDRs to select microphone input and speaker output devices before and during a session (device picker with "Test Mic" functionality).
- **FR-075**: System MUST provide an "End Session" button that terminates any active call, saves session stats, and tears down the WebRTC device.
- **FR-076**: System MUST auto-end a session after 30 minutes of inactivity (no dials, no active calls, no disposition activity). A 5-minute warning toast MUST appear before auto-ending.
- **FR-077**: System MUST show session status in the dialer header: elapsed session time, total dials, total connects, and current queue position.
- **FR-078**: System MUST support "Resume Dialing" / "Pause Dialing" toggle during an active session.

**Uncallable Contact Management**
- **FR-079**: System MUST display an "Uncallable" section in the dialer queue that separates contacts who cannot be dialed from the callable queue. Uncallable reasons include: DNC (opted out), Removed prospect (requested not to be called), Invalid number, TCPA window blocked.
- **FR-080**: Each uncallable contact MUST display their uncallable reason as a badge (e.g., "DNC", "Removed prospect", "Invalid number").
- **FR-081**: For contacts marked as "Removed prospect", system MUST display a "Re-add Prospect" action that returns the contact to the callable queue (with confirmation).
- **FR-082**: DNC contacts MUST NOT have a "Re-add" option — DNC status is permanent and can only be removed by an admin via the admin dashboard.
- **FR-083**: Uncallable filtering MUST apply globally — a contact marked DNC or removed in one campaign is uncallable across ALL campaigns and sessions for that client.
- **FR-084**: System MUST pre-check the queue on session start and move any uncallable contacts to the uncallable section before dialing begins.

**HubSpot Contact Refresh**
- **FR-085**: System MUST provide a "Refresh from HubSpot" button in the dialer queue that re-syncs contact data (phone numbers, job title, company) from HubSpot for all contacts in the current queue.
- **FR-086**: Refresh MUST update contact phone numbers, names, and job titles if they have changed in HubSpot since the queue was loaded.
- **FR-087**: If a contact's phone number was removed or changed in HubSpot, the refresh MUST update the queue item accordingly and move the contact to "Uncallable" if no valid phone number exists.

**Recording Permalink Strategy (CRM-Agnostic)**
- **FR-042**: System MUST copy Twilio recordings to S3 (our bucket) after call completion. Twilio recording URLs are temporary/auth-gated and MUST NOT be pushed to CRMs directly.
- **FR-043**: System MUST generate a stable recording permalink per call (e.g., `https://{domain}/api/v1/recordings/{callSessionId}/audio`) that serves the audio from S3. This permalink is what gets pushed to all CRMs.
- **FR-044**: Recording permalink endpoint MUST support time-limited signed URLs (S3 pre-signed, 24-hour expiry, auto-refreshed on access) so CRM users can play inline without our dashboard auth.
- **FR-045**: For HubSpot specifically, the recording permalink MUST be set in the `hs_call_recording_url` engagement property so HubSpot renders its native audio player inline on the contact timeline.
- **FR-046**: System MUST include a link back to the full recording detail page in our admin dashboard (with transcript, coaching notes, full playback) in the engagement body/notes for deeper review.

**Transcript Delivery to CRM**
- **FR-047**: For HubSpot, system MUST write the full call transcript into the `hs_call_body` engagement property, formatted as timestamped speaker-labeled text (e.g., "0:15 - BDR: Hi, this is John from..."). If transcript exceeds HubSpot's 65,535 character limit, truncate with a "View full transcript" link to the admin dashboard.
- **FR-048**: For future CRMs (Attio, Salesforce, etc.), system MUST push transcripts as a "notes" field on the call activity record using the CRM-agnostic sync interface. The sync interface MUST define a standard `callActivity` payload shape: `{ duration, disposition, recordingUrl, transcript, notes, bdrName, contactEmail, timestamp }`.
- **FR-049**: System MUST support deferred transcript sync — if the transcript is not ready when the initial call engagement is created (Deepgram still processing), the system MUST update the CRM engagement with the transcript once available (async backfill via BullMQ job).

**Scheduled Callbacks & Missed Call Tracking**
- **FR-050**: System MUST allow BDRs to schedule a callback when dispositioning a call as "Connected - Callback Requested" — capturing callback date, time, and optional notes.
- **FR-051**: System MUST surface a toast notification in the dialer widget when a scheduled callback comes due (at the scheduled time +/- 1 minute).
- **FR-052**: System MUST auto-insert a due callback contact at the top of the BDR's active queue, bypassing normal queue order.
- **FR-053**: System MUST mark a scheduled callback as "Missed" if not completed within 30 minutes of the scheduled time.
- **FR-054**: System MUST track callback metrics separately from cold dials: total scheduled, completed, missed, and callback-to-connect rate.
- **FR-055**: System MUST support inbound missed call detection — when an inbound call from a known contact's number is missed, show a notification with "Call back" action.
- **FR-056**: System MUST persist scheduled callbacks across sessions and browser refreshes (server-side state).

**Manager Monitoring**
- **FR-023**: System MUST allow managers to view all active calls in real-time on the admin dashboard.
- **FR-024**: System MUST allow managers to join active calls in listen-only (coach) mode via Twilio Conference.
- **FR-025**: System MUST allow managers to escalate from coach mode to barge-in mode.

**Compliance**
- **FR-029**: System MUST play an automated recording consent disclosure at the start of calls when the contact is in a two-party consent state. System MUST maintain a mapping of US states to one-party vs two-party consent requirements.
- **FR-030**: System MUST enforce TCPA time-of-day calling windows — no outbound calls before 8:00 AM or after 9:00 PM in the contact's local timezone. System MUST resolve timezone from the contact's area code or address.
- **FR-031**: System MUST track opt-out requests. When a contact says "do not call" or a BDR dispositions as "Do Not Call", the contact is flagged and blocked from all future dialer queues across all campaigns.
- **FR-032**: System MUST check contacts against the opt-out list before adding to any dialer queue. DNC scrubbing (national registry) is handled upstream via the existing enrichment pipeline.
- **FR-033**: System MUST log all compliance events (consent played, opt-out recorded, TCPA window block) for audit purposes.

**Infrastructure**
- **FR-026**: System MUST use a single platform-owned Twilio account with dedicated phone numbers assigned per client from a shared pool. Phone number provisioning and assignment is managed by platform admins.
- **FR-034**: System MUST implement local presence dialing — auto-select an outbound caller ID number from the pool that matches the contact's area code. If no matching local number exists, fall back to the client's primary assigned number.
- **FR-027**: System MUST track Twilio usage costs per call and per client for billing.
- **FR-028**: System MUST implement circuit breaker for Twilio API failures (consistent with existing circuit breaker pattern).

**Call Recording Library**
- **FR-035**: System MUST provide a searchable Call Recording Library page in the admin dashboard with filters: BDR, campaign, date range, disposition, call duration (min/max).
- **FR-036**: System MUST support starring/favoriting recordings. Starred calls appear in a dedicated "Favorites" tab accessible by managers and admins.
- **FR-037**: System MUST allow managers to add coaching notes to any recording. Notes are timestamped and attributed to the manager who wrote them.
- **FR-038**: System MUST allow managers to flag recordings for review. Flagged calls show a "Manager Review" badge visible to the BDR.
- **FR-039**: System MUST support inline audio playback with seek, speed control (0.5x, 1x, 1.5x, 2x), and transcript-synchronized highlighting (click a transcript line to jump to that timestamp).

**Dialer Analytics**

_Analytics Metric Definitions:_
- **Dial**: Any outbound call attempt (includes all outcomes: connect, voicemail, no answer, etc.)
- **Bridged**: A call where the PSTN leg connected to the conference (contact's phone rang and was answered) but BEFORE the connected-call timer has elapsed. This is a raw "answered" count.
- **Connect**: A call where a human answered AND the connected-call timer elapsed (default 45s). This confirms a real human conversation, not a brief voicemail greeting that slipped past AMD.
- **Conversation**: A connected call where the disposition is NOT Wrong Number, Invalid Number, or Dropped Call. Represents a meaningful interaction with the intended contact.
- **Meeting**: A connected call where the disposition is Connected - Interested and the BDR notes or CRM activity indicate a meeting was booked.

- **FR-057**: System MUST provide a Dialer Analytics page with 5 tabs: Rep Performance, List Performance, Account Performance, Objections, and When to Call.
- **FR-058**: Rep Performance tab MUST display KPI summary cards: Dials, Callbacks, Connects, Conversations, and Meetings — with conversion funnel rates (Dial to connect %, Callback to connect %, Bridged to connect %, Connect to conversation %, Conversation to meeting %).
- **FR-059**: Rep Performance tab MUST display a detailed per-BDR table with columns: Rep name, Dials, Dial to connect %, Bridged to connect %, Outbound connects, Connect to conversation %, Conversations, Conversation to meeting %, Meetings, Callbacks, Callback to connect %, Callback connects, Dial time, Talk time, Pause time, Session time.
- **FR-060**: List Performance tab MUST display the same metrics broken down by call list/campaign, with an expandable disposition breakdown per list.
- **FR-061**: Account Performance tab MUST display metrics grouped by account/company, showing dial attempts, connect rate, and conversation outcomes per account.
- **FR-062**: System MUST support date range filtering (Today, This Week, This Month, Custom Range) across all analytics tabs. Filters MUST also support Team, Rep, List, Account, Call type (Outbound power dialed, Inbound callback), and Phone fields.
- **FR-063**: System MUST support a "Save View" feature — saving the current tab + filters as a named view for quick access via a dropdown.
- **FR-064**: System MUST provide a "View Call History" link that navigates to the full call log with individual call records (contact, BDR, disposition, duration, timestamp).
- **FR-065**: Analytics data MUST be computed from CallSession records in real-time (no pre-aggregation for MVP). All metrics are scoped by clientId.

**Salesfloor Dashboard**
- **FR-066**: System MUST provide a Salesfloor Dashboard page showing real-time BDR activity cards for all active dialer sessions within the client.
- **FR-067**: Each BDR card MUST display: BDR name, current status (On Call / Idle / Paused / Dispositioning / Ringing), current contact info (name, company, phone), live call duration counter, and session summary (dials today, connects today, queue remaining).
- **FR-068**: BDR cards MUST update in real-time via polling (every 5 seconds) or WebSocket push. Status changes (idle → on call, on call → dispositioning) MUST reflect within 5 seconds.
- **FR-069**: System MUST display a "Team Pulse" summary bar with aggregate KPIs: Total Active BDRs, Total Dials Today, Total Connects Today, and Avg Dial-to-Connect %.
- **FR-070**: Managers MUST be able to click "Listen" on any active call card to join in coach mode (FR-024) directly from the Salesfloor.
- **FR-071**: System MUST highlight BDR cards with an idle warning when a BDR has had no active call for 5+ minutes (not including paused sessions).
- **FR-072**: Salesfloor MUST support filtering by team and individual BDR.

**Access Control**
- **FR-040**: System MUST enforce role-based access to call recordings and transcripts: BDRs can only access their own recordings, managers can access recordings for BDRs they manage, admins can access all recordings.
- **FR-041**: System MUST restrict dialer access to authenticated BDRs assigned to the client. Managers and admins can view active calls and recordings but do not use the dialer directly.

### Key Entities

- **CallSession**: Represents a single call attempt. Tracks caller (BDR), contact, phone number, Twilio call SID, start/end time, duration, AMD result, connection status (connected after configurable timer, default 45s), disposition, recording URL, transcript.
- **CallRecording**: Recording metadata — Twilio recording SID, URL, duration, transcription status, transcript text, isFavorited flag, reviewStatus (pending/reviewed/flagged), coaching notes (array of timestamped manager comments).
- **DialerQueueItem**: Individual contact entry in a BDR's ordered call queue. Links to campaign contact or manual assignment. Tracks position, status (pending, dialing, completed, skipped), and compliance pre-check flags.
- **DispositionType**: Enum of disposition options (see FR-016). Maps to CRM-specific call outcome values via dispositionService.
- **TwilioPhoneNumber**: Phone number in the platform pool. Tracks area code, state, client assignment, and primary/active flags for local presence matching.
- **ScheduledCallback**: A callback scheduled by a BDR during disposition. Tracks contact info, scheduled date/time, BDR, status (Pending, Completed, Missed), and linked CallSession. Used for callback reminders and metrics.
- **UncallableContact**: Tracks contacts who are not callable within a client's dialer queues. Stores reason (DNC, Removed, Invalid Number), source (auto-detection vs. manual), and whether re-add is allowed. Applied globally across all campaigns for the client.
- **AnalyticsSavedView**: A named saved filter configuration for the analytics dashboard. Stores tab, date range, and filter selections (team, rep, list, account, call type, phone fields) per user.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: BDR can complete 40+ dials per hour using the power dialer (vs. ~15 manual dials per hour).
- **SC-002**: Voicemail detection accuracy is 90%+ (measured by comparing AMD result to BDR-reported actual outcome over 500 calls).
- **SC-003**: Auto-advance between calls takes less than 5 seconds (from disposition submit to next call ringing).
- **SC-004**: Call recordings are available for playback within 2 minutes of call completion.
- **SC-005**: Transcripts are available within 5 minutes of call completion.
- **SC-006**: 100% of dispositioned calls are synced to HubSpot within 60 seconds (excluding retry scenarios).
- **SC-007**: Manager can join an active call in listen-only mode within 3 seconds of clicking "Listen."
- **SC-008**: Dialer queue state persists with zero data loss across browser refreshes and session changes.
- **SC-009**: Twilio cost per call averages under $0.07/minute (voice + recording + transcription combined).
- **SC-010**: System handles 10+ concurrent BDRs dialing simultaneously without degradation.
- **SC-011**: Scheduled callback reminders fire within 60 seconds of the scheduled time.
- **SC-012**: Callback-to-connect rate is trackable and displayed separately from cold dial metrics.
- **SC-013**: Uncallable contacts (DNC, removed) are filtered from all queues with zero false negatives (no DNC contact is ever dialed).
- **SC-014**: Salesfloor Dashboard updates BDR status within 5 seconds of a state change.
- **SC-015**: Analytics page loads within 3 seconds for date ranges up to 30 days with 5,000+ call records.
- **SC-016**: Session inactivity auto-end triggers reliably at 30 minutes with 5-minute advance warning.
- **SC-017**: HubSpot contact refresh completes within 30 seconds for queues of up to 200 contacts.
- **SC-018**: Mic/speaker device selection persists across session restarts for the same browser.
