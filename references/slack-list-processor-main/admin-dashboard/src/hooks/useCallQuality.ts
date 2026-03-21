import { useMemo } from 'react';

export type QualityLevel = 'good' | 'warning' | 'poor';

export interface UseCallQualityReturn {
  qualityLevel: QualityLevel;
  activeWarnings: string[];
  warningCount: number;
  warningMessage: string | null;
}

/** Derive call quality level from raw Twilio SDK warnings. */
export function useCallQuality(activeWarnings: string[]): UseCallQualityReturn {
  const qualityLevel = useMemo<QualityLevel>(() => {
    if (activeWarnings.length === 0) return 'good';
    // Red: high-latency, low-mos, or packet-loss warnings
    const criticalWarnings = ['high-rtt', 'low-mos', 'high-packet-loss', 'high-jitter'];
    if (activeWarnings.some(w => criticalWarnings.includes(w))) return 'poor';
    return 'warning';
  }, [activeWarnings]);

  const warningMessage = useMemo(() => {
    if (qualityLevel === 'poor') return 'Poor connection — check your network';
    if (qualityLevel === 'warning') return 'Connection quality degraded';
    return null;
  }, [qualityLevel]);

  return {
    qualityLevel,
    activeWarnings,
    warningCount: activeWarnings.length,
    warningMessage,
  };
}
