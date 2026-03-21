import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import { Zap, Webhook } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Data shape for a workflow trigger node. */
type TriggerNodeData = {
  type: 'TRIGGER';
  triggerType?: string;
  label?: string;
  description?: string;
};

type TriggerNodeType = Node<TriggerNodeData, 'TRIGGER'>;

const ACCENT = '#0d9488';

/**
 * TriggerNode renders the starting point of a workflow.
 * Clean Pipeline style: centered icon, teal accent, rounded-2xl card.
 */
function TriggerNode({ data, selected }: NodeProps<TriggerNodeType>) {
  const triggerLabel = data.label ?? data.triggerType ?? 'Trigger';
  const description = (data.description as string) ?? '';
  const isWebhook = data.triggerType === 'WEBHOOK';
  const Icon = isWebhook ? Webhook : Zap;

  return (
    <div
      className={cn(
        'bg-white rounded-2xl min-w-[220px] max-w-[280px] border-2 transition-all',
        selected ? 'border-teal-500 shadow-xl shadow-teal-500/10' : 'border-gray-100 shadow-md'
      )}
    >
      <div className="p-4">
        {/* Centered icon */}
        <div className="flex items-center justify-center mb-3">
          <div className={cn('rounded-2xl p-3', isWebhook ? 'bg-purple-50' : 'bg-teal-50')}>
            <Icon className={cn('h-6 w-6', isWebhook ? 'text-purple-600' : 'text-teal-600')} />
          </div>
        </div>

        {/* Label */}
        <p className="text-sm font-bold text-gray-900 text-center">{triggerLabel}</p>

        {/* Type badge */}
        <div className="flex justify-center mt-1.5">
          <span
            className={cn(
              'text-[10px] font-semibold uppercase tracking-wide px-2.5 py-0.5 rounded-full',
              isWebhook ? 'bg-purple-50 text-purple-700' : 'bg-teal-50 text-teal-700'
            )}
          >
            {isWebhook ? 'Webhook' : 'Trigger'}
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

export default TriggerNode;
