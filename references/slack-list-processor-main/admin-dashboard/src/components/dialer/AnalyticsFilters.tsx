/**
 * AnalyticsFilters Component (T093)
 *
 * Compact horizontal filter panel for the Power Dialer analytics dashboard.
 * Includes date range presets, BDR/campaign multi-selects, call type filter,
 * and a reset button.
 */

import { useState, useRef, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { Calendar, ChevronDown, RotateCcw, Check } from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FilterValues {
  startDate: string;
  endDate: string;
  bdrIds: string[];
  campaignIds: string[];
  companyNames: string[];
  callTypes: string[];
}

interface AnalyticsFiltersProps {
  /** Current filter state. */
  filters: FilterValues;
  /** Callback when any filter changes. */
  onFiltersChange: (filters: FilterValues) => void;
  /** Available BDR options for multi-select. */
  availableBdrs: Array<{ id: string; name: string }>;
  /** Available campaign options for multi-select. */
  availableCampaigns: Array<{ id: string; name: string }>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CALL_TYPE_OPTIONS = [
  { id: 'OUTBOUND_POWER', label: 'Outbound Power Dialed' },
  { id: 'OUTBOUND_PARALLEL', label: 'Outbound Parallel Dialed' },
  { id: 'INBOUND_CALLBACK', label: 'Inbound Callback' },
];

interface DatePreset {
  label: string;
  getRange: () => { startDate: string; endDate: string };
}

/** Returns an ISO date string (YYYY-MM-DD) for the given Date. */
function toISODate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

const DATE_PRESETS: DatePreset[] = [
  {
    label: 'Today',
    getRange: () => {
      const today = toISODate(new Date());
      return { startDate: today, endDate: today };
    },
  },
  {
    label: 'This Week',
    getRange: () => {
      const now = new Date();
      const dayOfWeek = now.getDay();
      const monday = new Date(now);
      monday.setDate(now.getDate() - ((dayOfWeek + 6) % 7));
      return { startDate: toISODate(monday), endDate: toISODate(now) };
    },
  },
  {
    label: 'This Month',
    getRange: () => {
      const now = new Date();
      const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
      return { startDate: toISODate(firstDay), endDate: toISODate(now) };
    },
  },
  {
    label: 'Last 30 Days',
    getRange: () => {
      const now = new Date();
      const past = new Date(now);
      past.setDate(now.getDate() - 30);
      return { startDate: toISODate(past), endDate: toISODate(now) };
    },
  },
];

// ---------------------------------------------------------------------------
// MultiSelect Dropdown (reusable sub-component)
// ---------------------------------------------------------------------------

interface MultiSelectProps {
  label: string;
  options: Array<{ id: string; name?: string; label?: string }>;
  selected: string[];
  onChange: (selected: string[]) => void;
}

/** Multi-select dropdown with checkboxes. */
function MultiSelect({ label, options, selected, onChange }: MultiSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  /** Close on outside click. */
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  /** Toggle an option in the selection. */
  const toggle = (id: string) => {
    if (selected.includes(id)) {
      onChange(selected.filter((s) => s !== id));
    } else {
      onChange([...selected, id]);
    }
  };

  const displayLabel =
    selected.length === 0
      ? label
      : selected.length === 1
        ? options.find((o) => o.id === selected[0])?.name || options.find((o) => o.id === selected[0])?.label || '1 selected'
        : `${selected.length} selected`;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className={cn(
          'flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md border transition-colors whitespace-nowrap',
          selected.length > 0
            ? 'border-blue-300 bg-blue-50 text-blue-700'
            : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50',
        )}
      >
        {displayLabel}
        <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', isOpen && 'rotate-180')} />
      </button>

      {isOpen && (
        <div className="absolute z-30 mt-1 w-56 max-h-60 overflow-y-auto rounded-md border border-gray-200 bg-white shadow-lg">
          {options.length === 0 ? (
            <p className="px-3 py-2 text-xs text-gray-500">No options available</p>
          ) : (
            options.map((option) => {
              const isSelected = selected.includes(option.id);
              const optionLabel = option.name || option.label || option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => toggle(option.id)}
                  className="flex w-full items-center gap-2 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  <span
                    className={cn(
                      'flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors',
                      isSelected ? 'border-blue-600 bg-blue-600' : 'border-gray-300',
                    )}
                  >
                    {isSelected && <Check className="h-3 w-3 text-white" />}
                  </span>
                  <span className="truncate">{optionLabel}</span>
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export function AnalyticsFilters({
  filters,
  onFiltersChange,
  availableBdrs,
  availableCampaigns,
}: AnalyticsFiltersProps) {
  const [showCustomDates, setShowCustomDates] = useState(false);

  /** Apply a date preset. */
  const applyPreset = (preset: DatePreset) => {
    const range = preset.getRange();
    onFiltersChange({ ...filters, ...range });
    setShowCustomDates(false);
  };

  /** Check which preset is currently active (if any). */
  const activePreset = DATE_PRESETS.find((p) => {
    const range = p.getRange();
    return range.startDate === filters.startDate && range.endDate === filters.endDate;
  });

  /** Reset all filters to defaults (last 30 days, no selections). */
  const handleReset = () => {
    const range = DATE_PRESETS[3].getRange(); // Last 30 Days
    onFiltersChange({
      startDate: range.startDate,
      endDate: range.endDate,
      bdrIds: [],
      campaignIds: [],
      companyNames: [],
      callTypes: [],
    });
    setShowCustomDates(false);
  };

  const hasActiveFilters =
    filters.bdrIds.length > 0 ||
    filters.campaignIds.length > 0 ||
    filters.companyNames.length > 0 ||
    filters.callTypes.length > 0;

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-3">
      {/* Date Range Presets */}
      <div className="flex items-center gap-1 mr-2">
        <Calendar className="h-4 w-4 text-gray-400 mr-1" />
        {DATE_PRESETS.map((preset) => (
          <button
            key={preset.label}
            type="button"
            onClick={() => applyPreset(preset)}
            className={cn(
              'px-2.5 py-1 text-xs font-medium rounded-md transition-colors',
              activePreset?.label === preset.label && !showCustomDates
                ? 'bg-blue-600 text-white'
                : 'text-gray-600 hover:bg-gray-100',
            )}
          >
            {preset.label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setShowCustomDates((prev) => !prev)}
          className={cn(
            'px-2.5 py-1 text-xs font-medium rounded-md transition-colors',
            showCustomDates
              ? 'bg-blue-600 text-white'
              : 'text-gray-600 hover:bg-gray-100',
          )}
        >
          Custom
        </button>
      </div>

      {/* Custom Date Inputs */}
      {showCustomDates && (
        <div className="flex items-center gap-1.5 mr-2">
          <input
            type="date"
            value={filters.startDate}
            onChange={(e) => onFiltersChange({ ...filters, startDate: e.target.value })}
            className="px-2 py-1 text-xs border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <span className="text-xs text-gray-400">to</span>
          <input
            type="date"
            value={filters.endDate}
            onChange={(e) => onFiltersChange({ ...filters, endDate: e.target.value })}
            className="px-2 py-1 text-xs border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      )}

      {/* Divider */}
      <div className="h-6 w-px bg-gray-200 mx-1" />

      {/* BDR Multi-Select */}
      <MultiSelect
        label="BDRs"
        options={availableBdrs}
        selected={filters.bdrIds}
        onChange={(bdrIds) => onFiltersChange({ ...filters, bdrIds })}
      />

      {/* Campaign Multi-Select */}
      <MultiSelect
        label="Campaigns"
        options={availableCampaigns}
        selected={filters.campaignIds}
        onChange={(campaignIds) => onFiltersChange({ ...filters, campaignIds })}
      />

      {/* Call Type Multi-Select */}
      <MultiSelect
        label="Call Type"
        options={CALL_TYPE_OPTIONS.map((ct) => ({ id: ct.id, name: ct.label }))}
        selected={filters.callTypes}
        onChange={(callTypes) => onFiltersChange({ ...filters, callTypes })}
      />

      {/* Reset Button */}
      {hasActiveFilters && (
        <>
          <div className="h-6 w-px bg-gray-200 mx-1" />
          <button
            type="button"
            onClick={handleReset}
            className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 rounded-md transition-colors"
          >
            <RotateCcw className="h-3 w-3" />
            Reset Filters
          </button>
        </>
      )}
    </div>
  );
}
