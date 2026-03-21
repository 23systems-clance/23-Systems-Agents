/**
 * AnalyticsKPICards Component (T090)
 *
 * Displays two rows of KPI cards for the Power Dialer analytics dashboard:
 * - Row 1: Absolute counts (Dials, Callbacks, Connects, Conversations, Meetings)
 * - Row 2: Conversion rates with color-coded indicators
 */

import { cn } from '@/lib/utils';
import {
  Phone,
  PhoneForwarded,
  UserCheck,
  MessageSquare,
  Calendar,
  TrendingUp,
} from 'lucide-react';
import type { KPISummary } from '@/services/analytics-api';

interface AnalyticsKPICardsProps {
  /** KPI summary data. When null, shows loading skeleton. */
  data: KPISummary | null;
  /** Whether data is currently loading. */
  isLoading: boolean;
}

/** Count card definition. */
interface CountCard {
  label: string;
  key: keyof KPISummary;
  icon: React.ElementType;
  iconColor: string;
}

/** Rate card definition. */
interface RateCard {
  label: string;
  key: keyof KPISummary;
}

const countCards: CountCard[] = [
  { label: 'Dials', key: 'totalDials', icon: Phone, iconColor: 'text-blue-600' },
  { label: 'Callbacks', key: 'totalCallbacks', icon: PhoneForwarded, iconColor: 'text-purple-600' },
  { label: 'Connects', key: 'totalConnects', icon: UserCheck, iconColor: 'text-green-600' },
  { label: 'Conversations', key: 'totalConversations', icon: MessageSquare, iconColor: 'text-amber-600' },
  { label: 'Meetings', key: 'totalMeetings', icon: Calendar, iconColor: 'text-emerald-600' },
];

const rateCards: RateCard[] = [
  { label: 'Dial \u2192 Connect', key: 'dialToConnectPct' },
  { label: 'Callback \u2192 Connect', key: 'callbackToConnectPct' },
  { label: 'Connect \u2192 Conversation', key: 'connectToConversationPct' },
  { label: 'Conversation \u2192 Meeting', key: 'conversationToMeetingPct' },
];

/**
 * Returns a Tailwind color class for a conversion rate value.
 * Green if > 20%, amber if 10-20%, red if < 10%.
 */
function getRateColor(value: number): string {
  if (value > 20) return 'text-green-600';
  if (value >= 10) return 'text-amber-600';
  return 'text-red-600';
}

/**
 * Returns a Tailwind background class for the rate indicator dot.
 */
function getRateDotColor(value: number): string {
  if (value > 20) return 'bg-green-500';
  if (value >= 10) return 'bg-amber-500';
  return 'bg-red-500';
}

/** Skeleton placeholder for a single card. */
function CardSkeleton({ wide }: { wide?: boolean }) {
  return (
    <div className={cn('rounded-lg border border-gray-200 bg-white p-4 animate-pulse', wide && 'col-span-1')}>
      <div className="h-4 w-20 bg-gray-200 rounded mb-3" />
      <div className="h-8 w-16 bg-gray-200 rounded" />
    </div>
  );
}

export function AnalyticsKPICards({ data, isLoading }: AnalyticsKPICardsProps) {
  if (isLoading || !data) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {countCards.map((c) => (
            <CardSkeleton key={c.key} />
          ))}
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {rateCards.map((r) => (
            <CardSkeleton key={r.key} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Row 1 -- Absolute Counts */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {countCards.map((card) => {
          const Icon = card.icon;
          const value = data[card.key] as number;
          return (
            <div
              key={card.key}
              className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm"
            >
              <div className="flex items-center gap-2 mb-2">
                <Icon className={cn('h-4 w-4', card.iconColor)} />
                <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                  {card.label}
                </span>
              </div>
              <p className="text-2xl font-semibold text-gray-900 tabular-nums">
                {value.toLocaleString()}
              </p>
            </div>
          );
        })}
      </div>

      {/* Row 2 -- Conversion Rates */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {rateCards.map((card) => {
          const value = data[card.key] as number;
          return (
            <div
              key={card.key}
              className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm"
            >
              <div className="flex items-center gap-2 mb-2">
                <TrendingUp className="h-4 w-4 text-gray-400" />
                <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                  {card.label}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className={cn('h-2.5 w-2.5 rounded-full', getRateDotColor(value))} />
                <p className={cn('text-2xl font-semibold tabular-nums', getRateColor(value))}>
                  {value.toFixed(1)}%
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
