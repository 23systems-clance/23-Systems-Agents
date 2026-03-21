# Data Model: Power Dialer

**Feature**: 22-power-dialer | **Date**: 2026-03-12

## New Enums

```prisma
enum CallSessionStatus {
  QUEUED          // In queue, not yet dialed
  RINGING         // Twilio is dialing the number
  CONNECTED       // Human answered (AMD confirmed or timer running)
  VOICEMAIL       // AMD detected answering machine
  COMPLETED       // Call ended, disposition submitted
  FAILED          // Twilio error (invalid number, network failure)
  SKIPPED         // BDR skipped this contact
  NO_ANSWER       // Rang but nobody picked up (timeout)
}

enum AmdResult {
  HUMAN           // AMD detected human voice
  MACHINE_START   // AMD detected answering machine (start of greeting)
  MACHINE_END     // AMD detected end of answering machine greeting
  FAX             // Fax tone detected
  UNKNOWN         // AMD could not determine (treated as human)
}

enum DispositionType {
  CONNECTED_INTERESTED
  CONNECTED_NOT_INTERESTED
  CONNECTED_CALLBACK_REQUESTED
  VOICEMAIL_AUTO_SKIPPED
  VOICEMAIL_LEFT_MESSAGE
  NO_ANSWER
  WRONG_NUMBER
  DO_NOT_CALL
  INVALID_NUMBER
  DROPPED_CALL
}

enum TranscriptionStatus {
  PENDING         // Recording complete, transcription not yet submitted
  PROCESSING      // Submitted to Deepgram, awaiting result
  COMPLETED       // Transcript received and stored
  FAILED          // Transcription error (will retry via BullMQ)
}

enum RecordingReviewStatus {
  NONE            // No manager review
  FLAGGED         // Manager flagged for review
  REVIEWED        // Manager has reviewed
}

enum ComplianceEventType {
  CONSENT_PLAYED        // Two-party consent disclosure played
  TCPA_WINDOW_BLOCKED   // Call blocked due to time-of-day rules
  OPT_OUT_RECORDED      // Contact requested DNC
  OPT_OUT_BLOCKED       // Contact was in opt-out list, call prevented
}

enum DialerSessionStatus {
  ACTIVE              // Session is running, BDR is dialing
  PAUSED              // BDR paused the session
  COMPLETED           // Session ended (manual or auto-end)
}

enum QueueItemStatus {
  PENDING             // Waiting to be dialed
  DIALING             // Currently being dialed
  COMPLETED           // Call finished
  SKIPPED             // BDR manually skipped
}
```

## New Models

### DialerSession

Represents a BDR's active dialing session. One session = one continuous dialing run.

```prisma
model DialerSession {
  id              String              @id @default(uuid())
  bdrId           String              // FK → Bdr
  clientId        String              // FK → ManagedClient (tenant isolation)
  campaignId      String?             // FK → Campaign (if queue sourced from campaign)
  status          DialerSessionStatus @default(ACTIVE)
  totalDialed     Int                 @default(0)
  totalConnected  Int                 @default(0)
  totalVoicemail  Int                 @default(0)
  totalNoAnswer   Int                 @default(0)
  startedAt       DateTime            @default(now())
  pausedAt        DateTime?
  completedAt     DateTime?
  createdAt       DateTime            @default(now())
  updatedAt       DateTime            @updatedAt

  bdr             Bdr                 @relation(fields: [bdrId], references: [id])
  client          ManagedClient       @relation(fields: [clientId], references: [id])
  campaign        Campaign?           @relation(fields: [campaignId], references: [id])
  callSessions    CallSession[]
  queueItems      DialerQueueItem[]

  @@index([bdrId, status])
  @@index([clientId])
}
```

### CallSession

Represents a single call attempt (one row per dial).

