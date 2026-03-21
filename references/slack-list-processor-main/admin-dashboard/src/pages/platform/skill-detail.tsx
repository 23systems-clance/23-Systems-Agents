/**
 * Skill Detail page (T039 - Feature 39).
 *
 * Skill configuration form, agent/tool selectors, trigger config,
 * delivery channels, version upgrade banner, execution stats,
 * publish/deprecate actions, embedded test runner.
 */

import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Save, Rocket, Ban, AlertTriangle } from 'lucide-react';
import {
  getSkill,
  createSkill,
  updateSkill,
  publishSkill,
  deprecateSkill,
} from '@/services/platform/skills';
import { listAgents, type AgentSummary } from '@/services/platform/agents';
import { listMcpServers } from '@/services/platform/mcpServers';
import { SkillTestRunner } from '@/components/platform/SkillTestRunner';
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

const STATUS_COLORS: Record<string, string> = {
  DRAFT: 'bg-gray-500/10 text-gray-600 border-gray-500/20',
  TESTING: 'bg-yellow-500/10 text-yellow-600 border-yellow-500/20',
  PUBLISHED: 'bg-green-500/10 text-green-600 border-green-500/20',
  DEPRECATED: 'bg-red-500/10 text-red-600 border-red-500/20',
};

const TRIGGER_TYPES = [
  { id: 'SLACK_COMMAND', label: 'Slack Command' },
  { id: 'API_CALL', label: 'API Call' },
  { id: 'SCHEDULED', label: 'Scheduled (Cron)' },
  { id: 'EVENT', label: 'Chain Event' },
  { id: 'MANUAL', label: 'Manual' },
];

const DELIVERY_CHANNELS = [
  { id: 'SLACK_THREAD', label: 'Slack Thread' },
  { id: 'WEBHOOK', label: 'Webhook' },
  { id: 'EMAIL', label: 'Email (future)' },
  { id: 'CRM_SYNC', label: 'CRM Sync (future)' },
  { id: 'FILE_DOWNLOAD', label: 'File Download (future)' },
];

