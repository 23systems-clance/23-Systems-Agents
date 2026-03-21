import { Play, Pause, Square, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SessionControlsProps {
  sessionStatus: 'ACTIVE' | 'PAUSED' | 'COMPLETED' | null;
  totalDialed: number;
  totalConnected: number;
  totalVoicemail: number;
  totalNoAnswer: number;
  queuePosition: number;
  queueTotal: number;
  sessionDuration: string;
  onPause: () => void;
  onResume: () => void;
  onEnd: () => void;
  isDialing: boolean;
}

export function SessionControls({
  sessionStatus,
  totalDialed,
  totalConnected,
  totalVoicemail,
  totalNoAnswer,
  queuePosition,
  queueTotal,
  sessionDuration,
  onPause,
  onResume,
  onEnd,
  isDialing,
}: SessionControlsProps) {
  return (
    <div className="flex items-center justify-between px-4 py-3 bg-white border-b">
      <div className="flex items-center gap-6">
        <div className="flex items-center gap-2">
          <div className={cn(
            'w-2 h-2 rounded-full',
            sessionStatus === 'ACTIVE' ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'
          )} />
          <span className="text-sm font-medium">
            {sessionStatus === 'ACTIVE' ? 'Active' : sessionStatus === 'PAUSED' ? 'Paused' : 'Session'}
          </span>
        </div>
        <div className="flex items-center gap-1 text-sm text-muted-foreground">
          <Clock className="w-3.5 h-3.5" />
          <span>{sessionDuration}</span>
        </div>
        <span className="text-sm text-muted-foreground">
          {queuePosition} / {queueTotal}
        </span>
      </div>

      <div className="flex items-center gap-4">
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span>Dialed: <strong className="text-foreground">{totalDialed}</strong></span>
          <span>Connected: <strong className="text-emerald-600">{totalConnected}</strong></span>
          <span>VM: <strong className="text-amber-600">{totalVoicemail}</strong></span>
          <span>No Answer: <strong className="text-gray-500">{totalNoAnswer}</strong></span>
        </div>

        <div className="flex items-center gap-2">
          {sessionStatus === 'ACTIVE' ? (
            <button
              onClick={onPause}
              disabled={isDialing}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-amber-700 bg-amber-50 hover:bg-amber-100 rounded-md transition-colors disabled:opacity-50"
            >
              <Pause className="w-3.5 h-3.5" />
              Pause
            </button>
          ) : sessionStatus === 'PAUSED' ? (
            <button
              onClick={onResume}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded-md transition-colors"
            >
              <Play className="w-3.5 h-3.5" />
              Resume
            </button>
          ) : null}
          <button
            onClick={onEnd}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-red-700 bg-red-50 hover:bg-red-100 rounded-md transition-colors"
          >
            <Square className="w-3.5 h-3.5" />
            End Session
          </button>
        </div>
      </div>
    </div>
  );
}
