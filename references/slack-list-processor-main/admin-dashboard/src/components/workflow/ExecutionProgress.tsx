/**
 * ExecutionProgress component.
 *
 * Displays real-time node-level progress for a running workflow execution.
 * Uses the useExecutionProgress hook for SSE streaming.
 */

import { cn } from '@/lib/utils';
import { useExecutionProgress, type NodeProgress } from '@/hooks/useExecutionProgress';

interface ExecutionProgressProps {
  /** The execution ID to monitor. */
  executionId: string | null | undefined;
  /** Whether to enable the progress subscription. */
  enabled?: boolean;
  /** Optional CSS class name. */
  className?: string;
}

const STATUS_ICONS: Record<string, string> = {
  pending: '\u23F8\uFE0F',
  running: '\u23F3',
  completed: '\u2705',
  failed: '\u274C',
};

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-gray-100 text-gray-700',
  running: 'bg-blue-100 text-blue-700',
  completed: 'bg-green-100 text-green-700',
  failed: 'bg-red-100 text-red-700',
};

/** Renders a single node progress row. */
function NodeProgressRow({ node }: { node: NodeProgress }) {
  const pct = node.total > 0 ? Math.round((node.processed / node.total) * 100) : 0;
  const statusColor = STATUS_COLORS[node.status] ?? 'bg-gray-100 text-gray-700';

  return (
    <div className="flex flex-col gap-1.5 p-3 rounded-lg border border-border">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm">{STATUS_ICONS[node.status] ?? ''}</span>
          <span className="text-sm font-medium">
            {node.label || node.nodeType}
          </span>
        </div>
        <span className={cn('text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full', statusColor)}>
          {node.status}
        </span>
      </div>

      {/* Progress bar */}
      <div className="w-full bg-gray-100 rounded-full h-2">
        <div
          className={cn(
            'h-2 rounded-full transition-all duration-300',
            node.status === 'failed' ? 'bg-red-500' : 'bg-teal-500',
          )}
          style={{ width: `${pct}%` }}
        />
      </div>

      {/* Stats row */}
      <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
        <span>{node.processed}/{node.total} ({pct}%)</span>
        <span className="text-green-600">OK: {node.succeeded}</span>
        <span className="text-red-600">Failed: {node.failed}</span>
        {node.skipped > 0 && <span>Skipped: {node.skipped}</span>}
      </div>

      {/* Error sample */}
      {node.errorSample && node.errorSample.length > 0 && (
        <div className="text-[11px] text-red-600 bg-red-50 rounded px-2 py-1 mt-1">
          {node.errorSample[0]}
        </div>
      )}
    </div>
  );
}

/**
 * Real-time execution progress panel showing per-node progress bars.
 */
export function ExecutionProgress({ executionId, enabled = true, className }: ExecutionProgressProps) {
  const { progress, connected, error } = useExecutionProgress(executionId, enabled);

  if (!executionId) return null;
  if (progress.length === 0 && !connected && !error) return null;

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      {/* Connection status */}
      <div className="flex items-center gap-2">
        <div
          className={cn(
            'h-2 w-2 rounded-full',
            connected ? 'bg-green-500' : 'bg-gray-400',
          )}
        />
        <span className="text-xs text-muted-foreground">
          {connected ? 'Live' : error || 'Connecting...'}
        </span>
      </div>

      {/* Node progress rows */}
      {progress.map((node) => (
        <NodeProgressRow key={node.nodeId} node={node} />
      ))}

      {progress.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-4">
          No progress data available yet.
        </p>
      )}
    </div>
  );
}
