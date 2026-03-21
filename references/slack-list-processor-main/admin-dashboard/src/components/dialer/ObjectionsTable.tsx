/**
 * ObjectionsTable Component (T097)
 *
 * Displays an objection type breakdown table for the Power Dialer analytics
 * dashboard. Shows count, percentage (as horizontal bar), top reps, and
 * expandable rows with full BDR breakdown.
 */

import { useState, Fragment } from 'react';
import { ChevronRight, ChevronDown } from 'lucide-react';
import type { ObjectionRow } from '@/services/analytics-api';

interface ObjectionsTableProps {
  /** Objection rows to display. */
  data: ObjectionRow[];
  /** Whether data is currently loading. */
  isLoading: boolean;
}

/** Human-readable labels for disposition-based objection types. */
const objectionLabels: Record<string, string> = {
  CONNECTED_NOT_INTERESTED: 'Not Interested',
  CONNECTED_WRONG_PERSON: 'Wrong Person',
  CONNECTED_DO_NOT_CALL: 'Do Not Call',
  DO_NOT_CALL: 'Do Not Call (Pre-Connect)',
};

/**
 * Returns a formatted label for an objection type.
 * Falls back to a title-cased version of the raw string if no mapping exists.
 */
function formatObjectionType(type: string): string {
  if (objectionLabels[type]) return objectionLabels[type];
  return type
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Skeleton row placeholder for loading state. */
function SkeletonRow() {
  return (
    <tr className="animate-pulse">
      <td className="px-3 py-3">
        <div className="h-4 w-28 bg-gray-200 rounded" />
      </td>
      <td className="px-3 py-3">
        <div className="h-4 w-10 bg-gray-200 rounded" />
      </td>
      <td className="px-3 py-3">
        <div className="h-4 w-full bg-gray-200 rounded" />
      </td>
      <td className="px-3 py-3">
        <div className="h-4 w-32 bg-gray-200 rounded" />
      </td>
    </tr>
  );
}

/**
 * Renders the expanded BDR breakdown for a single objection type.
 */
function BdrBreakdown({ byBdr }: { byBdr: ObjectionRow['byBdr'] }) {
  const sorted = [...byBdr].sort((a, b) => b.count - a.count);
  const maxCount = Math.max(...sorted.map((b) => b.count), 1);

  if (sorted.length === 0) {
    return (
      <p className="text-xs text-gray-500 px-3 py-2">No BDR breakdown available.</p>
    );
  }

  return (
    <div className="px-6 py-3 space-y-1.5">
      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-2">
        BDR Breakdown
      </p>
      {sorted.map((bdr) => {
        const widthPct = (bdr.count / maxCount) * 100;
        return (
          <div key={bdr.bdrId} className="flex items-center gap-3">
            <span className="text-xs text-gray-600 w-32 shrink-0 text-right truncate">
              {bdr.bdrName}
            </span>
            <div className="flex-1 h-5 bg-gray-100 rounded overflow-hidden">
              <div
                className="h-full rounded bg-blue-500 transition-all"
                style={{ width: `${widthPct}%` }}
              />
            </div>
            <span className="text-xs text-gray-700 tabular-nums w-10 text-right font-medium">
              {bdr.count}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function ObjectionsTable({ data, isLoading }: ObjectionsTableProps) {
  const [expandedTypes, setExpandedTypes] = useState<Set<string>>(new Set());

  /** Toggle expansion of an objection type row. */
  const toggleExpand = (type: string) => {
    setExpandedTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) {
        next.delete(type);
      } else {
        next.add(type);
      }
      return next;
    });
  };

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
      <table className="min-w-full divide-y divide-gray-200 text-sm">
        <thead className="bg-gray-50">
          <tr>
            {/* Expand toggle column */}
            <th scope="col" className="w-8 px-2 py-3" />
            <th
              scope="col"
              className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap"
            >
              Objection Type
            </th>
            <th
              scope="col"
              className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap"
            >
              Count
            </th>
            <th
              scope="col"
              className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap w-48"
            >
              % of Total
            </th>
            <th
              scope="col"
              className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap"
            >
              Top Reps
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {isLoading ? (
            <>
              {Array.from({ length: 4 }).map((_, i) => (
                <SkeletonRow key={i} />
              ))}
            </>
          ) : data.length === 0 ? (
            <tr>
              <td colSpan={5} className="px-3 py-8 text-center text-gray-500">
                No objection data for this period
              </td>
            </tr>
          ) : (
            data.map((row) => {
              const isExpanded = expandedTypes.has(row.type);
              const topReps = [...row.byBdr]
                .sort((a, b) => b.count - a.count)
                .slice(0, 3);

              return (
                <Fragment key={row.type}>
                  <tr
                    className="hover:bg-gray-50 transition-colors cursor-pointer"
                    onClick={() => toggleExpand(row.type)}
                  >
                    {/* Expand chevron */}
                    <td className="px-2 py-3 text-gray-400">
                      {isExpanded ? (
                        <ChevronDown className="h-4 w-4" />
                      ) : (
                        <ChevronRight className="h-4 w-4" />
                      )}
                    </td>

                    {/* Objection Type */}
                    <td className="px-3 py-3 font-medium text-gray-900 whitespace-nowrap">
                      {formatObjectionType(row.type)}
                    </td>

                    {/* Count */}
                    <td className="px-3 py-3 text-gray-700 tabular-nums whitespace-nowrap">
                      {row.count.toLocaleString()}
                    </td>

                    {/* Percentage bar */}
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-5 bg-gray-100 rounded overflow-hidden">
                          <div
                            className="h-full rounded bg-amber-500 transition-all"
                            style={{ width: `${Math.min(row.percentage, 100)}%` }}
                          />
                        </div>
                        <span className="text-xs text-gray-600 tabular-nums w-12 text-right font-medium">
                          {row.percentage.toFixed(1)}%
                        </span>
                      </div>
                    </td>

                    {/* Top Reps */}
                    <td className="px-3 py-3">
                      <div className="flex flex-wrap gap-1">
                        {topReps.map((bdr) => (
                          <span
                            key={bdr.bdrId}
                            className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-blue-50 text-blue-700"
                          >
                            {bdr.bdrName}
                            <span className="text-blue-500">({bdr.count})</span>
                          </span>
                        ))}
                        {topReps.length === 0 && (
                          <span className="text-xs text-gray-400">--</span>
                        )}
                      </div>
                    </td>
                  </tr>

                  {/* Expanded BDR breakdown */}
                  {isExpanded && (
                    <tr>
                      <td colSpan={5} className="bg-gray-50/50 border-b border-gray-200">
                        <BdrBreakdown byBdr={row.byBdr} />
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
