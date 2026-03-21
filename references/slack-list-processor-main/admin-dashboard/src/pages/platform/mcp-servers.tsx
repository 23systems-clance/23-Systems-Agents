/**
 * MCP Servers list page (T027 - Feature 39).
 *
 * Table of registered MCP servers with status filter, health info, and actions.
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Server, Plus } from 'lucide-react';
import { listMcpServers, type McpServerSummary } from '@/services/platform/mcpServers';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { PageSkeleton } from '@/components/shared/LoadingSkeleton';

const STATUS_COLORS: Record<string, string> = {
  HEALTHY: 'bg-green-500/10 text-green-600 border-green-500/20',
  ERROR: 'bg-red-500/10 text-red-600 border-red-500/20',
  UNKNOWN: 'bg-gray-500/10 text-gray-600 border-gray-500/20',
};

export default function McpServersPage() {
  const navigate = useNavigate();
  const [statusFilter, setStatusFilter] = useState<string>('all');

  const { data, isLoading } = useQuery({
    queryKey: ['mcp-servers', statusFilter],
    queryFn: () => listMcpServers(statusFilter === 'all' ? undefined : statusFilter),
  });

  if (isLoading) return <PageSkeleton />;

  const servers = data?.servers ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Server className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
          <div>
            <h1 className="text-2xl font-bold">MCP Servers</h1>
            <p className="text-sm text-muted-foreground">
              {servers.length} server{servers.length !== 1 ? 's' : ''} registered
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-36">
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="HEALTHY">Healthy</SelectItem>
              <SelectItem value="ERROR">Error</SelectItem>
              <SelectItem value="UNKNOWN">Unknown</SelectItem>
            </SelectContent>
          </Select>
          <Button onClick={() => navigate('/platform/mcp-servers/new')}>
            <Plus className="mr-2 h-4 w-4" />
            New Server
          </Button>
        </div>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Provider</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>BYOK</TableHead>
              <TableHead className="text-right">Tools</TableHead>
              <TableHead>Last Check</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {servers.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                  No MCP servers found. Register your first server to get started.
                </TableCell>
              </TableRow>
            ) : (
              servers.map((server: McpServerSummary) => (
                <TableRow
                  key={server.id}
                  className="cursor-pointer hover:bg-muted/50"
                  tabIndex={0}
                  role="link"
                  aria-label={`Server: ${server.name}`}
                  onClick={() => navigate(`/platform/mcp-servers/${server.id}`)}
                  onKeyDown={(e) => { if (e.key === 'Enter') navigate(`/platform/mcp-servers/${server.id}`); }}
                >
                  <TableCell>
                    <div>
                      <p className="font-medium">{server.name}</p>
                      <p className="text-xs text-muted-foreground">{server.slug}</p>
                    </div>
                  </TableCell>
                  <TableCell className="text-sm">{server.provider}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={STATUS_COLORS[server.status] ?? ''}>
                      {server.status}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {server.byokEnabled ? (
                      <Badge variant="outline" className="bg-blue-500/10 text-blue-600 border-blue-500/20">
                        Enabled
                      </Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">Off</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right text-sm">{server.toolCount}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {server.lastHealthCheck
                      ? new Date(server.lastHealthCheck).toLocaleString()
                      : 'Never'}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
