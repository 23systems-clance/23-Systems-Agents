import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { ArrowLeft, Save, Plus, PauseCircle, PlayCircle, Send } from 'lucide-react';
import { queryKeys } from '@/lib/query-keys';
import {
  fetchBillingProfile,
  updateBillingProfile,
  updateBillingStatus,
  adjustCredits,
  createBillingProfile,
  sendMagicLink,
  fetchTransactions,
} from '@/services/billing';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { PageSkeleton } from '@/components/shared/LoadingSkeleton';

const STATUS_COLORS: Record<string, string> = {
  ACTIVE: 'bg-green-500/10 text-green-600 border-green-500/20',
  PENDING: 'bg-yellow-500/10 text-yellow-600 border-yellow-500/20',
  SUSPENDED: 'bg-orange-500/10 text-orange-600 border-orange-500/20',
  DELINQUENT: 'bg-red-500/10 text-red-600 border-red-500/20',
};

const TX_TYPE_COLORS: Record<string, string> = {
  MONTHLY_ALLOCATION: 'bg-blue-500/10 text-blue-600',
  ENRICHMENT_DEDUCTION: 'bg-orange-500/10 text-orange-600',
  OVERAGE_CHARGE: 'bg-red-500/10 text-red-600',
  MANUAL_ADJUSTMENT: 'bg-purple-500/10 text-purple-600',
  ROLLOVER_RESET: 'bg-gray-500/10 text-gray-600',
};

