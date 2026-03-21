import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { MoreHorizontal, Plus, Workflow, AlertCircle, Building2 } from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
import { TemplateLibrary } from '@/components/workflow/TemplateLibrary';
import {
  useWorkflows,
  useCloneWorkflow,
  useArchiveWorkflow,
  useDeleteWorkflow,
} from '@/services/workflows';
import { PageSkeleton } from '@/components/shared/LoadingSkeleton';
import { fetchManagedClients } from '@/services/managed-clients';
import { queryKeys } from '@/lib/query-keys';
import type { WorkflowListItem } from '@/types/api';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Hardcoded IDs until auth context is available. */
const TEAM_ID = 'T_DEFAULT';
const USER_ID = 'admin';

/** Status filter tabs. */
type StatusFilter = 'all' | 'active' | 'draft' | 'archived';

/** Confirmation dialog types. */
type ConfirmAction = 'archive' | 'delete';

/** Relative time formatter. */
const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Derives a display status from a WorkflowListItem.
 * - Active: is_active AND has a PUBLISHED current_version
 * - Draft: only has a DRAFT version (no published)
 * - Archived: is_active is false
 */
function deriveStatus(wf: WorkflowListItem): 'Active' | 'Draft' | 'Archived' {
  if (!wf.is_active) return 'Archived';
  if (wf.current_version?.status === 'PUBLISHED') return 'Active';
  return 'Draft';
}

/**
 * Returns explicit Tailwind classes for each status badge.
 * Uses full class names (no interpolation) so Tailwind v4 JIT can detect them.
 */
function statusBadgeClasses(status: 'Active' | 'Draft' | 'Archived'): string {
  switch (status) {
    case 'Active':
      return 'bg-green-100 text-green-800 border-green-200';
    case 'Draft':
      return 'bg-yellow-100 text-yellow-800 border-yellow-200';
    case 'Archived':
      return 'bg-gray-100 text-gray-600 border-gray-200';
  }
}

/**
 * Formats a date string as a relative time description (e.g. "2 days ago").
 */
function formatRelativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffSeconds = Math.round((then - now) / 1000);
  const absDiff = Math.abs(diffSeconds);

  if (absDiff < 60) return rtf.format(diffSeconds, 'second');
  if (absDiff < 3600) return rtf.format(Math.round(diffSeconds / 60), 'minute');
  if (absDiff < 86400) return rtf.format(Math.round(diffSeconds / 3600), 'hour');
  if (absDiff < 2592000) return rtf.format(Math.round(diffSeconds / 86400), 'day');
  return rtf.format(Math.round(diffSeconds / 2592000), 'month');
}

/**
 * Returns the display version number from a workflow.
 * Prefers the current (published) version, falls back to draft.
 */
