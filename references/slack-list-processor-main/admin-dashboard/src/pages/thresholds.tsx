import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { queryKeys } from '@/lib/query-keys';
import { formatCurrency } from '@/lib/utils';
import { fetchThresholds, createThreshold, updateThreshold, deleteThreshold } from '@/services/thresholds';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogAction, AlertDialogCancel,
} from '@/components/ui/alert-dialog';
import { PageSkeleton } from '@/components/shared/LoadingSkeleton';
import type { Threshold, ThresholdCreateInput } from '@/types/api';

const thresholdSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  amount_usd: z.coerce.number().positive('Amount must be positive'),
  provider_scope: z.string().optional(),
  slack_channel_id: z.string().optional(),
  is_active: z.boolean().default(true),
});

type ThresholdFormData = z.infer<typeof thresholdSchema>;

export default function ThresholdsPage() {
  const [editDialog, setEditDialog] = useState<Threshold | 'new' | null>(null);
  const [deleteDialog, setDeleteDialog] = useState<Threshold | null>(null);
  const queryClient = useQueryClient();

  const listQuery = useQuery({
    queryKey: queryKeys.thresholds.list(),
    queryFn: fetchThresholds,
  });

  const createMut = useMutation({
    mutationFn: (input: ThresholdCreateInput) => createThreshold(input),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['thresholds'] }); setEditDialog(null); },
  });

  const updateMut = useMutation({
    mutationFn: ({ id, input }: { id: string; input: Partial<ThresholdCreateInput> }) => updateThreshold(id, input),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['thresholds'] }); setEditDialog(null); },
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteThreshold(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['thresholds'] }); setDeleteDialog(null); },
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const form = useForm<ThresholdFormData>({
    resolver: zodResolver(thresholdSchema) as any,
  });

  const openEdit = (t: Threshold | 'new') => {
    if (t === 'new') {
      form.reset({ name: '', amount_usd: 0, provider_scope: '', slack_channel_id: '', is_active: true });
    } else {
      form.reset({
        name: t.name,
        amount_usd: t.amount_usd,
        provider_scope: t.provider_scope ?? '',
        slack_channel_id: t.slack_channel_id ?? '',
        is_active: t.is_active,
      });
    }
    setEditDialog(t);
  };

  const onSubmit = (data: ThresholdFormData) => {
    const input: ThresholdCreateInput = {
      ...data,
      provider_scope: data.provider_scope || undefined,
      slack_channel_id: data.slack_channel_id || undefined,
    };
    if (editDialog === 'new') {
      createMut.mutate(input);
    } else if (editDialog) {
      updateMut.mutate({ id: editDialog.id, input });
    }
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Budget Thresholds</h2>
        <Button onClick={() => openEdit('new')}>
          <Plus className="h-4 w-4" />
          Add Threshold
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          {listQuery.isLoading ? (
            <PageSkeleton />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Name</th>
                    <th className="px-4 py-3 text-right font-medium text-muted-foreground">Threshold</th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Scope</th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Status</th>
                    <th className="px-4 py-3 text-right font-medium text-muted-foreground">Current Spend</th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Progress</th>
                    <th className="px-4 py-3 text-right font-medium text-muted-foreground">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {(listQuery.data?.thresholds ?? []).map((t: Threshold) => {
                    const pct = Math.min((t.current_month_spend / t.amount_usd) * 100, 100);
                    return (
                      <tr key={t.id} className="border-b">
                        <td className="px-4 py-3 font-medium">{t.name}</td>
                        <td className="px-4 py-3 text-right">{formatCurrency(t.amount_usd)}</td>
                        <td className="px-4 py-3">{t.provider_scope ?? 'All'}</td>
                        <td className="px-4 py-3">
                          <Badge variant={t.is_active ? 'default' : 'secondary'}>
                            {t.is_active ? 'Active' : 'Inactive'}
                          </Badge>
                          {t.triggered && (
                            <Badge variant="destructive" className="ml-1">Triggered</Badge>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">{formatCurrency(t.current_month_spend)}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <div className="h-2 w-24 rounded-full bg-muted">
                              <div
                                className={`h-2 rounded-full ${pct >= 100 ? 'bg-destructive' : pct >= 80 ? 'bg-yellow-500' : 'bg-primary'}`}
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                            <span className="text-xs text-muted-foreground">{pct.toFixed(0)}%</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex justify-end gap-1">
                            <Button variant="ghost" size="icon" onClick={() => openEdit(t)}>
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button variant="ghost" size="icon" onClick={() => setDeleteDialog(t)}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {(listQuery.data?.thresholds ?? []).length === 0 && (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-muted-foreground">
                        No thresholds configured
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create/Edit Dialog */}
      <Dialog open={!!editDialog} onOpenChange={() => setEditDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editDialog === 'new' ? 'Create Threshold' : 'Edit Threshold'}</DialogTitle>
            <DialogDescription>Configure budget threshold alert settings</DialogDescription>
          </DialogHeader>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input id="name" {...form.register('name')} />
              {form.formState.errors.name && (
                <p className="text-sm text-destructive">{form.formState.errors.name.message}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="amount_usd">Amount (USD)</Label>
              <Input id="amount_usd" type="number" step="0.01" {...form.register('amount_usd')} />
              {form.formState.errors.amount_usd && (
                <p className="text-sm text-destructive">{form.formState.errors.amount_usd.message}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="provider_scope">Provider Scope (optional)</Label>
              <Input id="provider_scope" placeholder="e.g. anthropic, builtwith" {...form.register('provider_scope')} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="slack_channel_id">Slack Channel ID (optional)</Label>
              <Input id="slack_channel_id" placeholder="e.g. C01234ABCDE" {...form.register('slack_channel_id')} />
            </div>
            <div className="flex items-center gap-2">
              <Switch
                checked={form.watch('is_active')}
                onCheckedChange={(v) => form.setValue('is_active', v)}
              />
              <Label>Active</Label>
            </div>
            <DialogFooter>
              <Button type="submit" disabled={createMut.isPending || updateMut.isPending}>
                {editDialog === 'new' ? 'Create' : 'Save'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteDialog} onOpenChange={() => setDeleteDialog(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Threshold</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete &quot;{deleteDialog?.name}&quot;? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteDialog && deleteMut.mutate(deleteDialog.id)}
              disabled={deleteMut.isPending}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </motion.div>
  );
}
