/**
 * HubSpot connection card for the client detail page.
 *
 * Shows either a setup guide (when not connected) or full connection
 * details with stats, recent imports, and sync logs (when connected).
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { format, parseISO } from 'date-fns';
import {
  CheckCircle2, AlertTriangle, ExternalLink, Unplug,
  MessageSquare, ShieldCheck, Upload, BarChart3, RefreshCw,
} from 'lucide-react';
import { queryKeys } from '@/lib/query-keys';
import { fetchClientHubspot, disconnectClientHubspot } from '@/services/managed-clients';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import type { HubSpotClientResponse, HubSpotImportJobSummary } from '@/types/api';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface HubSpotConnectionCardProps {
  clientId: string;
  hasChannels: boolean;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function HubSpotConnectionCard({ clientId, hasChannels }: HubSpotConnectionCardProps) {
  const queryClient = useQueryClient();
  const [showDisconnect, setShowDisconnect] = useState(false);

  const hubspotQuery = useQuery({
    queryKey: queryKeys.managedClients.hubspot(clientId),
    queryFn: () => fetchClientHubspot(clientId),
  });

  const disconnectMutation = useMutation({
    mutationFn: () => disconnectClientHubspot(clientId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.managedClients.hubspot(clientId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.managedClients.detail(clientId) });
      setShowDisconnect(false);
    },
  });

  if (hubspotQuery.isLoading) {
    return (
      <Card>
        <CardHeader><CardTitle className="text-base">HubSpot Integration</CardTitle></CardHeader>
        <CardContent>
          <div className="animate-pulse space-y-3">
            <div className="h-4 w-3/4 rounded bg-muted" />
            <div className="h-4 w-1/2 rounded bg-muted" />
          </div>
        </CardContent>
      </Card>
    );
  }

  const data: HubSpotClientResponse | undefined = hubspotQuery.data;

  if (!data || !data.connected) {
    return <SetupGuide hasChannels={hasChannels} />;
  }

  const { connection, recentImports, recentSyncLogs } = data;

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CardTitle className="text-base">HubSpot Integration</CardTitle>
              <StatusBadge status={connection.status} />
            </div>
            <Button
              size="sm"
              variant="outline"
              className="text-destructive"
              onClick={() => setShowDisconnect(true)}
            >
              <Unplug className="mr-1 h-3 w-3" /> Disconnect
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Connection info */}
          <div className="grid grid-cols-1 gap-x-8 gap-y-2 text-sm md:grid-cols-2">
            <div>
              <span className="text-muted-foreground">Portal:</span>{' '}
              {connection.hubspotPortalName || connection.hubspotPortalId}{' '}
              <span className="text-muted-foreground text-xs">(ID: {connection.hubspotPortalId})</span>
            </div>
            <div>
              <span className="text-muted-foreground">Connected by:</span>{' '}
              <code className="text-xs">{connection.connectedBy}</code>
            </div>
            <div>
              <span className="text-muted-foreground">Connected:</span>{' '}
              {formatDate(connection.connectedAt)}
            </div>
            <div>
              <span className="text-muted-foreground">Last token refresh:</span>{' '}
              {connection.lastRefreshedAt ? formatDate(connection.lastRefreshedAt) : 'Never'}
            </div>
            {connection.grantedScopes.length > 0 && (
              <div className="col-span-full">
                <span className="text-muted-foreground">Scopes:</span>{' '}
                <span className="text-xs">{connection.grantedScopes.join(', ')}</span>
              </div>
            )}
          </div>

          {/* Stats */}
          <div className="grid grid-cols-3 gap-3">
            <StatBox
              icon={<Upload className="h-4 w-4 text-blue-500" />}
              label="Contacts synced"
              value={connection.totalContactsSynced.toLocaleString()}
            />
            <StatBox
              icon={<BarChart3 className="h-4 w-4 text-green-500" />}
              label="Activities logged"
              value={connection.totalActivitiesLogged.toLocaleString()}
            />
            <StatBox
              icon={<AlertTriangle className="h-4 w-4 text-rose-500" />}
              label="Sync failures"
              value={connection.totalSyncFailures.toLocaleString()}
              danger={connection.totalSyncFailures > 0}
            />
          </div>

          {/* Recent imports */}
          {recentImports.length > 0 && (
            <div>
              <h4 className="mb-2 text-sm font-medium">Recent Imports</h4>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="px-2 py-1 text-left font-medium text-muted-foreground">List</th>
                    <th className="px-2 py-1 text-left font-medium text-muted-foreground">Status</th>
                    <th className="px-2 py-1 text-right font-medium text-muted-foreground">Created</th>
                    <th className="px-2 py-1 text-right font-medium text-muted-foreground">Updated</th>
                    <th className="px-2 py-1 text-right font-medium text-muted-foreground">Failed</th>
                    <th className="px-2 py-1 text-right font-medium text-muted-foreground">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {recentImports.map((job) => (
                    <tr key={job.id} className="border-b">
                      <td className="px-2 py-2">
                        {job.hubspotListUrl ? (
                          <a
                            href={job.hubspotListUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-blue-600 hover:underline"
                          >
                            {job.listName}
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        ) : (
                          job.listName
                        )}
                      </td>
                      <td className="px-2 py-2"><ImportStatusBadge status={job.status} /></td>
                      <td className="px-2 py-2 text-right">{job.contactsCreated}</td>
                      <td className="px-2 py-2 text-right">{job.contactsUpdated}</td>
                      <td className="px-2 py-2 text-right">{job.contactsFailed}</td>
                      <td className="px-2 py-2 text-right text-muted-foreground">{formatDate(job.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Recent sync logs */}
          {recentSyncLogs.length > 0 && (
            <div>
              <h4 className="mb-2 text-sm font-medium">Recent Sync Logs</h4>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="px-2 py-1 text-left font-medium text-muted-foreground">Type</th>
                    <th className="px-2 py-1 text-left font-medium text-muted-foreground">Direction</th>
                    <th className="px-2 py-1 text-right font-medium text-muted-foreground">Processed</th>
                    <th className="px-2 py-1 text-right font-medium text-muted-foreground">Created</th>
                    <th className="px-2 py-1 text-right font-medium text-muted-foreground">Failed</th>
                    <th className="px-2 py-1 text-right font-medium text-muted-foreground">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {recentSyncLogs.map((log) => (
                    <tr key={log.id} className="border-b">
                      <td className="px-2 py-2 font-mono text-xs">{log.syncType}</td>
                      <td className="px-2 py-2">
                        <Badge variant="outline" className="text-xs">{log.direction}</Badge>
                      </td>
                      <td className="px-2 py-2 text-right">{log.recordsProcessed}</td>
                      <td className="px-2 py-2 text-right">{log.recordsCreated}</td>
                      <td className="px-2 py-2 text-right">{log.recordsFailed}</td>
                      <td className="px-2 py-2 text-right text-muted-foreground">{formatDate(log.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Disconnect confirmation */}
      <AlertDialog open={showDisconnect} onOpenChange={setShowDisconnect}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Disconnect HubSpot?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the connection, all import job history,
              contact mappings, and sync logs for this client. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => disconnectMutation.mutate()}
              disabled={disconnectMutation.isPending}
            >
              {disconnectMutation.isPending ? 'Disconnecting...' : 'Disconnect'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// ---------------------------------------------------------------------------
// Setup guide (not connected)
// ---------------------------------------------------------------------------

function SetupGuide({ hasChannels }: { hasChannels: boolean }) {
  const steps = [
    {
      icon: hasChannels
        ? <CheckCircle2 className="h-5 w-5 text-green-500" />
        : <AlertTriangle className="h-5 w-5 text-amber-500" />,
      title: 'Map a Slack channel',
      description: hasChannels
        ? 'This client has at least one mapped channel.'
        : 'Associate a Slack channel to this client first (see Associated Channels below).',
    },
    {
      icon: <MessageSquare className="h-5 w-5 text-muted-foreground" />,
      title: 'Run /hubspot connect',
      description: "Have the user run /hubspot connect in the client's mapped Slack channel.",
    },
    {
      icon: <ShieldCheck className="h-5 w-5 text-muted-foreground" />,
      title: 'Authorize in HubSpot',
      description: 'The user clicks the authorization link and approves access in their HubSpot portal.',
    },
    {
      icon: <RefreshCw className="h-5 w-5 text-muted-foreground" />,
      title: 'Verify connection',
      description: 'Run /hubspot status in Slack to confirm the connection is active.',
    },
    {
      icon: <Upload className="h-5 w-5 text-muted-foreground" />,
      title: 'Import contacts',
      description: 'Use /hubspot import after an enrichment job to push contacts to HubSpot.',
    },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">HubSpot Integration</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="mb-4 text-sm text-muted-foreground">
          HubSpot is not connected for this client. Follow these steps to set it up:
        </p>
        <ol className="space-y-4">
          {steps.map((step, i) => (
            <li key={i} className="flex items-start gap-3">
              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">
                {i + 1}
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  {step.icon}
                  <span className="text-sm font-medium">{step.title}</span>
                </div>
                <p className="mt-0.5 text-sm text-muted-foreground">{step.description}</p>
              </div>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case 'ACTIVE':
      return <Badge className="bg-green-100 text-green-800">Connected</Badge>;
    case 'TOKEN_EXPIRED':
      return <Badge className="bg-amber-100 text-amber-800">Token Expired</Badge>;
    case 'DISCONNECTED':
      return <Badge variant="secondary">Disconnected</Badge>;
    default:
      return <Badge variant="destructive">Error</Badge>;
  }
}

function ImportStatusBadge({ status }: { status: HubSpotImportJobSummary['status'] }) {
  switch (status) {
    case 'COMPLETED':
      return <Badge className="bg-green-100 text-green-800 text-xs">Completed</Badge>;
    case 'PROCESSING':
      return <Badge className="bg-blue-100 text-blue-800 text-xs">Processing</Badge>;
    case 'PENDING':
      return <Badge variant="secondary" className="text-xs">Pending</Badge>;
    case 'FAILED':
      return <Badge variant="destructive" className="text-xs">Failed</Badge>;
    case 'CANCELLED':
      return <Badge variant="secondary" className="text-xs">Cancelled</Badge>;
    default:
      return <Badge variant="secondary" className="text-xs">{status}</Badge>;
  }
}

function StatBox({
  icon, label, value, danger,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  danger?: boolean;
}) {
  return (
    <div className="rounded-lg border p-3">
      <div className="flex items-center gap-2">
        {icon}
        <span className="text-xs text-muted-foreground">{label}</span>
      </div>
      <p className={`mt-1 text-lg font-semibold ${danger ? 'text-rose-600' : ''}`}>{value}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(iso: string): string {
  try {
    return format(parseISO(iso), 'MMM d, yyyy');
  } catch {
    return iso;
  }
}
