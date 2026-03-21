import { useState, useEffect, useCallback, useRef } from 'react';

export interface UseCallTimerReturn {
  /** Total seconds elapsed since timer started. */
  elapsedSeconds: number;
  /** Whether the connected-call threshold has been reached. */
  timerElapsed: boolean;
  /** Seconds remaining until threshold (0 if elapsed). */
  remainingSeconds: number;
  /** Start the timer. */
  start: () => void;
  /** Stop and reset the timer. */
  reset: () => void;
  /** Whether the timer is currently running. */
  isRunning: boolean;
}

/** Connected-call timer. Default threshold: 45 seconds. */
export function useCallTimer(thresholdSeconds: number = 45): UseCallTimerReturn {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const timerElapsed = elapsedSeconds >= thresholdSeconds;
  const remainingSeconds = Math.max(0, thresholdSeconds - elapsedSeconds);

  const start = useCallback(() => {
    setElapsedSeconds(0);
    setIsRunning(true);
  }, []);

  const reset = useCallback(() => {
    setElapsedSeconds(0);
    setIsRunning(false);
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (isRunning) {
      intervalRef.current = setInterval(() => {
        setElapsedSeconds(prev => prev + 1);
      }, 1000);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [isRunning]);

  return { elapsedSeconds, timerElapsed, remainingSeconds, start, reset, isRunning };
}
