import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import { FileCode } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Data shape for a workflow Parser node. */
type ParserNodeData = {
  type: 'PARSER';
  parseMode?: 'json' | 'csv';
  label?: string;
  description?: string;
};

type ParserNodeType = Node<ParserNodeData, 'PARSER'>;

const ACCENT = '#0891b2';

const MODE_LABELS: Record<string, string> = {
  json: 'JSON',
  csv: 'CSV',
};

/**
 * ParserNode renders a data transformation node for parsing/filtering data.
 * Clean Pipeline style: centered icon, cyan accent, rounded-2xl card.
 */
function ParserNode({ data, selected }: NodeProps<ParserNodeType>) {
  const label = data.label ?? 'Parser';
  const description = (data.description as string) ?? '';
  const modeLabel = data.parseMode ? MODE_LABELS[data.parseMode] ?? data.parseMode : '';

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
          <div className="rounded-2xl p-3 bg-cyan-50">
            <FileCode className="h-6 w-6 text-cyan-600" />
          </div>
        </div>

        {/* Label */}
        <p className="text-sm font-bold text-gray-900 text-center">{label}</p>

        {/* Type badge */}
        <div className="flex justify-center mt-1.5 gap-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-wide px-2.5 py-0.5 rounded-full bg-cyan-50 text-cyan-700">
            Parser
          </span>
          {modeLabel && (
            <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-cyan-50/60 text-cyan-600">
              {modeLabel}
            </span>
          )}
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

export default ParserNode;
