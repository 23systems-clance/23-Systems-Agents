import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { format, parseISO } from 'date-fns';
import { queryKeys } from '@/lib/query-keys';
import { formatCurrency } from '@/lib/utils';
import { fetchUsageTrends, fetchUsageLogs } from '@/services/usage';
import { DateRangePicker } from '@/components/shared/DateRangePicker';
import { useDateRange } from '@/hooks/useDateRange';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PageSkeleton } from '@/components/shared/LoadingSkeleton';

export default function UsagePage() {
  const { params, setDays } = useDateRange(30);
  const [granularity, setGranularity] = useState('daily');
  const [logsOffset, setLogsOffset] = useState(0);
  const logsLimit = 20;

  const trendsQuery = useQuery({
    queryKey: queryKeys.usage.trends({ ...params, granularity }),
    queryFn: () => fetchUsageTrends({ ...params, granularity }),
  });

  const logsQuery = useQuery({
    queryKey: queryKeys.usage.logs({ ...params, offset: String(logsOffset), limit: String(logsLimit) }),
    queryFn: () => fetchUsageLogs({ ...params, offset: String(logsOffset), limit: String(logsLimit) }),
  });

  const chartData = (trendsQuery.data?.data_points ?? []).map((d) => ({
    date: d.period,
    cost: parseFloat(d.totalCostUsd),
    requests: d.totalRequests,
  }));

  const totalLogs = logsQuery.data?.total ?? 0;
  const currentPage = Math.floor(logsOffset / logsLimit) + 1;
  const totalPages = Math.ceil(totalLogs / logsLimit) || 1;

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Usage</h2>
        <DateRangePicker onDaysChange={setDays} />
      </div>

      <Tabs defaultValue="trends">
        <TabsList>
          <TabsTrigger value="trends">Trends</TabsTrigger>
          <TabsTrigger value="logs">Logs</TabsTrigger>
        </TabsList>

        <TabsContent value="trends">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">Cost & Request Trends</CardTitle>
              <Select value={granularity} onValueChange={setGranularity}>
                <SelectTrigger className="w-[130px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="daily">Daily</SelectItem>
                  <SelectItem value="weekly">Weekly</SelectItem>
                  <SelectItem value="monthly">Monthly</SelectItem>
                </SelectContent>
              </Select>
            </CardHeader>
            <CardContent>
              {trendsQuery.isLoading ? (
                <PageSkeleton />
              ) : (
                <ResponsiveContainer width="100%" height={350}>
                  <AreaChart data={chartData}>
                    <defs>
                      <linearGradient id="colorCost" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="hsl(12, 76%, 61%)" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="hsl(12, 76%, 61%)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis
                      dataKey="date"
                      tickFormatter={(d) => format(parseISO(d), 'MMM d')}
                      tick={{ fontSize: 12 }}
                    />
                    <YAxis tickFormatter={(v) => formatCurrency(v)} tick={{ fontSize: 12 }} />
                    <Tooltip
                      formatter={(value) => formatCurrency(Number(value))}
                      labelFormatter={(d) => format(parseISO(d as string), 'MMM d, yyyy')}
                    />
                    <Area
                      type="monotone"
                      dataKey="cost"
                      stroke="hsl(12, 76%, 61%)"
                      fill="url(#colorCost)"
                      strokeWidth={2}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="logs">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">API Call Logs</CardTitle>
            </CardHeader>
            <CardContent>
              {logsQuery.isLoading ? (
                <PageSkeleton />
              ) : (
                <>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b">
                          <th className="px-3 py-2 text-left font-medium text-muted-foreground">Time</th>
                          <th className="px-3 py-2 text-left font-medium text-muted-foreground">Service</th>
                          <th className="px-3 py-2 text-left font-medium text-muted-foreground">Endpoint</th>
                          <th className="px-3 py-2 text-left font-medium text-muted-foreground">Channel</th>
                          <th className="px-3 py-2 text-right font-medium text-muted-foreground">Credits</th>
                          <th className="px-3 py-2 text-right font-medium text-muted-foreground">Cost</th>
                          <th className="px-3 py-2 text-right font-medium text-muted-foreground">Duration</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(logsQuery.data?.logs ?? []).map((log) => (
                          <tr key={log.id} className="border-b hover:bg-muted/50">
                            <td className="px-3 py-2">{format(parseISO(log.createdAt), 'MMM d HH:mm')}</td>
                            <td className="px-3 py-2">{log.service}</td>
                            <td className="px-3 py-2 font-mono text-xs">{log.endpoint}</td>
                            <td className="px-3 py-2">{log.job?.slackChannelName ?? '-'}</td>
                            <td className="px-3 py-2 text-right">{log.creditsConsumed}</td>
                            <td className="px-3 py-2 text-right">{formatCurrency(parseFloat(log.estimatedCostUsd))}</td>
                            <td className="px-3 py-2 text-right">{log.durationMs ? `${log.durationMs}ms` : '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="mt-4 flex items-center justify-between">
                    <p className="text-sm text-muted-foreground">
                      Page {currentPage} of {totalPages} ({totalLogs} total)
                    </p>
                    <div className="flex gap-2">
                      <button
                        className="rounded border px-3 py-1 text-sm disabled:opacity-50"
                        disabled={logsOffset <= 0}
                        onClick={() => setLogsOffset((o) => Math.max(0, o - logsLimit))}
                      >
                        Previous
                      </button>
                      <button
                        className="rounded border px-3 py-1 text-sm disabled:opacity-50"
                        disabled={logsOffset + logsLimit >= totalLogs}
                        onClick={() => setLogsOffset((o) => o + logsLimit)}
                      >
                        Next
                      </button>
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </motion.div>
  );
}
