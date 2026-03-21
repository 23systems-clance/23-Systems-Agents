/**
 * Autonomous Agents Dashboard page (T096 - Feature 31).
 *
 * Aggregated view: summary stats, agent status grid, recent actions,
 * alert feed, and team overview.
 */

import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { format, parseISO } from 'date-fns';
import { Link } from 'react-router-dom';
import { BrainCircuit, Bot, Clock, AlertTriangle, Users } from 'lucide-react';
import { queryKeys } from '@/lib/query-keys';
import { fetchDashboard } from '@/services/autonomous';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { StatCard } from '@/components/shared/StatCard';
import { PageSkeleton } from '@/components/shared/LoadingSkeleton';

const STATUS_COLORS: Record<string, string> = {
  active: 'bg-green-500/10 text-green-600 border-green-500/20',
  paused: 'bg-yellow-500/10 text-yellow-600 border-yellow-500/20',
  error: 'bg-red-500/10 text-red-600 border-red-500/20',
};

const SEVERITY_COLORS: Record<string, string> = {
  low: 'bg-blue-500/10 text-blue-600 border-blue-500/20',
  medium: 'bg-yellow-500/10 text-yellow-600 border-yellow-500/20',
  high: 'bg-orange-500/10 text-orange-600 border-orange-500/20',
  critical: 'bg-red-500/10 text-red-600 border-red-500/20',
};

const OUTCOME_COLORS: Record<string, 'default' | 'secondary' | 'destructive'> = {
  approved: 'default',
  pending: 'secondary',
  rejected: 'destructive',
  auto_executed: 'default',
};

export default function AutonomousDashboard() {
  const { data, isLoading } = useQuery({
    queryKey: queryKeys.autonomous.dashboard(),
    queryFn: fetchDashboard,
    refetchInterval: 30_000,
  });

  if (isLoading || !data) return <PageSkeleton />;

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <BrainCircuit className="h-6 w-6 text-muted-foreground" />
        <div>
          <h1 className="text-2xl font-bold">Autonomous Agents</h1>
          <p className="text-sm text-muted-foreground">Real-time overview of agent activity and system health</p>
        </div>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Total Agents"
          value={String(data.totalAgents)}
          icon={Bot}
          accent="indigo"
        />
        <StatCard
          title="Active Agents"
          value={String(data.activeAgents)}
          icon={BrainCircuit}
          accent="teal"
        />
        <StatCard
          title="Pending Actions"
          value={String(data.pendingActions)}
          icon={Clock}
          accent="amber"
        />
        <StatCard
          title="Actions (24h)"
          value={String(data.actionsLast24h)}
          icon={AlertTriangle}
          accent="rose"
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Agent Status Grid */}
        <Card>
          <CardContent className="p-5">
            <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Agent Status
            </h3>
            <div className="space-y-2">
              {data.agents.map((agent) => (
                <Link
                  key={agent.id}
                  to={`/autonomous/agents/${agent.id}`}
                  className="flex items-center justify-between rounded-md border p-3 transition-colors hover:bg-muted/50"
                >
                  <div className="flex items-center gap-3">
                    <Bot className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-medium">{agent.name}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {agent.suggestOnlyMode && (
                      <Badge variant="outline" className="text-xs">Suggest Only</Badge>
                    )}
                    {agent.pendingActionsCount > 0 && (
                      <Badge variant="secondary" className="text-xs">
                        {agent.pendingActionsCount} pending
                      </Badge>
                    )}
                    <Badge variant="outline" className={STATUS_COLORS[agent.status] ?? ''}>
                      {agent.status}
                    </Badge>
                  </div>
                </Link>
              ))}
              {data.agents.length === 0 && (
                <p className="py-4 text-center text-sm text-muted-foreground">No agents configured</p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Alerts Feed */}
        <Card>
          <CardContent className="p-5">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                Unacknowledged Alerts
              </h3>
              <Link to="/autonomous/events" className="text-xs text-primary hover:underline">
                View all
              </Link>
            </div>
            <div className="space-y-2">
              {data.unacknowledgedEvents.slice(0, 8).map((event) => (
                <div
                  key={event.id}
                  className="flex items-start justify-between gap-3 rounded-md border p-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm">{event.message}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {event.agentName && `${event.agentName} · `}
                      {format(parseISO(event.createdAt), 'MMM d HH:mm')}
                    </p>
                  </div>
                  <Badge variant="outline" className={SEVERITY_COLORS[event.severity] ?? ''}>
                    {event.severity}
                  </Badge>
                </div>
              ))}
              {data.unacknowledgedEvents.length === 0 && (
                <p className="py-4 text-center text-sm text-muted-foreground">No unacknowledged alerts</p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Recent Actions */}
        <Card>
          <CardContent className="p-5">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                Recent Actions
              </h3>
              <Link to="/autonomous/audit" className="text-xs text-primary hover:underline">
                View all
              </Link>
            </div>
            <div className="space-y-2">
              {data.recentActions.slice(0, 10).map((entry) => (
                <div
                  key={entry.id}
                  className="flex items-center justify-between gap-3 rounded-md border p-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{entry.action}</p>
                    <p className="text-xs text-muted-foreground">
                      {entry.agentName} · {format(parseISO(entry.createdAt), 'MMM d HH:mm')}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">{Math.round(entry.confidence * 100)}%</span>
                    <Badge variant={OUTCOME_COLORS[entry.outcome] ?? 'secondary'} className="text-xs">
                      {entry.outcome}
                    </Badge>
                  </div>
                </div>
              ))}
              {data.recentActions.length === 0 && (
                <p className="py-4 text-center text-sm text-muted-foreground">No recent actions</p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Team Overview */}
        <Card>
          <CardContent className="p-5">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                Teams
              </h3>
              <Link to="/autonomous/teams" className="text-xs text-primary hover:underline">
                View all
              </Link>
            </div>
            <div className="space-y-2">
              {data.teams.map((team) => (
                <Link
                  key={team.id}
                  to={`/autonomous/teams/${team.id}`}
                  className="flex items-center justify-between rounded-md border p-3 transition-colors hover:bg-muted/50"
                >
                  <div className="flex items-center gap-3">
                    <Users className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-medium">{team.name}</span>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span>{team.agentCount} agents</span>
                    <span>{team.activeAgents} active</span>
                  </div>
                </Link>
              ))}
              {data.teams.length === 0 && (
                <p className="py-4 text-center text-sm text-muted-foreground">No teams configured</p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </motion.div>
  );
}
