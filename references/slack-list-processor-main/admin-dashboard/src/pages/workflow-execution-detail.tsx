import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  CheckCircle2,
  Circle,
  Clock,
  AlertTriangle,
  XCircle,
  User,
  Hash,
  Play,
  ChevronDown,
  ChevronRight,
  MessageSquare,
  Zap,
  GitBranch,
  FileText,
  Bot,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { PageSkeleton } from '@/components/shared/LoadingSkeleton';
import { ExecutionProgress } from '@/components/workflow/ExecutionProgress';
import { useExecution, useCancelExecution } from '@/services/workflows';

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

/** Check whether an execution status is terminal (no longer running). */
function isTerminalStatus(status: string): boolean {
  const terminal = ['COMPLETED', 'FAILED', 'CANCELLED', 'EXPIRED', 'ERROR'];
  return terminal.includes(status.toUpperCase());
}

/** Format seconds into "Xm Ys" display string. */
function formatDuration(seconds: number | null): string {
  if (seconds === null || seconds === undefined) return '--';
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  if (mins === 0) return `${secs}s`;
  return `${mins}m ${secs}s`;
}

/** Calculate duration in seconds between two ISO timestamps. */
function calcDurationSeconds(start: string, end: string | null | undefined): number | null {
  if (!end) return null;
  const diff = new Date(end).getTime() - new Date(start).getTime();
  return Math.round(diff / 1000);
}

/** Format a full ISO date string with time. */
function formatDateTime(iso: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(iso));
}

/** Return an icon component for a given node type. */
function nodeTypeIcon(nodeType: string) {
  switch (nodeType.toLowerCase()) {
    case 'message':
    case 'send_message':
      return <MessageSquare className="h-4 w-4" />;
    case 'condition':
    case 'branch':
      return <GitBranch className="h-4 w-4" />;
    case 'action':
    case 'api_call':
      return <Zap className="h-4 w-4" />;
    case 'wait_for_input':
    case 'collect_input':
      return <FileText className="h-4 w-4" />;
    case 'ai':
    case 'ai_classify':
    case 'ai_generate':
      return <Bot className="h-4 w-4" />;
    default:
      return <Play className="h-4 w-4" />;
  }
}

