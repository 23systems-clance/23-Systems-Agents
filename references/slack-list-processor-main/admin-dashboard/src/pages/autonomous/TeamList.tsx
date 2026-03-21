/**
 * Autonomous Team List page (T092 - Feature 31).
 *
 * Table of teams with agent count, active agents, and pending action summary.
 */

import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Users } from 'lucide-react';
import { queryKeys } from '@/lib/query-keys';
import { fetchTeams } from '@/services/autonomous';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { PageSkeleton } from '@/components/shared/LoadingSkeleton';

export default function TeamListPage() {
  const navigate = useNavigate();

  const { data: teams, isLoading } = useQuery({
    queryKey: queryKeys.autonomous.teams(),
    queryFn: () => fetchTeams(),
  });

  if (isLoading) return <PageSkeleton />;

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
      <div className="flex items-center gap-3">
        <Users className="h-6 w-6 text-muted-foreground" />
        <div>
          <h1 className="text-2xl font-bold">Agent Teams</h1>
          <p className="text-sm text-muted-foreground">
            {teams?.length ?? 0} team{(teams?.length ?? 0) !== 1 ? 's' : ''} configured
          </p>
        </div>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Team Name</TableHead>
              <TableHead className="text-right">Agents</TableHead>
              <TableHead className="text-right">Active</TableHead>
              <TableHead className="text-right">Pending Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(teams ?? []).length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                  No teams found
                </TableCell>
              </TableRow>
            ) : (
              (teams ?? []).map((team) => (
                <TableRow
                  key={team.id}
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => navigate(`/autonomous/teams/${team.id}`)}
                >
                  <TableCell>
                    <div>
                      <p className="font-medium">{team.name}</p>
                      {team.description && (
                        <p className="text-xs text-muted-foreground">{team.description}</p>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-right text-sm">{team.agentCount}</TableCell>
                  <TableCell className="text-right text-sm">{team.activeAgents}</TableCell>
                  <TableCell className="text-right">
                    {team.pendingActions > 0 ? (
                      <Badge variant="secondary" className="text-xs">
                        {team.pendingActions}
                      </Badge>
                    ) : (
                      <span className="text-sm text-muted-foreground">0</span>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </motion.div>
  );
}
