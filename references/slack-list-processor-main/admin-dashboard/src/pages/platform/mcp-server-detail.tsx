/**
 * MCP Server Detail page (T028 - Feature 39).
 *
 * Server configuration form, tool management, health check trigger,
 * and delete action.
 */

import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Save, HeartPulse, Trash2, Plus, X } from 'lucide-react';
import {
  getMcpServer,
  createMcpServer,
  updateMcpServer,
  deleteMcpServer,
  runHealthCheck,
  addMcpTool,
  deleteMcpTool,
  type McpTool,
  type HealthCheckResult,
} from '@/services/platform/mcpServers';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { PageSkeleton } from '@/components/shared/LoadingSkeleton';

const AUTH_TYPES = [
  { id: 'API_KEY', label: 'API Key' },
  { id: 'OAUTH2', label: 'OAuth 2.0' },
  { id: 'BEARER_TOKEN', label: 'Bearer Token' },
  { id: 'BASIC_AUTH', label: 'Basic Auth' },
  { id: 'NONE', label: 'None' },
];

const STATUS_COLORS: Record<string, string> = {
  HEALTHY: 'bg-green-500/10 text-green-600 border-green-500/20',
  ERROR: 'bg-red-500/10 text-red-600 border-red-500/20',
  UNKNOWN: 'bg-gray-500/10 text-gray-600 border-gray-500/20',
};