export default function SkillDetailPage() {
  const { skillId } = useParams<{ skillId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const isNew = !skillId;

  const [form, setForm] = useState({
    name: '',
    slug: '',
    description: '',
    agentId: '',
    agentVersionId: '',
    triggerType: 'API_CALL',
    triggerConfig: '',
    deliveryChannels: ['SLACK_THREAD'],
    creditCost: 1,
    chainEventName: '',
    maxRetries: 2,
    backoffMs: 5000,
  });

  const { data: skill, isLoading } = useQuery({
    queryKey: ['skill', skillId],
    queryFn: () => getSkill(skillId!),
    enabled: !!skillId,
  });

  const { data: agentsData } = useQuery({
    queryKey: ['agents', 'PUBLISHED'],
    queryFn: () => listAgents({ status: 'PUBLISHED' }),
  });

  useQuery({
    queryKey: ['mcp-servers'],
    queryFn: () => listMcpServers(),
  });

  useEffect(() => {
    if (skill) {
      setForm({
        name: skill.name,
        slug: skill.slug,
        description: skill.description ?? '',
        agentId: skill.agentId,
        agentVersionId: skill.agentVersionId,
        triggerType: skill.triggerType,
        triggerConfig: skill.triggerConfig ? JSON.stringify(skill.triggerConfig, null, 2) : '',
        deliveryChannels: skill.deliveryChannels,
        creditCost: Number(skill.creditCost),
        chainEventName: skill.chainEventName ?? '',
        maxRetries: skill.retryPolicy?.maxRetries ?? 2,
        backoffMs: skill.retryPolicy?.backoffMs ?? 5000,
      });
    }
  }, [skill]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload: Record<string, unknown> = {
        name: form.name,
        slug: form.slug,
        description: form.description || undefined,
        agentId: form.agentId,
        agentVersionId: form.agentVersionId,
        triggerType: form.triggerType,
        deliveryChannels: form.deliveryChannels,
        creditCost: form.creditCost,
        retryPolicy: { maxRetries: form.maxRetries, backoffMs: form.backoffMs },
        chainEventName: form.chainEventName || undefined,
      };
      if (form.triggerConfig) {
        payload.triggerConfig = JSON.parse(form.triggerConfig);
      }
      if (isNew) return createSkill(payload as any);
      return updateSkill(skillId!, payload);
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['skills'] });
      queryClient.invalidateQueries({ queryKey: ['skill', skillId] });
      if (isNew && data) {
        navigate(`/platform/skills/${data.id}`, { replace: true });
      }
    },
  });

  const publishMutation = useMutation({
    mutationFn: () => publishSkill(skillId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['skill', skillId] });
      queryClient.invalidateQueries({ queryKey: ['skills'] });
    },
  });

  const deprecateMutation = useMutation({
    mutationFn: () => deprecateSkill(skillId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['skill', skillId] });
      queryClient.invalidateQueries({ queryKey: ['skills'] });
    },
  });

  if (!isNew && isLoading) return <PageSkeleton />;

  const agents = agentsData?.agents ?? [];
  const canPublish = skill && skill.status !== 'PUBLISHED' && skill.status !== 'DEPRECATED';
  const canDeprecate = skill && skill.status !== 'DEPRECATED';

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" aria-label="Back to skills" onClick={() => navigate('/platform/skills')}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">{isNew ? 'New Skill' : skill?.name}</h1>
          {skill && (
            <div className="flex items-center gap-2 mt-1">
              <Badge variant="outline" className={STATUS_COLORS[skill.status] ?? ''}>
                {skill.status}
              </Badge>
              {skill.agent && (
                <span className="text-xs text-muted-foreground">
                  Agent: {skill.agent.name} v{skill.agentVersion?.version}
                </span>
              )}
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

      {saveMutation.isError && (
        <div className="rounded-md bg-red-500/10 border border-red-500/20 p-3 text-sm text-red-600">
          {saveMutation.error?.message ?? 'Operation failed'}
        </div>
      )}

      {skill?.versionCheck?.updateAvailable && (
        <div className="rounded-md bg-yellow-500/10 border border-yellow-500/20 p-3 text-sm text-yellow-700 flex items-center gap-2">
          <AlertTriangle className="h-4 w-4" />
          Agent version upgrade available: v{skill.versionCheck.currentVersion} → v{skill.versionCheck.latestPublishedVersion}
        </div>
      )}

      <div className="grid grid-cols-3 gap-6">
        <div className="col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Skill Configuration</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="name">Name</Label>
                  <Input id="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Lead Enrichment" />
                </div>
                <div>
                  <Label htmlFor="slug">Slug</Label>
                  <Input id="slug" value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} placeholder="lead-enrichment" disabled={!isNew} />
                </div>
              </div>

              <div>
                <Label htmlFor="description">Description</Label>
                <Textarea id="description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} rows={2} />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Agent</Label>
                  <Select value={form.agentId} onValueChange={(v) => setForm({ ...form, agentId: v })}>
                    <SelectTrigger><SelectValue placeholder="Select agent..." /></SelectTrigger>
                    <SelectContent>
                      {agents.map((a: AgentSummary) => (
                        <SelectItem key={a.id} value={a.id}>{a.name} (v{a.currentVersion})</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Trigger Type</Label>
                  <Select value={form.triggerType} onValueChange={(v) => setForm({ ...form, triggerType: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {TRIGGER_TYPES.map((t) => (
                        <SelectItem key={t.id} value={t.id}>{t.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <Label htmlFor="creditCost">Credit Cost</Label>
                  <Input id="creditCost" type="number" step="0.01" value={form.creditCost} onChange={(e) => setForm({ ...form, creditCost: Number(e.target.value) })} />
                </div>
                <div>
                  <Label htmlFor="maxRetries">Max Retries</Label>
                  <Input id="maxRetries" type="number" value={form.maxRetries} onChange={(e) => setForm({ ...form, maxRetries: Number(e.target.value) })} />
                </div>
                <div>
                  <Label htmlFor="backoffMs">Backoff (ms)</Label>
                  <Input id="backoffMs" type="number" value={form.backoffMs} onChange={(e) => setForm({ ...form, backoffMs: Number(e.target.value) })} />
                </div>
              </div>

              <div>
                <Label htmlFor="chainEventName">Chain Event Name (optional)</Label>
                <Input id="chainEventName" value={form.chainEventName} onChange={(e) => setForm({ ...form, chainEventName: e.target.value })} placeholder="enrichment-complete" />
              </div>

              <div>
                <Label>Delivery Channels</Label>
                <div className="flex flex-wrap gap-2 mt-1.5">
                  {DELIVERY_CHANNELS.map((ch) => (
                    <label key={ch.id} className="flex items-center gap-1.5 text-sm">
                      <input
                        type="checkbox"
                        checked={form.deliveryChannels.includes(ch.id)}
                        onChange={(e) => {
                          const channels = e.target.checked
                            ? [...form.deliveryChannels, ch.id]
                            : form.deliveryChannels.filter((c) => c !== ch.id);
                          setForm({ ...form, deliveryChannels: channels });
                        }}
                        className="h-3.5 w-3.5"
                      />
                      {ch.label}
                    </label>
                  ))}
                </div>
              </div>

              {(form.triggerType === 'SCHEDULED' || form.triggerType === 'EVENT') && (
                <div>
                  <Label htmlFor="triggerConfig">Trigger Config (JSON)</Label>
                  <Textarea
                    id="triggerConfig"
                    value={form.triggerConfig}
                    onChange={(e) => setForm({ ...form, triggerConfig: e.target.value })}
                    rows={3}
                    className="font-mono text-sm"
                    placeholder={form.triggerType === 'SCHEDULED' ? '{ "cron": "0 9 * * 1-5" }' : '{ "eventName": "enrichment-complete" }'}
                  />
                </div>
              )}
            </CardContent>
          </Card>

          {!isNew && <SkillTestRunner skillId={skillId!} />}
        </div>

        <div className="space-y-6">
          {!isNew && skill?.stats && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Execution Stats</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Total Executions</span>
                  <span className="font-medium">{skill.stats.totalExecutions}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Success Rate</span>
                  <span className="font-medium">{skill.stats.successRate}%</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Avg Duration</span>
                  <span className="font-medium">{skill.stats.avgDurationMs}ms</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Credits Consumed</span>
                  <span className="font-medium">{skill.stats.totalCreditsConsumed.toFixed(2)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Last 7 Days</span>
                  <span className="font-medium">{skill.stats.last7DaysExecutions}</span>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
