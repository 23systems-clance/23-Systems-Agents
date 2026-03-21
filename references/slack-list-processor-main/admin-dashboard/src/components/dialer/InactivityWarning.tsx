import { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { AlertTriangle } from 'lucide-react';

interface InactivityWarningProps {
  onDismiss: () => void;
  remainingSeconds: number;
}

/** Formats seconds into M:SS display string. */
function formatCountdown(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/** Fixed-position warning banner shown before auto-session-end due to inactivity. */
export function InactivityWarning({ onDismiss, remainingSeconds }: InactivityWarningProps) {
  const [secondsLeft, setSecondsLeft] = useState(remainingSeconds);

  useEffect(() => {
    setSecondsLeft(remainingSeconds);
  }, [remainingSeconds]);

  useEffect(() => {
    if (secondsLeft <= 0) return;

    const interval = setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [secondsLeft]);

  const isUrgent = secondsLeft <= 60;

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 w-full max-w-lg">
      <div
        className={cn(
          'flex items-center gap-3 px-4 py-3 rounded-lg shadow-lg border',
          isUrgent
            ? 'bg-red-50 border-red-200 text-red-800'
            : 'bg-amber-50 border-amber-200 text-amber-800',
        )}
      >
        <AlertTriangle
          className={cn(
            'w-5 h-5 shrink-0',
            isUrgent ? 'text-red-500 animate-pulse' : 'text-amber-500',
          )}
        />

        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium">Session ending due to inactivity</p>
          <p className="text-xs mt-0.5 opacity-80">
            Auto-ending in{' '}
            <span className="font-mono font-semibold">{formatCountdown(secondsLeft)}</span>
          </p>
        </div>

        <button
          onClick={onDismiss}
          className={cn(
            'inline-flex items-center px-3 py-1.5 text-sm font-medium rounded-md transition-colors shrink-0',
            isUrgent
              ? 'bg-red-600 text-white hover:bg-red-700'
              : 'bg-amber-600 text-white hover:bg-amber-700',
          )}
        >
          I'm still here
        </button>
      </div>
    </div>
  );
}
