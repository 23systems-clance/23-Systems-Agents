import { useState, useCallback, useRef } from 'react';
import * as dialerApi from '@/services/dialer-api';
import type { DialerSession, CallSession, QueueItem, SessionStats, DispositionType } from '@/services/dialer-api';

export type DialerFlowState = 'idle' | 'dialing' | 'ringing' | 'connected' | 'dispositioning' | 'completed';

export interface UseDialerSessionReturn {
  session: DialerSession | null;
  currentCall: CallSession | null;
  currentQueueItem: QueueItem | null;
  flowState: DialerFlowState;
  sessionStats: SessionStats | null;
  error: string | null;
  isLoading: boolean;

  startSession: (source: 'campaign' | 'manual', campaignId?: string, contactIds?: string[]) => Promise<void>;
  pauseSession: () => Promise<void>;
  resumeSession: () => Promise<void>;
  completeSession: () => Promise<SessionStats | null>;
  dialNext: () => Promise<CallSession | null>;
  hangup: () => Promise<void>;
  submitDisposition: (disposition: DispositionType, notes?: string) => Promise<void>;
  skipContact: (itemId: string) => Promise<void>;
  refreshSession: () => Promise<void>;
}

export function useDialerSession(): UseDialerSessionReturn {
  const [session, setSession] = useState<DialerSession | null>(null);
  const [currentCall, setCurrentCall] = useState<CallSession | null>(null);
  const [flowState, setFlowState] = useState<DialerFlowState>('idle');
  const [sessionStats, setSessionStats] = useState<SessionStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const sessionRef = useRef<DialerSession | null>(null);

  // Get current queue item (first PENDING)
  const currentQueueItem = session?.queue?.find(q => q.status === 'PENDING') ?? null;

  const refreshSession = useCallback(async () => {
    try {
      const active = await dialerApi.getActiveSession();
      setSession(active);
      sessionRef.current = active;
    } catch (err: any) {
      setError(err.message);
    }
  }, []);

  const startSessionAction = useCallback(async (source: 'campaign' | 'manual', campaignId?: string, contactIds?: string[]) => {
    setIsLoading(true);
    setError(null);
    try {
      const newSession = await dialerApi.startSession({ source, campaignId, contactIds });
      setSession(newSession);
      sessionRef.current = newSession;
      setFlowState('idle');
    } catch (err: any) {
      setError(err.response?.data?.error || err.message);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const pauseSessionAction = useCallback(async () => {
    if (!session) return;
    try {
      await dialerApi.pauseSession(session.id);
      setSession(prev => prev ? { ...prev, status: 'PAUSED' } : null);
    } catch (err: any) {
      setError(err.response?.data?.error || err.message);
    }
  }, [session]);

  const resumeSessionAction = useCallback(async () => {
    if (!session) return;
    try {
      await dialerApi.resumeSession(session.id);
      setSession(prev => prev ? { ...prev, status: 'ACTIVE' } : null);
    } catch (err: any) {
      setError(err.response?.data?.error || err.message);
    }
  }, [session]);

  const completeSessionAction = useCallback(async (): Promise<SessionStats | null> => {
    if (!session) return null;
    try {
      const stats = await dialerApi.completeSession(session.id);
      setSessionStats(stats);
      setSession(null);
      sessionRef.current = null;
      setFlowState('completed');
      setCurrentCall(null);
      return stats;
    } catch (err: any) {
      setError(err.response?.data?.error || err.message);
      return null;
    }
  }, [session]);

  const dialNext = useCallback(async (): Promise<CallSession | null> => {
    if (!session || !currentQueueItem) return null;
    setFlowState('dialing');
    setError(null);
    try {
      const call = await dialerApi.dialCall(session.id, currentQueueItem.id);
      setCurrentCall(call);
      setFlowState('ringing');
      return call;
    } catch (err: any) {
      setError(err.response?.data?.error || err.message);
      setFlowState('idle');
      return null;
    }
  }, [session, currentQueueItem]);

  const hangup = useCallback(async () => {
    if (!currentCall) return;
    try {
      await dialerApi.hangupCall(currentCall.id);
      setFlowState('dispositioning');
    } catch (err: any) {
      setError(err.response?.data?.error || err.message);
    }
  }, [currentCall]);

  const submitDispositionAction = useCallback(async (disposition: DispositionType, notes?: string) => {
    if (!currentCall) return;
    try {
      const result = await dialerApi.submitDisposition(currentCall.id, disposition, notes);
      setSessionStats(result.sessionStats);
      setCurrentCall(null);
      // Refresh session to get updated queue
      await refreshSession();
      setFlowState('idle');
    } catch (err: any) {
      setError(err.response?.data?.error || err.message);
    }
  }, [currentCall, refreshSession]);

  const skipContact = useCallback(async (itemId: string) => {
    if (!session) return;
    try {
      await dialerApi.skipQueueItem(session.id, itemId);
      await refreshSession();
    } catch (err: any) {
      setError(err.response?.data?.error || err.message);
    }
  }, [session, refreshSession]);

  return {
    session,
    currentCall,
    currentQueueItem,
    flowState,
    sessionStats,
    error,
    isLoading,
    startSession: startSessionAction,
    pauseSession: pauseSessionAction,
    resumeSession: resumeSessionAction,
    completeSession: completeSessionAction,
    dialNext,
    hangup,
    submitDisposition: submitDispositionAction,
    skipContact,
    refreshSession,
  };
}
