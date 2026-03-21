import { useQuery } from '@tanstack/react-query';
import { Mail, Phone, MessageSquare, BarChart3 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PageSkeleton } from '@/components/shared/LoadingSkeleton';
import { bdrApi } from '@/lib/bdr-api-client';

interface BdrStats {
  date: string;
  totals: {
    emailsSent: number;
    linkedinActionsSent: number;
    callsCompleted: number;
    emailRepliesReceived: number;
    linkedinRepliesReceived: number;
  };
  byCampaign: Array<{
    campaignId: string;
    campaignName: string;
    emailsSent: number;
    linkedinActionsSent: number;
    callsCompleted: number;
    emailRepliesReceived: number;
    linkedinRepliesReceived: number;
  }>;
}

async function fetchBdrStats(): Promise<BdrStats> {
  const { data } = await bdrApi.get<{ data: BdrStats }>('/stats');
  return data.data;
}

export default function BdrStatsPage() {
  const { data: stats, isLoading } = useQuery({
    queryKey: ['bdr', 'stats'],
    queryFn: fetchBdrStats,
    refetchInterval: 60_000,
  });

  if (isLoading || !stats) return <PageSkeleton />;

  const totalActions =
    stats.totals.emailsSent +
    stats.totals.linkedinActionsSent +
    stats.totals.callsCompleted;

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">Today's Stats</h1>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <BarChart3 className="h-6 w-6 text-purple-500" />
              <div>
                <p className="text-xl font-bold">{totalActions}</p>
                <p className="text-xs text-muted-foreground">Total actions</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <Mail className="h-6 w-6 text-blue-500" />
              <div>
                <p className="text-xl font-bold">{stats.totals.emailsSent}</p>
                <p className="text-xs text-muted-foreground">Emails sent</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <Phone className="h-6 w-6 text-orange-500" />
              <div>
                <p className="text-xl font-bold">{stats.totals.callsCompleted}</p>
                <p className="text-xs text-muted-foreground">Calls completed</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <MessageSquare className="h-6 w-6 text-green-500" />
              <div>
                <p className="text-xl font-bold">
                  {stats.totals.emailRepliesReceived + stats.totals.linkedinRepliesReceived}
                </p>
                <p className="text-xs text-muted-foreground">Replies received</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {stats.byCampaign.length > 0 && (
        <>
          <h2 className="text-lg font-semibold">By Campaign</h2>
          <div className="space-y-3">
            {stats.byCampaign.map((campaign) => (
              <Card key={campaign.campaignId}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">{campaign.campaignName}</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-3 md:grid-cols-5 gap-3 text-sm">
                    <div>
                      <p className="text-muted-foreground">Emails</p>
                      <p className="font-medium">{campaign.emailsSent}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">LinkedIn</p>
                      <p className="font-medium">{campaign.linkedinActionsSent}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Calls</p>
                      <p className="font-medium">{campaign.callsCompleted}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Email replies</p>
                      <p className="font-medium">{campaign.emailRepliesReceived}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">LI replies</p>
                      <p className="font-medium">{campaign.linkedinRepliesReceived}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
