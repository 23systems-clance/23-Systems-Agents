import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Plus, Pencil, Trash2, Search, Library } from 'lucide-react';
import {
  fetchContentLibrary,
  createContentItem,
  updateContentItem,
  deleteContentItem,
  fetchContentCategories,
} from '@/services/content-library';
import type {
  ContentLibraryItem,
  CreateContentItemInput,
  UpdateContentItemInput,
  UpdateContentItemResponse,
} from '@/services/content-library';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
} from '@/components/ui/alert-dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { PageSkeleton } from '@/components/shared/LoadingSkeleton';

/** Training item type options. */
const ITEM_TYPES = [
  'VIDEO',
  'READING',
  'QUIZ',
  'PRACTICE_TASK',
  'CHECKLIST',
  'RESOURCE_LINK',
  'REIMBURSEMENT_INFO',
] as const;

/** Badge color map per training item type. */
const TYPE_COLORS: Record<string, string> = {
  VIDEO: 'bg-purple-100 text-purple-800',
  READING: 'bg-blue-100 text-blue-800',
  QUIZ: 'bg-yellow-100 text-yellow-800',
  PRACTICE_TASK: 'bg-green-100 text-green-800',
  CHECKLIST: 'bg-emerald-100 text-emerald-800',
  RESOURCE_LINK: 'bg-gray-100 text-gray-800',
  REIMBURSEMENT_INFO: 'bg-pink-100 text-pink-800',
};

/** Empty form state for creating a new item. */
const EMPTY_FORM = {
  type: 'VIDEO' as string,
  title: '',
  content: '',
  estimated_minutes: '',
  category_tags: '',
};

/**
 * Formats an ISO date string to a short locale date.
 */
function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/**
 * Content Library management page.
 *
 * Displays all content library items in a filterable table
 * with actions for creating, editing, and deleting items.
 */
