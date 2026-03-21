/**
 * Recordings Library Page (T074)
 *
 * Browsable, filterable list of call recordings with tabs for
 * "All Recordings" and "Favorites". Clicking a row navigates
 * to the recording detail page.
 */

import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Star,
  Flag,
  PlayCircle,
  Search,
  Filter,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import {
  listRecordings,
  toggleFavorite,
  type Recording,
  type ListRecordingsParams,
  type ListRecordingsResponse,
} from '@/services/recordings-api';

// ── Constants ──────────────────────────────────────────────────────────────

const DISPOSITION_OPTIONS = [
  { value: '', label: 'All dispositions' },
  { value: 'CONNECTED_INTERESTED', label: 'Connected - Interested' },
  { value: 'CONNECTED_NOT_INTERESTED', label: 'Connected - Not Interested' },
  { value: 'CONNECTED_CALLBACK_REQUESTED', label: 'Connected - Callback Requested' },
  { value: 'CONNECTED_WRONG_PERSON', label: 'Connected - Wrong Person' },
  { value: 'CONNECTED_DO_NOT_CALL', label: 'Connected - Do Not Call' },
  { value: 'NO_ANSWER', label: 'No Answer' },
  { value: 'VOICEMAIL_LEFT', label: 'Voicemail Left' },
  { value: 'BUSY', label: 'Busy' },
  { value: 'GATEKEEPER', label: 'Gatekeeper' },
  { value: 'DO_NOT_CALL', label: 'Do Not Call' },
] as const;

const REVIEW_STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'FLAGGED', label: 'Flagged' },
  { value: 'REVIEWED', label: 'Reviewed' },
] as const;

const PAGE_LIMIT = 20;

// ── Helpers ────────────────────────────────────────────────────────────────

