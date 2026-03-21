/**
 * SalesfloorCard Component (T102 - Power Dialer Phase 11)
 *
 * Displays a single BDR status card in the salesfloor grid, showing
 * real-time status, current contact, live call duration, session stats,
 * and manager Listen/Barge action buttons.
 */

import { useState, useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import {
  Phone,
  PhoneOutgoing,
  ClipboardList,
  Clock,
  Pause,
  Headphones,
  PhoneForwarded,
} from 'lucide-react';
import type { BdrStatusCard, BdrStatus } from '@/services/salesfloor-api';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface SalesfloorCardProps {
  /** BDR status card data from the salesfloor API. */
  card: BdrStatusCard;
  /** Callback when the manager clicks "Listen". */
  onListen?: (callSessionId: string, conferenceName: string) => void;
  /** Callback when the manager clicks "Barge". */
  onBarge?: (callSessionId: string, conferenceName: string) => void;
}

// ---------------------------------------------------------------------------
// Status configuration lookup
// ---------------------------------------------------------------------------

interface StatusConfig {
  borderColor: string;
  bgColor: string;
  badgeColor: string;
  icon: React.ElementType;
  label: string;
  pulse: boolean;
}

const STATUS_CONFIG: Record<BdrStatus, StatusConfig> = {
  ON_CALL: {
    borderColor: 'border-l-green-500',
    bgColor: 'bg-green-50',
    badgeColor: 'bg-green-100 text-green-800',
    icon: Phone,
    label: 'On Call',
    pulse: false,
  },
  RINGING: {
    borderColor: 'border-l-blue-500',
    bgColor: 'bg-blue-50',
    badgeColor: 'bg-blue-100 text-blue-800',
    icon: PhoneOutgoing,
    label: 'Ringing',
    pulse: true,
  },
  DISPOSITIONING: {
    borderColor: 'border-l-amber-500',
    bgColor: 'bg-amber-50',
    badgeColor: 'bg-amber-100 text-amber-800',
    icon: ClipboardList,
    label: 'Disposition',
    pulse: false,
  },
  IDLE: {
    borderColor: 'border-l-gray-300',
    bgColor: 'bg-white',
    badgeColor: 'bg-gray-100 text-gray-700',
    icon: Clock,
    label: 'Idle',
    pulse: false,
  },
  PAUSED: {
    borderColor: 'border-l-orange-400',
    bgColor: 'bg-orange-50',
    badgeColor: 'bg-orange-100 text-orange-800',
    icon: Pause,
    label: 'Paused',
    pulse: false,
  },
  OFFLINE: {
    borderColor: 'border-l-gray-200',
    bgColor: 'bg-gray-50',
    badgeColor: 'bg-gray-100 text-gray-500',
    icon: Clock,
    label: 'Offline',
    pulse: false,
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Avatar background colors, cycled by initial letter. */
const AVATAR_COLORS = [
  'bg-blue-100 text-blue-700',
  'bg-emerald-100 text-emerald-700',
  'bg-purple-100 text-purple-700',
  'bg-amber-100 text-amber-700',
  'bg-rose-100 text-rose-700',
  'bg-cyan-100 text-cyan-700',
];

/** Pick a deterministic avatar color from the initial letter. */
function avatarColor(initial: string): string {
  const code = initial.toUpperCase().charCodeAt(0) - 65;
  return AVATAR_COLORS[Math.abs(code) % AVATAR_COLORS.length];
}

/** Format seconds into M:SS display. */
function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Live duration hook (derived from callStartedAt)
// ---------------------------------------------------------------------------

/** Compute live elapsed seconds from an ISO timestamp. */
function useLiveDuration(callStartedAt: string | null): number {
  const [elapsed, setElapsed] = useState<number>(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!callStartedAt) {
      setElapsed(0);
      return;
    }

    const startMs = new Date(callStartedAt).getTime();

    /** Recalculate elapsed from the wall clock. */
    const tick = () => {
      const now = Date.now();
      setElapsed(Math.max(0, Math.floor((now - startMs) / 1000)));
    };

    tick();
    intervalRef.current = setInterval(tick, 1000);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [callStartedAt]);

  return elapsed;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SalesfloorCard({ card, onListen, onBarge }: SalesfloorCardProps) {
  const config = STATUS_CONFIG[card.status];
  const Icon = config.icon;

  const liveSeconds = useLiveDuration(card.callStartedAt);
  const showContact = card.status === 'ON_CALL' || card.status === 'RINGING';
  const showActions = card.status === 'ON_CALL' && card.activeCallSessionId && card.conferenceName;

  return (
    <div
      className={cn(
        'w-[280px] rounded-lg border border-l-4 p-3 shadow-sm transition-all',
        config.borderColor,
        config.bgColor,
        card.status === 'OFFLINE' && 'opacity-60',
        card.isIdleWarning && 'ring-2 ring-amber-400 ring-offset-1 animate-pulse',
      )}
    >
      {/* ---- Header: avatar, name, status badge ---- */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <div
            className={cn(
              'h-8 w-8 shrink-0 rounded-full flex items-center justify-center text-sm font-semibold',
              avatarColor(card.avatarInitial),
            )}
          >
            {card.avatarInitial.toUpperCase()}
          </div>
          <span className="text-sm font-medium text-gray-900 truncate">
            {card.bdrName}
          </span>
        </div>

        <span
          className={cn(
            'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium shrink-0',
            config.badgeColor,
            config.pulse && 'animate-pulse',
          )}
        >
          <Icon className="h-3 w-3" />
          {config.label}
        </span>
      </div>

      {/* ---- Current contact (ON_CALL / RINGING only) ---- */}
      {showContact && card.currentContact && (
        <div className="mb-2 space-y-0.5">
          <p className="text-sm font-semibold text-gray-900 truncate">
            {card.currentContact.name}
          </p>
          {card.currentContact.company && (
            <p className="text-xs text-gray-500 truncate">
              {card.currentContact.company}
            </p>
          )}
          <p className="text-xs text-gray-400 font-mono">
            {card.currentContact.phone}
          </p>
        </div>
      )}

      {/* ---- Live call duration ---- */}
      {showContact && card.callStartedAt && (
        <div className="mb-2">
          <p className="text-lg font-mono font-semibold text-gray-900 tabular-nums">
            {formatDuration(liveSeconds)}
          </p>
        </div>
      )}

      {/* ---- Idle warning label ---- */}
      {card.isIdleWarning && card.idleMinutes != null && (
        <div className="mb-2">
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-200 px-2 py-0.5 text-[11px] font-medium text-amber-800">
            <Clock className="h-3 w-3" />
            Idle {card.idleMinutes}m
          </span>
        </div>
      )}

      {/* ---- Session stats row ---- */}
      <div className="flex items-center gap-3 text-[11px] text-gray-500 mb-2">
        <span>
          <span className="font-medium text-gray-700">{card.sessionStats.dialsToday}</span>{' '}
          Dials
        </span>
        <span>
          <span className="font-medium text-gray-700">{card.sessionStats.connectsToday}</span>{' '}
          Connects
        </span>
        <span>
          <span className="font-medium text-gray-700">{card.sessionStats.queueRemaining}</span>{' '}
          Queue
        </span>
      </div>

      {/* ---- Listen / Barge action buttons ---- */}
      {showActions && (
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => onListen?.(card.activeCallSessionId!, card.conferenceName!)}
            className="flex-1 inline-flex items-center justify-center gap-1 rounded-md bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100 transition-colors"
          >
            <Headphones className="h-3.5 w-3.5" />
            Listen
          </button>
          <button
            type="button"
            onClick={() => onBarge?.(card.activeCallSessionId!, card.conferenceName!)}
            className="flex-1 inline-flex items-center justify-center gap-1 rounded-md bg-orange-50 px-3 py-1.5 text-xs font-medium text-orange-700 hover:bg-orange-100 transition-colors"
          >
            <PhoneForwarded className="h-3.5 w-3.5" />
            Barge
          </button>
        </div>
      )}
    </div>
  );
}
