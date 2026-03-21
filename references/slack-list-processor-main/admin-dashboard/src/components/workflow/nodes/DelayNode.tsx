import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import { Clock } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Data shape for a delay node. */
type DelayNodeData = {
  type: 'DELAY';
  delaySeconds?: number;
  label?: string;
  description?: string;
};

type DelayNodeType = Node<DelayNodeData, 'DELAY'>;

const ACCENT = '#475569';

/**
 * Formats a duration in seconds into a human-readable short string.
 * Examples: 30 -> "30s", 300 -> "5m", 3600 -> "1h", 86400 -> "1d"
 */
function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h`;
  return `${Math.round(seconds / 86400)}d`;
}

/**
 * DelayNode represents a timed pause in the workflow.
 * Clean Pipeline style: centered icon, slate accent, rounded-2xl card.
 */
function DelayNode({ data, selected }: NodeProps<DelayNodeType>) {
  const duration = data.delaySeconds != null
    ? formatDuration(data.delaySeconds)
    : data.label ?? 'Delay';
  const description = (data.description as string) ?? '';

  return (
    <div
      className={cn(
        'bg-white rounded-2xl min-w-[220px] max-w-[280px] border-2 transition-all',
        selected ? 'border-teal-500 shadow-xl shadow-teal-500/10' : 'border-gray-100 shadow-md'
      )}
    >
      <Handle
        type="target"
        position={Position.Top}
        className="!w-3 !h-3 !rounded-full !border-2 !border-white"
        style={{ background: ACCENT }}
      />

      <div className="p-4">
        {/* Centered icon */}
        <div className="flex items-center justify-center mb-3">
          <div className="rounded-2xl p-3 bg-slate-100">
            <Clock className="h-6 w-6 text-slate-600" />
          </div>
        </div>

        {/* Label */}
        <p className="text-sm font-bold text-gray-900 text-center">{duration}</p>

        {/* Type badge */}
        <div className="flex justify-center mt-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-wide px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-700">
            Delay
          </span>
        </div>

        {/* Description */}
        {description && (
          <p className="text-xs text-gray-400 mt-2 text-center leading-relaxed line-clamp-2">{description}</p>
        )}
      </div>

      <Handle
        type="source"
        position={Position.Bottom}
        className="!w-3 !h-3 !rounded-full !border-2 !border-white"
        style={{ background: ACCENT }}
      />
    </div>
  );
}

export default DelayNode;
