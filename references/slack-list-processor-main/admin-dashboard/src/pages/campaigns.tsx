import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Plus, Search } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { PageSkeleton } from '@/components/shared/LoadingSkeleton';
import { fetchCampaigns } from '@/services/campaigns';
import { fetchManagedClients } from '@/services/managed-clients';
import { useWorkspaceId } from '@/hooks/useWorkspaceId';

const STATUS_COLORS: Record<string, string> = {
  DRAFT: 'bg-gray-100 text-gray-700',
  ACTIVE: 'bg-green-100 text-green-700',
  PAUSED: 'bg-yellow-100 text-yellow-700',
  COMPLETED: 'bg-blue-100 text-blue-700',
  ARCHIVED: 'bg-gray-200 text-gray-600',
};

export default function CampaignsPage() {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [clientFilter, setClientFilter] = useState<string>('');
  const { teamId: slackTeamId, isLoading: teamLoading } = useWorkspaceId();

  const { data: clientsData } = useQuery({
    queryKey: ['admin', 'clients', 'active'],
    queryFn: () => fetchManagedClients({ isActive: 'true' }),
  });

  const clients = clientsData?.clients ?? [];

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'campaigns', slackTeamId, search, statusFilter, clientFilter],
    queryFn: () =>
      fetchCampaigns(slackTeamId!, {
        ...(search && { search }),
        ...(statusFilter && { status: statusFilter }),
        ...(clientFilter && { clientId: clientFilter }),
      }),
    enabled: !!slackTeamId,
  });

  if (teamLoading || isLoading) return <PageSkeleton />;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Campaigns</h1>
        <Link to="/campaigns/create">
          <Button>
            <Plus className="h-4 w-4 mr-1" /> New Campaign
          </Button>
        </Link>
      </div>

      <div className="flex gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search campaigns..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>
        <Select value={statusFilter || 'ALL'} onValueChange={(v) => setStatusFilter(v === 'ALL' ? '' : v)}>
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All statuses</SelectItem>
            <SelectItem value="DRAFT">Draft</SelectItem>
            <SelectItem value="ACTIVE">Active</SelectItem>
            <SelectItem value="PAUSED">Paused</SelectItem>
            <SelectItem value="COMPLETED">Completed</SelectItem>
            <SelectItem value="ARCHIVED">Archived</SelectItem>
          </SelectContent>
        </Select>
        <Select value={clientFilter || 'ALL'} onValueChange={(v) => setClientFilter(v === 'ALL' ? '' : v)}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="All clients" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All clients</SelectItem>
            {clients.map((c) => (
              <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-3">
        {data?.data.map((campaign) => (
          <Link key={campaign.id} to={`/campaigns/${campaign.id}`}>
            <Card className="hover:bg-muted/50 transition-colors cursor-pointer">
              <CardContent className="py-4">
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <p className="font-medium">{campaign.name}</p>
                      <Badge className={STATUS_COLORS[campaign.status] ?? ''}>
                        {campaign.status}
                      </Badge>
                      <Badge variant="outline">{campaign.campaignType}</Badge>
                    </div>
                    {(campaign.description || campaign.client) && (
                      <p className="text-sm text-muted-foreground">
                        {campaign.client && <span className="font-medium">{campaign.client.name}</span>}
                        {campaign.client && campaign.description && ' - '}
                        {campaign.description}
                      </p>
                    )}
                  </div>
                  <div className="text-right text-sm">
                    <p>
                      {campaign.activeContacts} active / {campaign.totalContacts} total
                    </p>
                    <p className="text-muted-foreground">
                      {campaign.sequenceSteps.length} steps, {campaign.bdrs.length} BDR
                      {campaign.bdrs.length !== 1 ? 's' : ''}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}

        {data?.data.length === 0 && (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              No campaigns found.
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