export default function ContentLibraryPage() {
  const queryClient = useQueryClient();

  /* ── Filter state ─────────────────────────────────── */
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');

  /* ── Dialog state ─────────────────────────────────── */
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<ContentLibraryItem | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [updateWarning, setUpdateWarning] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ContentLibraryItem | null>(null);

  /* ── Queries ──────────────────────────────────────── */
  const filters = {
    ...(search ? { search } : {}),
    ...(typeFilter ? { type: typeFilter } : {}),
    ...(categoryFilter ? { category: categoryFilter } : {}),
  };

  const listQuery = useQuery({
    queryKey: ['content-library', filters],
    queryFn: () => fetchContentLibrary(Object.keys(filters).length > 0 ? filters : undefined),
  });

  const categoriesQuery = useQuery({
    queryKey: ['content-library-categories'],
    queryFn: fetchContentCategories,
  });

  /* ── Mutations ────────────────────────────────────── */
  const createMut = useMutation({
    mutationFn: (input: CreateContentItemInput) => createContentItem(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['content-library'] });
      queryClient.invalidateQueries({ queryKey: ['content-library-categories'] });
      closeDialog();
    },
  });

  const updateMut = useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateContentItemInput }) =>
      updateContentItem(id, input),
    onSuccess: (data: UpdateContentItemResponse) => {
      queryClient.invalidateQueries({ queryKey: ['content-library'] });
      queryClient.invalidateQueries({ queryKey: ['content-library-categories'] });
      closeDialog();
      if (data.warning) {
        setUpdateWarning(data.warning);
      }
    },
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteContentItem(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['content-library'] });
      queryClient.invalidateQueries({ queryKey: ['content-library-categories'] });
    },
  });

  /* ── Dialog helpers ───────────────────────────────── */

  /** Opens the dialog for creating a new item. */
  function openCreate() {
    setEditingItem(null);
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  }

  /** Opens the dialog pre-populated with an existing item for editing. */
  function openEdit(item: ContentLibraryItem) {
    setEditingItem(item);
    setForm({
      type: item.type,
      title: item.title,
      content: item.content ?? '',
      estimated_minutes: item.estimated_minutes != null ? String(item.estimated_minutes) : '',
      category_tags: item.category_tags.join(', '),
    });
    setDialogOpen(true);
  }

  /** Closes the dialog and resets form state. */
  function closeDialog() {
    setDialogOpen(false);
    setEditingItem(null);
    setForm(EMPTY_FORM);
  }

  /** Handles form submission for both create and edit. */
  function handleSubmit() {
    const categoryTags = form.category_tags
      .split(',')
      .map((t) => t.trim())
      .filter((t) => t.length > 0);

    const estimatedMinutes = form.estimated_minutes
      ? parseInt(form.estimated_minutes, 10)
      : undefined;

    if (editingItem) {
      const input: UpdateContentItemInput = {
        title: form.title,
        content: form.content || undefined,
        estimated_minutes: estimatedMinutes,
        category_tags: categoryTags,
      };
      updateMut.mutate({ id: editingItem.id, input });
    } else {
      const input: CreateContentItemInput = {
        type: form.type,
        title: form.title,
        content: form.content || undefined,
        estimated_minutes: estimatedMinutes,
        category_tags: categoryTags,
      };
      createMut.mutate(input);
    }
  }

  /** Opens the delete confirmation dialog. */
  function handleDelete(item: ContentLibraryItem) {
    setDeleteTarget(item);
  }

  /** Executes the confirmed delete. */
  function handleDeleteConfirm() {
    if (deleteTarget) {
      deleteMut.mutate(deleteTarget.id);
      setDeleteTarget(null);
    }
  }

  /** Updates a single form field. */
  function setField(field: keyof typeof EMPTY_FORM, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  const isSaving = createMut.isPending || updateMut.isPending;
  const items = listQuery.data?.items ?? [];
  const categories = categoriesQuery.data ?? [];

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
      {/* ── Header ──────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <Library className="h-6 w-6" />
            Content Library
          </h2>
          <p className="text-sm text-muted-foreground">
            Manage training content items used in onboarding plans.
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="mr-1 h-4 w-4" />
          Add Item
        </Button>
      </div>

      {/* ── Update warning banner ────────────────────── */}
      {updateWarning && (
        <Card className="border-yellow-300 bg-yellow-50">
          <CardContent className="flex items-center justify-between py-3">
            <p className="text-sm text-yellow-800">{updateWarning}</p>
            <Button variant="ghost" size="sm" onClick={() => setUpdateWarning(null)}>
              Dismiss
            </Button>
          </CardContent>
        </Card>
      )}

      {/* ── Filter bar ──────────────────────────────── */}
      <Card>
        <CardContent className="flex flex-wrap items-end gap-4 py-4">
          {/* Search */}
          <div className="flex-1 min-w-[200px]">
            <Label htmlFor="search" className="text-xs text-muted-foreground">Search</Label>
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                id="search"
                placeholder="Filter by title..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8"
              />
            </div>
          </div>

          {/* Type filter */}
          <div className="w-[180px]">
            <Label className="text-xs text-muted-foreground">Type</Label>
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger>
                <SelectValue placeholder="All types" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All types</SelectItem>
                {ITEM_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>{t.replace('_', ' ')}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Category filter */}
          <div className="w-[180px]">
            <Label className="text-xs text-muted-foreground">Category</Label>
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger>
                <SelectValue placeholder="All categories" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All categories</SelectItem>
                {categories.map((c) => (
                  <SelectItem key={c.tag} value={c.tag}>
                    {c.tag} ({c.count})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* ── Data table ──────────────────────────────── */}
      <Card>
        <CardContent className="p-0">
          {listQuery.isLoading ? (
            <PageSkeleton />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Title</th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Type</th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Categories</th>
                    <th className="px-4 py-3 text-center font-medium text-muted-foreground">Est. Time</th>
                    <th className="px-4 py-3 text-center font-medium text-muted-foreground">Usage</th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Updated</th>
                    <th className="px-4 py-3 text-right font-medium text-muted-foreground">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.id} className="border-b">
                      <td className="px-4 py-3 font-medium">{item.title}</td>
                      <td className="px-4 py-3">
                        <Badge className={TYPE_COLORS[item.type] ?? 'bg-gray-100 text-gray-800'}>
                          {item.type.replace('_', ' ')}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-1">
                          {item.category_tags.length > 0 ? (
                            item.category_tags.map((tag) => (
                              <Badge key={tag} variant="outline" className="text-xs">
                                {tag}
                              </Badge>
                            ))
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-center">
                        {item.estimated_minutes != null ? `${item.estimated_minutes}m` : '-'}
                      </td>
                      <td className="px-4 py-3 text-center">{item.usage_count}</td>
                      <td className="px-4 py-3 text-muted-foreground">
                        {formatDate(item.updated_at)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => openEdit(item)}
                            title="Edit item"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleDelete(item)}
                            title="Delete item"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {items.length === 0 && (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-muted-foreground">
                        No content library items found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Create / Edit Dialog ────────────────────── */}
      <Dialog open={dialogOpen} onOpenChange={() => closeDialog()}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingItem ? 'Edit Item' : 'Add Content Item'}</DialogTitle>
          </DialogHeader>
          {editingItem && editingItem.usage_count > 0 && (
            <div className="rounded-md border border-yellow-300 bg-yellow-50 p-3 text-sm text-yellow-800">
              This item is used in {editingItem.usage_count} onboarding plan(s). Changes will be reflected in all plans that reference it.
            </div>
          )}
          <div className="space-y-4">
            {/* Type */}
            <div className="space-y-2">
              <Label>Type</Label>
              <Select
                value={form.type}
                onValueChange={(v) => setField('type', v)}
                disabled={!!editingItem}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent>
                  {ITEM_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>{t.replace('_', ' ')}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Title */}
            <div className="space-y-2">
              <Label htmlFor="item-title">Title</Label>
              <Input
                id="item-title"
                value={form.title}
                onChange={(e) => setField('title', e.target.value)}
                placeholder="e.g. Cold Calling Best Practices"
              />
            </div>

            {/* Content */}
            <div className="space-y-2">
              <Label htmlFor="item-content">Content (URL or text)</Label>
              <Input
                id="item-content"
                value={form.content}
                onChange={(e) => setField('content', e.target.value)}
                placeholder="https://... or free-form text"
              />
            </div>

            {/* Estimated Minutes */}
            <div className="space-y-2">
              <Label htmlFor="item-minutes">Estimated Minutes</Label>
              <Input
                id="item-minutes"
                type="number"
                min={1}
                value={form.estimated_minutes}
                onChange={(e) => setField('estimated_minutes', e.target.value)}
                placeholder="e.g. 15"
              />
            </div>

            {/* Category Tags */}
            <div className="space-y-2">
              <Label htmlFor="item-tags">Category Tags (comma-separated)</Label>
              <Input
                id="item-tags"
                value={form.category_tags}
                onChange={(e) => setField('category_tags', e.target.value)}
                placeholder="e.g. sales, onboarding, cold-calling"
              />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={closeDialog}>
              Cancel
            </Button>
            <Button
              onClick={handleSubmit}
              disabled={isSaving || !form.title.trim()}
            >
              {editingItem ? 'Save Changes' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete Confirmation ──────────────────────── */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Content Item</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete &quot;{deleteTarget?.title}&quot;? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleDeleteConfirm}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </motion.div>
  );
}
