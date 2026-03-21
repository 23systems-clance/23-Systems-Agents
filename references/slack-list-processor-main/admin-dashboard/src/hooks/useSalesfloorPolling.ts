/**
 * useSalesfloorPolling Hook (T104 - Power Dialer Phase 11)
 *
 * Polls the salesfloor API every 5 seconds to provide real-time BDR status
 * cards and team pulse data. Automatically pauses polling when the browser
 * tab is hidden and resumes when it becomes visible again.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { getSalesfloorData, type SalesfloorData } from '@/services/salesfloor-api';

/** Polling interval in milliseconds. */
const POLL_INTERVAL_MS = 5000;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface UseSalesfloorPollingOptions {
  /** Client ID to fetch salesfloor data for. Polling is disabled when null. */
  clientId: string | null;
  /** Optional team filter. */
  teamId?: string;
  /** Optional BDR ID filter. */
  bdrIds?: string[];
}

interface UseSalesfloorPollingReturn {
  /** Latest salesfloor snapshot, or null before the first successful fetch. */
  data: SalesfloorData | null;
  /** Whether an initial load is in progress (no data yet). */
  isLoading: boolean;
  /** Latest error message, or null if the last fetch succeeded. */
  error: string | null;
  /** Timestamp of the most recent successful fetch. */
  lastUpdatedAt: Date | null;
  /** Manually trigger an immediate refresh. */
  refresh: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useSalesfloorPolling({
  clientId,
  teamId,
  bdrIds,
}: UseSalesfloorPollingOptions): UseSalesfloorPollingReturn {
  const [data, setData] = useState<SalesfloorData | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isMountedRef = useRef<boolean>(true);

  /** Fetch salesfloor data once. */
  const fetchData = useCallback(async () => {
    if (!clientId) return;

    try {
      const result = await getSalesfloorData(clientId, { teamId, bdrIds });
      if (!isMountedRef.current) return;
      setData(result);
      setError(null);
      setLastUpdatedAt(new Date());
    } catch (err) {
      if (!isMountedRef.current) return;
      const message = err instanceof Error ? err.message : 'Failed to fetch salesfloor data';
      setError(message);
    } finally {
      if (isMountedRef.current) {
        setIsLoading(false);
      }
    }
  }, [clientId, teamId, bdrIds]);

  /** Public refresh function (resets loading if no data yet). */
  const refresh = useCallback(async () => {
    await fetchData();
  }, [fetchData]);

  // ---- Polling lifecycle ----
  useEffect(() => {
    isMountedRef.current = true;

    if (!clientId) {
      setData(null);
      setIsLoading(false);
      setError(null);
      return;
    }

    setIsLoading(true);

    // Fetch immediately, then start the interval.
    fetchData();

    const startPolling = () => {
      stopPolling();
      intervalRef.current = setInterval(fetchData, POLL_INTERVAL_MS);
    };

    const stopPolling = () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };

    /** Pause/resume based on tab visibility. */
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        fetchData();
        startPolling();
      } else {
        stopPolling();
      }
    };

    startPolling();
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      isMountedRef.current = false;
      stopPolling();
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [clientId, fetchData]);

  return { data, isLoading, error, lastUpdatedAt, refresh };
}
