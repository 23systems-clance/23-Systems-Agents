/**
 * Agent Detail page (T017 - Feature 39).
 *
 * Form for agent configuration, version history, publish/deprecate actions,
 * and embedded sandbox test panel.
 */

import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Save, Rocket, Ban, Trash2 } from 'lucide-react';
import {
  getAgent,
  createAgent,
  updateAgent,
  publishAgent,
  deprecateAgent,
  deleteAgent,
  type AgentVersion,
} from '@/services/platform/agents';
import { AgentSandbox } from '@/components/platform/AgentSandbox';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { PageSkeleton } from '@/components/shared/LoadingSkeleton';

const MODELS = [
  { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5' },
  { id: 'claude-sonnet-4-5-20250929', label: 'Claude Sonnet 4.5' },
  { id: 'claude-opus-4-6', label: 'Claude Opus 4.6' },
];

const STATUS_COLORS: Record<string, string> = {
  DRAFT: 'bg-gray-500/10 text-gray-600 border-gray-500/20',
  TESTING: 'bg-yellow-500/10 text-yellow-600 border-yellow-500/20',
  PUBLISHED: 'bg-green-500/10 text-green-600 border-green-500/20',
  DEPRECATED: 'bg-red-500/10 text-red-600 border-red-500/20',
};

export default function AgentDetailPage() {
  const { agentId } = useParams<{ agentId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const isNew = !agentId;

  const [form, setForm] = useState({
    name: '',
    slug: '',
    description: '',
    modelId: 'claude-haiku-4-5-20251001',
    systemPrompt: '',
    maxTokens: 4096,
    creditCost: 1,
    changeNote: '',
  });

  const { data: agent, isLoading } = useQuery({
    queryKey: ['agent', agentId],
    queryFn: () => getAgent(agentId!),
    enabled: !!agentId,
  });

  useEffect(() => {
    if (agent) {
      const latestVersion = agent.versions?.[0];
      setForm({
        name: agent.name,
        slug: agent.slug,
        description: agent.description ?? '',
        modelId: agent.modelId,
        systemPrompt: latestVersion?.systemPrompt ?? '',
        maxTokens: agent.maxTokens,
        creditCost: Number(agent.creditCost),
        changeNote: '',
      });
    }
  }, [agent]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (isNew) {
        return createAgent(form);
      }
      return updateAgent(agentId!, form);
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['agents'] });
      queryClient.invalidateQueries({ queryKey: ['agent', agentId] });
      if (isNew && data) {
        navigate(`/platform/agents/${data.id}`, { replace: true });
      }
    },
  });

  const publishMutation = useMutation({
    mutationFn: () => publishAgent(agentId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agent', agentId] });
      queryClient.invalidateQueries({ queryKey: ['agents'] });
    },
  });

  const deprecateMutation = useMutation({
    mutationFn: () => deprecateAgent(agentId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agent', agentId] });
      queryClient.invalidateQueries({ queryKey: ['agents'] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteAgent(agentId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agents'] });
      navigate('/platform/agents');
    },
  });

  if (!isNew && isLoading) return <PageSkeleton />;

  const latestVersion = agent?.versions?.[0];
  const canPublish = latestVersion && latestVersion.status !== 'PUBLISHED';
  const canDeprecate = agent && agent.status !== 'DEPRECATED';

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" aria-label="Back to agents" onClick={() => navigate('/platform/agents')}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">{isNew ? 'New Agent' : agent?.name}</h1>
          {agent && (
            <div className="flex items-center gap-2 mt-1">
              <Badge variant="outline" className={STATUS_COLORS[agent.status] ?? ''}>
                {agent.status}
              </Badge>
              <span className="text-xs text-muted-foreground">v{latestVersion?.version ?? 0}</span>
            </div>
          )}
        </div>
        <div className="flex gap-2">
          {!isNew && canPublish && (
            <Button variant="outline" onClick={() => publishMutation.mutate()} disabled={publishMutation.isPending}>
              <Rocket className="mr-2 h-4 w-4" />
              Publish
            </Button>
          )}
          {!isNew && canDeprecate && (
            <Button variant="outline" onClick={() => deprecateMutation.mutate()} disabled={deprecateMutation.isPending}>
              <Ban className="mr-2 h-4 w-4" />
              Deprecate
            </Button>
          )}
          <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
            <Save className="mr-2 h-4 w-4" />
            {isNew ? 'Create' : 'Save'}
          </Button>
        </div>
      </div>

      {(saveMutation.isError || publishMutation.isError || deprecateMutation.isError) && (
        <div className="rounded-md bg-red-500/10 border border-red-500/20 p-3 text-sm text-red-600">
          {(saveMutation.error ?? publishMutation.error ?? deprecateMutation.error)?.message ?? 'Operation failed'}
        </div>
      )}

      <div className="grid grid-cols-3 gap-6">
        <div className="col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Configuration</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="name">Name</Label>
                  <Input id="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="My Agent" />
                </div>
                <div>
                  <Label htmlFor="slug">Slug</Label>
                  <Input id="slug" value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} placeholder="my-agent" disabled={!isNew} />
                </div>
              </div>

              <div>
                <Label htmlFor="description">Description</Label>
                <Textarea id="description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} />
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <Label htmlFor="model">Model</Label>
                  <Select value={form.modelId} onValueChange={(v) => setForm({ ...form, modelId: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {MODELS.map((m) => (
                        <SelectItem key={m.id} value={m.id}>{m.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="maxTokens">Max Tokens</Label>
                  <Input id="maxTokens" type="number" value={form.maxTokens} onChange={(e) => setForm({ ...form, maxTokens: Number(e.target.value) })} />
                </div>
                <div>
                  <Label htmlFor="creditCost">Credit Cost</Label>
                  <Input id="creditCost" type="number" step="0.01" value={form.creditCost} onChange={(e) => setForm({ ...form, creditCost: Number(e.target.value) })} />
                </div>
              </div>

              <div>
                <Label htmlFor="systemPrompt">System Prompt</Label>
                <Textarea id="systemPrompt" value={form.systemPrompt} onChange={(e) => setForm({ ...form, systemPrompt: e.target.value })} rows={8} className="font-mono text-sm" />
              </div>

              {!isNew && (
                <div>
                  <Label htmlFor="changeNote">Change Note</Label>
                  <Input id="changeNote" value={form.changeNote} onChange={(e) => setForm({ ...form, changeNote: e.target.value })} placeholder="What changed?" />
                </div>
              )}
            </CardContent>
          </Card>

          {!isNew && <AgentSandbox agentId={agentId!} versionId={latestVersion?.id} />}
        </div>

        <div className="space-y-6">
          {!isNew && agent?.versions && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Version History</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {agent.versions.map((v: AgentVersion) => (
                    <div key={v.id} className="flex items-center gap-2 text-sm">
                      <Badge variant="outline" className={`text-[10px] ${STATUS_COLORS[v.status] ?? ''}`}>
                        v{v.version}
                      </Badge>
                      <span className="flex-1 text-muted-foreground truncate">
                        {v.changeNote ?? v.modelId}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {new Date(v.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {!isNew && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base text-red-600">Danger Zone</CardTitle>
              </CardHeader>
              <CardContent>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => {
                    if (confirm('Delete this agent? This cannot be undone.')) {
                      deleteMutation.mutate();
                    }
                  }}
                  disabled={deleteMutation.isPending}
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Delete Agent
                </Button>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
