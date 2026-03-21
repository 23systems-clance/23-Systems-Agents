import { dialerApi } from '@/lib/dialer-api-client';

// Types
export interface QueueItem {
  id: string;
  position: number;
  status: 'PENDING' | 'DIALING' | 'COMPLETED' | 'SKIPPED';
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

export interface DialerSession {
  id: string;
  status: 'ACTIVE' | 'PAUSED' | 'COMPLETED';
  campaignId: string | null;
  totalDialed: number;
  totalConnected: number;
  totalVoicemail: number;
  totalNoAnswer: number;
  startedAt: string;
  queue: QueueItem[];
  currentIndex: number;
}

export interface CallSession {
  id: string;
  status: string;
  contactName: string;
  contactPhone: string;
  companyName: string | null;
  callerIdNumber: string;
  amdResult: string | null;
  dialedAt: string | null;
  answeredAt: string | null;
  durationSeconds: number | null;
  disposition: string | null;
  conferenceName: string;
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

export interface DispositionResult {
  nextQueueItem: QueueItem | null;
  sessionStats: SessionStats;
}

export type DispositionType =
  | 'CONNECTED_INTERESTED'
  | 'CONNECTED_NOT_INTERESTED'
  | 'CONNECTED_CALLBACK_REQUESTED'
  | 'CONNECTED_WRONG_PERSON'
  | 'CONNECTED_DO_NOT_CALL'
  | 'NO_ANSWER'
  | 'VOICEMAIL_LEFT'
  | 'VOICEMAIL_AUTO_SKIPPED'
  | 'BUSY'
  | 'GATEKEEPER'
  | 'DO_NOT_CALL';

// Token
export async function fetchToken(): Promise<{ token: string; identity: string }> {
  const { data } = await dialerApi.post('/token');
  return data;
}

// Sessions
export async function startSession(body: { source: 'campaign' | 'manual'; campaignId?: string; contactIds?: string[] }): Promise<DialerSession> {
  const { data } = await dialerApi.post('/sessions', body);
  return data;
}

export async function getActiveSession(): Promise<DialerSession | null> {
  const { data, status } = await dialerApi.get('/sessions');
  if (status === 204) return null;
  return data;
}

export async function pauseSession(sessionId: string): Promise<void> {
  await dialerApi.post(`/sessions/${sessionId}/pause`);
}

export async function resumeSession(sessionId: string): Promise<void> {
  await dialerApi.post(`/sessions/${sessionId}/resume`);
}

export async function completeSession(sessionId: string): Promise<SessionStats> {
  const { data } = await dialerApi.post(`/sessions/${sessionId}/complete`);
  return data;
}

// Queue
export async function getQueue(sessionId: string): Promise<{ items: QueueItem[]; currentIndex: number; totalRemaining: number }> {
  const { data } = await dialerApi.get(`/sessions/${sessionId}/queue`);
  return data;
}

export async function skipQueueItem(sessionId: string, itemId: string): Promise<void> {
  await dialerApi.post(`/sessions/${sessionId}/queue/${itemId}/skip`);
}

// Calls
export async function dialCall(sessionId: string, queueItemId: string): Promise<CallSession> {
  const { data } = await dialerApi.post('/calls/dial', { sessionId, queueItemId });
  return data;
}

export async function hangupCall(callSessionId: string): Promise<void> {
  await dialerApi.post(`/calls/${callSessionId}/hangup`);
}

export async function muteCall(callSessionId: string, muted: boolean): Promise<void> {
  await dialerApi.post(`/calls/${callSessionId}/mute`, { muted });
}

export async function holdCall(callSessionId: string, held: boolean): Promise<void> {
  await dialerApi.post(`/calls/${callSessionId}/hold`, { held });
}

// Disposition
export async function submitDisposition(callSessionId: string, disposition: DispositionType, notes?: string): Promise<DispositionResult> {
  const { data } = await dialerApi.post(`/calls/${callSessionId}/disposition`, { disposition, notes });
  return data;
}

// Heartbeat (T062)
export async function sendHeartbeat(sessionId: string): Promise<void> {
  await dialerApi.post(`/sessions/${sessionId}/heartbeat`);
}

// Uncallable contacts (T060)
export interface UncallableContact {
  id: string;
  contactName: string;
  contactPhone: string;
  companyName: string | null;
  reason: 'DNC' | 'REMOVED' | 'INVALID_NUMBER' | 'OPTED_OUT';
  removedAt: string;
}

export async function getUncallables(sessionId: string): Promise<UncallableContact[]> {
  const { data } = await dialerApi.get(`/sessions/${sessionId}/queue/uncallable`);
  return data.uncallables;
}

export async function reAddProspect(sessionId: string, itemId: string): Promise<void> {
  await dialerApi.post(`/sessions/${sessionId}/queue/${itemId}/re-add`);
}

// Device preferences (T061)
export interface DevicePreferences {
  microphoneId: string | null;
  speakerId: string | null;
}

export async function getDevicePreferences(): Promise<DevicePreferences> {
  const { data } = await dialerApi.get('/device/preferences');
  return data;
}

export async function saveDevicePreferences(prefs: DevicePreferences): Promise<void> {
  await dialerApi.post('/device/preferences', prefs);
}
