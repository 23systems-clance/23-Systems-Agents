import { Mic, Speaker, Volume2, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Represents an audio input or output device. */
interface AudioDevice {
  deviceId: string;
  label: string;
}

/** Props for the AudioDevicePicker component. */
interface AudioDevicePickerProps {
  /** Available microphone devices. */
  microphones: AudioDevice[];
  /** Available speaker devices. */
  speakers: AudioDevice[];
  /** Currently selected microphone device ID. */
  selectedMic: string;
  /** Currently selected speaker device ID. */
  selectedSpeaker: string;
  /** Callback when microphone selection changes. */
  onSelectMic: (deviceId: string) => void;
  /** Callback when speaker selection changes. */
  onSelectSpeaker: (deviceId: string) => void;
  /** Current microphone input level (0-100). */
  micLevel: number;
  /** Whether the microphone test is currently active. */
  isTesting: boolean;
  /** Start the microphone test. */
  onTestMic: () => void;
  /** Stop the microphone test. */
  onStopTest: () => void;
  /** Error message to display, or null if no error. */
  error: string | null;
}

/**
 * Audio device picker for the power dialer settings panel.
 * Provides microphone and speaker selection dropdowns, a mic test button
 * with volume meter visualization, and error display for missing devices.
 */
export function AudioDevicePicker({
  microphones,
  speakers,
  selectedMic,
  selectedSpeaker,
  onSelectMic,
  onSelectSpeaker,
  micLevel,
  isTesting,
  onTestMic,
  onStopTest,
  error,
}: AudioDevicePickerProps) {
  const clampedLevel = Math.max(0, Math.min(100, micLevel));

  return (
    <div className="space-y-4">
      {/* Error alert */}
      {error && (
        <div className="flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Microphone selector */}
      <div className="space-y-1.5">
        <label
          htmlFor="mic-select"
          className="flex items-center gap-1.5 text-sm font-medium text-gray-700"
        >
          <Mic className="h-4 w-4" />
          Microphone
        </label>
        <select
          id="mic-select"
          value={selectedMic}
          onChange={(e) => onSelectMic(e.target.value)}
          disabled={microphones.length === 0}
          className={cn(
            'w-full rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm',
            'focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500',
            'disabled:cursor-not-allowed disabled:opacity-50',
          )}
        >
          {microphones.length === 0 ? (
            <option value="">No microphones found</option>
          ) : (
            microphones.map((device) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label || `Microphone (${device.deviceId.slice(0, 8)})`}
              </option>
            ))
          )}
        </select>
      </div>

      {/* Speaker selector */}
      <div className="space-y-1.5">
        <label
          htmlFor="speaker-select"
          className="flex items-center gap-1.5 text-sm font-medium text-gray-700"
        >
          <Speaker className="h-4 w-4" />
          Speaker
        </label>
        <select
          id="speaker-select"
          value={selectedSpeaker}
          onChange={(e) => onSelectSpeaker(e.target.value)}
          disabled={speakers.length === 0}
          className={cn(
            'w-full rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm',
            'focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500',
            'disabled:cursor-not-allowed disabled:opacity-50',
          )}
        >
          {speakers.length === 0 ? (
            <option value="">No speakers found</option>
          ) : (
            speakers.map((device) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label || `Speaker (${device.deviceId.slice(0, 8)})`}
              </option>
            ))
          )}
        </select>
      </div>

      {/* Mic test section */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={isTesting ? onStopTest : onTestMic}
            disabled={microphones.length === 0}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
              'disabled:cursor-not-allowed disabled:opacity-50',
              isTesting
                ? 'bg-red-100 text-red-700 hover:bg-red-200'
                : 'bg-blue-100 text-blue-700 hover:bg-blue-200',
            )}
          >
            <Volume2 className="h-4 w-4" />
            {isTesting ? 'Stop Test' : 'Test Mic'}
          </button>

          {isTesting && (
            <span className="text-xs text-gray-500">Listening...</span>
          )}
        </div>

        {/* Volume meter */}
        {isTesting && (
          <div className="h-2 w-full overflow-hidden rounded-full bg-gray-200">
            <div
              className={cn(
                'h-full rounded-full transition-all duration-75',
                clampedLevel > 75
                  ? 'bg-red-500'
                  : clampedLevel > 40
                    ? 'bg-amber-500'
                    : 'bg-emerald-500',
              )}
              style={{ width: `${clampedLevel}%` }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
