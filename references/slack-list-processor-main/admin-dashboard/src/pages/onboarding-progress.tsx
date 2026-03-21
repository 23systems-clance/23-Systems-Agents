import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Users, GraduationCap, AlertTriangle, Clock, TrendingUp, BarChart3 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { PageSkeleton } from '@/components/shared/LoadingSkeleton';
import {
  fetchOnboardingDashboard,
  type OnboardingDashboard,
} from '@/services/onboarding-progress';

/** Stat card configuration for the top-level metrics grid. */
const STAT_CARDS: Array<{
  key: keyof Pick<
    OnboardingDashboard,
    | 'total_active_enrollments'
    | 'total_supervised'
    | 'total_pending_graduation'
    | 'total_graduated_all_time'
    | 'average_progress_percentage'
    | 'average_graduation_days'
  >;
  label: string;
  icon: React.ElementType;
  format: (value: number | null) => string;
}> = [
  {
    key: 'total_active_enrollments',
    label: 'Active Enrollments',
    icon: Users,
    format: (v) => String(v ?? 0),
  },
  {
    key: 'total_supervised',
    label: 'Supervised',
    icon: Clock,
    format: (v) => String(v ?? 0),
  },
  {
    key: 'total_pending_graduation',
    label: 'Pending Graduation',
    icon: GraduationCap,
    format: (v) => String(v ?? 0),
  },
  {
    key: 'total_graduated_all_time',
    label: 'Graduated (All Time)',
    icon: GraduationCap,
    format: (v) => String(v ?? 0),
  },
  {
    key: 'average_progress_percentage',
    label: 'Avg Progress',
    icon: TrendingUp,
    format: (v) => `${(v ?? 0).toFixed(1)}%`,
  },
  {
    key: 'average_graduation_days',
    label: 'Avg Graduation Days',
    icon: BarChart3,
    format: (v) => (v != null ? `${v.toFixed(1)} days` : '--'),
  },
];

/** Maps alert type to visual styling. */
const ALERT_STYLES: Record<
  'behind_schedule' | 'overdue' | 'quiz_failed',
  { border: string; badgeLabel: string; badgeClass: string }
> = {
  behind_schedule: {
    border: 'border-l-4 border-l-yellow-500',
    badgeLabel: 'Behind Schedule',
    badgeClass: 'bg-yellow-100 text-yellow-800 hover:bg-yellow-100',
  },
  overdue: {
    border: 'border-l-4 border-l-red-500',
    badgeLabel: 'Overdue',
    badgeClass: 'bg-red-100 text-red-800 hover:bg-red-100',
  },
  quiz_failed: {
    border: 'border-l-4 border-l-orange-500',
    badgeLabel: 'Quiz Failed',
    badgeClass: 'bg-orange-100 text-orange-800 hover:bg-orange-100',
  },
};

/**
 * Builds a human-readable detail string for an alert entry.
 */
function alertDetail(alert: OnboardingDashboard['alerts'][number]): string {
  switch (alert.type) {
    case 'behind_schedule':
      return [
        alert.days_behind != null ? `${alert.days_behind} day(s) behind` : null,
        alert.current_module ? `Current module: ${alert.current_module}` : null,
      ]
        .filter(Boolean)
        .join(' - ');
    case 'overdue':
      return alert.days_past_expected != null
        ? `${alert.days_past_expected} day(s) past expected completion`
        : '';
    case 'quiz_failed':
      return [
        alert.quiz_topic ? `Topic: ${alert.quiz_topic}` : null,
        alert.score != null ? `Score: ${alert.score}%` : null,
      ]
        .filter(Boolean)
        .join(' - ');
    default:
      return '';
  }
}

