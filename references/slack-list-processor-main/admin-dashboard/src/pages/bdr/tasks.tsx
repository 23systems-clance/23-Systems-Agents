import { useQuery } from '@tanstack/react-query';
import { Phone, Inbox, Mail, Users, ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
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
import { fetchBdrTasks } from '@/services/bdr-tasks';

export default function BdrTasksPage() {
  const { data: tasks, isLoading } = useQuery({
    queryKey: ['bdr', 'tasks'],
    queryFn: fetchBdrTasks,
    refetchInterval: 30_000,
  });

  if (isLoading || !tasks) return <PageSkeleton />;

  const totalCalls = tasks.reduce((sum, t) => sum + t.pendingCalls, 0);
  const totalReplies = tasks.reduce((sum, t) => sum + t.unreadReplies, 0);
  const totalActive = tasks.reduce((sum, t) => sum + t.activeContacts, 0);
  const totalSequences = tasks.reduce((sum, t) => sum + t.activeSequences, 0);

  return (
    <div className="p-6 space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Your daily outreach overview
        </p>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          icon={Phone}
          iconColor="text-orange-500"
          iconBg="bg-orange-500/10"
          value={totalCalls}
          label="Pending calls"
        />
        <StatCard
          icon={Inbox}
          iconColor="text-blue-500"
          iconBg="bg-blue-500/10"
          value={totalReplies}
          label="Unread replies"
        />
        <StatCard
          icon={Users}
          iconColor="text-emerald-500"
          iconBg="bg-emerald-500/10"
          value={totalActive}
          label="Active contacts"
        />
        <StatCard
          icon={Mail}
          iconColor="text-purple-500"
          iconBg="bg-purple-500/10"
          value={totalSequences}
          label="Sequences in progress"
        />
      </div>

      {/* Campaign table */}
      <div>
        <h2 className="text-lg font-semibold mb-3">Campaigns</h2>
        {tasks.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              No active campaigns assigned to you.
            </CardContent>
          </Card>
        ) : (
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Campaign</TableHead>
                  <TableHead className="text-center">Active</TableHead>
                  <TableHead className="text-center">Calls</TableHead>
                  <TableHead className="text-center">Replies</TableHead>
                  <TableHead className="text-center">Sequences</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tasks.map((task) => (
                  <TableRow key={task.campaignId}>
                    <TableCell>
                      <div>
                        <p className="font-medium">{task.campaignName}</p>
                        <p className="text-xs text-muted-foreground">
                          {task.totalContacts} total contacts
                        </p>
                      </div>
                    </TableCell>
                    <TableCell className="text-center">
                      <span className="font-medium">{task.activeContacts}</span>
                    </TableCell>
                    <TableCell className="text-center">
                      {task.pendingCalls > 0 ? (
                        <Badge variant="destructive" className="font-mono">
                          {task.pendingCalls}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground">0</span>
                      )}
                    </TableCell>
                    <TableCell className="text-center">
                      {task.unreadReplies > 0 ? (
                        <Badge className="bg-blue-600 hover:bg-blue-700 font-mono">
                          {task.unreadReplies}
                        </Badge>
                      ) : (
                        <span className="text-muted-foreground">0</span>
                      )}
                    </TableCell>
                    <TableCell className="text-center">
                      <span className="text-muted-foreground">{task.activeSequences}</span>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        {task.pendingCalls > 0 && (
                          <Button asChild size="sm" variant="outline">
                            <Link to={`/bdr/calls/${task.campaignId}`}>
                              <Phone className="h-3.5 w-3.5 mr-1.5" />
                              Calls
                            </Link>
                          </Button>
                        )}
                        {task.unreadReplies > 0 && (
                          <Button asChild size="sm" variant="outline">
                            <Link to={`/bdr/unibox?campaignId=${task.campaignId}`}>
                              <Inbox className="h-3.5 w-3.5 mr-1.5" />
                              UniBox
                            </Link>
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        )}
      </div>

      {/* Quick actions */}
      <div className="flex gap-3">
        <Button asChild variant="outline">
          <Link to="/bdr/unibox">
            <Inbox className="h-4 w-4 mr-2" />
            All Replies
            <ArrowRight className="h-3.5 w-3.5 ml-2" />
          </Link>
        </Button>
        <Button asChild variant="outline">
          <Link to="/bdr/stats">
            View Stats
            <ArrowRight className="h-3.5 w-3.5 ml-2" />
          </Link>
        </Button>
      </div>
    </div>
  );
}

function StatCard({
  icon: Icon,
  iconColor,
  iconBg,
  value,
  label,
}: {
  icon: React.ComponentType<{ className?: string }>;
  iconColor: string;
  iconBg: string;
  value: number;
  label: string;
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center gap-3">
          <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${iconBg}`}>
            <Icon className={`h-5 w-5 ${iconColor}`} />
          </div>
          <div>
            <p className="text-2xl font-bold tabular-nums">{value}</p>
            <p className="text-xs text-muted-foreground">{label}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
