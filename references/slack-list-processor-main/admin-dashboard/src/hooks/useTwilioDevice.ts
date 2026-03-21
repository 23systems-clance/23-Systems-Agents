import { useState, useEffect, useCallback, useRef } from 'react';
import { Call } from '@twilio/voice-sdk';
import { TwilioDeviceManager, type DeviceState } from '@/services/twilio-device';

export interface UseTwilioDeviceReturn {
  deviceState: DeviceState;
  activeCall: Call | null;
  activeWarnings: string[];
  warningCount: number;
  error: Error | null;
  connect: (params: Record<string, string>) => Promise<Call | null>;
  disconnect: () => void;
  setMuted: (muted: boolean) => void;
  isMuted: boolean;
  initialize: () => Promise<void>;
  destroy: () => void;
}

export function useTwilioDevice(): UseTwilioDeviceReturn {
  const managerRef = useRef<TwilioDeviceManager | null>(null);
  const [deviceState, setDeviceState] = useState<DeviceState>('offline');
  const [activeCall, setActiveCall] = useState<Call | null>(null);
  const [activeWarnings, setActiveWarnings] = useState<string[]>([]);
  const [isMuted, setIsMuted] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const initialize = useCallback(async () => {
    try {
      const manager = new TwilioDeviceManager();
      managerRef.current = manager;

      manager.on({
        onStateChange: (state) => {
          setDeviceState(state);
          if (state === 'ready') setActiveCall(null);
        },
        onError: (err) => setError(err),
      });

      await manager.initialize();
    } catch (err) {
      setError(err as Error);
    }
  }, []);

  const connect = useCallback(async (params: Record<string, string>): Promise<Call | null> => {
    if (!managerRef.current) return null;
    try {
      const call = await managerRef.current.connect(params);
      setActiveCall(call);
      setIsMuted(false);
      setActiveWarnings([]);

      // Listen for quality warnings on the call
      call.on('warning', (warningName: string) => {
        setActiveWarnings(prev => [...new Set([...prev, warningName])]);
      });
      call.on('warning-cleared', (warningName: string) => {
        setActiveWarnings(prev => prev.filter(w => w !== warningName));
      });
      call.on('disconnect', () => {
        setActiveCall(null);
        setActiveWarnings([]);
        setIsMuted(false);
      });

      return call;
    } catch (err) {
      setError(err as Error);
      return null;
    }
  }, []);

  const disconnect = useCallback(() => {
    managerRef.current?.disconnect();
    setActiveCall(null);
    setActiveWarnings([]);
    setIsMuted(false);
  }, []);

  const setMutedAction = useCallback((muted: boolean) => {
    managerRef.current?.setMuted(muted);
    setIsMuted(muted);
  }, []);

  const destroy = useCallback(() => {
    managerRef.current?.destroy();
    managerRef.current = null;
    setDeviceState('offline');
    setActiveCall(null);
    setActiveWarnings([]);
  }, []);

  useEffect(() => {
    return () => {
      managerRef.current?.destroy();
    };
  }, []);

  return {
    deviceState,
    activeCall,
    activeWarnings,
    warningCount: activeWarnings.length,
    error,
    connect,
    disconnect,
    setMuted: setMutedAction,
    isMuted,
    initialize,
    destroy,
  };
}
