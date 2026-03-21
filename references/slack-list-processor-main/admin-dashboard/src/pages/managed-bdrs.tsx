import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { motion } from 'framer-motion';
import { format, parseISO } from 'date-fns';
import {
  Plus, Pencil, Trash2, ArrowLeft, Briefcase, X as XIcon, Search, Check,
} from 'lucide-react';
import { queryKeys } from '@/lib/query-keys';
import {
  fetchBdrs,
  fetchBdrDetail,
  createBdr,
  updateBdr,
  deactivateBdr,
  associateClientToBdr,
  disassociateClientFromBdr,
} from '@/services/bdrs';
import { fetchSlackUsers } from '@/services/slack-users';
import { fetchManagedClients } from '@/services/managed-clients';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { PageSkeleton } from '@/components/shared/LoadingSkeleton';
import type { BdrEntry, BdrCreateInput, BdrUpdateInput, ManagedClientEntry, SlackUser } from '@/types/api';

// ---------------------------------------------------------------------------
// Zod Schemas
// ---------------------------------------------------------------------------

const createSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  email: z.string().email('Invalid email').or(z.literal('')).optional(),
  slackUserId: z.string().min(1, 'Slack User ID is required'),
  slackTeamId: z.string().min(1, 'Slack Team ID is required'),
});
type CreateFormData = z.infer<typeof createSchema>;

const editSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  email: z.string().email('Invalid email').or(z.literal('')).optional(),
  slackUserId: z.string().min(1, 'Slack User ID is required'),
  slackTeamId: z.string().min(1, 'Slack Team ID is required'),
  isActive: z.boolean(),
});
type EditFormData = z.infer<typeof editSchema>;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ManagedBdrsPage() {
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [editingBdr, setEditingBdr] = useState<BdrEntry | null>(null);
  const [deactivatingId, setDeactivatingId] = useState<string | null>(null);
  const [selectedBdrId, setSelectedBdrId] = useState<string | null>(null);
  const [showAddClient, setShowAddClient] = useState(false);

  // Slack user picker state
  const [slackSearch, setSlackSearch] = useState('');
  const [selectedSlackUser, setSelectedSlackUser] = useState<SlackUser | null>(null);

  // Queries
  const listQuery = useQuery({
    queryKey: queryKeys.bdrs.list(),
    queryFn: () => fetchBdrs(),
  });

  const detailQuery = useQuery({
    queryKey: queryKeys.bdrs.detail(selectedBdrId ?? ''),
    queryFn: () => fetchBdrDetail(selectedBdrId!),
    enabled: !!selectedBdrId,
  });

  const clientsQuery = useQuery({
    queryKey: queryKeys.managedClients.list(),
    queryFn: () => fetchManagedClients(),
    enabled: showAddClient,
  });

  const slackUsersQuery = useQuery({
    queryKey: queryKeys.slackUsers.list(),
    queryFn: () => fetchSlackUsers(),
    enabled: showCreate,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  // Set of Slack User IDs already registered as BDRs
  const existingBdrSlackIds = useMemo(() => {
    const ids = new Set<string>();
    for (const bdr of listQuery.data?.bdrs ?? []) {
      ids.add(bdr.slackUserId);
    }
    return ids;
  }, [listQuery.data]);

  // Filtered Slack users based on search
  const filteredSlackUsers = useMemo(() => {
    const users = slackUsersQuery.data?.users ?? [];
    if (!slackSearch.trim()) return users;
    const q = slackSearch.toLowerCase();
    return users.filter(
      (u) =>
        u.name.toLowerCase().includes(q) ||
        (u.email?.toLowerCase().includes(q)) ||
        (u.title?.toLowerCase().includes(q)),
    );
  }, [slackUsersQuery.data, slackSearch]);

  // Mutations
  const createMutation = useMutation({
    mutationFn: (input: BdrCreateInput) => createBdr(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bdrs'] });
      setShowCreate(false);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, input }: { id: string; input: BdrUpdateInput }) => updateBdr(id, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bdrs'] });
      setEditingBdr(null);
    },
  });

  const deactivateMutation = useMutation({
    mutationFn: (id: string) => deactivateBdr(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bdrs'] });
      setDeactivatingId(null);
      if (selectedBdrId) setSelectedBdrId(null);
    },
  });

  const associateClientMutation = useMutation({
    mutationFn: ({ bdrId, clientId }: { bdrId: string; clientId: string }) =>
      associateClientToBdr(bdrId, clientId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bdrs'] });
      setShowAddClient(false);
    },
  });

  const disassociateClientMutation = useMutation({
    mutationFn: ({ bdrId, clientId }: { bdrId: string; clientId: string }) =>
      disassociateClientFromBdr(bdrId, clientId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bdrs'] });
    },
  });

  // Forms
  const createForm = useForm<CreateFormData>({
    resolver: zodResolver(createSchema),
    defaultValues: { name: '', email: '', slackUserId: '', slackTeamId: '' },
  });

  const editForm = useForm<EditFormData>({
    resolver: zodResolver(editSchema),
  });

  function openCreate() {
    createForm.reset();
    setSelectedSlackUser(null);
    setSlackSearch('');
    setShowCreate(true);
  }

  function selectSlackUser(user: SlackUser) {
    setSelectedSlackUser(user);
    setSlackSearch('');
    createForm.setValue('name', user.name, { shouldValidate: true });
    createForm.setValue('email', user.email ?? '', { shouldValidate: true });
    createForm.setValue('slackUserId', user.id, { shouldValidate: true });
    createForm.setValue('slackTeamId', user.teamId, { shouldValidate: true });
  }

  function clearSlackUser() {
    setSelectedSlackUser(null);
    createForm.reset();
  }

  function openEdit(bdr: BdrEntry) {
    editForm.reset({
      name: bdr.name,
      email: bdr.email ?? '',
      slackUserId: bdr.slackUserId,
      slackTeamId: bdr.slackTeamId,
      isActive: bdr.isActive,
    });
    setEditingBdr(bdr);
  }

  function onCreateSubmit(data: CreateFormData) {
    const input: BdrCreateInput = {
      name: data.name,
      slackUserId: data.slackUserId,
      slackTeamId: data.slackTeamId,
    };
    if (data.email) input.email = data.email;
    createMutation.mutate(input);
  }

  function onEditSubmit(data: EditFormData) {
    if (!editingBdr) return;
    const input: BdrUpdateInput = {
      name: data.name,
      email: data.email || undefined,
      slackUserId: data.slackUserId,
      slackTeamId: data.slackTeamId,
      isActive: data.isActive,
    };
    updateMutation.mutate({ id: editingBdr.id, input });
  }

  // ---- Detail View ----
  if (selectedBdrId && detailQuery.data) {
    const d = detailQuery.data;
    const associatedClientIds = new Set(d.clients.map((c) => c.id));
    const availableClients = (clientsQuery.data?.clients ?? []).filter(
      (c: ManagedClientEntry) => c.isActive && !associatedClientIds.has(c.id),
    );

    return (
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => setSelectedBdrId(null)}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h2 className="text-2xl font-bold">{d.name}</h2>
          <Badge variant={d.isActive ? 'default' : 'destructive'}>
            {d.isActive ? 'Active' : 'Inactive'}
          </Badge>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Card>
            <CardHeader><CardTitle className="text-base">BDR Info</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div><span className="text-muted-foreground">Email:</span> {d.email || '-'}</div>
              <div><span className="text-muted-foreground">Slack User ID:</span> <span className="font-mono">{d.slackUserId}</span></div>
              <div><span className="text-muted-foreground">Slack Team ID:</span> <span className="font-mono">{d.slackTeamId}</span></div>
              <div><span className="text-muted-foreground">Created:</span> {format(parseISO(d.createdAt), 'MMM d, yyyy')}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Associated Clients</CardTitle>
                <Button size="sm" variant="outline" onClick={() => setShowAddClient(true)}>
                  <Briefcase className="mr-1 h-3 w-3" /> Add Client
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {d.clients.length === 0 ? (
                <p className="py-4 text-center text-sm text-muted-foreground">No clients associated</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="px-2 py-1 text-left font-medium text-muted-foreground">Name</th>
                      <th className="px-2 py-1 text-left font-medium text-muted-foreground">Slug</th>
                      <th className="px-2 py-1 text-right font-medium text-muted-foreground">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.clients.map((client) => (
                      <tr key={client.id} className="border-b">
                        <td className="px-2 py-2">{client.name}</td>
                        <td className="px-2 py-2 font-mono text-xs text-muted-foreground">{client.slug}</td>
                        <td className="px-2 py-2 text-right">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-destructive"
                            onClick={() =>
                              disassociateClientMutation.mutate({
                                bdrId: selectedBdrId!,
                                clientId: client.id,
                              })
                            }
                            disabled={disassociateClientMutation.isPending}
                          >
                            <XIcon className="h-3 w-3" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Add Client Dialog */}
        <Dialog open={showAddClient} onOpenChange={setShowAddClient}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add Client to {d.name}</DialogTitle>
              <DialogDescription>Select a client to associate with this BDR.</DialogDescription>
            </DialogHeader>
            {clientsQuery.isLoading ? (
              <p className="py-4 text-sm text-muted-foreground">Loading clients...</p>
            ) : availableClients.length === 0 ? (
              <p className="py-4 text-sm text-muted-foreground">No available clients to add.</p>
            ) : (
              <div className="max-h-64 space-y-1 overflow-y-auto">
                {availableClients.map((client: ManagedClientEntry) => (
                  <button
                    key={client.id}
                    className="flex w-full items-center justify-between rounded-md px-3 py-2 text-sm hover:bg-muted"
                    onClick={() =>
                      associateClientMutation.mutate({
                        bdrId: selectedBdrId!,
                        clientId: client.id,
                      })
                    }
                    disabled={associateClientMutation.isPending}
                  >
                    <div>
                      <span className="font-medium">{client.name}</span>
                      <span className="ml-2 font-mono text-xs text-muted-foreground">{client.slug}</span>
                    </div>
                    <Plus className="h-4 w-4" />
                  </button>
                ))}
              </div>
            )}
          </DialogContent>
        </Dialog>
      </motion.div>
    );
  }

  // ---- List View ----
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">BDRs</h2>
        <Button onClick={openCreate}>
          <Plus className="mr-2 h-4 w-4" /> New BDR
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
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Email</th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Slack User ID</th>
                    <th className="px-4 py-3 text-center font-medium text-muted-foreground">Clients</th>
                    <th className="px-4 py-3 text-center font-medium text-muted-foreground">Status</th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Created</th>
                    <th className="px-4 py-3 text-right font-medium text-muted-foreground">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {(listQuery.data?.bdrs ?? []).map((b) => (
                    <tr
                      key={b.id}
                      className="cursor-pointer border-b hover:bg-muted/50"
                      onClick={() => setSelectedBdrId(b.id)}
                    >
                      <td className="px-4 py-3 font-medium">{b.name}</td>
                      <td className="px-4 py-3 text-muted-foreground">{b.email || '-'}</td>
                      <td className="px-4 py-3 font-mono text-xs">{b.slackUserId}</td>
                      <td className="px-4 py-3 text-center">{b.clientCount}</td>
                      <td className="px-4 py-3 text-center">
                        <Badge variant={b.isActive ? 'default' : 'secondary'} className="text-xs">
                          {b.isActive ? 'Active' : 'Inactive'}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">{format(parseISO(b.createdAt), 'MMM d, yyyy')}</td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                          <Button size="sm" variant="ghost" onClick={() => openEdit(b)}>
                            <Pencil className="h-3 w-3" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-destructive"
                            onClick={() => setDeactivatingId(b.id)}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {(listQuery.data?.bdrs ?? []).length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                        No BDRs yet. Create one to get started.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create Dialog with Slack User Picker */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Create BDR</DialogTitle>
            <DialogDescription>Select a Slack workspace member to add as a BDR.</DialogDescription>
          </DialogHeader>

          {!selectedSlackUser ? (
            /* Step 1: Slack user search & selection */
            <div className="space-y-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search by name, email, or title..."
                  value={slackSearch}
                  onChange={(e) => setSlackSearch(e.target.value)}
                  className="pl-9"
                  autoFocus
                />
              </div>

              <div className="max-h-72 overflow-y-auto rounded-md border">
                {slackUsersQuery.isLoading ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">Loading Slack users...</p>
                ) : slackUsersQuery.isError ? (
                  <p className="py-6 text-center text-sm text-destructive">Failed to load Slack users</p>
                ) : filteredSlackUsers.length === 0 ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">
                    {slackSearch ? 'No users match your search' : 'No users found'}
                  </p>
                ) : (
                  filteredSlackUsers.map((user) => {
                    const alreadyBdr = existingBdrSlackIds.has(user.id);
                    return (
                      <button
                        key={user.id}
                        className={`flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm transition-colors ${
                          alreadyBdr
                            ? 'cursor-not-allowed opacity-50'
                            : 'hover:bg-muted'
                        }`}
                        onClick={() => !alreadyBdr && selectSlackUser(user)}
                        disabled={alreadyBdr}
                      >
                        {user.avatar ? (
                          <img
                            src={user.avatar}
                            alt=""
                            className="h-8 w-8 shrink-0 rounded-full"
                          />
                        ) : (
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">
                            {user.name.charAt(0).toUpperCase()}
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="truncate font-medium">{user.name}</span>
                            {alreadyBdr && (
                              <Badge variant="secondary" className="shrink-0 text-[10px]">
                                <Check className="mr-0.5 h-2.5 w-2.5" /> Already a BDR
                              </Badge>
                            )}
                          </div>
                          <div className="truncate text-xs text-muted-foreground">
                            {[user.title, user.email].filter(Boolean).join(' · ') || user.id}
                          </div>
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          ) : (
            /* Step 2: Confirm & edit auto-filled details */
            <form onSubmit={createForm.handleSubmit(onCreateSubmit)} className="space-y-4">
              {/* Selected user chip */}
              <div className="flex items-center gap-3 rounded-lg border bg-muted/50 p-3">
                {selectedSlackUser.avatar ? (
                  <img src={selectedSlackUser.avatar} alt="" className="h-10 w-10 rounded-full" />
                ) : (
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted text-sm font-medium">
                    {selectedSlackUser.name.charAt(0).toUpperCase()}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{selectedSlackUser.name}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {selectedSlackUser.email || selectedSlackUser.id}
                  </div>
                </div>
                <Button type="button" variant="ghost" size="sm" onClick={clearSlackUser}>
                  <XIcon className="h-4 w-4" />
                </Button>
              </div>

              <div>
                <Label htmlFor="create-name">Name *</Label>
                <Input id="create-name" {...createForm.register('name')} />
                {createForm.formState.errors.name && (
                  <p className="mt-1 text-xs text-destructive">{createForm.formState.errors.name.message}</p>
                )}
              </div>
              <div>
                <Label htmlFor="create-email">Email</Label>
                <Input id="create-email" type="email" {...createForm.register('email')} />
                {createForm.formState.errors.email && (
                  <p className="mt-1 text-xs text-destructive">{createForm.formState.errors.email.message}</p>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-muted-foreground">Slack User ID</Label>
                  <Input value={createForm.watch('slackUserId')} readOnly className="bg-muted font-mono text-xs" />
                </div>
                <div>
                  <Label className="text-muted-foreground">Slack Team ID</Label>
                  <Input value={createForm.watch('slackTeamId')} readOnly className="bg-muted font-mono text-xs" />
                </div>
              </div>

              {createMutation.isError && (
                <p className="text-sm text-destructive">
                  {(createMutation.error as Error).message || 'Failed to create BDR'}
                </p>
              )}
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
                <Button type="submit" disabled={createMutation.isPending}>
                  {createMutation.isPending ? 'Creating...' : 'Create'}
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={!!editingBdr} onOpenChange={() => setEditingBdr(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit BDR</DialogTitle>
            <DialogDescription>Update BDR details.</DialogDescription>
          </DialogHeader>
          <form onSubmit={editForm.handleSubmit(onEditSubmit)} className="space-y-4">
            <div>
              <Label htmlFor="edit-name">Name *</Label>
              <Input id="edit-name" {...editForm.register('name')} />
              {editForm.formState.errors.name && (
                <p className="mt-1 text-xs text-destructive">{editForm.formState.errors.name.message}</p>
              )}
            </div>
            <div>
              <Label htmlFor="edit-email">Email</Label>
              <Input id="edit-email" type="email" {...editForm.register('email')} />
            </div>
            <div>
              <Label htmlFor="edit-slackuserid">Slack User ID *</Label>
              <Input id="edit-slackuserid" {...editForm.register('slackUserId')} />
            </div>
            <div>
              <Label htmlFor="edit-slackteamid">Slack Team ID *</Label>
              <Input id="edit-slackteamid" {...editForm.register('slackTeamId')} />
            </div>
            <div className="flex items-center gap-2">
              <Switch
                id="edit-active"
                checked={editForm.watch('isActive')}
                onCheckedChange={(val) => editForm.setValue('isActive', val)}
              />
              <Label htmlFor="edit-active">Active</Label>
            </div>
            {updateMutation.isError && (
              <p className="text-sm text-destructive">
                {(updateMutation.error as Error).message || 'Failed to update BDR'}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setEditingBdr(null)}>Cancel</Button>
              <Button type="submit" disabled={updateMutation.isPending}>
                {updateMutation.isPending ? 'Saving...' : 'Save'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Deactivate Confirmation */}
      <AlertDialog open={!!deactivatingId} onOpenChange={() => setDeactivatingId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Deactivate BDR</AlertDialogTitle>
            <AlertDialogDescription>
              This will deactivate the BDR. They can be reactivated later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deactivatingId && deactivateMutation.mutate(deactivatingId)}
              disabled={deactivateMutation.isPending}
            >
              {deactivateMutation.isPending ? 'Deactivating...' : 'Deactivate'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </motion.div>
  );
}
