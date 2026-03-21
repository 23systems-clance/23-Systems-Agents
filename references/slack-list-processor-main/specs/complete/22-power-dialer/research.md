# Research: Power Dialer

**Feature**: 22-power-dialer | **Date**: 2026-03-12

## Decision 1: Telephony Provider

**Decision**: Twilio Programmable Voice
**Rationale**: Industry standard for sales dialers. Provides WebRTC browser calling (Twilio Client SDK), AMD, conference rooms for coach/barge, call recording, and local number provisioning — all via API. Existing codebase already uses Twilio-compatible patterns (webhooks, status callbacks).
**Alternatives considered**:
- Vonage/Nexmo: Fewer features for conference coaching mode
- Plivo: Cheaper but less mature AMD and no native conference coaching
- Telnyx: Good pricing but smaller ecosystem and community

## Decision 2: Browser Calling Method

**Decision**: Twilio Client SDK (`@twilio/voice-sdk`) with WebRTC
**Rationale**: Native browser calling without any phone hardware. BDR connects via WebRTC Device, calls route through Twilio Conference rooms. Server generates short-lived JWT tokens with VoiceGrant.
**Key technical details**:
- Server generates `AccessToken` with `VoiceGrant` (outgoingApplicationSid = TwiML App SID)
- Token TTL: 1 hour (refresh via `/api/v1/dialer/token`)
- Browser: `new Device(token)` → `device.connect({ params: { To, SessionId } })`
- TwiML App Voice Request URL receives params and returns `<Conference>` TwiML

## Decision 3: Call Architecture (Conference Rooms)

**Decision**: All calls use Twilio Conference rooms, not direct `<Dial><Number>` calls
**Rationale**: Conference rooms enable manager coach/barge, recording on the conference (not per-leg), and future multi-party scenarios. Every call creates a unique conference room.
**Key technical details**:
- BDR joins conference via WebRTC (TwiML App → `<Conference>`)
- Contact joins same conference via outbound PSTN call
- Manager joins via API: `POST /Conferences/{sid}/Participants` with `Coaching=true`
- Barge-in: Update participant to set `Coaching=false, Muted=false`
- `endConferenceOnExit=true` on BDR leg → conference ends when BDR hangs up

## Decision 4: Answering Machine Detection

