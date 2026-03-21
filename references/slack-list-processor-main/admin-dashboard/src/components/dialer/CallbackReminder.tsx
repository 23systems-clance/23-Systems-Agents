import { Phone, Clock, X, PhoneIncoming, Bell } from 'lucide-react';
import { cn } from '@/lib/utils';

interface CallbackReminderProps {
  callback: {
    id: string;
    contactName: string;
    contactPhone: string;
    companyName: string | null;
    type: 'SCHEDULED' | 'MISSED_INBOUND';
    notes: string | null;
  };
  onCallBack: (callbackId: string) => void;
  onSnooze: (callbackId: string) => void;
  onDismiss: (callbackId: string) => void;
}

/**
 * Fixed-position toast notification shown when a callback is due.
 * Renders in the bottom-right corner with animated slide-up entrance.
 */
export function CallbackReminder({ callback, onCallBack, onSnooze, onDismiss }: CallbackReminderProps) {
  const isMissedInbound = callback.type === 'MISSED_INBOUND';

  return (
    <div
      className={cn(
        'fixed bottom-6 right-6 z-50 w-80',
        'animate-in slide-in-from-bottom-4 fade-in duration-300',
      )}
    >
      <div
        className={cn(
          'rounded-lg shadow-lg border bg-white overflow-hidden',
          isMissedInbound ? 'border-orange-200' : 'border-blue-200',
        )}
      >
        {/* Header */}
        <div
          className={cn(
            'flex items-center justify-between px-4 py-2.5',
            isMissedInbound ? 'bg-orange-50' : 'bg-blue-50',
          )}
        >
          <div className="flex items-center gap-2">
            <Bell
              className={cn(
                'w-4 h-4 animate-pulse',
                isMissedInbound ? 'text-orange-500' : 'text-blue-500',
              )}
            />
            <span className="text-sm font-semibold text-gray-900">Callback Due</span>
          </div>

          {/* Type badge */}
          <span
            className={cn(
              'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
              isMissedInbound
                ? 'bg-orange-100 text-orange-700'
                : 'bg-blue-100 text-blue-700',
            )}
          >
            {isMissedInbound ? (
              <>
                <PhoneIncoming className="w-3 h-3" />
                Missed Call
              </>
            ) : (
              <>
                <Clock className="w-3 h-3" />
                Scheduled
              </>
            )}
          </span>
        </div>

        {/* Contact info */}
        <div className="px-4 py-3 space-y-1">
          <p className="text-sm font-medium text-gray-900">{callback.contactName}</p>
          {callback.companyName && (
            <p className="text-xs text-gray-500">{callback.companyName}</p>
          )}
          <p className="text-xs text-gray-400 font-mono">{callback.contactPhone}</p>
          {callback.notes && (
            <p className="text-xs text-gray-500 mt-1.5 italic line-clamp-2">
              {callback.notes}
            </p>
          )}
        </div>

        {/* Actions */}
        <div className="px-4 py-3 border-t bg-gray-50 flex gap-2">
          <button
            onClick={() => onCallBack(callback.id)}
            className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-green-600 hover:bg-green-700 rounded-md transition-colors"
          >
            <Phone className="w-3.5 h-3.5" />
            Call Back
          </button>
          <button
            onClick={() => onSnooze(callback.id)}
            className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-md transition-colors"
          >
            <Clock className="w-3.5 h-3.5" />
            5 min
          </button>
          <button
            onClick={() => onDismiss(callback.id)}
            className="inline-flex items-center justify-center p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-200 rounded-md transition-colors"
            title="Dismiss"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
