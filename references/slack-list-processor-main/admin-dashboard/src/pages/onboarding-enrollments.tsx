import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Plus, XCircle, GraduationCap, Clock, Users, Eye } from 'lucide-react';
import { queryKeys } from '@/lib/query-keys';
import {
  fetchOnboardingEnrollments,
  enrollBdr,
  cancelEnrollment,
} from '@/services/onboarding-enrollments';
import { fetchOnboardingPlans } from '@/services/onboarding-plans';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogAction, AlertDialogCancel,
} from '@/components/ui/alert-dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { PageSkeleton } from '@/components/shared/LoadingSkeleton';
import type {
  OnboardingEnrollmentListEntry,
  OnboardingEnrollBdrInput,
  OnboardingEnrollmentStatus,
} from '@/types/api';

/** Placeholder team ID until workspace selector is implemented. */
const TEAM_ID = 'T_DEFAULT';

/** Status badge color mapping. */
const STATUS_BADGE: Record<OnboardingEnrollmentStatus, { variant: string; label: string }> = {
  ACTIVE: { variant: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300', label: 'Active' },
  SUPERVISED: { variant: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300', label: 'Supervised' },
  PENDING_GRADUATION: { variant: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300', label: 'Pending Graduation' },
  GRADUATED: { variant: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300', label: 'Graduated' },
  EXTENDED: { variant: 'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300', label: 'Extended' },
  CANCELLED: { variant: 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-300', label: 'Cancelled' },
};

/** Default form state for the enroll dialog. */
const EMPTY_ENROLL_FORM: Omit<OnboardingEnrollBdrInput, 'slack_team_id' | 'manager_id'> = {
  bdr_name: '',
  slack_user_id: '',
  plan_id: '',
  start_date: new Date().toISOString().slice(0, 10),
  delivery_hour: 9,
  timezone: 'America/New_York',
};

/**
 * Onboarding Enrollments list page.
 *
 * Displays all BDR enrollments with summary stats, progress bars,
 * and actions for enrolling, cancelling, and viewing enrollments.
 */
export default function OnboardingEnrollmentsPage() {
  const [enrollDialog, setEnrollDialog] = useState(false);
  const [cancelDialog, setCancelDialog] = useState<OnboardingEnrollmentListEntry | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [enrollForm, setEnrollForm] = useState(EMPTY_ENROLL_FORM);
  const queryClient = useQueryClient();

  // ---- Queries ----
  const listQuery = useQuery({
    queryKey: queryKeys.onboardingEnrollments.list({ teamId: TEAM_ID }),
    queryFn: () => fetchOnboardingEnrollments(TEAM_ID),
  });

  const plansQuery = useQuery({
    queryKey: queryKeys.onboardingPlans.list({ teamId: TEAM_ID }),
    queryFn: () => fetchOnboardingPlans(TEAM_ID),
    enabled: enrollDialog,
  });

  // ---- Mutations ----
  const enrollMut = useMutation({
    mutationFn: (input: OnboardingEnrollBdrInput) => enrollBdr(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['onboardingEnrollments'] });
      closeEnrollDialog();
    },
  });

  const cancelMut = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason?: string }) => cancelEnrollment(id, reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['onboardingEnrollments'] });
      setCancelDialog(null);
      setCancelReason('');
    },
  });

  // ---- Handlers ----
  /** Opens the enroll dialog and resets the form. */
  const openEnrollDialog = () => {
    setEnrollForm(EMPTY_ENROLL_FORM);
    setEnrollDialog(true);
  };

  /** Closes the enroll dialog and resets state. */
  const closeEnrollDialog = () => {
    setEnrollDialog(false);
    setEnrollForm(EMPTY_ENROLL_FORM);
  };

  /** Submits the enroll BDR form. */
  const handleEnroll = () => {
    if (!enrollForm.bdr_name.trim() || !enrollForm.slack_user_id.trim() || !enrollForm.plan_id) {
      return;
    }
    enrollMut.mutate({
      ...enrollForm,
      slack_team_id: TEAM_ID,
      manager_id: 'MANAGER_DEFAULT',
    });
  };

  /** Submits the cancel request. */
  const handleCancel = () => {
    if (!cancelDialog) return;
    cancelMut.mutate({
      id: cancelDialog.id,
      reason: cancelReason.trim() || undefined,
    });
  };

  /** Updates a single field in the enroll form. */
  const updateField = <K extends keyof typeof enrollForm>(key: K, value: (typeof enrollForm)[K]) => {
    setEnrollForm((prev) => ({ ...prev, [key]: value }));
  };

  const summary = listQuery.data?.summary;
  const enrollments = listQuery.data?.enrollments ?? [];

  // Count graduated from the list for display
  const graduatedCount = enrollments.filter((e) => e.status === 'GRADUATED').length;

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Onboarding Enrollments</h2>
          <p className="text-sm text-muted-foreground">
            Manage BDR onboarding enrollments, track progress, and graduate trainees.
          </p>
        </div>
        <Button onClick={openEnrollDialog}>
          <Plus className="mr-1 h-4 w-4" />
          Enroll BDR
        </Button>
      </div>

      {/* Summary Stats */}
      {summary && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardContent className="flex items-center gap-3 p-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-100 dark:bg-blue-900/30">
                <Users className="h-5 w-5 text-blue-600 dark:text-blue-400" />
              </div>
              <div>
                <p className="text-2xl font-bold">{summary.total_active}</p>
                <p className="text-xs text-muted-foreground">Active</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-center gap-3 p-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-100 dark:bg-amber-900/30">
                <Eye className="h-5 w-5 text-amber-600 dark:text-amber-400" />
              </div>
              <div>
                <p className="text-2xl font-bold">{summary.total_supervised}</p>
                <p className="text-xs text-muted-foreground">Supervised</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-center gap-3 p-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-purple-100 dark:bg-purple-900/30">
                <Clock className="h-5 w-5 text-purple-600 dark:text-purple-400" />
              </div>
              <div>
                <p className="text-2xl font-bold">{summary.total_pending_graduation}</p>
                <p className="text-xs text-muted-foreground">Pending Graduation</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-center gap-3 p-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-100 dark:bg-green-900/30">
                <GraduationCap className="h-5 w-5 text-green-600 dark:text-green-400" />
              </div>
              <div>
                <p className="text-2xl font-bold">{graduatedCount}</p>
                <p className="text-xs text-muted-foreground">Graduated</p>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Enrollments Table */}
      <Card>
        <CardContent className="p-0">
          {listQuery.isLoading ? (
            <PageSkeleton />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">BDR Name</th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Plan</th>
                    <th className="px-4 py-3 text-center font-medium text-muted-foreground">Start Date</th>
                    <th className="px-4 py-3 text-center font-medium text-muted-foreground">Day</th>
                    <th className="px-4 py-3 text-center font-medium text-muted-foreground">Progress</th>
                    <th className="px-4 py-3 text-center font-medium text-muted-foreground">Status</th>
                    <th className="px-4 py-3 text-right font-medium text-muted-foreground">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {enrollments.map((enrollment: OnboardingEnrollmentListEntry) => {
                    const badge = STATUS_BADGE[enrollment.status];
                    return (
                      <tr key={enrollment.id} className="border-b">
                        <td className="px-4 py-3">
                          <span className="font-medium">{enrollment.bdr_name}</span>
                          <p className="mt-0.5 text-xs text-muted-foreground">{enrollment.slack_user_id}</p>
                        </td>
                        <td className="px-4 py-3 text-left">{enrollment.plan_name}</td>
                        <td className="px-4 py-3 text-center">
                          {new Date(enrollment.start_date).toLocaleDateString()}
                        </td>
                        <td className="px-4 py-3 text-center">
                          {enrollment.current_day}/{enrollment.total_days}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <div className="h-2 w-full min-w-[80px] rounded-full bg-gray-200 dark:bg-gray-700">
                              <div
                                className="h-2 rounded-full bg-blue-600 transition-all"
                                style={{ width: `${Math.min(enrollment.progress_percentage, 100)}%` }}
                              />
                            </div>
                            <span className="text-xs font-medium tabular-nums">
                              {enrollment.progress_percentage}%
                            </span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${badge.variant}`}>
                            {badge.label}
                          </span>
                          {enrollment.status === 'SUPERVISED' && enrollment.supervised_campaign_id && (
                            <p className="mt-1 text-[10px] text-muted-foreground truncate max-w-[140px] mx-auto" title={enrollment.supervised_campaign_id}>
                              Campaign: {enrollment.supervised_campaign_id}
                            </p>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex justify-end gap-1">
                            {(enrollment.status === 'ACTIVE' || enrollment.status === 'SUPERVISED' || enrollment.status === 'EXTENDED') && (
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => setCancelDialog(enrollment)}
                                title="Cancel enrollment"
                              >
                                <XCircle className="h-3.5 w-3.5" />
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {enrollments.length === 0 && (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-muted-foreground">
                        No onboarding enrollments found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Enroll BDR Dialog */}
      <Dialog open={enrollDialog} onOpenChange={(open) => { if (!open) closeEnrollDialog(); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Enroll BDR</DialogTitle>
            <DialogDescription>
              Add a new BDR to an onboarding plan. They will start receiving drip content on the start date.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="bdrName">BDR Name</Label>
              <Input
                id="bdrName"
                value={enrollForm.bdr_name}
                onChange={(e) => updateField('bdr_name', e.target.value)}
                placeholder="e.g. Jane Smith"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="slackUserId">Slack User ID</Label>
              <Input
                id="slackUserId"
                value={enrollForm.slack_user_id}
                onChange={(e) => updateField('slack_user_id', e.target.value)}
                placeholder="e.g. U0123456789"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="planSelect">Onboarding Plan</Label>
              <Select
                value={enrollForm.plan_id}
                onValueChange={(val) => updateField('plan_id', val)}
              >
                <SelectTrigger id="planSelect">
                  <SelectValue placeholder="Select a plan" />
                </SelectTrigger>
                <SelectContent>
                  {(plansQuery.data?.plans ?? []).map((plan) => (
                    <SelectItem key={plan.id} value={plan.id}>
                      {plan.name} ({plan.duration_days}d)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="startDate">Start Date</Label>
              <Input
                id="startDate"
                type="date"
                value={enrollForm.start_date}
                onChange={(e) => updateField('start_date', e.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="deliveryHour">Delivery Hour (0-23)</Label>
                <Input
                  id="deliveryHour"
                  type="number"
                  min={0}
                  max={23}
                  value={enrollForm.delivery_hour}
                  onChange={(e) => updateField('delivery_hour', Number(e.target.value))}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="timezone">Timezone</Label>
                <Input
                  id="timezone"
                  value={enrollForm.timezone}
                  onChange={(e) => updateField('timezone', e.target.value)}
                  placeholder="America/New_York"
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={closeEnrollDialog}>
              Cancel
            </Button>
            <Button
              onClick={handleEnroll}
              disabled={
                enrollMut.isPending ||
                !enrollForm.bdr_name.trim() ||
                !enrollForm.slack_user_id.trim() ||
                !enrollForm.plan_id
              }
            >
              Enroll
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cancel Confirmation Dialog */}
      <AlertDialog open={!!cancelDialog} onOpenChange={() => { setCancelDialog(null); setCancelReason(''); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel Enrollment</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to cancel the enrollment for &quot;{cancelDialog?.bdr_name}&quot;?
              This will stop all onboarding content delivery.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="cancelReason">Reason (optional)</Label>
            <Input
              id="cancelReason"
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              placeholder="Reason for cancellation"
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setCancelReason('')}>Keep Enrolled</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleCancel}
              disabled={cancelMut.isPending}
            >
              Cancel Enrollment
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </motion.div>
  );
}
