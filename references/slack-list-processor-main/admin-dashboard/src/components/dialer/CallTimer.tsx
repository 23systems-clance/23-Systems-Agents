import { cn } from '@/lib/utils';
import { Timer, CheckCircle } from 'lucide-react';

interface CallTimerProps {
  elapsedSeconds: number;
  remainingSeconds: number;
  timerElapsed: boolean;
  isRunning: boolean;
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export function CallTimer({ elapsedSeconds, remainingSeconds, timerElapsed, isRunning }: CallTimerProps) {
  if (!isRunning) return null;

  return (
    <div className="flex items-center gap-3">
      <div className={cn(
        'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-mono font-medium',
        timerElapsed
          ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
          : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 animate-pulse'
      )}>
        {timerElapsed ? (
          <CheckCircle className="w-4 h-4" />
        ) : (
          <Timer className="w-4 h-4" />
        )}
        <span>{timerElapsed ? 'Connected' : formatTime(remainingSeconds)}</span>
      </div>
      <span className="text-sm text-muted-foreground font-mono">
        {formatTime(elapsedSeconds)}
      </span>
    </div>
  );
}
