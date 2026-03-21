import { useState, useEffect, useCallback, useRef } from 'react';
import { dialerApi } from '@/lib/dialer-api-client';

/** Warning threshold in milliseconds (25 minutes). */
const WARNING_THRESHOLD_MS = 25 * 60 * 1000;

/** Auto-timeout threshold in milliseconds (30 minutes). */
const TIMEOUT_THRESHOLD_MS = 30 * 60 * 1000;

/** Heartbeat interval in milliseconds (60 seconds). */
const HEARTBEAT_INTERVAL_MS = 60 * 1000;

/** Countdown duration from warning to timeout in seconds (5 minutes). */
const COUNTDOWN_SECONDS = Math.floor(
  (TIMEOUT_THRESHOLD_MS - WARNING_THRESHOLD_MS) / 1000
);

interface UseInactivityTimeoutOptions {
  sessionId: string | null;
  sessionStatus: string | null;
  onTimeout: () => void;
}

interface UseInactivityTimeoutReturn {
  showWarning: boolean;
  remainingSeconds: number;
  dismissWarning: () => void;
  recordActivity: () => void;
}

/**
 * Track user activity and manage inactivity timeout for dialer sessions.
 *
 * Sends heartbeat POSTs every 60 seconds while the session is ACTIVE.
 * After 25 minutes of inactivity (no heartbeat acknowledgment), shows a
 * warning with countdown. At 30 minutes, fires the onTimeout callback.
 */
export function useInactivityTimeout({
  sessionId,
  sessionStatus,
  onTimeout,
}: UseInactivityTimeoutOptions): UseInactivityTimeoutReturn {
  const [showWarning, setShowWarning] = useState(false);
  const [remainingSeconds, setRemainingSeconds] = useState(COUNTDOWN_SECONDS);

  /** Timestamp of last acknowledged heartbeat from the server. */
  const lastAckRef = useRef<number>(Date.now());
  /** Timestamp of last local user activity. */
  const lastActivityRef = useRef<number>(Date.now());

  const heartbeatIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const inactivityCheckRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const onTimeoutRef = useRef(onTimeout);

  // Keep onTimeout ref current to avoid stale closure issues.
  useEffect(() => {
    onTimeoutRef.current = onTimeout;
  }, [onTimeout]);

  const isActive = sessionId != null && sessionStatus === 'ACTIVE';

  /** Record local user activity (dials, dispositions, clicks). */
  const recordActivity = useCallback(() => {
    lastActivityRef.current = Date.now();
  }, []);

  /** Send a heartbeat POST to the server. */
  const sendHeartbeat = useCallback(async () => {
    if (!sessionId) return;
    try {
      await dialerApi.post(`/sessions/${sessionId}/heartbeat`);
      lastAckRef.current = Date.now();
      lastActivityRef.current = Date.now();
    } catch {
      // Heartbeat failures are non-fatal; the inactivity timer
      // will still fire based on the last successful ack.
    }
  }, [sessionId]);

  /** Dismiss the warning ("I'm still here") and reset timers. */
  const dismissWarning = useCallback(() => {
    setShowWarning(false);
    setRemainingSeconds(COUNTDOWN_SECONDS);

    // Clear any active countdown
    if (countdownRef.current) {
      clearInterval(countdownRef.current);
      countdownRef.current = null;
    }

    // Send an immediate heartbeat and reset activity timestamps
    lastActivityRef.current = Date.now();
    sendHeartbeat();
  }, [sendHeartbeat]);

  // --- Heartbeat interval ---
  useEffect(() => {
    if (!isActive) {
      if (heartbeatIntervalRef.current) {
        clearInterval(heartbeatIntervalRef.current);
        heartbeatIntervalRef.current = null;
      }
      return;
    }

    // Send initial heartbeat on activation
    sendHeartbeat();

    heartbeatIntervalRef.current = setInterval(() => {
      sendHeartbeat();
    }, HEARTBEAT_INTERVAL_MS);

    return () => {
      if (heartbeatIntervalRef.current) {
        clearInterval(heartbeatIntervalRef.current);
        heartbeatIntervalRef.current = null;
      }
    };
  }, [isActive, sendHeartbeat]);

  // --- Inactivity check (runs every second) ---
  useEffect(() => {
    if (!isActive) {
      // Reset state when session is not active
      setShowWarning(false);
      setRemainingSeconds(COUNTDOWN_SECONDS);
      if (inactivityCheckRef.current) {
        clearInterval(inactivityCheckRef.current);
        inactivityCheckRef.current = null;
      }
      if (countdownRef.current) {
        clearInterval(countdownRef.current);
        countdownRef.current = null;
      }
      return;
    }

    // Reset timestamps on activation
    lastAckRef.current = Date.now();
    lastActivityRef.current = Date.now();

    inactivityCheckRef.current = setInterval(() => {
      const now = Date.now();
      const sinceLastAck = now - lastAckRef.current;

      if (sinceLastAck >= TIMEOUT_THRESHOLD_MS) {
        // 30-minute hard timeout reached
        setShowWarning(false);
        if (countdownRef.current) {
          clearInterval(countdownRef.current);
          countdownRef.current = null;
        }
        onTimeoutRef.current();
      } else if (sinceLastAck >= WARNING_THRESHOLD_MS && !countdownRef.current) {
        // 25-minute warning threshold reached — start countdown
        setShowWarning(true);
        const secondsLeft = Math.floor(
          (TIMEOUT_THRESHOLD_MS - sinceLastAck) / 1000
        );
        setRemainingSeconds(secondsLeft);

        countdownRef.current = setInterval(() => {
          setRemainingSeconds((prev) => {
            if (prev <= 1) {
              return 0;
            }
            return prev - 1;
          });
        }, 1000);
      }
    }, 1000);

    return () => {
      if (inactivityCheckRef.current) {
        clearInterval(inactivityCheckRef.current);
        inactivityCheckRef.current = null;
      }
      if (countdownRef.current) {
        clearInterval(countdownRef.current);
        countdownRef.current = null;
      }
    };
  }, [isActive]);

  return {
    showWarning,
    remainingSeconds,
    dismissWarning,
    recordActivity,
  };
}
