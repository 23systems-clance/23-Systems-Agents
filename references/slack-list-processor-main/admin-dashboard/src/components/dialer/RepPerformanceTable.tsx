/**
 * RepPerformanceTable Component (T091)
 *
 * Sortable table showing per-rep performance metrics for the Power Dialer
 * analytics dashboard. Columns include dials, conversion rates, talk time,
 * and session time with color-coded percentage cells.
 */

import { useState, useMemo } from 'react';
import { cn } from '@/lib/utils';
import { ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';
import type { RepPerformanceRow } from '@/services/analytics-api';

interface RepPerformanceTableProps {
  /** Rep performance rows to display. */
  data: RepPerformanceRow[];
  /** Whether data is currently loading. */
  isLoading: boolean;
}

type SortKey = keyof RepPerformanceRow;
type SortDirection = 'asc' | 'desc';

interface ColumnDef {
  key: SortKey;
  label: string;
  isRate?: boolean;
  isTime?: boolean;
}

const columns: ColumnDef[] = [
  { key: 'bdrName', label: 'Rep' },
  { key: 'dials', label: 'Dials' },
  { key: 'dialToConnectPct', label: 'Dial\u2192Connect%', isRate: true },
  { key: 'connects', label: 'Connects' },
  { key: 'connectToConversationPct', label: 'Connect\u2192Conv%', isRate: true },
  { key: 'conversations', label: 'Conversations' },
  { key: 'conversationToMeetingPct', label: 'Conv\u2192Meeting%', isRate: true },
  { key: 'meetings', label: 'Meetings' },
  { key: 'callbacks', label: 'Callbacks' },
  { key: 'callbackToConnectPct', label: 'CB\u2192Connect%', isRate: true },
  { key: 'totalTalkTimeSeconds', label: 'Talk Time', isTime: true },
  { key: 'totalSessionTimeSeconds', label: 'Session Time', isTime: true },
];

/**
 * Format seconds into human-readable "Xh Ym" string.
 */
function formatTime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

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

export function RepPerformanceTable({ data, isLoading }: RepPerformanceTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>('dials');
  const [sortDir, setSortDir] = useState<SortDirection>('desc');

  /** Toggle sort on column click. */
  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
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
              <td colSpan={columns.length} className="px-3 py-8 text-center text-gray-500">
                No rep performance data available.
              </td>
            </tr>
          ) : (
            sortedData.map((row) => (
              <tr key={row.bdrId} className="hover:bg-gray-50 transition-colors">
                {columns.map((col) => {
                  const value = row[col.key];

                  if (col.key === 'bdrName') {
                    return (
                      <td key={col.key} className="px-3 py-3 font-medium text-gray-900 whitespace-nowrap">
                        {value as string}
                      </td>
                    );
                  }

                  if (col.isTime) {
                    return (
                      <td key={col.key} className="px-3 py-3 text-gray-700 tabular-nums whitespace-nowrap">
                        {formatTime(value as number)}
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
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