function displayVersion(wf: WorkflowListItem): string {
  const ver = wf.current_version ?? wf.draft_version;
  return ver ? `v${ver.version}` : '--';
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * Workflow list page.
 * Displays all workflows in a data table with status filter tabs,
 * row actions (Edit, Clone, Archive, Delete), and a "New Workflow" button
 * that opens the TemplateLibrary dialog.
 */
export default function WorkflowsPage() {
  const navigate = useNavigate();

  // Filter state
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [clientFilter, setClientFilter] = useState<string>('all');

  // Template library dialog state
  const [templateOpen, setTemplateOpen] = useState(false);

  // Confirmation dialog state
  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean;
    action: ConfirmAction;
    workflowId: string;
    workflowName: string;
  }>({ open: false, action: 'archive', workflowId: '', workflowName: '' });

  // Build query params from the filter tabs
  const queryParams = useMemo(() => {
    const params: Record<string, string> = { teamId: TEAM_ID };
    if (statusFilter !== 'all') params.status = statusFilter;
    if (clientFilter === '__none__') params.clientId = 'null';
    else if (clientFilter !== 'all') params.clientId = clientFilter;
    return params;
  }, [statusFilter, clientFilter]);

  // Data fetching
  const { data, isLoading, isError } = useWorkflows(queryParams);
  const { data: clientsData } = useQuery({
    queryKey: queryKeys.managedClients.list(),
    queryFn: () => fetchManagedClients(),
  });
  const cloneWorkflow = useCloneWorkflow();
  const archiveWorkflow = useArchiveWorkflow();
  const deleteWorkflow = useDeleteWorkflow();

  const workflows = data?.workflows ?? [];

  // -------------------------------------------------------------------
  // Handlers
  // -------------------------------------------------------------------

  /** Navigate to the workflow builder for editing. */
  function handleEdit(workflowId: string) {
    navigate(`/workflows/${workflowId}/edit`);
  }

  /** Clone a workflow and navigate to the new one's builder. */
  async function handleClone(workflowId: string) {
    try {
      const cloned = await cloneWorkflow.mutateAsync({
        workflowId,
        teamId: TEAM_ID,
        userId: USER_ID,
      });
      navigate(`/workflows/${cloned.id}/edit`);
    } catch {
      // Mutation error is handled by TanStack Query
    }
  }

  /** Open confirmation dialog for archive or delete. */
  function handleConfirmOpen(action: ConfirmAction, wf: WorkflowListItem) {
    setConfirmDialog({
      open: true,
      action,
      workflowId: wf.id,
      workflowName: wf.name,
    });
  }

  /** Execute the confirmed action (archive or delete). */
  async function handleConfirmExecute() {
    const { action, workflowId } = confirmDialog;
    try {
      if (action === 'archive') {
        await archiveWorkflow.mutateAsync(workflowId);
      } else {
        await deleteWorkflow.mutateAsync(workflowId);
      }
    } catch {
      // Mutation error is handled by TanStack Query
    } finally {
      setConfirmDialog((prev) => ({ ...prev, open: false }));
    }
  }

  /** Called when a workflow is created from the TemplateLibrary. */
  function handleTemplateSelect(workflowId: string) {
    navigate(`/workflows/${workflowId}/edit`);
  }

  // -------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------

  if (isLoading) return <PageSkeleton />;

  if (isError) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold">Workflows</h1>
        <div className="flex flex-col items-center justify-center gap-2 py-16 text-destructive">
          <AlertCircle className="h-8 w-8" />
          <p className="text-sm">Failed to load workflows. Please try again.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Workflows</h1>
        <Button onClick={() => setTemplateOpen(true)}>
          <Plus className="mr-1 h-4 w-4" />
          New Workflow
        </Button>
      </div>

      {/* Filters: status tabs + client dropdown */}
      <div className="flex items-center gap-4">
        <Tabs
          value={statusFilter}
          onValueChange={(value) => setStatusFilter(value as StatusFilter)}
        >
          <TabsList>
            <TabsTrigger value="all">All</TabsTrigger>
            <TabsTrigger value="active">Active</TabsTrigger>
            <TabsTrigger value="draft">Draft</TabsTrigger>
            <TabsTrigger value="archived">Archived</TabsTrigger>
          </TabsList>
        </Tabs>

        <Select value={clientFilter} onValueChange={setClientFilter}>
          <SelectTrigger className="h-8 w-48">
            <Building2 className="mr-1.5 h-3.5 w-3.5 text-muted-foreground" />
            <SelectValue placeholder="All clients" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All clients</SelectItem>
            <SelectItem value="__none__">
              <span className="text-muted-foreground">Team default (no client)</span>
            </SelectItem>
            {(clientsData?.clients ?? []).map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Workflows table */}
      {workflows.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-4 rounded-lg border border-dashed py-16">
          <Workflow className="h-10 w-10 text-muted-foreground" />
          <div className="text-center">
            <p className="font-medium">No workflows found</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Create your first workflow to automate your processes.
            </p>
          </div>
          <Button variant="outline" onClick={() => setTemplateOpen(true)}>
            <Plus className="mr-1 h-4 w-4" />
            New Workflow
          </Button>
        </div>
      ) : (
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Trigger</TableHead>
                <TableHead>Client</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-center">Version</TableHead>
                <TableHead className="text-right">Total Runs</TableHead>
                <TableHead className="text-right">Completion</TableHead>
                <TableHead>Last Modified</TableHead>
                <TableHead className="w-12" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {workflows.map((wf) => {
                const status = deriveStatus(wf);
                return (
                  <TableRow
                    key={wf.id}
                    className="cursor-pointer"
                    onClick={() => handleEdit(wf.id)}
                  >
                    <TableCell className="font-medium">
                      <div>
                        <span>{wf.name}</span>
                        {wf.description && (
                          <p className="mt-0.5 text-xs text-muted-foreground line-clamp-1">
                            {wf.description}
                          </p>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{wf.trigger_type}</Badge>
                    </TableCell>
                    <TableCell>
                      {wf.client_name ? (
                        <Badge variant="outline">{wf.client_name}</Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">Team default</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge className={statusBadgeClasses(status)}>
                        {status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-center">
                      {displayVersion(wf)}
                    </TableCell>
                    <TableCell className="text-right">
                      {wf.total_runs.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right">
                      {wf.total_runs > 0
                        ? `${Math.round(wf.completion_rate)}%`
                        : '--'}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatRelativeTime(wf.updated_at)}
                    </TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <MoreHorizontal className="h-4 w-4" />
                            <span className="sr-only">Actions</span>
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onClick={(e) => {
                              e.stopPropagation();
                              handleEdit(wf.id);
                            }}
                          >
                            Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={(e) => {
                              e.stopPropagation();
                              handleClone(wf.id);
                            }}
                            disabled={cloneWorkflow.isPending}
                          >
                            Clone
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          {status !== 'Archived' && (
                            <DropdownMenuItem
                              onClick={(e) => {
                                e.stopPropagation();
                                handleConfirmOpen('archive', wf);
                              }}
                            >
                              Archive
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleConfirmOpen('delete', wf);
                            }}
                          >
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Template Library dialog */}
      <TemplateLibrary
        open={templateOpen}
        onOpenChange={setTemplateOpen}
        onSelect={handleTemplateSelect}
        teamId={TEAM_ID}
        userId={USER_ID}
      />

      {/* Archive / Delete confirmation dialog */}
      <AlertDialog
        open={confirmDialog.open}
        onOpenChange={(open) =>
          setConfirmDialog((prev) => ({ ...prev, open }))
        }
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmDialog.action === 'archive'
                ? 'Archive Workflow'
                : 'Delete Workflow'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmDialog.action === 'archive'
                ? `Are you sure you want to archive "${confirmDialog.workflowName}"? Archived workflows can no longer be triggered but their run history is preserved.`
                : `Are you sure you want to permanently delete "${confirmDialog.workflowName}"? This action cannot be undone.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className={
                confirmDialog.action === 'delete'
                  ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90'
                  : ''
              }
              onClick={handleConfirmExecute}
            >
              {confirmDialog.action === 'archive' ? 'Archive' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
