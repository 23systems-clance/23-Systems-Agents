/**
 * Admin page for managing Slack channel-to-client mappings.
 *
 * Uses a Slack channel picker instead of manual ID entry.
 * Allows admins to link Slack channels to ManagedClient entities.
 */

import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchMappings, createMapping, deleteMapping, type ChannelMapping } from '@/services/channelMappings';
import { fetchManagedClients } from '@/services/managed-clients';
import { queryKeys } from '@/lib/query-keys';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { PageSkeleton } from '@/components/shared/LoadingSkeleton';
import { SlackChannelPicker } from '@/components/shared/SlackChannelPicker';
import type { SlackChannel } from '@/types/api';

export default function ChannelMappingsPage() {
  const queryClient = useQueryClient();
  const [clientId, setClientId] = useState('');
  const [showChannelPicker, setShowChannelPicker] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ChannelMapping | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Fetch workspace to get teamId
  const workspacesQuery = useQuery({
    queryKey: queryKeys.workspaces.list(),
    queryFn: async () => {
      const { data } = await (await import('@/lib/api-client')).api.get('/workspaces');
      return data;
    },
  });
  const defaultTeamId: string = workspacesQuery.data?.workspaces?.[0]?.slackTeamId ?? '';

  const { data: mappings, isLoading } = useQuery({
    queryKey: queryKeys.channelMappings.list(),
    queryFn: () => fetchMappings(),
  });

  const { data: clients } = useQuery({
    queryKey: queryKeys.managedClients.list(),
    queryFn: () => fetchManagedClients(),
  });

  // Set of channel IDs already mapped
  const mappedChannelIds = useMemo(
    () => new Set((mappings ?? []).map((m) => m.slackChannelId)),
    [mappings],
  );

  const createMut = useMutation({
    mutationFn: ({ teamId, channelId, clientId: cId }: { teamId: string; channelId: string; clientId: string }) =>
      createMapping(teamId, channelId, cId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['channelMappings'] });
      queryClient.invalidateQueries({ queryKey: ['managedClients'] });
      setShowChannelPicker(false);
      setClientId('');
      setError(null);
    },
    onError: (err: any) => {
      setError(err?.response?.data?.error || 'Failed to create mapping.');
    },
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteMapping(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['channelMappings'] });
      queryClient.invalidateQueries({ queryKey: ['managedClients'] });
      setDeleteTarget(null);
    },
  });

  if (isLoading) return <PageSkeleton />;

  const clientList = Array.isArray(clients) ? clients : (clients as any)?.clients || [];
  // Filter clients to those in the current workspace
  const workspaceClients = clientList.filter((c: any) => !c.slackTeamId || c.slackTeamId === defaultTeamId);

  function handleChannelSelect(channel: SlackChannel) {
    if (!clientId || !defaultTeamId) return;
    createMut.mutate({
      teamId: defaultTeamId,
      channelId: channel.id,
      clientId,
    });
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Channel-Client Mappings</h1>
      <p className="text-muted-foreground">
        Link Slack channels to clients so enrichment jobs are associated with the correct client.
      </p>

      {/* Create Form */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Link a Channel</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-3">
            <div>
              <Label>Client</Label>
              <Select value={clientId} onValueChange={setClientId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select client" />
                </SelectTrigger>
                <SelectContent>
                  {workspaceClients.map((c: any) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end">
              <Button
                onClick={() => { setError(null); setShowChannelPicker(true); }}
                disabled={!clientId || !defaultTeamId}
              >
                Select Channel
              </Button>
            </div>
          </div>
          {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
        </CardContent>
      </Card>

      {/* Channel Picker Dialog */}
      <Dialog open={showChannelPicker} onOpenChange={setShowChannelPicker}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Select a Channel</DialogTitle>
            <DialogDescription>
              Pick a Slack channel to link to {workspaceClients.find((c: any) => c.id === clientId)?.name || 'the selected client'}.
            </DialogDescription>
          </DialogHeader>
          <SlackChannelPicker
            teamId={defaultTeamId}
            onSelect={handleChannelSelect}
            excludeChannelIds={mappedChannelIds}
            enabled={showChannelPicker}
          />
          {createMut.isPending && (
            <p className="text-sm text-muted-foreground">Creating mapping...</p>
          )}
        </DialogContent>
      </Dialog>

      {/* Existing Mappings */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Existing Mappings</CardTitle>
        </CardHeader>
        <CardContent>
          {!mappings?.length ? (
            <p className="text-sm text-muted-foreground">No mappings configured yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left">
                    <th className="py-2 pr-4">Client</th>
                    <th className="py-2 pr-4">Channel</th>
                    <th className="py-2 pr-4">Channel ID</th>
                    <th className="py-2 pr-4">Created</th>
                    <th className="py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {mappings.map((m) => (
                    <tr key={m.id} className="border-b">
                      <td className="py-2 pr-4 font-medium">{m.clientName}</td>
                      <td className="py-2 pr-4">
                        {m.channelName ? `#${m.channelName}` : '-'}
                      </td>
                      <td className="py-2 pr-4 font-mono text-xs text-muted-foreground">{m.slackChannelId}</td>
                      <td className="py-2 pr-4 text-muted-foreground">
                        {new Date(m.createdAt).toLocaleDateString()}
                      </td>
                      <td className="py-2">
                        <Button
                          size="sm"
                          variant="outline"
                          className="text-red-600"
                          onClick={() => setDeleteTarget(m)}
                        >
                          Delete
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Mapping?</AlertDialogTitle>
            <AlertDialogDescription>
              This will unlink channel {deleteTarget?.channelName ? `#${deleteTarget.channelName}` : deleteTarget?.slackChannelId} from {deleteTarget?.clientName}.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteTarget && deleteMut.mutate(deleteTarget.id)}
              className="bg-red-600 hover:bg-red-700"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
