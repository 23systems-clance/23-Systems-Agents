import { Device, Call } from '@twilio/voice-sdk';
import { fetchToken } from './dialer-api';

export type DeviceState = 'offline' | 'ready' | 'busy';

export interface DeviceEvents {
  onStateChange: (state: DeviceState) => void;
  onError: (error: Error) => void;
  onIncomingCall: (call: Call) => void;
}

/** Wraps @twilio/voice-sdk Device for the power dialer. */
export class TwilioDeviceManager {
  private device: Device | null = null;
  private currentCall: Call | null = null;
  private events: Partial<DeviceEvents> = {};
  private tokenRefreshTimer: ReturnType<typeof setTimeout> | null = null;

  /** Initialize and register the Device. */
  async initialize(): Promise<void> {
    const { token } = await fetchToken();

    this.device = new Device(token, {
      codecPreferences: [Call.Codec.Opus, Call.Codec.PCMU],
      maxAverageBitrate: 16000,
      dscp: true,
      edge: ['ashburn', 'sao-paulo'],
      logLevel: 1,
    });

    this.device.on('registered', () => {
      this.events.onStateChange?.('ready');
    });

    this.device.on('error', (error: any) => {
      this.events.onError?.(error);
    });

    this.device.on('tokenWillExpire', async () => {
      try {
        const { token: newToken } = await fetchToken();
        this.device?.updateToken(newToken);
      } catch (err) {
        this.events.onError?.(err as Error);
      }
    });

    this.device.on('unregistered', () => {
      this.events.onStateChange?.('offline');
    });

    await this.device.register();
  }

  /** Connect to a conference room. */
  async connect(params: Record<string, string>): Promise<Call> {
    if (!this.device) throw new Error('Device not initialized');

    this.events.onStateChange?.('busy');
    const call = await this.device.connect({ params });
    this.currentCall = call;

    call.on('disconnect', () => {
      this.currentCall = null;
      this.events.onStateChange?.('ready');
    });

    call.on('error', (error: any) => {
      this.events.onError?.(error);
    });

    return call;
  }

  /** Disconnect the current call. */
  disconnect(): void {
    this.currentCall?.disconnect();
    this.currentCall = null;
  }

  /** Mute/unmute the local mic. */
  setMuted(muted: boolean): void {
    this.currentCall?.mute(muted);
  }

  /** Check if currently muted. */
  isMuted(): boolean {
    return this.currentCall?.isMuted() ?? false;
  }

  /** Get the current active call. */
  getActiveCall(): Call | null {
    return this.currentCall;
  }

  /** Set event listeners. */
  on(events: Partial<DeviceEvents>): void {
    this.events = { ...this.events, ...events };
  }

  /** Clean up. */
  destroy(): void {
    if (this.tokenRefreshTimer) clearTimeout(this.tokenRefreshTimer);
    this.currentCall?.disconnect();
    this.device?.destroy();
    this.device = null;
    this.currentCall = null;
  }
}
