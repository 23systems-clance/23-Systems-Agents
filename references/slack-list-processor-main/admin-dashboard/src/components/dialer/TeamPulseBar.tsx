/**
 * TeamPulseBar Component (T103 - Power Dialer Phase 11)
 *
 * Fixed top bar displaying aggregate salesfloor KPIs: active BDRs,
 * total dials, total connects, and average dial-to-connect percentage.
 */

import { cn } from '@/lib/utils';
import { Users, Phone, PhoneCall, TrendingUp } from 'lucide-react';
import type { TeamPulse } from '@/services/salesfloor-api';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface TeamPulseBarProps {
  /** Aggregate team pulse data. */
  pulse: TeamPulse;
  /** Whether the data is currently loading. */
  isLoading: boolean;
}

// ---------------------------------------------------------------------------
// Chip configuration
// ---------------------------------------------------------------------------

interface PulseChip {
  label: string;
  key: keyof TeamPulse;
  icon: React.ElementType;
  iconColor: string;
  format: (value: number) => string;
}

const CHIPS: PulseChip[] = [
  {
    label: 'Active BDRs',
    key: 'totalActiveBdrs',
    icon: Users,
    iconColor: 'text-blue-600',
    format: (v) => String(v),
  },
  {
    label: 'Dials Today',
    key: 'totalDialsToday',
    icon: Phone,
    iconColor: 'text-gray-600',
    format: (v) => v.toLocaleString(),
  },
  {
    label: 'Connects Today',
    key: 'totalConnectsToday',
    icon: PhoneCall,
    iconColor: 'text-green-600',
    format: (v) => v.toLocaleString(),
  },
  {
    label: 'Avg D2C %',
    key: 'avgDialToConnectPct',
    icon: TrendingUp,
    iconColor: 'text-purple-600',
    format: (v) => `${v.toFixed(1)}%`,
  },
];

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

/** Skeleton placeholder for a single KPI chip. */
function ChipSkeleton() {
  return (
    <div className="flex items-center gap-2 rounded-full bg-gray-100 px-4 py-2 animate-pulse">
      <div className="h-4 w-4 rounded-full bg-gray-200" />
      <div className="space-y-1">
        <div className="h-2.5 w-14 rounded bg-gray-200" />
        <div className="h-4 w-8 rounded bg-gray-200" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TeamPulseBar({ pulse, isLoading }: TeamPulseBarProps) {
  return (
    <div className="flex items-center gap-3 border-b border-gray-200 bg-gray-50/80 px-4 py-2.5 overflow-x-auto">
      {CHIPS.map((chip) => {
        if (isLoading) {
          return <ChipSkeleton key={chip.key} />;
        }

        const Icon = chip.icon;
        const value = pulse[chip.key];

        return (
          <div
            key={chip.key}
            className="flex items-center gap-2 rounded-full border border-gray-200 bg-white px-4 py-2 shadow-sm shrink-0"
          >
            <Icon className={cn('h-4 w-4', chip.iconColor)} />
            <div className="flex flex-col leading-tight">
              <span className="text-[10px] font-medium uppercase tracking-wide text-gray-400">
                {chip.label}
              </span>
              <span className="text-sm font-semibold text-gray-900 tabular-nums">
                {chip.format(value)}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
