import { useState, useEffect, useCallback, useRef } from 'react';
import { getDueCallbacks, completeCallback, type ScheduledCallback } from '@/services/callbacks-api';

/** Polling interval for due callbacks (60 seconds). */
const POLL_INTERVAL_MS = 60 * 1000;

/** Snooze duration (5 minutes). */
const SNOOZE_DURATION_MS = 5 * 60 * 1000;

interface UseCallbackRemindersOptions {
  sessionId: string | null;
  onCallBack: (callbackId: string) => void;
}

interface UseCallbackRemindersReturn {
  activeReminders: ScheduledCallback[];
  dismissReminder: (callbackId: string) => void;
  snoozeReminder: (callbackId: string) => void;
}

/**
 * Poll for due callbacks and manage reminder state.
 *
 * Polls `getDueCallbacks()` every 60 seconds while a session is active.
 * Maintains dismissed/snoozed sets to avoid re-displaying handled reminders.
 * Snoozed reminders reappear after 5 minutes.
 */
export function useCallbackReminders({
  sessionId,
  onCallBack,
}: UseCallbackRemindersOptions): UseCallbackRemindersReturn {
  const [dueCallbacks, setDueCallbacks] = useState<ScheduledCallback[]>([]);
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());
  const [snoozedIds, setSnoozedIds] = useState<Set<string>>(new Set());

  const snoozeTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const onCallBackRef = useRef(onCallBack);

  // Keep onCallBack ref current to avoid stale closures.
  useEffect(() => {
    onCallBackRef.current = onCallBack;
  }, [onCallBack]);

  /** Fetch due callbacks from the API. */
  const fetchDue = useCallback(async () => {
    try {
      const callbacks = await getDueCallbacks();
      setDueCallbacks(callbacks);
    } catch {
      // Non-fatal: polling will retry on next interval.
    }
  }, []);

  // Poll for due callbacks when sessionId is non-null.
  useEffect(() => {
    if (!sessionId) {
      setDueCallbacks([]);
      return;
    }

    // Fetch immediately on mount / session change.
    fetchDue();

    const interval = setInterval(fetchDue, POLL_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [sessionId, fetchDue]);

  /**
   * Dismiss a reminder permanently.
   * Marks the callback as completed on the server and adds its ID
   * to the dismissed set so it won't reappear.
   */
  const dismissReminder = useCallback((callbackId: string) => {
    setDismissedIds((prev) => {
      const next = new Set(prev);
      next.add(callbackId);
      return next;
    });

    // Fire-and-forget server-side completion.
    completeCallback(callbackId).catch(() => {
      // Non-fatal: the callback will remain PENDING on the server
      // but won't be shown again in this session.
    });
  }, []);

  /**
   * Snooze a reminder for 5 minutes.
   * Adds the callback ID to the snoozed set, then removes it
   * after the snooze duration expires so it reappears.
   */
  const snoozeReminder = useCallback((callbackId: string) => {
    setSnoozedIds((prev) => {
      const next = new Set(prev);
      next.add(callbackId);
      return next;
    });

    // Clear any existing snooze timer for this callback.
    const existingTimer = snoozeTimersRef.current.get(callbackId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // Remove from snoozed set after 5 minutes.
    const timer = setTimeout(() => {
      setSnoozedIds((prev) => {
        const next = new Set(prev);
        next.delete(callbackId);
        return next;
      });
      snoozeTimersRef.current.delete(callbackId);
    }, SNOOZE_DURATION_MS);

    snoozeTimersRef.current.set(callbackId, timer);
  }, []);

  // Clean up snooze timers on unmount.
  useEffect(() => {
    const timers = snoozeTimersRef.current;
    return () => {
      timers.forEach((timer) => clearTimeout(timer));
      timers.clear();
    };
  }, []);

  // Filter out dismissed and snoozed callbacks.
  const activeReminders = dueCallbacks.filter(
    (cb) => !dismissedIds.has(cb.id) && !snoozedIds.has(cb.id),
  );

  return {
    activeReminders,
    dismissReminder,
    snoozeReminder,
  };
}