export default function BillingDetailPage() {
  const { profileId } = useParams<{ profileId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const isNew = profileId === 'new';

  const [adjustDialogOpen, setAdjustDialogOpen] = useState(false);
  const [adjustAmount, setAdjustAmount] = useState('');
  const [adjustReason, setAdjustReason] = useState('');
  const [statusReason, setStatusReason] = useState('');

  // Form state
  const [form, setForm] = useState({
    slackTeamId: '',
    monthlyAllowance: 500,
    maxRolloverCredits: 1000,
    overageRateUsd: 0.05,
    billingCycleDay: 1,
    billingEmail: '',
    billingContactUserId: '',
    billingExempt: false,
  });
  const [formLoaded, setFormLoaded] = useState(false);

  const { data: profile, isLoading } = useQuery({
    queryKey: queryKeys.billing.detail(profileId ?? ''),
    queryFn: () => fetchBillingProfile(profileId!),
    enabled: !isNew && !!profileId,
  });

  // Load profile data into form on first fetch
  if (profile && !formLoaded) {
    setForm({
      slackTeamId: profile.slackTeamId,
      monthlyAllowance: profile.monthlyAllowance,
      maxRolloverCredits: profile.maxRolloverCredits,
      overageRateUsd: parseFloat(profile.overageRateUsd),
      billingCycleDay: profile.billingCycleDay,
      billingEmail: profile.billingEmail ?? '',
      billingContactUserId: profile.billingContactUserId ?? '',
      billingExempt: profile.billingExempt,
    });
    setFormLoaded(true);
  }

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['billing'] });
  };

  const saveMutation = useMutation({
    mutationFn: (data: Record<string, any>) =>
      isNew ? createBillingProfile(data) : updateBillingProfile(profileId!, data),
    onSuccess: (result) => {
      invalidate();
      if (isNew) navigate(`/billing/${result.id}`, { replace: true });
    },
  });

  const statusMutation = useMutation({
    mutationFn: ({ status, reason }: { status: string; reason: string }) =>
      updateBillingStatus(profileId!, status, reason),
    onSuccess: invalidate,
  });

  const magicLinkMutation = useMutation({
    mutationFn: () => sendMagicLink(profileId!),
    onSuccess: invalidate,
  });

  const adjustMutation = useMutation({
    mutationFn: ({ amount, reason }: { amount: number; reason: string }) =>
      adjustCredits(profileId!, amount, reason),
    onSuccess: () => {
      invalidate();
      setAdjustDialogOpen(false);
      setAdjustAmount('');
      setAdjustReason('');
    },
  });

  if (!isNew && (isLoading || !profile)) return <PageSkeleton />;

  const handleSave = () => {
    const data: Record<string, any> = { ...form };
    if (!isNew) delete data.slackTeamId;
    saveMutation.mutate(data);
  };

  const canSuspend = profile?.status === 'ACTIVE';
  const canReactivate = profile?.status === 'SUSPENDED' || profile?.status === 'DELINQUENT';

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => navigate('/billing')}>
          <ArrowLeft className="mr-1 h-4 w-4" />
          Back
        </Button>
        <h2 className="text-2xl font-bold tracking-tight">
          {isNew ? 'New Billing Profile' : profile?.workspaceName}
        </h2>
        {profile && (
          <Badge variant="outline" className={STATUS_COLORS[profile.status]}>
            {profile.status}
          </Badge>
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Profile Form */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Profile Settings</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {isNew && (
              <div className="space-y-1.5">
                <Label htmlFor="slackTeamId">Slack Team ID</Label>
                <Input
                  id="slackTeamId"
                  value={form.slackTeamId}
                  onChange={(e) => setForm({ ...form, slackTeamId: e.target.value })}
                  placeholder="T1234567890"
                />
              </div>
            )}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="monthlyAllowance">Monthly Allowance</Label>
                <Input
                  id="monthlyAllowance"
                  type="number"
                  value={form.monthlyAllowance}
                  onChange={(e) => setForm({ ...form, monthlyAllowance: parseInt(e.target.value) || 0 })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="maxRolloverCredits">Max Rollover Credits</Label>
                <Input
                  id="maxRolloverCredits"
                  type="number"
                  value={form.maxRolloverCredits}
                  onChange={(e) => setForm({ ...form, maxRolloverCredits: parseInt(e.target.value) || 0 })}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="overageRateUsd">Overage Rate (USD)</Label>
                <Input
                  id="overageRateUsd"
                  type="number"
                  step="0.01"
                  value={form.overageRateUsd}
                  onChange={(e) => setForm({ ...form, overageRateUsd: parseFloat(e.target.value) || 0 })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="billingCycleDay">Billing Cycle Day</Label>
                <Input
                  id="billingCycleDay"
                  type="number"
                  min={1}
                  max={31}
                  value={form.billingCycleDay}
                  onChange={(e) => setForm({ ...form, billingCycleDay: parseInt(e.target.value) || 1 })}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="billingEmail">Billing Email</Label>
              <Input
                id="billingEmail"
                type="email"
                value={form.billingEmail}
                onChange={(e) => setForm({ ...form, billingEmail: e.target.value })}
                placeholder="billing@example.com"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="billingContactUserId">Billing Contact User ID</Label>
              <Input
                id="billingContactUserId"
                value={form.billingContactUserId}
                onChange={(e) => setForm({ ...form, billingContactUserId: e.target.value })}
                placeholder="U0987654321"
              />
            </div>
            <div className="flex items-center gap-2">
              <Switch
                id="billingExempt"
                checked={form.billingExempt}
                onCheckedChange={(checked) => setForm({ ...form, billingExempt: checked })}
              />
              <Label htmlFor="billingExempt">Billing Exempt</Label>
            </div>
            <Button onClick={handleSave} disabled={saveMutation.isPending} className="w-full">
              <Save className="mr-1.5 h-4 w-4" />
              {saveMutation.isPending ? 'Saving...' : isNew ? 'Create Profile' : 'Save Changes'}
            </Button>
            {saveMutation.isError && (
              <p className="text-sm text-red-500">
                {(saveMutation.error as any)?.response?.data?.message ?? 'Failed to save'}
              </p>
            )}
          </CardContent>
        </Card>

        {/* Actions Card (only for existing profiles) */}
        {!isNew && profile && (
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Actions</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center justify-between rounded-lg border p-3">
                  <div>
                    <p className="text-sm font-medium">Credit Balance</p>
                    <p className="text-2xl font-bold font-mono">{profile.creditBalance.toLocaleString()}</p>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => setAdjustDialogOpen(true)}>
                    <Plus className="mr-1 h-3 w-3" />
                    Adjust
                  </Button>
                </div>

                {canSuspend && (
                  <div className="space-y-2">
                    <Input
                      placeholder="Reason for suspension..."
                      value={statusReason}
                      onChange={(e) => setStatusReason(e.target.value)}
                    />
                    <Button
                      variant="outline"
                      className="w-full text-orange-600"
                      disabled={statusMutation.isPending}
                      onClick={() => statusMutation.mutate({ status: 'SUSPENDED', reason: statusReason })}
                    >
                      <PauseCircle className="mr-1.5 h-4 w-4" />
                      Suspend
                    </Button>
                  </div>
                )}

                {canReactivate && (
                  <Button
                    variant="outline"
                    className="w-full text-green-600"
                    disabled={statusMutation.isPending}
                    onClick={() => statusMutation.mutate({ status: 'ACTIVE', reason: 'Reactivated by admin' })}
                  >
                    <PlayCircle className="mr-1.5 h-4 w-4" />
                    Reactivate
                  </Button>
                )}

                <Button
                  variant="outline"
                  className="w-full"
                  disabled={magicLinkMutation.isPending || (!profile.billingContactUserId && !profile.billingEmail)}
                  onClick={() => magicLinkMutation.mutate()}
                >
                  <Send className="mr-1.5 h-4 w-4" />
                  {magicLinkMutation.isPending ? 'Sending...' : 'Send Magic Link'}
                </Button>
                {(!profile.billingContactUserId && !profile.billingEmail) && (
                  <p className="text-xs text-muted-foreground">Configure a billing contact or email first</p>
                )}
                {magicLinkMutation.isSuccess && (
                  <p className="text-xs text-green-600">
                    Magic link sent! DM: {magicLinkMutation.data.delivery.slackDm}, Email: {magicLinkMutation.data.delivery.email}
                  </p>
                )}
              </CardContent>
            </Card>

            <TransactionHistory profileId={profileId!} />
          </div>
        )}
      </div>

      {/* Credit Adjustment Dialog */}
      <Dialog open={adjustDialogOpen} onOpenChange={setAdjustDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Adjust Credits</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Amount (positive to add, negative to deduct)</Label>
              <Input
                type="number"
                value={adjustAmount}
                onChange={(e) => setAdjustAmount(e.target.value)}
                placeholder="100 or -50"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Reason (required)</Label>
              <Textarea
                value={adjustReason}
                onChange={(e) => setAdjustReason(e.target.value)}
                placeholder="Trial bonus credits"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAdjustDialogOpen(false)}>Cancel</Button>
            <Button
              disabled={!adjustAmount || !adjustReason || adjustMutation.isPending}
              onClick={() => adjustMutation.mutate({ amount: parseInt(adjustAmount), reason: adjustReason })}
            >
              {adjustMutation.isPending ? 'Adjusting...' : 'Apply Adjustment'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </motion.div>
  );
}

const TX_TYPES = [
  'MONTHLY_ALLOCATION',
  'ENRICHMENT_DEDUCTION',
  'OVERAGE_CHARGE',
  'MANUAL_ADJUSTMENT',
  'ROLLOVER_RESET',
];

function TransactionHistory({ profileId }: { profileId: string }) {
  const [page, setPage] = useState(1);
  const [typeFilter, setTypeFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const params: Record<string, string> = { page: String(page), limit: '20' };
  if (typeFilter) params.type = typeFilter;
  if (dateFrom) params.from = dateFrom;
  if (dateTo) params.to = dateTo;

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.billing.transactions(profileId, params),
    queryFn: () => fetchTransactions(profileId, params),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Transaction History</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <select
            className="rounded-md border px-2 py-1 text-sm"
            value={typeFilter}
            onChange={(e) => { setTypeFilter(e.target.value); setPage(1); }}
          >
            <option value="">All Types</option>
            {TX_TYPES.map((t) => (
              <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>
            ))}
          </select>
          <Input
            type="date"
            className="w-auto"
            value={dateFrom}
            onChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
            placeholder="From"
          />
          <Input
            type="date"
            className="w-auto"
            value={dateTo}
            onChange={(e) => { setDateTo(e.target.value); setPage(1); }}
            placeholder="To"
          />
        </div>

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : !data?.transactions.length ? (
          <p className="text-sm text-muted-foreground">No transactions found.</p>
        ) : (
          <>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">Balance</TableHead>
                  <TableHead>Reference</TableHead>
                  <TableHead>Description</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.transactions.map((tx) => (
                  <TableRow key={tx.id}>
                    <TableCell className="text-xs whitespace-nowrap">
                      {new Date(tx.createdAt).toLocaleString()}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={TX_TYPE_COLORS[tx.type] ?? ''}>
                        {tx.type.replace(/_/g, ' ')}
                      </Badge>
                    </TableCell>
                    <TableCell className={`text-right font-mono ${tx.amount >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {tx.amount >= 0 ? '+' : ''}{tx.amount}
                    </TableCell>
                    <TableCell className="text-right font-mono">{tx.balanceAfter}</TableCell>
                    <TableCell className="text-xs font-mono truncate max-w-[120px]">
                      {tx.referenceId ? tx.referenceId.slice(0, 8) : '-'}
                    </TableCell>
                    <TableCell className="text-xs truncate max-w-[200px]">{tx.description}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            {data.pagination.totalPages > 1 && (
              <div className="flex items-center justify-between">
                <p className="text-xs text-muted-foreground">
                  Page {data.pagination.page} of {data.pagination.totalPages} ({data.pagination.total} total)
                </p>
                <div className="flex gap-1">
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
          </>
        )}
      </CardContent>
    </Card>
  );
}
