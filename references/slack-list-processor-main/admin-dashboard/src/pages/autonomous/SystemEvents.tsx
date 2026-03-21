/**
 * Autonomous System Events page (T095 - Feature 31).
 *
 * Paginated event feed with filters for type, severity, acknowledged status.
 * Acknowledge button per event.
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { format, parseISO } from 'date-fns';
import { Bell, CheckCircle2 } from 'lucide-react';
import { queryKeys } from '@/lib/query-keys';
import { fetchEvents, acknowledgeEvent } from '@/services/autonomous';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { PageSkeleton } from '@/components/shared/LoadingSkeleton';

const SEVERITY_COLORS: Record<string, string> = {
  low: 'bg-blue-500/10 text-blue-600 border-blue-500/20',
  medium: 'bg-yellow-500/10 text-yellow-600 border-yellow-500/20',
  high: 'bg-orange-500/10 text-orange-600 border-orange-500/20',
  critical: 'bg-red-500/10 text-red-600 border-red-500/20',
};

const TYPE_COLORS: Record<string, string> = {
  info: 'bg-blue-500/10 text-blue-600 border-blue-500/20',
  warning: 'bg-yellow-500/10 text-yellow-600 border-yellow-500/20',
  error: 'bg-red-500/10 text-red-600 border-red-500/20',
  success: 'bg-green-500/10 text-green-600 border-green-500/20',
};

export default function SystemEventsPage() {
  const queryClient = useQueryClient();
  const limit = 20;
  const [offset, setOffset] = useState(0);
  const [typeFilter, setTypeFilter] = useState('all');
  const [severityFilter, setSeverityFilter] = useState('all');
  const [acknowledgedFilter, setAcknowledgedFilter] = useState('all');

  const filterParams: Record<string, string> = {
    offset: String(offset),
    limit: String(limit),
  };
  if (typeFilter !== 'all') filterParams.type = typeFilter;
  if (severityFilter !== 'all') filterParams.severity = severityFilter;
  if (acknowledgedFilter !== 'all') filterParams.acknowledged = acknowledgedFilter;

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.autonomous.events(filterParams),
    queryFn: () => fetchEvents(filterParams),
    refetchInterval: 15_000,
  });

  const acknowledgeMutation = useMutation({
    mutationFn: acknowledgeEvent,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['autonomous', 'events'] });
      queryClient.invalidateQueries({ queryKey: queryKeys.autonomous.dashboard() });
    },
  });

  const total = data?.total ?? 0;
  const currentPage = Math.floor(offset / limit) + 1;
  const totalPages = Math.ceil(total / limit) || 1;

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Bell className="h-6 w-6 text-muted-foreground" />
        <div>
          <h1 className="text-2xl font-bold">System Events</h1>
          <p className="text-sm text-muted-foreground">
            {total} event{total !== 1 ? 's' : ''}
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <Select value={typeFilter} onValueChange={(v) => { setTypeFilter(v); setOffset(0); }}>
          <SelectTrigger className="w-36">
            <SelectValue placeholder="All types" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            <SelectItem value="info">Info</SelectItem>
            <SelectItem value="warning">Warning</SelectItem>
            <SelectItem value="error">Error</SelectItem>
            <SelectItem value="success">Success</SelectItem>
          </SelectContent>
        </Select>
        <Select value={severityFilter} onValueChange={(v) => { setSeverityFilter(v); setOffset(0); }}>
          <SelectTrigger className="w-36">
            <SelectValue placeholder="All severities" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All severities</SelectItem>
            <SelectItem value="low">Low</SelectItem>
            <SelectItem value="medium">Medium</SelectItem>
            <SelectItem value="high">High</SelectItem>
            <SelectItem value="critical">Critical</SelectItem>
          </SelectContent>
        </Select>
        <Select value={acknowledgedFilter} onValueChange={(v) => { setAcknowledgedFilter(v); setOffset(0); }}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="false">Unacknowledged</SelectItem>
            <SelectItem value="true">Acknowledged</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Event Feed */}
      {isLoading ? (
        <PageSkeleton />
      ) : (
        <>
          <div className="space-y-3">
            {(data?.events ?? []).length === 0 ? (
              <Card>
                <CardContent className="py-8 text-center text-muted-foreground">
                  No events found
                </CardContent>
              </Card>
            ) : (
              (data?.events ?? []).map((event) => (
                <Card key={event.id} className={event.acknowledged ? 'opacity-60' : ''}>
                  <CardContent className="flex items-start justify-between gap-4 p-4">
                    <div className="min-w-0 flex-1">
                      <div className="mb-1 flex flex-wrap items-center gap-2">
                        <Badge variant="outline" className={TYPE_COLORS[event.type] ?? ''}>
                          {event.type}
                        </Badge>
                        <Badge variant="outline" className={SEVERITY_COLORS[event.severity] ?? ''}>
                          {event.severity}
                        </Badge>
                        {event.acknowledged && (
                          <Badge variant="secondary" className="text-xs">Acknowledged</Badge>
                        )}
                      </div>
                      <p className="text-sm">{event.message}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {event.agentName && `${event.agentName} · `}
                        {format(parseISO(event.createdAt), 'MMM d, yyyy HH:mm:ss')}
                      </p>
                    </div>
                    {!event.acknowledged && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="shrink-0 gap-1"
                        onClick={() => acknowledgeMutation.mutate(event.id)}
                        disabled={acknowledgeMutation.isPending}
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Acknowledge
                      </Button>
                    )}
                  </CardContent>
                </Card>
              ))
            )}
          </div>

          {/* Pagination */}
          {total > limit && (
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                Page {currentPage} of {totalPages} ({total} total)
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={offset <= 0}
                  onClick={() => setOffset((o) => Math.max(0, o - limit))}
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={offset + limit >= total}
                  onClick={() => setOffset((o) => o + limit)}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </motion.div>
  );
}
