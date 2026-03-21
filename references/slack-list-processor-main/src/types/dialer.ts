/**
 * Power Dialer Type Definitions
 * Feature 22: Browser-based power dialer for BDRs
 */

// ============================================================
// Enums
// ============================================================

export enum CallSessionStatus {
  QUEUED = 'QUEUED',
  RINGING = 'RINGING',
  CONNECTED = 'CONNECTED',
  VOICEMAIL = 'VOICEMAIL',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
  SKIPPED = 'SKIPPED',
  NO_ANSWER = 'NO_ANSWER',
}

export enum AmdResult {
  HUMAN = 'HUMAN',
  MACHINE_START = 'MACHINE_START',
  MACHINE_END = 'MACHINE_END',
  FAX = 'FAX',
  UNKNOWN = 'UNKNOWN',
}

export enum DispositionType {
  CONNECTED_INTERESTED = 'CONNECTED_INTERESTED',
  CONNECTED_NOT_INTERESTED = 'CONNECTED_NOT_INTERESTED',
  CONNECTED_CALLBACK_REQUESTED = 'CONNECTED_CALLBACK_REQUESTED',
  VOICEMAIL_AUTO_SKIPPED = 'VOICEMAIL_AUTO_SKIPPED',
  VOICEMAIL_LEFT_MESSAGE = 'VOICEMAIL_LEFT_MESSAGE',
  NO_ANSWER = 'NO_ANSWER',
  WRONG_NUMBER = 'WRONG_NUMBER',
  DO_NOT_CALL = 'DO_NOT_CALL',
  INVALID_NUMBER = 'INVALID_NUMBER',
  DROPPED_CALL = 'DROPPED_CALL',
}

export enum TranscriptionStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

export enum RecordingReviewStatus {
  NONE = 'NONE',
  FLAGGED = 'FLAGGED',
  REVIEWED = 'REVIEWED',
}

export enum ComplianceEventType {
  CONSENT_PLAYED = 'CONSENT_PLAYED',
  TCPA_WINDOW_BLOCKED = 'TCPA_WINDOW_BLOCKED',
  OPT_OUT_RECORDED = 'OPT_OUT_RECORDED',
  OPT_OUT_BLOCKED = 'OPT_OUT_BLOCKED',
}

export enum CallbackStatus {
  PENDING = 'PENDING',
  COMPLETED = 'COMPLETED',
  MISSED = 'MISSED',
}

export enum UncallableReason {
  DNC = 'DNC',
  REMOVED = 'REMOVED',
  INVALID_NUMBER = 'INVALID_NUMBER',
  NO_PHONE = 'NO_PHONE',
}

export enum DialerSessionStatus {
  ACTIVE = 'ACTIVE',
  PAUSED = 'PAUSED',
  COMPLETED = 'COMPLETED',
}

export enum QueueItemStatus {
  PENDING = 'PENDING',
  DIALING = 'DIALING',
  COMPLETED = 'COMPLETED',
  SKIPPED = 'SKIPPED',
}

// ============================================================
// API Request Types
// ============================================================

export interface StartSessionRequest {
  source: 'campaign' | 'manual';
  campaignId?: string;
  contactIds?: string[];
}

export interface DialCallRequest {
  sessionId: string;
  queueItemId: string;
}

export interface MuteCallRequest {
  muted: boolean;
}

export interface HoldCallRequest {
  held: boolean;
}

export interface SubmitDispositionRequest {
  disposition: DispositionType;
  notes?: string;
}

export interface ProvisionPhoneNumberRequest {
  areaCode: string;
  clientId?: string;
}

export interface AssignPhoneNumberRequest {
  clientId: string;
  isPrimary?: boolean;
}

export interface ToggleFavoriteRequest {
  isFavorited: boolean;
}

export interface SetReviewStatusRequest {
  reviewStatus: 'FLAGGED' | 'REVIEWED';
}

export interface AddCoachingNoteRequest {
  content: string;
  timestampSeconds?: number;
}

export interface ScheduleCallbackRequest {
  scheduledAt: string;
  notes?: string;
}

export interface SaveDevicePreferencesRequest {
  microphoneDeviceId: string;
  speakerDeviceId: string;
}

export interface CreateSavedViewRequest {
  name: string;
  tab: 'rep' | 'list' | 'account' | 'objections' | 'when-to-call';
  filters: AnalyticsFilters;
}