export default function WorkflowExecutionDetailPage() {
  const { workflowId, executionId } = useParams<{
    workflowId: string;
    executionId: string;
  }>();
  const navigate = useNavigate();
  const [contextOpen, setContextOpen] = useState(false);

  const { data: execution, isLoading } = useExecution(executionId);
  const cancelMutation = useCancelExecution();

  if (isLoading) return <PageSkeleton />;

  if (!execution) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <AlertTriangle className="mb-4 h-12 w-12 text-muted-foreground" />
        <h2 className="text-lg font-semibold">Execution not found</h2>
        <Button
          variant="ghost"
          className="mt-4"
          onClick={() => navigate(`/workflows/${workflowId}/analytics`)}
        >
          Back to Analytics
        </Button>
      </div>
    );
  }

  const overallDuration = calcDurationSeconds(
    execution.started_at,
    execution.completed_at,
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate(`/workflows/${workflowId}/analytics`)}
            aria-label="Back to analytics"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold">Execution Detail</h1>
            <p className="text-sm text-muted-foreground font-mono">
              {execution.id}
            </p>
          </div>
          <Badge variant={statusVariant(execution.status)}>
            {execution.status}
          </Badge>
        </div>

        {!isTerminalStatus(execution.status) && (
          <Button
            variant="destructive"
            size="sm"
            disabled={cancelMutation.isPending}
            onClick={() => cancelMutation.mutate(execution.id)}
          >
            {cancelMutation.isPending ? 'Cancelling...' : 'Cancel Execution'}
          </Button>
        )}
      </div>

      {/* Metadata cards */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Status</CardTitle>
            <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <Badge variant={statusVariant(execution.status)}>
              {execution.status}
            </Badge>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Slack User</CardTitle>
            <User className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-sm font-mono">{execution.slack_user_id}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Version</CardTitle>
            <Hash className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold font-mono">
              {execution.version_id.slice(0, 8)}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Duration</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {formatDuration(overallDuration)}
            </div>
            <p className="text-xs text-muted-foreground">
              {formatDateTime(execution.started_at)}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Error section */}
      {execution.status.toUpperCase() === 'FAILED' && execution.error_message && (
        <Card className="border-destructive">
          <CardHeader className="flex flex-row items-center gap-2 pb-2">
            <XCircle className="h-5 w-5 text-destructive" />
            <CardTitle className="text-sm font-medium text-destructive">
              Error
            </CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="whitespace-pre-wrap rounded bg-destructive/10 p-3 text-sm text-destructive">
              {execution.error_message}
            </pre>
          </CardContent>
        </Card>
      )}

      {/* Real-time Execution Progress */}
      {!isTerminalStatus(execution.status) && (
        <Card>
          <CardHeader>
            <CardTitle>Live Progress</CardTitle>
          </CardHeader>
          <CardContent>
            <ExecutionProgress
              executionId={executionId}
              enabled={!isTerminalStatus(execution.status)}
            />
          </CardContent>
        </Card>
      )}

      {/* Node History Timeline */}
      <Card>
        <CardHeader>
          <CardTitle>Node History</CardTitle>
        </CardHeader>
        <CardContent>
          {execution.node_history.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No nodes have been executed yet.
            </p>
          ) : (
            <div className="relative space-y-0">
              {execution.node_history.map((node, index) => {
                const isLast = index === execution.node_history.length - 1;
                const isCompleted = !!node.exited_at;
                const isCurrent =
                  !isCompleted && execution.current_node_id === node.node_id;
                const nodeDuration = calcDurationSeconds(
                  node.entered_at,
                  node.exited_at ?? null,
                );

                return (
                  <div key={`${node.node_id}-${index}`} className="relative flex gap-4">
                    {/* Timeline connector */}
                    <div className="flex flex-col items-center">
                      <div className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-border bg-background">
                        {isCompleted ? (
                          <CheckCircle2 className="h-4 w-4 text-green-500" />
                        ) : isCurrent ? (
                          <Circle className="h-4 w-4 fill-blue-500 text-blue-500" />
                        ) : (
                          <Circle className="h-4 w-4 text-muted-foreground" />
                        )}
                      </div>
                      {!isLast && (
                        <div className="w-px flex-1 bg-border" />
                      )}
                    </div>

                    {/* Node content */}
                    <div className="flex-1 pb-6">
                      <div className="flex items-center gap-2">
                        {nodeTypeIcon(node.node_type)}
                        <span className="text-sm font-semibold">
                          {node.node_id}
                        </span>
                        <Badge variant="outline" className="text-xs">
                          {node.node_type}
                        </Badge>
                        {nodeDuration !== null && (
                          <span className="text-xs text-muted-foreground">
                            {formatDuration(nodeDuration)}
                          </span>
                        )}
                      </div>

                      <div className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                        <p>Entered: {formatDateTime(node.entered_at)}</p>
                        {node.exited_at && (
                          <p>Exited: {formatDateTime(node.exited_at)}</p>
                        )}
                      </div>

                      {/* User input */}
                      {node.user_input != null && (
                        <div className="mt-2">
                          <p className="text-xs font-medium text-muted-foreground">
                            User Input:
                          </p>
                          <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-muted p-2 text-xs">
                            {typeof node.user_input === 'string'
                              ? node.user_input
                              : JSON.stringify(node.user_input, null, 2)}
                          </pre>
                        </div>
                      )}

                      {/* Output */}
                      {node.output != null && (
                        <div className="mt-2">
                          <p className="text-xs font-medium text-muted-foreground">
                            Output:
                          </p>
                          <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-muted p-2 text-xs">
                            {typeof node.output === 'string'
                              ? node.output
                              : JSON.stringify(node.output, null, 2)}
                          </pre>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Context section (collapsible) */}
      <Card>
        <CardHeader>
          <button
            type="button"
            className="flex w-full items-center gap-2 text-left"
            onClick={() => setContextOpen(!contextOpen)}
          >
            {contextOpen ? (
              <ChevronDown className="h-4 w-4" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
            <CardTitle className="text-sm font-medium">
              Execution Context
            </CardTitle>
          </button>
        </CardHeader>
        {contextOpen && (
          <CardContent>
            <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded bg-muted p-3 text-xs">
              {JSON.stringify(execution.context, null, 2)}
            </pre>
          </CardContent>
        )}
      </Card>
    </div>
  );
}
