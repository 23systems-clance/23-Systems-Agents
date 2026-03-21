import { cn } from '@/lib/utils';
import { Phone, SkipForward, User, Building2, CheckCircle, XCircle, Clock } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { UncallableSection } from './UncallableSection';
import type { UncallableContact } from '@/services/dialer-api';

interface QueueItem {
  id: string;
  position: number;
  status: 'PENDING' | 'DIALING' | 'COMPLETED' | 'SKIPPED';
  contactName: string;
  contactEmail: string | null;
  contactPhone: string;
  companyName: string | null;
  jobTitle: string | null;
}

interface DialerQueueProps {
  items: QueueItem[];
  currentIndex: number;
  onSkip: (itemId: string) => void;
  isDialing: boolean;
  uncallables?: UncallableContact[];
  onReAdd?: (itemId: string) => void;
  isReAdding?: boolean;
}

const statusConfig: Record<string, { icon: typeof CheckCircle; color: string; label: string }> = {
  PENDING: { icon: Clock, color: 'text-gray-400', label: 'Pending' },
  DIALING: { icon: Phone, color: 'text-blue-500 animate-pulse', label: 'Dialing' },
  COMPLETED: { icon: CheckCircle, color: 'text-emerald-500', label: 'Done' },
  SKIPPED: { icon: XCircle, color: 'text-gray-400', label: 'Skipped' },
};

export function DialerQueue({ items, currentIndex, onSkip, isDialing, uncallables, onReAdd, isReAdding }: DialerQueueProps) {
  const currentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    currentRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [currentIndex]);

  const totalRemaining = items.filter(i => i.status === 'PENDING').length;

  return (
    <div className="flex flex-col h-full bg-white border-l">
      <div className="px-4 py-3 border-b">
        <h3 className="text-sm font-semibold">Call Queue</h3>
        <p className="text-xs text-muted-foreground mt-0.5">{totalRemaining} remaining</p>
      </div>
      <div className="flex-1 overflow-y-auto">
        {items.map((item, idx) => {
          const isCurrent = idx === currentIndex;
          const config = statusConfig[item.status] || statusConfig.PENDING;
          const StatusIcon = config.icon;

          return (
            <div
              key={item.id}
              ref={isCurrent ? currentRef : undefined}
              className={cn(
                'px-4 py-3 border-b transition-colors',
                isCurrent && 'bg-blue-50 border-l-2 border-l-blue-500',
                item.status === 'COMPLETED' && 'opacity-50',
                item.status === 'SKIPPED' && 'opacity-40',
              )}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <StatusIcon className={cn('w-3.5 h-3.5 shrink-0', config.color)} />
                    <span className="text-sm font-medium truncate">{item.contactName}</span>
                  </div>
                  {item.companyName && (
                    <div className="flex items-center gap-1.5 mt-1 ml-5.5">
                      <Building2 className="w-3 h-3 text-muted-foreground" />
                      <span className="text-xs text-muted-foreground truncate">{item.companyName}</span>
                    </div>
                  )}
                  {item.jobTitle && (
                    <div className="flex items-center gap-1.5 mt-0.5 ml-5.5">
                      <User className="w-3 h-3 text-muted-foreground" />
                      <span className="text-xs text-muted-foreground truncate">{item.jobTitle}</span>
                    </div>
                  )}
                  <div className="flex items-center gap-1.5 mt-0.5 ml-5.5">
                    <Phone className="w-3 h-3 text-muted-foreground" />
                    <span className="text-xs text-muted-foreground">{item.contactPhone}</span>
                  </div>
                </div>
                {item.status === 'PENDING' && !isCurrent && (
                  <button
                    onClick={() => onSkip(item.id)}
                    disabled={isDialing}
                    className="p-1 text-gray-400 hover:text-gray-600 disabled:opacity-50"
                    title="Skip contact"
                  >
                    <SkipForward className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          );
        })}

        {/* Uncallable contacts section */}
        {uncallables && uncallables.length > 0 && onReAdd && (
          <UncallableSection
            uncallables={uncallables}
            onReAdd={onReAdd}
            isReAdding={isReAdding ?? false}
          />
        )}
      </div>
    </div>
  );
}
