/**
 * ListPerformanceTable Component (T092)
 *
 * Sortable table showing per-campaign/list performance metrics for the
 * Power Dialer analytics dashboard. Rows are expandable to show a
 * disposition breakdown as horizontal mini bar charts.
 */

import { useState, useMemo, Fragment } from 'react';
import { cn } from '@/lib/utils';
import { ArrowUpDown, ArrowUp, ArrowDown, ChevronRight, ChevronDown } from 'lucide-react';
import type { ListPerformanceRow } from '@/services/analytics-api';

interface ListPerformanceTableProps {
  /** List/campaign performance rows to display. */
  data: ListPerformanceRow[];
  /** Whether data is currently loading. */
  isLoading: boolean;
}

type SortKey = keyof Omit<ListPerformanceRow, 'dispositionBreakdown'>;
type SortDirection = 'asc' | 'desc';

interface ColumnDef {
  key: SortKey;
  label: string;
  isRate?: boolean;
}

const columns: ColumnDef[] = [
  { key: 'campaignName', label: 'List Name' },
  { key: 'dials', label: 'Dials' },
  { key: 'dialToConnectPct', label: 'Dial\u2192Connect%', isRate: true },
  { key: 'connects', label: 'Connects' },
  { key: 'connectToConversationPct', label: 'Connect\u2192Conv%', isRate: true },
  { key: 'conversations', label: 'Conversations' },
  { key: 'conversationToMeetingPct', label: 'Conv\u2192Meeting%', isRate: true },
  { key: 'meetings', label: 'Meetings' },
];

/** Disposition label map for more readable display. */
const dispositionLabels: Record<string, string> = {
  CONNECTED_INTERESTED: 'Interested',
  CONNECTED_NOT_INTERESTED: 'Not Interested',
  CONNECTED_CALLBACK_REQUESTED: 'Callback',
  CONNECTED_WRONG_PERSON: 'Wrong Person',
  CONNECTED_DO_NOT_CALL: 'Do Not Call',
  NO_ANSWER: 'No Answer',
  VOICEMAIL_LEFT: 'Voicemail',
  VOICEMAIL_AUTO_SKIPPED: 'VM Skipped',
  BUSY: 'Busy',
  GATEKEEPER: 'Gatekeeper',
  DO_NOT_CALL: 'DNC',
};

/** Color mapping for disposition bar segments. */
const dispositionColors: Record<string, string> = {
  CONNECTED_INTERESTED: 'bg-emerald-500',
  CONNECTED_NOT_INTERESTED: 'bg-gray-400',
  CONNECTED_CALLBACK_REQUESTED: 'bg-blue-500',
  CONNECTED_WRONG_PERSON: 'bg-amber-500',
  CONNECTED_DO_NOT_CALL: 'bg-red-500',
  NO_ANSWER: 'bg-gray-300',
  VOICEMAIL_LEFT: 'bg-purple-500',
  VOICEMAIL_AUTO_SKIPPED: 'bg-purple-300',
  BUSY: 'bg-gray-400',
  GATEKEEPER: 'bg-orange-500',
  DO_NOT_CALL: 'bg-red-600',
};

/**
 * Returns a Tailwind text color class for percentage values.
 * Green if > 20%, amber if 10-20%, red if < 10%.
 */
function getRateColor(value: number): string {
  if (value > 20) return 'text-green-600';
  if (value >= 10) return 'text-amber-600';
  return 'text-red-600';
}

/** Skeleton row placeholder. */
function SkeletonRow() {
  return (
    <tr className="animate-pulse">
      {columns.map((col) => (
        <td key={col.key} className="px-3 py-3">
          <div className="h-4 w-12 bg-gray-200 rounded" />
        </td>
      ))}
    </tr>
  );
}

/**
 * Renders the expandable disposition breakdown as horizontal bars.
 */
