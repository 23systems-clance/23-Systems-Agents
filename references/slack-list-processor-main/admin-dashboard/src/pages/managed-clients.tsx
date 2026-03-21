import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { motion } from 'framer-motion';
import { format, parseISO } from 'date-fns';
import {
  Plus, Pencil, Trash2, Check, X, ArrowLeft, UserPlus, UserMinus, Hash, Megaphone, GitBranch,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { queryKeys } from '@/lib/query-keys';
import {
  fetchManagedClients,
  fetchManagedClientDetail,
  createManagedClient,
  updateManagedClient,
  deactivateManagedClient,
  associateBdrToClient,
  disassociateBdrFromClient,
} from '@/services/managed-clients';
import { fetchBdrs } from '@/services/bdrs';
import { createMapping, deleteMapping } from '@/services/channelMappings';
import { SlackChannelPicker } from '@/components/shared/SlackChannelPicker';
import { HubSpotConnectionCard } from '@/components/clients/HubSpotConnectionCard';
import { QualityGateSettings } from '@/components/clients/QualityGateSettings';
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
import type {
  ManagedClientEntry,
  ManagedClientCreateInput,
  ManagedClientUpdateInput,
  BdrEntry,
} from '@/types/api';

// ---------------------------------------------------------------------------
// Zod Schemas
// ---------------------------------------------------------------------------

const createSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  slug: z.string().optional(),
  instantlyApiKey: z.string().optional(),
  heyreachApiKey: z.string().optional(),
  hubspotApiKey: z.string().optional(),
  hubspotPortalId: z.string().optional(),
});
type CreateFormData = z.infer<typeof createSchema>;

const editSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  slug: z.string().min(1, 'Slug is required'),
  instantlyApiKey: z.string().optional(),
  heyreachApiKey: z.string().optional(),
  hubspotApiKey: z.string().optional(),
  hubspotPortalId: z.string().optional(),
  isActive: z.boolean(),
});
type EditFormData = z.infer<typeof editSchema>;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ManagedClientsPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [showCreate, setShowCreate] = useState(false);
  const [editingClient, setEditingClient] = useState<ManagedClientEntry | null>(null);
  const [deactivatingId, setDeactivatingId] = useState<string | null>(null);
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [showAddBdr, setShowAddBdr] = useState(false);
  const [showAddChannel, setShowAddChannel] = useState(false);

  // Fetch first active workspace teamId (fallback for channel picker)
  const workspaceQuery = useQuery({
    queryKey: ['workspaceInstallations'],
    queryFn: async () => {
      const { data } = await (await import('@/lib/api-client')).api.get<{ workspaces: { slackTeamId: string; slackTeamName: string }[] }>('/clients/workspace-installations');
      return data;
    },
    staleTime: 10 * 60 * 1000,
  });
  const fallbackTeamId: string = workspaceQuery.data?.workspaces?.[0]?.slackTeamId ?? '';

  // Queries
  const listQuery = useQuery({
    queryKey: queryKeys.managedClients.list(),
    queryFn: () => fetchManagedClients(),
  });

  const detailQuery = useQuery({
    queryKey: queryKeys.managedClients.detail(selectedClientId ?? ''),
    queryFn: () => fetchManagedClientDetail(selectedClientId!),
    enabled: !!selectedClientId,
  });

  // Available BDRs for association (only when adding BDR)
  const bdrsQuery = useQuery({
    queryKey: queryKeys.bdrs.list(),
    queryFn: () => fetchBdrs(),
    enabled: showAddBdr,
  });

  // Mutations
  const createMutation = useMutation({
    mutationFn: (input: ManagedClientCreateInput) => createManagedClient(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['managedClients'] });
      setShowCreate(false);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, input }: { id: string; input: ManagedClientUpdateInput }) =>
      updateManagedClient(id, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['managedClients'] });
      setEditingClient(null);
    },
  });

  const deactivateMutation = useMutation({
    mutationFn: (id: string) => deactivateManagedClient(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['managedClients'] });
      setDeactivatingId(null);
      if (selectedClientId) setSelectedClientId(null);
    },
  });

  const associateBdrMutation = useMutation({
    mutationFn: ({ clientId, bdrId }: { clientId: string; bdrId: string }) =>
      associateBdrToClient(clientId, bdrId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['managedClients'] });
      setShowAddBdr(false);
    },
  });

  const disassociateBdrMutation = useMutation({
    mutationFn: ({ clientId, bdrId }: { clientId: string; bdrId: string }) =>
      disassociateBdrFromClient(clientId, bdrId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['managedClients'] });
    },
  });

  const addChannelMutation = useMutation({
    mutationFn: ({ teamId, channelId, clientId }: { teamId: string; channelId: string; clientId: string }) =>
      createMapping(teamId, channelId, clientId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['managedClients'] });
      queryClient.invalidateQueries({ queryKey: ['channelMappings'] });
      setShowAddChannel(false);
    },
  });

  const removeChannelMutation = useMutation({
    mutationFn: (mappingId: string) => deleteMapping(mappingId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['managedClients'] });
      queryClient.invalidateQueries({ queryKey: ['channelMappings'] });
    },
  });

  // Forms
  const createForm = useForm<CreateFormData>({
    resolver: zodResolver(createSchema),
    defaultValues: { name: '', slug: '', instantlyApiKey: '', heyreachApiKey: '', hubspotApiKey: '', hubspotPortalId: '' },
  });

  const editForm = useForm<EditFormData>({
    resolver: zodResolver(editSchema),
  });

  function openEdit(client: ManagedClientEntry) {
    editForm.reset({
      name: client.name,
      slug: client.slug,
      instantlyApiKey: '',
      heyreachApiKey: '',
      hubspotApiKey: '',
      hubspotPortalId: client.hubspotPortalId ?? '',
      isActive: client.isActive,
    });
    setEditingClient(client);
  }

  function onCreateSubmit(data: CreateFormData) {
    const input: ManagedClientCreateInput = { name: data.name };
    if (data.slug) input.slug = data.slug;
    if (data.instantlyApiKey) input.instantlyApiKey = data.instantlyApiKey;
    if (data.heyreachApiKey) input.heyreachApiKey = data.heyreachApiKey;
    if (data.hubspotApiKey) input.hubspotApiKey = data.hubspotApiKey;
    if (data.hubspotPortalId) input.hubspotPortalId = data.hubspotPortalId;
    createMutation.mutate(input);
  }

  function onEditSubmit(data: EditFormData) {
    if (!editingClient) return;
    const input: ManagedClientUpdateInput = {
      name: data.name,
      slug: data.slug,
      isActive: data.isActive,
      hubspotPortalId: data.hubspotPortalId || undefined,
    };
    // Only send API keys if user typed a new value
    if (data.instantlyApiKey) input.instantlyApiKey = data.instantlyApiKey;
    if (data.heyreachApiKey) input.heyreachApiKey = data.heyreachApiKey;
    if (data.hubspotApiKey) input.hubspotApiKey = data.hubspotApiKey;
    updateMutation.mutate({ id: editingClient.id, input });
  }

  // ---- Detail View ----
  if (selectedClientId && detailQuery.data) {
    const d = detailQuery.data;
    const effectiveTeamId = d.slackTeamId || fallbackTeamId;
    const associatedBdrIds = new Set((d.bdrs ?? []).map((b) => b.id));
    const availableBdrs = (bdrsQuery.data?.bdrs ?? []).filter(
      (b: BdrEntry) => b.isActive && !associatedBdrIds.has(b.id),
    );
    const mappedChannelIds = new Set((d.channels ?? []).map((c) => c.slackChannelId));

    return (
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => setSelectedClientId(null)}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h2 className="text-2xl font-bold">{d.name}</h2>
          <Badge variant={d.isActive ? 'default' : 'destructive'}>
            {d.isActive ? 'Active' : 'Inactive'}
          </Badge>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Card>
            <CardHeader><CardTitle className="text-base">Client Info</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div><span className="text-muted-foreground">Slug:</span> {d.slug}</div>
              <div><span className="text-muted-foreground">HubSpot Portal ID:</span> {d.hubspotPortalId || '-'}</div>
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">Instantly:</span>
                {d.hasInstantlyKey
                  ? <Badge variant="default"><Check className="mr-1 h-3 w-3" />Configured</Badge>
                  : <Badge variant="secondary"><X className="mr-1 h-3 w-3" />Not set</Badge>}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">HeyReach:</span>
                {d.hasHeyreachKey
                  ? <Badge variant="default"><Check className="mr-1 h-3 w-3" />Configured</Badge>
                  : <Badge variant="secondary"><X className="mr-1 h-3 w-3" />Not set</Badge>}
              </div>
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">HubSpot:</span>
                {d.hasHubspotKey
                  ? <Badge variant="default"><Check className="mr-1 h-3 w-3" />Configured</Badge>
                  : <Badge variant="secondary"><X className="mr-1 h-3 w-3" />Not set</Badge>}
              </div>
              <div><span className="text-muted-foreground">Created:</span> {format(parseISO(d.createdAt), 'MMM d, yyyy')}</div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Associated BDRs</CardTitle>
                <Button size="sm" variant="outline" onClick={() => setShowAddBdr(true)}>
                  <UserPlus className="mr-1 h-3 w-3" /> Add BDR
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {d.bdrs.length === 0 ? (
                <p className="py-4 text-center text-sm text-muted-foreground">No BDRs associated</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="px-2 py-1 text-left font-medium text-muted-foreground">Name</th>
                      <th className="px-2 py-1 text-left font-medium text-muted-foreground">Slack ID</th>
                      <th className="px-2 py-1 text-right font-medium text-muted-foreground">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.bdrs.map((bdr) => (
                      <tr key={bdr.id} className="border-b">
                        <td className="px-2 py-2">{bdr.name}</td>
                        <td className="px-2 py-2 font-mono text-xs">{bdr.slackUserId}</td>
                        <td className="px-2 py-2 text-right">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-destructive"
                            onClick={() =>
                              disassociateBdrMutation.mutate({
                                clientId: selectedClientId!,
                                bdrId: bdr.id,
                              })
                            }
                            disabled={disassociateBdrMutation.isPending}
                          >
                            <UserMinus className="h-3 w-3" />
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

        {/* HubSpot Connection Card */}
        <HubSpotConnectionCard
          clientId={selectedClientId!}
          hasChannels={(d.channels ?? []).length > 0}
        />

        {/* Quality Gate Settings */}
        <QualityGateSettings clientId={selectedClientId!} />

        {/* Associated Channels Card */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Associated Channels</CardTitle>
              <Button size="sm" variant="outline" onClick={() => setShowAddChannel(true)}>
                <Hash className="mr-1 h-3 w-3" /> Add Channel
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {(d.channels ?? []).length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">No channels associated</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="px-2 py-1 text-left font-medium text-muted-foreground">Channel</th>
                    <th className="px-2 py-1 text-left font-medium text-muted-foreground">Channel ID</th>
                    <th className="px-2 py-1 text-right font-medium text-muted-foreground">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {(d.channels ?? []).map((ch) => (
                    <tr key={ch.id} className="border-b">
                      <td className="px-2 py-2 font-medium">{ch.channelName ? `#${ch.channelName}` : '-'}</td>
                      <td className="px-2 py-2 font-mono text-xs text-muted-foreground">{ch.slackChannelId}</td>
                      <td className="px-2 py-2 text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-destructive"
                          onClick={() => removeChannelMutation.mutate(ch.id)}
                          disabled={removeChannelMutation.isPending}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>

        {/* Associated Campaigns Card */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Associated Campaigns</CardTitle>
              <Megaphone className="h-4 w-4 text-muted-foreground" />
            </div>
          </CardHeader>
          <CardContent>
            {(d.campaigns ?? []).length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">No campaigns associated</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="px-2 py-1 text-left font-medium text-muted-foreground">Name</th>
                    <th className="px-2 py-1 text-center font-medium text-muted-foreground">Type</th>
                    <th className="px-2 py-1 text-center font-medium text-muted-foreground">Status</th>
                    <th className="px-2 py-1 text-center font-medium text-muted-foreground">Contacts</th>
                    <th className="px-2 py-1 text-left font-medium text-muted-foreground">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {(d.campaigns ?? []).map((campaign) => (
                    <tr key={campaign.id} className="border-b">
                      <td className="px-2 py-2 font-medium">{campaign.name}</td>
                      <td className="px-2 py-2 text-center">
                        <Badge variant="outline" className="text-[10px]">{campaign.campaignType}</Badge>
                      </td>
                      <td className="px-2 py-2 text-center">
                        <Badge
                          variant={campaign.status === 'ACTIVE' ? 'default' : campaign.status === 'COMPLETED' ? 'secondary' : 'outline'}
                          className="text-[10px]"
                        >
                          {campaign.status}
                        </Badge>
                      </td>
                      <td className="px-2 py-2 text-center">
                        {campaign.activeContacts}/{campaign.totalContacts}
                      </td>
                      <td className="px-2 py-2 text-xs text-muted-foreground">
                        {format(parseISO(campaign.createdAt), 'MMM d, yyyy')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>

        {/* Associated Workflows Card */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Associated Workflows</CardTitle>
              <GitBranch className="h-4 w-4 text-muted-foreground" />
            </div>
          </CardHeader>
          <CardContent>
            {(d.workflows ?? []).length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">No workflows assigned to this client</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="px-2 py-1 text-left font-medium text-muted-foreground">Name</th>
                    <th className="px-2 py-1 text-center font-medium text-muted-foreground">Trigger</th>
                    <th className="px-2 py-1 text-center font-medium text-muted-foreground">Version</th>
                    <th className="px-2 py-1 text-center font-medium text-muted-foreground">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {(d.workflows ?? []).map((wf) => (
                    <tr
                      key={wf.id}
                      className="border-b cursor-pointer hover:bg-muted/50"
                      onClick={() => navigate(`/workflows/${wf.id}/edit`)}
                    >
                      <td className="px-2 py-2 font-medium">{wf.name}</td>
                      <td className="px-2 py-2 text-center">
                        <Badge variant="outline" className="text-[10px]">{wf.trigger_type}</Badge>
                      </td>
                      <td className="px-2 py-2 text-center text-xs text-muted-foreground">
                        {wf.current_version ? `v${wf.current_version}` : '-'}
                      </td>
                      <td className="px-2 py-2 text-center">
                        <Badge
                          variant={wf.is_active ? 'default' : 'secondary'}
                          className="text-[10px]"
                        >
                          {wf.is_active ? 'Active' : 'Inactive'}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>

        {/* Add Channel Dialog */}
        <Dialog open={showAddChannel} onOpenChange={setShowAddChannel}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Add Channel to {d.name}</DialogTitle>
              <DialogDescription>Select a Slack channel to associate with this client.</DialogDescription>
            </DialogHeader>
            <SlackChannelPicker
              teamId={effectiveTeamId}
              onSelect={(channel) => {
                addChannelMutation.mutate({
                  teamId: effectiveTeamId,
                  channelId: channel.id,
                  clientId: selectedClientId!,
                });
              }}
              excludeChannelIds={mappedChannelIds}
              enabled={showAddChannel}
            />
            {addChannelMutation.isError && (
              <p className="text-sm text-destructive">
                {(addChannelMutation.error as any)?.response?.data?.error || 'Failed to add channel'}
              </p>
            )}
          </DialogContent>
        </Dialog>

        {/* Add BDR Dialog */}
        <Dialog open={showAddBdr} onOpenChange={setShowAddBdr}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add BDR to {d.name}</DialogTitle>
              <DialogDescription>Select a BDR to associate with this client.</DialogDescription>
            </DialogHeader>
            {bdrsQuery.isLoading ? (
              <p className="py-4 text-sm text-muted-foreground">Loading BDRs...</p>
            ) : availableBdrs.length === 0 ? (
              <p className="py-4 text-sm text-muted-foreground">No available BDRs to add.</p>
            ) : (
              <div className="max-h-64 space-y-1 overflow-y-auto">
                {availableBdrs.map((bdr: BdrEntry) => (
                  <button
                    key={bdr.id}
                    className="flex w-full items-center justify-between rounded-md px-3 py-2 text-sm hover:bg-muted"
                    onClick={() =>
                      associateBdrMutation.mutate({
                        clientId: selectedClientId!,
                        bdrId: bdr.id,
                      })
                    }
                    disabled={associateBdrMutation.isPending}
                  >
                    <div>
                      <span className="font-medium">{bdr.name}</span>
                      <span className="ml-2 font-mono text-xs text-muted-foreground">{bdr.slackUserId}</span>
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
        <h2 className="text-2xl font-bold">Clients</h2>
        <Button onClick={() => { createForm.reset({ name: '', slug: '', instantlyApiKey: '', heyreachApiKey: '', hubspotApiKey: '', hubspotPortalId: '' }); setShowCreate(true); }}>
          <Plus className="mr-2 h-4 w-4" /> New Client
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
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Slug</th>
                    <th className="px-4 py-3 text-center font-medium text-muted-foreground">Instantly</th>
                    <th className="px-4 py-3 text-center font-medium text-muted-foreground">HeyReach</th>
                    <th className="px-4 py-3 text-center font-medium text-muted-foreground">HubSpot</th>
                    <th className="px-4 py-3 text-center font-medium text-muted-foreground">BDRs</th>
                    <th className="px-4 py-3 text-center font-medium text-muted-foreground">Channels</th>
                    <th className="px-4 py-3 text-center font-medium text-muted-foreground">Status</th>
                    <th className="px-4 py-3 text-left font-medium text-muted-foreground">Created</th>
                    <th className="px-4 py-3 text-right font-medium text-muted-foreground">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {(listQuery.data?.clients ?? []).map((c) => (
                    <tr
                      key={c.id}
                      className="cursor-pointer border-b hover:bg-muted/50"
                      onClick={() => setSelectedClientId(c.id)}
                    >
                      <td className="px-4 py-3 font-medium">{c.name}</td>
                      <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{c.slug}</td>
                      <td className="px-4 py-3 text-center">
                        {c.hasInstantlyKey
                          ? <Check className="mx-auto h-4 w-4 text-green-500" />
                          : <X className="mx-auto h-4 w-4 text-muted-foreground/40" />}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {c.hasHeyreachKey
                          ? <Check className="mx-auto h-4 w-4 text-green-500" />
                          : <X className="mx-auto h-4 w-4 text-muted-foreground/40" />}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {c.hasHubspotKey
                          ? <Check className="mx-auto h-4 w-4 text-green-500" />
                          : <X className="mx-auto h-4 w-4 text-muted-foreground/40" />}
                      </td>
                      <td className="px-4 py-3 text-center">{c.bdrCount}</td>
                      <td className="px-4 py-3 text-center">{c.channelCount}</td>
                      <td className="px-4 py-3 text-center">
                        <Badge variant={c.isActive ? 'default' : 'secondary'} className="text-xs">
                          {c.isActive ? 'Active' : 'Inactive'}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">{format(parseISO(c.createdAt), 'MMM d, yyyy')}</td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                          <Button size="sm" variant="ghost" onClick={() => openEdit(c)}>
                            <Pencil className="h-3 w-3" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-destructive"
                            onClick={() => setDeactivatingId(c.id)}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {(listQuery.data?.clients ?? []).length === 0 && (
                    <tr>
                      <td colSpan={10} className="px-4 py-8 text-center text-muted-foreground">
                        No clients yet. Create one to get started.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Create Client</DialogTitle>
            <DialogDescription>Add a new business client with API credentials.</DialogDescription>
          </DialogHeader>
          <form onSubmit={createForm.handleSubmit(onCreateSubmit)} className="space-y-4">
            <div>
              <Label htmlFor="create-name">Name *</Label>
              <Input id="create-name" {...createForm.register('name')} placeholder="Acme Corp" />
              {createForm.formState.errors.name && (
                <p className="mt-1 text-xs text-destructive">{createForm.formState.errors.name.message}</p>
              )}
            </div>
            <div>
              <Label htmlFor="create-slug">Slug (auto-generated if blank)</Label>
              <Input id="create-slug" {...createForm.register('slug')} placeholder="acme-corp" />
            </div>
            <div>
              <Label htmlFor="create-instantly">Instantly API Key</Label>
              <Input id="create-instantly" type="password" {...createForm.register('instantlyApiKey')} placeholder="Enter API key" />
            </div>
            <div>
              <Label htmlFor="create-heyreach">HeyReach API Key</Label>
              <Input id="create-heyreach" type="password" {...createForm.register('heyreachApiKey')} placeholder="Enter API key" />
            </div>
            <div>
              <Label htmlFor="create-hubspot">HubSpot API Key</Label>
              <Input id="create-hubspot" type="password" {...createForm.register('hubspotApiKey')} placeholder="pat-na1-..." />
            </div>
            <div>
              <Label htmlFor="create-portalid">HubSpot Portal ID</Label>
              <Input id="create-portalid" {...createForm.register('hubspotPortalId')} placeholder="12345678" />
            </div>
            {createMutation.isError && (
              <p className="text-sm text-destructive">
                {(createMutation.error as Error).message || 'Failed to create client'}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
              <Button type="submit" disabled={createMutation.isPending}>
                {createMutation.isPending ? 'Creating...' : 'Create'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={!!editingClient} onOpenChange={() => setEditingClient(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit Client</DialogTitle>
            <DialogDescription>
              Update client details. Leave API key fields blank to keep existing values.
            </DialogDescription>
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
              <Label htmlFor="edit-slug">Slug *</Label>
              <Input id="edit-slug" {...editForm.register('slug')} />
            </div>
            <div>
              <Label htmlFor="edit-instantly">Instantly API Key</Label>
              <Input
                id="edit-instantly"
                type="password"
                {...editForm.register('instantlyApiKey')}
                placeholder={editingClient?.hasInstantlyKey ? '••••••• (configured)' : 'Enter API key'}
              />
            </div>
            <div>
              <Label htmlFor="edit-heyreach">HeyReach API Key</Label>
              <Input
                id="edit-heyreach"
                type="password"
                {...editForm.register('heyreachApiKey')}
                placeholder={editingClient?.hasHeyreachKey ? '••••••• (configured)' : 'Enter API key'}
              />
            </div>
            <div>
              <Label htmlFor="edit-hubspot">HubSpot API Key</Label>
              <Input
                id="edit-hubspot"
                type="password"
                {...editForm.register('hubspotApiKey')}
                placeholder={editingClient?.hasHubspotKey ? '••••••• (configured)' : 'pat-na1-...'}
              />
            </div>
            <div>
              <Label htmlFor="edit-portalid">HubSpot Portal ID</Label>
              <Input id="edit-portalid" {...editForm.register('hubspotPortalId')} placeholder="12345678" />
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
                {(updateMutation.error as Error).message || 'Failed to update client'}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setEditingClient(null)}>Cancel</Button>
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
            <AlertDialogTitle>Deactivate Client</AlertDialogTitle>
            <AlertDialogDescription>
              This will deactivate the client. They can be reactivated later.
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
