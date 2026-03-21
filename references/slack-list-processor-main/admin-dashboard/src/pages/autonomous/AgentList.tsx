/**
 * Autonomous Agent List page (T090 - Feature 31).
 *
 * Table of agents with status/mode filters, success rate, and pending action counts.
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { format, parseISO } from 'date-fns';
import { Bot } from 'lucide-react';
import { queryKeys } from '@/lib/query-keys';
import { fetchAgents } from '@/services/autonomous';
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

const STATUS_COLORS: Record<string, string> = {
  active: 'bg-green-500/10 text-green-600 border-green-500/20',
  paused: 'bg-yellow-500/10 text-yellow-600 border-yellow-500/20',
  error: 'bg-red-500/10 text-red-600 border-red-500/20',
};

const MODE_COLORS: Record<string, string> = {
  suggest_only: 'bg-blue-500/10 text-blue-600 border-blue-500/20',
  auto_execute: 'bg-purple-500/10 text-purple-600 border-purple-500/20',
};

export default function AgentListPage() {
  const navigate = useNavigate();
  const [statusFilter, setStatusFilter] = useState('all');
  const [modeFilter, setModeFilter] = useState('all');

  const filterParams: Record<string, string> = {};
  if (statusFilter !== 'all') filterParams.status = statusFilter;
  if (modeFilter !== 'all') filterParams.mode = modeFilter;

  const { data: agents, isLoading } = useQuery({
    queryKey: queryKeys.autonomous.agents(filterParams),
    queryFn: () => fetchAgents(filterParams),
  });

  if (isLoading) return <PageSkeleton />;

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Bot className="h-6 w-6 text-muted-foreground" />
          <div>
            <h1 className="text-2xl font-bold">Autonomous Agents</h1>
            <p className="text-sm text-muted-foreground">
              {agents?.length ?? 0} agent{(agents?.length ?? 0) !== 1 ? 's' : ''} registered
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-36">
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="active">Active</SelectItem>
              <SelectItem value="paused">Paused</SelectItem>
              <SelectItem value="error">Error</SelectItem>
            </SelectContent>
          </Select>
          <Select value={modeFilter} onValueChange={setModeFilter}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="All modes" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All modes</SelectItem>
              <SelectItem value="suggest_only">Suggest Only</SelectItem>
              <SelectItem value="auto_execute">Auto Execute</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Mode</TableHead>
              <TableHead>Last Execution</TableHead>
              <TableHead className="text-right">Pending</TableHead>
              <TableHead className="text-right">Success Rate</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(agents ?? []).length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                  No agents found
                </TableCell>
              </TableRow>
            ) : (
              (agents ?? []).map((agent) => {
                const modeKey = agent.suggestOnlyMode ? 'suggest_only' : 'auto_execute';
                const modeLabel = agent.suggestOnlyMode ? 'Suggest Only' : 'Auto Execute';
                return (
                  <TableRow
                    key={agent.id}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => navigate(`/autonomous/agents/${agent.id}`)}
                  >
                    <TableCell>
                      <div>
                        <p className="font-medium">{agent.name}</p>
                        {agent.description && (
                          <p className="text-xs text-muted-foreground">{agent.description}</p>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={STATUS_COLORS[agent.status] ?? ''}>
                        {agent.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={MODE_COLORS[modeKey] ?? ''}>
                        {modeLabel}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm">
                      {agent.lastExecutionAt
                        ? format(parseISO(agent.lastExecutionAt), 'MMM d HH:mm')
                        : '-'}
                    </TableCell>
                    <TableCell className="text-right text-sm">
                      {agent.pendingActionsCount > 0 ? (
                        <Badge variant="secondary" className="text-xs">
                          {agent.pendingActionsCount}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground">0</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <div className="h-2 w-16 overflow-hidden rounded-full bg-muted">
                          <div
                            className="h-full rounded-full bg-green-500"
                            style={{ width: `${Math.round(agent.successRate * 100)}%` }}
                          />
                        </div>
                        <span className="text-sm">{Math.round(agent.successRate * 100)}%</span>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>
    </motion.div>
  );
}