```prisma
model CallSession {
  id                    String              @id @default(uuid())
  dialerSessionId       String              // FK → DialerSession
  bdrId                 String              // FK → Bdr
  clientId              String              // FK → ManagedClient (tenant isolation)
  campaignContactId     String?             // FK → CampaignContact (if from campaign)
  stepExecutionId       String?             // FK → CampaignContactStepExecution (if from campaign step)

  // Contact info (denormalized for call history)
  contactName           String
  contactEmail          String?
  contactPhone          String              // The number dialed
  companyName           String?
  jobTitle              String?

  // Twilio metadata
  twilioCallSid         String?             @unique
  twilioConferenceSid   String?
  callerIdNumber        String?             // Outbound number used (local presence)

  // Call state
  status                CallSessionStatus   @default(QUEUED)
  amdResult             AmdResult?
  consentPlayed         Boolean             @default(false) // Two-party consent disclosure

  // Timing
  dialedAt              DateTime?
  answeredAt            DateTime?           // Human answered
  connectedAt           DateTime?           // Connected-call timer elapsed (default 45s, configurable) → confirmed connected
  endedAt               DateTime?
  durationSeconds       Int?                // Total call duration
  talkTimeSeconds       Int?                // Talk time after connection confirmed

  // Disposition
  disposition           DispositionType?
  dispositionNotes      String?             @db.Text
  dispositionAt         DateTime?

  // CRM sync (M6: for deferred transcript backfill)
  hubspotEngagementId   String?             // HubSpot engagement ID for PATCH on transcript ready

  // Cost tracking
  twilioCostUsd         Decimal?            @db.Decimal(10, 6)
  deepgramCostUsd       Decimal?            @db.Decimal(10, 6)

  createdAt             DateTime            @default(now())
  updatedAt             DateTime            @updatedAt

  dialerSession         DialerSession       @relation(fields: [dialerSessionId], references: [id])
  bdr                   Bdr                 @relation(fields: [bdrId], references: [id])
  client                ManagedClient       @relation(fields: [clientId], references: [id])
  campaignContact       CampaignContact?    @relation(fields: [campaignContactId], references: [id])
  stepExecution         CampaignContactStepExecution? @relation(fields: [stepExecutionId], references: [id])
  recording             CallRecording?

  @@index([dialerSessionId])
  @@index([bdrId, createdAt])
  @@index([clientId, createdAt])
  @@index([twilioCallSid])
  @@index([campaignContactId])
  @@index([status])
}
```

### CallRecording

Recording and transcript for a connected call.

```prisma
model CallRecording {
  id                    String                @id @default(uuid())
  callSessionId         String                @unique // FK → CallSession (1:1)
  clientId              String                // FK → ManagedClient (tenant isolation)
  bdrId                 String                // FK → Bdr (for access control filtering)

  // Twilio recording
  twilioRecordingSid    String?               @unique
  twilioRecordingUrl    String?               @db.Text // Original Twilio URL (temporary)

  // S3 storage (permanent)
  s3Key                 String?               // S3 object key (e.g., recordings/{clientId}/{date}/{callSessionId}.wav)
  s3Bucket              String?               // S3 bucket name
  durationSeconds       Int?
  fileSizeBytes         Int?

  // Transcription
  transcriptionStatus   TranscriptionStatus   @default(PENDING)
  transcript            String?               @db.Text  // Full transcript (speaker-labeled, timestamped)
  transcriptJson        Json?                 // Structured transcript (Deepgram response with word-level timestamps)
  deepgramRequestId     String?
  transcribedAt         DateTime?

  // Manager review / recording library
  isFavorited           Boolean               @default(false)
  favoritedById         String?               // Admin/manager who favorited
  reviewStatus          RecordingReviewStatus  @default(NONE)
  reviewedById          String?               // Manager who reviewed
  reviewedAt            DateTime?

  createdAt             DateTime              @default(now())
  updatedAt             DateTime              @updatedAt

  callSession           CallSession           @relation(fields: [callSessionId], references: [id])
  client                ManagedClient         @relation(fields: [clientId], references: [id])
  bdr                   Bdr                   @relation(fields: [bdrId], references: [id])
  coachingNotes         CoachingNote[]

  @@index([clientId, createdAt])
  @@index([bdrId, createdAt])
  @@index([isFavorited])
  @@index([reviewStatus])
  @@index([transcriptionStatus])
}
```

