import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Phone,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  Copy,
  Check,
  ArrowLeft,
  Brain,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { PageSkeleton } from '@/components/shared/LoadingSkeleton';
import {
  fetchBdrCalls,
  completeCall,
  CALL_OUTCOMES,
  type BdrCallItem,
  type CallOutcome,
} from '@/services/bdr-calls';

export default function BdrCallsPage() {
  const { campaignId } = useParams<{ campaignId: string }>();
  const queryClient = useQueryClient();
  const [scriptOpen, setScriptOpen] = useState(true);
  const [completing, setCompleting] = useState<BdrCallItem | null>(null);
  const [outcome, setOutcome] = useState<CallOutcome | ''>('');
  const [notes, setNotes] = useState('');
  const [copiedLink, setCopiedLink] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['bdr', 'calls', campaignId],
    queryFn: () => fetchBdrCalls(campaignId!),
    enabled: !!campaignId,
  });

  const completeMutation = useMutation({
    mutationFn: () => completeCall(completing!.contactId, outcome, notes || undefined),
    onSuccess: () => {
      setCompleting(null);
      setOutcome('');
      setNotes('');
      queryClient.invalidateQueries({ queryKey: ['bdr', 'calls', campaignId] });
      queryClient.invalidateQueries({ queryKey: ['bdr', 'tasks'] });
    },
  });

  const copyMeetingLink = () => {
    if (data?.meetingLink) {
      navigator.clipboard.writeText(data.meetingLink);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    }
  };

  /** Build HubSpot dialer URL. Appending ?interaction=call opens the calling widget. */
  const buildDialerUrl = (hubspotLink: string) => `${hubspotLink}?interaction=call`;

  if (isLoading || !data) return <PageSkeleton />;

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button asChild variant="ghost" size="sm">
            <Link to="/bdr/tasks">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <h1 className="text-xl font-bold tracking-tight">Call List</h1>
            <p className="text-sm text-muted-foreground">
              {data.data.length} call{data.data.length !== 1 ? 's' : ''} pending
            </p>
          </div>
        </div>
        {data.meetingLink && (
          <Button variant="outline" size="sm" onClick={copyMeetingLink}>
            {copiedLink ? (
              <><Check className="h-3.5 w-3.5 mr-1.5" /> Copied</>
            ) : (
              <><Copy className="h-3.5 w-3.5 mr-1.5" /> Meeting Link</>
            )}
          </Button>
        )}
      </div>

      {/* Call script - collapsible */}
      {data.callScript && (
        <Card>
          <CardHeader
            className="pb-2 cursor-pointer"
            onClick={() => setScriptOpen(!scriptOpen)}
          >
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm">Call Script</CardTitle>
              {scriptOpen ? (
                <ChevronUp className="h-4 w-4 text-muted-foreground" />
              ) : (
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              )}
            </div>
          </CardHeader>
          {scriptOpen && (
            <CardContent>
              <pre className="text-sm whitespace-pre-wrap font-sans leading-relaxed">
                {data.callScript}
              </pre>
            </CardContent>
          )}
        </Card>
      )}

      {/* Call table */}
      {data.data.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No pending calls for this campaign.
          </CardContent>
        </Card>
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Contact</TableHead>
                <TableHead>Company</TableHead>
                <TableHead>Title</TableHead>
                <TableHead>Phone</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.data.map((call) => (
                <TableRow key={call.executionId}>
                  <TableCell>
                    <p className="font-medium">
                      {call.firstName} {call.lastName}
                    </p>
                    {call.email && (
                      <p className="text-xs text-muted-foreground">{call.email}</p>
                    )}
                  </TableCell>
                  <TableCell>
                    <span className="text-sm">{call.companyName ?? '-'}</span>
                  </TableCell>
                  <TableCell>
                    <span className="text-sm">{call.jobTitle ?? '-'}</span>
                  </TableCell>
                  <TableCell>
                    {call.phone ? (
                      <a
                        href={`tel:${call.phone}`}
                        className="text-sm font-mono text-primary hover:underline"
                      >
                        {call.phone}
                      </a>
                    ) : (
                      <span className="text-sm text-muted-foreground">-</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      {call.linkedinUrl && (
                        <Button asChild size="sm" variant="outline">
                          <a
                            href={`/api/v1/bdr/personality/${call.contactId}`}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            <Brain className="h-3.5 w-3.5 mr-1.5" />
                            Personality
                          </a>
                        </Button>
                      )}
                      {call.hubspotLink && (
                        <Button asChild size="sm">
                          <a
                            href={buildDialerUrl(call.hubspotLink)}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            <Phone className="h-3.5 w-3.5 mr-1.5" />
                            Call
                            <ExternalLink className="h-3 w-3 ml-1.5" />
                          </a>
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setCompleting(call)}
                      >
                        Complete
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      {/* Completion dialog */}
      <Dialog open={!!completing} onOpenChange={(open) => !open && setCompleting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Complete Call - {completing?.firstName} {completing?.lastName}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <label className="text-sm font-medium">Outcome</label>
              <Select value={outcome} onValueChange={(v) => setOutcome(v as CallOutcome)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select outcome..." />
                </SelectTrigger>
                <SelectContent>
                  {CALL_OUTCOMES.map((o) => (
                    <SelectItem key={o} value={o}>
                      {o}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Notes (optional)</label>
              <Textarea
                placeholder="Call notes..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="min-h-[80px]"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCompleting(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => completeMutation.mutate()}
              disabled={!outcome || completeMutation.isPending}
            >
              {completeMutation.isPending ? 'Saving...' : 'Complete Call'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
