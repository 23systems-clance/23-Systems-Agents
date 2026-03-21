/**
 * Autonomous Team Detail page (T093 - Feature 31).
 *
 * Team info, member agents list, and inline editing of team metadata.
 */

import { useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { ArrowLeft, Users, Bot, Pencil, Save, X } from 'lucide-react';
import { queryKeys } from '@/lib/query-keys';
import { fetchTeamDetail, updateTeam } from '@/services/autonomous';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { PageSkeleton } from '@/components/shared/LoadingSkeleton';

const STATUS_COLORS: Record<string, string> = {
  active: 'bg-green-500/10 text-green-600 border-green-500/20',
  paused: 'bg-yellow-500/10 text-yellow-600 border-yellow-500/20',
  error: 'bg-red-500/10 text-red-600 border-red-500/20',
};

export default function TeamDetailPage() {
  const { teamId } = useParams<{ teamId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');

  const { data: team, isLoading } = useQuery({
    queryKey: queryKeys.autonomous.team(teamId!),
    queryFn: () => fetchTeamDetail(teamId!),
    enabled: !!teamId,
  });

  const updateMutation = useMutation({
    mutationFn: (input: { name: string; description: string }) =>
      updateTeam(teamId!, input),
    onSuccess: () => {
      setEditing(false);
      queryClient.invalidateQueries({ queryKey: queryKeys.autonomous.team(teamId!) });
      queryClient.invalidateQueries({ queryKey: queryKeys.autonomous.teams() });
    },
  });

  /** Enter edit mode with current values. */
  function startEditing() {
    if (!team) return;
    setEditName(team.name);
    setEditDescription(team.description ?? '');
    setEditing(true);
  }

  if (isLoading || !team) return <PageSkeleton />;

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link to="/autonomous/teams" className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <Users className="h-6 w-6 text-muted-foreground" />
        <div className="flex-1">
          <h1 className="text-2xl font-bold">{team.name}</h1>
          {team.description && (
            <p className="text-sm text-muted-foreground">{team.description}</p>
          )}
        </div>
        {!editing && (
          <Button variant="outline" size="sm" className="gap-1" onClick={startEditing}>
            <Pencil className="h-3.5 w-3.5" />
            Edit
          </Button>
        )}
      </div>

      {/* Edit Form */}
      {editing && (
        <Card>
          <CardContent className="space-y-4 p-5">
            <h3 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Edit Team
            </h3>
            <div className="space-y-3">
              <div>
                <label htmlFor="team-name" className="mb-1 block text-sm font-medium">
                  Name
                </label>
                <Input
                  id="team-name"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                />
              </div>
              <div>
                <label htmlFor="team-desc" className="mb-1 block text-sm font-medium">
                  Description
                </label>
                <Textarea
                  id="team-desc"
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  rows={3}
                />
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                className="gap-1"
                disabled={!editName.trim() || updateMutation.isPending}
                onClick={() => updateMutation.mutate({ name: editName.trim(), description: editDescription.trim() })}
              >
                <Save className="h-3.5 w-3.5" />
                Save
              </Button>
              <Button variant="outline" size="sm" className="gap-1" onClick={() => setEditing(false)}>
                <X className="h-3.5 w-3.5" />
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Team Stats */}
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-5 text-center">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Agents
            </p>
            <p className="mt-1 text-2xl font-bold">{team.agentCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5 text-center">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Active
            </p>
            <p className="mt-1 text-2xl font-bold">{team.activeAgents}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5 text-center">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Pending Actions
            </p>
            <p className="mt-1 text-2xl font-bold">{team.pendingActions}</p>
          </CardContent>
        </Card>
      </div>

      {/* Member Agents */}
      <Card>
        <CardContent className="p-5">
          <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Member Agents
          </h3>
          <div className="space-y-2">
            {(team.agents ?? []).map((agent) => (
              <div
                key={agent.id}
                className="flex cursor-pointer items-center justify-between rounded-md border p-3 transition-colors hover:bg-muted/50"
                role="link"
                tabIndex={0}
                onClick={() => navigate(`/autonomous/agents/${agent.id}`)}
                onKeyDown={(e) => { if (e.key === 'Enter') navigate(`/autonomous/agents/${agent.id}`); }}
              >
                <div className="flex items-center gap-3">
                  <Bot className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium">{agent.name}</span>
                </div>
                <div className="flex items-center gap-2">
                  {agent.suggestOnlyMode && (
                    <Badge variant="outline" className="text-xs">Suggest Only</Badge>
                  )}
                  <Badge variant="outline" className={STATUS_COLORS[agent.status] ?? ''}>
                    {agent.status}
                  </Badge>
                </div>
              </div>
            ))}
            {(team.agents ?? []).length === 0 && (
              <p className="py-4 text-center text-sm text-muted-foreground">
                No agents assigned to this team
              </p>
            )}
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}