### CoachingNote

Manager coaching feedback on a recording.

```prisma
model CoachingNote {
  id                String          @id @default(uuid())
  recordingId       String          // FK → CallRecording
  authorId          String          // Admin user who wrote the note
  authorName        String          // Denormalized for display
  content           String          @db.Text
  timestampSeconds  Int?            // Optional: specific timestamp in the recording this note refers to
  createdAt         DateTime        @default(now())
  updatedAt         DateTime        @updatedAt

  recording         CallRecording   @relation(fields: [recordingId], references: [id], onDelete: Cascade)

  @@index([recordingId])
}
```

### DialerQueueItem

Individual contact in a BDR's dialer queue. Server-side state for queue persistence.

```prisma
model DialerQueueItem {
  id                    String              @id @default(uuid())
  dialerSessionId       String              // FK → DialerSession
  campaignContactId     String?             // FK → CampaignContact (if from campaign)
  stepExecutionId       String?             // FK → CampaignContactStepExecution

  // Contact info (denormalized for queue display)
  contactName           String
  contactEmail          String?
  contactPhone          String
  companyName           String?
  jobTitle              String?
  hubspotContactId      String?             // For CRM deep link

  // Queue state
  position              Int                 // Order in queue (1-based)
  status                QueueItemStatus     @default(PENDING)
  callSessionId         String?             // FK → CallSession (set when dialed)

  // Compliance pre-check
  tcpaEligible          Boolean             @default(true) // False if outside TCPA window
  optedOut              Boolean             @default(false) // True if in opt-out list
  lastCalledAt          DateTime?           // Last time this contact was called (cooldown check)

  createdAt             DateTime            @default(now())
  updatedAt             DateTime            @updatedAt

  dialerSession         DialerSession       @relation(fields: [dialerSessionId], references: [id], onDelete: Cascade)
  campaignContact       CampaignContact?    @relation(fields: [campaignContactId], references: [id])
  callSession           CallSession?        @relation(fields: [callSessionId], references: [id])

  @@index([dialerSessionId, position])
  @@index([dialerSessionId, status])
  @@unique([dialerSessionId, campaignContactId]) // Prevent duplicate contacts in same session
}
```

### TwilioPhoneNumber

Phone number pool managed by the platform.

```prisma
model TwilioPhoneNumber {
  id              String          @id @default(uuid())
  phoneNumber     String          @unique // E.164 format (+1XXXXXXXXXX)
  twilioSid       String          @unique // Twilio phone number SID
  areaCode        String          // 3-digit area code
  state           String?         // US state (for consent rules)
  clientId        String?         // FK → ManagedClient (null = unassigned pool)
  isPrimary       Boolean         @default(false) // Primary number for client
  isActive        Boolean         @default(true)
  provisionedAt   DateTime        @default(now())
  createdAt       DateTime        @default(now())

  client          ManagedClient?  @relation(fields: [clientId], references: [id])

  @@index([areaCode])
  @@index([clientId])
  @@index([isActive, clientId])
}
```

### ContactOptOut

Global opt-out tracking for DNC compliance.

```prisma
model ContactOptOut {
  id              String          @id @default(uuid())
  phoneNumber     String          // E.164 format (primary lookup key)
  contactEmail    String?         // Secondary identifier
  contactName     String?
  reason          String?         // Why they opted out
  source          String          // "dialer-disposition" | "manual" | "import"
  recordedById    String?         // BDR or admin who recorded the opt-out
  clientId        String?         // FK → ManagedClient (null = global opt-out)
  createdAt       DateTime        @default(now())

  client          ManagedClient?  @relation(fields: [clientId], references: [id])

  @@unique([phoneNumber])         // One opt-out per phone number
  @@index([phoneNumber])
  @@index([contactEmail])
}
```

### ComplianceLog

Audit trail for all compliance-related events.

