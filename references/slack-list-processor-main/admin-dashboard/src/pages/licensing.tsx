/**
 * License Key Management page (T045).
 *
 * Admin page for creating, listing, and revoking license keys.
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Key, Plus, Ban, CheckCircle, Clock, AlertTriangle } from 'lucide-react';
import {
  listLicenseKeys,
  createLicenseKey,
  revokeLicenseKey,
  type LicenseKey,
  type CreateLicenseKeyInput,
  type FeatureFlags,
} from '@/services/licensing-api';
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

const STATUS_COLORS: Record<string, string> = {
  active: 'bg-green-500/10 text-green-600 border-green-500/20',
  activated: 'bg-blue-500/10 text-blue-600 border-blue-500/20',
  expired: 'bg-yellow-500/10 text-yellow-600 border-yellow-500/20',
  revoked: 'bg-red-500/10 text-red-600 border-red-500/20',
};

const DEFAULT_FLAGS: FeatureFlags = {
  enrichment: true,
  campaigns: false,
  workflows: false,
  onboarding: false,
  dialer: false,
  analytics: false,
  icpAnalysis: false,
  personalityAnalysis: false,
  aiAgent: false,
};

function deriveStatus(key: LicenseKey): string {
  if (key.revokedAt) return 'revoked';
  if (key.expiresAt && new Date(key.expiresAt) < new Date()) return 'expired';
  if (key.activatedWorkspaceId) return 'activated';
  return 'active';
}

export default function LicensingPage() {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [showCreate, setShowCreate] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<LicenseKey | null>(null);

  const [newKey, setNewKey] = useState<CreateLicenseKeyInput>({
    featureFlags: { ...DEFAULT_FLAGS },
    initialCredits: 100,
    subscriptionTier: 'starter',
    notes: '',
  });

  const { data, isLoading } = useQuery({
    queryKey: ['licenses', statusFilter, page],
    queryFn: () => listLicenseKeys({ status: statusFilter, page, limit: 25 }),
  });

  const createMutation = useMutation({
    mutationFn: createLicenseKey,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['licenses'] });
      setShowCreate(false);
      setNewKey({ featureFlags: { ...DEFAULT_FLAGS }, initialCredits: 100, subscriptionTier: 'starter', notes: '' });
    },
  });

  const revokeMutation = useMutation({
    mutationFn: (id: string) => revokeLicenseKey(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['licenses'] });
      setRevokeTarget(null);
    },
  });

  if (isLoading || !data) return <PageSkeleton />;

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold tracking-tight">License Keys</h2>
        <Button onClick={() => setShowCreate(true)} size="sm">
          <Plus className="mr-1.5 h-4 w-4" />
          Create Key
        </Button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4">
        <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1); }}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Filter by status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="activated">Activated</SelectItem>
            <SelectItem value="expired">Expired</SelectItem>
            <SelectItem value="revoked">Revoked</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-sm text-muted-foreground">{data.total} keys total</span>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Key</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Tier</TableHead>
                <TableHead>Credits</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Workspace</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.keys.map((key) => {
                const status = deriveStatus(key);
                return (
                  <TableRow key={key.id}>
                    <TableCell className="font-mono text-xs">{key.key}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={STATUS_COLORS[status] ?? ''}>
                        {status === 'active' && <CheckCircle className="mr-1 h-3 w-3" />}
                        {status === 'activated' && <Key className="mr-1 h-3 w-3" />}
                        {status === 'expired' && <Clock className="mr-1 h-3 w-3" />}
                        {status === 'revoked' && <Ban className="mr-1 h-3 w-3" />}
                        {status}
                      </Badge>
                    </TableCell>
                    <TableCell className="capitalize">{key.subscriptionTier}</TableCell>
                    <TableCell>{key.initialCredits}</TableCell>
                    <TableCell>{new Date(key.createdAt).toLocaleDateString()}</TableCell>
                    <TableCell>
                      {key.activatedWorkspaceId
                        ? <span className="text-xs">{key.activatedWorkspaceId.slice(0, 12)}...</span>
                        : <span className="text-muted-foreground">-</span>}
                    </TableCell>
                    <TableCell>
                      {!key.revokedAt && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-red-600 hover:text-red-700"
                          onClick={() => setRevokeTarget(key)}
                        >
                          <Ban className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
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

      {/* Create Key Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Create License Key</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Subscription Tier</Label>
                <Select
                  value={newKey.subscriptionTier}
                  onValueChange={(v) => setNewKey({ ...newKey, subscriptionTier: v })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="starter">Starter</SelectItem>
                    <SelectItem value="professional">Professional</SelectItem>
                    <SelectItem value="enterprise">Enterprise</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Initial Credits</Label>
                <Input
                  type="number"
                  value={newKey.initialCredits}
                  onChange={(e) => setNewKey({ ...newKey, initialCredits: parseInt(e.target.value) || 0 })}
                />
              </div>
            </div>

            <div>
              <Label>Feature Flags</Label>
              <div className="grid grid-cols-3 gap-2 mt-2">
                {Object.entries(newKey.featureFlags).map(([flag, enabled]) => (
                  <label key={flag} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={enabled}
                      onChange={(e) =>
                        setNewKey({
                          ...newKey,
                          featureFlags: { ...newKey.featureFlags, [flag]: e.target.checked },
                        })
                      }
                      className="rounded"
                    />
                    {flag}
                  </label>
                ))}
              </div>
            </div>

            <div>
              <Label>Notes (optional)</Label>
              <Input
                value={newKey.notes ?? ''}
                onChange={(e) => setNewKey({ ...newKey, notes: e.target.value || null })}
                placeholder="e.g., Client: Acme Corp"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button onClick={() => createMutation.mutate(newKey)} disabled={createMutation.isPending}>
              {createMutation.isPending ? 'Creating...' : 'Create Key'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Revoke Confirmation Dialog */}
      <Dialog open={!!revokeTarget} onOpenChange={() => setRevokeTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-red-500" />
              Revoke License Key
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Are you sure you want to revoke key <code className="font-mono">{revokeTarget?.key}</code>?
            This cannot be undone.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRevokeTarget(null)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => revokeTarget && revokeMutation.mutate(revokeTarget.id)}
              disabled={revokeMutation.isPending}
            >
              {revokeMutation.isPending ? 'Revoking...' : 'Revoke Key'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </motion.div>
  );
}