function DispositionBreakdown({ breakdown }: { breakdown: Record<string, number> }) {
  const entries = Object.entries(breakdown).sort((a, b) => b[1] - a[1]);
  const maxCount = Math.max(...entries.map(([, count]) => count), 1);

  if (entries.length === 0) {
    return (
      <p className="text-xs text-gray-500 px-3 py-2">No disposition data available.</p>
    );
  }

  return (
    <div className="px-6 py-3 space-y-1.5">
      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
        Disposition Breakdown
      </p>
      {entries.map(([disposition, count]) => {
        const widthPct = (count / maxCount) * 100;
        const label = dispositionLabels[disposition] || disposition;
        const barColor = dispositionColors[disposition] || 'bg-gray-400';

        return (
          <div key={disposition} className="flex items-center gap-3">
            <span className="text-xs text-gray-600 w-28 shrink-0 text-right">
              {label}
            </span>
            <div className="flex-1 h-5 bg-gray-100 rounded overflow-hidden">
              <div
                className={cn('h-full rounded transition-all', barColor)}
                style={{ width: `${widthPct}%` }}
              />
            </div>
            <span className="text-xs text-gray-700 tabular-nums w-10 text-right font-medium">
              {count}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function ListPerformanceTable({ data, isLoading }: ListPerformanceTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>('dials');
  const [sortDir, setSortDir] = useState<SortDirection>('desc');
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  /** Toggle sort on column click. */
  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  };

  /** Toggle row expansion. */
  const toggleExpand = (campaignId: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(campaignId)) {
        next.delete(campaignId);
      } else {
        next.add(campaignId);
      }
      return next;
    });
  };

  /** Sorted data based on current sort key and direction. */
  const sortedData = useMemo(() => {
    const sorted = [...data].sort((a, b) => {
      const aVal = a[sortKey];
      const bVal = b[sortKey];
      if (typeof aVal === 'string' && typeof bVal === 'string') {
        return sortDir === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      }
      const aNum = Number(aVal) || 0;
      const bNum = Number(bVal) || 0;
      return sortDir === 'asc' ? aNum - bNum : bNum - aNum;
    });
    return sorted;
  }, [data, sortKey, sortDir]);

  /** Render the sort indicator icon for a column header. */
  const renderSortIcon = (key: SortKey) => {
    if (sortKey !== key) {
      return <ArrowUpDown className="h-3 w-3 text-gray-400" />;
    }
    return sortDir === 'asc' ? (
      <ArrowUp className="h-3 w-3 text-blue-600" />
    ) : (
      <ArrowDown className="h-3 w-3 text-blue-600" />
    );
  };

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
      <table className="min-w-full divide-y divide-gray-200 text-sm">
        <thead className="bg-gray-50">
          <tr>
            {/* Expand toggle column */}
            <th scope="col" className="w-8 px-2 py-3" />
            {columns.map((col) => (
              <th
                key={col.key}
                scope="col"
                className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap cursor-pointer select-none hover:bg-gray-100 transition-colors"
                onClick={() => handleSort(col.key)}
              >
                <div className="flex items-center gap-1">
                  {col.label}
                  {renderSortIcon(col.key)}
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {isLoading ? (
            <>
              {Array.from({ length: 5 }).map((_, i) => (
                <SkeletonRow key={i} />
              ))}
            </>
          ) : sortedData.length === 0 ? (
            <tr>
              <td colSpan={columns.length + 1} className="px-3 py-8 text-center text-gray-500">
                No list performance data available.
              </td>
            </tr>
          ) : (
            sortedData.map((row) => {
              const isExpanded = expandedIds.has(row.campaignId);

              return (
                <Fragment key={row.campaignId}>
                  <tr
                    className="hover:bg-gray-50 transition-colors cursor-pointer"
                    onClick={() => toggleExpand(row.campaignId)}
                  >
                    {/* Expand chevron */}
                    <td className="px-2 py-3 text-gray-400">
                      {isExpanded ? (
                        <ChevronDown className="h-4 w-4" />
                      ) : (
                        <ChevronRight className="h-4 w-4" />
                      )}
                    </td>

                    {columns.map((col) => {
                      const value = row[col.key];

                      if (col.key === 'campaignName') {
                        return (
                          <td key={col.key} className="px-3 py-3 font-medium text-gray-900 whitespace-nowrap">
                            {value as string}
                          </td>
                        );
                      }

                      if (col.isRate) {
                        const numValue = value as number;
                        return (
                          <td key={col.key} className={cn('px-3 py-3 font-medium tabular-nums whitespace-nowrap', getRateColor(numValue))}>
                            {numValue.toFixed(1)}%
                          </td>
                        );
                      }

                      return (
                        <td key={col.key} className="px-3 py-3 text-gray-700 tabular-nums whitespace-nowrap">
                          {(value as number).toLocaleString()}
                        </td>
                      );
                    })}
                  </tr>

                  {/* Expanded disposition breakdown */}
                  {isExpanded && (
                    <tr>
                      <td colSpan={columns.length + 1} className="bg-gray-50/50 border-b border-gray-200">
                        <DispositionBreakdown breakdown={row.dispositionBreakdown} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}

