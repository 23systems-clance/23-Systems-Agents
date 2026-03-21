import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Building2, Hash, Trash2, Plus, Loader2, ChevronDown, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { queryKeys } from '@/lib/query-keys';
import { fetchManagedClients } from '@/services/managed-clients';
import { fetchSlackChannels } from '@/services/slack-channels';
import {
  updateWorkflowClient,
  fetchWorkflowChannels,
  addWorkflowChannel,
  removeWorkflowChannel,
} from '@/services/workflows';
import type { WorkflowDetail, WorkflowChannelMapping } from '@/types/api';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface WorkflowScopePanelProps {
  workflowId: string;
  workflow: WorkflowDetail;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * WorkflowScopePanel renders a collapsible panel for managing
 * workflow scoping: client assignment and channel-level overrides.
 */
export function WorkflowScopePanel({ workflowId, workflow }: WorkflowScopePanelProps) {
  const queryClient = useQueryClient();
  const [collapsed, setCollapsed] = useState(false);
  const [addingChannel, setAddingChannel] = useState(false);
  const [selectedChannelId, setSelectedChannelId] = useState<string>('');

  // ---- Data queries ----
  const { data: clientsData } = useQuery({
    queryKey: queryKeys.managedClients.list(),
    queryFn: () => fetchManagedClients(),
  });

  const { data: channelsData } = useQuery({
    queryKey: queryKeys.slackChannels.list(workflow.channel_mappings?.[0]?.slack_team_id ?? 'T_DEFAULT'),
    queryFn: () => fetchSlackChannels(),
  });

  const { data: channelMappings, isLoading: mappingsLoading } = useQuery({
    queryKey: ['workflows', 'channels', workflowId],
    queryFn: () => fetchWorkflowChannels(workflowId),
  });

  // ---- Mutations ----
  const clientMutation = useMutation({
    mutationFn: (clientId: string | null) => updateWorkflowClient(workflowId, clientId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.workflows.detail(workflowId) });
      queryClient.invalidateQueries({ queryKey: ['workflows', 'list'] });
    },
  });

  const addChannelMutation = useMutation({
    mutationFn: (slackChannelId: string) =>
      addWorkflowChannel(workflowId, slackChannelId, 'T_DEFAULT'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflows', 'channels', workflowId] });
      queryClient.invalidateQueries({ queryKey: queryKeys.workflows.detail(workflowId) });
      setSelectedChannelId('');
      setAddingChannel(false);
    },
  });

  const removeChannelMutation = useMutation({
    mutationFn: (mappingId: string) => removeWorkflowChannel(workflowId, mappingId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflows', 'channels', workflowId] });
      queryClient.invalidateQueries({ queryKey: queryKeys.workflows.detail(workflowId) });
    },
  });

  const clients = clientsData?.clients ?? [];
  const channels = channelsData?.channels ?? [];
  const mappings: WorkflowChannelMapping[] = channelMappings ?? workflow.channel_mappings ?? [];

  // Channels already mapped (for filtering the "add" dropdown)
  const mappedChannelIds = new Set(mappings.map((m) => m.slack_channel_id));
  const availableChannels = channels.filter((c) => !mappedChannelIds.has(c.id));

  // Resolve channel name from the channels list
  const resolveChannelName = (channelId: string): string => {
    const found = channels.find((c) => c.id === channelId);
    return found ? `#${found.name}` : channelId;
  };

  return (
    <div className="border-t">
      {/* Header (click to collapse/expand) */}
      <button
        type="button"
        className="flex w-full items-center justify-between px-3 py-2 text-xs font-semibold uppercase text-muted-foreground hover:bg-muted/50 transition-colors"
        onClick={() => setCollapsed(!collapsed)}
      >
        <span>Scope</span>
        {collapsed ? (
          <ChevronRight className="h-3.5 w-3.5" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5" />
        )}
      </button>

      {!collapsed && (
        <ScrollArea className="max-h-[400px]">
          <div className="space-y-4 px-3 pb-3">
            {/* ---- Client Assignment ---- */}
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5 text-xs">
                <Building2 className="h-3.5 w-3.5" />
                Client
              </Label>
              <Select
                value={workflow.client_id ?? '__none__'}
                onValueChange={(value) => {
                  const clientId = value === '__none__' ? null : value;
                  clientMutation.mutate(clientId);
                }}
                disabled={clientMutation.isPending}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Select a client..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">
                    <span className="text-muted-foreground">No client (team fallback)</span>
                  </SelectItem>
                  {clients.map((client) => (
                    <SelectItem key={client.id} value={client.id}>
                      {client.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {workflow.client_name && (
                <p className="text-xs text-muted-foreground">
                  Tier 2: Resolves for {workflow.client_name} channels
                </p>
              )}
              {!workflow.client_id && (
                <p className="text-xs text-muted-foreground">
                  Tier 3: Team-level fallback workflow
                </p>
              )}
            </div>

            <Separator />

            {/* ---- Channel Overrides ---- */}
            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5 text-xs">
                <Hash className="h-3.5 w-3.5" />
                Channel Overrides
              </Label>
              <p className="text-xs text-muted-foreground">
                Channels where this workflow takes priority (Tier 1)
              </p>

              {mappingsLoading ? (
                <div className="flex items-center justify-center py-3">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                </div>
              ) : mappings.length === 0 ? (
                <p className="text-xs text-muted-foreground italic py-1">
                  No channel overrides configured
                </p>
              ) : (
                <div className="space-y-1">
                  {mappings.map((mapping) => (
                    <div
                      key={mapping.id}
                      className="flex items-center justify-between rounded-md border px-2 py-1.5 text-xs"
                    >
                      <div className="flex items-center gap-1.5">
                        <Hash className="h-3 w-3 text-muted-foreground" />
                        <span>{resolveChannelName(mapping.slack_channel_id)}</span>
                        <Badge variant="outline" className="text-[10px] px-1 py-0">
                          {mapping.trigger_type}
                        </Badge>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={() => removeChannelMutation.mutate(mapping.id)}
                        disabled={removeChannelMutation.isPending}
                        title="Remove channel override"
                      >
                        <Trash2 className="h-3 w-3 text-muted-foreground hover:text-destructive" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}

              {/* Add channel form */}
              {addingChannel ? (
                <div className="flex items-center gap-1.5 pt-1">
                  <Select
                    value={selectedChannelId}
                    onValueChange={setSelectedChannelId}
                  >
                    <SelectTrigger className="h-7 flex-1 text-xs">
                      <SelectValue placeholder="Select channel..." />
                    </SelectTrigger>
                    <SelectContent>
                      {availableChannels.map((ch) => (
                        <SelectItem key={ch.id} value={ch.id}>
                          #{ch.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    variant="default"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => {
                      if (selectedChannelId) {
                        addChannelMutation.mutate(selectedChannelId);
                      }
                    }}
                    disabled={!selectedChannelId || addChannelMutation.isPending}
                  >
                    {addChannelMutation.isPending ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Plus className="h-3 w-3" />
                    )}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => {
                      setAddingChannel(false);
                      setSelectedChannelId('');
                    }}
                  >
                    <span className="text-xs">x</span>
                  </Button>
                </div>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 w-full text-xs"
                  onClick={() => setAddingChannel(true)}
                >
                  <Plus className="mr-1 h-3 w-3" />
                  Add Channel Override
                </Button>
              )}
            </div>
          </div>
        </ScrollArea>
      )}
    </div>
  );
}
