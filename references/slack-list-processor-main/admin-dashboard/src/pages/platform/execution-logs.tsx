/**
 * Execution Logs page (T061 - Feature 39).
 *
 * Filterable table of skill executions with expandable trace view.
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Activity, ChevronDown, ChevronRight } from 'lucide-react';
import { listExecutions, type ExecutionSummary } from '@/services/platform/executions';
import { ExecutionTraceViewer } from '@/components/platform/ExecutionTrace';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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

const STATUS_COLORS: Record<string, string> = {
  COMPLETED: 'bg-green-500/10 text-green-600 border-green-500/20',
  FAILED: 'bg-red-500/10 text-red-600 border-red-500/20',
  RUNNING: 'bg-blue-500/10 text-blue-600 border-blue-500/20',
  QUEUED: 'bg-gray-500/10 text-gray-600 border-gray-500/20',
  CANCELLED: 'bg-yellow-500/10 text-yellow-600 border-yellow-500/20',
  SPEND_LIMIT_BLOCKED: 'bg-orange-500/10 text-orange-600 border-orange-500/20',
};

export default function ExecutionLogsPage() {
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [teamFilter, setTeamFilter] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ['executions', statusFilter, teamFilter, page],
    queryFn: () =>
      listExecutions({
        status: statusFilter === 'all' ? undefined : statusFilter,
        slackTeamId: teamFilter || undefined,
        page,
        limit: 25,
      }),
  });

  if (isLoading) return <PageSkeleton />;

  const executions = data?.executions ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / 25);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Activity className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
          <div>
            <h1 className="text-2xl font-bold">Execution Logs</h1>
            <p className="text-sm text-muted-foreground">
              {total} execution{total !== 1 ? 's' : ''} recorded
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Input
            placeholder="Filter by team ID..."
            value={teamFilter}
            onChange={(e) => { setTeamFilter(e.target.value); setPage(1); }}
            className="w-48"
          />
          <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1); }}>
            <SelectTrigger className="w-44">
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="COMPLETED">Completed</SelectItem>
              <SelectItem value="FAILED">Failed</SelectItem>
              <SelectItem value="RUNNING">Running</SelectItem>
              <SelectItem value="QUEUED">Queued</SelectItem>
              <SelectItem value="CANCELLED">Cancelled</SelectItem>
              <SelectItem value="SPEND_LIMIT_BLOCKED">Blocked</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8" />
              <TableHead>Skill</TableHead>
              <TableHead>Workspace</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Trigger</TableHead>
              <TableHead className="text-right">Credits</TableHead>
              <TableHead className="text-right">Duration</TableHead>
              <TableHead>Time</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {executions.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                  No executions found.
                </TableCell>
              </TableRow>
            ) : (
              executions.map((exec: ExecutionSummary) => (
                <>
                  <TableRow
                    key={exec.id}
                    className="cursor-pointer hover:bg-muted/50"
                    tabIndex={0}
                    role="button"
                    aria-expanded={expandedId === exec.id}
                    aria-label={`${exec.skillName} execution — ${exec.status}`}
                    onClick={() => setExpandedId(expandedId === exec.id ? null : exec.id)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpandedId(expandedId === exec.id ? null : exec.id); } }}
                  >
                    <TableCell>
                      {expandedId === exec.id
                        ? <ChevronDown className="h-4 w-4" aria-hidden="true" />
                        : <ChevronRight className="h-4 w-4" aria-hidden="true" />}
                    </TableCell>
                    <TableCell className="font-medium">{exec.skillName}</TableCell>
                    <TableCell className="text-sm font-mono">{exec.slackTeamId}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={STATUS_COLORS[exec.status] ?? ''}>
                        {exec.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm">{exec.triggerType}</TableCell>
                    <TableCell className="text-right text-sm">{exec.creditsCost.toFixed(2)}</TableCell>
                    <TableCell className="text-right text-sm">
                      {exec.durationMs != null ? `${exec.durationMs}ms` : '---'}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {new Date(exec.createdAt).toLocaleString()}
                    </TableCell>
                  </TableRow>
                  {expandedId === exec.id && (
                    <TableRow key={`${exec.id}-trace`}>
                      <TableCell colSpan={8} className="bg-muted/30 p-4">
                        <ExecutionTraceViewer executionId={exec.id} />
                      </TableCell>
                    </TableRow>
                  )}
                </>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Page {page} of {totalPages}
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage(page - 1)}
              disabled={page <= 1}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage(page + 1)}
              disabled={page >= totalPages}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