```prisma
model ComplianceLog {
  id              String                @id @default(uuid())
  callSessionId   String?               // FK → CallSession
  eventType       ComplianceEventType
  phoneNumber     String?
  contactState    String?               // US state involved
  details         String?               @db.Text // JSON or text details
  clientId        String                // FK → ManagedClient
  bdrId           String?               // FK → Bdr
  createdAt       DateTime              @default(now())

  client          ManagedClient         @relation(fields: [clientId], references: [id])
  bdr             Bdr?                  @relation(fields: [bdrId], references: [id])

  @@index([clientId, createdAt])
  @@index([callSessionId])
  @@index([eventType])
}
```

### ScheduledCallback

Callback scheduled by a BDR during disposition. Drives reminder notifications and callback metrics.

```prisma
model ScheduledCallback {
  id                    String          @id @default(uuid())
  callSessionId         String          // FK → CallSession (the call that triggered the callback)
  bdrId                 String          // FK → Bdr
  clientId              String          // FK → ManagedClient (tenant isolation)
  campaignContactId     String?         // FK → CampaignContact

  // Contact info (denormalized)
  contactName           String
  contactPhone          String
  companyName           String?

  // Schedule
  scheduledAt           DateTime        // When to call back
  notes                 String?         @db.Text // BDR notes about what to discuss
  status                CallbackStatus  @default(PENDING)
  completedAt           DateTime?
  completedCallSessionId String?        // FK → CallSession (the callback call)
  missedAt              DateTime?

  createdAt             DateTime        @default(now())
  updatedAt             DateTime        @updatedAt

  callSession           CallSession     @relation("OriginalCall", fields: [callSessionId], references: [id])
  completedCallSession  CallSession?    @relation("CallbackCall", fields: [completedCallSessionId], references: [id])
  bdr                   Bdr             @relation(fields: [bdrId], references: [id])
  client                ManagedClient   @relation(fields: [clientId], references: [id])

  @@index([bdrId, status])
  @@index([bdrId, scheduledAt])
  @@index([clientId, status])
  @@index([status, scheduledAt]) // For polling due callbacks
}
```

### UncallableContact

Tracks contacts who are blocked from dialing across all campaigns for a client.

```prisma
model UncallableContact {
  id              String          @id @default(uuid())
  clientId        String          // FK → ManagedClient (tenant isolation)
  contactPhone    String          // Primary key for matching
  contactEmail    String?
  contactName     String?
  companyName     String?
  reason          UncallableReason // DNC | REMOVED | INVALID_NUMBER | NO_PHONE
  source          String          // "disposition" | "manual" | "hubspot-refresh" | "auto-detection"
  canReAdd        Boolean         @default(false) // True for REMOVED, false for DNC
  removedById     String?         // BDR or admin who initiated removal
  reAddedAt       DateTime?       // If re-added, when
  reAddedById     String?         // Who re-added
  createdAt       DateTime        @default(now())
  updatedAt       DateTime        @updatedAt

  client          ManagedClient   @relation(fields: [clientId], references: [id])

  @@unique([clientId, contactPhone]) // One entry per phone per client
  @@index([clientId, reason])
  @@index([contactPhone])
}
```

### AnalyticsSavedView

Saved filter configuration for the analytics dashboard.

```prisma
model AnalyticsSavedView {
  id              String          @id @default(uuid())
  userId          String          // Admin/manager who created the view
  clientId        String          // FK → ManagedClient (tenant isolation)
  name            String          // Display name
  tab             String          // "rep" | "list" | "account" | "objections" | "when-to-call"
  filters         Json            // { dateRange, teamIds, bdrIds, listIds, accountIds, callTypes, phoneFields }
  isDefault       Boolean         @default(false)
  createdAt       DateTime        @default(now())
  updatedAt       DateTime        @updatedAt

  client          ManagedClient   @relation(fields: [clientId], references: [id])

  @@index([userId, clientId])
}
```

## Relationship Updates to Existing Models

### Bdr (add relations)

```prisma
// Add to existing Bdr model:
dialerSessions    DialerSession[]
callSessions      CallSession[]
callRecordings    CallRecording[]
scheduledCallbacks ScheduledCallback[]
complianceLogs    ComplianceLog[]
```

### ManagedClient (add fields + relations)