export default function McpServerDetailPage() {
  const { serverId } = useParams<{ serverId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const isNew = !serverId;

  const [form, setForm] = useState({
    name: '',
    slug: '',
    provider: '',
    baseUrl: '',
    authType: 'API_KEY',
    credentials: '',
    byokEnabled: false,
    rateLimitRpm: '',
  });

  const [healthResult, setHealthResult] = useState<HealthCheckResult | null>(null);
  const [newToolName, setNewToolName] = useState('');
  const [newToolDescription, setNewToolDescription] = useState('');

  const { data: server, isLoading } = useQuery({
    queryKey: ['mcp-server', serverId],
    queryFn: () => getMcpServer(serverId!),
    enabled: !!serverId,
  });

  useEffect(() => {
    if (server) {
      setForm({
        name: server.name,
        slug: server.slug,
        provider: server.provider,
        baseUrl: server.baseUrl,
        authType: server.authType,
        credentials: '',
        byokEnabled: server.byokEnabled,
        rateLimitRpm: server.rateLimitRpm?.toString() ?? '',
      });
    }
  }, [server]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload: Record<string, unknown> = { ...form };
      if (form.rateLimitRpm) payload.rateLimitRpm = Number(form.rateLimitRpm);
      else delete payload.rateLimitRpm;
      if (!form.credentials) delete payload.credentials;

      if (isNew) {
        return createMcpServer(payload as any);
      }
      const { slug: _s, provider: _p, authType: _a, ...updatePayload } = payload;
      return updateMcpServer(serverId!, updatePayload);
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['mcp-servers'] });
      queryClient.invalidateQueries({ queryKey: ['mcp-server', serverId] });
      if (isNew && data) {
        navigate(`/platform/mcp-servers/${data.id}`, { replace: true });
      }
    },
  });

  const healthMutation = useMutation({
    mutationFn: () => runHealthCheck(serverId!),
    onSuccess: (data) => {
      setHealthResult(data);
      queryClient.invalidateQueries({ queryKey: ['mcp-server', serverId] });
      queryClient.invalidateQueries({ queryKey: ['mcp-servers'] });
    },
  });

  const addToolMutation = useMutation({
    mutationFn: () => addMcpTool(serverId!, { name: newToolName, description: newToolDescription || undefined }),
    onSuccess: () => {
      setNewToolName('');
      setNewToolDescription('');
      queryClient.invalidateQueries({ queryKey: ['mcp-server', serverId] });
    },
  });

  const removeToolMutation = useMutation({
    mutationFn: (toolId: string) => deleteMcpTool(serverId!, toolId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mcp-server', serverId] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteMcpServer(serverId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['mcp-servers'] });
      navigate('/platform/mcp-servers');
    },
  });

  if (!isNew && isLoading) return <PageSkeleton />;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" aria-label="Back to MCP servers" onClick={() => navigate('/platform/mcp-servers')}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">{isNew ? 'New MCP Server' : server?.name}</h1>
          {server && (
            <div className="flex items-center gap-2 mt-1">
              <Badge variant="outline" className={STATUS_COLORS[server.status] ?? ''}>
                {server.status}
              </Badge>
              <span className="text-xs text-muted-foreground">{server.provider}</span>
            </div>
          )}
        </div>
        <div className="flex gap-2">
          {!isNew && (
            <Button variant="outline" onClick={() => healthMutation.mutate()} disabled={healthMutation.isPending}>
              <HeartPulse className="mr-2 h-4 w-4" />
              Health Check
            </Button>
          )}
          <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
            <Save className="mr-2 h-4 w-4" />
            {isNew ? 'Create' : 'Save'}
          </Button>
        </div>
      </div>

      {(saveMutation.isError || healthMutation.isError) && (
        <div className="rounded-md bg-red-500/10 border border-red-500/20 p-3 text-sm text-red-600">
          {(saveMutation.error ?? healthMutation.error)?.message ?? 'Operation failed'}
        </div>
      )}

      {healthResult && (
        <div className={`rounded-md border p-3 text-sm ${healthResult.status === 'HEALTHY' ? 'bg-green-500/10 border-green-500/20 text-green-700' : 'bg-red-500/10 border-red-500/20 text-red-600'}`}>
          Health: {healthResult.status} ({healthResult.latencyMs}ms)
          {healthResult.error && ` — ${healthResult.error}`}
        </div>
      )}

      <div className="grid grid-cols-3 gap-6">
        <div className="col-span-2 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Server Configuration</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="name">Name</Label>
                  <Input id="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Apollo API" />
                </div>
                <div>
                  <Label htmlFor="slug">Slug</Label>
                  <Input id="slug" value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} placeholder="apollo-api" disabled={!isNew} />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="provider">Provider</Label>
                  <Input id="provider" value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value })} placeholder="Apollo.io" disabled={!isNew} />
                </div>
                <div>
                  <Label htmlFor="authType">Auth Type</Label>
                  <Select value={form.authType} onValueChange={(v) => setForm({ ...form, authType: v })} disabled={!isNew}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {AUTH_TYPES.map((t) => (
                        <SelectItem key={t.id} value={t.id}>{t.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div>
                <Label htmlFor="baseUrl">Base URL</Label>
                <Input id="baseUrl" value={form.baseUrl} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} placeholder="https://api.apollo.io/v1" />
              </div>

              <div>
                <Label htmlFor="credentials">Credentials {!isNew && '(leave blank to keep existing)'}</Label>
                <Input id="credentials" type="password" value={form.credentials} onChange={(e) => setForm({ ...form, credentials: e.target.value })} placeholder="API key or token" />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="rateLimitRpm">Rate Limit (req/min)</Label>
                  <Input id="rateLimitRpm" type="number" value={form.rateLimitRpm} onChange={(e) => setForm({ ...form, rateLimitRpm: e.target.value })} placeholder="60" />
                </div>
                <div className="flex items-end gap-2 pb-1">
                  <input
                    id="byokEnabled"
                    type="checkbox"
                    checked={form.byokEnabled}
                    onChange={(e) => setForm({ ...form, byokEnabled: e.target.checked })}
                    className="h-4 w-4"
                  />
                  <Label htmlFor="byokEnabled">Enable BYOK (Bring Your Own Key)</Label>
                </div>
              </div>
            </CardContent>
          </Card>

          {!isNew && (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-base">Tools ({server?.tools?.length ?? 0})</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex gap-2">
                  <Input
                    value={newToolName}
                    onChange={(e) => setNewToolName(e.target.value)}
                    placeholder="Tool name"
                    className="flex-1"
                  />
                  <Input
                    value={newToolDescription}
                    onChange={(e) => setNewToolDescription(e.target.value)}
                    placeholder="Description (optional)"
                    className="flex-1"
                  />
                  <Button
                    size="sm"
                    onClick={() => addToolMutation.mutate()}
                    disabled={!newToolName || addToolMutation.isPending}
                  >
                    <Plus className="mr-1 h-3 w-3" />
                    Add
                  </Button>
                </div>

                {server?.tools && server.tools.length > 0 ? (
                  <div className="space-y-2">
                    {server.tools.map((tool: McpTool) => (
                      <div key={tool.id} className="flex items-center justify-between rounded-md border p-3">
                        <div>
                          <p className="text-sm font-medium">{tool.name}</p>
                          {tool.description && (
                            <p className="text-xs text-muted-foreground">{tool.description}</p>
                          )}
                          <p className="text-xs text-muted-foreground mt-1">
                            Credit cost: {Number(tool.creditCost).toFixed(2)}
                          </p>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-red-600"
                          onClick={() => {
                            if (confirm(`Remove tool "${tool.name}"?`)) {
                              removeToolMutation.mutate(tool.id);
                            }
                          }}
                          disabled={removeToolMutation.isPending}
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    No tools registered yet. Add your first tool above.
                  </p>
                )}
              </CardContent>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          {!isNew && server && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Server Info</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Status</span>
                  <Badge variant="outline" className={STATUS_COLORS[server.status] ?? ''}>
                    {server.status}
                  </Badge>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Last check</span>
                  <span>{server.lastHealthCheck ? new Date(server.lastHealthCheck).toLocaleString() : 'Never'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Created</span>
                  <span>{new Date(server.createdAt).toLocaleDateString()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Rate limit</span>
                  <span>{server.rateLimitRpm ?? 'None'} rpm</span>
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
                    if (confirm('Delete this MCP server? This cannot be undone.')) {
                      deleteMutation.mutate();
                    }
                  }}
                  disabled={deleteMutation.isPending}
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Delete Server
                </Button>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
