import { useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Activity,
  CheckCircle2,
  Clock,
  Users,
  TrendingDown,
} from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { PageSkeleton } from '@/components/shared/LoadingSkeleton';
import {
  useWorkflow,
  useWorkflowAnalytics,
  useWorkflowFunnel,
  useExecutions,
} from '@/services/workflows';
import type { WorkflowFunnelStep } from '@/types/api';

/** Format seconds into "Xm Ys" display string. */
function formatDuration(seconds: number | null): string {
  if (seconds === null || seconds === undefined) return '--';
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  if (mins === 0) return `${secs}s`;
  return `${mins}m ${secs}s`;
}

/** Format an ISO date string to a short locale date. */
function formatDate(iso: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
  }).format(new Date(iso));
}

/** Format a full ISO date string with time. */
function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(iso));
}

/** Map execution status to a badge variant. */
function statusVariant(
  status: string,
): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (status.toUpperCase()) {
    case 'COMPLETED':
      return 'default';
    case 'RUNNING':
    case 'WAITING_FOR_INPUT':
      return 'secondary';
    case 'FAILED':
    case 'ERROR':
      return 'destructive';
    default:
      return 'outline';
  }
}

const PERIOD_OPTIONS = [
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: '90d', label: 'Last 90 days' },
  { value: 'all', label: 'All time' },
] as const;

