import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { format, parseISO } from 'date-fns';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { queryKeys } from '@/lib/query-keys';
import { fetchErrors, fetchErrorDetail, updateErrorState, fetchErrorTrends } from '@/services/errors';
import { useDateRange } from '@/hooks/useDateRange';
import { DateRangePicker } from '@/components/shared/DateRangePicker';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { PageSkeleton } from '@/components/shared/LoadingSkeleton';
import type { ErrorEntry } from '@/types/api';

const STATE_COLORS: Record<string, 'default' | 'secondary' | 'destructive'> = {
  OPEN: 'destructive',
  ACKNOWLEDGED: 'secondary',
  RESOLVED: 'default',
};

export default function ErrorsPage() {
  const { params, setDays } = useDateRange(30);
  const [offset, setOffset] = useState(0);
  const limit = 20;
  const [stateFilter, setStateFilter] = useState('all');
  const [selectedError, setSelectedError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const filterParams = {
    ...params,
    offset: String(offset),
    limit: String(limit),
    ...(stateFilter !== 'all' ? { lifecycle_state: stateFilter } : {}),
  };

  const errorsQuery = useQuery({
    queryKey: queryKeys.errors.list(filterParams),
    queryFn: () => fetchErrors(filterParams),
  });

  const trendsQuery = useQuery({
    queryKey: queryKeys.errors.trends(params),
    queryFn: () => fetchErrorTrends(params),
  });

  const detailQuery = useQuery({
    queryKey: queryKeys.errors.detail(selectedError ?? ''),
    queryFn: () => fetchErrorDetail(selectedError!),
    enabled: !!selectedError,
  });

  const stateMutation = useMutation({
    mutationFn: ({ id, state }: { id: string; state: string }) => updateErrorState(id, state),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['errors'] });
      setSelectedError(null);
    },
  });

  // Flatten error trend groups into chart data
  const trendChartData = (trendsQuery.data?.groups ?? []).flatMap((g) =>
    g.data_points.map((dp) => ({ date: dp.period, count: dp.count, key: g.key })),
  );

  const totalErrors = errorsQuery.data?.total ?? 0;
  const currentPage = Math.floor(offset / limit) + 1;
  const totalPages = Math.ceil(totalErrors / limit) || 1;

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Errors</h2>
        <div className="flex items-center gap-3">
          <Select value={stateFilter} onValueChange={(v) => { setStateFilter(v); setOffset(0); }}>
            <SelectTrigger className="w-[150px]">
              <SelectValue placeholder="All states" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All states</SelectItem>
              <SelectItem value="OPEN">Open</SelectItem>
              <SelectItem value="ACKNOWLEDGED">Acknowledged</SelectItem>
              <SelectItem value="RESOLVED">Resolved</SelectItem>
            </SelectContent>
          </Select>
          <DateRangePicker onDaysChange={setDays} />
        </div>
      </div>

      {/* Error Trends Chart */}
      {trendChartData.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Error Trends</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={trendChartData}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="date" tickFormatter={(d) => format(parseISO(d), 'MMM d')} tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip labelFormatter={(d) => format(parseISO(d as string), 'MMM d, yyyy')} />
                <Bar dataKey="count" fill="hsl(0, 84.2%, 60.2%)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Error List Table */}
      <Card>
        <CardContent className="p-0">
          {errorsQuery.isLoading ? (
            <PageSkeleton />
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="px-4 py-3 text-left font-medium text-muted-foreground">Time</th>
                      <th className="px-4 py-3 text-left font-medium text-muted-foreground">Category</th>
                      <th className="px-4 py-3 text-left font-medium text-muted-foreground">Service</th>
                      <th className="px-4 py-3 text-left font-medium text-muted-foreground">Message</th>
                      <th className="px-4 py-3 text-left font-medium text-muted-foreground">State</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(errorsQuery.data?.errors ?? []).map((err: ErrorEntry) => (
                      <tr
                        key={err.id}
                        className="cursor-pointer border-b hover:bg-muted/50"
                        onClick={() => setSelectedError(err.id)}
                      >
                        <td className="px-4 py-3">{format(parseISO(err.createdAt), 'MMM d HH:mm')}</td>
                        <td className="px-4 py-3">{err.category}</td>
                        <td className="px-4 py-3">{err.service}</td>
                        <td className="max-w-xs truncate px-4 py-3">{err.message}</td>
                        <td className="px-4 py-3">
                          <Badge variant={STATE_COLORS[err.lifecycleState] ?? 'secondary'}>
                            {err.lifecycleState}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                    {(errorsQuery.data?.errors ?? []).length === 0 && (
                      <tr>
                        <td colSpan={5} className="py-8 text-center text-muted-foreground">
                          No errors found
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="flex items-center justify-between p-4">
                <p className="text-sm text-muted-foreground">
                  Page {currentPage} of {totalPages} ({totalErrors} total)
                </p>
                <div className="flex gap-2">
                  <button
                    className="rounded border px-3 py-1 text-sm disabled:opacity-50"
                    disabled={offset <= 0}
                    onClick={() => setOffset((o) => Math.max(0, o - limit))}
                  >
                    Previous
                  </button>
                  <button
                    className="rounded border px-3 py-1 text-sm disabled:opacity-50"
                    disabled={offset + limit >= totalErrors}
                    onClick={() => setOffset((o) => o + limit)}
                  >
                    Next
                  </button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Error Detail Dialog */}
      <Dialog open={!!selectedError} onOpenChange={() => setSelectedError(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Error Details</DialogTitle>
            <DialogDescription>View error details and manage lifecycle state</DialogDescription>
          </DialogHeader>
          {detailQuery.isLoading ? (
            <PageSkeleton />
          ) : detailQuery.data ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">Category:</span>{' '}
                  {detailQuery.data.category}
                </div>
                <div>
                  <span className="text-muted-foreground">Service:</span>{' '}
                  {detailQuery.data.service}
                </div>
                <div>
                  <span className="text-muted-foreground">State:</span>{' '}
                  <Badge variant={STATE_COLORS[detailQuery.data.lifecycleState] ?? 'secondary'}>
                    {detailQuery.data.lifecycleState}
                  </Badge>
                </div>
                <div>
                  <span className="text-muted-foreground">Time:</span>{' '}
                  {format(parseISO(detailQuery.data.createdAt), 'MMM d, yyyy HH:mm:ss')}
                </div>
              </div>

              <div>
                <p className="mb-1 text-sm font-medium text-muted-foreground">Message</p>
                <p className="text-sm">{detailQuery.data.message}</p>
              </div>

              {detailQuery.data.stackTrace && (
                <div>
                  <p className="mb-1 text-sm font-medium text-muted-foreground">Stack Trace</p>
                  <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded bg-muted p-3 text-xs">
                    {detailQuery.data.stackTrace}
                  </pre>
                </div>
              )}

              {detailQuery.data.metadata && Object.keys(detailQuery.data.metadata).length > 0 && (
                <div>
                  <p className="mb-1 text-sm font-medium text-muted-foreground">Metadata</p>
                  <pre className="max-h-32 overflow-auto whitespace-pre-wrap break-all rounded bg-muted p-3 text-xs">
                    {JSON.stringify(detailQuery.data.metadata, null, 2)}
                  </pre>
                </div>
              )}

              {/* State Transition Buttons */}
              <div className="flex gap-2 pt-2">
                {detailQuery.data.lifecycleState === 'OPEN' && (
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => stateMutation.mutate({ id: detailQuery.data!.id, state: 'ACKNOWLEDGED' })}
                    disabled={stateMutation.isPending}
                  >
                    Acknowledge
                  </Button>
                )}
                {(detailQuery.data.lifecycleState === 'OPEN' || detailQuery.data.lifecycleState === 'ACKNOWLEDGED') && (
                  <Button
                    size="sm"
                    onClick={() => stateMutation.mutate({ id: detailQuery.data!.id, state: 'RESOLVED' })}
                    disabled={stateMutation.isPending}
                  >
                    Resolve
                  </Button>
                )}
              </div>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </motion.div>
  );
}
