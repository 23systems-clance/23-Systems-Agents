/**
 * Workflow Style Test Page
 *
 * Renders 4 visual variations of the same enrichment workflow graph
 * so the team can compare and choose a preferred design direction.
 *
 * Route: /workflows/style-test
 */
import { useState, useMemo } from 'react';
import {
  ReactFlow,
  Controls,
  Background,
  BackgroundVariant,
  MiniMap,
  ReactFlowProvider,
  Handle,
  Position,
  type Node,
  type Edge,
  type NodeProps,
  type NodeTypes,
  getSmoothStepPath,
  BaseEdge,
  EdgeLabelRenderer,
  type EdgeProps,
  type EdgeTypes,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { cn } from '@/lib/utils';
import {
  Zap,
  MessageSquare,
  MousePointerClick,
  Database,
  GitBranch,
  Play,
  CheckCircle2,
  ArrowLeft,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useNavigate } from 'react-router-dom';

// ─────────────────────────────────────────────────────────────────────────────
// Shared sample graph data (simplified enrichment workflow)
// ─────────────────────────────────────────────────────────────────────────────

function makeNodes(style: string): Node[] {
  const base: Array<{
    id: string;
    type: string;
    y: number;
    x: number;
    data: Record<string, unknown>;
  }> = [
    {
      id: 'trigger',
      type: `${style}_TRIGGER`,
      x: 400,
      y: 0,
      data: { label: 'File Upload', description: 'User uploads CSV/XLSX file', nodeType: 'TRIGGER' },
    },
    {
      id: 'list-type',
      type: `${style}_BUTTON_CHOICE`,
      x: 400,
      y: 180,
      data: {
        label: 'List Type',
        description: 'What type of list is this?',
        nodeType: 'BUTTON_CHOICE',
        buttons: [
          { id: 'company', label: 'Company List', style: 'primary' },
          { id: 'contact', label: 'Contact List', style: '' },
        ],
      },
    },
    {
      id: 'enrich-type',
      type: `${style}_BUTTON_CHOICE`,
      x: 100,
      y: 400,
      data: {
        label: 'Enrichment Type',
        description: 'What enrichment to perform?',
        nodeType: 'BUTTON_CHOICE',
        buttons: [
          { id: 'technographics', label: 'Technographics', style: 'primary' },
          { id: 'contacts', label: 'Contacts', style: '' },
          { id: 'both', label: 'Both', style: '' },
        ],
      },
    },
    {
      id: 'purpose',
      type: `${style}_BUTTON_CHOICE`,
      x: 700,
      y: 400,
      data: {
        label: 'Purpose',
        description: 'What is this list for?',
        nodeType: 'BUTTON_CHOICE',
        buttons: [
          { id: 'just_a_list', label: 'Just a List', style: 'primary' },
          { id: 'emailing', label: 'Email', style: '' },
          { id: 'cold_calling', label: 'Cold Call', style: '' },
        ],
      },
    },
    {
      id: 'cosell',
      type: `${style}_BUTTON_CHOICE`,
      x: 700,
      y: 610,
      data: {
        label: 'Co-sell Check',
        description: 'Is this a co-sell list?',
        nodeType: 'BUTTON_CHOICE',
        buttons: [
          { id: 'cosell_yes', label: 'Yes', style: 'primary' },
          { id: 'cosell_no', label: 'No', style: '' },
        ],
      },
    },
    {
      id: 'context',
      type: `${style}_MESSAGE`,
      x: 900,
      y: 820,
      data: { label: 'Collect Context', description: 'Who is the owner of this list?', nodeType: 'MESSAGE' },
    },
    {
      id: 'validate',
      type: `${style}_CONDITION`,
      x: 400,
      y: 1020,
      data: { label: 'Validate File', description: 'Check format, row count, columns', nodeType: 'CONDITION' },
    },
    {
      id: 'enrich',
      type: `${style}_ENRICHMENT`,
      x: 400,
      y: 1220,
      data: { label: 'Run Enrichment', description: 'BuiltWith + Apollo enrichment', enrichmentType: 'Combined', nodeType: 'ENRICHMENT' },
    },
    {
      id: 'generate',
      type: `${style}_ACTION`,
      x: 400,
      y: 1420,
      data: { label: 'Generate Output', description: 'Build enriched CSV, upload to S3', nodeType: 'ACTION' },
    },
    {
      id: 'results',
      type: `${style}_MESSAGE`,
      x: 400,
      y: 1620,
      data: { label: 'Deliver Results', description: 'Post summary + download link', nodeType: 'MESSAGE' },
    },
  ];

  return base.map((n) => ({
    id: n.id,
    type: n.type,
    position: { x: n.x, y: n.y },
    data: n.data,
  }));
}

/** Creates edges (shared across all variations). */
function makeEdges(style: string): Edge[] {
  const edgeType = `${style}_edge`;
  return [
    { id: 'e1', source: 'trigger', target: 'list-type', type: edgeType },
    { id: 'e2', source: 'list-type', target: 'enrich-type', sourceHandle: 'company', type: edgeType, data: { label: 'Company' } },
    { id: 'e3', source: 'list-type', target: 'purpose', sourceHandle: 'contact', type: edgeType, data: { label: 'Contact' } },
    { id: 'e4', source: 'enrich-type', target: 'validate', sourceHandle: 'technographics', type: edgeType, data: { label: 'Tech Only' } },
    { id: 'e5', source: 'enrich-type', target: 'purpose', sourceHandle: 'contacts', type: edgeType, data: { label: 'Contacts' } },
    { id: 'e6', source: 'enrich-type', target: 'purpose', sourceHandle: 'both', type: edgeType, data: { label: 'Both' } },
    { id: 'e7', source: 'purpose', target: 'cosell', sourceHandle: 'just_a_list', type: edgeType },
    { id: 'e8', source: 'purpose', target: 'cosell', sourceHandle: 'emailing', type: edgeType },
    { id: 'e9', source: 'purpose', target: 'cosell', sourceHandle: 'cold_calling', type: edgeType },
    { id: 'e10', source: 'cosell', target: 'context', sourceHandle: 'cosell_no', type: edgeType, data: { label: 'No' } },
    { id: 'e11', source: 'cosell', target: 'context', sourceHandle: 'cosell_yes', type: edgeType, data: { label: 'Yes' } },
    { id: 'e12', source: 'context', target: 'validate', type: edgeType },
    { id: 'e13', source: 'validate', target: 'enrich', type: edgeType },
    { id: 'e14', source: 'enrich', target: 'generate', type: edgeType },
    { id: 'e15', source: 'generate', target: 'results', type: edgeType },
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// Icon map for node types
// ─────────────────────────────────────────────────────────────────────────────

const NODE_ICONS: Record<string, React.ElementType> = {
  TRIGGER: Zap,
  MESSAGE: MessageSquare,
  BUTTON_CHOICE: MousePointerClick,
  ENRICHMENT: Database,
  CONDITION: GitBranch,
  ACTION: Play,
};

// ─────────────────────────────────────────────────────────────────────────────
// VARIATION A: "HubSpot Flow"
// White cards, colored left accent bar, rounded connectors, business-clean
// ─────────────────────────────────────────────────────────────────────────────

const A_COLORS: Record<string, { accent: string; bg: string; text: string }> = {
  TRIGGER: { accent: '#16a34a', bg: '#f0fdf4', text: '#15803d' },
  MESSAGE: { accent: '#2563eb', bg: '#eff6ff', text: '#1d4ed8' },
  BUTTON_CHOICE: { accent: '#7c3aed', bg: '#f5f3ff', text: '#6d28d9' },
  ENRICHMENT: { accent: '#059669', bg: '#ecfdf5', text: '#047857' },
  CONDITION: { accent: '#d97706', bg: '#fffbeb', text: '#b45309' },
  ACTION: { accent: '#dc2626', bg: '#fef2f2', text: '#b91c1c' },
};

function ANode({ data, selected }: NodeProps) {
  const nodeType = (data.nodeType as string) ?? 'ACTION';
  const colors = A_COLORS[nodeType] ?? A_COLORS.ACTION;
  const Icon = NODE_ICONS[nodeType] ?? Play;
  const buttons = (data.buttons as Array<{ id: string; label: string; style?: string }>) ?? [];
  const label = data.label as string;
  const description = data.description as string;

  return (
    <div
      className={cn(
        'bg-white rounded-xl shadow-sm border border-gray-200 min-w-[200px] max-w-[260px] overflow-hidden transition-shadow',
        selected && 'shadow-lg ring-2 ring-blue-400'
      )}
    >
      <Handle type="target" position={Position.Top} className="!bg-gray-300 !w-2.5 !h-2.5 !border-2 !border-white" />

      {/* Colored top bar */}
      <div className="h-1.5" style={{ backgroundColor: colors.accent }} />

      <div className="px-4 py-3">
        {/* Type + icon row */}
        <div className="flex items-center gap-2 mb-1.5">
          <div
            className="rounded-lg p-1.5 flex items-center justify-center"
            style={{ backgroundColor: colors.bg }}
          >
            <Icon className="h-3.5 w-3.5" style={{ color: colors.text }} />
          </div>
          <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: colors.text }}>
            {nodeType.replace('_', ' ')}
          </span>
        </div>

        {/* Label */}
        <p className="text-sm font-semibold text-gray-900 leading-tight">{label}</p>

        {/* Description */}
        {description && (
          <p className="text-xs text-gray-500 mt-1 leading-relaxed line-clamp-2">{description}</p>
        )}

        {/* Buttons for BUTTON_CHOICE */}
        {buttons.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2">
            {buttons.map((btn) => (
              <span
                key={btn.id}
                className={cn(
                  'text-[10px] font-medium px-2 py-0.5 rounded-full border',
                  btn.style === 'primary'
                    ? 'bg-green-50 text-green-700 border-green-200'
                    : 'bg-gray-50 text-gray-600 border-gray-200'
                )}
              >
                {btn.label}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Source handles */}
      {buttons.length > 0 ? (
        buttons.map((btn, idx) => {
          const offset = buttons.length > 1 ? (idx / (buttons.length - 1)) * 80 + 10 : 50;
          return (
            <Handle
              key={btn.id}
              type="source"
              position={Position.Bottom}
              id={btn.id}
              className="!bg-gray-300 !w-2.5 !h-2.5 !border-2 !border-white"
              style={{ left: `${offset}%` }}
            />
          );
        })
      ) : (
        <Handle type="source" position={Position.Bottom} className="!bg-gray-300 !w-2.5 !h-2.5 !border-2 !border-white" />
      )}
    </div>
  );
}

function AEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, selected }: EdgeProps) {
  const [path, labelX, labelY] = getSmoothStepPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, borderRadius: 12 });
  const label = (data as Record<string, unknown>)?.label as string | undefined;
  return (
    <>
      <BaseEdge id={id} path={path} style={{ stroke: selected ? '#3b82f6' : '#cbd5e1', strokeWidth: selected ? 2.5 : 1.5 }} />
      {label && (
        <EdgeLabelRenderer>
          <div style={{ position: 'absolute', transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`, pointerEvents: 'all' }}
            className="rounded-full border border-gray-200 bg-white px-2 py-0.5 text-[10px] font-medium text-gray-500 shadow-sm"
          >{label}</div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// VARIATION B: "Clean Pipeline"
// Centered, wider cards, teal accent, prominent icons, pill badges
// ─────────────────────────────────────────────────────────────────────────────

function BNode({ data, selected }: NodeProps) {
  const nodeType = (data.nodeType as string) ?? 'ACTION';
  const Icon = NODE_ICONS[nodeType] ?? Play;
  const buttons = (data.buttons as Array<{ id: string; label: string; style?: string }>) ?? [];
  const label = data.label as string;
  const description = data.description as string;

  const colorMap: Record<string, string> = {
    TRIGGER: '#0d9488',
    MESSAGE: '#0284c7',
    BUTTON_CHOICE: '#7c3aed',
    ENRICHMENT: '#059669',
    CONDITION: '#d97706',
    ACTION: '#e11d48',
  };
  const accent = colorMap[nodeType] ?? '#6b7280';

  return (
    <div
      className={cn(
        'bg-white rounded-2xl min-w-[220px] max-w-[280px] border-2 transition-all',
        selected ? 'border-teal-500 shadow-xl shadow-teal-500/10' : 'border-gray-100 shadow-md'
      )}
    >
      <Handle type="target" position={Position.Top} className="!w-3 !h-3 !rounded-full !border-2 !border-white" style={{ background: accent }} />

      <div className="p-4">
        {/* Large centered icon */}
        <div className="flex items-center justify-center mb-3">
          <div
            className="rounded-2xl p-3 flex items-center justify-center"
            style={{ backgroundColor: `${accent}15` }}
          >
            <Icon className="h-6 w-6" style={{ color: accent }} />
          </div>
        </div>

        {/* Label centered */}
        <p className="text-sm font-bold text-gray-900 text-center">{label}</p>

        {/* Type badge */}
        <div className="flex justify-center mt-1.5">
          <span
            className="text-[10px] font-semibold uppercase tracking-wide px-2.5 py-0.5 rounded-full"
            style={{ backgroundColor: `${accent}15`, color: accent }}
          >
            {nodeType.replace('_', ' ')}
          </span>
        </div>

        {/* Description */}
        {description && (
          <p className="text-xs text-gray-400 mt-2 text-center leading-relaxed line-clamp-2">{description}</p>
        )}

        {/* Buttons */}
        {buttons.length > 0 && (
          <div className="flex flex-col gap-1.5 mt-3">
            {buttons.map((btn) => (
              <div
                key={btn.id}
                className={cn(
                  'text-xs font-medium px-3 py-1.5 rounded-lg text-center border',
                  btn.style === 'primary'
                    ? 'bg-teal-50 text-teal-700 border-teal-200'
                    : 'bg-gray-50 text-gray-600 border-gray-200'
                )}
              >
                {btn.label}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Source handles */}
      {buttons.length > 0 ? (
        buttons.map((btn, idx) => {
          const offset = buttons.length > 1 ? (idx / (buttons.length - 1)) * 80 + 10 : 50;
          return (
            <Handle key={btn.id} type="source" position={Position.Bottom} id={btn.id}
              className="!w-3 !h-3 !rounded-full !border-2 !border-white" style={{ left: `${offset}%`, background: accent }} />
          );
        })
      ) : (
        <Handle type="source" position={Position.Bottom} className="!w-3 !h-3 !rounded-full !border-2 !border-white" style={{ background: accent }} />
      )}
    </div>
  );
}

function BEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, selected }: EdgeProps) {
  const [path, labelX, labelY] = getSmoothStepPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, borderRadius: 20 });
  const label = (data as Record<string, unknown>)?.label as string | undefined;
  return (
    <>
      <BaseEdge id={id} path={path} style={{ stroke: selected ? '#0d9488' : '#d1d5db', strokeWidth: 2, strokeDasharray: selected ? undefined : '6 3' }} />
      {label && (
        <EdgeLabelRenderer>
          <div style={{ position: 'absolute', transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`, pointerEvents: 'all' }}
            className="rounded-lg border border-teal-200 bg-teal-50 px-2.5 py-0.5 text-[10px] font-bold text-teal-700 shadow-sm"
          >{label}</div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// VARIATION C: "Dark Studio"
// Dark cards, neon accents, compact, professional
// ─────────────────────────────────────────────────────────────────────────────

const C_COLORS: Record<string, { accent: string; glow: string }> = {
  TRIGGER: { accent: '#34d399', glow: '#34d39930' },
  MESSAGE: { accent: '#60a5fa', glow: '#60a5fa30' },
  BUTTON_CHOICE: { accent: '#a78bfa', glow: '#a78bfa30' },
  ENRICHMENT: { accent: '#2dd4bf', glow: '#2dd4bf30' },
  CONDITION: { accent: '#fbbf24', glow: '#fbbf2430' },
  ACTION: { accent: '#f87171', glow: '#f8717130' },
};

function CNode({ data, selected }: NodeProps) {
  const nodeType = (data.nodeType as string) ?? 'ACTION';
  const colors = C_COLORS[nodeType] ?? C_COLORS.ACTION;
  const Icon = NODE_ICONS[nodeType] ?? Play;
  const buttons = (data.buttons as Array<{ id: string; label: string; style?: string }>) ?? [];
  const label = data.label as string;

  return (
    <div
      className={cn(
        'rounded-xl min-w-[190px] max-w-[240px] overflow-hidden border transition-all',
        selected ? 'shadow-lg' : ''
      )}
      style={{
        backgroundColor: '#1e1e2e',
        borderColor: selected ? colors.accent : '#2a2a3e',
        boxShadow: selected ? `0 0 20px ${colors.glow}` : undefined,
      }}
    >
      <Handle type="target" position={Position.Top} style={{ background: colors.accent }} className="!w-2.5 !h-2.5 !border-2 !border-[#1e1e2e]" />

      {/* Accent left bar + content */}
      <div className="flex">
        <div className="w-1 shrink-0" style={{ backgroundColor: colors.accent }} />
        <div className="px-3.5 py-3 flex-1">
          {/* Icon + label row */}
          <div className="flex items-center gap-2">
            <div className="rounded-lg p-1.5" style={{ backgroundColor: colors.glow }}>
              <Icon className="h-4 w-4" style={{ color: colors.accent }} />
            </div>
            <div>
              <p className="text-sm font-semibold text-white leading-tight">{label}</p>
              <p className="text-[10px] text-gray-500 uppercase tracking-wider font-medium">
                {nodeType.replace('_', ' ')}
              </p>
            </div>
          </div>

          {/* Buttons */}
          {buttons.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2.5">
              {buttons.map((btn) => (
                <span
                  key={btn.id}
                  className="text-[10px] font-medium px-2 py-0.5 rounded border"
                  style={{
                    backgroundColor: btn.style === 'primary' ? `${colors.accent}20` : '#2a2a3e',
                    borderColor: btn.style === 'primary' ? colors.accent : '#3a3a4e',
                    color: btn.style === 'primary' ? colors.accent : '#9ca3af',
                  }}
                >
                  {btn.label}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Source handles */}
      {buttons.length > 0 ? (
        buttons.map((btn, idx) => {
          const offset = buttons.length > 1 ? (idx / (buttons.length - 1)) * 80 + 10 : 50;
          return (
            <Handle key={btn.id} type="source" position={Position.Bottom} id={btn.id}
              style={{ left: `${offset}%`, background: colors.accent }} className="!w-2.5 !h-2.5 !border-2 !border-[#1e1e2e]" />
          );
        })
      ) : (
        <Handle type="source" position={Position.Bottom} style={{ background: colors.accent }} className="!w-2.5 !h-2.5 !border-2 !border-[#1e1e2e]" />
      )}
    </div>
  );
}

function CEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, selected }: EdgeProps) {
  const [path, labelX, labelY] = getSmoothStepPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, borderRadius: 6 });
  const label = (data as Record<string, unknown>)?.label as string | undefined;
  return (
    <>
      <BaseEdge id={id} path={path} style={{ stroke: selected ? '#a78bfa' : '#3a3a4e', strokeWidth: selected ? 2 : 1.5 }} />
      {label && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: 'all',
              backgroundColor: '#1e1e2e',
              borderColor: '#3a3a4e',
              color: '#9ca3af',
            }}
            className="rounded border px-1.5 py-0.5 text-[10px] font-medium"
          >{label}</div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// VARIATION D: "Minimal Wire"
// Ultra-clean, generous whitespace, indigo accent, pill shapes
// ─────────────────────────────────────────────────────────────────────────────

function DNode({ data, selected }: NodeProps) {
  const nodeType = (data.nodeType as string) ?? 'ACTION';
  const Icon = NODE_ICONS[nodeType] ?? Play;
  const buttons = (data.buttons as Array<{ id: string; label: string; style?: string }>) ?? [];
  const label = data.label as string;

  return (
    <div
      className={cn(
        'bg-white rounded-full min-w-[180px] max-w-[260px] px-5 py-3 border-2 transition-all flex items-center gap-3',
        selected ? 'border-indigo-500 shadow-lg shadow-indigo-500/10' : 'border-gray-200 shadow-sm hover:shadow-md'
      )}
    >
      <Handle type="target" position={Position.Top} className="!w-2 !h-2 !bg-indigo-400 !border-2 !border-white" />

      <div className="rounded-full p-2 bg-indigo-50 shrink-0">
        <Icon className="h-4 w-4 text-indigo-600" />
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-gray-900 truncate">{label}</p>
        {buttons.length > 0 && (
          <p className="text-[10px] text-indigo-500 font-medium">{buttons.length} options</p>
        )}
      </div>

      {nodeType === 'TRIGGER' && (
        <div className="shrink-0">
          <CheckCircle2 className="h-4 w-4 text-green-500" />
        </div>
      )}

      {/* Source handles */}
      {buttons.length > 0 ? (
        buttons.map((btn, idx) => {
          const offset = buttons.length > 1 ? (idx / (buttons.length - 1)) * 70 + 15 : 50;
          return (
            <Handle key={btn.id} type="source" position={Position.Bottom} id={btn.id}
              className="!w-2 !h-2 !bg-indigo-400 !border-2 !border-white" style={{ left: `${offset}%` }} />
          );
        })
      ) : (
        <Handle type="source" position={Position.Bottom} className="!w-2 !h-2 !bg-indigo-400 !border-2 !border-white" />
      )}
    </div>
  );
}

function DEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, selected }: EdgeProps) {
  const [path, labelX, labelY] = getSmoothStepPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, borderRadius: 24 });
  const label = (data as Record<string, unknown>)?.label as string | undefined;
  return (
    <>
      <BaseEdge id={id} path={path} style={{ stroke: selected ? '#6366f1' : '#e5e7eb', strokeWidth: 2 }} />
      {label && (
        <EdgeLabelRenderer>
          <div style={{ position: 'absolute', transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`, pointerEvents: 'all' }}
            className="rounded-full bg-indigo-50 px-2.5 py-0.5 text-[10px] font-semibold text-indigo-600"
          >{label}</div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Variation configs
// ─────────────────────────────────────────────────────────────────────────────

interface VariationConfig {
  id: string;
  name: string;
  subtitle: string;
  bgClass: string;
  bgVariant: BackgroundVariant;
  bgColor?: string;
  gridColor?: string;
}

const VARIATIONS: VariationConfig[] = [
  {
    id: 'A',
    name: 'HubSpot Flow',
    subtitle: 'Clean white cards, colored top accent, business-professional',
    bgClass: 'bg-gray-50',
    bgVariant: BackgroundVariant.Dots,
  },
  {
    id: 'B',
    name: 'Clean Pipeline',
    subtitle: 'Centered icons, teal accent, dashed connectors, rounded cards',
    bgClass: 'bg-white',
    bgVariant: BackgroundVariant.Cross,
  },
  {
    id: 'C',
    name: 'Dark Studio',
    subtitle: 'Dark theme, neon accents, left color bars, compact',
    bgClass: '',
    bgVariant: BackgroundVariant.Dots,
    bgColor: '#141420',
    gridColor: '#1e1e2e',
  },
  {
    id: 'D',
    name: 'Minimal Wire',
    subtitle: 'Pill-shaped nodes, indigo accent, ultra-clean whitespace',
    bgClass: 'bg-white',
    bgVariant: BackgroundVariant.Dots,
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Build node + edge type registries
// ─────────────────────────────────────────────────────────────────────────────

const NODE_TYPE_NAMES = ['TRIGGER', 'MESSAGE', 'BUTTON_CHOICE', 'ENRICHMENT', 'CONDITION', 'ACTION'] as const;

function buildNodeTypes(): NodeTypes {
  const types: Record<string, React.ComponentType<NodeProps>> = {};
  for (const nt of NODE_TYPE_NAMES) {
    types[`A_${nt}`] = ANode;
    types[`B_${nt}`] = BNode;
    types[`C_${nt}`] = CNode;
    types[`D_${nt}`] = DNode;
  }
  return types;
}

function buildEdgeTypes(): EdgeTypes {
  return {
    A_edge: AEdge,
    B_edge: BEdge,
    C_edge: CEdge,
    D_edge: DEdge,
  };
}

const allNodeTypes = buildNodeTypes();
const allEdgeTypes = buildEdgeTypes();

// ─────────────────────────────────────────────────────────────────────────────
// Canvas wrapper (one per variation)
// ─────────────────────────────────────────────────────────────────────────────

function VariationCanvas({ config }: { config: VariationConfig }) {
  const nodes = useMemo(() => makeNodes(config.id), [config.id]);
  const edges = useMemo(() => makeEdges(config.id), [config.id]);

  return (
    <ReactFlowProvider>
      <div className="h-full w-full" style={config.bgColor ? { backgroundColor: config.bgColor } : undefined}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={allNodeTypes}
          edgeTypes={allEdgeTypes}
          fitView
          fitViewOptions={{ padding: 0.15 }}
          nodesDraggable
          nodesConnectable={false}
          proOptions={{ hideAttribution: true }}
          minZoom={0.2}
          maxZoom={1.5}
        >
          <Controls className={config.id === 'C' ? 'react-flow__controls--dark' : ''} />
          <MiniMap className="rounded-lg border border-border" />
          <Background
            variant={config.bgVariant}
            gap={20}
            size={1}
            color={config.gridColor}
          />
        </ReactFlow>
      </div>
    </ReactFlowProvider>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main page
// ─────────────────────────────────────────────────────────────────────────────

export default function WorkflowStyleTestPage() {
  const [activeIdx, setActiveIdx] = useState(0);
  const navigate = useNavigate();
  const active = VARIATIONS[activeIdx];

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col">
      {/* Top bar */}
      <div className="flex items-center justify-between border-b bg-background px-4 py-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate('/workflows')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-lg font-bold">Workflow Builder Style Test</h1>
            <p className="text-xs text-muted-foreground">
              Compare 4 visual variations. Same workflow data, different design.
            </p>
          </div>
        </div>
      </div>

      {/* Variation tabs */}
      <div className="flex border-b bg-muted/30 px-4">
        {VARIATIONS.map((v, idx) => (
          <button
            key={v.id}
            type="button"
            onClick={() => setActiveIdx(idx)}
            className={cn(
              'px-5 py-3 text-sm font-medium border-b-2 transition-colors',
              idx === activeIdx
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground hover:border-gray-300'
            )}
          >
            <span className="font-bold mr-1.5">{v.id}.</span>
            {v.name}
          </button>
        ))}
      </div>

      {/* Subtitle */}
      <div className="px-4 py-2 text-xs text-muted-foreground bg-muted/20 border-b">
        <strong>Style {active.id}:</strong> {active.subtitle}
      </div>

      {/* Canvas */}
      <div className="flex-1 overflow-hidden">
        <VariationCanvas key={active.id} config={active} />
      </div>
    </div>
  );
}