export interface RecordingListParams {
  bdrId?: string;
  campaignId?: string;
  clientId?: string;
  disposition?: DispositionType;
  minDuration?: number;
  maxDuration?: number;
  dateFrom?: string;
  dateTo?: string;
  reviewStatus?: RecordingReviewStatus;
  favoritesOnly?: boolean;
  page?: number;
  limit?: number;
}

export interface AnalyticsFilters {
  dateFrom?: string;
  dateTo?: string;
  teamIds?: string[];
  bdrIds?: string[];
  listIds?: string[];
  accountIds?: string[];
  callTypes?: string[];
  phoneFields?: string[];
}

// ============================================================
// API Response Types
// ============================================================

export interface TokenResponse {
  token: string;
  identity: string;
}

export interface DialerSessionResponse {
  id: string;
  status: DialerSessionStatus;
  campaignId: string | null;
  totalDialed: number;
  totalConnected: number;
  totalVoicemail: number;
  totalNoAnswer: number;
  startedAt: string;
  queue: QueueItemResponse[];
  currentIndex: number;
}

export interface QueueItemResponse {
  id: string;
  position: number;
  status: QueueItemStatus;
  contactName: string;
  contactEmail: string | null;
  contactPhone: string;
  companyName: string | null;
  jobTitle: string | null;
  hubspotContactId: string | null;
  tcpaEligible: boolean;
  optedOut: boolean;
  lastCalledAt: string | null;
}

export interface QueueResponse {
  items: QueueItemResponse[];
  currentIndex: number;
  totalRemaining: number;
}

export interface CallSessionResponse {
  id: string;
  status: CallSessionStatus;
  contactName: string;
  contactPhone: string;
  companyName: string | null;
  callerIdNumber: string | null;
  amdResult: AmdResult | null;
  dialedAt: string | null;
  answeredAt: string | null;
  durationSeconds: number | null;
  disposition: DispositionType | null;
  conferenceName: string;
}

export interface DispositionResponse {
  nextQueueItem: QueueItemResponse | null;
  sessionStats: SessionStats;
}

export interface SessionStats {
  totalDialed: number;
  totalConnected: number;
  totalVoicemail: number;
  totalNoAnswer: number;
  totalSkipped: number;
  avgTalkTimeSeconds: number;
  sessionDurationMinutes: number;
  connectRate: number;
}

export interface RecordingListItem {
  id: string;
  callSessionId: string;
  bdrName: string;
  contactName: string;
  companyName: string | null;
  disposition: DispositionType | null;
  durationSeconds: number | null;
  isFavorited: boolean;
  reviewStatus: RecordingReviewStatus;
  createdAt: string;
}

export interface RecordingListResponse {
  recordings: RecordingListItem[];
  total: number;
  page: number;
  totalPages: number;
}

export interface RecordingDetailResponse {
  id: string;
  callSessionId: string;
  bdrName: string;
  contactName: string;
  contactPhone: string;
  companyName: string | null;
  disposition: DispositionType | null;
  dispositionNotes: string | null;
  durationSeconds: number | null;
  talkTimeSeconds: number | null;
  audioUrl: string | null;
  transcript: string | null;
  transcriptJson: DeepgramTranscriptJson | null;
  isFavorited: boolean;
  reviewStatus: RecordingReviewStatus;
  coachingNotes: CoachingNoteResponse[];
  createdAt: string;
}

export interface CoachingNoteResponse {
  id: string;
  authorName: string;
  content: string;
  timestampSeconds: number | null;
  createdAt: string;
}

export interface ActiveCallResponse {
  callSessionId: string;
  bdrName: string;
  contactName: string;
  companyName: string | null;
  contactPhone: string;
  status: CallSessionStatus;
  durationSeconds: number;
  dialedAt: string;
  conferenceSid: string | null;
}

export interface ListenResponse {
  token: string;
  conferenceSid: string;
}

export interface TwilioPhoneNumberResponse {
  id: string;
  phoneNumber: string;
  areaCode: string;
  state: string | null;
  clientId: string | null;
  clientName: string | null;
  isPrimary: boolean;
  isActive: boolean;
}

export interface AudioUrlResponse {
  audioUrl: string;
  expiresAt: string;
}

export interface ScheduledCallbackResponse {
  id: string;
  callSessionId: string;
  contactName: string;
  contactPhone: string;
  companyName: string | null;
  scheduledAt: string;
  notes: string | null;
  status: CallbackStatus;
  completedAt: string | null;
  createdAt: string;
}

