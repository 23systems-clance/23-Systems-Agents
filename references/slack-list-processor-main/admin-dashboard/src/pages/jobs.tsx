import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { format, parseISO } from 'date-fns';
import { queryKeys } from '@/lib/query-keys';
import { formatCurrency, formatNumber } from '@/lib/utils';
import { fetchJobs, fetchJobDetail } from '@/services/jobs';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { PageSkeleton } from '@/components/shared/LoadingSkeleton';
import type { JobDetail, JobListEntry } from '@/types/api';

const STATUS_COLORS: Record<string, 'default' | 'secondary' | 'destructive'> = {
  COMPLETED: 'default',
  PROCESSING: 'secondary',
  PENDING: 'secondary',
  AWAITING_PHONES: 'secondary',
  FAILED: 'destructive',
  CANCELLED: 'destructive',
};

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

function formatPersona(persona: string): string {
  return persona
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace('Ceo', 'CEO')
    .replace('Hr ', 'HR ')
    .replace('It ', 'IT ');
}

export default function JobsPage() {
  const [offset, setOffset] = useState(0);
  const limit = 20;
  const [statusFilter, setStatusFilter] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);

  const filterParams: Record<string, string> = {
    offset: String(offset),
    limit: String(limit),
  };
  if (statusFilter !== 'all') filterParams.status = statusFilter;
  if (typeFilter !== 'all') filterParams.job_type = typeFilter;

  const jobsQuery = useQuery({
    queryKey: queryKeys.jobs.list(filterParams),
    queryFn: () => fetchJobs(filterParams),
  });

  const jobDetailQuery = useQuery({
    queryKey: queryKeys.jobs.detail(selectedJobId ?? ''),
    queryFn: () => fetchJobDetail(selectedJobId!),
    enabled: !!selectedJobId,
  });

  const totalJobs = jobsQuery.data?.total ?? 0;
  const currentPage = Math.floor(offset / limit) + 1;
  const totalPages = Math.ceil(totalJobs / limit) || 1;

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Jobs</h2>
        <div className="flex items-center gap-3">
          <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setOffset(0); }}>
            <SelectTrigger className="w-[150px]">
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="PENDING">Pending</SelectItem>
              <SelectItem value="PROCESSING">Processing</SelectItem>
              <SelectItem value="AWAITING_PHONES">Awaiting Phones</SelectItem>
              <SelectItem value="COMPLETED">Completed</SelectItem>
              <SelectItem value="FAILED">Failed</SelectItem>
              <SelectItem value="CANCELLED">Cancelled</SelectItem>
            </SelectContent>
          </Select>
          <Select value={typeFilter} onValueChange={(v) => { setTypeFilter(v); setOffset(0); }}>
            <SelectTrigger className="w-[150px]">
              <SelectValue placeholder="All types" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              <SelectItem value="TECHNOGRAPHIC">Technographic</SelectItem>
              <SelectItem value="CONTACT">Contact</SelectItem>
              <SelectItem value="COMBINED">Combined</SelectItem>
              <SelectItem value="TECH_REPORT">Tech Report</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          {jobsQuery.isLoading ? (
            <PageSkeleton />
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="px-3 py-3 text-left font-medium text-muted-foreground">ID</th>
                      <th className="px-3 py-3 text-left font-medium text-muted-foreground">Type</th>
                      <th className="px-3 py-3 text-left font-medium text-muted-foreground">Status</th>
                      <th className="px-3 py-3 text-left font-medium text-muted-foreground">File</th>
                      <th className="px-3 py-3 text-right font-medium text-muted-foreground">Rows</th>
                      <th className="px-3 py-3 text-left font-medium text-muted-foreground">Purpose</th>
                      <th className="px-3 py-3 text-left font-medium text-muted-foreground">Co-sell</th>
                      <th className="px-3 py-3 text-left font-medium text-muted-foreground">Owner</th>
                      <th className="px-3 py-3 text-left font-medium text-muted-foreground">Channel</th>
                      <th className="px-3 py-3 text-left font-medium text-muted-foreground">Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(jobsQuery.data?.jobs ?? []).map((j: JobListEntry) => (
                      <tr
                        key={j.id}
                        className="cursor-pointer border-b hover:bg-muted/50"
                        onClick={() => setSelectedJobId(j.id)}
                      >
                        <td className="px-3 py-3 font-mono text-xs">{j.id.slice(0, 8)}</td>
                        <td className="px-3 py-3">{j.job_type}</td>
                        <td className="px-3 py-3">
                          <Badge variant={STATUS_COLORS[j.status] ?? 'secondary'} className="text-xs">
                            {j.status}
                          </Badge>
                        </td>
                        <td className="max-w-[150px] truncate px-3 py-3">{j.source_file_name ?? '-'}</td>
                        <td className="px-3 py-3 text-right">{j.source_row_count ?? '-'}</td>
                        <td className="px-3 py-3">{formatPurpose(j.purpose)}</td>
                        <td className="px-3 py-3">
                          {j.is_cosell ? (
                            <Badge variant="secondary" className="text-xs">
                              {j.cosell_provider ?? 'Yes'}
                            </Badge>
                          ) : (
                            <span className="text-muted-foreground">No</span>
                          )}
                        </td>
                        <td className="max-w-[100px] truncate px-3 py-3">{j.list_owner ?? '-'}</td>
                        <td className="px-3 py-3">{j.slack_channel_name ?? '-'}</td>
                        <td className="px-3 py-3">{format(parseISO(j.created_at), 'MMM d HH:mm')}</td>
                      </tr>
                    ))}
                    {(jobsQuery.data?.jobs ?? []).length === 0 && (
                      <tr>
                        <td colSpan={10} className="py-8 text-center text-muted-foreground">
                          No jobs found
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>

              <div className="flex items-center justify-between p-4">
                <p className="text-sm text-muted-foreground">
                  Page {currentPage} of {totalPages} ({totalJobs} total)
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
                    disabled={offset + limit >= totalJobs}
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

      {/* Job Detail Dialog */}
      <Dialog open={!!selectedJobId} onOpenChange={() => setSelectedJobId(null)}>
        <DialogContent className="max-h-[85vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Job Details</DialogTitle>
            <DialogDescription>Full conversation flow and processing details</DialogDescription>
          </DialogHeader>
          {jobDetailQuery.isLoading ? (
            <PageSkeleton />
          ) : jobDetailQuery.data ? (
            <JobDetailContent data={jobDetailQuery.data} />
          ) : null}
        </DialogContent>
      </Dialog>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Job Detail Content (shared layout)
// ---------------------------------------------------------------------------

function JobDetailContent({ data }: { data: JobDetail }) {
  return (
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

      {/* Quality Gate Results */}
      {data.quality_gate_result && (
        <section>
          <h4 className="mb-2 text-sm font-semibold text-muted-foreground">Quality Gate</h4>
          <div className="grid grid-cols-3 gap-x-6 gap-y-2 text-sm">
            <div><span className="text-muted-foreground">Total Rows:</span> {data.quality_gate_result.totalRows}</div>
            <div><span className="text-muted-foreground">Passed:</span> {data.quality_gate_result.passedRows}</div>
            <div><span className="text-muted-foreground">Filtered:</span> {data.quality_gate_result.filteredRows}</div>
            {data.quality_gate_result.uniqueDomains > 0 && (
              <div><span className="text-muted-foreground">Unique Domains:</span> {data.quality_gate_result.uniqueDomains}</div>
            )}
            <div><span className="text-muted-foreground">Processing:</span> {data.quality_gate_result.processingTimeMs}ms</div>
          </div>
          {data.quality_gate_result.filteredRows > 0 && (
            <div className="mt-2 text-sm">
              <span className="text-muted-foreground">Filter Breakdown:</span>
              <div className="mt-1 grid grid-cols-2 gap-x-6 gap-y-1 text-xs">
                {data.quality_gate_result.filterBreakdown.personalEmail > 0 && (
                  <div>Personal emails: {data.quality_gate_result.filterBreakdown.personalEmail}</div>
                )}
                {data.quality_gate_result.filterBreakdown.missingCompany > 0 && (
                  <div>Missing company: {data.quality_gate_result.filterBreakdown.missingCompany}</div>
                )}
                {data.quality_gate_result.filterBreakdown.suppressionDomain > 0 && (
                  <div>Suppression matches: {data.quality_gate_result.filterBreakdown.suppressionDomain}</div>
                )}
                {data.quality_gate_result.filterBreakdown.duplicateEmail > 0 && (
                  <div>Duplicate emails: {data.quality_gate_result.filterBreakdown.duplicateEmail}</div>
                )}
              </div>
            </div>
          )}
          {data.quality_gate_result.filteredFileUrl && (
            <div className="mt-2">
              <a
                href={data.quality_gate_result.filteredFileUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-primary underline"
              >
                Download filtered rows CSV
              </a>
            </div>
          )}
        </section>
      )}

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
  );
}
