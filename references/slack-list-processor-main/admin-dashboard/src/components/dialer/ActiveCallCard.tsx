/**
 * ActiveCallCard Component (T057 - US4 Manager Call Monitoring)
 *
 * Displays an active call with BDR info, contact details, live duration,
 * and Listen/Barge action buttons for manager monitoring.
 */

import { useState, useEffect } from 'react';

interface ActiveCall {
  callSessionId: string;
  bdrName: string;
  contactName: string;
  companyName: string | null;
  contactPhone: string;
  status: string;
  durationSeconds: number;
  dialedAt: string;
  conferenceSid: string | null;
}

interface ActiveCallCardProps {
  call: ActiveCall;
  onListen: (callSessionId: string) => void;
  onBarge: (callSessionId: string) => void;
  isListening: boolean;
}

/**
 * Format seconds into MM:SS display.
 */
function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

export function ActiveCallCard({ call, onListen, onBarge, isListening }: ActiveCallCardProps) {
  const [liveDuration, setLiveDuration] = useState(call.durationSeconds);

  // Live duration counter
  useEffect(() => {
    setLiveDuration(call.durationSeconds);
    const interval = setInterval(() => {
      setLiveDuration((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, [call.durationSeconds, call.callSessionId]);

  const statusColor = call.status === 'CONNECTED'
    ? 'bg-green-100 text-green-800'
    : call.status === 'RINGING'
      ? 'bg-yellow-100 text-yellow-800'
      : 'bg-gray-100 text-gray-800';

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
      {/* Header: BDR name + status */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-full bg-blue-100 flex items-center justify-center text-sm font-medium text-blue-700">
            {call.bdrName.charAt(0).toUpperCase()}
          </div>
          <span className="font-medium text-sm text-gray-900">{call.bdrName}</span>
        </div>
        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${statusColor}`}>
          {call.status === 'CONNECTED' && (
            <span className="mr-1 h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />
          )}
          {call.status}
        </span>
      </div>

      {/* Contact info */}
      <div className="mb-3 space-y-1">
        <p className="text-sm font-medium text-gray-900">{call.contactName}</p>
        {call.companyName && (
          <p className="text-xs text-gray-500">{call.companyName}</p>
        )}
        <p className="text-xs text-gray-400 font-mono">{call.contactPhone}</p>
      </div>

      {/* Duration */}
      <div className="mb-3">
        <p className="text-lg font-mono font-semibold text-gray-900 tabular-nums">
          {formatDuration(liveDuration)}
        </p>
      </div>

      {/* Actions */}
      <div className="flex gap-2">
        <button
          onClick={() => onListen(call.callSessionId)}
          disabled={isListening}
          className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
            isListening
              ? 'bg-blue-600 text-white'
              : 'bg-blue-50 text-blue-700 hover:bg-blue-100'
          }`}
        >
          {isListening ? 'Listening...' : 'Listen'}
        </button>
        {isListening && (
          <button
            onClick={() => onBarge(call.callSessionId)}
            className="flex-1 rounded-md bg-orange-50 px-3 py-1.5 text-xs font-medium text-orange-700 hover:bg-orange-100 transition-colors"
          >
            Barge In
          </button>
        )}
      </div>
    </div>
  );
}
