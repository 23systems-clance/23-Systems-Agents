import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import { Play, Mail, Phone, Users } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Data shape for an action node. */
type ActionNodeData = {
  type: 'ACTION';
  actionType?: string;
  label?: string;
  description?: string;
};

type ActionNodeType = Node<ActionNodeData, 'ACTION'>;

const ACCENT = '#e11d48';

/**
 * ActionNode represents an executable action step in the workflow.
 * Clean Pipeline style: centered icon, rose accent, rounded-2xl card.
 */
/** Returns the appropriate icon and styles for each action type. */
function actionMeta(actionType?: string) {
  switch (actionType) {
    case 'ASSIGN_TO_CAMPAIGN':
      return { Icon: Users, bg: 'bg-indigo-50', text: 'text-indigo-600', badge: 'Campaign' };
    case 'GET_EMAIL':
      return { Icon: Mail, bg: 'bg-sky-50', text: 'text-sky-600', badge: 'Get Email' };
    case 'GET_PHONE':
      return { Icon: Phone, bg: 'bg-emerald-50', text: 'text-emerald-600', badge: 'Get Phone' };
    default:
      return { Icon: Play, bg: 'bg-rose-50', text: 'text-rose-600', badge: 'Action' };
  }
}

function ActionNode({ data, selected }: NodeProps<ActionNodeType>) {
  const actionLabel = data.label ?? data.actionType ?? 'Action';
  const description = (data.description as string) ?? '';
  const meta = actionMeta(data.actionType);

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
          <div className={cn('rounded-2xl p-3', meta.bg)}>
            <meta.Icon className={cn('h-6 w-6', meta.text)} />
          </div>
        </div>

        {/* Label */}
        <p className="text-sm font-bold text-gray-900 text-center">{actionLabel}</p>

        {/* Type badge */}
        <div className="flex justify-center mt-1.5">
          <span className={cn('text-[10px] font-semibold uppercase tracking-wide px-2.5 py-0.5 rounded-full', meta.bg, meta.text)}>
            {meta.badge}
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

export default ActionNode;
