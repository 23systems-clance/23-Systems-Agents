/**
 * Platform Analytics page (T063 - Feature 39).
 *
 * Aggregate analytics: skill usage, pack performance, workspace spending.
 */

import { useQuery } from '@tanstack/react-query';
import { BarChart3, Package, Users, Zap } from 'lucide-react';
import {
  getSkillAnalytics,
  getPackAnalytics,
  getWorkspaceAnalytics,
  type SkillAnalytics,
  type PackAnalytics,
  type WorkspaceAnalytics,
} from '@/services/platform/executions';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { PageSkeleton } from '@/components/shared/LoadingSkeleton';

export default function PlatformAnalyticsPage() {
  const { data: skillData, isLoading: loadingSkills } = useQuery({
    queryKey: ['analytics-skills'],
    queryFn: () => getSkillAnalytics(),
  });

  const { data: packData, isLoading: loadingPacks } = useQuery({
    queryKey: ['analytics-packs'],
    queryFn: () => getPackAnalytics(),
  });

  const { data: workspaceData, isLoading: loadingWorkspaces } = useQuery({
    queryKey: ['analytics-workspaces'],
    queryFn: () => getWorkspaceAnalytics(),
  });

  if (loadingSkills || loadingPacks || loadingWorkspaces) return <PageSkeleton />;

  const skills = skillData?.skills ?? [];
  const packs = packData?.packs ?? [];
  const workspaces = workspaceData?.workspaces ?? [];

  // Summary metrics
  const totalExecutions = skills.reduce((sum, s) => sum + s.totalExecutions, 0);
  const totalCredits = skills.reduce((sum, s) => sum + s.totalCreditsConsumed, 0);
  const totalCost = skills.reduce((sum, s) => sum + s.totalCostUsd, 0);
  const totalMRR = packs.reduce((sum, p) => sum + p.monthlyRecurringRevenue, 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <BarChart3 className="h-6 w-6 text-muted-foreground" />
        <h1 className="text-2xl font-bold">Platform Analytics</h1>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-4 gap-4">
        <SummaryCard icon={Zap} title="Total Executions" value={totalExecutions.toLocaleString()} />
        <SummaryCard icon={BarChart3} title="Credits Consumed" value={totalCredits.toFixed(0)} />
        <SummaryCard icon={Users} title="LLM Cost" value={`$${totalCost.toFixed(2)}`} />
        <SummaryCard icon={Package} title="MRR" value={`$${totalMRR.toFixed(2)}`} />
      </div>

      {/* Skills Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Skill Performance</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Skill</TableHead>
                <TableHead className="text-right">Executions</TableHead>
                <TableHead className="text-right">Success Rate</TableHead>
                <TableHead className="text-right">Avg Duration</TableHead>
                <TableHead className="text-right">Credits</TableHead>
                <TableHead className="text-right">LLM Cost</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {skills.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-6">
                    No skill data yet.
                  </TableCell>
                </TableRow>
              ) : (
                skills.map((s: SkillAnalytics) => (
                  <TableRow key={s.skillId}>
                    <TableCell className="font-medium">{s.skillName}</TableCell>
                    <TableCell className="text-right">{s.totalExecutions}</TableCell>
                    <TableCell className="text-right">
                      <Badge
                        variant="outline"
                        className={
                          s.successRate >= 0.95
                            ? 'bg-green-500/10 text-green-600'
                            : s.successRate >= 0.8
                              ? 'bg-yellow-500/10 text-yellow-600'
                              : 'bg-red-500/10 text-red-600'
                        }
                      >
                        {(s.successRate * 100).toFixed(0)}%
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">{Math.round(s.avgDurationMs)}ms</TableCell>
                    <TableCell className="text-right">{s.totalCreditsConsumed.toFixed(1)}</TableCell>
                    <TableCell className="text-right">${s.totalCostUsd.toFixed(2)}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Packs Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Pack Performance</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Pack</TableHead>
                <TableHead className="text-right">Subscribers</TableHead>
                <TableHead className="text-right">Active</TableHead>
                <TableHead className="text-right">Credits Used</TableHead>
                <TableHead className="text-right">Credits Included</TableHead>
                <TableHead className="text-right">MRR</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {packs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-6">
                    No pack data yet.
                  </TableCell>
                </TableRow>
              ) : (
                packs.map((p: PackAnalytics) => (
                  <TableRow key={p.packId}>
                    <TableCell className="font-medium">{p.packName}</TableCell>
                    <TableCell className="text-right">{p.subscriberCount}</TableCell>
                    <TableCell className="text-right">{p.activeUsers}</TableCell>
                    <TableCell className="text-right">{p.totalCreditsUsed.toLocaleString()}</TableCell>
                    <TableCell className="text-right">{p.totalCreditsIncluded.toLocaleString()}</TableCell>
                    <TableCell className="text-right">${p.monthlyRecurringRevenue.toFixed(2)}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Workspaces Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Workspace Activity</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Workspace</TableHead>
                <TableHead className="text-right">Active Packs</TableHead>
                <TableHead className="text-right">Executions</TableHead>
                <TableHead className="text-right">Credits Used</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {workspaces.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground py-6">
                    No workspace data yet.
                  </TableCell>
                </TableRow>
              ) : (
                workspaces.map((w: WorkspaceAnalytics) => (
                  <TableRow key={w.slackTeamId}>
                    <TableCell>
                      <div>
                        <p className="font-medium">{w.teamName}</p>
                        <p className="text-xs text-muted-foreground font-mono">{w.slackTeamId}</p>
                      </div>
                    </TableCell>
                    <TableCell className="text-right">{w.activePacks}</TableCell>
                    <TableCell className="text-right">{w.totalExecutions}</TableCell>
                    <TableCell className="text-right">{w.totalCreditsUsed.toLocaleString()}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function SummaryCard({ icon: Icon, title, value }: { icon: React.ComponentType<{ className?: string }>; title: string; value: string }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center gap-3">
          <Icon className="h-5 w-5 text-muted-foreground" />
          <div>
            <p className="text-sm text-muted-foreground">{title}</p>
            <p className="text-2xl font-bold">{value}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