/** Format seconds as MM:SS. */
function formatDuration(seconds: number | null): string {
  if (seconds == null) return '--:--';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** Human-readable disposition label. */
function formatDisposition(value: string | null): string {
  if (!value) return '-';
  const match = DISPOSITION_OPTIONS.find((o) => o.value === value);
  if (match) return match.label;
  return value
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// ── Component ──────────────────────────────────────────────────────────────

export default function RecordingsPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  // ── Tab state (derived from URL) ─────────────────────────────────────
  const activeTab = searchParams.get('tab') === 'favorites' ? 'favorites' : 'all';

  // ── Filter state (synced with URL search params) ─────────────────────
  const [bdrId, setBdrId] = useState(searchParams.get('bdrId') ?? '');
  const [campaignId, setCampaignId] = useState(searchParams.get('campaignId') ?? '');
  const [dateFrom, setDateFrom] = useState(searchParams.get('dateFrom') ?? '');
  const [dateTo, setDateTo] = useState(searchParams.get('dateTo') ?? '');
  const [disposition, setDisposition] = useState(searchParams.get('disposition') ?? '');
  const [minDuration, setMinDuration] = useState(searchParams.get('minDuration') ?? '');
  const [maxDuration, setMaxDuration] = useState(searchParams.get('maxDuration') ?? '');
  const [reviewStatus, setReviewStatus] = useState(searchParams.get('reviewStatus') ?? '');
  const [page, setPage] = useState(Number(searchParams.get('page')) || 1);

  // ── Data state ───────────────────────────────────────────────────────
  const [data, setData] = useState<ListRecordingsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);

  // ── Sync filters to URL search params ────────────────────────────────
  const syncParams = useCallback(() => {
    const params: Record<string, string> = {};
    if (activeTab === 'favorites') params.tab = 'favorites';
    if (bdrId) params.bdrId = bdrId;
    if (campaignId) params.campaignId = campaignId;
    if (dateFrom) params.dateFrom = dateFrom;
    if (dateTo) params.dateTo = dateTo;
    if (disposition) params.disposition = disposition;
    if (minDuration) params.minDuration = minDuration;
    if (maxDuration) params.maxDuration = maxDuration;
    if (reviewStatus) params.reviewStatus = reviewStatus;
    if (page > 1) params.page = String(page);
    setSearchParams(params, { replace: true });
  }, [activeTab, bdrId, campaignId, dateFrom, dateTo, disposition, minDuration, maxDuration, reviewStatus, page, setSearchParams]);

  // ── Fetch recordings ─────────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params: ListRecordingsParams = {
        page,
        limit: PAGE_LIMIT,
        ...(activeTab === 'favorites' && { favoritesOnly: true }),
        ...(bdrId && { bdrId }),
        ...(campaignId && { campaignId }),
        ...(dateFrom && { dateFrom }),
        ...(dateTo && { dateTo }),
        ...(disposition && { disposition }),
        ...(minDuration && { minDuration: Number(minDuration) }),
        ...(maxDuration && { maxDuration: Number(maxDuration) }),
        ...(reviewStatus && { reviewStatus }),
      };
      const result = await listRecordings(params);
      setData(result);
    } catch (err: any) {
      setError(err?.message || 'Failed to load recordings');
    } finally {
      setLoading(false);
    }
  }, [page, activeTab, bdrId, campaignId, dateFrom, dateTo, disposition, minDuration, maxDuration, reviewStatus]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    syncParams();
  }, [syncParams]);

  // ── Tab switch handler ───────────────────────────────────────────────
  const switchTab = (tab: 'all' | 'favorites') => {
    const params: Record<string, string> = {};
    if (tab === 'favorites') params.tab = 'favorites';
    setSearchParams(params);
    setPage(1);
  };

  // ── Favorite toggle (optimistic) ────────────────────────────────────
  const handleToggleFavorite = async (e: React.MouseEvent, recordingId: string) => {
    e.stopPropagation();
    if (!data) return;

    // Optimistic update
    setData({
      ...data,
      recordings: data.recordings.map((r) =>
        r.id === recordingId ? { ...r, isFavorited: !r.isFavorited } : r,
      ),
    });

    try {
      await toggleFavorite(recordingId);
      // If on favorites tab and we un-favorited, refetch to remove from list
      if (activeTab === 'favorites') {
        fetchData();
      }
    } catch {
      // Revert on failure
      fetchData();
    }
  };

  // ── Clear all filters ───────────────────────────────────────────────
  const clearFilters = () => {
    setBdrId('');
    setCampaignId('');
    setDateFrom('');
    setDateTo('');
    setDisposition('');
    setMinDuration('');
    setMaxDuration('');
    setReviewStatus('');
    setPage(1);
  };

  const hasActiveFilters = !!(bdrId || campaignId || dateFrom || dateTo || disposition || minDuration || maxDuration || reviewStatus);

  // ── Render ───────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <PlayCircle className="h-6 w-6 text-gray-600" />
          <h1 className="text-2xl font-semibold text-gray-900">Recordings</h1>
        </div>
        {data && (
          <span className="text-sm text-gray-500">
            {data.total} recording{data.total !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-200">
        <button
          onClick={() => switchTab('all')}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'all'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
          }`}
        >
          All Recordings
        </button>
        <button
          onClick={() => switchTab('favorites')}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors flex items-center gap-1.5 ${
            activeTab === 'favorites'
              ? 'border-blue-600 text-blue-600'
              : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
          }`}
        >
          <Star className="h-3.5 w-3.5" />
          Favorites
        </button>
      </div>

      {/* Filter toggle + active filter indicator */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => setShowFilters((v) => !v)}
          className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm transition-colors ${
            showFilters || hasActiveFilters
              ? 'border-blue-300 bg-blue-50 text-blue-700'
              : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
          }`}
        >
          <Filter className="h-4 w-4" />
          Filters
          {hasActiveFilters && (
            <span className="ml-1 rounded-full bg-blue-600 px-1.5 py-0.5 text-[10px] font-medium text-white leading-none">
              !
            </span>
          )}
        </button>
        {hasActiveFilters && (
          <button
            onClick={clearFilters}
            className="text-xs text-gray-500 hover:text-gray-700 underline"
          >
            Clear all
          </button>
        )}
      </div>

      {/* Filter bar (collapsible) */}
      {showFilters && (
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {/* BDR */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">BDR</label>
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
                <input
                  type="text"
                  value={bdrId}
                  onChange={(e) => { setBdrId(e.target.value); setPage(1); }}
                  placeholder="BDR name or ID..."
                  className="w-full rounded-md border border-gray-300 bg-white py-1.5 pl-8 pr-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
            </div>

            {/* Campaign */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Campaign</label>
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
                <input
                  type="text"
                  value={campaignId}
                  onChange={(e) => { setCampaignId(e.target.value); setPage(1); }}
                  placeholder="Campaign name or ID..."
                  className="w-full rounded-md border border-gray-300 bg-white py-1.5 pl-8 pr-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
            </div>

            {/* Date From */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Date From</label>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
                className="w-full rounded-md border border-gray-300 bg-white py-1.5 px-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>

            {/* Date To */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Date To</label>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => { setDateTo(e.target.value); setPage(1); }}
                className="w-full rounded-md border border-gray-300 bg-white py-1.5 px-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>

            {/* Disposition */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Disposition</label>
              <select
                value={disposition}
                onChange={(e) => { setDisposition(e.target.value); setPage(1); }}
                className="w-full rounded-md border border-gray-300 bg-white py-1.5 px-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                {DISPOSITION_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Duration Min */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Min Duration (sec)</label>
              <input
                type="number"
                min="0"
                value={minDuration}
                onChange={(e) => { setMinDuration(e.target.value); setPage(1); }}
                placeholder="0"
                className="w-full rounded-md border border-gray-300 bg-white py-1.5 px-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>

            {/* Duration Max */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Max Duration (sec)</label>
              <input
                type="number"
                min="0"
                value={maxDuration}
                onChange={(e) => { setMaxDuration(e.target.value); setPage(1); }}
                placeholder="No limit"
                className="w-full rounded-md border border-gray-300 bg-white py-1.5 px-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>

            {/* Review Status */}
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Review Status</label>
              <select
                value={reviewStatus}
                onChange={(e) => { setReviewStatus(e.target.value); setPage(1); }}
                className="w-full rounded-md border border-gray-300 bg-white py-1.5 px-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                {REVIEW_STATUS_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      )}

      {/* Error state */}
      {error && (
        <div className="rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-800">
          {error}
        </div>
      )}

      {/* Loading state */}
      {loading && (
        <div className="rounded-lg border border-gray-200 bg-white">
          <div className="p-0">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="flex items-center gap-4 border-b border-gray-100 px-4 py-3 animate-pulse">
                <div className="h-4 w-24 rounded bg-gray-200" />
                <div className="h-4 w-28 rounded bg-gray-200" />
                <div className="h-4 w-20 rounded bg-gray-200" />
                <div className="h-4 w-32 rounded bg-gray-200" />
                <div className="h-4 w-12 rounded bg-gray-200" />
                <div className="ml-auto h-4 w-16 rounded bg-gray-200" />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && data && data.recordings.length === 0 && (
        <div className="rounded-lg border border-dashed border-gray-300 p-12 text-center">
          <PlayCircle className="mx-auto h-10 w-10 text-gray-300 mb-3" />
          <p className="text-sm text-gray-500">
            {activeTab === 'favorites'
              ? 'No favorited recordings yet'
              : hasActiveFilters
                ? 'No recordings match the current filters'
                : 'No recordings found'}
          </p>
          {hasActiveFilters && (
            <button
              onClick={clearFilters}
              className="mt-2 text-xs text-blue-600 hover:underline"
            >
              Clear filters
            </button>
          )}
        </div>
      )}

      {/* Recording table */}
      {!loading && !error && data && data.recordings.length > 0 && (
        <div className="rounded-lg border border-gray-200 bg-white overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50">
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">BDR Name</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Contact Name</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Company</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Disposition</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Duration</th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider w-12">Fav</th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider w-16">Review</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {data.recordings.map((rec: Recording) => (
                  <tr
                    key={rec.id}
                    onClick={() => navigate(`/recordings/${rec.id}`)}
                    className="cursor-pointer hover:bg-gray-50 transition-colors"
                  >
                    <td className="px-4 py-3 font-medium text-gray-900 whitespace-nowrap">
                      {rec.bdrName}
                    </td>
                    <td className="px-4 py-3 text-gray-700 whitespace-nowrap">
                      {rec.contactName}
                    </td>
                    <td className="px-4 py-3 text-gray-700 max-w-[160px] truncate">
                      {rec.companyName || '-'}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <DispositionBadge disposition={rec.disposition} />
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-gray-700 whitespace-nowrap">
                      {formatDuration(rec.durationSeconds)}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <button
                        onClick={(e) => handleToggleFavorite(e, rec.id)}
                        className="inline-flex items-center justify-center rounded p-1 hover:bg-yellow-50 transition-colors"
                        title={rec.isFavorited ? 'Remove from favorites' : 'Add to favorites'}
                      >
                        <Star
                          className={`h-4 w-4 ${
                            rec.isFavorited
                              ? 'fill-yellow-400 text-yellow-400'
                              : 'text-gray-300 hover:text-yellow-400'
                          }`}
                        />
                      </button>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <ReviewBadge status={rec.reviewStatus} />
                    </td>
                    <td className="px-4 py-3 text-right text-gray-500 whitespace-nowrap">
                      {new Date(rec.createdAt).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between border-t border-gray-200 px-4 py-3">
            <p className="text-sm text-gray-500">
              Page {data.page} of {data.totalPages} ({data.total} total)
            </p>
            <div className="flex items-center gap-2">
              <button
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronLeft className="h-4 w-4" />
                Previous
              </button>
              <button
                disabled={page >= (data.totalPages || 1)}
                onClick={() => setPage((p) => p + 1)}
                className="inline-flex items-center gap-1 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Next
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────

/** Colored badge for call disposition values. */
function DispositionBadge({ disposition }: { disposition: string | null }) {
  if (!disposition) return <span className="text-gray-400">-</span>;

  const colorMap: Record<string, string> = {
    CONNECTED_INTERESTED: 'bg-green-100 text-green-800',
    CONNECTED_CALLBACK_REQUESTED: 'bg-blue-100 text-blue-800',
    CONNECTED_NOT_INTERESTED: 'bg-gray-100 text-gray-700',
    CONNECTED_WRONG_PERSON: 'bg-orange-100 text-orange-800',
    CONNECTED_DO_NOT_CALL: 'bg-red-100 text-red-700',
    NO_ANSWER: 'bg-gray-100 text-gray-600',
    VOICEMAIL_LEFT: 'bg-purple-100 text-purple-700',
    BUSY: 'bg-yellow-100 text-yellow-800',
    GATEKEEPER: 'bg-indigo-100 text-indigo-700',
    DO_NOT_CALL: 'bg-red-100 text-red-700',
  };

  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
        colorMap[disposition] ?? 'bg-gray-100 text-gray-700'
      }`}
    >
      {formatDisposition(disposition)}
    </span>
  );
}

/** Badge showing review status (flagged, reviewed, or nothing). */
function ReviewBadge({ status }: { status: string | null }) {
  if (!status) return null;

  if (status === 'FLAGGED') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
        <Flag className="h-3 w-3" />
        Flagged
      </span>
    );
  }

  if (status === 'REVIEWED') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
        Reviewed
      </span>
    );
  }

  return (
    <span className="inline-block rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
      {status}
    </span>
  );
}
