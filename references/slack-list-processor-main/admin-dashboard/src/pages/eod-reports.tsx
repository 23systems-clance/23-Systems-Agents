import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FileText, ChevronLeft, ChevronRight } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PageSkeleton } from '@/components/shared/LoadingSkeleton';
import { fetchEodReports } from '@/services/campaigns';
import { useWorkspaceId } from '@/hooks/useWorkspaceId';

export default function EodReportsPage() {
  const { teamId: slackTeamId, isLoading: teamLoading } = useWorkspaceId();
  const [page, setPage] = useState(1);
  const limit = 20;

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'eod-reports', slackTeamId, page],
    queryFn: () => fetchEodReports(slackTeamId!, { page, limit }),
    enabled: !!slackTeamId,
  });

  if (teamLoading || isLoading) return <PageSkeleton />;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">EOD Reports</h1>
        {data && (
          <Badge variant="outline">{data.total} total</Badge>
        )}
      </div>

      <div className="space-y-3">
        {data?.data.map((report) => {
          const stats = report.stats || {};
          return (
            <Card key={report.id}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4 text-muted-foreground" />
                    <CardTitle className="text-sm">
                      {report.slackUserId}
                    </CardTitle>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {new Date(report.date).toLocaleDateString()}
                  </span>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-3 md:grid-cols-5 gap-3 text-sm">
                  <div>
                    <p className="text-muted-foreground">Emails</p>
                    <p className="font-medium">{stats.emailsSent ?? 0}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">LinkedIn</p>
                    <p className="font-medium">{stats.linkedinActionsSent ?? 0}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Calls</p>
                    <p className="font-medium">{stats.callsCompleted ?? 0}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Email replies</p>
                    <p className="font-medium">{stats.emailRepliesReceived ?? 0}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">LI replies</p>
                    <p className="font-medium">{stats.linkedinRepliesReceived ?? 0}</p>
                  </div>
                </div>
                {report.bdrNotes && (
                  <div className="mt-3 pt-3 border-t">
                    <p className="text-xs text-muted-foreground mb-1">Notes</p>
                    <p className="text-sm whitespace-pre-wrap">{report.bdrNotes}</p>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}

        {data?.data.length === 0 && (
          <Card>
            <CardContent className="py-12 text-center text-muted-foreground">
              No EOD reports found.
            </CardContent>
          </Card>
        )}
      </div>

      {/* Pagination */}
      {data && data.totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Page {page} of {data.totalPages}
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= data.totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
