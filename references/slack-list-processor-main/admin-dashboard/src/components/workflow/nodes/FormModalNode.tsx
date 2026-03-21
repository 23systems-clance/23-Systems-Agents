import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import { FileText } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Data shape for a form-modal node. */
type FormModalNodeData = {
  type: 'FORM_MODAL';
  formTitle?: string;
  fieldCount?: number;
  label?: string;
  description?: string;
};

type FormModalNodeType = Node<FormModalNodeData, 'FORM_MODAL'>;

const ACCENT = '#ea580c';

/**
 * FormModalNode represents a Slack modal form step in the workflow.
 * Clean Pipeline style: centered icon, orange accent, rounded-2xl card.
 */
function FormModalNode({ data, selected }: NodeProps<FormModalNodeType>) {
  const title = data.formTitle ?? data.label ?? 'Form';
  const fieldCount = data.fieldCount ?? 0;
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
          <div className="rounded-2xl p-3 bg-orange-50">
            <FileText className="h-6 w-6 text-orange-600" />
          </div>
        </div>

        {/* Label */}
        <p className="text-sm font-bold text-gray-900 text-center">{title}</p>

        {/* Type badge */}
        <div className="flex justify-center mt-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-wide px-2.5 py-0.5 rounded-full bg-orange-50 text-orange-700">
            Form Modal
          </span>
        </div>

        {/* Description */}
        {description && (
          <p className="text-xs text-gray-400 mt-2 text-center leading-relaxed line-clamp-2">{description}</p>
        )}

        {/* Field count badge */}
        {fieldCount > 0 && (
          <div className="flex justify-center mt-2">
            <span className="rounded-full bg-orange-100 px-2.5 py-0.5 text-xs font-semibold text-orange-700">
              {fieldCount} {fieldCount === 1 ? 'field' : 'fields'}
            </span>
          </div>
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

export default FormModalNode;
