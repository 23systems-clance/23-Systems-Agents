import { type DragEvent } from 'react';
import {
  Zap,
  MessageSquare,
  MousePointerClick,
  FileText,
  Database,
  GitBranch,
  Play,
  Clock,
  PanelLeftClose,
  PanelLeftOpen,
  FileCode,
  Globe,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Separator } from '@/components/ui/separator';

/** Props for the NodePalette component. */
interface NodePaletteProps {
  /** Whether the sidebar is collapsed to icon-only mode. */
  collapsed?: boolean;
  /** Called when the collapse state should change. */
  onCollapse?: (collapsed: boolean) => void;
}

/** Workflow node type identifier. */
type WorkflowNodeType =
  | 'TRIGGER'
  | 'MESSAGE'
  | 'BUTTON_CHOICE'
  | 'FORM_MODAL'
  | 'CONDITION'
  | 'DELAY'
  | 'ENRICHMENT'
  | 'ACTION'
  | 'HUBSPOT'
  | 'PARSER'
  | 'API_CALL';

/** Configuration for a single palette item. */
interface PaletteItem {
  type: WorkflowNodeType;
  label: string;
  icon: LucideIcon;
  /** Default data payload attached when the node is dropped onto the canvas. */
  defaultData: Record<string, unknown>;
}

/** A category grouping palette items. */
interface PaletteCategory {
  name: string;
  items: PaletteItem[];
}

// ---------------------------------------------------------------------------
// Palette definitions (explicit color classes -- no dynamic construction)
// ---------------------------------------------------------------------------

/** Maps each node type to its explicit Tailwind color classes. */
const NODE_COLORS: Record<
  WorkflowNodeType,
  { bg: string; text: string; border: string; hoverBg: string }
> = {
  TRIGGER: {
    bg: 'bg-green-100',
    text: 'text-green-600',
    border: 'border-green-200',
    hoverBg: 'hover:bg-green-50',
  },
  MESSAGE: {
    bg: 'bg-blue-100',
    text: 'text-blue-600',
    border: 'border-blue-200',
    hoverBg: 'hover:bg-blue-50',
  },
  BUTTON_CHOICE: {
    bg: 'bg-purple-100',
    text: 'text-purple-600',
    border: 'border-purple-200',
    hoverBg: 'hover:bg-purple-50',
  },
  FORM_MODAL: {
    bg: 'bg-orange-100',
    text: 'text-orange-600',
    border: 'border-orange-200',
    hoverBg: 'hover:bg-orange-50',
  },
  CONDITION: {
    bg: 'bg-yellow-100',
    text: 'text-yellow-600',
    border: 'border-yellow-200',
    hoverBg: 'hover:bg-yellow-50',
  },
  DELAY: {
    bg: 'bg-slate-100',
    text: 'text-slate-600',
    border: 'border-slate-200',
    hoverBg: 'hover:bg-slate-50',
  },
  ENRICHMENT: {
    bg: 'bg-emerald-100',
    text: 'text-emerald-600',
    border: 'border-emerald-200',
    hoverBg: 'hover:bg-emerald-50',
  },
  ACTION: {
    bg: 'bg-red-100',
    text: 'text-red-600',
    border: 'border-red-200',
    hoverBg: 'hover:bg-red-50',
  },
  HUBSPOT: {
    bg: 'bg-violet-100',
    text: 'text-violet-600',
    border: 'border-violet-200',
    hoverBg: 'hover:bg-violet-50',
  },
  PARSER: {
    bg: 'bg-cyan-100',
    text: 'text-cyan-600',
    border: 'border-cyan-200',
    hoverBg: 'hover:bg-cyan-50',
  },
  API_CALL: {
    bg: 'bg-amber-100',
    text: 'text-amber-600',
    border: 'border-amber-200',
    hoverBg: 'hover:bg-amber-50',
  },
};

