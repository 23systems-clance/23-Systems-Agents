import { useState } from 'react';
import { Calendar, Clock, FileText } from 'lucide-react';
import { cn } from '@/lib/utils';

interface CallbackSchedulerProps {
  onSchedule: (scheduledAt: string, notes?: string) => void;
  isSubmitting?: boolean;
}

/**
 * Round the current time up to the next full hour.
 * Returns a time string in HH:MM format.
 */
function getDefaultTime(): string {
  const now = new Date();
  now.setHours(now.getHours() + 1, 0, 0, 0);
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

/** Get today's date in YYYY-MM-DD format for the date input default. */
function getDefaultDate(): string {
  const now = new Date();
  return now.toISOString().split('T')[0];
}

/**
 * Compact callback scheduling form designed to render inline
 * within the DispositionModal when "Callback Requested" is selected.
 */
export function CallbackScheduler({ onSchedule, isSubmitting = false }: CallbackSchedulerProps) {
  const [date, setDate] = useState(getDefaultDate);
  const [time, setTime] = useState(getDefaultTime);
  const [notes, setNotes] = useState('');

  const handleSubmit = () => {
    if (!date || !time) return;
    const scheduledAt = new Date(`${date}T${time}:00`).toISOString();
    onSchedule(scheduledAt, notes || undefined);
  };

  return (
    <div className="space-y-3 rounded-md border border-blue-200 bg-blue-50/50 p-3">
      <p className="text-xs font-medium text-blue-700 uppercase tracking-wide">
        Schedule Callback
      </p>

      {/* Date & Time row */}
      <div className="flex gap-2">
        <div className="flex-1">
          <label className="flex items-center gap-1 text-xs font-medium text-gray-600 mb-1">
            <Calendar className="w-3 h-3" />
            Date
          </label>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            min={getDefaultDate()}
            className={cn(
              'w-full px-2 py-1.5 text-sm border rounded-md',
              'focus:outline-none focus:ring-2 focus:ring-blue-500',
            )}
          />
        </div>
        <div className="flex-1">
          <label className="flex items-center gap-1 text-xs font-medium text-gray-600 mb-1">
            <Clock className="w-3 h-3" />
            Time
          </label>
          <input
            type="time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            className={cn(
              'w-full px-2 py-1.5 text-sm border rounded-md',
              'focus:outline-none focus:ring-2 focus:ring-blue-500',
            )}
          />
        </div>
      </div>

      {/* Notes */}
      <div>
        <label className="flex items-center gap-1 text-xs font-medium text-gray-600 mb-1">
          <FileText className="w-3 h-3" />
          Notes (optional)
        </label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Reason for callback, talking points..."
          rows={2}
          className={cn(
            'w-full px-2 py-1.5 text-sm border rounded-md resize-none',
            'focus:outline-none focus:ring-2 focus:ring-blue-500',
          )}
        />
      </div>

      {/* Submit */}
      <button
        onClick={handleSubmit}
        disabled={!date || !time || isSubmitting}
        className={cn(
          'w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium rounded-md transition-colors',
          'bg-blue-600 text-white hover:bg-blue-700',
          'disabled:opacity-50 disabled:cursor-not-allowed',
        )}
      >
        <Calendar className="w-3.5 h-3.5" />
        {isSubmitting ? 'Scheduling...' : 'Schedule Callback'}
      </button>
    </div>
  );
}
