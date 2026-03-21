import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { DollarSign, Activity, Cpu, Briefcase, AlertTriangle } from 'lucide-react';
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import type { PieLabelRenderProps } from 'recharts';
import { queryKeys } from '@/lib/query-keys';
import { formatCurrency, formatNumber } from '@/lib/utils';
import { fetchOverview } from '@/services/overview';
import { StatCard } from '@/components/shared/StatCard';
import { DateRangePicker } from '@/components/shared/DateRangePicker';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { PageSkeleton } from '@/components/shared/LoadingSkeleton';
import { useDateRange } from '@/hooks/useDateRange';

const CHART_COLORS = [
  'hsl(174, 60%, 41%)',
  'hsl(215, 50%, 43%)',
  'hsl(35, 80%, 56%)',
  'hsl(4, 70%, 58%)',
  'hsl(270, 50%, 55%)',
];

const container = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.06 } },
};

const item = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { duration: 0.4, ease: 'easeOut' as const } },
};

const RADIAN = Math.PI / 180;
const renderPieLabel = (props: PieLabelRenderProps) => {
  const cx = Number(props.cx ?? 0);
  const cy = Number(props.cy ?? 0);
  const midAngle = props.midAngle ?? 0;
  const outerRadius = Number(props.outerRadius ?? 0);
  const name = String(props.name ?? '');
  const value = Number(props.value ?? 0);
  const radius = outerRadius + 30;
  const x = cx + radius * Math.cos(-midAngle * RADIAN);
  const y = cy + radius * Math.sin(-midAngle * RADIAN);
  return (
    <text
      x={x}
      y={y}
      textAnchor={x > cx ? 'start' : 'end'}
      dominantBaseline="central"
      className="fill-foreground text-xs font-medium"
    >
      {`${name}: ${formatCurrency(value)}`}
    </text>
  );
};

export default function OverviewPage() {
  const { params, setDays } = useDateRange(30);
  const { data, isLoading } = useQuery({
    queryKey: queryKeys.overview(params),
    queryFn: () => fetchOverview(params),
  });

  if (isLoading || !data) return <PageSkeleton />;

  const shortName: Record<string, string> = { BUILTWITH: 'BuiltWith', AI_ORCHESTRATOR: 'AI', APOLLO: 'Apollo' };
  const providerData = data.costByProvider
    .filter((p) => parseFloat(p.costUsd) > 0)
    .map((p) => ({
      name: shortName[p.service] ?? p.service,
      value: parseFloat(p.costUsd),
    }));

  const workspaceData = data.costByWorkspace.map((w) => ({
    name: w.slackTeamName,
    cost: parseFloat(w.costUsd),
  }));

  return (
    <motion.div variants={container} initial="hidden" animate="show" className="space-y-6">
      <div className="flex items-center justify-between">
        <motion.div variants={item}>
          <h2 className="text-2xl font-bold tracking-tight">Overview</h2>
          <p className="text-sm text-muted-foreground">Platform health and cost summary</p>
        </motion.div>
        <motion.div variants={item} className="flex items-center gap-3">
          {data.openErrors > 0 && (
            <Badge variant="destructive" className="gap-1">
              <AlertTriangle className="h-3 w-3" />
              {data.openErrors} open error{data.openErrors > 1 ? 's' : ''}
            </Badge>
          )}
          <DateRangePicker onDaysChange={setDays} />
        </motion.div>
      </div>

      {/* KPI Cards */}
      <motion.div variants={item} className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Total Cost"
          value={formatCurrency(parseFloat(data.summary.totalCostUsd))}
          icon={DollarSign}
          accent="teal"
        />
        <StatCard
          title="API Calls"
          value={formatNumber(data.summary.totalApiCalls)}
          icon={Activity}
          accent="indigo"
        />
        <StatCard
          title="Tokens Used"
          value={formatNumber(data.summary.totalTokensInput + data.summary.totalTokensOutput)}
          icon={Cpu}
          accent="amber"
        />
        <StatCard
          title="Jobs"
          value={`${data.summary.completedJobs}`}
          subtitle={`${data.summary.failedJobs} failed`}
          icon={Briefcase}
          accent="rose"
        />
      </motion.div>

      {/* Charts Row */}
      <motion.div variants={item} className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Provider Breakdown Donut */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Cost by Provider</CardTitle>
          </CardHeader>
          <CardContent>
            {providerData.length === 0 ? (
              <p className="py-12 text-center text-sm text-muted-foreground">No data</p>
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie
                    data={providerData}
                    cx="50%"
                    cy="50%"
                    innerRadius={55}
                    outerRadius={90}
                    paddingAngle={3}
                    dataKey="value"
                    nameKey="name"
                    label={renderPieLabel}
                    strokeWidth={2}
                    stroke="hsl(0 0% 100%)"
                  >
                    {providerData.map((_, idx) => (
                      <Cell key={idx} fill={CHART_COLORS[idx % CHART_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value) => formatCurrency(Number(value))}
                    contentStyle={{
                      borderRadius: '8px',
                      border: '1px solid hsl(30 12% 89%)',
                      boxShadow: '0 4px 12px hsla(0, 0%, 0%, 0.08)',
                      fontSize: '13px',
                      fontFamily: 'var(--font-sans)',
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Cost by Workspace Bar */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold">Cost by Workspace</CardTitle>
          </CardHeader>
          <CardContent>
            {workspaceData.length === 0 ? (
              <p className="py-12 text-center text-sm text-muted-foreground">No data</p>
            ) : (
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={workspaceData} layout="vertical" margin={{ left: 40 }}>
                  <XAxis
                    type="number"
                    tickFormatter={(v) => formatCurrency(v)}
                    tick={{ fontSize: 12, fontFamily: 'var(--font-sans)' }}
                  />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={120}
                    tick={{ fontSize: 12, fontFamily: 'var(--font-sans)' }}
                  />
                  <Tooltip
                    formatter={(value) => formatCurrency(Number(value))}
                    contentStyle={{
                      borderRadius: '8px',
                      border: '1px solid hsl(30 12% 89%)',
                      boxShadow: '0 4px 12px hsla(0, 0%, 0%, 0.08)',
                      fontSize: '13px',
                      fontFamily: 'var(--font-sans)',
                    }}
                  />
                  <Bar
                    dataKey="cost"
                    fill={CHART_COLORS[0]}
                    radius={[0, 6, 6, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </motion.div>
    </motion.div>
  );
}
