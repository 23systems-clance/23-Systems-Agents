/**
 * Autonomous Audit Trail page (T094 - Feature 31).
 *
 * Paginated table of audit entries with filters for agent, severity,
 * outcome, and date range.
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { format, parseISO } from 'date-fns';
import { ShieldCheck } from 'lucide-react';
import { queryKeys } from '@/lib/query-keys';
import { fetchAudit } from '@/services/autonomous';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { PageSkeleton } from '@/components/shared/LoadingSkeleton';

const SEVERITY_COLORS: Record<string, string> = {
  low: 'bg-blue-500/10 text-blue-600 border-blue-500/20',
  medium: 'bg-yellow-500/10 text-yellow-600 border-yellow-500/20',
  high: 'bg-orange-500/10 text-orange-600 border-orange-500/20',
  critical: 'bg-red-500/10 text-red-600 border-red-500/20',
};

const OUTCOME_VARIANT: Record<string, 'default' | 'secondary' | 'destructive'> = {
  approved: 'default',
  pending: 'secondary',
  rejected: 'destructive',
  auto_executed: 'default',
};

export default function AuditTrailPage() {
  const limit = 20;
  const [offset, setOffset] = useState(0);
  const [severityFilter, setSeverityFilter] = useState('all');
  const [outcomeFilter, setOutcomeFilter] = useState('all');
  const [agentFilter, setAgentFilter] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const filterParams: Record<string, string> = {
    offset: String(offset),
    limit: String(limit),
  };
  if (severityFilter !== 'all') filterParams.severity = severityFilter;
  if (outcomeFilter !== 'all') filterParams.outcome = outcomeFilter;
  if (agentFilter.trim()) filterParams.agentName = agentFilter.trim();
  if (startDate) filterParams.startDate = startDate;
  if (endDate) filterParams.endDate = endDate;

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.autonomous.audit(filterParams),
    queryFn: () => fetchAudit(filterParams),
  });

  const total = data?.total ?? 0;
  const currentPage = Math.floor(offset / limit) + 1;
  const totalPages = Math.ceil(total / limit) || 1;

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <ShieldCheck className="h-6 w-6 text-muted-foreground" />
        <div>
          <h1 className="text-2xl font-bold">Audit Trail</h1>
          <p className="text-sm text-muted-foreground">
            {total} audit entr{total !== 1 ? 'ies' : 'y'}
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <Input
          placeholder="Filter by agent name..."
          className="w-48"
          value={agentFilter}
          onChange={(e) => { setAgentFilter(e.target.value); setOffset(0); }}
        />
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
        <Select value={outcomeFilter} onValueChange={(v) => { setOutcomeFilter(v); setOffset(0); }}>
          <SelectTrigger className="w-36">
            <SelectValue placeholder="All outcomes" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All outcomes</SelectItem>
            <SelectItem value="approved">Approved</SelectItem>
            <SelectItem value="rejected">Rejected</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="auto_executed">Auto Executed</SelectItem>
          </SelectContent>
        </Select>
        <Input
          type="date"
          className="w-40"
          value={startDate}
          onChange={(e) => { setStartDate(e.target.value); setOffset(0); }}
          placeholder="Start date"
        />
        <Input
          type="date"
          className="w-40"
          value={endDate}
          onChange={(e) => { setEndDate(e.target.value); setOffset(0); }}
          placeholder="End date"
        />
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <PageSkeleton />
          ) : (
            <>
              <div className="rounded-md">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Agent</TableHead>
                      <TableHead>Action</TableHead>
                      <TableHead className="text-right">Confidence</TableHead>
                      <TableHead>Severity</TableHead>
                      <TableHead>Outcome</TableHead>
                      <TableHead>Timestamp</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(data?.entries ?? []).length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                          No audit entries found
                        </TableCell>
                      </TableRow>
                    ) : (
                      (data?.entries ?? []).map((entry) => (
                        <TableRow key={entry.id}>
                          <TableCell className="text-sm font-medium">{entry.agentName}</TableCell>
                          <TableCell className="max-w-[200px] truncate text-sm">{entry.action}</TableCell>
                          <TableCell className="text-right text-sm">
                            {Math.round(entry.confidence * 100)}%
                          </TableCell>
                          <TableCell>
                            <Badge variant="outline" className={SEVERITY_COLORS[entry.severity] ?? ''}>
                              {entry.severity}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            <Badge variant={OUTCOME_VARIANT[entry.outcome] ?? 'secondary'} className="text-xs">
                              {entry.outcome}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-sm">
                            {format(parseISO(entry.createdAt), 'MMM d HH:mm')}
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>

              {/* Pagination */}
              <div className="flex items-center justify-between p-4">
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
            </>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}