**Decision**: Async AMD (`MachineDetection: 'Enable'`, `AsyncAmd: true`)
**Rationale**: Async AMD connects the call immediately while running detection in background. No 4-7 second delay for humans (sync AMD causes awkward silence). Machine results delivered via `AsyncAmdStatusCallback`.
**Key technical details**:
- Set on the outbound PSTN leg (contact's call), not the BDR's WebRTC leg
- Callback receives `AnsweredBy`: `human` | `machine_start` | `machine_end_beep` | `fax` | `unknown`
- On `machine_start` → terminate call via `client.calls(callSid).update({status: 'completed'})`
- On `unknown` → treat as human (let BDR hear and decide)
- Accuracy: ~85-90% overall, ~94% for human detection, ~80-85% for machine detection
- Cost: $0.0075 per AMD detection

## Decision 5: Transcription Provider

**Decision**: Deepgram (Nova-2 model, pre-recorded API with webhook callback)
**Rationale**: Fastest and cheapest at $0.0043/min. Nova-2 model has strong phone audio accuracy. Speaker diarization included at no extra cost. Webhook callback mode avoids polling.
**Key technical details**:
- Endpoint: `POST https://api.deepgram.com/v1/listen`
- Query params: `diarize=true&utterances=true&punctuate=true&model=nova-2&callback={webhookUrl}`
- Submit S3 pre-signed URL of recording (not Twilio URL directly)
- Callback delivers full JSON with word-level timestamps and speaker labels
- Processing time: 10-30 seconds for typical 3-minute call
- Speaker mapping: First-speaker heuristic (BDR speaks first on outbound calls) ~85-90% accurate

## Decision 6: Recording Storage

**Decision**: S3 with tiered lifecycle (Standard → Intelligent Tiering → Glacier)
**Rationale**: Twilio recording URLs require auth and incur ongoing storage costs ($0.0025/min/month). Copy to S3 immediately, delete from Twilio. S3 gives us control over lifecycle, pre-signed URLs for CRM embedding, and cost optimization.
**Key technical details**:
- S3 key pattern: `recordings/{clientId}/{year}/{month}/{day}/call-{callSid}.wav`
- Pre-signed URLs: 24-hour expiry for admin dashboard playback, 30-day for CRM embedding
- Cache pre-signed URLs in Redis (refresh 1 day before expiry)
- Lifecycle: 0-30 days Standard, 30-90 days Intelligent Tiering, 90-365 days Glacier IR, 365+ Deep Archive
- Encryption: AES256 (server-side)
- CORS: Allow admin dashboard and HubSpot origins

## Decision 7: CRM Recording Delivery

**Decision**: S3 pre-signed URL in `hs_call_recording_url` + formatted transcript in `hs_call_body`
**Rationale**: HubSpot renders native audio player for `hs_call_recording_url`. Pre-signed S3 URLs work (HubSpot caches audio after first access). Transcript in `hs_call_body` (65,536 char limit) with speaker labels and timestamps.
**Key technical details**:
- Create HubSpot engagement immediately after disposition (with recording URL, without transcript)
- Deepgram webhook fires 10-30s later → update engagement with `hs_call_body` via PATCH
- Transcript format: `[0:15] BDR (Sarah): Hello, this is Sarah from...`
- Truncation: If >60,000 chars, keep first/last 20 utterances + "View full transcript" link
- Store `hubspotEngagementId` in `HubSpotEngagementMapping` for deferred update
- CRM-agnostic interface: `{ duration, disposition, recordingUrl, transcript, notes, bdrName }`

## Decision 8: Local Presence Strategy

**Decision**: Pre-provision numbers across top US area codes, match at call time
**Rationale**: Local numbers get 2-3x higher pickup rates. Provision 50-100 numbers covering top metro area codes. At call time, match contact's area code → pool number. Fallback to client's primary number.
**Key technical details**:
- Twilio API: `client.availablePhoneNumbers('US').local.list({areaCode: '415'})`
- Purchase: `client.incomingPhoneNumbers.create({phoneNumber: '+14155551234'})`
- Cost: $1.00-1.15/month per number
- Matching: Extract contact area code → query `TwilioPhoneNumber` table → match by `areaCode`
- Fallback chain: exact area code → same state → client primary number
- A2P/10DLC registration required for business calling (2-4 week vetting)

## Decision 9: Compliance Architecture

**Decision**: Server-side compliance engine with pre-call checks and audit logging
**Rationale**: TCPA and consent rules must be enforced server-side (cannot trust client). Check before every dial: TCPA window (8am-9pm contact local time), opt-out list, two-party consent state.
**Key technical details**:
- TCPA window: Area code → timezone mapping (static data file), check local time before dial
- Two-party consent: 11 states (CA, CT, FL, IL, MD, MA, MI, MT, NH, PA, WA)
- Consent disclosure: TwiML `<Say>` before conference connect for two-party states
- Opt-out: Global `ContactOptOut` table keyed by phone number, checked before queue insertion AND before dial
- All compliance events logged to `ComplianceLog` for SOC 2 audit

## Decision 10: Twilio Cost Summary

| Component | Cost | Unit |
|-----------|------|------|
| Outbound call | $0.013 | per minute |
| Recording | $0.0025 | per minute (storage/month) |
| AMD detection | $0.0075 | per detection |
| Phone number | $1.00-1.15 | per month per number |
| Conference | Free | (included in call cost) |
| **Total per 3-min connected call** | **~$0.055** | (call + AMD + recording) |
| **Total per voicemail (10s)** | **~$0.010** | (call + AMD, no recording) |
| Deepgram Nova-2 | $0.0043 | per minute |
| **All-in per connected call** | **~$0.068** | (Twilio + Deepgram for 3-min call) |
