import { useState, useCallback } from 'react';
import { Mic, CheckCircle, XCircle, AlertTriangle, Loader2 } from 'lucide-react';

type CheckStatus = 'pending' | 'checking' | 'pass' | 'warn' | 'fail';

interface Check {
  name: string;
  status: CheckStatus;
  message?: string;
}

interface PreCallCheckProps {
  onComplete: (allPassed: boolean) => void;
}

export function PreCallCheck({ onComplete }: PreCallCheckProps) {
  const [checks, setChecks] = useState<Check[]>([
    { name: 'Microphone Access', status: 'pending' },
    { name: 'Network Connectivity', status: 'pending' },
  ]);
  const [isRunning, setIsRunning] = useState(false);

  const updateCheck = useCallback((index: number, update: Partial<Check>) => {
    setChecks(prev => prev.map((c, i) => i === index ? { ...c, ...update } : c));
  }, []);

  const runChecks = useCallback(async () => {
    setIsRunning(true);

    // Check 1: Microphone access
    updateCheck(0, { status: 'checking' });
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(t => t.stop());
      updateCheck(0, { status: 'pass', message: 'Microphone available' });
    } catch {
      updateCheck(0, { status: 'fail', message: 'Microphone access denied' });
      setIsRunning(false);
      onComplete(false);
      return;
    }

    // Check 2: Network (simple connectivity test)
    updateCheck(1, { status: 'checking' });
    try {
      const start = performance.now();
      await fetch('/api/v1/health', { method: 'GET' });
      const rtt = Math.round(performance.now() - start);
      if (rtt > 400) {
        updateCheck(1, { status: 'warn', message: `High latency (${rtt}ms)` });
      } else {
        updateCheck(1, { status: 'pass', message: `RTT: ${rtt}ms` });
      }
    } catch {
      updateCheck(1, { status: 'warn', message: 'Could not measure latency' });
    }

    setIsRunning(false);
    const hasCriticalFailure = checks.some(c => c.status === 'fail');
    onComplete(!hasCriticalFailure);
  }, [updateCheck, onComplete, checks]);

  const StatusIcon = ({ status }: { status: CheckStatus }) => {
    switch (status) {
      case 'pass': return <CheckCircle className="w-4 h-4 text-emerald-500" />;
      case 'warn': return <AlertTriangle className="w-4 h-4 text-amber-500" />;
      case 'fail': return <XCircle className="w-4 h-4 text-red-500" />;
      case 'checking': return <Loader2 className="w-4 h-4 text-blue-500 animate-spin" />;
      default: return <div className="w-4 h-4 rounded-full border-2 border-gray-300" />;
    }
  };

  return (
    <div className="bg-white rounded-lg border p-6 max-w-sm mx-auto">
      <h3 className="text-lg font-semibold mb-4">Pre-Call System Check</h3>

      <div className="space-y-3 mb-6">
        {checks.map((check, i) => (
          <div key={i} className="flex items-center gap-3">
            <StatusIcon status={check.status} />
            <div>
              <p className="text-sm font-medium">{check.name}</p>
              {check.message && (
                <p className="text-xs text-muted-foreground">{check.message}</p>
              )}
            </div>
          </div>
        ))}
      </div>

      <button
        onClick={runChecks}
        disabled={isRunning}
        className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md transition-colors disabled:opacity-50"
      >
        {isRunning ? (
          <><Loader2 className="w-4 h-4 animate-spin" /> Checking...</>
        ) : (
          <><Mic className="w-4 h-4" /> Run Checks</>
        )}
      </button>
    </div>
  );
}
