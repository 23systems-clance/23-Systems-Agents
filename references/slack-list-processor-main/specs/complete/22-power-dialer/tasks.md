# Tasks: Power Dialer

**Input**: Design documents from `/specs/22-power-dialer/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/dialer-api.yaml, quickstart.md

**Tests**: Not explicitly requested. Manual testing via deployed ECS service.

**Organization**: Tasks grouped by user story (10 stories). P1 stories form MVP. P2 stories add coaching, analytics, and management features.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story (US1–US10)
- Exact file paths included

## Path Conventions

- **Backend**: `src/` (TypeScript, Express, Prisma)
- **Frontend**: `admin-dashboard/src/` (React, Vite, Tailwind)
- **Schema**: `prisma/schema.prisma`
- **Compliance data**: `src/data/compliance/`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Install dependencies, configure environment, set up Twilio/Deepgram/S3

- [ ] T001 Install backend dependencies: `twilio` and `@deepgram/sdk` in root `package.json`
- [ ] T002 Install frontend dependency: `@twilio/voice-sdk` in `admin-dashboard/package.json`
- [ ] T003 [P] Add Twilio and Deepgram environment variables to `src/config/index.ts` (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_API_KEY_SID, TWILIO_API_KEY_SECRET, TWILIO_TWIML_APP_SID, DEEPGRAM_API_KEY, RECORDINGS_S3_BUCKET, RECORDINGS_S3_REGION, WEBHOOK_BASE_URL)
- [ ] T004 [P] Create S3 recordings bucket (`list-processor-recordings`) with CORS, lifecycle policy, and encryption per `quickstart.md` section 3
- [ ] T005 [P] Create compliance data files: `src/data/compliance/two-party-consent-states.ts` (11 states: CA, CT, FL, IL, MD, MA, MI, MT, NH, PA, WA) and `src/data/compliance/area-code-timezone-map.ts` (US area code to timezone mapping)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Prisma schema, shared types, Twilio SDK wrapper, route scaffolding — MUST complete before any user story

**CRITICAL**: No user story work can begin until this phase is complete

- [ ] T006 Add all new enums to `prisma/schema.prisma`: CallSessionStatus, AmdResult, DispositionType, TranscriptionStatus, RecordingReviewStatus, ComplianceEventType, CallbackStatus, UncallableReason (per data-model.md)
- [ ] T007 Add all new models to `prisma/schema.prisma`: DialerSession, CallSession, CallRecording, CoachingNote, DialerQueueItem, TwilioPhoneNumber, ContactOptOut, ComplianceLog, ScheduledCallback, UncallableContact, AnalyticsSavedView (per data-model.md)
- [ ] T008 Add relation fields to existing models in `prisma/schema.prisma`: Bdr (dialerSessions, callSessions, callRecordings, scheduledCallbacks, complianceLogs), ManagedClient (dialerSessions, callSessions, callRecordings, twilioPhoneNumbers, contactOptOuts, complianceLogs, uncallableContacts, analyticsSavedViews, scheduledCallbacks, connectedCallTimerSeconds Int @default(45)), Campaign (dialerSessions), CampaignContact (dialerCallSessions, dialerQueueItems), CampaignContactStepExecution (dialerCallSession, dialerQueueItem)
- [ ] T009 [P] Create TypeScript interfaces in `src/types/dialer.ts` — shared types for dialer session, call session, queue item, disposition, compliance check result, analytics query params, and CRM-agnostic `CrmCallActivity` interface (per FR-022/FR-048: `{ duration, disposition, recordingUrl, transcript, notes, bdrName, contactEmail, timestamp }`)
- [ ] T010 [P] Create Twilio SDK wrapper in `src/services/dialer/twilioClient.ts` — initialize Twilio client, generate AccessToken with VoiceGrant (outgoingApplicationSid), token endpoint helper
- [ ] T011 [P] Create dialer route scaffolding in `src/routes/dialer/index.ts` — mount sub-routers (sessions, queue, calls, disposition, callbacks, token, device) with BDR auth middleware
- [ ] T012 [P] Create admin route files scaffolding: `src/routes/admin/recordings.ts`, `src/routes/admin/recording-reviews.ts`, `src/routes/admin/activeCalls.ts`, `src/routes/admin/dialer-config.ts`, `src/routes/admin/analytics.ts`, `src/routes/admin/savedViews.ts`, `src/routes/admin/salesfloor.ts`, `src/routes/admin/uncallable.ts` — register in `src/routes/admin/index.ts`
- [ ] T013 [P] Create webhook route files: `src/routes/webhooks/twilio.ts` (voice, status, amd, recording endpoints with Twilio signature validation), `src/routes/webhooks/deepgram.ts` (transcript callback)
- [ ] T014 [P] Create frontend API service files: `admin-dashboard/src/services/dialer-api.ts`, `admin-dashboard/src/services/recordings-api.ts`, `admin-dashboard/src/services/callbacks-api.ts`, `admin-dashboard/src/services/analytics-api.ts`, `admin-dashboard/src/services/salesfloor-api.ts`
- [ ] T015 Register dialer routes in `src/server.ts` — mount `/api/v1/dialer` router and webhook routes

**Checkpoint**: Foundation ready — all models exist, SDK initialized, routes scaffolded. User story implementation can begin.

---

## Phase 3: User Story 1 — BDR Power Dials a Call List (Priority: P1) MVP

**Goal**: BDR starts a session, system auto-dials contacts via WebRTC, BDR hears ringing, disposes calls, system auto-advances to next contact.

**Independent Test**: Load 5 test numbers, start dialer, complete calls, verify auto-advance within 3 seconds.

### Backend — US1

- [ ] T016 [US1] Implement session manager in `src/services/dialer/sessionManager.ts` — startSession (create DialerSession, populate queue from campaign phone steps or manual contacts), pauseSession, resumeSession, endSession (save stats, update status)
- [ ] T017 [US1] Implement dialer engine in `src/services/dialer/dialerEngine.ts` — dialNext (create CallSession, select caller ID, initiate Twilio Conference + outbound PSTN call with AMD), handleCallAnswered (start connected-call timer), handleCallEnded (calculate duration, update status), advanceQueue (find next PENDING queue item; if a due ScheduledCallback exists for this BDR, prioritize it over regular queue — mark superseded regular queue item as SKIPPED per edge case "contact in callback + regular queue")
- [ ] T018 [US1] Implement conference manager in `src/services/dialer/conferenceManager.ts` — createConference (unique name per call), addBdrToConference (WebRTC leg via TwiML App), addContactToConference (PSTN outbound with AMD), endConference
- [ ] T019 [US1] Implement local presence in `src/services/dialer/localPresence.ts` — selectCallerID (match contact area code to TwilioPhoneNumber pool, fallback: same state, then client primary number)
- [ ] T020 [US1] Implement compliance engine in `src/services/dialer/complianceEngine.ts` — preCallCheck (TCPA window check via area code timezone, opt-out check via ContactOptOut, two-party consent state check, 24-hour cooldown check via lastCalledAt with warning override flag), logComplianceEvent (write to ComplianceLog)
- [ ] T021 [US1] Implement disposition service in `src/services/dialer/dispositionService.ts` — submitDisposition (update CallSession with disposition + notes, advance campaign contact via advanceContact(), trigger CRM sync)
- [ ] T022 [US1] Implement session routes in `src/routes/dialer/sessions.ts` — POST /sessions (start), GET /sessions (get active), POST /sessions/:id/pause, POST /sessions/:id/resume, POST /sessions/:id/complete
- [ ] T023 [US1] Implement queue routes in `src/routes/dialer/queue.ts` — GET /sessions/:id/queue (list items with callable/uncallable sections), POST /sessions/:id/queue/:itemId/skip
- [ ] T024 [US1] Implement call routes in `src/routes/dialer/calls.ts` — POST /calls/dial (initiate call), POST /calls/:id/hangup, POST /calls/:id/mute, POST /calls/:id/hold
- [ ] T025 [US1] Implement disposition route in `src/routes/dialer/disposition.ts` — POST /calls/:id/disposition (submit disposition + optional callback scheduling, return next queue item)
- [ ] T026 [US1] Implement token route in `src/routes/dialer/token.ts` — POST /token (generate Twilio AccessToken with VoiceGrant, 1-hour TTL)
- [ ] T027 [US1] Implement device route in `src/routes/dialer/device.ts` — GET/PUT /device (save/load BDR mic/speaker preferences)
- [ ] T028 [US1] Implement Twilio voice webhook in `src/routes/webhooks/twilio.ts` — POST /voice (TwiML App Request URL: return Conference TwiML), POST /status (call status callback: ringing, answered, completed)

### Frontend — US1

- [ ] T029 [US1] Create Twilio device hook in `admin-dashboard/src/hooks/useTwilioDevice.ts` — initialize @twilio/voice-sdk Device, handle token refresh, connect/disconnect, device.on('incoming'), error handling
- [ ] T030 [US1] Create audio devices hook in `admin-dashboard/src/hooks/useAudioDevices.ts` — enumerate browser media devices (microphones, speakers), persist selection in localStorage, provide "Test Mic" functionality
- [ ] T031 [US1] Create call timer hook in `admin-dashboard/src/hooks/useCallTimer.ts` — configurable connected-call timer (default 45s, range 15-120s), start on human answer, emit "connected" event when timer elapses
- [ ] T032 [US1] Create dialer session hook in `admin-dashboard/src/hooks/useDialerSession.ts` — session state management (start, pause, resume, end), queue state, current call tracking, auto-advance logic after disposition
- [ ] T033 [US1] Create inactivity timeout hook in `admin-dashboard/src/hooks/useInactivityTimeout.ts` — 30-min inactivity detection, 5-min advance warning, auto-end session
- [ ] T034 [P] [US1] Create AudioDevicePicker component in `admin-dashboard/src/components/dialer/AudioDevicePicker.tsx` — mic/speaker dropdowns, Test Mic button, volume meter
- [ ] T035 [P] [US1] Create SessionControls component in `admin-dashboard/src/components/dialer/SessionControls.tsx` — Start Session (with device check), Pause/Resume, End Session buttons, session status header (elapsed time, dials, connects, queue position)
- [ ] T036 [P] [US1] Create CallTimer component in `admin-dashboard/src/components/dialer/CallTimer.tsx` — visual progress bar for connected-call timer (45s default), green fill animation
- [ ] T037 [P] [US1] Create DialerWidget component in `admin-dashboard/src/components/dialer/DialerWidget.tsx` — contact card (name, company, phone), call status indicator (ringing/connected/ended), live call duration timer, call controls (Mute, Hold, End Call)
- [ ] T038 [P] [US1] Create DispositionModal component in `admin-dashboard/src/components/dialer/DispositionModal.tsx` — disposition type dropdown (all DispositionType values), free-text notes field, Submit button, auto-close + advance on submit
- [ ] T039 [P] [US1] Create DialerQueue component in `admin-dashboard/src/components/dialer/DialerQueue.tsx` — ordered contact list with position numbers, current contact highlighted, Skip button per contact, contact cards (name, company, phone), queue progress indicator
- [ ] T040 [P] [US1] Create InactivityWarning component in `admin-dashboard/src/components/dialer/InactivityWarning.tsx` — toast notification at 25-min idle, countdown to auto-end at 30 min
- [ ] T041 [US1] Create main dialer page in `admin-dashboard/src/pages/bdr/dialer.tsx` — full-screen layout: DialerWidget (center), DialerQueue (sidebar), SessionControls (header), DispositionModal (overlay), InactivityWarning (toast)
- [ ] T042 [US1] Add dialer page route to `admin-dashboard/src/router.tsx` — `/bdr/dialer` lazy-loaded, BDR auth required
- [ ] T043 [US1] Create PreCallCheck component in `admin-dashboard/src/components/dialer/PreCallCheck.tsx` — verify internet connectivity, microphone permission, Twilio WebRTC capability before session start

**Checkpoint**: Core power dialer functional. BDR can start session, dial contacts, hear ringing, talk, disposition, auto-advance. This is the MVP.

---

## Phase 4: User Story 2 — Automatic Voicemail Detection and Skip (Priority: P1)

**Goal**: Twilio AMD auto-detects voicemail, system hangs up within 2 seconds, logs as "Voicemail - Auto Skipped", auto-advances to next contact without BDR action.

**Independent Test**: Dial numbers known to go to voicemail, verify auto-hangup within 5s of AMD detection and auto-advance.

- [ ] T044 [US2] Implement AMD handling in `src/services/dialer/dialerEngine.ts` — handleAmdResult (on MACHINE_START/MACHINE_END: terminate call within 2s, set disposition=VOICEMAIL_AUTO_SKIPPED, update queue item, trigger auto-advance)
- [ ] T045 [US2] Implement AMD webhook in `src/routes/webhooks/twilio.ts` — POST /amd (AsyncAmdStatusCallback: parse AnsweredBy field, route to dialerEngine.handleAmdResult)
- [ ] T046 [US2] Update DialerWidget in `admin-dashboard/src/components/dialer/DialerWidget.tsx` — show "Voicemail Detected" status indicator when AMD fires, brief visual before auto-advance
- [ ] T047 [US2] Update dialer session hook in `admin-dashboard/src/hooks/useDialerSession.ts` — handle voicemail auto-skip events (increment voicemail counter, skip disposition modal, auto-advance immediately)

**Checkpoint**: Voicemail calls are auto-detected and skipped. BDR only interacts with human-answered calls.

---

## Phase 5: User Story 5 — Disposition Sync to HubSpot (Priority: P1)

**Goal**: Every dispositioned call syncs to HubSpot as a call engagement with duration, outcome, recording URL, transcript, and notes.

**Independent Test**: Disposition a call, verify HubSpot engagement appears on contact timeline within 60s with correct fields.

- [ ] T048 [US5] Implement CRM sync service in `src/services/dialer/crmSyncService.ts` — syncCallToHubSpot (create call engagement via existing HubSpotService with hs_call_duration, hs_call_outcome mapped from DispositionType, hs_call_recording_url as S3 permalink, hs_call_body as formatted transcript, disposition notes), retry logic (3 retries, exponential backoff), deferred transcript backfill via BullMQ
- [ ] T049 [US5] Implement recording permalink route in `src/routes/dialer/recordings-permalink.ts` — GET /recordings/:callSessionId/audio (redirect to S3 pre-signed URL, 24h expiry for dashboard, 30d for CRM)
- [ ] T050 [US5] Add HubSpot outcome mapping to `src/services/dialer/dispositionService.ts` — map DispositionType enum to HubSpot hs_call_outcome values (CONNECTED_INTERESTED->Connected, VOICEMAIL_AUTO_SKIPPED->No Answer, etc.)
- [ ] T051 [US5] Add transcript truncation logic to `src/services/dialer/crmSyncService.ts` — if transcript > 60,000 chars, keep first/last 20 utterances + "View full transcript" link to admin dashboard
- [ ] T052 [US5] Add BullMQ job for deferred transcript sync in `src/services/queue/workers/` — when Deepgram transcript arrives after initial HubSpot sync, PATCH the engagement with hs_call_body

**Checkpoint**: All call dispositions sync to HubSpot automatically with full metadata.

---

## Phase 6: User Story 3 — Call Recording and Transcription (Priority: P2)

**Goal**: Connected calls are recorded via Twilio, recordings copied to S3, transcribed by Deepgram, transcript stored and viewable.

**Independent Test**: Make a connected call, verify recording playable within 2 min and transcript appears within 5 min.

- [ ] T053 [US3] Implement recording manager in `src/services/dialer/recordingManager.ts` — startRecording (on connected call via Twilio Conference recording), handleRecordingReady (download from Twilio, upload to S3 with key pattern recordings/{clientId}/{year}/{month}/{day}/call-{callSid}.wav), generatePresignedUrl (24h dashboard, 30d CRM), deleteFromTwilio (after S3 confirmed)
- [ ] T054 [US3] Implement transcription service in `src/services/dialer/transcriptionService.ts` — submitForTranscription (POST to Deepgram Nova-2 with S3 pre-signed URL, diarize=true, utterances=true, punctuate=true, callback=webhook URL), handleTranscriptCallback (parse Deepgram response, format speaker-labeled timestamped transcript, store in CallRecording.transcript and transcriptJson)
- [ ] T055 [US3] Implement recording webhook in `src/routes/webhooks/twilio.ts` — POST /recording (RecordingStatusCallback: trigger recordingManager.handleRecordingReady)
- [ ] T056 [US3] Implement transcript webhook in `src/routes/webhooks/deepgram.ts` — POST /transcript (Deepgram callback: trigger transcriptionService.handleTranscriptCallback, update CRM engagement via deferred sync)
- [ ] T057 [US3] Implement cost tracker in `src/services/dialer/dialerCostTracker.ts` — calculateTwilioCost (call minutes * $0.013 + AMD $0.0075 + recording $0.0025/min), calculateDeepgramCost (transcription minutes * $0.0043), update CallSession.twilioCostUsd and deepgramCostUsd
- [ ] T058 [P] [US3] Create RecordingPlayer component in `admin-dashboard/src/components/dialer/RecordingPlayer.tsx` — audio player with seek, speed controls (0.5x, 1x, 1.5x, 2x), current position display, transcript-synchronized highlighting (click transcript line to jump to timestamp)

**Checkpoint**: Connected calls recorded, transcribed, and viewable. Recording permalinks work in HubSpot.

---

## Phase 7: User Story 4 — Call Listening / Manager Monitoring (Priority: P2)

**Goal**: Manager views active calls, joins in listen-only mode (coach), can escalate to barge-in.

**Independent Test**: BDR dials, manager clicks Listen, verifies one-way audio. Manager clicks Barge, both parties hear manager.

- [ ] T059 [US4] Extend conference manager in `src/services/dialer/conferenceManager.ts` — joinAsCoach (add manager to conference with Coaching=true, Muted=true), bargeIn (update participant Coaching=false, Muted=false), removeManager (end manager's conference leg)
- [ ] T060 [US4] Implement active calls route in `src/routes/admin/activeCalls.ts` — GET /active-calls (list all active CallSessions with status RINGING or CONNECTED, include BDR name, contact info, duration, conference SID), POST /active-calls/:id/listen (generate manager Twilio token for conference join), POST /active-calls/:id/barge (escalate to barge-in)
- [ ] T061 [P] [US4] Create ActiveCallCard component in `admin-dashboard/src/components/dialer/ActiveCallCard.tsx` — BDR name, contact info, live duration counter, status badge (Ringing/Connected), Listen button, Barge button
- [ ] T062 [US4] Create active calls page in `admin-dashboard/src/pages/active-calls.tsx` — grid of ActiveCallCard components, auto-refresh every 5s, empty state when no active calls
- [ ] T063 [US4] Add active calls page route to `admin-dashboard/src/router.tsx` — `/active-calls` with admin auth

**Checkpoint**: Managers can monitor and join active calls in real-time.

---

## Phase 8: User Story 6 — Dialer Queue Management (Priority: P2)

**Goal**: BDR controls queue (skip, pause, resume, reorder). Queue persists across browser sessions. Managers assign lists.

**Independent Test**: Load queue, skip 2 contacts, pause, close browser, reopen, verify queue state preserved.

- [ ] T064 [US6] Implement uncallable manager in `src/services/dialer/uncallableManager.ts` — filterUncallable (check ContactOptOut, UncallableContact, TCPA window for each queue item), addToUncallable (create UncallableContact record), reAddProspect (delete REMOVED entry, return to callable queue), isUncallable (single contact check)
- [ ] T065 [US6] Extend queue routes in `src/routes/dialer/queue.ts` — POST /sessions/:id/queue/reorder (accept new position array), GET /sessions/:id/queue/uncallable (list uncallable contacts with reasons), POST /sessions/:id/queue/:itemId/re-add (re-add REMOVED prospect)
- [ ] T066 [US6] Implement admin uncallable routes in `src/routes/admin/uncallable.ts` — GET /uncallable (list all DNC/uncallable per client), POST /uncallable (admin add DNC entry), DELETE /uncallable/:id (admin remove DNC — only route that can remove DNC)
- [ ] T067 [P] [US6] Create UncallableSection component in `admin-dashboard/src/components/dialer/UncallableSection.tsx` — collapsible section showing uncallable contacts, reason badges (DNC, Removed, Invalid, TCPA), Re-add button for REMOVED contacts (with confirmation dialog), no Re-add for DNC
- [ ] T068 [US6] Update DialerQueue component in `admin-dashboard/src/components/dialer/DialerQueue.tsx` — add UncallableSection below callable list, add queue reordering UI (drag handles or move up/down buttons), add "Queue Complete" summary when all contacts exhausted, add "Refresh from HubSpot" button in queue header (calls POST /sessions/:id/queue/refresh-hubspot, shows loading state, updates queue items on completion per FR-085)

**Checkpoint**: Full queue management with uncallable filtering, persistence, and admin DNC control.

---

## Phase 9: User Story 7 — Call Recording Library & Manager Review (Priority: P2)

**Goal**: Managers browse all recordings with filters, star/flag calls, add coaching notes. BDRs see own recordings.

**Independent Test**: Make 10 calls, filter by BDR + disposition, star 2, add coaching note to 1, verify persistence.

- [ ] T069 [US7] Implement recordings list route in `src/routes/admin/recordings.ts` — GET /recordings (paginated, filterable by bdrId, campaignId, clientId, disposition, minDuration, maxDuration, dateFrom, dateTo, reviewStatus, favoritesOnly; role-based: BDR sees own, manager sees team, admin sees all), GET /recordings/:id (full detail with transcript + coaching notes + audio URL)
- [ ] T070 [US7] Implement recording review routes in `src/routes/admin/recording-reviews.ts` — POST /recordings/:id/favorite (toggle isFavorited), POST /recordings/:id/review (set reviewStatus to FLAGGED or REVIEWED), POST /recordings/:id/coaching-notes (create CoachingNote with optional timestampSeconds)
- [ ] T071 [US7] Create recordings library page in `admin-dashboard/src/pages/recordings.tsx` — filter sidebar (BDR, campaign, date range, disposition, duration, review status), recording cards grid/table, Favorites tab, pagination
- [ ] T072 [US7] Create recording detail page in `admin-dashboard/src/pages/recording-detail.tsx` — RecordingPlayer with transcript sync, CoachingNotes panel, call metadata (BDR, contact, disposition, duration), star/flag actions
- [ ] T073 [P] [US7] Create CoachingNotes component in `admin-dashboard/src/components/dialer/CoachingNotes.tsx` — list of timestamped notes with author, "Add Note" form with optional timestamp input, click note to seek audio player
- [ ] T074 [US7] Add recording pages routes to `admin-dashboard/src/router.tsx` — `/recordings` and `/recordings/:id` with admin auth

**Checkpoint**: Full recording library with search, review, coaching notes, and role-based access.

---

## Phase 10: User Story 8 — Scheduled Callbacks & Missed Call Tracking (Priority: P2)

**Goal**: BDR schedules callbacks during disposition, gets toast reminders at scheduled time, callbacks auto-inserted at queue top.

**Independent Test**: Schedule 3 callbacks, verify reminders fire, complete 2, let 1 expire, confirm metrics show 2 completed / 1 missed.

- [ ] T075 [US8] Implement callback service in `src/services/dialer/callbackService.ts` — scheduleCallback (create ScheduledCallback from disposition), getDueCallbacks (query PENDING where scheduledAt <= now), markCompleted (update status, link to new CallSession), markMissed (set status=MISSED after 30 min overdue), getCallbackMetrics (total scheduled, completed, missed, callback-to-connect rate)
- [ ] T076 [US8] Implement callback routes in `src/routes/dialer/callbacks.ts` — GET /callbacks (list BDR's callbacks: pending, due, overdue), POST /callbacks/:id/reschedule (update scheduledAt), POST /callbacks/:id/complete (mark completed)
- [ ] T077 [US8] Extend DispositionModal in `admin-dashboard/src/components/dialer/DispositionModal.tsx` — when disposition=CONNECTED_CALLBACK_REQUESTED, show CallbackScheduler inline (date/time picker + optional notes)
- [ ] T078 [P] [US8] Create CallbackScheduler component in `admin-dashboard/src/components/dialer/CallbackScheduler.tsx` — date/time picker, notes field, timezone display
- [ ] T079 [P] [US8] Create CallbackReminder component in `admin-dashboard/src/components/dialer/CallbackReminder.tsx` — toast notification with contact name, company, "Call back now" button, dismiss/snooze
- [ ] T080 [US8] Create callback reminders hook in `admin-dashboard/src/hooks/useCallbackReminders.ts` — poll /callbacks for due items every 30s, show toast via CallbackReminder component, on click: insert contact at queue top and dial
- [ ] T081 [US8] Add BullMQ repeatable job for missed callback detection — check every 5 minutes for PENDING callbacks where scheduledAt + 30min < now, mark as MISSED
- [ ] T081a [US8] Implement inbound missed call detection in `src/routes/webhooks/twilio.ts` — add POST /inbound handler (when Twilio routes an inbound call to a pool number, look up caller phone in CampaignContact/ContactOptOut, if known contact and BDR is on another call or unavailable, log as missed inbound call in CallSession with status=NO_ANSWER and source=INBOUND, per FR-055)
- [ ] T081b [US8] Implement inbound missed call notification in `src/services/dialer/callbackService.ts` — getMissedInboundCalls (query recent inbound missed calls for BDR), expose via GET /callbacks/missed-inbound endpoint in `src/routes/dialer/callbacks.ts`
- [ ] T081c [P] [US8] Create MissedCallNotification component in `admin-dashboard/src/components/dialer/MissedCallNotification.tsx` — toast notification showing contact name, company, phone, "Call back" action button (inserts at top of queue and dials immediately)
- [ ] T081d [US8] Extend useCallbackReminders hook in `admin-dashboard/src/hooks/useCallbackReminders.ts` — also poll /callbacks/missed-inbound every 30s, show MissedCallNotification toast for new missed inbound calls

**Checkpoint**: Callback scheduling, reminders, missed detection, and inbound missed call tracking fully functional.

---

## Phase 11: User Story 9 — Dialer Analytics Dashboard (Priority: P2)

**Goal**: Manager views 5-tab analytics dashboard (Rep Performance, List Performance, Account Performance, Objections, When to Call) with date filtering and saved views.

**Independent Test**: After 50+ calls, verify KPI cards compute correctly, rep table matches BDR totals, date filtering works.

- [ ] T082 [US9] Implement analytics service in `src/services/dialer/analyticsService.ts` — getRepPerformance (aggregate CallSession by bdrId: dials, connects, voicemails, conversations, meetings, callback metrics, dial/talk/pause/session time), getListPerformance (aggregate by campaignId with disposition breakdown), getAccountPerformance (aggregate by companyName), getCallHistory (paginated call log), getWhenToCallHeatmap (hour-of-day x day-of-week connect rate matrix)
- [ ] T083 [US9] Implement analytics routes in `src/routes/admin/analytics.ts` — GET /analytics/rep-performance, GET /analytics/list-performance, GET /analytics/account-performance, GET /analytics/call-history, GET /analytics/objections, GET /analytics/when-to-call — all accept date range, team, rep, list, account, callType filters
- [ ] T084 [US9] Implement saved views routes in `src/routes/admin/savedViews.ts` — GET /saved-views (list user's views), POST /saved-views (create), DELETE /saved-views/:id
- [ ] T085 [P] [US9] Create AnalyticsKPICards component in `admin-dashboard/src/components/dialer/AnalyticsKPICards.tsx` — summary cards: Dials, Callbacks, Connects, Conversations, Meetings + conversion funnel rates
- [ ] T086 [P] [US9] Create RepPerformanceTable component in `admin-dashboard/src/components/dialer/RepPerformanceTable.tsx` — columns: Rep, Dials, Dial-to-connect %, Connects, Connect-to-conversation %, Conversations, Meetings, Callbacks, Callback connects, Dial time, Talk time, Session time
- [ ] T087 [P] [US9] Create ListPerformanceTable component in `admin-dashboard/src/components/dialer/ListPerformanceTable.tsx` — columns: List/Campaign, Dials, Connect %, Connects, Conversations, Meetings + expandable disposition breakdown per list
- [ ] T088a [P] [US9] Create AccountPerformanceTable component in `admin-dashboard/src/components/dialer/AccountPerformanceTable.tsx` — columns: Account/Company, Dial Attempts, Connect Rate %, Connects, Conversations, Conversation Outcomes, Meetings (per FR-061)
- [ ] T088 [P] [US9] Create AnalyticsFilters component in `admin-dashboard/src/components/dialer/AnalyticsFilters.tsx` — date range (Today, This Week, This Month, Custom), Team, Rep, List, Account, Call type dropdowns
- [ ] T089 [P] [US9] Create SavedViewsDropdown component in `admin-dashboard/src/components/dialer/SavedViewsDropdown.tsx` — saved views list, "Save current view" action, delete view
- [ ] T090 [P] [US9] Create WhenToCallHeatmap component in `admin-dashboard/src/components/dialer/WhenToCallHeatmap.tsx` — 7x24 grid (day-of-week x hour), color intensity by connect rate
- [ ] T091 [P] [US9] Create ObjectionsTable component in `admin-dashboard/src/components/dialer/ObjectionsTable.tsx` — placeholder table for objection patterns (keyword extraction from transcripts — future NLP integration)
- [ ] T092 [US9] Create dialer analytics page in `admin-dashboard/src/pages/dialer-analytics.tsx` — 5 tabs (Rep Performance, List Performance, Account Performance, Objections, When to Call), AnalyticsFilters, SavedViewsDropdown, "View Call History" link
- [ ] T093 [US9] Add analytics page route to `admin-dashboard/src/router.tsx` — `/dialer-analytics` with admin auth

**Checkpoint**: Full analytics dashboard with filtering, saved views, and per-rep/list/account breakdowns.

---

## Phase 12: User Story 10 — Salesfloor Dashboard / Live Activity Monitor (Priority: P2)

**Goal**: Manager sees real-time BDR activity cards with status, contact info, live timers, Listen/Barge buttons, and Team Pulse aggregate bar.

**Independent Test**: 3 BDRs dial simultaneously, manager sees all 3 cards, status updates within 5s, Listen/Barge works from salesfloor.

- [ ] T094 [US10] Implement salesfloor service in `src/services/dialer/salesfloorService.ts` — getActiveBdrStatuses (query active DialerSessions joined with current CallSession, BDR name, status, contact info, session stats, idle duration), getTeamPulse (aggregate: active BDRs, total dials today, total connects today, avg dial-to-connect %)
- [ ] T095 [US10] Implement salesfloor route in `src/routes/admin/salesfloor.ts` — GET /salesfloor (return BDR cards + team pulse data, single API call for all BDRs)
- [ ] T096 [P] [US10] Create SalesfloorCard component in `admin-dashboard/src/components/dialer/SalesfloorCard.tsx` — BDR name, status badge (On Call/Idle/Paused/Dispositioning/Ringing), contact info (name, company, phone), live call duration counter, session stats (dials, connects, queue remaining), Listen/Barge buttons, idle warning highlight (>5 min)
- [ ] T097 [P] [US10] Create TeamPulseBar component in `admin-dashboard/src/components/dialer/TeamPulseBar.tsx` — fixed top bar: Total Active BDRs, Total Dials Today, Total Connects Today, Avg Dial-to-Connect %
- [ ] T098 [US10] Create salesfloor polling hook in `admin-dashboard/src/hooks/useSalesfloorPolling.ts` — poll GET /salesfloor every 5 seconds, update BDR cards and Team Pulse
- [ ] T099 [US10] Create salesfloor page in `admin-dashboard/src/pages/salesfloor.tsx` — TeamPulseBar (fixed top), scrollable BDR card grid, team/BDR filter, empty state
- [ ] T100 [US10] Add salesfloor page route to `admin-dashboard/src/router.tsx` — `/salesfloor` with admin auth

**Checkpoint**: Real-time salesfloor with live BDR monitoring, coach/barge access, and team metrics.

---

## Phase 13: Polish & Cross-Cutting Concerns

**Purpose**: Edge cases, security hardening, performance, and cleanup

- [ ] T101 [P] Implement call quality monitoring — create `CallQualityIndicator` component in `admin-dashboard/src/components/dialer/CallQualityIndicator.tsx` and `useCallQuality` hook in `admin-dashboard/src/hooks/useCallQuality.ts` (monitor Twilio device warnings for network quality, display indicator in DialerWidget)
- [ ] T102 [P] Implement `NetworkRequirements` component in `admin-dashboard/src/components/dialer/NetworkRequirements.tsx` — display minimum network requirements before session start
- [ ] T103 [P] Implement dialer config routes in `src/routes/admin/dialer-config.ts` — GET /phone-numbers (list pool), POST /phone-numbers (provision from Twilio by area code), POST /phone-numbers/:id/assign (assign to client with isPrimary flag)
- [ ] T104 [P] Implement call quality route in `src/routes/admin/callQuality.ts` — GET /call-quality (aggregate call quality metrics for monitoring)
- [ ] T105 Handle edge cases in `src/services/dialer/dialerEngine.ts` — number not in service (log INVALID_NUMBER, auto-advance), internet drop mid-call (detect via WebRTC, log DROPPED_CALL), all queue exhausted (return null from advanceQueue, show "Queue Complete" in UI), call exceeds 30 min (auto-warn at 25 min, auto-disconnect at 30 min)
- [ ] T106 Implement HubSpot contact refresh in queue routes — POST /sessions/:id/queue/refresh-hubspot (re-sync contact data from HubSpot for all queue contacts, update phone numbers, move to uncallable if no valid phone)
- [ ] T107 [P] Add Twilio circuit breaker to `src/services/dialer/twilioClient.ts` — consistent with existing circuit breaker pattern, trip on consistent API failures, disable dialer, notify admin
- [ ] T108 Run quickstart.md verification checklist — validate Twilio credentials, TwiML App, phone numbers, Deepgram API key, S3 bucket access, CORS, webhook reachability

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies — start immediately
- **Phase 2 (Foundational)**: Depends on Phase 1 — BLOCKS all user stories
- **Phases 3-4 (US1, US2)**: Depend on Phase 2 — US2 depends on US1 (AMD extends dialer engine)
- **Phase 5 (US5)**: Depends on Phase 2 — can run parallel with US1/US2 (CRM sync is independent)
- **Phase 6 (US3)**: Depends on US1 (needs working calls to record)
- **Phase 7 (US4)**: Depends on US1 (needs active calls to monitor)
- **Phase 8 (US6)**: Depends on US1 (extends queue management)
- **Phase 9 (US7)**: Depends on US3 (needs recordings to browse)
- **Phase 10 (US8)**: Depends on US1 (needs disposition flow for callbacks)
- **Phase 11 (US9)**: Depends on US1 (needs CallSession data for analytics)
- **Phase 12 (US10)**: Depends on US1 + US4 (needs active sessions + Listen/Barge)
- **Phase 13 (Polish)**: Depends on all desired user stories being complete

### User Story Dependencies

- **US1 (P1)**: Foundation only — no other story deps
- **US2 (P1)**: US1 (extends dialer engine with AMD)
- **US5 (P1)**: Foundation only — can start parallel with US1
- **US3 (P2)**: US1 (needs connected calls)
- **US4 (P2)**: US1 (needs active conferences)
- **US6 (P2)**: US1 (extends queue)
- **US7 (P2)**: US3 (needs recordings)
- **US8 (P2)**: US1 (extends disposition)
- **US9 (P2)**: US1 (needs call data)
- **US10 (P2)**: US1 + US4 (needs sessions + monitoring)

### Parallel Opportunities

Within Phase 2 (Foundational):
- T009, T010, T011, T012, T013, T014 can all run in parallel (different files)

Within US1:
- T034-T040 frontend components can all run in parallel
- T029-T033 hooks can overlap with components

Within US9:
- T085-T091 analytics components can all run in parallel

Cross-story:
- US5 (HubSpot sync) can be built parallel with US1 (core dialer)
- US9 (analytics) can start once US1 data model is seeded
- US6 (queue management) and US8 (callbacks) can run in parallel

---

## Implementation Strategy

### MVP First (P1 Stories Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL — blocks all stories)
3. Complete Phase 3: US1 — Core Power Dialing
4. Complete Phase 4: US2 — Voicemail Detection
5. Complete Phase 5: US5 — HubSpot Sync
6. **STOP and VALIDATE**: Test full P1 flow end-to-end
7. Deploy to ECS and demo

### Incremental Delivery (P2 Stories)

8. Add US3 (Recording + Transcription) → Deploy
9. Add US4 (Manager Monitoring) → Deploy
10. Add US6 (Queue Management) + US8 (Callbacks) → Deploy
11. Add US7 (Recording Library) → Deploy
12. Add US9 (Analytics) + US10 (Salesfloor) → Deploy
13. Phase 13 (Polish) → Final deploy

---

## Summary

| Metric | Count |
|--------|-------|
| **Total tasks** | 113 |
| **Phase 1 (Setup)** | 5 |
| **Phase 2 (Foundational)** | 10 |
| **US1 — Core Power Dialing** | 28 |
| **US2 — Voicemail Detection** | 4 |
| **US5 — HubSpot Sync** | 5 |
| **US3 — Recording/Transcription** | 6 |
| **US4 — Manager Monitoring** | 5 |
| **US6 — Queue Management** | 5 |
| **US7 — Recording Library** | 6 |
| **US8 — Callbacks & Missed Calls** | 11 |
| **US9 — Analytics** | 13 |
| **US10 — Salesfloor** | 7 |
| **Polish** | 8 |
| **Parallel opportunities** | 40+ tasks marked [P] |
| **MVP scope** | Phases 1-5 (US1 + US2 + US5) = 52 tasks |