```prisma
// Add to existing ManagedClient model:

// Dialer configuration (H4: per-client connected call timer)
connectedCallTimerSeconds Int     @default(45) // 15-120s, configurable per client

// Relations
dialerSessions        DialerSession[]
callSessions          CallSession[]
callRecordings        CallRecording[]
twilioPhoneNumbers    TwilioPhoneNumber[]
contactOptOuts        ContactOptOut[]
complianceLogs        ComplianceLog[]
uncallableContacts    UncallableContact[]
analyticsSavedViews   AnalyticsSavedView[]
scheduledCallbacks    ScheduledCallback[]
```

### Campaign (add relation)

```prisma
// Add to existing Campaign model:
dialerSessions    DialerSession[]
```

### CampaignContact (add relations)

```prisma
// Add to existing CampaignContact model:
dialerCallSessions  CallSession[]
dialerQueueItems    DialerQueueItem[]
```

### CampaignContactStepExecution (add relations)

```prisma
// Add to existing CampaignContactStepExecution model:
dialerCallSession   CallSession?
dialerQueueItem     DialerQueueItem?
```

### New Enums (additions)

```prisma
enum CallbackStatus {
  PENDING         // Scheduled, not yet due
  COMPLETED       // Callback was made
  MISSED          // 30 min past scheduled time, not completed
}

enum UncallableReason {
  DNC             // Do Not Call — permanent, admin-only removal
  REMOVED         // Removed prospect — can be re-added by BDR
  INVALID_NUMBER  // Number not in service
  NO_PHONE        // No valid phone after HubSpot refresh
}
```

## State Transitions

### ScheduledCallback Lifecycle

```
PENDING → COMPLETED (BDR made the callback call)
PENDING → MISSED (30 min past scheduled time, no call made)
MISSED → COMPLETED (BDR later completed the overdue callback)
```

### UncallableContact Lifecycle

```
[added] → DNC (permanent, no self-service removal)
[added] → REMOVED (can be re-added by BDR via "Re-add Prospect")
REMOVED → [deleted] (re-added to callable queue)
[added] → INVALID_NUMBER (auto-detected by Twilio error)
[added] → NO_PHONE (HubSpot refresh found no valid phone)
```

### CallSession Lifecycle

```
QUEUED → RINGING → CONNECTED → COMPLETED (human answered, disposition submitted)
QUEUED → RINGING → VOICEMAIL → COMPLETED (AMD detected, auto-skipped)
QUEUED → RINGING → NO_ANSWER → COMPLETED (ring timeout, no pickup)
QUEUED → RINGING → FAILED (Twilio error)
QUEUED → SKIPPED (BDR manually skipped)
```

### DialerQueueItem Lifecycle

```
PENDING → DIALING → COMPLETED (call finished)
PENDING → SKIPPED (BDR skipped)
PENDING → [removed] (queue cleared)
```

### CallRecording Transcription Lifecycle

```
PENDING → PROCESSING → COMPLETED (transcript received)
PENDING → PROCESSING → FAILED → PROCESSING (retry via BullMQ) → COMPLETED
```

## Data Volume Estimates

| Model | Daily Volume (10 BDRs) | Monthly | Retention |
|-------|----------------------|---------|-----------|
| CallSession | ~500 | ~10,000 | Permanent |
| CallRecording | ~75 (15% connect rate) | ~1,500 | Permanent (S3 lifecycle: move to Glacier after 1 year) |
| DialerQueueItem | ~500 | ~10,000 | Delete after session completes |
| CoachingNote | ~20 | ~400 | Permanent |
| ComplianceLog | ~600 | ~12,000 | Permanent (SOC 2 - minimum 1 year) |
| ContactOptOut | ~5 | ~100 | Permanent |
| TwilioPhoneNumber | N/A (pool) | ~50 total | Permanent |
| DialerSession | ~30 | ~600 | Permanent |
| ScheduledCallback | ~10 | ~200 | Permanent |
| UncallableContact | ~5 | ~100 | Permanent (DNC permanent; REMOVED can be re-added) |
| AnalyticsSavedView | N/A | ~20 total | Permanent |
