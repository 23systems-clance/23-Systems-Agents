import { useState } from 'react';
import { MessageSquare, Send } from 'lucide-react';
import { CallbackScheduler } from './CallbackScheduler';

type DispositionType =
  | 'CONNECTED_INTERESTED'
  | 'CONNECTED_NOT_INTERESTED'
  | 'CONNECTED_CALLBACK_REQUESTED'
  | 'CONNECTED_WRONG_PERSON'
  | 'CONNECTED_DO_NOT_CALL'
  | 'NO_ANSWER'
  | 'VOICEMAIL_LEFT'
  | 'BUSY'
  | 'GATEKEEPER'
  | 'DO_NOT_CALL';

interface DispositionModalProps {
  isOpen: boolean;
  contactName: string;
  companyName: string | null;
  callSessionId: string | null;
  onSubmit: (disposition: DispositionType, notes?: string) => void;
  onScheduleCallback?: (callSessionId: string, scheduledAt: string, notes?: string) => void;
}

const dispositionOptions: Array<{ value: DispositionType; label: string; shortcut: string; color: string }> = [
  { value: 'CONNECTED_INTERESTED', label: 'Connected - Interested', shortcut: '1', color: 'bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100' },
  { value: 'CONNECTED_NOT_INTERESTED', label: 'Connected - Not Interested', shortcut: '2', color: 'bg-gray-50 border-gray-200 text-gray-700 hover:bg-gray-100' },
  { value: 'CONNECTED_CALLBACK_REQUESTED', label: 'Callback Requested', shortcut: '3', color: 'bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100' },
  { value: 'CONNECTED_WRONG_PERSON', label: 'Wrong Person', shortcut: '4', color: 'bg-amber-50 border-amber-200 text-amber-700 hover:bg-amber-100' },
  { value: 'NO_ANSWER', label: 'No Answer', shortcut: '5', color: 'bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100' },
  { value: 'VOICEMAIL_LEFT', label: 'Left Voicemail', shortcut: '6', color: 'bg-purple-50 border-purple-200 text-purple-700 hover:bg-purple-100' },
  { value: 'BUSY', label: 'Busy', shortcut: '7', color: 'bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100' },
  { value: 'GATEKEEPER', label: 'Gatekeeper', shortcut: '8', color: 'bg-orange-50 border-orange-200 text-orange-700 hover:bg-orange-100' },
  { value: 'DO_NOT_CALL', label: 'Do Not Call', shortcut: '9', color: 'bg-red-50 border-red-200 text-red-700 hover:bg-red-100' },
];

export function DispositionModal({ isOpen, contactName, companyName, callSessionId, onSubmit, onScheduleCallback }: DispositionModalProps) {
  const [selectedDisposition, setSelectedDisposition] = useState<DispositionType | null>(null);
  const [notes, setNotes] = useState('');
  const [isScheduling, setIsScheduling] = useState(false);

  if (!isOpen) return null;

  const isCallbackSelected = selectedDisposition === 'CONNECTED_CALLBACK_REQUESTED';

  const handleSubmit = () => {
    if (!selectedDisposition) return;
    // If callback requested, the CallbackScheduler handles submission
    if (isCallbackSelected) return;
    onSubmit(selectedDisposition, notes || undefined);
    setSelectedDisposition(null);
    setNotes('');
  };

  const handleCallbackSchedule = async (scheduledAt: string, callbackNotes?: string) => {
    if (!callSessionId || !onScheduleCallback) return;
    setIsScheduling(true);
    try {
      await onScheduleCallback(callSessionId, scheduledAt, callbackNotes);
      onSubmit('CONNECTED_CALLBACK_REQUESTED', notes || undefined);
      setSelectedDisposition(null);
      setNotes('');
    } finally {
      setIsScheduling(false);
    }
  };

  // Keyboard shortcuts
  const handleKeyDown = (e: React.KeyboardEvent) => {
    const option = dispositionOptions.find(o => o.shortcut === e.key);
    if (option) {
      setSelectedDisposition(option.value);
    }
    if (e.key === 'Enter' && selectedDisposition) {
      handleSubmit();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onKeyDown={handleKeyDown} tabIndex={-1}>
      <div className="bg-white rounded-lg shadow-xl w-full max-w-lg mx-4 overflow-hidden">
        <div className="px-6 py-4 border-b">
          <h2 className="text-lg font-semibold">Call Disposition</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            {contactName}{companyName ? ` at ${companyName}` : ''}
          </p>
        </div>

        <div className="px-6 py-4 space-y-3">
          <div className="grid grid-cols-1 gap-2">
            {dispositionOptions.map((option) => (
              <button
                key={option.value}
                onClick={() => setSelectedDisposition(option.value)}
                className={`flex items-center justify-between px-3 py-2 text-sm rounded-md border transition-colors ${
                  selectedDisposition === option.value
                    ? 'ring-2 ring-blue-500 ' + option.color
                    : option.color
                }`}
              >
                <span>{option.label}</span>
                <kbd className="text-xs bg-white/50 px-1.5 py-0.5 rounded border">{option.shortcut}</kbd>
              </button>
            ))}
          </div>

          <div className="pt-2">
            <label className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground mb-1.5">
              <MessageSquare className="w-3.5 h-3.5" />
              Notes (optional)
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Add call notes..."
              rows={2}
              className="w-full px-3 py-2 text-sm border rounded-md resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Inline callback scheduler when "Callback Requested" is selected */}
          {isCallbackSelected && (
            <div className="pt-1">
              <CallbackScheduler
                onSchedule={handleCallbackSchedule}
                isSubmitting={isScheduling}
              />
            </div>
          )}
        </div>

        {/* Submit button — hidden when callback scheduler is shown (scheduler has its own submit) */}
        {!isCallbackSelected && (
          <div className="px-6 py-3 border-t bg-gray-50 flex justify-end">
            <button
              onClick={handleSubmit}
              disabled={!selectedDisposition}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Send className="w-3.5 h-3.5" />
              Submit & Next
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
