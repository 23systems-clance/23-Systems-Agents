import { useState } from 'react';
import { cn } from '@/lib/utils';
import { ChevronDown, ChevronRight, ShieldAlert, RotateCcw, UserX, PhoneOff, Ban } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

interface UncallableContact {
  id: string;
  contactName: string;
  contactPhone: string;
  companyName: string | null;
  reason: 'DNC' | 'REMOVED' | 'INVALID_NUMBER' | 'OPTED_OUT';
  removedAt: string;
}

interface UncallableSectionProps {
  uncallables: UncallableContact[];
  onReAdd: (itemId: string) => void;
  isReAdding: boolean;
}

/** Configuration for each uncallable reason: display label, icon, and badge styling. */
const reasonConfig: Record<
  UncallableContact['reason'],
  { label: string; icon: typeof Ban; badgeClass: string }
> = {
  DNC: {
    label: 'DNC',
    icon: ShieldAlert,
    badgeClass: 'bg-red-100 text-red-700 border-red-200',
  },
  REMOVED: {
    label: 'Removed',
    icon: UserX,
    badgeClass: 'bg-gray-100 text-gray-700 border-gray-200',
  },
  INVALID_NUMBER: {
    label: 'Invalid Number',
    icon: PhoneOff,
    badgeClass: 'bg-amber-100 text-amber-700 border-amber-200',
  },
  OPTED_OUT: {
    label: 'Opted Out',
    icon: Ban,
    badgeClass: 'bg-orange-100 text-orange-700 border-orange-200',
  },
};

/** Collapsible section displaying contacts that cannot be dialed, with optional re-add action. */
export function UncallableSection({ uncallables, onReAdd, isReAdding }: UncallableSectionProps) {
  const [isOpen, setIsOpen] = useState(false);

  if (uncallables.length === 0) return null;

  return (
    <div className="border-t">
      {/* Collapsible header */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center justify-between w-full px-4 py-3 text-left hover:bg-gray-50 transition-colors"
      >
        <div className="flex items-center gap-2">
          {isOpen ? (
            <ChevronDown className="w-4 h-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="w-4 h-4 text-muted-foreground" />
          )}
          <ShieldAlert className="w-4 h-4 text-red-500" />
          <span className="text-sm font-semibold text-muted-foreground">Uncallable</span>
        </div>
        <Badge variant="secondary" className="text-xs">
          {uncallables.length}
        </Badge>
      </button>

      {/* Contact list */}
      {isOpen && (
        <div className="border-t bg-gray-50/50">
          {uncallables.map((contact) => {
            const config = reasonConfig[contact.reason];
            const ReasonIcon = config.icon;

            return (
              <div
                key={contact.id}
                className="px-4 py-3 border-b last:border-b-0 flex items-start justify-between"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <ReasonIcon className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                    <span className="text-sm font-medium truncate">{contact.contactName}</span>
                    <Badge
                      variant="outline"
                      className={cn('text-[10px] px-1.5 py-0', config.badgeClass)}
                    >
                      {config.label}
                    </Badge>
                  </div>
                  {contact.companyName && (
                    <span className="text-xs text-muted-foreground ml-5.5 block mt-0.5 truncate">
                      {contact.companyName}
                    </span>
                  )}
                  <span className="text-xs text-muted-foreground ml-5.5 block mt-0.5">
                    {contact.contactPhone}
                  </span>
                </div>

                {contact.reason === 'REMOVED' && (
                  <button
                    onClick={() => onReAdd(contact.id)}
                    disabled={isReAdding}
                    className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-md transition-colors disabled:opacity-50 shrink-0 ml-2"
                    title="Re-add prospect to queue"
                  >
                    <RotateCcw className={cn('w-3 h-3', isReAdding && 'animate-spin')} />
                    Re-add
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
