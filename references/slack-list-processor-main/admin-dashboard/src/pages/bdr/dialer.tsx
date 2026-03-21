import { useState, useEffect, useCallback } from 'react';
import { useTwilioDevice } from '@/hooks/useTwilioDevice';
import { useDialerSession } from '@/hooks/useDialerSession';
import { useCallTimer } from '@/hooks/useCallTimer';
import { useCallQuality } from '@/hooks/useCallQuality';
import { useInactivityTimeout } from '@/hooks/useInactivityTimeout';
import { useAudioDevices } from '@/hooks/useAudioDevices';
import { useCallbackReminders } from '@/hooks/useCallbackReminders';
import { SessionControls } from '@/components/dialer/SessionControls';
import { DialerWidget } from '@/components/dialer/DialerWidget';
import { DialerQueue } from '@/components/dialer/DialerQueue';
import { DispositionModal } from '@/components/dialer/DispositionModal';
import { PreCallCheck } from '@/components/dialer/PreCallCheck';
import { InactivityWarning } from '@/components/dialer/InactivityWarning';
import { AudioDevicePicker } from '@/components/dialer/AudioDevicePicker';
import { CallbackReminder } from '@/components/dialer/CallbackReminder';
import * as dialerApi from '@/services/dialer-api';
import * as callbacksApi from '@/services/callbacks-api';
import type { DispositionType, UncallableContact } from '@/services/dialer-api';

