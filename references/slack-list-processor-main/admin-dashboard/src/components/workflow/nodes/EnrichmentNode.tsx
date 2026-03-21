import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import { Database } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Valid enrichment processing types. */
type EnrichmentType = 'technographic' | 'contact' | 'combined';

/** Data shape for an enrichment node. */
type EnrichmentNodeData = {
  type: 'ENRICHMENT';
  enrichmentType?: EnrichmentType;
  label?: string;
  description?: string;
};

type EnrichmentNodeType = Node<EnrichmentNodeData, 'ENRICHMENT'>;

/** Maps enrichment types to human-readable badge labels. */
const ENRICHMENT_LABELS: Record<EnrichmentType, string> = {
  technographic: 'Technographic',
  contact: 'Contact',
  combined: 'Combined',
};

const ACCENT = '#059669';

/**
 * EnrichmentNode represents a data enrichment step in the workflow.
 * Clean Pipeline style: centered icon, emerald accent, rounded-2xl card.
 */
function EnrichmentNode({ data, selected }: NodeProps<EnrichmentNodeType>) {
  const enrichmentType = data.enrichmentType ?? 'combined';
  const badgeLabel = ENRICHMENT_LABELS[enrichmentType] ?? enrichmentType;
  const label = data.label ?? 'Enrichment';
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
          <div className="rounded-2xl p-3 bg-emerald-50">
            <Database className="h-6 w-6 text-emerald-600" />
          </div>
        </div>

        {/* Label */}
        <p className="text-sm font-bold text-gray-900 text-center">{label}</p>

        {/* Type badge */}
        <div className="flex justify-center mt-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-wide px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700">
            Enrichment
          </span>
        </div>

        {/* Description */}
        {description && (
          <p className="text-xs text-gray-400 mt-2 text-center leading-relaxed line-clamp-2">{description}</p>
        )}

        {/* Enrichment type badge */}
        <div className="flex justify-center mt-2">
          <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">
            {badgeLabel}
          </span>
        </div>
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

export default EnrichmentNode;
