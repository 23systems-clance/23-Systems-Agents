/**
 * Agent Registry list page (T016 - Feature 39).
 *
 * Table of agents with status filter, model info, version, and actions.
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Bot, Plus } from 'lucide-react';
import { listAgents, type AgentSummary } from '@/services/platform/agents';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
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
  DRAFT: 'bg-gray-500/10 text-gray-600 border-gray-500/20',
  TESTING: 'bg-yellow-500/10 text-yellow-600 border-yellow-500/20',
  PUBLISHED: 'bg-green-500/10 text-green-600 border-green-500/20',
  DEPRECATED: 'bg-red-500/10 text-red-600 border-red-500/20',
};

export default function AgentRegistryPage() {
  const navigate = useNavigate();
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ['agents', statusFilter, page],
    queryFn: () =>
      listAgents({
        status: statusFilter === 'all' ? undefined : statusFilter,
        page,
        limit: 20,
      }),
  });

  if (isLoading) return <PageSkeleton />;

  const agents = data?.agents ?? [];
  const total = data?.total ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Bot className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
          <div>
            <h1 className="text-2xl font-bold">Agent Registry</h1>
            <p className="text-sm text-muted-foreground">
              {total} agent{total !== 1 ? 's' : ''} registered
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1); }}>
            <SelectTrigger className="w-36">
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="DRAFT">Draft</SelectItem>
              <SelectItem value="TESTING">Testing</SelectItem>
              <SelectItem value="PUBLISHED">Published</SelectItem>
              <SelectItem value="DEPRECATED">Deprecated</SelectItem>
            </SelectContent>
          </Select>
          <Button onClick={() => navigate('/platform/agents/new')}>
            <Plus className="mr-2 h-4 w-4" />
            New Agent
          </Button>
        </div>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Model</TableHead>
              <TableHead>Version</TableHead>
              <TableHead className="text-right">Credit Cost</TableHead>
              <TableHead className="text-right">Skills</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {agents.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                  No agents found. Create your first agent to get started.
                </TableCell>
              </TableRow>
            ) : (
              agents.map((agent: AgentSummary) => (
                <TableRow
                  key={agent.id}
                  className="cursor-pointer hover:bg-muted/50"
                  tabIndex={0}
                  role="link"
                  aria-label={`Agent: ${agent.name}`}
                  onClick={() => navigate(`/platform/agents/${agent.id}`)}
                  onKeyDown={(e) => { if (e.key === 'Enter') navigate(`/platform/agents/${agent.id}`); }}
                >
                  <TableCell>
                    <div>
                      <p className="font-medium">{agent.name}</p>
                      <p className="text-xs text-muted-foreground">{agent.slug}</p>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={STATUS_COLORS[agent.status] ?? ''}>
                      {agent.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm">{agent.modelId}</TableCell>
                  <TableCell className="text-sm">v{agent.currentVersion}</TableCell>
                  <TableCell className="text-right text-sm">{Number(agent.creditCost).toFixed(2)}</TableCell>
                  <TableCell className="text-right text-sm">{agent.skillCount}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {total > 20 && (
        <div className="flex justify-center gap-2">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            Previous
          </Button>
          <span className="flex items-center text-sm text-muted-foreground px-3">
            Page {page} of {Math.ceil(total / 20)}
          </span>
          <Button variant="outline" size="sm" disabled={page * 20 >= total} onClick={() => setPage(page + 1)}>
            Next
          </Button>
        </div>
      )}
    </div>
  );
}
