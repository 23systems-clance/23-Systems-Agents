/**
 * AccountPerformanceTable (T088a)
 *
 * Sortable table showing per-account dialer metrics: dials, connects,
 * conversations, meetings, and last-called timestamp.
 */

import { useState, useMemo } from 'react';
import { ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';
import type { AccountPerformanceRow } from '@/services/analytics-api';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SortKey = keyof AccountPerformanceRow;
type SortDirection = 'asc' | 'desc';

interface AccountPerformanceTableProps {
  data: AccountPerformanceRow[];
  isLoading: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const COLUMNS: Array<{ key: SortKey; label: string }> = [
  { key: 'companyName', label: 'Company' },
  { key: 'dials', label: 'Dials' },
  { key: 'connects', label: 'Connects' },
  { key: 'conversations', label: 'Conversations' },
  { key: 'meetings', label: 'Meetings' },
  { key: 'lastCalledAt', label: 'Last Called' },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Formats a date string as relative time (e.g. "2 days ago").
 * Returns "--" for null values.
 */
function formatRelativeTime(dateStr: string | null): string {
  if (!dateStr) return '--';
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffDays > 30) return `${Math.floor(diffDays / 30)} months ago`;
  if (diffDays > 1) return `${diffDays} days ago`;
  if (diffDays === 1) return '1 day ago';
  if (diffHours > 1) return `${diffHours} hours ago`;
  if (diffHours === 1) return '1 hour ago';
  if (diffMinutes > 1) return `${diffMinutes} minutes ago`;
  return 'just now';
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/** Skeleton row for loading state. */
function SkeletonRow() {
  return (
    <tr className="animate-pulse">
      {COLUMNS.map((col) => (
        <td key={col.key} className="px-3 py-3">
          <div className="h-4 w-12 bg-gray-200 rounded" />
        </td>
      ))}
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

/** Sortable account performance table with column-click sorting. */
export function AccountPerformanceTable({ data, isLoading }: AccountPerformanceTableProps) {
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

      // Handle null lastCalledAt
      if (aVal === null && bVal === null) return 0;
      if (aVal === null) return sortDir === 'asc' ? -1 : 1;
      if (bVal === null) return sortDir === 'asc' ? 1 : -1;

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
            {COLUMNS.map((col) => (
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
              <td colSpan={COLUMNS.length} className="px-3 py-8 text-center text-gray-500">
                No account data
              </td>
            </tr>
          ) : (
            sortedData.map((row, idx) => (
              <tr key={`${row.companyName}-${idx}`} className="hover:bg-gray-50 transition-colors">
                <td className="px-3 py-3 font-medium text-gray-900 whitespace-nowrap">
                  {row.companyName}
                </td>
                <td className="px-3 py-3 text-gray-700 tabular-nums whitespace-nowrap">
                  {row.dials.toLocaleString()}
                </td>
                <td className="px-3 py-3 text-gray-700 tabular-nums whitespace-nowrap">
                  {row.connects.toLocaleString()}
                </td>
                <td className="px-3 py-3 text-gray-700 tabular-nums whitespace-nowrap">
                  {row.conversations.toLocaleString()}
                </td>
                <td className="px-3 py-3 text-gray-700 tabular-nums whitespace-nowrap">
                  {row.meetings.toLocaleString()}
                </td>
                <td className="px-3 py-3 text-gray-500 whitespace-nowrap">
                  {formatRelativeTime(row.lastCalledAt)}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
