# Implementation Plan: Power Dialer

**Branch**: `22-power-dialer` | **Date**: 2026-03-12 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/22-power-dialer/spec.md`

## Summary

Build an Orum-level browser-based power dialer into the admin dashboard. Uses Twilio Programmable Voice (WebRTC via Twilio Client SDK) for outbound calls through Twilio Conference rooms, Twilio AMD for voicemail detection, Deepgram for post-call transcription, and the existing HubSpot integration for CRM sync. Includes local presence dialing, full TCPA/consent compliance, role-based call recording library with manager coaching workflows, and a disposition-driven auto-advance queue.

## Technical Context

**Language/Version**: TypeScript 5.9.3 (Node.js 22, backend) + TypeScript (React 19, frontend)
**Primary Dependencies**:
- Backend: @slack/bolt 4.6.0, Express 5.2.1, Prisma 7.4.2, BullMQ 5.70.1, ioredis 5.10.0
- New: `twilio` (Twilio Node SDK), `@deepgram/sdk` (Deepgram Node SDK)
- Frontend: React 19.2.0, Vite 7.3.1, @xyflow/react 12.10.1, Radix UI, Tailwind CSS 4.2.1
- New: `@twilio/voice-sdk` (Twilio Client JS for WebRTC browser calling)
**Storage**: PostgreSQL via Prisma ORM (AWS RDS), Redis via ioredis (AWS ElastiCache), S3 (recordings backup)
**Testing**: Vitest (existing), manual testing against deployed ECS service
**Target Platform**: Web (admin dashboard SPA on CloudFront + S3, backend on ECS Fargate)
**Project Type**: Web application (monorepo: `src/` backend + `admin-dashboard/` frontend)
**Performance Goals**: <5s auto-advance between calls, <3s manager join latency, 40+ dials/hour, 10+ concurrent BDRs
**Constraints**: Single ECS task (Socket Mode), single platform Twilio account, no local development
**Scale/Scope**: ~10 BDRs concurrent, ~500 calls/day initial, ~50 phone numbers in pool

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

| Principle | Status | Notes |
|-----------|--------|-------|
| I. CRM-First Architecture | PASS | Dialer integrates INTO CRM via HubSpot activity sync. Calls are campaign-driven. |
| II. Plugin Ecosystem | DEVIATION | Building as core service modules (`src/services/dialer/`, `src/routes/dialer/`), not as a plugin under `src/plugins/`. Justified: the dialer is tightly coupled to campaign engine, BDR auth, and queue system. Plugin isolation would create unnecessary indirection. Constitution lists "Calling (phone/dialer integration)" as a Feature Plugin, but the existing codebase has no plugin system implemented — all features are direct service modules. |
| III. API-First Development | PASS | API contracts defined before UI. REST endpoints under `/api/v1/dialer/`. |
| IV. Client Isolation | PASS | All dialer data scoped by `clientId`. Phone numbers assigned per client. Queue and recordings filtered by BDR→Client relationship. |
| V. SOC 2 / Audit Logging | PASS | Compliance events logged (FR-033). All call sessions tracked. Recording access logged. |
| VI. Cost Tracking | PASS | FR-027 tracks Twilio costs per call per client. Deepgram costs tracked similarly. |
| VII. Deviation Prevention | PASS | This plan documents all deviations. |
| VIII. Integration-Centric | PASS | Orchestrates Twilio (telephony) + Deepgram (transcription) + HubSpot (CRM sync). |
| IX. Sequence-Driven Workflows | PASS | Dialer queue populated from campaign phone steps. Disposition advances contact via existing `advanceContact()`. |
| X. Enrichment as Foundation | PASS | Phone numbers sourced from Apollo enrichment. DNC scrubbing via enrichment pipeline. |
| XIV. UI/UX First Design | PASS | Dialer widget, recording library, and queue management designed for BDR productivity. |
| XV. AWS-Only Infrastructure | PASS | All runs on ECS. No local testing. Twilio webhooks point to ALB. |
| XIX. GitHub Account Policy | PASS | All operations use `developerlabsai`. |

## Complexity Tracking

| Deviation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|--------------------------------------|
| Core service module instead of plugin | Dialer is tightly coupled to campaign engine (`advanceContact`), BDR auth (`bdrAuth`), activity tracking (`trackActivity`), and queue system (BullMQ). Plugin isolation would require re-exporting all these as plugin context APIs. | No plugin system exists in codebase — all 14 completed features are direct service modules. Building plugin infrastructure for one feature adds complexity without benefit. |

## Project Structure

### Documentation (this feature)

```text
specs/22-power-dialer/
├── plan.md              # This file
├── spec.md              # Feature specification (complete)
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output (Twilio + Deepgram setup guide)
├── contracts/           # Phase 1 output (OpenAPI contracts)
└── tasks.md             # Phase 2 output (/speckit.tasks)
```

### Source Code (repository root)

```text
# Backend (src/)
src/
├── services/
│   └── dialer/
│       ├── twilioClient.ts          # Twilio SDK wrapper, token generation
│       ├── dialerEngine.ts          # Core power dialer logic (queue advance, AMD handling, timers)
│       ├── conferenceManager.ts     # Twilio Conference room lifecycle (create, join coach, barge)
│       ├── recordingManager.ts      # Recording lifecycle (start, stop, fetch, store to S3)
│       ├── transcriptionService.ts  # Deepgram integration (submit recording, process callback)
│       ├── complianceEngine.ts      # TCPA windows, consent disclosure, opt-out tracking
│       ├── localPresence.ts         # Area code matching for caller ID selection
│       ├── dispositionService.ts    # Disposition processing + CRM sync trigger
│       ├── dialerCostTracker.ts     # Twilio + Deepgram cost attribution per client
│       ├── callbackService.ts       # Scheduled callback CRUD, due-check polling, missed detection
│       ├── sessionManager.ts        # Session lifecycle (start, pause, resume, end, inactivity timeout)
│       ├── uncallableManager.ts     # DNC/removed/invalid contact filtering, re-add logic
│       ├── analyticsService.ts      # Analytics query builder (rep, list, account performance)
│       └── salesfloorService.ts     # Live BDR status aggregation for salesfloor dashboard
├── routes/
│   ├── dialer/
│   │   ├── index.ts                 # Route mounting with bdrAuth middleware
│   │   ├── sessions.ts              # Start/stop/pause/resume dialer session, inactivity heartbeat
│   │   ├── queue.ts                 # Queue CRUD (get, skip, pause, resume, reorder, uncallable section)
│   │   ├── calls.ts                 # Call controls (dial, hangup, mute, hold)
│   │   ├── disposition.ts           # Submit disposition + notes + callback scheduling
│   │   ├── callbacks.ts             # Callback CRUD (list, reschedule, mark complete/missed)
│   │   ├── token.ts                 # Generate Twilio Client capability token
│   │   └── device.ts               # Audio device preferences (save/load mic/speaker selection)
│   ├── admin/
│   │   ├── recordings.ts            # Recording library (list, filter, playback URLs)
│   │   ├── recording-reviews.ts     # Favorite, flag, coaching notes
│   │   ├── active-calls.ts          # Live call monitoring dashboard
│   │   ├── dialer-config.ts         # Phone number pool management, client assignments
│   │   ├── analytics.ts             # Dialer analytics (rep, list, account, objections, when-to-call)
│   │   ├── saved-views.ts           # Analytics saved views CRUD
│   │   ├── salesfloor.ts            # Salesfloor dashboard (live BDR status cards, team pulse)
│   │   └── uncallable.ts            # Admin DNC management (view, add, remove DNC entries)
│   └── webhooks/
│       ├── twilio.ts                # Twilio status callbacks (call events, AMD, recording ready)
│       └── deepgram.ts              # Deepgram transcription complete callback
├── data/
│   └── compliance/
│       ├── two-party-consent-states.ts  # US state consent rules
│       └── area-code-timezone-map.ts    # Area code → timezone mapping for TCPA
└── types/
    └── dialer.ts                    # Dialer-specific TypeScript interfaces

