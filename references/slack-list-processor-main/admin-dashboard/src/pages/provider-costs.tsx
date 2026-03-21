import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Plus, Pencil, Trash2, DollarSign, AlertCircle } from 'lucide-react';
import { queryKeys } from '@/lib/query-keys';
import {
  fetchProviderCosts,
  createProviderCost,
  updateProviderCost,
  deleteProviderCost,
  type ProviderCostRecord,
  type CreateProviderCostBody,
} from '@/services/providerCosts';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { PageSkeleton } from '@/components/shared/LoadingSkeleton';

const PROVIDERS = [
  { value: 'APOLLO', label: 'Apollo' },
  { value: 'WIZA', label: 'Wiza' },
  { value: 'AI_ARK', label: 'AI Ark' },
  { value: 'FINDYMAIL', label: 'Findymail' },
] as const;

const DATA_TYPES = [
  { value: 'EMAIL', label: 'Email' },
  { value: 'PHONE', label: 'Phone' },
] as const;

const PROVIDER_COLORS: Record<string, string> = {
  APOLLO: 'bg-blue-100 text-blue-800',
  WIZA: 'bg-purple-100 text-purple-800',
  AI_ARK: 'bg-amber-100 text-amber-800',
  FINDYMAIL: 'bg-green-100 text-green-800',
};

const INITIAL_FORM: CreateProviderCostBody = {
  provider: 'APOLLO',
  dataType: 'EMAIL',
  costPerUnit: 0,
  creditsPerUnit: null,
  notes: '',
};

