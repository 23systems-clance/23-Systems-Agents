import { Phone, PhoneOff, Mic, MicOff, Bot, User as UserIcon, Building2, Briefcase } from 'lucide-react';
import { cn } from '@/lib/utils';
import { CallTimer } from './CallTimer';
import { CallQualityIndicator } from './CallQualityIndicator';
import type { UseCallTimerReturn } from '@/hooks/useCallTimer';
import type { QualityLevel } from '@/hooks/useCallQuality';

type FlowState = 'idle' | 'dialing' | 'ringing' | 'connected' | 'dispositioning' | 'completed';

interface DialerWidgetProps {
  contactName: string | null;
  contactPhone: string | null;
  companyName: string | null;
  jobTitle: string | null;
  flowState: FlowState;
  amdResult: string | null;
  isMuted: boolean;
  callTimer: UseCallTimerReturn;
  qualityLevel: QualityLevel;
  qualityWarningMessage: string | null;
  qualityWarningCount: number;
  onDial: () => void;
  onHangup: () => void;
  onToggleMute: () => void;
  isSessionActive: boolean;
}

export function DialerWidget({
  contactName,
  contactPhone,
  companyName,
  jobTitle,
  flowState,
  amdResult,
  isMuted,
  callTimer,
  qualityLevel,
  qualityWarningMessage,
  qualityWarningCount,
  onDial,
  onHangup,
  onToggleMute,
  isSessionActive,
}: DialerWidgetProps) {
  const isInCall = ['ringing', 'connected'].includes(flowState);

  return (
    <div className="flex flex-col items-center justify-center flex-1 p-8">
      {/* Contact Info */}
      {contactName ? (
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-4">
            <UserIcon className="w-8 h-8 text-gray-400" />
          </div>
          <h2 className="text-2xl font-bold">{contactName}</h2>
          {companyName && (
            <div className="flex items-center justify-center gap-1.5 mt-1 text-muted-foreground">
              <Building2 className="w-4 h-4" />
              <span>{companyName}</span>
            </div>
          )}
          {jobTitle && (
            <div className="flex items-center justify-center gap-1.5 mt-0.5 text-muted-foreground">
              <Briefcase className="w-4 h-4" />
              <span>{jobTitle}</span>
            </div>
          )}
          {contactPhone && (
            <p className="text-sm text-muted-foreground mt-1 font-mono">{contactPhone}</p>
          )}
        </div>
      ) : (
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-4">
            <Phone className="w-8 h-8 text-gray-300" />
          </div>
          <h2 className="text-xl font-medium text-muted-foreground">
            {isSessionActive ? 'Ready to dial' : 'No active session'}
          </h2>
        </div>
      )}

      {/* Status Indicators */}
      <div className="flex items-center gap-4 mb-6">
        {flowState === 'ringing' && (
          <span className="text-sm text-blue-600 font-medium animate-pulse">Ringing...</span>
        )}
        {flowState === 'connected' && (
          <CallTimer {...callTimer} />
        )}
        {flowState === 'dialing' && (
          <span className="text-sm text-gray-500">Initiating call...</span>
        )}
        {flowState === 'dispositioning' && (
          <span className="text-sm text-purple-600 font-medium">Submit disposition</span>
        )}
        {amdResult && isInCall && (
          <div className={cn(
            'flex items-center gap-1 px-2 py-1 rounded text-xs font-medium',
            amdResult === 'HUMAN' ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'
          )}>
            <Bot className="w-3 h-3" />
            {amdResult === 'HUMAN' ? 'Human' : 'Machine Detected'}
          </div>
        )}
        {isInCall && (
          <CallQualityIndicator
            qualityLevel={qualityLevel}
            warningMessage={qualityWarningMessage}
            warningCount={qualityWarningCount}
          />
        )}
      </div>

      {/* Call Controls */}
      <div className="flex items-center gap-4">
        {!isInCall && flowState !== 'dispositioning' && (
          <button
            onClick={onDial}
            disabled={!contactName || !isSessionActive || flowState === 'dialing'}
            className="w-16 h-16 rounded-full bg-emerald-500 hover:bg-emerald-600 text-white flex items-center justify-center transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-lg"
            title="Dial"
          >
            <Phone className="w-7 h-7" />
          </button>
        )}

        {isInCall && (
          <>
            <button
              onClick={onToggleMute}
              className={cn(
                'w-12 h-12 rounded-full flex items-center justify-center transition-colors shadow',
                isMuted
                  ? 'bg-red-100 text-red-600 hover:bg-red-200'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              )}
              title={isMuted ? 'Unmute' : 'Mute'}
            >
              {isMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
            </button>

            <button
              onClick={onHangup}
              className="w-16 h-16 rounded-full bg-red-500 hover:bg-red-600 text-white flex items-center justify-center transition-colors shadow-lg"
              title="Hang Up"
            >
              <PhoneOff className="w-7 h-7" />
            </button>
          </>
        )}
      </div>
    </div>
  );
}