# Frontend (admin-dashboard/src/)
admin-dashboard/src/
├── pages/
│   ├── bdr/
│   │   └── dialer.tsx               # Power dialer page (full-screen dialer widget)
│   ├── recordings.tsx               # Call Recording Library page
│   ├── recording-detail.tsx         # Single recording detail (playback + transcript + notes)
│   ├── dialer-analytics.tsx         # Dialer Analytics page (5 tabs: rep, list, account, objections, when-to-call)
│   └── salesfloor.tsx               # Salesfloor Dashboard page (live BDR activity cards + team pulse)
├── components/
│   └── dialer/
│       ├── DialerWidget.tsx         # Main dialer UI (call controls, timer, contact info)
│       ├── DialerQueue.tsx          # Call queue sidebar (callable + uncallable sections)
│       ├── UncallableSection.tsx    # Uncallable contacts list (DNC, removed, invalid) with re-add
│       ├── DispositionModal.tsx     # Post-call disposition form + callback scheduling
│       ├── CallbackScheduler.tsx    # Date/time picker for scheduling callbacks
│       ├── CallbackReminder.tsx     # Toast notification for due callbacks
│       ├── CallTimer.tsx            # Configurable connected call timer display (default 45s)
│       ├── SessionControls.tsx      # Start/End/Pause session + audio device picker
│       ├── AudioDevicePicker.tsx    # Mic/speaker selection with test functionality
│       ├── InactivityWarning.tsx    # 5-min warning toast before auto-session-end
│       ├── ActiveCallCard.tsx       # Manager view of an active call (listen/barge buttons)
│       ├── RecordingPlayer.tsx      # Audio player with speed controls + transcript sync
│       ├── CoachingNotes.tsx        # Manager coaching notes panel
│       ├── SalesfloorCard.tsx       # Single BDR card for salesfloor (status, contact, stats)
│       ├── TeamPulseBar.tsx         # Aggregate KPIs bar (active BDRs, dials, connects, %)
│       ├── AnalyticsKPICards.tsx    # KPI summary cards (dials, callbacks, connects, etc.)
│       ├── RepPerformanceTable.tsx  # Per-BDR metrics table
│       ├── ListPerformanceTable.tsx # Per-list metrics table with disposition breakdown
│       ├── AnalyticsFilters.tsx     # Filter panel (date range, team, rep, list, account, call type)
│       └── SavedViewsDropdown.tsx   # Saved analytics views dropdown
├── services/
│   ├── dialer-api.ts               # Dialer session/queue/call API client
│   ├── recordings-api.ts           # Recording library API client
│   ├── callbacks-api.ts            # Callback scheduling API client
│   ├── analytics-api.ts            # Dialer analytics API client
│   ├── salesfloor-api.ts           # Salesfloor dashboard API client
│   └── twilio-device.ts            # Twilio Voice SDK device management (WebRTC)
└── hooks/
    ├── useDialerSession.ts          # Dialer session state management
    ├── useTwilioDevice.ts           # Twilio Device lifecycle hook
    ├── useCallTimer.ts              # Configurable connected-call timer hook (default 45s)
    ├── useCallbackReminders.ts      # Polling hook for due callback notifications
    ├── useInactivityTimeout.ts      # 30-min inactivity detection + 5-min warning
    ├── useAudioDevices.ts           # Browser media device enumeration + selection
    └── useSalesfloorPolling.ts      # 5-second polling for salesfloor BDR statuses
```

**Structure Decision**: Follows the established pattern of the existing codebase — backend services in `src/services/dialer/`, API routes in `src/routes/dialer/` and `src/routes/admin/`, webhooks in `src/routes/webhooks/`, frontend pages in `admin-dashboard/src/pages/`, components in `admin-dashboard/src/components/dialer/`. No new top-level directories introduced. New features (callbacks, analytics, salesfloor, session/uncallable management) are added as additional files within the existing directory structure.
