import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import { Globe } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Data shape for a workflow API Call node. */
type ApiCallNodeData = {
  type: 'API_CALL';
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  url?: string;
  label?: string;
  description?: string;
};

type ApiCallNodeType = Node<ApiCallNodeData, 'API_CALL'>;

const ACCENT = '#d97706';

const METHOD_COLORS: Record<string, string> = {
  GET: 'bg-green-50 text-green-700',
  POST: 'bg-blue-50 text-blue-700',
  PUT: 'bg-amber-50 text-amber-700',
  DELETE: 'bg-red-50 text-red-700',
};

/**
 * ApiCallNode renders an HTTP request node for calling external APIs.
 * Clean Pipeline style: centered icon, amber accent, rounded-2xl card.
 */
function ApiCallNode({ data, selected }: NodeProps<ApiCallNodeType>) {
  const label = data.label ?? 'API Call';
  const description = (data.description as string) ?? '';
  const method = data.method ?? 'GET';
  const methodColor = METHOD_COLORS[method] ?? 'bg-gray-50 text-gray-700';

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
            <Globe className="h-6 w-6 text-amber-600" />
          </div>
        </div>

        {/* Label */}
        <p className="text-sm font-bold text-gray-900 text-center">{label}</p>

        {/* Type + method badges */}
        <div className="flex justify-center mt-1.5 gap-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-wide px-2.5 py-0.5 rounded-full bg-amber-50 text-amber-700">
            API Call
          </span>
          <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded-full', methodColor)}>
            {method}
          </span>
        </div>

        {/* URL preview */}
        {data.url && (
          <p className="text-[10px] text-gray-400 mt-1.5 text-center truncate" title={data.url}>
            {data.url}
          </p>
        )}

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

export default ApiCallNode;
