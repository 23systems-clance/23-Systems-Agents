/**
 * Autonomous Agent Detail page (T091 - Feature 31).
 *
 * Agent configuration, execution stats, pending actions with approve/reject,
 * and suggest-only mode toggle.
 */

import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { format, parseISO } from 'date-fns';
import { Bot, ArrowLeft, CheckCircle2, XCircle } from 'lucide-react';
import { queryKeys } from '@/lib/query-keys';
import {
  fetchAgentDetail,
  updateAgentMode,
  approveAction,
  rejectAction,
} from '@/services/autonomous';
import type { AuditAction } from '@/services/autonomous';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { StatCard } from '@/components/shared/StatCard';
import { PageSkeleton } from '@/components/shared/LoadingSkeleton';

const STATUS_COLORS: Record<string, string> = {
  active: 'bg-green-500/10 text-green-600 border-green-500/20',
  paused: 'bg-yellow-500/10 text-yellow-600 border-yellow-500/20',
  error: 'bg-red-500/10 text-red-600 border-red-500/20',
};

const EXECUTION_STATUS_COLORS: Record<string, 'default' | 'secondary' | 'destructive'> = {
  success: 'default',
  running: 'secondary',
  failed: 'destructive',
};

export default function AgentDetailPage() {
  const { agentId } = useParams<{ agentId: string }>();
  const queryClient = useQueryClient();
  const [rejectDialog, setRejectDialog] = useState<AuditAction | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const { data: agent, isLoading } = useQuery({
    queryKey: queryKeys.autonomous.agent(agentId!),
    queryFn: () => fetchAgentDetail(agentId!),
    enabled: !!agentId,
    refetchInterval: 15_000,
  });

  const toggleModeMutation = useMutation({
    mutationFn: (suggestOnlyMode: boolean) => updateAgentMode(agentId!, suggestOnlyMode),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.autonomous.agent(agentId!) });
      queryClient.invalidateQueries({ queryKey: queryKeys.autonomous.dashboard() });
    },
  });

  const approveMutation = useMutation({
    mutationFn: (auditActionId: string) => approveAction(agentId!, auditActionId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.autonomous.agent(agentId!) });
      queryClient.invalidateQueries({ queryKey: queryKeys.autonomous.dashboard() });
    },
  });

  const rejectMutation = useMutation({
    mutationFn: ({ auditActionId, reason }: { auditActionId: string; reason: string }) =>
      rejectAction(agentId!, auditActionId, reason),
    onSuccess: () => {
      setRejectDialog(null);
      setRejectReason('');
      queryClient.invalidateQueries({ queryKey: queryKeys.autonomous.agent(agentId!) });
      queryClient.invalidateQueries({ queryKey: queryKeys.autonomous.dashboard() });
    },
  });

  if (isLoading || !agent) return <PageSkeleton />;

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link to="/autonomous/agents" className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <Bot className="h-6 w-6 text-muted-foreground" />
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold">{agent.name}</h1>
            <Badge variant="outline" className={STATUS_COLORS[agent.status] ?? ''}>
              {agent.status}
            </Badge>
          </div>
          {agent.description && (
            <p className="text-sm text-muted-foreground">{agent.description}</p>
          )}
        </div>
        <div className="flex items-center gap-3">
          <label htmlFor="suggest-only" className="text-sm text-muted-foreground">
            Suggest Only
          </label>
          <Switch
            id="suggest-only"
            checked={agent.suggestOnlyMode}
            onCheckedChange={(checked) => toggleModeMutation.mutate(checked)}
            disabled={toggleModeMutation.isPending}
          />
        </div>
      </div>

      {/* Agent Config */}
      <Card>
        <CardContent className="p-5">
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Configuration
          </h3>
          <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm md:grid-cols-4">
            <div>
              <span className="text-muted-foreground">Model:</span>{' '}
              <span className="font-medium">{agent.model}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Status:</span>{' '}
              <span className="font-medium">{agent.status}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Mode:</span>{' '}
              <span className="font-medium">{agent.suggestOnlyMode ? 'Suggest Only' : 'Auto Execute'}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Total Executions:</span>{' '}
              <span className="font-medium">{agent.totalExecutions}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Execution Stats */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Total Executions"
          value={String(agent.executionStats.total)}
          icon={Bot}
          accent="indigo"
        />
        <StatCard
          title="Success Rate"
          value={`${Math.round(agent.executionStats.successRate * 100)}%`}
          icon={CheckCircle2}
          accent="teal"
        />
        <StatCard
          title="Avg Duration"
          value={`${(agent.executionStats.avgDurationMs / 1000).toFixed(1)}s`}
          icon={Bot}
          accent="amber"
        />
        <StatCard
          title="Last 24h"
          value={String(agent.executionStats.last24h)}
          icon={Bot}
          accent="rose"
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Recent Executions */}
        <Card>
          <CardContent className="p-5">
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Recent Executions
            </h3>
            <div className="space-y-2">
              {agent.recentExecutions.map((exec) => (
                <div
                  key={exec.id}
                  className="flex items-center justify-between rounded-md border p-3"
                >
                  <div>
                    <p className="font-mono text-xs">{exec.id.slice(0, 8)}</p>
                    <p className="text-xs text-muted-foreground">
                      {format(parseISO(exec.createdAt), 'MMM d HH:mm:ss')}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                      {(exec.durationMs / 1000).toFixed(1)}s
                    </span>
                    <Badge variant={EXECUTION_STATUS_COLORS[exec.status] ?? 'secondary'} className="text-xs">
                      {exec.status}
                    </Badge>
                  </div>
                </div>
              ))}
              {agent.recentExecutions.length === 0 && (
                <p className="py-4 text-center text-sm text-muted-foreground">No recent executions</p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Pending Audit Actions */}
        <Card>
          <CardContent className="p-5">
            <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Pending Actions ({agent.pendingActions.length})
            </h3>
            <div className="space-y-3">
              {agent.pendingActions.map((action) => (
                <div
                  key={action.id}
                  className="rounded-md border p-3"
                >
                  <div className="mb-2 flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{action.action}</p>
                      <p className="text-xs text-muted-foreground">
                        Confidence: {Math.round(action.confidence * 100)}% ·{' '}
                        {format(parseISO(action.createdAt), 'MMM d HH:mm')}
                      </p>
                    </div>
                    <Badge variant="outline" className="text-xs">
                      {action.severity}
                    </Badge>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="default"
                      className="h-7 gap-1 text-xs"
                      onClick={() => approveMutation.mutate(action.id)}
                      disabled={approveMutation.isPending}
                    >
                      <CheckCircle2 className="h-3 w-3" />
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="destructive"
                      className="h-7 gap-1 text-xs"
                      onClick={() => { setRejectDialog(action); setRejectReason(''); }}
                    >
                      <XCircle className="h-3 w-3" />
                      Reject
                    </Button>
                  </div>
                </div>
              ))}
              {agent.pendingActions.length === 0 && (
                <p className="py-4 text-center text-sm text-muted-foreground">No pending actions</p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Reject Dialog */}
      <Dialog open={!!rejectDialog} onOpenChange={() => setRejectDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject Action</DialogTitle>
            <DialogDescription>
              Provide a reason for rejecting: {rejectDialog?.action}
            </DialogDescription>
          </DialogHeader>
          <Textarea
            placeholder="Rejection reason..."
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            rows={3}
          />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setRejectDialog(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={!rejectReason.trim() || rejectMutation.isPending}
              onClick={() => {
                if (rejectDialog) {
                  rejectMutation.mutate({
                    auditActionId: rejectDialog.id,
                    reason: rejectReason.trim(),
                  });
                }
              }}
            >
              Reject
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </motion.div>
  );
}
