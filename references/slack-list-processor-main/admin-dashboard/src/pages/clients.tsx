import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { format, parseISO } from 'date-fns';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { ArrowLeft, DollarSign, Activity, Briefcase, AlertTriangle } from 'lucide-react';
import { queryKeys } from '@/lib/query-keys';
import { formatCurrency, formatNumber } from '@/lib/utils';
import { fetchClients, fetchClientDetail } from '@/services/clients';
import { fetchJobDetail } from '@/services/jobs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { StatCard } from '@/components/shared/StatCard';
import { PageSkeleton } from '@/components/shared/LoadingSkeleton';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import type { ClientEntry } from '@/types/api';

const CHART_COLORS = [
  'hsl(12, 76%, 61%)', 'hsl(173, 58%, 39%)', 'hsl(197, 37%, 24%)',
  'hsl(43, 74%, 66%)', 'hsl(27, 87%, 67%)',
];

const STATUS_COLORS: Record<string, 'default' | 'secondary' | 'destructive'> = {
  COMPLETED: 'default',
  PROCESSING: 'secondary',
  PENDING: 'secondary',
  AWAITING_PHONES: 'secondary',
  FAILED: 'destructive',
  CANCELLED: 'destructive',
};

/** Shorten provider names for chart labels. */
function shortProvider(name: string): string {
  const map: Record<string, string> = {
    BUILTWITH: 'BuiltWith',
    AI_ORCHESTRATOR: 'AI',
    APOLLO: 'Apollo',
  };
  return map[name] ?? name;
}

/** Format purpose enum to readable text. */
function formatPurpose(purpose: string | null): string {
  if (!purpose) return '-';
  const map: Record<string, string> = {
    JUST_A_LIST: 'Just a List',
    COLD_CALLING: 'Cold Calling',
    LINKEDIN: 'LinkedIn',
    EMAILING: 'Emailing',
    ALL: 'All',
  };
  return map[purpose] ?? purpose;
}

/** Format persona type enum to readable text. */
function formatPersona(persona: string): string {
  return persona
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace('Ceo', 'CEO')
    .replace('Hr ', 'HR ')
    .replace('It ', 'IT ');
}

