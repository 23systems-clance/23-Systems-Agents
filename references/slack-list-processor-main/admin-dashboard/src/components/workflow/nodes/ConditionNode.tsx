import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import { GitBranch } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Data shape for a condition (branching) node. */
type ConditionNodeData = {
  type: 'CONDITION';
  conditionField?: string;
  label?: string;
  description?: string;
};

type ConditionNodeType = Node<ConditionNodeData, 'CONDITION'>;

const ACCENT = '#d97706';

/**
 * ConditionNode renders a branching condition in the workflow.
 * Clean Pipeline style: centered icon, amber accent, rounded-2xl card.
 * Has two output handles: "true" (left) and "false" (right).
 */
function ConditionNode({ data, selected }: NodeProps<ConditionNodeType>) {
  const fieldName = data.conditionField ?? data.label ?? 'Condition';
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
          <div className="rounded-2xl p-3 bg-amber-50">
            <GitBranch className="h-6 w-6 text-amber-600" />
          </div>
        </div>

        {/* Label */}
        <p className="text-sm font-bold text-gray-900 text-center">{fieldName}</p>

        {/* Type badge */}
        <div className="flex justify-center mt-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-wide px-2.5 py-0.5 rounded-full bg-amber-50 text-amber-700">
            Condition
          </span>
        </div>

        {/* Description */}
        {description && (
          <p className="text-xs text-gray-400 mt-2 text-center leading-relaxed line-clamp-2">{description}</p>
        )}

        {/* Branch labels */}
        <div className="flex justify-between text-[10px] font-bold mt-3 px-4">
          <span className="rounded-full bg-green-50 text-green-600 px-2 py-0.5">True</span>
          <span className="rounded-full bg-red-50 text-red-600 px-2 py-0.5">False</span>
        </div>
      </div>

      {/* True output handle (bottom-left) */}
      <Handle
        type="source"
        position={Position.Bottom}
        id="true"
        className="!w-3 !h-3 !rounded-full !border-2 !border-white !bg-green-500"
        style={{ left: '25%' }}
      />

      {/* False/default output handle (bottom-right) */}
      <Handle
        type="source"
        position={Position.Bottom}
        id="false"
        className="!w-3 !h-3 !rounded-full !border-2 !border-white !bg-red-500"
        style={{ left: '75%' }}
      />
    </div>
  );
}

export default ConditionNode;
