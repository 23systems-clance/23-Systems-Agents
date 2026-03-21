/**
 * WhenToCallHeatmap Component (T098)
 *
 * Day-of-week x hour-of-day connect rate heatmap for the Power Dialer
 * analytics dashboard. Shows color-coded cells by connect rate, with
 * hover tooltips and a toggle between business hours and full 24h view.
 */

import { useState, useMemo } from 'react';
import { cn } from '@/lib/utils';
import { Star, Clock } from 'lucide-react';
import type { WhenToCallCell } from '@/services/analytics-api';

interface WhenToCallHeatmapProps {
  /** Heatmap cell data. */
  data: WhenToCallCell[];
  /** Whether data is currently loading. */
  isLoading: boolean;
}

/** Day labels ordered Monday-first. */
const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** Maps dayOfWeek (0=Sun..6=Sat) to Monday-first row index (0=Mon..6=Sun). */
function dayToRowIndex(dayOfWeek: number): number {
  return dayOfWeek === 0 ? 6 : dayOfWeek - 1;
}

/** Business hours range (inclusive). */
const BUSINESS_HOUR_START = 7;
const BUSINESS_HOUR_END = 19; // 7pm displayed as last column

/**
 * Formats an hour number (0-23) into a compact label.
 * e.g. 0 -> "12a", 9 -> "9a", 13 -> "1p", 12 -> "12p"
 */
function formatHourLabel(hour: number): string {
  if (hour === 0) return '12a';
  if (hour < 12) return `${hour}a`;
  if (hour === 12) return '12p';
  return `${hour - 12}p`;
}

/** Full day name for tooltip display. */
const DAY_FULL_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

/**
 * Returns a Tailwind background class based on the connect rate value.
 * Transparent for 0%, through light to dark green for higher rates.
 */
function getCellColor(connectRate: number): string {
  if (connectRate <= 0) return 'bg-gray-50';
  if (connectRate < 5) return 'bg-green-100';
  if (connectRate < 15) return 'bg-green-300';
  if (connectRate < 30) return 'bg-green-500';
  return 'bg-green-700';
}

/**
 * Returns a text color for readability against the cell background.
 */
function getCellTextColor(connectRate: number): string {
  if (connectRate < 15) return 'text-gray-700';
  return 'text-white';
}