export default function WorkflowAnalyticsPage() {
  const { workflowId } = useParams<{ workflowId: string }>();
  const navigate = useNavigate();
  const [period, setPeriod] = useState('30d');
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  const periodParams = useMemo(
    () => (period === 'all' ? undefined : { period }),
    [period],
  );

  const { data: workflow, isLoading: workflowLoading } =
    useWorkflow(workflowId);
  const { data: analytics, isLoading: analyticsLoading } =
    useWorkflowAnalytics(workflowId, periodParams);
  const { data: funnel, isLoading: funnelLoading } = useWorkflowFunnel(
    workflowId,
    periodParams,
  );
  const { data: executions, isLoading: executionsLoading } = useExecutions(
    workflowId,
    { limit: '10' },
  );

  const isLoading =
    workflowLoading || analyticsLoading || funnelLoading || executionsLoading;

  /** Active executions = total - terminal states. */
  const activeExecutions = useMemo(() => {
    if (!analytics) return 0;
    return (
      analytics.total_runs -
      analytics.completed -
      analytics.failed -
      analytics.expired -
      analytics.cancelled
    );
  }, [analytics]);

  /** Chart data with formatted date labels. */
  const chartData = useMemo(() => {
    if (!analytics?.daily_runs) return [];
    return analytics.daily_runs.map((d) => ({
      ...d,
      dateLabel: formatDate(d.date),
    }));
  }, [analytics]);

  /** Maximum bar in the funnel for relative width calculation. */
  const funnelMax = useMemo(() => {
    if (!funnel?.steps?.length) return 1;
    return Math.max(...funnel.steps.map((s) => s.reached), 1);
  }, [funnel]);

  if (isLoading) return <PageSkeleton />;

  const hasRuns = analytics && analytics.total_runs > 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate('/workflows')}
            aria-label="Back to workflows"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold">
              {workflow?.name ?? 'Workflow'} Analytics
            </h1>
            <p className="text-sm text-muted-foreground">
              Performance metrics and funnel analysis
            </p>
          </div>
        </div>

        <Select value={period} onValueChange={setPeriod}>
          <SelectTrigger className="w-[160px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PERIOD_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Empty state */}
      {!hasRuns && (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <Activity className="mb-4 h-12 w-12 text-muted-foreground" />
            <h2 className="text-lg font-semibold">No runs yet</h2>
            <p className="text-sm text-muted-foreground">
              Analytics will appear once this workflow has been executed.
            </p>
          </CardContent>
        </Card>
      )}

      {hasRuns && analytics && (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium">
                  Total Runs
                </CardTitle>
                <Activity className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {analytics.total_runs}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium">
                  Completion Rate
                </CardTitle>
                <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {analytics.completion_rate.toFixed(1)}%
                </div>
                <p className="text-xs text-muted-foreground">
                  {analytics.completed} of {analytics.total_runs} completed
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium">
                  Avg Duration
                </CardTitle>
                <Clock className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {formatDuration(analytics.avg_duration_seconds)}
                </div>
                {analytics.median_duration_seconds !== null && (
                  <p className="text-xs text-muted-foreground">
                    Median: {formatDuration(analytics.median_duration_seconds)}
                  </p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium">
                  Active Executions
                </CardTitle>
                <Users className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{activeExecutions}</div>
                {analytics.failed > 0 && (
                  <p className="text-xs text-red-500">
                    {analytics.failed} failed
                  </p>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Daily runs chart */}
          {chartData.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Daily Runs</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis
                        dataKey="dateLabel"
                        fontSize={12}
                        tickLine={false}
                        axisLine={false}
                      />
                      <YAxis
                        fontSize={12}
                        tickLine={false}
                        axisLine={false}
                        allowDecimals={false}
                      />
                      <Tooltip />
                      <Bar
                        dataKey="completed"
                        stackId="runs"
                        fill="hsl(142, 71%, 45%)"
                        name="Completed"
                        radius={[0, 0, 0, 0]}
                      />
                      <Bar
                        dataKey="failed"
                        stackId="runs"
                        fill="hsl(0, 84%, 60%)"
                        name="Failed"
                        radius={[4, 4, 0, 0]}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Funnel visualization */}
          {funnel && funnel.steps.length > 0 && (
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <TrendingDown className="h-5 w-5 text-muted-foreground" />
                  <CardTitle>Funnel</CardTitle>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {funnel.steps.map((step: WorkflowFunnelStep) => {
                  const reachedWidth = (step.reached / funnelMax) * 100;
                  const completedWidth =
                    step.reached > 0
                      ? (step.completed / step.reached) * 100
                      : 0;
                  const isSelected = selectedNodeId === step.node_id;

                  return (
                    <button
                      key={step.node_id}
                      type="button"
                      className={`w-full rounded-lg border p-3 text-left transition-colors ${
                        isSelected
                          ? 'border-primary bg-primary/5'
                          : 'border-border hover:border-primary/40'
                      }`}
                      onClick={() =>
                        setSelectedNodeId(
                          isSelected ? null : step.node_id,
                        )
                      }
                    >
                      <div className="mb-2 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">
                            {step.label}
                          </span>
                          <Badge variant="outline" className="text-xs">
                            {step.node_type}
                          </Badge>
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {step.reached} reached / {step.completed} completed
                        </span>
                      </div>

                      {/* Bar */}
                      <div className="relative h-6 w-full overflow-hidden rounded bg-muted">
                        <div
                          className="absolute inset-y-0 left-0 rounded bg-blue-200"
                          style={{ width: `${reachedWidth}%` }}
                        />
                        <div
                          className="absolute inset-y-0 left-0 rounded bg-blue-500"
                          style={{
                            width: `${(completedWidth / 100) * reachedWidth}%`,
                          }}
                        />
                      </div>

                      {step.drop_off_rate > 0 && (
                        <p className="mt-1 text-xs text-red-500">
                          {step.drop_off_count} drop-offs (
                          {step.drop_off_rate.toFixed(1)}%)
                        </p>
                      )}
                    </button>
                  );
                })}
              </CardContent>
            </Card>
          )}

          {/* Recent executions */}
          {executions && executions.executions.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Recent Executions</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Status</TableHead>
                      <TableHead>User</TableHead>
                      <TableHead>Version</TableHead>
                      <TableHead>Duration</TableHead>
                      <TableHead>Started</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {executions.executions.map((exec) => (
                      <TableRow key={exec.id}>
                        <TableCell>
                          <Badge variant={statusVariant(exec.status)}>
                            {exec.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {exec.slack_user_id}
                        </TableCell>
                        <TableCell>v{exec.version_number}</TableCell>
                        <TableCell>
                          {formatDuration(exec.duration_seconds)}
                        </TableCell>
                        <TableCell>{formatDateTime(exec.started_at)}</TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              navigate(
                                `/workflows/${workflowId}/executions/${exec.id}`,
                              )
                            }
                          >
                            View
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