/** All palette categories with their node items. */
const PALETTE_CATEGORIES: PaletteCategory[] = [
  {
    name: 'Triggers',
    items: [
      {
        type: 'TRIGGER',
        label: 'Trigger',
        icon: Zap,
        defaultData: { type: 'TRIGGER' },
      },
    ],
  },
  {
    name: 'Interactions',
    items: [
      {
        type: 'MESSAGE',
        label: 'Message',
        icon: MessageSquare,
        defaultData: { type: 'MESSAGE' },
      },
      {
        type: 'BUTTON_CHOICE',
        label: 'Button Choice',
        icon: MousePointerClick,
        defaultData: { type: 'BUTTON_CHOICE', buttons: [] },
      },
      {
        type: 'FORM_MODAL',
        label: 'Form Modal',
        icon: FileText,
        defaultData: { type: 'FORM_MODAL' },
      },
    ],
  },
  {
    name: 'Logic',
    items: [
      {
        type: 'CONDITION',
        label: 'Condition',
        icon: GitBranch,
        defaultData: { type: 'CONDITION' },
      },
      {
        type: 'DELAY',
        label: 'Delay',
        icon: Clock,
        defaultData: { type: 'DELAY' },
      },
    ],
  },
  {
    name: 'Actions',
    items: [
      {
        type: 'ENRICHMENT',
        label: 'Enrichment',
        icon: Database,
        defaultData: { type: 'ENRICHMENT' },
      },
      {
        type: 'ACTION',
        label: 'Action',
        icon: Play,
        defaultData: { type: 'ACTION' },
      },
    ],
  },
  {
    name: 'Integrations',
    items: [
      {
        type: 'HUBSPOT',
        label: 'HubSpot',
        icon: Database,
        defaultData: { type: 'HUBSPOT', mode: 'import' },
      },
      {
        type: 'PARSER',
        label: 'Parser',
        icon: FileCode,
        defaultData: { type: 'PARSER', parseMode: 'json' },
      },
      {
        type: 'API_CALL',
        label: 'API Call',
        icon: Globe,
        defaultData: { type: 'API_CALL', method: 'GET' },
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// Drag handler
// ---------------------------------------------------------------------------

/**
 * Initiates an HTML5 drag with the node type and default data payload.
 * The WorkflowCanvas onDrop handler reads `application/reactflow` to
 * create the new node at the drop position.
 */
function handleDragStart(event: DragEvent, item: PaletteItem): void {
  const payload = JSON.stringify({ type: item.type, data: item.defaultData });
  event.dataTransfer.setData('application/reactflow', payload);
  event.dataTransfer.effectAllowed = 'move';
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

/** Renders a single draggable palette item in expanded mode. */
function PaletteItemExpanded({ item }: { item: PaletteItem }) {
  const colors = NODE_COLORS[item.type];
  const Icon = item.icon;

  return (
    <div
      draggable
      onDragStart={(e) => handleDragStart(e, item)}
      className={cn(
        'flex items-center gap-3 rounded-lg border px-3 py-2 cursor-grab active:cursor-grabbing transition-colors',
        colors.border,
        colors.hoverBg,
      )}
    >
      <div className={cn('rounded-md p-1.5', colors.bg)}>
        <Icon className={cn('h-4 w-4', colors.text)} />
      </div>
      <span className="text-sm font-medium text-foreground">{item.label}</span>
    </div>
  );
}

/** Renders a single draggable palette item in collapsed (icon-only) mode. */
function PaletteItemCollapsed({ item }: { item: PaletteItem }) {
  const colors = NODE_COLORS[item.type];
  const Icon = item.icon;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          draggable
          onDragStart={(e) => handleDragStart(e, item)}
          className={cn(
            'flex items-center justify-center rounded-lg border p-2 cursor-grab active:cursor-grabbing transition-colors',
            colors.border,
            colors.hoverBg,
          )}
        >
          <div className={cn('rounded-md p-1.5', colors.bg)}>
            <Icon className={cn('h-4 w-4', colors.text)} />
          </div>
        </div>
      </TooltipTrigger>
      <TooltipContent side="right">
        <p>{item.label}</p>
      </TooltipContent>
    </Tooltip>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

/**
 * NodePalette is a collapsible left sidebar that lists all available workflow
 * node types grouped by category. Each item is draggable and can be dropped
 * onto the WorkflowCanvas to create a new node.
 */
export function NodePalette({ collapsed = false, onCollapse }: NodePaletteProps) {
  return (
    <Card
      className={cn(
        'flex flex-col h-full rounded-none border-r border-l-0 border-t-0 border-b-0 shadow-none transition-all',
        collapsed ? 'w-[68px]' : 'w-[240px]',
      )}
    >
      {/* Header with collapse toggle */}
      <CardHeader className="flex flex-row items-center justify-between px-3 py-3 space-y-0">
        {!collapsed && (
          <CardTitle className="text-sm font-semibold">Nodes</CardTitle>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0"
          onClick={() => onCollapse?.(!collapsed)}
          aria-label={collapsed ? 'Expand node palette' : 'Collapse node palette'}
        >
          {collapsed ? (
            <PanelLeftOpen className="h-4 w-4" />
          ) : (
            <PanelLeftClose className="h-4 w-4" />
          )}
        </Button>
      </CardHeader>

      <Separator />

      {/* Scrollable content area */}
      <CardContent className="flex-1 overflow-hidden p-0">
        <ScrollArea className="h-full">
          <div className={cn('flex flex-col gap-4', collapsed ? 'px-2 py-3' : 'px-3 py-3')}>
            {PALETTE_CATEGORIES.map((category, categoryIdx) => (
              <div key={category.name}>
                {/* Category label (hidden when collapsed) */}
                {!collapsed && (
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {category.name}
                  </p>
                )}

                {/* Separator between categories (collapsed mode) */}
                {collapsed && categoryIdx > 0 && (
                  <Separator className="mb-3" />
                )}

                {/* Items */}
                <div className={cn('flex flex-col', collapsed ? 'gap-2' : 'gap-1.5')}>
                  {category.items.map((item) =>
                    collapsed ? (
                      <PaletteItemCollapsed key={item.type} item={item} />
                    ) : (
                      <PaletteItemExpanded key={item.type} item={item} />
                    ),
                  )}
                </div>
              </div>
            ))}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
