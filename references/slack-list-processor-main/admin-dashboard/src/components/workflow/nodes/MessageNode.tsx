import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import { MessageSquare } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Data shape for a message node. */
type MessageNodeData = {
  type: 'MESSAGE';
  messageText?: string;
  text?: string;
  label?: string;
  description?: string;
};

type MessageNodeType = Node<MessageNodeData, 'MESSAGE'>;

const ACCENT = '#0284c7';

/**
 * MessageNode displays a Slack message step in the workflow.
 * Clean Pipeline style: centered icon, sky accent, rounded-2xl card.
 */
function MessageNode({ data, selected }: NodeProps<MessageNodeType>) {
  const label = data.label ?? 'Message';
  const text = data.messageText ?? (data.text as string) ?? '';
  const preview = text.length > 50 ? `${text.slice(0, 50)}...` : text;
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
          <div className="rounded-2xl p-3 bg-sky-50">
            <MessageSquare className="h-6 w-6 text-sky-600" />
          </div>
        </div>

        {/* Label */}
        <p className="text-sm font-bold text-gray-900 text-center">{label}</p>

        {/* Type badge */}
        <div className="flex justify-center mt-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-wide px-2.5 py-0.5 rounded-full bg-sky-50 text-sky-700">
            Message
          </span>
        </div>

        {/* Preview text or description */}
        {(preview || description) && (
          <p className="text-xs text-gray-400 mt-2 text-center leading-relaxed line-clamp-2">
            {preview || description}
          </p>
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

export default MessageNode;
