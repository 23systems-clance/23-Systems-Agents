import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { Plus, Pencil, Trash2, Copy } from 'lucide-react';
import { queryKeys } from '@/lib/query-keys';
import {
  fetchOnboardingPlans,
  deleteOnboardingPlan,
  duplicateOnboardingPlan,
} from '@/services/onboarding-plans';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogAction, AlertDialogCancel,
} from '@/components/ui/alert-dialog';
import { PageSkeleton } from '@/components/shared/LoadingSkeleton';
import type { OnboardingPlanListEntry } from '@/types/api';

/** Placeholder team ID until workspace selector is implemented. */
const TEAM_ID = 'T_DEFAULT';

/**
 * Onboarding Plans list page.
 *
 * Displays all onboarding plans in a table with actions
 * for editing, duplicating, and deleting plans.
 */
export default function OnboardingPlansPage() {
  const [deleteDialog, setDeleteDialog] = useState<OnboardingPlanListEntry | null>(null);
  const [duplicateDialog, setDuplicateDialog] = useState<OnboardingPlanListEntry | null>(null);
  const [duplicateName, setDuplicateName] = useState('');
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const listQuery = useQuery({
    queryKey: queryKeys.onboardingPlans.list({ teamId: TEAM_ID }),
    queryFn: () => fetchOnboardingPlans(TEAM_ID),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteOnboardingPlan(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['onboardingPlans'] });
      setDeleteDialog(null);
    },
  });

  const duplicateMut = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) => duplicateOnboardingPlan(id, name),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['onboardingPlans'] });
      setDuplicateDialog(null);
      setDuplicateName('');
    },
  });

  /** Opens the duplicate dialog and pre-fills the name. */
  const openDuplicate = (plan: OnboardingPlanListEntry) => {
    setDuplicateName(`${plan.name} (Copy)`);
    setDuplicateDialog(plan);
  };

  /** Submits the duplicate request. */
  const handleDuplicate = () => {
    if (!duplicateDialog || !duplicateName.trim()) return;
    duplicateMut.mutate({ id: duplicateDialog.id, name: duplicateName.trim() });
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Onboarding Plans</h2>
          <p className="text-sm text-muted-foreground">
            Manage BDR onboarding training plans and drip sequences.
          </p>
        </div>
        <Button onClick={() => navigate('/onboarding-plans/new')}>
          <Plus className="mr-1 h-4 w-4" />
          Create New Plan
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
                    <th className="px-4 py-3 text-center font-medium text-muted-foreground">Duration (days)</th>
                    <th className="px-4 py-3 text-center font-medium text-muted-foreground">Modules</th>
                    <th className="px-4 py-3 text-center font-medium text-muted-foreground">Active Enrollments</th>
                    <th className="px-4 py-3 text-center font-medium text-muted-foreground">Version</th>
                    <th className="px-4 py-3 text-right font-medium text-muted-foreground">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {(listQuery.data?.plans ?? []).map((plan: OnboardingPlanListEntry) => (
                    <tr key={plan.id} className="border-b">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{plan.name}</span>
                          {plan.is_latest && (
                            <Badge variant="default">Latest</Badge>
                          )}
                          {plan.weekdays_only && (
                            <Badge variant="outline" className="text-xs">Weekdays</Badge>
                          )}
                        </div>
                        {plan.description && (
                          <p className="mt-0.5 text-xs text-muted-foreground line-clamp-1">
                            {plan.description}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">{plan.duration_days}</td>
                      <td className="px-4 py-3 text-center">{plan.module_count}</td>
                      <td className="px-4 py-3 text-center">
                        {plan.active_enrollments > 0 ? (
                          <Badge variant="secondary">{plan.active_enrollments}</Badge>
                        ) : (
                          <span className="text-muted-foreground">0</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">v{plan.version}</td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => navigate(`/onboarding-plans/${plan.id}`)}
                            title="Edit plan"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => openDuplicate(plan)}
                            title="Duplicate plan"
                          >
                            <Copy className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            disabled={plan.active_enrollments > 0}
                            onClick={() => setDeleteDialog(plan)}
                            title="Delete plan"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {(listQuery.data?.plans ?? []).length === 0 && (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-muted-foreground">
                        No onboarding plans configured yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Duplicate Dialog */}
      <Dialog open={!!duplicateDialog} onOpenChange={() => { setDuplicateDialog(null); setDuplicateName(''); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Duplicate Plan</DialogTitle>
            <DialogDescription>
              Create a copy of &quot;{duplicateDialog?.name}&quot; with a new name.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="duplicateName">New Plan Name</Label>
            <Input
              id="duplicateName"
              value={duplicateName}
              onChange={(e) => setDuplicateName(e.target.value)}
              placeholder="Enter a name for the duplicated plan"
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => { setDuplicateDialog(null); setDuplicateName(''); }}
            >
              Cancel
            </Button>
            <Button
              onClick={handleDuplicate}
              disabled={duplicateMut.isPending || !duplicateName.trim()}
            >
              Duplicate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteDialog} onOpenChange={() => setDeleteDialog(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Plan</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete &quot;{deleteDialog?.name}&quot;? This action cannot be
              undone.
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
