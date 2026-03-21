import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { CreditCard, Plus, AlertTriangle, DollarSign, Users, TrendingDown } from 'lucide-react';
import { queryKeys } from '@/lib/query-keys';
import { fetchBillingProfiles, fetchBillingKpis } from '@/services/billing';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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

const STATUS_COLORS: Record<string, string> = {
  ACTIVE: 'bg-green-500/10 text-green-600 border-green-500/20',
  PENDING: 'bg-yellow-500/10 text-yellow-600 border-yellow-500/20',
  SUSPENDED: 'bg-orange-500/10 text-orange-600 border-orange-500/20',
  DELINQUENT: 'bg-red-500/10 text-red-600 border-red-500/20',
};

export default function BillingPage() {
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<string>('all');

  const params: Record<string, string> = { page: String(page), limit: '20' };
  if (statusFilter !== 'all') params.status = statusFilter;

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.billing.list(params),
    queryFn: () => fetchBillingProfiles(params),
  });

  const { data: kpis } = useQuery({
    queryKey: queryKeys.billing.kpis(),
    queryFn: fetchBillingKpis,
  });

  if (isLoading || !data) return <PageSkeleton />;

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold tracking-tight">Billing Profiles</h2>
        <Button onClick={() => navigate('/billing/new')} size="sm">
          <Plus className="mr-1.5 h-4 w-4" />
          New Profile
        </Button>
      </div>

      {kpis && (
        <div className="grid gap-4 md:grid-cols-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Overage Revenue</CardTitle>
              <DollarSign className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">${kpis.totalOverageRevenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
              <p className="text-xs text-muted-foreground">{kpis.totalCreditsConsumed.toLocaleString()} credits consumed</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Low Balance</CardTitle>
              <TrendingDown className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{kpis.lowBalanceClients}</div>
              <p className="text-xs text-muted-foreground">clients below 20% balance</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Active Profiles</CardTitle>
              <Users className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{kpis.activeProfiles}</div>
              <p className="text-xs text-muted-foreground">of {kpis.totalProfiles} total</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Delinquent</CardTitle>
              <AlertTriangle className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-red-600">{kpis.delinquentProfiles}</div>
              <p className="text-xs text-muted-foreground">payment issues</p>
            </CardContent>
          </Card>
        </div>
      )}

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">
              <CreditCard className="mr-2 inline h-4 w-4" />
              {data.pagination.total} profiles
            </CardTitle>
            <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1); }}>
              <SelectTrigger className="w-40">
                <SelectValue placeholder="Filter by status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="ACTIVE">Active</SelectItem>
                <SelectItem value="PENDING">Pending</SelectItem>
                <SelectItem value="SUSPENDED">Suspended</SelectItem>
                <SelectItem value="DELINQUENT">Delinquent</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Workspace</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Credit Balance</TableHead>
                <TableHead className="text-right">Monthly Allowance</TableHead>
                <TableHead className="text-right">Overage Rate</TableHead>
                <TableHead className="text-right">Cycle Day</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.profiles.map((profile) => (
                <TableRow
                  key={profile.id}
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => navigate(`/billing/${profile.id}`)}
                >
                  <TableCell className="font-medium">{profile.workspaceName}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={STATUS_COLORS[profile.status]}>
                      {profile.status}
                    </Badge>
                    {profile.billingExempt && (
                      <Badge variant="outline" className="ml-1 bg-blue-500/10 text-blue-600 border-blue-500/20">
                        EXEMPT
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right font-mono">{profile.creditBalance.toLocaleString()}</TableCell>
                  <TableCell className="text-right font-mono">{profile.monthlyAllowance.toLocaleString()}</TableCell>
                  <TableCell className="text-right font-mono">${profile.overageRateUsd}</TableCell>
                  <TableCell className="text-right">{profile.billingCycleDay}</TableCell>
                </TableRow>
              ))}
              {data.profiles.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                    No billing profiles found
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>

          {data.pagination.totalPages > 1 && (
            <div className="mt-4 flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                Page {data.pagination.page} of {data.pagination.totalPages}
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => p - 1)}
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= data.pagination.totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}
