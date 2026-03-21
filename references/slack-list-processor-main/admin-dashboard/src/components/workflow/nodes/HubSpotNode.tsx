import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import { Database } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Data shape for a workflow HubSpot node. */
type HubSpotNodeData = {
  type: 'HUBSPOT';
  mode?: 'import' | 'sync';
  label?: string;
  description?: string;
};

type HubSpotNodeType = Node<HubSpotNodeData, 'HUBSPOT'>;

const ACCENT = '#7c3aed';

const MODE_LABELS: Record<string, string> = {
  import: 'Import from List',
  sync: 'Sync Contacts',
};

/**
 * HubSpotNode renders a CRM integration node for importing or syncing contacts.
 * Clean Pipeline style: centered icon, violet accent, rounded-2xl card.
 */
function HubSpotNode({ data, selected }: NodeProps<HubSpotNodeType>) {
  const label = data.label ?? 'HubSpot';
  const description = (data.description as string) ?? '';
  const modeLabel = data.mode ? MODE_LABELS[data.mode] ?? data.mode : '';

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
          <div className="rounded-2xl p-3 bg-violet-50">
            <Database className="h-6 w-6 text-violet-600" />
          </div>
        </div>

        {/* Label */}
        <p className="text-sm font-bold text-gray-900 text-center">{label}</p>

        {/* Type badge */}
        <div className="flex justify-center mt-1.5 gap-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-wide px-2.5 py-0.5 rounded-full bg-violet-50 text-violet-700">
            HubSpot
          </span>
          {modeLabel && (
            <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-violet-50/60 text-violet-600">
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

export default HubSpotNode;