export default function ProviderCostsPage() {
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<CreateProviderCostBody>({ ...INITIAL_FORM });

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.providerCosts.list(),
    queryFn: () => fetchProviderCosts(),
  });

  const createMutation = useMutation({
    mutationFn: (body: CreateProviderCostBody) => createProviderCost(body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['providerCosts'] });
      closeDialog();
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<CreateProviderCostBody> }) =>
      updateProviderCost(id, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['providerCosts'] });
      closeDialog();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteProviderCost(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['providerCosts'] });
      setDeleteId(null);
    },
  });

  function closeDialog() {
    setDialogOpen(false);
    setEditingId(null);
    setForm({ ...INITIAL_FORM });
  }

  function openCreate() {
    setEditingId(null);
    setForm({ ...INITIAL_FORM });
    setDialogOpen(true);
  }

  function openEdit(cost: ProviderCostRecord) {
    setEditingId(cost.id);
    setForm({
      provider: cost.provider,
      dataType: cost.dataType,
      costPerUnit: cost.costPerUnit,
      creditsPerUnit: cost.creditsPerUnit,
      notes: cost.notes || '',
    });
    setDialogOpen(true);
  }

  function handleSubmit() {
    if (editingId) {
      updateMutation.mutate({
        id: editingId,
        body: { costPerUnit: form.costPerUnit, creditsPerUnit: form.creditsPerUnit, notes: form.notes },
      });
    } else {
      createMutation.mutate(form);
    }
  }

  if (isLoading || !data) return <PageSkeleton />;

  // Group costs by provider for the summary cards
  const costsByProvider = data.costs.reduce(
    (acc, cost) => {
      if (!acc[cost.provider]) acc[cost.provider] = [];
      acc[cost.provider].push(cost);
      return acc;
    },
    {} as Record<string, ProviderCostRecord[]>,
  );

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Provider Costs</h2>
          <p className="text-sm text-muted-foreground">
            Manage per-unit pricing for enrichment and verification providers
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="mr-1.5 h-4 w-4" />
          Add Rate
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {PROVIDERS.map(({ value, label }) => {
          const providerCosts = costsByProvider[value] || [];
          const emailCost = providerCosts.find((c) => c.dataType === 'EMAIL');
          const phoneCost = providerCosts.find((c) => c.dataType === 'PHONE');

          return (
            <Card key={value}>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-base">
                  <DollarSign className="h-4 w-4 text-muted-foreground" />
                  {label}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-1.5 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Email</span>
                    <span className="font-mono font-medium">
                      {emailCost ? `$${emailCost.costPerUnit.toFixed(4)}` : '--'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Phone</span>
                    <span className="font-mono font-medium">
                      {phoneCost ? `$${phoneCost.costPerUnit.toFixed(4)}` : '--'}
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Pricing Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Active Pricing</CardTitle>
          <CardDescription>
            Current per-unit costs used for enrichment cost tracking. Creating a new rate for an
            existing provider + data type will automatically expire the previous rate.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {data.costs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <AlertCircle className="mb-3 h-10 w-10 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">No provider costs configured yet.</p>
              <Button variant="outline" size="sm" className="mt-3" onClick={openCreate}>
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                Add first rate
              </Button>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Provider</TableHead>
                  <TableHead>Data Type</TableHead>
                  <TableHead className="text-right">Cost / Unit</TableHead>
                  <TableHead className="text-right">Credits / Unit</TableHead>
                  <TableHead>Effective Date</TableHead>
                  <TableHead>Notes</TableHead>
                  <TableHead className="w-[100px] text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.costs.map((cost) => (
                  <TableRow key={cost.id}>
                    <TableCell>
                      <Badge variant="secondary" className={PROVIDER_COLORS[cost.provider] || ''}>
                        {PROVIDERS.find((p) => p.value === cost.provider)?.label || cost.provider}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">
                        {DATA_TYPES.find((d) => d.value === cost.dataType)?.label || cost.dataType}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      ${cost.costPerUnit.toFixed(4)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm text-muted-foreground">
                      {cost.creditsPerUnit ?? '--'}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {new Date(cost.effectiveDate).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="max-w-[200px] truncate text-sm text-muted-foreground">
                      {cost.notes || '--'}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="icon" onClick={() => openEdit(cost)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => setDeleteId(cost.id)}>
                          <Trash2 className="h-3.5 w-3.5 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Create / Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={(open) => !open && closeDialog()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingId ? 'Edit Provider Cost' : 'Add Provider Cost'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {/* Provider (only on create) */}
            <div className="space-y-1.5">
              <Label>Provider</Label>
              <Select
                value={form.provider}
                onValueChange={(v) => setForm((f) => ({ ...f, provider: v }))}
                disabled={!!editingId}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PROVIDERS.map((p) => (
                    <SelectItem key={p.value} value={p.value}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Data Type (only on create) */}
            <div className="space-y-1.5">
              <Label>Data Type</Label>
              <Select
                value={form.dataType}
                onValueChange={(v) => setForm((f) => ({ ...f, dataType: v }))}
                disabled={!!editingId}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DATA_TYPES.map((d) => (
                    <SelectItem key={d.value} value={d.value}>
                      {d.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Cost Per Unit */}
            <div className="space-y-1.5">
              <Label>Cost Per Unit (USD)</Label>
              <Input
                type="number"
                step="0.001"
                min="0"
                value={form.costPerUnit}
                onChange={(e) =>
                  setForm((f) => ({ ...f, costPerUnit: parseFloat(e.target.value) || 0 }))
                }
                placeholder="0.05"
              />
              <p className="text-xs text-muted-foreground">
                Cost in USD per successful enrichment or verification
              </p>
            </div>

            {/* Credits Per Unit */}
            <div className="space-y-1.5">
              <Label>Credits Per Unit (optional)</Label>
              <Input
                type="number"
                step="1"
                min="0"
                value={form.creditsPerUnit ?? ''}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    creditsPerUnit: e.target.value ? parseInt(e.target.value, 10) : null,
                  }))
                }
                placeholder="e.g. 2"
              />
              <p className="text-xs text-muted-foreground">
                Provider-specific credit consumption per unit (if applicable)
              </p>
            </div>

            {/* Notes */}
            <div className="space-y-1.5">
              <Label>Notes (optional)</Label>
              <Input
                value={form.notes || ''}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                placeholder="e.g. Wiza email: 2 credits @ $0.025"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeDialog}>
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={createMutation.isPending || updateMutation.isPending}
            >
              {editingId ? 'Update' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Expire this pricing rate?</AlertDialogTitle>
            <AlertDialogDescription>
              This will mark the rate as expired. The cost calculator will no longer use it for new
              enrichments. Historical cost records will not be affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteId && deleteMutation.mutate(deleteId)}
            >
              Expire Rate
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </motion.div>
  );
}
