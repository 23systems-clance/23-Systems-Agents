import { useState, useEffect, useCallback, useRef } from 'react';
import { dialerApi } from '@/lib/dialer-api-client';

interface AudioDevice {
  deviceId: string;
  label: string;
}

interface DevicePreferences {
  microphoneId: string;
  speakerId: string;
}

interface UseAudioDevicesReturn {
  microphones: AudioDevice[];
  speakers: AudioDevice[];
  selectedMic: string;
  selectedSpeaker: string;
  selectMic: (deviceId: string) => void;
  selectSpeaker: (deviceId: string) => void;
  micLevel: number;
  isTesting: boolean;
  startMicTest: () => void;
  stopMicTest: () => void;
  error: string | null;
  isLoading: boolean;
}

/**
 * Enumerate browser media devices and manage audio device selection.
 *
 * Loads saved preferences from the server, persists changes on selection,
 * and provides a mic test with real-time volume level monitoring.
 * Handles device disconnect/reconnect via the 'devicechange' event.
 */
export function useAudioDevices(): UseAudioDevicesReturn {
  const [microphones, setMicrophones] = useState<AudioDevice[]>([]);
  const [speakers, setSpeakers] = useState<AudioDevice[]>([]);
  const [selectedMic, setSelectedMic] = useState<string>('');
  const [selectedSpeaker, setSelectedSpeaker] = useState<string>('');
  const [micLevel, setMicLevel] = useState<number>(0);
  const [isTesting, setIsTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  /** Enumerate audio input/output devices from the browser. */
  const enumerateDevices = useCallback(async (): Promise<{
    mics: AudioDevice[];
    spks: AudioDevice[];
  }> => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();

      const mics = devices
        .filter((d) => d.kind === 'audioinput')
        .map((d) => ({
          deviceId: d.deviceId,
          label: d.label || `Microphone (${d.deviceId.slice(0, 8)})`,
        }));

      const spks = devices
        .filter((d) => d.kind === 'audiooutput')
        .map((d) => ({
          deviceId: d.deviceId,
          label: d.label || `Speaker (${d.deviceId.slice(0, 8)})`,
        }));

      setMicrophones(mics);
      setSpeakers(spks);
      setError(null);

      return { mics, spks };
    } catch (err: any) {
      setError(err.message || 'Failed to enumerate audio devices');
      return { mics: [], spks: [] };
    }
  }, []);

  /** Load saved device preferences from the server. */
  const loadPreferences = useCallback(async (): Promise<DevicePreferences | null> => {
    try {
      const { data } = await dialerApi.get<DevicePreferences>('/device/preferences');
      return data;
    } catch {
      // No saved preferences is not an error condition.
      return null;
    }
  }, []);

  /** Persist device preferences to the server. */
  const savePreferences = useCallback(
    async (micId: string, speakerId: string) => {
      try {
        await dialerApi.post('/device/preferences', {
          microphoneId: micId,
          speakerId,
        });
      } catch {
        // Preference save failures are non-fatal; the user can still make calls.
      }
    },
    []
  );

  /** Select a microphone and persist the preference. */
  const selectMic = useCallback(
    (deviceId: string) => {
      setSelectedMic(deviceId);
      savePreferences(deviceId, selectedSpeaker);
    },
    [selectedSpeaker, savePreferences]
  );

  /** Select a speaker and persist the preference. */
  const selectSpeaker = useCallback(
    (deviceId: string) => {
      setSelectedSpeaker(deviceId);
      savePreferences(selectedMic, deviceId);
    },
    [selectedMic, savePreferences]
  );

  /** Stop mic test and release all media resources. */
  const stopMicTest = useCallback(() => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }

    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {
        // Ignore close errors on already-closed contexts.
      });
      audioContextRef.current = null;
    }

    analyserRef.current = null;
    setMicLevel(0);
    setIsTesting(false);
  }, []);

  /**
   * Start a mic test: capture audio from the selected mic, create an
   * AudioContext with an AnalyserNode, and update micLevel (0-100) via
   * requestAnimationFrame.
   */
  const startMicTest = useCallback(async () => {
    // Stop any existing test first
    stopMicTest();

    try {
      const constraints: MediaStreamConstraints = {
        audio: selectedMic
          ? { deviceId: { exact: selectedMic } }
          : true,
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      mediaStreamRef.current = stream;

      const audioContext = new AudioContext();
      audioContextRef.current = audioContext;

      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.8;
      source.connect(analyser);
      analyserRef.current = analyser;

      setIsTesting(true);
      setError(null);

      const dataArray = new Uint8Array(analyser.frequencyBinCount);

      /** Continuously sample volume and update micLevel. */
      const updateLevel = () => {
        if (!analyserRef.current) return;

        analyserRef.current.getByteFrequencyData(dataArray);

        // Compute average amplitude across frequency bins
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          sum += dataArray[i];
        }
        const average = sum / dataArray.length;

        // Normalize to 0-100 scale (byte values are 0-255)
        const level = Math.min(100, Math.round((average / 255) * 100 * 2.5));
        setMicLevel(level);

        animationFrameRef.current = requestAnimationFrame(updateLevel);
      };

      animationFrameRef.current = requestAnimationFrame(updateLevel);
    } catch (err: any) {
      setError(err.message || 'Microphone access denied');
      setIsTesting(false);
    }
  }, [selectedMic, stopMicTest]);

  // --- Initial setup: enumerate devices and load preferences ---
  useEffect(() => {
    let cancelled = false;

    const init = async () => {
      setIsLoading(true);

      // Request mic permission so device labels are populated
      try {
        const tempStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        tempStream.getTracks().forEach((t) => t.stop());
      } catch {
        // Permission denied — enumerateDevices will still work but labels
        // may be empty.
      }

      const { mics, spks } = await enumerateDevices();
      if (cancelled) return;

      const prefs = await loadPreferences();
      if (cancelled) return;

      // Apply saved preferences, falling back to first available device
      if (prefs?.microphoneId && mics.some((m) => m.deviceId === prefs.microphoneId)) {
        setSelectedMic(prefs.microphoneId);
      } else if (mics.length > 0) {
        setSelectedMic(mics[0].deviceId);
      }

      if (prefs?.speakerId && spks.some((s) => s.deviceId === prefs.speakerId)) {
        setSelectedSpeaker(prefs.speakerId);
      } else if (spks.length > 0) {
        setSelectedSpeaker(spks[0].deviceId);
      }

      setIsLoading(false);
    };

    init();

    return () => {
      cancelled = true;
    };
  }, [enumerateDevices, loadPreferences]);

  // --- Listen for device changes (connect/disconnect) ---
  useEffect(() => {
    const handleDeviceChange = async () => {
      const { mics, spks } = await enumerateDevices();

      // If the currently selected mic was disconnected, fall back
      if (selectedMic && !mics.some((m) => m.deviceId === selectedMic)) {
        const fallback = mics.length > 0 ? mics[0].deviceId : '';
        setSelectedMic(fallback);
        setError('Selected microphone was disconnected');
      }

      // If the currently selected speaker was disconnected, fall back
      if (selectedSpeaker && !spks.some((s) => s.deviceId === selectedSpeaker)) {
        const fallback = spks.length > 0 ? spks[0].deviceId : '';
        setSelectedSpeaker(fallback);
        setError('Selected speaker was disconnected');
      }
    };

    navigator.mediaDevices.addEventListener('devicechange', handleDeviceChange);

    return () => {
      navigator.mediaDevices.removeEventListener('devicechange', handleDeviceChange);
    };
  }, [selectedMic, selectedSpeaker, enumerateDevices]);

  // --- Cleanup mic test on unmount ---
  useEffect(() => {
    return () => {
      stopMicTest();
    };
  }, [stopMicTest]);

  return {
    microphones,
    speakers,
    selectedMic,
    selectedSpeaker,
    selectMic,
    selectSpeaker,
    micLevel,
    isTesting,
    startMicTest,
    stopMicTest,
    error,
    isLoading,
  };
}
