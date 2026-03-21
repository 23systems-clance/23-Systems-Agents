import { useQuery } from '@tanstack/react-query';
import { Users, Mail, Phone, MessageSquare } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { PageSkeleton } from '@/components/shared/LoadingSkeleton';
import { fetchBdrActivity } from '@/services/campaigns';
import { useWorkspaceId } from '@/hooks/useWorkspaceId';

export default function BdrActivityPage() {
  const { teamId: slackTeamId, isLoading: teamLoading } = useWorkspaceId();

  const { data: bdrs, isLoading } = useQuery({
    queryKey: ['admin', 'bdr-activity', slackTeamId],
    queryFn: () => fetchBdrActivity(slackTeamId!, 7),
    refetchInterval: 60_000,
    enabled: !!slackTeamId,
  });

  if (teamLoading || isLoading || !bdrs) return <PageSkeleton />;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">BDR Activity (Last 7 Days)</h1>
        <Badge variant="outline">
          <Users className="h-3 w-3 mr-1" /> {bdrs.length} BDR{bdrs.length !== 1 ? 's' : ''}
        </Badge>
      </div>

      <div className="space-y-3">
        {bdrs.map((bdr) => (
          <Card key={bdr.slackUserId}>
            <CardContent className="py-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">{bdr.displayName}</p>
                  <p className="text-sm text-muted-foreground">
                    {bdr.activeCampaigns} active campaign
                    {bdr.activeCampaigns !== 1 ? 's' : ''}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-xl font-bold">{bdr.totalActions}</p>
                  <p className="text-xs text-muted-foreground">total actions</p>
                </div>
              </div>
              <div className="grid grid-cols-5 gap-3 mt-4 text-sm">
                <div className="flex items-center gap-1">
                  <Mail className="h-3 w-3 text-blue-500" />
                  <span>{bdr.totalEmailsSent} emails</span>
                </div>
                <div className="flex items-center gap-1">
                  <MessageSquare className="h-3 w-3 text-indigo-500" />
                  <span>{bdr.totalLinkedinActions} LinkedIn</span>
                </div>
                <div className="flex items-center gap-1">
                  <Phone className="h-3 w-3 text-orange-500" />
                  <span>{bdr.totalCallsCompleted} calls</span>
                </div>
                <div>
                  <span className="text-green-600">{bdr.totalEmailReplies} email replies</span>
                </div>
                <div>
                  <span className="text-green-600">{bdr.totalLinkedinReplies} LI replies</span>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}

        {bdrs.length === 0 && (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              No BDR activity found.
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
