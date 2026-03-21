import { dialerApi } from '@/lib/dialer-api-client';

// ── Types ───────────────────────────────────────────────────────────────────

export interface ScheduledCallback {
  id: string;
  callSessionId: string;
  contactName: string;
  contactPhone: string;
  companyName: string | null;
  scheduledAt: string;
  status: 'PENDING' | 'COMPLETED' | 'MISSED';
  notes: string | null;
  type: 'SCHEDULED' | 'MISSED_INBOUND';
  createdAt: string;
}

// ── API Functions ───────────────────────────────────────────────────────────

/** Fetch callbacks, optionally filtered by status. */
export async function listCallbacks(status?: string): Promise<ScheduledCallback[]> {
  const { data } = await dialerApi.get('/callbacks', {
    params: status ? { status } : undefined,
  });
  return data;
}

/** Schedule a new callback for a call session. */
export async function scheduleCallback(
  callSessionId: string,
  scheduledAt: string,
  notes?: string,
): Promise<ScheduledCallback> {
  const { data } = await dialerApi.post('/callbacks', {
    callSessionId,
    scheduledAt,
    notes: notes ?? null,
  });
  return data;
}

/** Mark a callback as completed, optionally linking the follow-up call session. */
export async function completeCallback(
  callbackId: string,
  completedCallSessionId?: string,
): Promise<void> {
  await dialerApi.post(`/callbacks/${callbackId}/complete`, {
    completedCallSessionId: completedCallSessionId ?? null,
  });
}

/** Reschedule an existing callback to a new time. */
export async function rescheduleCallback(
  callbackId: string,
  scheduledAt: string,
): Promise<void> {
  await dialerApi.patch(`/callbacks/${callbackId}`, { scheduledAt });
}

/** Fetch all callbacks that are currently due (scheduledAt <= now, status = PENDING). */
export async function getDueCallbacks(): Promise<ScheduledCallback[]> {
  const { data } = await dialerApi.get('/callbacks/due');
  return data;
}

/** Insert a callback contact at the front of the active dialer queue. */
export async function insertCallbackInQueue(
  callbackId: string,
  sessionId: string,
): Promise<any> {
  const { data } = await dialerApi.post(`/callbacks/${callbackId}/insert`, {
    sessionId,
  });
  return data;
}