export default function ClientsPage() {
  const [selectedClient, setSelectedClient] = useState<string | null>(null);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const limit = 20;

  const listQuery = useQuery({
    queryKey: queryKeys.workspaces.list({ offset: String(offset), limit: String(limit) }),
    queryFn: () => fetchClients({ offset: String(offset), limit: String(limit) }),
  });

  const detailQuery = useQuery({
    queryKey: queryKeys.workspaces.detail(selectedClient ?? ''),
    queryFn: () => fetchClientDetail(selectedClient!),
    enabled: !!selectedClient,
  });

  const jobDetailQuery = useQuery({
    queryKey: queryKeys.jobs.detail(selectedJobId ?? ''),
    queryFn: () => fetchJobDetail(selectedJobId!),
    enabled: !!selectedJobId,
  });

  // Client Detail View
  if (selectedClient && detailQuery.data) {
    const d = detailQuery.data;
    const providerData = d.cost_by_provider
      .filter((p) => parseFloat(p.cost_usd) > 0)
      .map((p) => ({ name: shortProvider(p.service), value: parseFloat(p.cost_usd) }));

    return (
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => setSelectedClient(null)}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h2 className="text-2xl font-bold">{d.slack_team_name}</h2>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          <StatCard title="Total Cost" value={formatCurrency(parseFloat(d.summary.total_cost_usd))} icon={DollarSign} />
          <StatCard title="API Calls" value={formatNumber(d.summary.total_api_calls)} icon={Activity} />
          <StatCard title="Jobs" value={formatNumber(d.summary.total_jobs)} icon={Briefcase} />
          <StatCard
            title="Error Rate"
            value={`${d.summary.error_rate_percent.toFixed(1)}%`}
            icon={AlertTriangle}
          />
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* Cost by Provider */}
          <Card>
            <CardHeader><CardTitle className="text-base">Cost by Provider</CardTitle></CardHeader>
            <CardContent>
              {providerData.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">No data</p>
              ) : (
                <ResponsiveContainer width="100%" height={250}>
                  <PieChart>
                    <Pie
                      data={providerData}
                      cx="50%"
                      cy="45%"
                      innerRadius={45}
                      outerRadius={80}
                      paddingAngle={2}
                      dataKey="value"
                    >
                      {providerData.map((_, idx) => (
                        <Cell key={idx} fill={CHART_COLORS[idx % CHART_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(value) => formatCurrency(Number(value))} />
                    <Legend
                      verticalAlign="bottom"
                      iconType="circle"
                      iconSize={8}
                      formatter={(value) => (
                        <span className="text-xs text-foreground">{value}</span>
                      )}
                    />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          {/* Top Users */}
          <Card>
            <CardHeader><CardTitle className="text-base">Top Users</CardTitle></CardHeader>
            <CardContent>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">User</th>
                    <th className="px-3 py-2 text-right font-medium text-muted-foreground">Jobs</th>
                    <th className="px-3 py-2 text-right font-medium text-muted-foreground">Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {d.top_users.map((u) => (
                    <tr key={u.slack_user_id} className="border-b">
                      <td className="px-3 py-2">{u.display_name}</td>
                      <td className="px-3 py-2 text-right">{u.total_jobs}</td>
                      <td className="px-3 py-2 text-right">{formatCurrency(parseFloat(u.total_cost_usd))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </div>

        {/* Recent Jobs */}
        <Card>
          <CardHeader><CardTitle className="text-base">Recent Jobs</CardTitle></CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground">ID</th>
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground">Type</th>
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground">Status</th>
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground">File</th>
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground">Purpose</th>
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground">Co-sell</th>
                  <th className="px-3 py-2 text-right font-medium text-muted-foreground">Rows</th>
                  <th className="px-3 py-2 text-left font-medium text-muted-foreground">Created</th>
                </tr>
              </thead>
              <tbody>
                {d.recent_jobs.map((j) => (
                  <tr
                    key={j.id}
                    className="cursor-pointer border-b hover:bg-muted/50"
                    onClick={() => setSelectedJobId(j.id)}
                  >
                    <td className="px-3 py-2 font-mono text-xs">{j.id.slice(0, 8)}</td>
                    <td className="px-3 py-2">{j.job_type}</td>
                    <td className="px-3 py-2">
                      <Badge variant={STATUS_COLORS[j.status] ?? 'secondary'} className="text-xs">
                        {j.status}
                      </Badge>
                    </td>
                    <td className="max-w-[150px] truncate px-3 py-2">{j.source_file_name}</td>
                    <td className="px-3 py-2">{formatPurpose(j.purpose)}</td>
                    <td className="px-3 py-2">{j.is_cosell ? `Yes${j.cosell_provider ? ` (${j.cosell_provider})` : ''}` : 'No'}</td>
                    <td className="px-3 py-2 text-right">{j.source_row_count}</td>
                    <td className="px-3 py-2">{format(parseISO(j.created_at), 'MMM d HH:mm')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>

        {/* Job Detail Dialog */}
        <JobDetailDialog
          jobId={selectedJobId}
          data={jobDetailQuery.data}
          isLoading={jobDetailQuery.isLoading}
          onClose={() => setSelectedJobId(null)}
        />
      </motion.div>
    );
  }

  // Client List View
  const totalClients = listQuery.data?.total ?? 0;
  const currentPage = Math.floor(offset / limit) + 1;
  const totalPages = Math.ceil(totalClients / limit) || 1;

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
      <h2 className="text-2xl font-bold">Clients</h2>

      <Card>
        <CardContent className="p-0">
          {listQuery.isLoading ? (
            <PageSkeleton />
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="px-4 py-3 text-left font-medium text-muted-foreground">Workspace</th>
                      <th className="px-4 py-3 text-right font-medium text-muted-foreground">Jobs</th>
                      <th className="px-4 py-3 text-right font-medium text-muted-foreground">API Calls</th>
                      <th className="px-4 py-3 text-right font-medium text-muted-foreground">Cost</th>
                      <th className="px-4 py-3 text-right font-medium text-muted-foreground">Error Rate</th>
                      <th className="px-4 py-3 text-left font-medium text-muted-foreground">Last Active</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(listQuery.data?.clients ?? []).map((c: ClientEntry) => (
                      <tr
                        key={c.slack_team_id}
                        className="cursor-pointer border-b hover:bg-muted/50"
                        onClick={() => setSelectedClient(c.slack_team_id)}
                      >
                        <td className="px-4 py-3 font-medium">{c.slack_team_name}</td>
                        <td className="px-4 py-3 text-right">{c.total_jobs}</td>
                        <td className="px-4 py-3 text-right">{c.total_api_calls}</td>
                        <td className="px-4 py-3 text-right">{formatCurrency(parseFloat(c.total_cost_usd))}</td>
                        <td className="px-4 py-3 text-right">{c.error_rate_percent.toFixed(1)}%</td>
                        <td className="px-4 py-3">{format(parseISO(c.last_active_at), 'MMM d, yyyy')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex items-center justify-between p-4">
                <p className="text-sm text-muted-foreground">
                  Page {currentPage} of {totalPages} ({totalClients} total)
                </p>
                <div className="flex gap-2">
                  <button
                    className="rounded border px-3 py-1 text-sm disabled:opacity-50"
                    disabled={offset <= 0}
                    onClick={() => setOffset((o) => Math.max(0, o - limit))}
                  >
                    Previous
                  </button>
                  <button
                    className="rounded border px-3 py-1 text-sm disabled:opacity-50"
                    disabled={offset + limit >= totalClients}
                    onClick={() => setOffset((o) => o + limit)}
                  >
                    Next
                  </button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Job Detail Dialog Component
// ---------------------------------------------------------------------------

import type { JobDetail } from '@/types/api';

function JobDetailDialog({
  jobId,
  data,
  isLoading,
  onClose,
}: {
  jobId: string | null;
  data: JobDetail | undefined;
  isLoading: boolean;
  onClose: () => void;
}) {
  return (
    <Dialog open={!!jobId} onOpenChange={() => onClose()}>
      <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Job Details</DialogTitle>
          <DialogDescription>Full conversation flow and processing details</DialogDescription>
        </DialogHeader>
        {isLoading ? (
          <PageSkeleton />
        ) : data ? (
          <div className="space-y-5">
            {/* Job Info */}
            <section>
              <h4 className="mb-2 text-sm font-semibold text-muted-foreground">Job Info</h4>
              <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
                <div><span className="text-muted-foreground">ID:</span> <span className="font-mono text-xs">{data.id}</span></div>
                <div><span className="text-muted-foreground">Type:</span> {data.job_type}</div>
                <div>
                  <span className="text-muted-foreground">Status:</span>{' '}
                  <Badge variant={STATUS_COLORS[data.status] ?? 'secondary'} className="text-xs">{data.status}</Badge>
                </div>
                <div><span className="text-muted-foreground">Progress:</span> {data.progress}%</div>
                <div><span className="text-muted-foreground">File:</span> {data.source_file_name ?? '-'}</div>
                <div><span className="text-muted-foreground">File Type:</span> {data.source_file_type ?? '-'}</div>
                <div><span className="text-muted-foreground">Rows:</span> {data.source_row_count ?? '-'}</div>
                <div><span className="text-muted-foreground">Created:</span> {format(parseISO(data.created_at), 'MMM d, yyyy HH:mm:ss')}</div>
                {data.started_at && <div><span className="text-muted-foreground">Started:</span> {format(parseISO(data.started_at), 'MMM d HH:mm:ss')}</div>}
                {data.completed_at && <div><span className="text-muted-foreground">Completed:</span> {format(parseISO(data.completed_at), 'MMM d HH:mm:ss')}</div>}
              </div>
            </section>

            {/* Conversation Flow */}
            <section>
              <h4 className="mb-2 text-sm font-semibold text-muted-foreground">Conversation Flow</h4>
              <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
                <div><span className="text-muted-foreground">Purpose:</span> {formatPurpose(data.purpose)}</div>
                <div><span className="text-muted-foreground">Co-sell:</span> {data.is_cosell ? 'Yes' : 'No'}</div>
                {data.is_cosell && data.cosell_provider && (
                  <div><span className="text-muted-foreground">Cloud Provider:</span> {data.cosell_provider}</div>
                )}
                <div><span className="text-muted-foreground">List Owner:</span> {data.list_owner ?? '-'}</div>
              </div>
              {data.additional_context && (
                <div className="mt-2 text-sm">
                  <span className="text-muted-foreground">Additional Context:</span>
                  <p className="mt-1 rounded bg-muted p-2 text-xs">{data.additional_context}</p>
                </div>
              )}
              {data.enrich_instruction && (
                <div className="mt-2 text-sm">
                  <span className="text-muted-foreground">Enrich Instruction:</span>
                  <p className="mt-1 rounded bg-muted p-2 text-xs">{data.enrich_instruction}</p>
                </div>
              )}
              {data.parsed_intent && Object.keys(data.parsed_intent).length > 0 && (
                <div className="mt-2 text-sm">
                  <span className="text-muted-foreground">Parsed Intent:</span>
                  <pre className="mt-1 max-h-24 overflow-auto rounded bg-muted p-2 text-xs">
                    {JSON.stringify(data.parsed_intent, null, 2)}
                  </pre>
                </div>
              )}
            </section>

            {/* Slack Context */}
            <section>
              <h4 className="mb-2 text-sm font-semibold text-muted-foreground">Slack Context</h4>
              <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
                <div><span className="text-muted-foreground">User:</span> {data.slack_user_id}</div>
                <div><span className="text-muted-foreground">Channel:</span> {data.slack_channel_name ?? data.slack_channel_id}</div>
                <div><span className="text-muted-foreground">Team:</span> {data.slack_team_id}</div>
                <div><span className="text-muted-foreground">Thread:</span> <span className="font-mono text-xs">{data.slack_thread_ts}</span></div>
              </div>
            </section>

            {/* Processing Results */}
            <section>
              <h4 className="mb-2 text-sm font-semibold text-muted-foreground">Results</h4>
              <div className="grid grid-cols-3 gap-x-6 gap-y-2 text-sm">
                <div><span className="text-muted-foreground">Companies Processed:</span> {data.companies_processed}</div>
                <div><span className="text-muted-foreground">Companies Failed:</span> {data.companies_failed}</div>
                <div><span className="text-muted-foreground">Contacts Found:</span> {data.contacts_found}</div>
              </div>
              {data.error_message && (
                <div className="mt-2 text-sm">
                  <span className="text-muted-foreground">Error:</span>
                  <p className="mt-1 rounded bg-destructive/10 p-2 text-xs text-destructive">{data.error_message}</p>
                </div>
              )}
            </section>

            {/* Persona Breakdown */}
            {data.persona_summary.length > 0 && (
              <section>
                <h4 className="mb-2 text-sm font-semibold text-muted-foreground">
                  Persona Breakdown ({data.total_contacts} contacts, {data.decision_maker_count} decision makers)
                </h4>
                <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
                  {data.persona_summary.map((p) => (
                    <div key={p.persona_type} className="flex justify-between">
                      <span>{formatPersona(p.persona_type)}</span>
                      <span className="font-medium">{p.count}</span>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* API Cost */}
            <section>
              <h4 className="mb-2 text-sm font-semibold text-muted-foreground">API Cost</h4>
              <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
                <div><span className="text-muted-foreground">Total Cost:</span> {formatCurrency(parseFloat(data.api_cost.total_cost_usd))}</div>
                <div><span className="text-muted-foreground">API Calls:</span> {data.api_cost.log_count}</div>
                <div><span className="text-muted-foreground">Tokens In:</span> {formatNumber(data.api_cost.total_tokens_input)}</div>
                <div><span className="text-muted-foreground">Tokens Out:</span> {formatNumber(data.api_cost.total_tokens_output)}</div>
              </div>
            </section>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
