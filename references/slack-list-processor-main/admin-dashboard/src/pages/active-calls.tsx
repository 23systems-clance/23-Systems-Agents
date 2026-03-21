/**
 * Active Calls Monitoring Page (T058 - US4 Manager Call Monitoring)
 *
 * Shows a real-time grid of active calls. Managers can listen (coach mode)
 * or barge in to any active call. Auto-refreshes every 5 seconds.
 */

import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api-client';
import { ActiveCallCard } from '@/components/dialer/ActiveCallCard';

interface ActiveCall {
  callSessionId: string;
  bdrName: string;
  contactName: string;
  companyName: string | null;
  contactPhone: string;
  status: string;
  durationSeconds: number;
  dialedAt: string;
  conferenceSid: string | null;
}

export default function ActiveCallsPage() {
  const [activeCalls, setActiveCalls] = useState<ActiveCall[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [listeningCallId, setListeningCallId] = useState<string | null>(null);
  const [clientId, setClientId] = useState<string>('');

  const fetchActiveCalls = useCallback(async () => {
    if (!clientId) return;
    try {
      const { data } = await api.get('/active-calls', { params: { clientId } });
      setActiveCalls(data.activeCalls || []);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch active calls');
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  // Auto-refresh every 5 seconds
  useEffect(() => {
    fetchActiveCalls();
    const interval = setInterval(fetchActiveCalls, 5000);
    return () => clearInterval(interval);
  }, [fetchActiveCalls]);

  // Load clientId from URL params or first available
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const cid = params.get('clientId');
    if (cid) setClientId(cid);
  }, []);

  const handleListen = async (callSessionId: string) => {
    try {
      const { data } = await api.post(`/active-calls/${callSessionId}/listen`, {
        managerId: 'current-manager', // Will be replaced with actual manager ID from auth
      });
      setListeningCallId(callSessionId);
      // Token and conferenceSid available in data for WebRTC connection
      console.log('[ActiveCalls] Listen started', data);
    } catch (err: any) {
      console.error('[ActiveCalls] Listen failed', err);
    }
  };

  const handleBarge = async (callSessionId: string) => {
    try {
      await api.post(`/active-calls/${callSessionId}/barge`, {
        managerId: 'current-manager',
      });
      console.log('[ActiveCalls] Barge initiated');
    } catch (err: any) {
      console.error('[ActiveCalls] Barge failed', err);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900">Active Calls</h1>
          <p className="text-sm text-gray-500 mt-1">
            Monitor live calls and join as coach or barge in
          </p>
        </div>
        <div className="flex items-center gap-3">
          <input
            type="text"
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            placeholder="Client ID"
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm"
          />
          <div className="flex items-center gap-1.5 text-xs text-gray-500">
            <span className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
            Auto-refreshing
          </div>
        </div>
      </div>

      {/* Error state */}
      {error && (
        <div className="rounded-md bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
      )}

      {/* Loading state */}
      {loading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="rounded-lg border border-gray-200 bg-white p-4 animate-pulse">
              <div className="h-4 bg-gray-200 rounded w-1/2 mb-3" />
              <div className="h-3 bg-gray-200 rounded w-3/4 mb-2" />
              <div className="h-3 bg-gray-200 rounded w-1/2 mb-3" />
              <div className="h-6 bg-gray-200 rounded w-1/4" />
            </div>
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && activeCalls.length === 0 && (
        <div className="rounded-lg border border-dashed border-gray-300 p-12 text-center">
          <p className="text-sm text-gray-500">No active calls right now</p>
          <p className="text-xs text-gray-400 mt-1">Active calls will appear here when BDRs are dialing</p>
        </div>
      )}

      {/* Call cards grid */}
      {!loading && activeCalls.length > 0 && (
        <>
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <span className="font-medium">{activeCalls.length}</span> active call{activeCalls.length !== 1 ? 's' : ''}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {activeCalls.map((call) => (
              <ActiveCallCard
                key={call.callSessionId}
                call={call}
                onListen={handleListen}
                onBarge={handleBarge}
                isListening={listeningCallId === call.callSessionId}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
