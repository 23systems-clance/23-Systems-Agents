import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Plus, Pencil, Trash2, Star, Globe, Lock } from 'lucide-react';
import { queryKeys } from '@/lib/query-keys';
import {
  fetchEnrichmentPresets,
  createEnrichmentPreset,
  updateEnrichmentPreset,
  deleteEnrichmentPreset,
} from '@/services/enrichment-presets';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogAction, AlertDialogCancel,
} from '@/components/ui/alert-dialog';
import { PageSkeleton } from '@/components/shared/LoadingSkeleton';
import type { EnrichmentPresetEntry, EnrichmentPresetCreateInput } from '@/types/api';

/** All available Apollo seniority options. */
const SENIORITY_OPTIONS = [
  { value: 'c_suite', label: 'C-Suite' },
  { value: 'founder', label: 'Founder' },
  { value: 'owner', label: 'Owner' },
  { value: 'vp', label: 'VP' },
  { value: 'director', label: 'Director' },
  { value: 'head', label: 'Head' },
  { value: 'manager', label: 'Manager' },
  { value: 'senior', label: 'Senior' },
  { value: 'entry', label: 'Entry' },
  { value: 'intern', label: 'Intern' },
] as const;

const presetSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  isDefault: z.boolean().default(false),
  scope: z.enum(['global', 'private']).default('global'),
  personSeniorities: z.array(z.string()).min(1, 'Select at least one seniority level'),
  personTitles: z.string().default(''),
  personDepartments: z.string().default(''),
  personFunctions: z.string().default(''),
  perPage: z.coerce.number().int().min(1).max(100).default(25),
});

type PresetFormData = z.infer<typeof presetSchema>;

/**
 * Converts a comma-separated string to a trimmed array.
 */
function parseCommaSeparated(input: string): string[] {
  if (!input.trim()) return [];
  return input.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
}