/** Skeleton placeholder for loading state. */
function HeatmapSkeleton() {
  return (
    <div className="space-y-2 animate-pulse">
      {Array.from({ length: 7 }).map((_, rowIdx) => (
        <div key={rowIdx} className="flex items-center gap-1">
          <div className="w-10 h-6 bg-gray-200 rounded" />
          <div className="flex-1 flex gap-1">
            {Array.from({ length: 13 }).map((_, colIdx) => (
              <div key={colIdx} className="flex-1 h-8 bg-gray-200 rounded" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function WhenToCallHeatmap({ data, isLoading }: WhenToCallHeatmapProps) {
  const [showAllHours, setShowAllHours] = useState(false);
  const [hoveredCell, setHoveredCell] = useState<{ row: number; hour: number } | null>(null);

  /** Build a lookup grid: grid[rowIndex][hour] = cell data. */
  const grid = useMemo(() => {
    const map = new Map<string, WhenToCallCell>();
    for (const cell of data) {
      const row = dayToRowIndex(cell.dayOfWeek);
      map.set(`${row}-${cell.hour}`, cell);
    }
    return map;
  }, [data]);

  /** Find the best time slot (highest connect rate with minimum dial threshold). */
  const bestSlot = useMemo(() => {
    if (data.length === 0) return null;
    const qualifying = data.filter((c) => c.dials >= 5);
    if (qualifying.length === 0) return null;
    const best = qualifying.reduce((prev, curr) =>
      curr.connectRate > prev.connectRate ? curr : prev,
    );
    return { row: dayToRowIndex(best.dayOfWeek), hour: best.hour };
  }, [data]);

  /** Determine which hours to show. */
  const hours = useMemo(() => {
    if (showAllHours) {
      return Array.from({ length: 24 }, (_, i) => i);
    }
    const result: number[] = [];
    for (let h = BUSINESS_HOUR_START; h <= BUSINESS_HOUR_END; h++) {
      result.push(h);
    }
    return result;
  }, [showAllHours]);

  if (isLoading) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <HeatmapSkeleton />
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-8 text-center text-gray-500">
        Not enough data to show calling patterns
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 space-y-4">
      {/* Header with toggle */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-gray-400" />
          <span className="text-sm font-medium text-gray-700">Connect Rate by Time</span>
        </div>
        <button
          type="button"
          onClick={() => setShowAllHours((prev) => !prev)}
          className={cn(
            'px-3 py-1 text-xs font-medium rounded-md border transition-colors',
            showAllHours
              ? 'border-blue-300 bg-blue-50 text-blue-700'
              : 'border-gray-300 bg-white text-gray-600 hover:bg-gray-50',
          )}
        >
          {showAllHours ? 'Business Hours Only' : 'Show All Hours'}
        </button>
      </div>

      {/* Heatmap grid */}
      <div className="overflow-x-auto">
        <div className="min-w-fit">
          {/* Hour labels (X-axis) */}
          <div className="flex items-center gap-px ml-12 mb-1">
            {hours.map((hour) => (
              <div
                key={hour}
                className="flex-1 min-w-[40px] text-center text-xs text-gray-500 font-medium"
              >
                {formatHourLabel(hour)}
              </div>
            ))}
          </div>

          {/* Grid rows */}
          {DAY_LABELS.map((dayLabel, rowIdx) => (
            <div key={dayLabel} className="flex items-center gap-px mb-px">
              {/* Day label (Y-axis) */}
              <div className="w-12 shrink-0 text-right pr-2 text-xs font-medium text-gray-500">
                {dayLabel}
              </div>

              {/* Cells */}
              {hours.map((hour) => {
                const cell = grid.get(`${rowIdx}-${hour}`);
                const connectRate = cell?.connectRate ?? 0;
                const isBest = bestSlot?.row === rowIdx && bestSlot?.hour === hour;
                const isHovered = hoveredCell?.row === rowIdx && hoveredCell?.hour === hour;

                return (
                  <div
                    key={hour}
                    className={cn(
                      'relative flex-1 min-w-[40px] h-8 rounded-sm flex items-center justify-center cursor-default transition-all',
                      getCellColor(connectRate),
                      isBest && 'ring-2 ring-amber-400 ring-offset-1',
                      isHovered && 'ring-2 ring-blue-400',
                    )}
                    onMouseEnter={() => setHoveredCell({ row: rowIdx, hour })}
                    onMouseLeave={() => setHoveredCell(null)}
                  >
                    {/* Connect rate text */}
                    {cell && cell.dials > 0 && (
                      <span className={cn('text-xs font-medium tabular-nums', getCellTextColor(connectRate))}>
                        {connectRate.toFixed(0)}%
                      </span>
                    )}

                    {/* Best slot star */}
                    {isBest && (
                      <Star className="absolute -top-1 -right-1 h-3 w-3 text-amber-500 fill-amber-400" />
                    )}

                    {/* Tooltip */}
                    {isHovered && cell && (
                      <div className="absolute z-20 bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 bg-gray-900 text-white text-xs rounded-md shadow-lg whitespace-nowrap pointer-events-none">
                        <p className="font-medium">
                          {DAY_FULL_NAMES[rowIdx]} {formatHourLabel(hour).replace('a', 'am').replace('p', 'pm')}
                        </p>
                        <p className="text-gray-300 mt-0.5">
                          {cell.dials.toLocaleString()} dials, {cell.connects.toLocaleString()} connects ({cell.connectRate.toFixed(1)}%)
                        </p>
                        {/* Tooltip arrow */}
                        <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-900" />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 pt-2 border-t border-gray-100">
        <span className="text-xs text-gray-500">Connect Rate:</span>
        <div className="flex items-center gap-1.5">
          {[
            { color: 'bg-gray-50 border border-gray-200', label: '0%' },
            { color: 'bg-green-100', label: '<5%' },
            { color: 'bg-green-300', label: '5-15%' },
            { color: 'bg-green-500', label: '15-30%' },
            { color: 'bg-green-700', label: '30%+' },
          ].map((item) => (
            <div key={item.label} className="flex items-center gap-1">
              <div className={cn('w-4 h-4 rounded-sm', item.color)} />
              <span className="text-xs text-gray-500">{item.label}</span>
            </div>
          ))}
        </div>
        {bestSlot && (
          <div className="flex items-center gap-1 ml-auto">
            <Star className="h-3 w-3 text-amber-500 fill-amber-400" />
            <span className="text-xs text-gray-500">Best time slot</span>
          </div>
        )}
      </div>
    </div>
  );
}
