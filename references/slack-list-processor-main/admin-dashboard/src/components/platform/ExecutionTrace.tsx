/**
 * Execution Trace viewer component (T062 - Feature 39).
 *
 * Timeline view showing the full execution pipeline:
 * trigger → agent invocations → tool calls → output → credit deduction.
 */

import { useQuery } from '@tanstack/react-query';
import { Clock, Cpu, Wrench, DollarSign, AlertCircle, CheckCircle2 } from 'lucide-react';
import { getExecutionTrace } from '@/services/platform/executions';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const STATUS_COLORS: Record<string, string> = {
  COMPLETED: 'bg-green-500/10 text-green-600 border-green-500/20',
  FAILED: 'bg-red-500/10 text-red-600 border-red-500/20',
  RUNNING: 'bg-blue-500/10 text-blue-600 border-blue-500/20',
  QUEUED: 'bg-gray-500/10 text-gray-600 border-gray-500/20',
  CANCELLED: 'bg-yellow-500/10 text-yellow-600 border-yellow-500/20',
  SPEND_LIMIT_BLOCKED: 'bg-orange-500/10 text-orange-600 border-orange-500/20',
};

interface ExecutionTraceProps {
  executionId: string;
}

export function ExecutionTraceViewer({ executionId }: ExecutionTraceProps) {
  const { data: trace, isLoading } = useQuery({
    queryKey: ['execution-trace', executionId],
    queryFn: () => getExecutionTrace(executionId),
  });

  if (isLoading) {
    return <div className="animate-pulse space-y-3">{[1, 2, 3].map((i) => <div key={i} className="h-16 bg-muted rounded" />)}</div>;
  }

  if (!trace) {
    return <p className="text-sm text-muted-foreground">Execution not found.</p>;
  }

  const durationMs = trace.startedAt && trace.completedAt
    ? new Date(trace.completedAt).getTime() - new Date(trace.startedAt).getTime()
    : null;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">{trace.skillName}</h3>
          <p className="text-sm text-muted-foreground">Execution {trace.id.slice(0, 8)}</p>
        </div>
        <Badge variant="outline" className={STATUS_COLORS[trace.status] ?? ''}>
          {trace.status}
        </Badge>
      </div>

      {/* Error banner */}
      {trace.errorMessage && (
        <div className="flex items-start gap-2 rounded-md bg-red-500/10 border border-red-500/20 p-3">
          <AlertCircle className="h-4 w-4 text-red-600 mt-0.5 flex-shrink-0" />
          <p className="text-sm text-red-600">{trace.errorMessage}</p>
        </div>
      )}

      {/* Metrics row */}
      <div className="grid grid-cols-4 gap-3">
        <MetricCard icon={Clock} label="Duration" value={durationMs ? `${durationMs}ms` : '—'} />
        <MetricCard icon={DollarSign} label="Credits" value={Number(trace.creditsCost).toFixed(2)} />
        <MetricCard icon={Cpu} label="Invocations" value={String(trace.agentInvocations.length)} />
        <MetricCard icon={Wrench} label="Retries" value={String(trace.retryCount)} />
      </div>

      {/* Timeline */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Execution Timeline</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="relative pl-6 space-y-4">
            {/* Trigger */}
            <TimelineStep
              icon={<CheckCircle2 className="h-4 w-4 text-blue-500" />}
              title="Trigger"
              subtitle={`${trace.triggerType}${trace.triggerSource ? ` — ${trace.triggerSource}` : ''}`}
              time={trace.startedAt}
            />

            {/* Agent Invocations */}
            {trace.agentInvocations.map((inv) => (
              <TimelineStep
                key={inv.id}
                icon={<Cpu className="h-4 w-4 text-purple-500" />}
                title={`${inv.agentName} v${inv.agentVersion}`}
                subtitle={`${inv.tokensInput + inv.tokensOutput} tokens | $${Number(inv.costUsd).toFixed(4)} | ${inv.durationMs}ms`}
                time={null}
                expanded={
                  <div className="space-y-2 mt-2">
                    {inv.toolCallsMade && Array.isArray(inv.toolCallsMade) && (inv.toolCallsMade as Array<{ name?: string; type?: string }>).length > 0 && (
                      <div>
                        <p className="text-xs font-medium text-muted-foreground mb-1">Tool Calls</p>
                        {(inv.toolCallsMade as Array<{ name?: string; type?: string }>).map((tc, j) => (
                          <div key={j} className="flex items-center gap-2 text-xs py-0.5">
                            <Wrench className="h-3 w-3 text-muted-foreground" />
                            <span>{tc.name ?? tc.type ?? `Tool ${j + 1}`}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {inv.output != null && (
                      <div>
                        <p className="text-xs font-medium text-muted-foreground mb-1">Output</p>
                        <pre className="text-xs bg-muted rounded p-2 max-h-32 overflow-auto">
                          {typeof inv.output === 'string' ? inv.output : JSON.stringify(inv.output, null, 2)}
                        </pre>
                      </div>
                    )}
                  </div>
                }
              />
            ))}

            {/* Completion */}
            <TimelineStep
              icon={
                trace.status === 'COMPLETED'
                  ? <CheckCircle2 className="h-4 w-4 text-green-500" />
                  : <AlertCircle className="h-4 w-4 text-red-500" />
              }
              title={trace.status === 'COMPLETED' ? 'Completed' : trace.status}
              subtitle={trace.creditsCost > 0 ? `${Number(trace.creditsCost).toFixed(2)} credits deducted` : undefined}
              time={trace.completedAt}
            />
          </div>
        </CardContent>
      </Card>

      {/* Input/Output */}
      {(trace.input != null || trace.output != null) && (
        <div className="grid grid-cols-2 gap-4">
          {trace.input != null && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Input</CardTitle>
              </CardHeader>
              <CardContent>
                <pre className="text-xs bg-muted rounded p-2 max-h-48 overflow-auto">
                  {JSON.stringify(trace.input as Record<string, unknown>, null, 2)}
                </pre>
              </CardContent>
            </Card>
          )}
          {trace.output != null && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Output</CardTitle>
              </CardHeader>
              <CardContent>
                <pre className="text-xs bg-muted rounded p-2 max-h-48 overflow-auto">
                  {JSON.stringify(trace.output as Record<string, unknown>, null, 2)}
                </pre>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

function MetricCard({ icon: Icon, label, value }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string }) {
  return (
    <div className="rounded-md border p-3 text-center">
      <Icon className="h-4 w-4 mx-auto text-muted-foreground mb-1" />
      <p className="text-lg font-semibold">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

function TimelineStep({
  icon,
  title,
  subtitle,
  time,
  expanded,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  time?: string | null;
  expanded?: React.ReactNode;
}) {
  return (
    <div className="relative">
      <div className="absolute -left-6 top-0.5">{icon}</div>
      <div>
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium">{title}</p>
          {time && <span className="text-xs text-muted-foreground">{new Date(time).toLocaleTimeString()}</span>}
        </div>
        {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
        {expanded}
      </div>
    </div>
  );
}
