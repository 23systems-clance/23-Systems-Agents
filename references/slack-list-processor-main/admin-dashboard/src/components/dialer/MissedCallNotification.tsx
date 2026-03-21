import { PhoneIncoming, PhoneMissed, X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface MissedCallNotificationProps {
  contactName: string;
  contactPhone: string;
  companyName: string | null;
  missedAt: string;
  onCallBack: () => void;
  onDismiss: () => void;
}

/**
 * Real-time toast notification shown when an inbound call is missed
 * during an active dialer session. Renders in the top-right corner
 * with animated slide-in entrance.
 *
 * Distinct from CallbackReminder which handles scheduled/due callbacks.
 * This component is for immediate missed-inbound alerts from the webhook.
 */
export function MissedCallNotification({
  contactName,
  contactPhone,
  companyName,
  missedAt,
  onCallBack,
  onDismiss,
}: MissedCallNotificationProps) {
  const formattedTime = new Date(missedAt).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <div
      className={cn(
        'fixed top-6 right-6 z-50 w-80',
        'animate-in slide-in-from-top-4 fade-in duration-300',
      )}
    >
      <div className="rounded-lg shadow-lg border border-orange-200 bg-white overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2.5 bg-orange-50">
          <div className="flex items-center gap-2">
            <PhoneMissed className="w-4 h-4 text-orange-500" />
            <span className="text-sm font-semibold text-gray-900">
              Missed Inbound Call
            </span>
          </div>
          <button
            onClick={onDismiss}
            className="p-0.5 text-gray-400 hover:text-gray-600 rounded transition-colors"
            title="Dismiss"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Contact info */}
        <div className="px-4 py-3 space-y-1">
          <p className="text-sm font-medium text-gray-900">{contactName}</p>
          {companyName && (
            <p className="text-xs text-gray-500">{companyName}</p>
          )}
          <div className="flex items-center justify-between">
            <p className="text-xs text-gray-400 font-mono">{contactPhone}</p>
            <p className="text-xs text-gray-400">{formattedTime}</p>
          </div>
        </div>

        {/* Action */}
        <div className="px-4 py-3 border-t bg-gray-50">
          <button
            onClick={onCallBack}
            className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-green-600 hover:bg-green-700 rounded-md transition-colors"
          >
            <PhoneIncoming className="w-3.5 h-3.5" />
            Call Back Now
          </button>
        </div>
      </div>
    </div>
  );
}
