import { cn } from '@/lib/utils';
import { Signal, SignalLow, SignalZero } from 'lucide-react';

type QualityLevel = 'good' | 'warning' | 'poor';

interface CallQualityIndicatorProps {
  qualityLevel: QualityLevel;
  warningMessage: string | null;
  warningCount: number;
}

export function CallQualityIndicator({ qualityLevel, warningMessage, warningCount }: CallQualityIndicatorProps) {
  const Icon = qualityLevel === 'good' ? Signal : qualityLevel === 'warning' ? SignalLow : SignalZero;

  return (
    <div className="relative group">
      <div className={cn(
        'flex items-center gap-1 px-2 py-1 rounded text-xs font-medium',
        qualityLevel === 'good' && 'text-emerald-600',
        qualityLevel === 'warning' && 'text-amber-600',
        qualityLevel === 'poor' && 'text-red-600 animate-pulse',
      )}>
        <Icon className="w-4 h-4" />
        {warningCount > 0 && <span>{warningCount}</span>}
      </div>
      {warningMessage && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-1.5 bg-gray-900 text-white text-xs rounded shadow-lg whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
          {warningMessage}
        </div>
      )}
    </div>
  );
}
