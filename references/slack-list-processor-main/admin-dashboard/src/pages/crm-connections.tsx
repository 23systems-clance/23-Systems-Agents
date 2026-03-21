/**
 * CRM Connections page.
 *
 * Lists all CRM connections with status badges, client name, CRM type,
 * field mapping count, and actions. Allows viewing field mappings and
 * disconnecting connections.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { Plug2, Settings2, Trash2, Zap } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { listConnections, deleteConnection, type CrmConnection } from '@/services/crm';
import { queryKeys } from '@/lib/query-keys';

const statusColors: Record<string, string> = {
  ACTIVE: 'bg-green-100 text-green-800',
  DISCONNECTED: 'bg-gray-100 text-gray-600',
  TOKEN_EXPIRED: 'bg-yellow-100 text-yellow-800',
  ERROR: 'bg-red-100 text-red-800',
};

const crmTypeLabels: Record<string, string> = {
  HUBSPOT: 'HubSpot',
  ATTIO: 'Attio',
  SALESFORCE: 'Salesforce',
};

export default function CrmConnectionsPage() {
  const queryClient = useQueryClient();

  const { data: connections = [], isLoading } = useQuery({
    queryKey: queryKeys.crm.connections(),
    queryFn: () => listConnections(),
  });

  const disconnectMutation = useMutation({
    mutationFn: deleteConnection,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['crm', 'connections'] });
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-4 p-6">
        <div className="h-8 w-48 animate-pulse rounded bg-muted" />
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-48 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-6 p-6"
    >
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">CRM Connections</h1>
          <p className="text-sm text-muted-foreground">
            Manage CRM integrations and field mappings
          </p>
        </div>
      </div>

      {connections.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Plug2 className="h-12 w-12 text-muted-foreground/50 mb-4" />
            <p className="text-muted-foreground">No CRM connections found.</p>
            <p className="text-sm text-muted-foreground">
              Connect a CRM via the HubSpot OAuth flow in Slack.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {connections.map((conn) => (
            <CrmConnectionCard
              key={conn.id}
              connection={conn}
              onDisconnect={() => disconnectMutation.mutate(conn.id)}
              isDisconnecting={disconnectMutation.isPending}
            />
          ))}
        </div>
      )}
    </motion.div>
  );
}

function CrmConnectionCard({
  connection,
  onDisconnect,
  isDisconnecting,
}: {
  connection: CrmConnection;
  onDisconnect: () => void;
  isDisconnecting: boolean;
}) {
  const mappingCount = connection._count?.fieldMappings ?? 0;
  const pushCount = connection._count?.pushRecords ?? 0;

  return (
    <Card className="relative overflow-hidden">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Zap className="h-5 w-5 text-orange-500" />
            <CardTitle className="text-base">
              {crmTypeLabels[connection.crmType] || connection.crmType}
            </CardTitle>
          </div>
          <Badge className={statusColors[connection.status] || 'bg-gray-100'}>
            {connection.status}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Client</span>
            <span className="font-medium">{connection.client?.name || 'Unknown'}</span>
          </div>
          {connection.displayName && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Portal</span>
              <span className="font-medium">{connection.displayName}</span>
            </div>
          )}
          <div className="flex justify-between">
            <span className="text-muted-foreground">Field Mappings</span>
            <span className="font-medium">{mappingCount}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Push Records</span>
            <span className="font-medium">{pushCount.toLocaleString()}</span>
          </div>
        </div>

        <div className="flex gap-2 pt-2">
          <Button variant="outline" size="sm" className="flex-1" asChild>
            <Link to={`/crm/connections/${connection.id}/mappings`}>
              <Settings2 className="mr-1.5 h-3.5 w-3.5" />
              Mappings
            </Link>
          </Button>

          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="text-destructive hover:text-destructive"
                disabled={connection.status === 'DISCONNECTED'}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Disconnect CRM?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will mark the {crmTypeLabels[connection.crmType]} connection for{' '}
                  {connection.client?.name} as disconnected. Existing push records will be preserved.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={onDisconnect}
                  disabled={isDisconnecting}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  Disconnect
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </CardContent>
    </Card>
  );
}