export default function OnboardingProgressPage() {
  const dashboardQuery = useQuery({
    queryKey: ['onboarding-progress'],
    queryFn: fetchOnboardingDashboard,
  });

  if (dashboardQuery.isLoading) {
    return (
      <div className="space-y-6">
        <h2 className="text-2xl font-bold">Onboarding Progress</h2>
        <PageSkeleton />
      </div>
    );
  }

  if (dashboardQuery.isError) {
    return (
      <div className="space-y-6">
        <h2 className="text-2xl font-bold">Onboarding Progress</h2>
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <AlertTriangle className="mx-auto mb-3 h-8 w-8 text-destructive" />
            <p>Failed to load onboarding dashboard. Please try again later.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const dashboard = dashboardQuery.data!;
  const alertCount = dashboard.alerts.length;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6"
    >
      <div>
        <h2 className="text-2xl font-bold">Onboarding Progress</h2>
        <p className="text-sm text-muted-foreground">
          Overview of BDR onboarding enrollments, alerts, and graduation metrics.
        </p>
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="alerts" className="relative">
            Alerts
            {alertCount > 0 && (
              <Badge variant="destructive" className="ml-1.5 h-5 min-w-5 px-1 text-xs">
                {alertCount}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="graduates">Graduates</TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
        </TabsList>

        {/* ---- Overview Tab ---- */}
        <TabsContent value="overview" className="space-y-6">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {STAT_CARDS.map((stat) => {
              const Icon = stat.icon;
              return (
                <Card key={stat.key}>
                  <CardHeader className="flex flex-row items-center justify-between pb-2">
                    <CardTitle className="text-sm font-medium text-muted-foreground">
                      {stat.label}
                    </CardTitle>
                    <Icon className="h-4 w-4 text-muted-foreground" />
                  </CardHeader>
                  <CardContent>
                    <p className="text-2xl font-bold">
                      {stat.format(dashboard[stat.key])}
                    </p>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {alertCount > 0 && (
            <Card className="border-l-4 border-l-yellow-500">
              <CardContent className="flex items-center gap-3 py-4">
                <AlertTriangle className="h-5 w-5 text-yellow-600" />
                <span className="text-sm font-medium">
                  {alertCount} active alert{alertCount !== 1 ? 's' : ''} require attention
                </span>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ---- Alerts Tab ---- */}
        <TabsContent value="alerts" className="space-y-4">
          {dashboard.alerts.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                No active alerts.
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {dashboard.alerts.map((alert, idx) => {
                const style = ALERT_STYLES[alert.type];
                return (
                  <Card key={`${alert.enrollment_id}-${alert.type}-${idx}`} className={style.border}>
                    <CardContent className="flex items-start justify-between py-4">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{alert.bdr_name}</span>
                          <Badge className={style.badgeClass}>{style.badgeLabel}</Badge>
                        </div>
                        <p className="text-sm text-muted-foreground">{alertDetail(alert)}</p>
                      </div>
                      <AlertTriangle className="h-4 w-4 shrink-0 text-muted-foreground" />
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        {/* ---- Graduates Tab ---- */}
        <TabsContent value="graduates" className="space-y-4">
          {dashboard.recent_graduates.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                No graduates yet.
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
              {dashboard.recent_graduates.map((grad, idx) => (
                <Card key={`${grad.bdr_name}-${idx}`}>
                  <CardContent className="py-4">
                    <div className="flex items-center gap-2">
                      <GraduationCap className="h-4 w-4 text-muted-foreground" />
                      <span className="font-medium">{grad.bdr_name}</span>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">{grad.plan_name}</p>
                    <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                      <span>{new Date(grad.graduated_at).toLocaleDateString()}</span>
                      <span>{grad.completion_days} days to complete</span>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* ---- Analytics Tab ---- */}
        <TabsContent value="analytics" className="space-y-6">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Avg Graduation Time
                </CardTitle>
                <BarChart3 className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">
                  {dashboard.average_graduation_days != null
                    ? `${dashboard.average_graduation_days.toFixed(1)} days`
                    : '--'}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  Avg Active Progress
                </CardTitle>
                <TrendingUp className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">
                  {(dashboard.average_progress_percentage ?? 0).toFixed(1)}%
                </p>
              </CardContent>
            </Card>
          </div>

          <div className="space-y-3">
            <h3 className="text-lg font-semibold">Common Struggle Modules</h3>
            {dashboard.common_struggle_modules.length === 0 ? (
              <Card>
                <CardContent className="py-8 text-center text-muted-foreground">
                  No struggle module data available.
                </CardContent>
              </Card>
            ) : (
              <Card>
                <CardContent className="p-0">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Module</TableHead>
                        <TableHead className="text-center">Day</TableHead>
                        <TableHead className="text-right">Incomplete Rate</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {dashboard.common_struggle_modules.map((mod) => (
                        <TableRow key={`${mod.day_number}-${mod.module_title}`}>
                          <TableCell className="font-medium">{mod.module_title}</TableCell>
                          <TableCell className="text-center">{mod.day_number}</TableCell>
                          <TableCell className="text-right">
                            {(mod.incomplete_rate * 100).toFixed(1)}%
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            )}
          </div>
        </TabsContent>
      </Tabs>
    </motion.div>
  );
}
