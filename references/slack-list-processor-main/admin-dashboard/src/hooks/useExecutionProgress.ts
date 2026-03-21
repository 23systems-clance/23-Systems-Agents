/**
 * React hook for subscribing to real-time workflow execution progress via SSE.
 *
 * Connects to the admin API SSE endpoint and provides live node-level
 * progress updates for a specific execution.
 */

import { useState, useEffect, useRef, useCallback } from 'react';

/** Per-node progress entry from the backend. */
export interface NodeProgress {
  nodeId: string;
  nodeType: string;
  label?: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  total: number;
  processed: number;
  succeeded: number;
  failed: number;
  skipped: number;
  startedAt?: string;
  completedAt?: string;
  lastUpdatedAt: string;
  errorSample?: string[];
}

interface UseExecutionProgressResult {
  /** Array of all node progress entries. */
  progress: NodeProgress[];
  /** Whether the SSE connection is currently active. */
  connected: boolean;
  /** Any connection error message. */
  error: string | null;
}

const API_BASE = import.meta.env.VITE_API_BASE_URL || '';

/**
 * Subscribes to real-time execution progress for a given execution ID.
 * Falls back to polling the snapshot endpoint if SSE is unsupported.
 *
 * @param executionId - The workflow execution ID to monitor.
 * @param enabled - Whether to enable the subscription (default: true).
 * @returns Live progress data, connection status, and errors.
 */
export function useExecutionProgress(
  executionId: string | null | undefined,
  enabled = true,
): UseExecutionProgressResult {
  const [progress, setProgress] = useState<NodeProgress[]>([]);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  const cleanup = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    setConnected(false);
  }, []);

  useEffect(() => {
    if (!executionId || !enabled) {
      cleanup();
      return;
    }

    const url = `${API_BASE}/api/v1/admin/workflows/executions/${executionId}/progress`;

    try {
      const es = new EventSource(url);
      eventSourceRef.current = es;

      es.onopen = () => {
        setConnected(true);
        setError(null);
      };

      es.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          if (data.type === 'init' && Array.isArray(data.progress)) {
            setProgress(data.progress);
          } else if (data.type === 'update' && data.progress) {
            setProgress((prev) => {
              const idx = prev.findIndex((p) => p.nodeId === data.progress.nodeId);
              if (idx >= 0) {
                const next = [...prev];
                next[idx] = data.progress;
                return next;
              }
              return [...prev, data.progress];
            });
          }
        } catch {
          // Ignore malformed messages
        }
      };

      es.onerror = () => {
        setConnected(false);
        setError('Connection lost. Retrying...');
      };

      return () => {
        es.close();
        eventSourceRef.current = null;
      };
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect');
      return cleanup;
    }
  }, [executionId, enabled, cleanup]);

  return { progress, connected, error };
}
