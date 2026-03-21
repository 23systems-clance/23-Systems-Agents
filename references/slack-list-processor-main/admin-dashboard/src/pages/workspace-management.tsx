/**
 * Workspace Management page (T046).
 *
 * Admin page for viewing all workspaces, managing feature toggles,
 * and performing manual credit adjustments.
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, ChevronRight, Coins } from 'lucide-react';
import {
  listWorkspaces,
  adjustCredits,
  type WorkspaceOverview,
} from '@/services/workspace-management-api';
import { FeatureTogglePanel } from '@/components/FeatureTogglePanel';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { PageSkeleton } from '@/components/shared/LoadingSkeleton';

const ONBOARDING_COLORS: Record<string, string> = {
  PENDING: 'bg-gray-500/10 text-gray-600 border-gray-500/20',
  LICENSE_KEY: 'bg-yellow-500/10 text-yellow-600 border-yellow-500/20',
  BILLING: 'bg-orange-500/10 text-orange-600 border-orange-500/20',
  CHANNELS: 'bg-blue-500/10 text-blue-600 border-blue-500/20',
  COMPLETE: 'bg-green-500/10 text-green-600 border-green-500/20',
};

export default function WorkspaceManagementPage() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [onboardingFilter, setOnboardingFilter] = useState('all');
  const [expandedWorkspace, setExpandedWorkspace] = useState<string | null>(null);
  const [creditAdjust, setCreditAdjust] = useState<{ workspace: WorkspaceOverview; amount: string; reason: string } | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['workspaces', onboardingFilter, page],
    queryFn: () => listWorkspaces({
      onboardingStatus: onboardingFilter !== 'all' ? onboardingFilter : undefined,
      page,
      limit: 25,
    }),
  });

  const creditMutation = useMutation({
    mutationFn: () => {
      if (!creditAdjust) throw new Error('No adjustment');
      return adjustCredits(creditAdjust.workspace.slackTeamId, parseInt(creditAdjust.amount), creditAdjust.reason);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspaces'] });
      setCreditAdjust(null);
    },
  });

  if (isLoading || !data) return <PageSkeleton />;

  const enabledFlagCount = (ws: WorkspaceOverview) =>
    Object.values(ws.featureFlags).filter(Boolean).length;

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold tracking-tight">Workspace Management</h2>
        <span className="text-sm text-muted-foreground">{data.total} workspaces</span>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4">
        <Select value={onboardingFilter} onValueChange={(v) => { setOnboardingFilter(v); setPage(1); }}>
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="Onboarding status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="PENDING">Pending</SelectItem>
            <SelectItem value="LICENSE_KEY">License Key</SelectItem>
            <SelectItem value="BILLING">Billing</SelectItem>
            <SelectItem value="CHANNELS">Channels</SelectItem>
            <SelectItem value="COMPLETE">Complete</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8"></TableHead>
                <TableHead>Workspace</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Onboarding</TableHead>
                <TableHead>Features</TableHead>
                <TableHead>Credits</TableHead>
                <TableHead>Tier</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.workspaces.map((ws) => (
                <>
                  <TableRow
                    key={ws.slackTeamId}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => setExpandedWorkspace(expandedWorkspace === ws.slackTeamId ? null : ws.slackTeamId)}
                  >
                    <TableCell>
                      {expandedWorkspace === ws.slackTeamId
                        ? <ChevronDown className="h-4 w-4" />
                        : <ChevronRight className="h-4 w-4" />}
                    </TableCell>
                    <TableCell>
                      <div>
                        <span className="font-medium">{ws.slackTeamName}</span>
                        <p className="text-xs text-muted-foreground">{ws.slackTeamId}</p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={ws.workspaceType === 'PLATFORM_OWNER' ? 'bg-purple-500/10 text-purple-600' : ''}>
                        {ws.workspaceType === 'PLATFORM_OWNER' ? 'Owner' : 'Client'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={ONBOARDING_COLORS[ws.onboardingStatus] ?? ''}>
                        {ws.onboardingStatus}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm">{enabledFlagCount(ws)}/9</span>
                    </TableCell>
                    <TableCell>
                      <span className={`font-mono text-sm ${ws.creditBalance <= 0 ? 'text-red-600' : ''}`}>
                        {ws.creditBalance.toLocaleString()}
                      </span>
                    </TableCell>
                    <TableCell className="capitalize">{ws.subscriptionTier ?? '-'}</TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          setCreditAdjust({ workspace: ws, amount: '', reason: '' });
                        }}
                      >
                        <Coins className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>

                  {/* Expanded feature toggles */}
                  <AnimatePresence>
                    {expandedWorkspace === ws.slackTeamId && (
                      <TableRow key={`${ws.slackTeamId}-expand`}>
                        <TableCell colSpan={8} className="p-4 bg-muted/30">
                          <motion.div
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                            exit={{ opacity: 0, height: 0 }}
                          >
                            <div className="max-w-md">
                              <FeatureTogglePanel
                                slackTeamId={ws.slackTeamId}
                                featureFlags={ws.featureFlags}
                                isPlatformOwner={ws.workspaceType === 'PLATFORM_OWNER'}
                              />
                            </div>
                          </motion.div>
                        </TableCell>
                      </TableRow>
                    )}
                  </AnimatePresence>
                </>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Pagination */}
      {data.total > 25 && (
        <div className="flex justify-center gap-2">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            Previous
          </Button>
          <span className="flex items-center text-sm text-muted-foreground">
            Page {page} of {Math.ceil(data.total / 25)}
          </span>
          <Button variant="outline" size="sm" disabled={page * 25 >= data.total} onClick={() => setPage(page + 1)}>
            Next
          </Button>
        </div>
      )}

      {/* Credit Adjustment Dialog */}
      <Dialog open={!!creditAdjust} onOpenChange={() => setCreditAdjust(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Adjust Credits: {creditAdjust?.workspace.slackTeamName}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Current Balance</Label>
              <p className="text-lg font-mono">{creditAdjust?.workspace.creditBalance.toLocaleString()}</p>
            </div>
            <div>
              <Label>Amount (positive to add, negative to deduct)</Label>
              <Input
                type="number"
                value={creditAdjust?.amount ?? ''}
                onChange={(e) => creditAdjust && setCreditAdjust({ ...creditAdjust, amount: e.target.value })}
                placeholder="e.g., 100 or -50"
              />
            </div>
            <div>
              <Label>Reason (required for audit trail)</Label>
              <Input
                value={creditAdjust?.reason ?? ''}
                onChange={(e) => creditAdjust && setCreditAdjust({ ...creditAdjust, reason: e.target.value })}
                placeholder="e.g., Promotional credit for beta testing"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreditAdjust(null)}>Cancel</Button>
            <Button
              onClick={() => creditMutation.mutate()}
              disabled={!creditAdjust?.amount || !creditAdjust?.reason || creditMutation.isPending}
            >
              {creditMutation.isPending ? 'Adjusting...' : 'Adjust Credits'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </motion.div>
  );
}
