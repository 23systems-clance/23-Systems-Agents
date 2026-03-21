import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { format, parseISO } from 'date-fns';
import { Download, Plus, Pencil, Trash2, Loader2 } from 'lucide-react';
import { queryKeys } from '@/lib/query-keys';
import {
  exportReport, fetchScheduledReports,
  createScheduledReport, updateScheduledReport, deleteScheduledReport,
} from '@/services/reports';
import { useDateRange } from '@/hooks/useDateRange';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { DateRangePicker } from '@/components/shared/DateRangePicker';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogAction, AlertDialogCancel,
} from '@/components/ui/alert-dialog';
import { PageSkeleton } from '@/components/shared/LoadingSkeleton';
import type { ScheduledReport, ScheduledReportInput } from '@/types/api';

const REPORT_TYPES = [
  { value: 'COST_SUMMARY', label: 'Cost Summary' },
  { value: 'USAGE_BREAKDOWN', label: 'Usage Breakdown' },
  { value: 'CLIENT_REPORT', label: 'Client Report' },
  { value: 'ERROR_SUMMARY', label: 'Error Summary' },
];

const FREQUENCIES = [
  { value: 'DAILY', label: 'Daily' },
  { value: 'WEEKLY', label: 'Weekly' },
  { value: 'MONTHLY', label: 'Monthly' },
];

const scheduledSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  report_type: z.string().min(1, 'Report type is required'),
  frequency: z.string().min(1, 'Frequency is required'),
  slack_channel_id: z.string().min(1, 'Slack channel is required'),
  is_active: z.boolean().default(true),
});

type ScheduledFormData = z.infer<typeof scheduledSchema>;

export default function ReportsPage() {
  const { params, setDays } = useDateRange(30);
  const [exportType, setExportType] = useState('COST_SUMMARY');
  const [exporting, setExporting] = useState(false);
  const [editDialog, setEditDialog] = useState<ScheduledReport | 'new' | null>(null);
  const [deleteDialog, setDeleteDialog] = useState<ScheduledReport | null>(null);
  const queryClient = useQueryClient();

  const scheduledQuery = useQuery({
    queryKey: queryKeys.reports.scheduled(),
    queryFn: fetchScheduledReports,
  });

  const createMut = useMutation({
    mutationFn: (input: ScheduledReportInput) => createScheduledReport(input),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['reports'] }); setEditDialog(null); },
  });

  const updateMut = useMutation({
    mutationFn: ({ id, input }: { id: string; input: Partial<ScheduledReportInput> }) => updateScheduledReport(id, input),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['reports'] }); setEditDialog(null); },
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteScheduledReport(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['reports'] }); setDeleteDialog(null); },
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const form = useForm<ScheduledFormData>({
    resolver: zodResolver(scheduledSchema) as any,
  });

  const handleExport = async () => {
    setExporting(true);
    try {
      const blob = await exportReport({
        report_type: exportType,
        start_date: params.start_date,
        end_date: params.end_date,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${exportType}-${params.start_date}-${params.end_date}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  };

  const openEdit = (r: ScheduledReport | 'new') => {
    if (r === 'new') {
      form.reset({ name: '', report_type: 'COST_SUMMARY', frequency: 'WEEKLY', slack_channel_id: '', is_active: true });
    } else {
      form.reset({
        name: r.name,
        report_type: r.report_type,
        frequency: r.frequency,
        slack_channel_id: r.slack_channel_id,
        is_active: r.is_active,
      });
    }
    setEditDialog(r);
  };

  const onSubmit = (data: ScheduledFormData) => {
    if (editDialog === 'new') {
      createMut.mutate(data);
    } else if (editDialog) {
      updateMut.mutate({ id: editDialog.id, input: data });
    }
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
      <h2 className="text-2xl font-bold">Reports</h2>

      {/* Export Section */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Export Report</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-2">
              <Label>Report Type</Label>
              <Select value={exportType} onValueChange={setExportType}>
                <SelectTrigger className="w-[200px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {REPORT_TYPES.map(({ value, label }) => (
                    <SelectItem key={value} value={value}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Date Range</Label>
              <DateRangePicker onDaysChange={setDays} />
            </div>
            <Button onClick={handleExport} disabled={exporting}>
              {exporting ? (
                <><Loader2 className="h-4 w-4 animate-spin" />Exporting...</>
              ) : (
                <><Download className="h-4 w-4" />Download CSV</>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Separator />

      {/* Scheduled Reports Section */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Scheduled Reports</h3>
        <Button onClick={() => openEdit('new')} size="sm">
          <Plus className="h-4 w-4" />
          Add Schedule
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          {scheduledQuery.isLoading ? (
            <PageSkeleton />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Name</th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Type</th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Schedule</th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Channel</th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Status</th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Last Run</th>
                    <th className="px-4 py-3 text-right font-medium text-muted-foreground">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {(scheduledQuery.data?.reports ?? []).map((r: ScheduledReport) => (
                    <tr key={r.id} className="border-b">
                      <td className="px-4 py-3 font-medium">{r.name}</td>
                      <td className="px-4 py-3">{r.report_type}</td>
                      <td className="px-4 py-3">{r.frequency}</td>
                      <td className="px-4 py-3 font-mono text-xs">{r.slack_channel_id}</td>
                      <td className="px-4 py-3">
                        <Badge variant={r.is_active ? 'default' : 'secondary'}>
                          {r.is_active ? 'Active' : 'Inactive'}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        {r.last_run_at ? format(parseISO(r.last_run_at), 'MMM d HH:mm') : 'Never'}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="icon" onClick={() => openEdit(r)}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => setDeleteDialog(r)}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {(scheduledQuery.data?.reports ?? []).length === 0 && (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-muted-foreground">
                        No scheduled reports
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create/Edit Scheduled Report Dialog */}
      <Dialog open={!!editDialog} onOpenChange={() => setEditDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editDialog === 'new' ? 'Schedule Report' : 'Edit Schedule'}</DialogTitle>
            <DialogDescription>Configure automated report delivery to Slack</DialogDescription>
          </DialogHeader>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="s-name">Name</Label>
              <Input id="s-name" {...form.register('name')} />
              {form.formState.errors.name && (
                <p className="text-sm text-destructive">{form.formState.errors.name.message}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label>Report Type</Label>
              <Select value={form.watch('report_type')} onValueChange={(v) => form.setValue('report_type', v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {REPORT_TYPES.map(({ value, label }) => (
                    <SelectItem key={value} value={value}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="s-freq">Frequency</Label>
              <Select value={form.watch('frequency')} onValueChange={(v) => form.setValue('frequency', v)}>
                <SelectTrigger id="s-freq"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {FREQUENCIES.map(({ value, label }) => (
                    <SelectItem key={value} value={value}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="s-channel">Slack Channel ID</Label>
              <Input id="s-channel" placeholder="C01234ABCDE" {...form.register('slack_channel_id')} />
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
            <AlertDialogTitle>Delete Schedule</AlertDialogTitle>
            <AlertDialogDescription>
              Delete &quot;{deleteDialog?.name}&quot;? This will stop future report deliveries.
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
