/**
 * Salesfloor Page (T105 - Power Dialer Phase 11)
 *
 * Real-time salesfloor dashboard showing live BDR status cards,
 * Team Pulse KPIs, idle warnings, and manager listen/barge actions.
 * Polls every 5 seconds with visibility-based pausing.
 */

import { useState, useMemo } from 'react';
import { RefreshCw, Users, WifiOff } from 'lucide-react';
import { useSalesfloorPolling } from '@/hooks/useSalesfloorPolling';
import { SalesfloorCard } from '@/components/dialer/SalesfloorCard';
import { TeamPulseBar } from '@/components/dialer/TeamPulseBar';
import type { BdrStatus } from '@/services/salesfloor-api';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Status sort order for the card grid. */
const STATUS_ORDER: Record<BdrStatus, number> = {
  ON_CALL: 0,
  RINGING: 1,
  DISPOSITIONING: 2,
  IDLE: 3,
  PAUSED: 4,
  OFFLINE: 5,
};

/** Status filter options. */
const STATUS_FILTERS: { value: BdrStatus | 'ALL'; label: string }[] = [
  { value: 'ALL', label: 'All' },
  { value: 'ON_CALL', label: 'On Call' },
  { value: 'RINGING', label: 'Ringing' },
  { value: 'DISPOSITIONING', label: 'Disposition' },
  { value: 'IDLE', label: 'Idle' },
  { value: 'PAUSED', label: 'Paused' },
  { value: 'OFFLINE', label: 'Offline' },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function SalesfloorPage() {
  // TODO: Replace with real client ID from context/selector
  const [clientId] = useState<string>('default');
  const [statusFilter, setStatusFilter] = useState<BdrStatus | 'ALL'>('ALL');
  const [searchQuery, setSearchQuery] = useState('');

  const { data, isLoading, error, lastUpdatedAt, refresh } = useSalesfloorPolling({
    clientId,
  });

  /** Filter and sort BDR cards. */
  const filteredCards = useMemo(() => {
    if (!data?.bdrCards) return [];

    let cards = [...data.bdrCards];

    // Status filter
    if (statusFilter !== 'ALL') {
      cards = cards.filter((c) => c.status === statusFilter);
    }

    // Search filter (name)
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      cards = cards.filter(
        (c) =>
          c.bdrName.toLowerCase().includes(q) ||
          c.currentContact?.name.toLowerCase().includes(q) ||
          c.currentContact?.company?.toLowerCase().includes(q),
      );
    }

    // Sort by status priority, then name
    cards.sort((a, b) => {
      const statusDiff = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
      if (statusDiff !== 0) return statusDiff;
      return a.bdrName.localeCompare(b.bdrName);
    });

    return cards;
  }, [data?.bdrCards, statusFilter, searchQuery]);

  /** Status counts for filter badges. */
  const statusCounts = useMemo(() => {
    if (!data?.bdrCards) return {} as Record<string, number>;
    const counts: Record<string, number> = { ALL: data.bdrCards.length };
    for (const card of data.bdrCards) {
      counts[card.status] = (counts[card.status] ?? 0) + 1;
    }
    return counts;
  }, [data?.bdrCards]);

  // Handlers for listen/barge (placeholder — would connect manager via WebRTC)
  const handleListen = (callSessionId: string, conferenceName: string) => {
    // TODO: Implement manager listen via POST /admin/active-calls/:id/listen
    console.log('Listen:', callSessionId, conferenceName);
  };

  const handleBarge = (callSessionId: string, conferenceName: string) => {
    // TODO: Implement manager barge via POST /admin/active-calls/:id/barge
    console.log('Barge:', callSessionId, conferenceName);
  };

  // Format last updated time
  const lastUpdatedLabel = lastUpdatedAt
    ? `Updated ${lastUpdatedAt.toLocaleTimeString()}`
    : 'Connecting...';

  return (
    <div className="flex flex-col h-full">
      {/* Team Pulse Bar */}
      <TeamPulseBar
        pulse={data?.teamPulse ?? { totalActiveBdrs: 0, totalDialsToday: 0, totalConnectsToday: 0, avgDialToConnectPct: 0 }}
        isLoading={isLoading}
      />

      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Salesfloor</h1>
          <p className="text-sm text-gray-500">Live BDR activity monitor</p>
        </div>

        <div className="flex items-center gap-3">
          {/* Last updated indicator */}
          <span className="text-xs text-gray-400 flex items-center gap-1.5">
            <span className="relative flex h-2 w-2">
              {!error && (
                <>
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
                </>
              )}
              {error && <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500" />}
            </span>
            {lastUpdatedLabel}
          </span>

          {/* Refresh button */}
          <button
            onClick={refresh}
            className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4 px-6 py-3 border-b border-gray-100 bg-gray-50/50">
        {/* Search */}
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search BDR or contact..."
          className="w-64 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />

        {/* Status filter chips */}
        <div className="flex items-center gap-1.5">
          {STATUS_FILTERS.map((f) => {
            const count = statusCounts[f.value] ?? 0;
            const isActive = statusFilter === f.value;
            return (
              <button
                key={f.value}
                onClick={() => setStatusFilter(f.value)}
                className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  isActive
                    ? 'bg-blue-100 text-blue-700 border border-blue-200'
                    : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
                }`}
              >
                {f.label}
                {count > 0 && (
                  <span className={`text-[10px] ${isActive ? 'text-blue-500' : 'text-gray-400'}`}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 overflow-y-auto p-6">
        {/* Error state */}
        {error && !data && (
          <div className="flex flex-col items-center justify-center h-64 text-center">
            <WifiOff className="h-10 w-10 text-gray-300 mb-3" />
            <p className="text-sm font-medium text-gray-600">Connection Error</p>
            <p className="text-xs text-gray-400 mt-1">{error}</p>
            <button
              onClick={refresh}
              className="mt-3 text-xs text-blue-600 hover:text-blue-700 font-medium"
            >
              Retry
            </button>
          </div>
        )}

        {/* Loading state */}
        {isLoading && !data && (
          <div className="flex flex-wrap gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div
                key={i}
                className="w-[280px] h-48 rounded-lg border border-gray-200 bg-gray-100 animate-pulse"
              />
            ))}
          </div>
        )}

        {/* Empty state */}
        {!isLoading && data && filteredCards.length === 0 && (
          <div className="flex flex-col items-center justify-center h-64 text-center">
            <Users className="h-10 w-10 text-gray-300 mb-3" />
            <p className="text-sm font-medium text-gray-600">
              {statusFilter !== 'ALL' || searchQuery
                ? 'No BDRs match your filters'
                : 'No active BDR sessions'}
            </p>
            <p className="text-xs text-gray-400 mt-1">
              BDR cards will appear here when dialing sessions are active.
            </p>
          </div>
        )}

        {/* Card grid */}
        {filteredCards.length > 0 && (
          <div className="flex flex-wrap gap-4">
            {filteredCards.map((card) => (
              <SalesfloorCard
                key={card.bdrId}
                card={card}
                onListen={handleListen}
                onBarge={handleBarge}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