/** Format seconds into MM:SS or HH:MM:SS. */
function formatDuration(totalSeconds: number): string {
  const hrs = Math.floor(totalSeconds / 3600);
  const mins = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;
  if (hrs > 0) return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export default function DialerPage() {
  const device = useTwilioDevice();
  const session = useDialerSession();
  const callTimer = useCallTimer(45);
  const quality = useCallQuality(device.activeWarnings);

  const audioDevices = useAudioDevices();

  // Callback reminders — handles "Call Back" by inserting contact at front of queue
  const handleCallBackFromReminder = useCallback(async (callbackId: string) => {
    if (!session.session?.id) return;
    try {
      await callbacksApi.insertCallbackInQueue(callbackId, session.session.id);
      await session.refreshSession();
    } catch {
      // Non-fatal: reminder will remain visible
    }
  }, [session]);

  const callbackReminders = useCallbackReminders({
    sessionId: session.session?.id ?? null,
    onCallBack: handleCallBackFromReminder,
  });

  const [preCheckPassed, setPreCheckPassed] = useState(false);
  const [sessionElapsed, setSessionElapsed] = useState(0);
  const [uncallables, setUncallables] = useState<UncallableContact[]>([]);
  const [isReAdding, setIsReAdding] = useState(false);
  const [showDeviceSettings, setShowDeviceSettings] = useState(false);

  // Inactivity timeout
  const inactivity = useInactivityTimeout({
    sessionId: session.session?.id ?? null,
    sessionStatus: session.session?.status ?? null,
    onTimeout: async () => {
      device.disconnect();
      await session.completeSession();
    },
  });

  // Session elapsed timer
  useEffect(() => {
    if (!session.session) {
      setSessionElapsed(0);
      return;
    }
    const startedAt = new Date(session.session.startedAt).getTime();
    const interval = setInterval(() => {
      setSessionElapsed(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [session.session?.startedAt]);

  // Check for existing active session on mount
  useEffect(() => {
    session.refreshSession();
  }, []);

  // Initialize device after pre-check passes
  useEffect(() => {
    if (preCheckPassed && device.deviceState === 'offline') {
      device.initialize();
    }
  }, [preCheckPassed]);

  // Track call status changes from backend
  useEffect(() => {
    if (session.flowState === 'connected' && !callTimer.isRunning) {
      callTimer.start();
    }
    if (session.flowState !== 'connected' && session.flowState !== 'ringing') {
      callTimer.reset();
    }
  }, [session.flowState]);

  // Fetch uncallable contacts when session is active
  useEffect(() => {
    if (!session.session?.id) {
      setUncallables([]);
      return;
    }
    dialerApi.getUncallables(session.session.id).then(setUncallables).catch(() => {});
  }, [session.session?.id]);

  const handleReAdd = useCallback(async (itemId: string) => {
    if (!session.session?.id) return;
    setIsReAdding(true);
    try {
      await dialerApi.reAddProspect(session.session.id, itemId);
      await session.refreshSession();
      const updated = await dialerApi.getUncallables(session.session.id);
      setUncallables(updated);
    } finally {
      setIsReAdding(false);
    }
  }, [session]);

  const handleDial = useCallback(async () => {
    inactivity.recordActivity();
    const call = await session.dialNext();
    if (call) {
      // Connect BDR's browser to the conference via WebRTC
      await device.connect({ ConferenceName: call.conferenceName });
    }
  }, [session, device, inactivity]);

  const handleHangup = useCallback(async () => {
    device.disconnect();
    await session.hangup();
  }, [session, device]);

  const handleToggleMute = useCallback(() => {
    device.setMuted(!device.isMuted);
  }, [device]);

  const handleScheduleCallback = useCallback(async (callSessionId: string, scheduledAt: string, notes?: string) => {
    await callbacksApi.scheduleCallback(callSessionId, scheduledAt, notes);
  }, []);

  const handleDisposition = useCallback(async (disposition: DispositionType, notes?: string) => {
    inactivity.recordActivity();
    await session.submitDisposition(disposition, notes);
  }, [session, inactivity]);

  const handleCompleteSession = useCallback(async () => {
    device.disconnect();
    await session.completeSession();
  }, [session, device]);

  // Pre-check screen
  if (!preCheckPassed && !session.session) {
    return (
      <div className="flex items-center justify-center h-full bg-gray-50">
        <PreCallCheck onComplete={(passed) => setPreCheckPassed(passed)} />
      </div>
    );
  }

  // Session completed summary
  if (session.flowState === 'completed' && session.sessionStats) {
    const stats = session.sessionStats;
    return (
      <div className="flex items-center justify-center h-full bg-gray-50">
        <div className="bg-white rounded-lg border p-8 max-w-md w-full text-center space-y-6">
          <h2 className="text-2xl font-bold">Session Complete</h2>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div className="bg-gray-50 rounded-lg p-3">
              <p className="text-muted-foreground">Total Dialed</p>
              <p className="text-2xl font-bold">{stats.totalDialed}</p>
            </div>
            <div className="bg-emerald-50 rounded-lg p-3">
              <p className="text-muted-foreground">Connected</p>
              <p className="text-2xl font-bold text-emerald-600">{stats.totalConnected}</p>
            </div>
            <div className="bg-amber-50 rounded-lg p-3">
              <p className="text-muted-foreground">Voicemail</p>
              <p className="text-2xl font-bold text-amber-600">{stats.totalVoicemail}</p>
            </div>
            <div className="bg-gray-50 rounded-lg p-3">
              <p className="text-muted-foreground">No Answer</p>
              <p className="text-2xl font-bold text-gray-500">{stats.totalNoAnswer}</p>
            </div>
          </div>
          <div className="text-sm text-muted-foreground space-y-1">
            <p>Connect Rate: <strong>{stats.connectRate.toFixed(1)}%</strong></p>
            <p>Avg Talk Time: <strong>{Math.round(stats.avgTalkTimeSeconds)}s</strong></p>
            <p>Duration: <strong>{stats.sessionDurationMinutes.toFixed(1)} min</strong></p>
          </div>
          <button
            onClick={() => window.location.reload()}
            className="px-6 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md transition-colors"
          >
            Start New Session
          </button>
        </div>
      </div>
    );
  }

  // No session yet — show start button
  if (!session.session) {
    return (
      <div className="flex items-center justify-center h-full bg-gray-50">
        <div className="bg-white rounded-lg border p-8 max-w-sm w-full text-center space-y-4">
          <h2 className="text-xl font-bold">Power Dialer</h2>
          <p className="text-sm text-muted-foreground">
            Start a dialing session from your campaign queue.
          </p>
          <button
            onClick={() => session.startSession('campaign')}
            disabled={session.isLoading || device.deviceState === 'offline'}
            className="w-full px-4 py-2.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md transition-colors disabled:opacity-50"
          >
            {session.isLoading ? 'Starting...' : 'Start Session'}
          </button>
          {session.error && (
            <p className="text-xs text-red-500">{session.error}</p>
          )}
          {device.deviceState === 'offline' && (
            <p className="text-xs text-amber-500">Connecting to phone system...</p>
          )}
        </div>
      </div>
    );
  }

  // Active session layout
  const queueItems = session.session.queue || [];
  const currentIndex = session.session.currentIndex ?? 0;

  return (
    <div className="flex flex-col h-full">
      {/* Session header */}
      <SessionControls
        sessionStatus={session.session.status as 'ACTIVE' | 'PAUSED' | 'COMPLETED'}
        totalDialed={session.session.totalDialed}
        totalConnected={session.session.totalConnected}
        totalVoicemail={session.session.totalVoicemail}
        totalNoAnswer={session.session.totalNoAnswer}
        queuePosition={currentIndex + 1}
        queueTotal={queueItems.length}
        sessionDuration={formatDuration(sessionElapsed)}
        onPause={() => session.pauseSession()}
        onResume={() => session.resumeSession()}
        onEnd={handleCompleteSession}
        isDialing={session.flowState === 'dialing' || session.flowState === 'ringing'}
      />

      {/* Main content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Dialer widget (center) */}
        <DialerWidget
          contactName={session.currentQueueItem?.contactName ?? null}
          contactPhone={session.currentQueueItem?.contactPhone ?? null}
          companyName={session.currentQueueItem?.companyName ?? null}
          jobTitle={session.currentQueueItem?.jobTitle ?? null}
          flowState={session.flowState}
          amdResult={session.currentCall?.amdResult ?? null}
          isMuted={device.isMuted}
          callTimer={callTimer}
          qualityLevel={quality.qualityLevel}
          qualityWarningMessage={quality.warningMessage}
          qualityWarningCount={quality.warningCount}
          onDial={handleDial}
          onHangup={handleHangup}
          onToggleMute={handleToggleMute}
          isSessionActive={session.session.status === 'ACTIVE'}
        />

        {/* Queue sidebar */}
        <div className="w-80 shrink-0">
          <DialerQueue
            items={queueItems}
            currentIndex={currentIndex}
            onSkip={(itemId) => session.skipContact(itemId)}
            isDialing={['dialing', 'ringing', 'connected'].includes(session.flowState)}
            uncallables={uncallables}
            onReAdd={handleReAdd}
            isReAdding={isReAdding}
          />
        </div>
      </div>

      {/* Disposition modal */}
      <DispositionModal
        isOpen={session.flowState === 'dispositioning'}
        contactName={session.currentCall?.contactName ?? ''}
        companyName={session.currentCall?.companyName ?? null}
        callSessionId={session.currentCall?.id ?? null}
        onSubmit={handleDisposition}
        onScheduleCallback={handleScheduleCallback}
      />

      {/* Inactivity warning overlay */}
      {inactivity.showWarning && (
        <InactivityWarning
          onDismiss={inactivity.dismissWarning}
          remainingSeconds={inactivity.remainingSeconds}
        />
      )}

      {/* Audio device settings panel (toggled from session controls or settings) */}
      {showDeviceSettings && (
        <div className="absolute top-16 right-4 z-40 w-80 bg-white rounded-lg border shadow-lg p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold">Audio Settings</h3>
            <button
              onClick={() => setShowDeviceSettings(false)}
              className="text-gray-400 hover:text-gray-600 text-sm"
            >
              Close
            </button>
          </div>
          <AudioDevicePicker
            microphones={audioDevices.microphones}
            speakers={audioDevices.speakers}
            selectedMic={audioDevices.selectedMic}
            selectedSpeaker={audioDevices.selectedSpeaker}
            onSelectMic={audioDevices.selectMic}
            onSelectSpeaker={audioDevices.selectSpeaker}
            micLevel={audioDevices.micLevel}
            isTesting={audioDevices.isTesting}
            onTestMic={audioDevices.startMicTest}
            onStopTest={audioDevices.stopMicTest}
            error={audioDevices.error}
          />
        </div>
      )}

      {/* Callback reminder toasts */}
      {callbackReminders.activeReminders.length > 0 && (
        <CallbackReminder
          callback={callbackReminders.activeReminders[0]}
          onCallBack={(id) => {
            handleCallBackFromReminder(id);
            callbackReminders.dismissReminder(id);
          }}
          onSnooze={callbackReminders.snoozeReminder}
          onDismiss={callbackReminders.dismissReminder}
        />
      )}

      {/* Error banner */}
      {session.error && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 px-4 py-2 bg-red-100 text-red-700 text-sm rounded-lg shadow">
          {session.error}
        </div>
      )}
    </div>
  );
}