export default function EnrichmentPage() {
  const [editDialog, setEditDialog] = useState<EnrichmentPresetEntry | 'new' | null>(null);
  const [deleteDialog, setDeleteDialog] = useState<EnrichmentPresetEntry | null>(null);
  const queryClient = useQueryClient();

  const listQuery = useQuery({
    queryKey: queryKeys.enrichmentPresets.list(),
    queryFn: fetchEnrichmentPresets,
  });

  const createMut = useMutation({
    mutationFn: (input: EnrichmentPresetCreateInput) => createEnrichmentPreset(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['enrichmentPresets'] });
      setEditDialog(null);
    },
  });

  const updateMut = useMutation({
    mutationFn: ({ id, input }: { id: string; input: Partial<EnrichmentPresetCreateInput> }) =>
      updateEnrichmentPreset(id, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['enrichmentPresets'] });
      setEditDialog(null);
    },
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteEnrichmentPreset(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['enrichmentPresets'] });
      setDeleteDialog(null);
    },
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const form = useForm<PresetFormData>({
    resolver: zodResolver(presetSchema) as any,
    defaultValues: {
      name: '',
      isDefault: false,
      scope: 'global' as const,
      personSeniorities: [],
      personTitles: '',
      personDepartments: '',
      personFunctions: '',
      perPage: 25,
    },
  });

  const openEdit = (p: EnrichmentPresetEntry | 'new') => {
    if (p === 'new') {
      form.reset({
        name: '',
        isDefault: false,
        scope: 'global',
        personSeniorities: ['c_suite', 'founder', 'owner', 'vp', 'director'],
        personTitles: '',
        personDepartments: '',
        personFunctions: '',
        perPage: 25,
      });
    } else {
      form.reset({
        name: p.name,
        isDefault: p.isDefault,
        scope: p.scope ?? 'global',
        personSeniorities: p.personSeniorities,
        personTitles: p.personTitles.join(', '),
        personDepartments: p.personDepartments.join(', '),
        personFunctions: p.personFunctions.join(', '),
        perPage: p.perPage,
      });
    }
    setEditDialog(p);
  };

  const onSubmit = (data: PresetFormData) => {
    const input: EnrichmentPresetCreateInput = {
      name: data.name,
      isDefault: data.isDefault,
      scope: data.scope,
      personSeniorities: data.personSeniorities,
      personTitles: parseCommaSeparated(data.personTitles),
      personDepartments: parseCommaSeparated(data.personDepartments),
      personFunctions: parseCommaSeparated(data.personFunctions),
      perPage: data.perPage,
    };
    if (editDialog === 'new') {
      createMut.mutate(input);
    } else if (editDialog) {
      updateMut.mutate({ id: editDialog.id, input });
    }
  };

  const watchedSeniorities = form.watch('personSeniorities');

  const toggleSeniority = (value: string) => {
    const current = form.getValues('personSeniorities');
    if (current.includes(value)) {
      form.setValue(
        'personSeniorities',
        current.filter((s) => s !== value),
        { shouldValidate: true },
      );
    } else {
      form.setValue('personSeniorities', [...current, value], { shouldValidate: true });
    }
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Enrichment Presets</h2>
          <p className="text-sm text-muted-foreground">
            Manage Apollo contact search filter presets used during enrichment.
          </p>
        </div>
        <Button onClick={() => openEdit('new')}>
          <Plus className="mr-1 h-4 w-4" />
          Add Preset
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
                    <th className="px-4 py-3 text-center font-medium text-muted-foreground">Scope</th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Seniorities</th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Titles</th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Departments</th>
                    <th className="px-4 py-3 text-center font-medium text-muted-foreground">Per Page</th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Created By</th>
                    <th className="px-4 py-3 text-right font-medium text-muted-foreground">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {(listQuery.data?.presets ?? []).map((p: EnrichmentPresetEntry) => (
                    <tr key={p.id} className="border-b">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{p.name}</span>
                          {p.isDefault && (
                            <Badge variant="default" className="gap-1">
                              <Star className="h-3 w-3" />
                              Default
                            </Badge>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-center">
                        {p.scope === 'private' ? (
                          <Badge variant="secondary" className="gap-1">
                            <Lock className="h-3 w-3" />
                            Private
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="gap-1">
                            <Globe className="h-3 w-3" />
                            Global
                          </Badge>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          {p.personSeniorities.map((s) => (
                            <Badge key={s} variant="outline" className="text-xs">
                              {SENIORITY_OPTIONS.find((o) => o.value === s)?.label ?? s}
                            </Badge>
                          ))}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {p.personTitles.length > 0
                          ? p.personTitles.length === 1
                            ? p.personTitles[0]
                            : `${p.personTitles.length} titles`
                          : '-'}
                      </td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {p.personDepartments.length > 0
                          ? p.personDepartments.length === 1
                            ? p.personDepartments[0]
                            : `${p.personDepartments.length} departments`
                          : '-'}
                      </td>
                      <td className="px-4 py-3 text-center">{p.perPage}</td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {p.createdByName ?? 'System'}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="icon" onClick={() => openEdit(p)}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            disabled={p.isDefault}
                            onClick={() => setDeleteDialog(p)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {(listQuery.data?.presets ?? []).length === 0 && (
                    <tr>
                      <td colSpan={8} className="py-8 text-center text-muted-foreground">
                        No enrichment presets configured
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
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editDialog === 'new' ? 'Create Preset' : 'Edit Preset'}
            </DialogTitle>
            <DialogDescription>
              Configure Apollo contact search filters for enrichment jobs.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            {/* Name */}
            <div className="space-y-2">
              <Label htmlFor="name">Preset Name</Label>
              <Input id="name" {...form.register('name')} placeholder="e.g. Standard Decision Makers" />
              {form.formState.errors.name && (
                <p className="text-sm text-destructive">{form.formState.errors.name.message}</p>
              )}
            </div>

            {/* Scope */}
            <div className="flex items-center gap-3">
              <Switch
                id="scope"
                checked={form.watch('scope') === 'private'}
                onCheckedChange={(v) => {
                  form.setValue('scope', v ? 'private' : 'global');
                  if (v) form.setValue('isDefault', false);
                }}
              />
              <Label htmlFor="scope">Private preset (only visible to creator in Slack)</Label>
            </div>

            {/* Is Default */}
            <div className="flex items-center gap-3">
              <Switch
                id="isDefault"
                checked={form.watch('isDefault')}
                disabled={form.watch('scope') === 'private'}
                onCheckedChange={(v) => form.setValue('isDefault', v)}
              />
              <Label htmlFor="isDefault" className={form.watch('scope') === 'private' ? 'text-muted-foreground' : ''}>
                Set as default preset
              </Label>
              {form.watch('scope') === 'private' && (
                <span className="text-xs text-muted-foreground">(global only)</span>
              )}
            </div>

            {/* Seniorities */}
            <div className="space-y-2">
              <Label>Seniority Levels</Label>
              <div className="grid grid-cols-2 gap-2">
                {SENIORITY_OPTIONS.map((opt) => (
                  <div key={opt.value} className="flex items-center gap-2">
                    <Checkbox
                      id={`seniority-${opt.value}`}
                      checked={watchedSeniorities.includes(opt.value)}
                      onCheckedChange={() => toggleSeniority(opt.value)}
                    />
                    <Label htmlFor={`seniority-${opt.value}`} className="text-sm font-normal">
                      {opt.label}
                    </Label>
                  </div>
                ))}
              </div>
              {form.formState.errors.personSeniorities && (
                <p className="text-sm text-destructive">
                  {form.formState.errors.personSeniorities.message}
                </p>
              )}
            </div>

            {/* Person Titles */}
            <div className="space-y-2">
              <Label htmlFor="personTitles">Person Titles (comma-separated)</Label>
              <Input
                id="personTitles"
                {...form.register('personTitles')}
                placeholder="e.g. CTO, VP of Engineering, IT Director"
              />
              <p className="text-xs text-muted-foreground">
                Leave blank to not filter by title.
              </p>
            </div>

            {/* Person Departments */}
            <div className="space-y-2">
              <Label htmlFor="personDepartments">Person Departments (comma-separated)</Label>
              <Input
                id="personDepartments"
                {...form.register('personDepartments')}
                placeholder="e.g. Engineering, Information Technology"
              />
              <p className="text-xs text-muted-foreground">
                Leave blank to not filter by department.
              </p>
            </div>

            {/* Person Functions */}
            <div className="space-y-2">
              <Label htmlFor="personFunctions">Person Functions (comma-separated)</Label>
              <Input
                id="personFunctions"
                {...form.register('personFunctions')}
                placeholder="e.g. engineering, information_technology"
              />
              <p className="text-xs text-muted-foreground">
                Leave blank to not filter by function.
              </p>
            </div>

            {/* Per Page */}
            <div className="space-y-2">
              <Label htmlFor="perPage">Results Per Company (1-100)</Label>
              <Input
                id="perPage"
                type="number"
                min={1}
                max={100}
                {...form.register('perPage')}
              />
              {form.formState.errors.perPage && (
                <p className="text-sm text-destructive">{form.formState.errors.perPage.message}</p>
              )}
            </div>

            {/* Location (read-only) */}
            <div className="space-y-2">
              <Label>Location</Label>
              <Input value="United States" disabled />
              <p className="text-xs text-muted-foreground">
                Location is always locked to United States.
              </p>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditDialog(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={createMut.isPending || updateMut.isPending}>
                {editDialog === 'new' ? 'Create' : 'Save Changes'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteDialog} onOpenChange={() => setDeleteDialog(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Preset</AlertDialogTitle>
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