export interface DevicePreferencesResponse {
  microphoneDeviceId: string | null;
  speakerDeviceId: string | null;
}

// ============================================================
// CRM Sync Types (CRM-agnostic call activity payload - FR-048)
// ============================================================

export interface CallActivity {
  externalId?: string;
  callSessionId: string;
  bdrId: string;
  bdrName: string;
  contactPhone: string;
  contactName: string;
  companyName: string | null;
  direction: 'OUTBOUND';
  disposition: DispositionType;
  dispositionLabel: string;
  notes: string | null;
  durationSeconds: number | null;
  talkTimeSeconds: number | null;
  callerIdNumber: string | null;
  recordingUrl: string | null;
  transcriptText: string | null;
  dialedAt: string;
  answeredAt: string | null;
  endedAt: string | null;
}

export interface HubSpotDispositionMapping {
  disposition: DispositionType;
  hubspotOutcome: string;
  hubspotType: string;
  hubspotDescription: string;
}

// ============================================================
// Twilio Webhook Payload Types
// ============================================================

export interface TwilioVoiceWebhookPayload {
  AccountSid: string;
  ApiVersion: string;
  CallSid: string;
  CallStatus: TwilioCallStatus;
  Called: string;
  CalledCity?: string;
  CalledCountry?: string;
  CalledState?: string;
  CalledZip?: string;
  Caller: string;
  CallerCity?: string;
  CallerCountry?: string;
  CallerState?: string;
  CallerZip?: string;
  Direction: 'inbound' | 'outbound-api' | 'outbound-dial';
  From: string;
  To: string;
  // Custom params passed via device.connect()
  SessionId?: string;
  ConferenceName?: string;
  QueueItemId?: string;
}

export type TwilioCallStatus =
  | 'queued'
  | 'ringing'
  | 'in-progress'
  | 'completed'
  | 'failed'
  | 'busy'
  | 'no-answer'
  | 'canceled';

export interface TwilioStatusCallbackPayload {
  AccountSid: string;
  CallSid: string;
  CallStatus: TwilioCallStatus;
  CallDuration?: string;
  Duration?: string;
  Timestamp?: string;
  SequenceNumber?: string;
  ErrorCode?: string;
  ErrorMessage?: string;
}

export interface TwilioAmdCallbackPayload {
  AccountSid: string;
  CallSid: string;
  AnsweredBy: TwilioAmdResult;
  MachineDetectionDuration?: string;
}

export type TwilioAmdResult =
  | 'human'
  | 'machine_start'
  | 'machine_end_beep'
  | 'machine_end_silence'
  | 'machine_end_other'
  | 'fax'
  | 'unknown';

export interface TwilioRecordingCallbackPayload {
  AccountSid: string;
  CallSid: string;
  RecordingSid: string;
  RecordingUrl: string;
  RecordingStatus: 'completed' | 'failed';
  RecordingDuration: string;
  RecordingChannels: string;
  RecordingSource: string;
}

export interface TwilioConferenceCallbackPayload {
  AccountSid: string;
  ConferenceSid: string;
  FriendlyName: string;
  StatusCallbackEvent:
    | 'participant-join'
    | 'participant-leave'
    | 'conference-start'
    | 'conference-end';
  CallSid?: string;
  Muted?: string;
  Hold?: string;
  Coaching?: string;
}

// ============================================================
// Deepgram Types
// ============================================================

export interface DeepgramTranscriptJson {
  metadata?: {
    request_id: string;
    transaction_key: string;
    sha256: string;
    created: string;
    duration: number;
    channels: number;
  };
  results?: {
    channels: DeepgramChannel[];
    utterances?: DeepgramUtterance[];
  };
}

export interface DeepgramChannel {
  alternatives: DeepgramAlternative[];
}

export interface DeepgramAlternative {
  transcript: string;
  confidence: number;
  words: DeepgramWord[];
}

export interface DeepgramWord {
  word: string;
  start: number;
  end: number;
  confidence: number;
  speaker?: number;
  punctuated_word?: string;
}

export interface DeepgramUtterance {
  start: number;
  end: number;
  confidence: number;
  channel: number;
  transcript: string;
  words: DeepgramWord[];
  speaker: number;
  id: string;
}

export interface DeepgramCallbackPayload {
  metadata: {
    request_id: string;
    transaction_key: string;
    sha256: string;
    created: string;
    duration: number;
    channels: number;
  };
  results: {
    channels: DeepgramChannel[];
    utterances?: DeepgramUtterance[];
  };
}

// ============================================================
// Call Quality Types (Brazil-to-US monitoring)
// ============================================================

export interface CallQualityMetrics {
  callSessionId: string;
  mos: number | null;
  jitter: number | null;
  packetLossPercentage: number | null;
  roundTripTimeMs: number | null;
  codec: string | null;
  edge: string | null;
  qualityWarnings: string[];
}

export type QualityLevel = 'green' | 'yellow' | 'red';

export interface PreCallCheckResult {
  microphoneAccess: 'pass' | 'fail';
  webrtcConnectivity: 'pass' | 'warn' | 'fail';
  estimatedRtt: number | null;
  overallStatus: 'pass' | 'warn' | 'fail';
}

// ============================================================
// Analytics Types
// ============================================================

export interface RepPerformanceRow {
  bdrId: string;
  bdrName: string;
  dials: number;
  dialToConnectPct: number;
  bridgedToConnectPct: number;
  outboundConnects: number;
  connectToConversationPct: number;
  conversations: number;
  conversationToMeetingPct: number;
  meetings: number;
  callbacks: number;
  callbackToConnectPct: number;
  callbackConnects: number;
  dialTimeMinutes: number;
  talkTimeMinutes: number;
  pauseTimeMinutes: number;
  sessionTimeMinutes: number;
}

export interface ListPerformanceRow {
  campaignId: string;
  campaignName: string;
  dials: number;
  dialToConnectPct: number;
  connects: number;
  conversations: number;
  meetings: number;
  dispositionBreakdown: Record<DispositionType, number>;
}

export interface AccountPerformanceRow {
  companyName: string;
  dials: number;
  connects: number;
  conversations: number;
  meetings: number;
  lastDialedAt: string | null;
}

export interface AnalyticsKPIs {
  totalDials: number;
  totalCallbacks: number;
  totalConnects: number;
  totalConversations: number;
  totalMeetings: number;
  dialToConnectPct: number;
  callbackToConnectPct: number;
  bridgedToConnectPct: number;
  connectToConversationPct: number;
  conversationToMeetingPct: number;
}

export interface WhenToCallHeatmapData {
  dayOfWeek: number;
  hourOfDay: number;
  dials: number;
  connects: number;
  connectRate: number;
}

export interface ObjectionsRow {
  objectionType: string;
  count: number;
  percentage: number;
  byBdr: Record<string, number>;
  byList: Record<string, number>;
}

// ============================================================
// Salesfloor Types
// ============================================================

export type BdrActivityStatus =
  | 'ON_CALL'
  | 'IDLE'
  | 'PAUSED'
  | 'DISPOSITIONING'
  | 'RINGING'
  | 'OFFLINE';

export interface SalesfloorBdrCard {
  bdrId: string;
  bdrName: string;
  status: BdrActivityStatus;
  currentContact: {
    name: string;
    company: string | null;
    phone: string;
  } | null;
  callDurationSeconds: number | null;
  dialsToday: number;
  connectsToday: number;
  queueRemaining: number;
  idleMinutes: number;
  callSessionId: string | null;
  conferenceSid: string | null;
}

export interface TeamPulseKPIs {
  totalActiveBdrs: number;
  totalDialsToday: number;
  totalConnectsToday: number;
  avgDialToConnectPct: number;
}

export interface SalesfloorResponse {
  bdrCards: SalesfloorBdrCard[];
  teamPulse: TeamPulseKPIs;
}

// ============================================================
// Compliance Types
// ============================================================

export interface ComplianceCheckResult {
  eligible: boolean;
  reasons: string[];
  tcpaBlocked: boolean;
  optedOut: boolean;
  cooldownActive: boolean;
  twoPartyConsentRequired: boolean;
}

// ============================================================
// Dialer Engine Internal Types
// ============================================================

export interface DialRequest {
  sessionId: string;
  queueItemId: string;
  bdrId: string;
  clientId: string;
}

export interface DialResult {
  callSession: CallSessionResponse;
  conferenceName: string;
  callerIdNumber: string;
}

export interface QueueAdvanceResult {
  nextItem: QueueItemResponse | null;
  queueComplete: boolean;
}
