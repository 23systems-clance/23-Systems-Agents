import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSearchParams, Link } from 'react-router-dom';
import {
  Mail,
  Send,
  Linkedin,
  ExternalLink,
  Inbox,
  Clock,
  Brain,
  Paperclip,
  X as XIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { PageSkeleton } from '@/components/shared/LoadingSkeleton';
import {
  fetchUniboxReplies,
  respondToEmail,
  markAsRead,
  acceptDraft,
  dismissDraft,
  regenerateDraft,
} from '@/services/bdr-unibox';
import type { DraftTone } from '@/services/bdr-unibox';
import SmartReplyDraft from '@/components/bdr/SmartReplyDraft';
import { cn } from '@/lib/utils';

export default function BdrUniboxPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const campaignId = searchParams.get('campaignId') ?? undefined;
  const channelFilter = searchParams.get('channel') ?? 'ALL';
  const readFilter = searchParams.get('read') ?? 'false';

  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const [replyFiles, setReplyFiles] = useState<File[]>([]);
  const replyFileRef = useRef<HTMLInputElement>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['bdr', 'unibox', campaignId, channelFilter, readFilter],
    queryFn: () =>
      fetchUniboxReplies({
        campaignId,
        channel: channelFilter !== 'ALL' ? channelFilter : undefined,
        isRead: readFilter !== 'all' ? readFilter : undefined,
      }),
    refetchInterval: 30_000,
  });

  const readMutation = useMutation({
    mutationFn: markAsRead,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bdr', 'unibox'] });
      queryClient.invalidateQueries({ queryKey: ['bdr', 'tasks'] });
    },
  });

  const replyMutation = useMutation({
    mutationFn: ({ replyId, body, files }: { replyId: string; body: string; files?: File[] }) =>
      respondToEmail(replyId, body, files),
    onSuccess: () => {
      setReplyText('');
      setReplyFiles([]);
      queryClient.invalidateQueries({ queryKey: ['bdr', 'unibox'] });
    },
  });

  const acceptMutation = useMutation({
    mutationFn: ({ replyId, body, files }: { replyId: string; body?: string; files?: File[] }) =>
      acceptDraft(replyId, body, files),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bdr', 'unibox'] });
    },
  });

  const dismissMutation = useMutation({
    mutationFn: dismissDraft,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bdr', 'unibox'] });
    },
  });

  const regenerateMutation = useMutation({
    mutationFn: ({ replyId, tone }: { replyId: string; tone: DraftTone }) =>
      regenerateDraft(replyId, tone),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bdr', 'unibox'] });
    },
  });

  const selected = data?.data.find((r) => r.id === selectedId) ?? null;

  // Auto-mark as read when selecting a message
  useEffect(() => {
    if (selected && !selected.isRead) {
      readMutation.mutate(selected.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  // Auto-select first unread on load
  useEffect(() => {
    if (data?.data.length && !selectedId) {
      const firstUnread = data.data.find((r) => !r.isRead);
      setSelectedId(firstUnread?.id ?? data.data[0]?.id ?? null);
    }
  }, [data, selectedId]);

  const updateFilter = (key: string, value: string) => {
    const params = new URLSearchParams(searchParams);
    if (value === 'ALL' || value === 'all' || value === 'false') {
      // Set defaults
      if (key === 'channel') params.delete('channel');
      else if (key === 'read') { params.delete('read'); }
      else params.set(key, value);
    } else {
      params.set(key, value);
    }
    setSearchParams(params, { replace: true });
    setSelectedId(null);
  };

  if (isLoading) return <PageSkeleton />;

  return (
    <div className="flex h-full flex-col">
      {/* Header + Filters */}
      <div className="flex items-center justify-between border-b px-6 py-3">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-bold">UniBox</h1>
          <Badge variant="secondary" className="font-mono">
            {data?.total ?? 0}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          <Select
            value={channelFilter}
            onValueChange={(v) => updateFilter('channel', v)}
          >
            <SelectTrigger className="w-[130px] h-8 text-xs">
              <SelectValue placeholder="Channel" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All channels</SelectItem>
              <SelectItem value="EMAIL">Email</SelectItem>
              <SelectItem value="LINKEDIN">LinkedIn</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={readFilter}
            onValueChange={(v) => updateFilter('read', v)}
          >
            <SelectTrigger className="w-[120px] h-8 text-xs">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="false">Unread</SelectItem>
              <SelectItem value="true">Read</SelectItem>
              <SelectItem value="all">All</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Split pane */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left: message list */}
        <ScrollArea className="w-80 shrink-0 border-r">
          {(!data?.data.length) ? (
            <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
              <Inbox className="h-10 w-10 text-muted-foreground/40 mb-3" />
              <p className="text-sm text-muted-foreground">No messages</p>
            </div>
          ) : (
            <div className="flex flex-col">
              {data.data.map((reply) => (
                <button
                  key={reply.id}
                  onClick={() => setSelectedId(reply.id)}
                  className={cn(
                    'flex flex-col gap-1 px-4 py-3 text-left border-b transition-colors hover:bg-accent/50',
                    selectedId === reply.id && 'bg-accent',
                    !reply.isRead && 'border-l-2 border-l-blue-500',
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      {reply.channel === 'EMAIL' ? (
                        <Mail className="h-3.5 w-3.5 text-blue-500 shrink-0" />
                      ) : (
                        <Linkedin className="h-3.5 w-3.5 text-indigo-500 shrink-0" />
                      )}
                      <span className={cn(
                        'text-sm truncate',
                        !reply.isRead && 'font-semibold',
                      )}>
                        {reply.fromName ?? reply.fromEmail ?? 'Unknown'}
                      </span>
                    </div>
                    <span className="text-[10px] text-muted-foreground shrink-0">
                      {formatTime(reply.receivedAt)}
                    </span>
                  </div>
                  {reply.subject && (
                    <p className="text-xs text-muted-foreground truncate">
                      {reply.subject}
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground/70 truncate">
                    {reply.body.slice(0, 80)}
                  </p>
                  <Badge variant="outline" className="text-[10px] w-fit mt-0.5">
                    {reply.campaignName}
                  </Badge>
                </button>
              ))}
            </div>
          )}
        </ScrollArea>

        {/* Right: detail + reply */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {selected ? (
            <>
              {/* Message header */}
              <div className="px-6 py-4 border-b space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {selected.channel === 'EMAIL' ? (
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-500/10">
                        <Mail className="h-4 w-4 text-blue-500" />
                      </div>
                    ) : (
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-500/10">
                        <Linkedin className="h-4 w-4 text-indigo-500" />
                      </div>
                    )}
                    <div>
                      <p className="font-medium text-sm">
                        {selected.fromName ?? 'Unknown'}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {selected.fromEmail ?? selected.fromLinkedinUrl ?? ''}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Clock className="h-3 w-3" />
                    {new Date(selected.receivedAt).toLocaleString()}
                  </div>
                </div>
                {selected.contact && (
                  <p className="text-xs text-muted-foreground">
                    <Link
                      to={`/contacts/${selected.contact.id}`}
                      className="hover:underline text-blue-600 dark:text-blue-400"
                    >
                      {selected.contact.firstName} {selected.contact.lastName}
                    </Link>
                    {selected.contact.companyName ? ` at ${selected.contact.companyName}` : ''}
                  </p>
                )}
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-xs">
                    {selected.campaignName}
                  </Badge>
                  {selected.contact && (
                    <Button asChild size="sm" variant="outline" className="h-6 text-xs">
                      <a
                        href={`/api/v1/bdr/personality/${selected.contact.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <Brain className="h-3 w-3 mr-1" />
                        Personality
                      </a>
                    </Button>
                  )}
                </div>
              </div>

              {/* Message body */}
              <ScrollArea className="flex-1 px-6 py-4">
                {selected.subject && (
                  <p className="font-medium mb-3">Re: {selected.subject}</p>
                )}
                <p className="text-sm whitespace-pre-wrap leading-relaxed">
                  {selected.body}
                </p>
              </ScrollArea>

              {/* Smart Reply Draft */}
              {selected.draftStatus && (
                <div className="px-6 py-3 border-t">
                  <SmartReplyDraft
                    draftBody={selected.draftBody}
                    draftStatus={selected.draftStatus}
                    draftIntent={selected.draftIntent}
                    draftError={selected.draftError}
                    onAccept={(body, files) =>
                      acceptMutation.mutate({ replyId: selected.id, body, files })
                    }
                    onDismiss={() => dismissMutation.mutate(selected.id)}
                    onRegenerate={(tone) =>
                      regenerateMutation.mutate({ replyId: selected.id, tone })
                    }
                    isAccepting={acceptMutation.isPending}
                    isDismissing={dismissMutation.isPending}
                    isRegenerating={regenerateMutation.isPending}
                  />
                </div>
              )}

              <Separator />

              {/* Reply section */}
              <div className="px-6 py-4 space-y-3">
                {selected.channel === 'EMAIL' ? (
                  <>
                    <Textarea
                      placeholder="Type your reply..."
                      value={replyText}
                      onChange={(e) => setReplyText(e.target.value)}
                      className="min-h-[100px] resize-none"
                    />
                    {/* File attachments for manual reply */}
                    <div className="flex items-center gap-2 flex-wrap">
                      <input
                        ref={replyFileRef}
                        type="file"
                        accept=".pdf,.docx,.xlsx,.png,.jpg,.jpeg,.gif"
                        multiple
                        className="hidden"
                        onChange={(e) => {
                          const newFiles = Array.from(e.target.files ?? []).filter((f) => f.size <= 10 * 1024 * 1024);
                          setReplyFiles((prev) => [...prev, ...newFiles].slice(0, 5));
                          if (replyFileRef.current) replyFileRef.current.value = '';
                        }}
                      />
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs"
                        onClick={() => replyFileRef.current?.click()}
                        disabled={replyFiles.length >= 5}
                      >
                        <Paperclip className="h-3 w-3 mr-1" />
                        Attach
                      </Button>
                      {replyFiles.map((file, i) => (
                        <Badge key={i} variant="secondary" className="text-[10px] gap-1">
                          {file.name}
                          <button onClick={() => setReplyFiles((prev) => prev.filter((_, idx) => idx !== i))} className="ml-1 hover:text-destructive">
                            <XIcon className="h-2.5 w-2.5" />
                          </button>
                        </Badge>
                      ))}
                    </div>
                    <div className="flex items-center justify-between">
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span>
                              <Button
                                onClick={() =>
                                  replyMutation.mutate({
                                    replyId: selected.id,
                                    body: replyText,
                                    files: replyFiles.length > 0 ? replyFiles : undefined,
                                  })
                                }
                                disabled={
                                  !replyText.trim() ||
                                  replyMutation.isPending ||
                                  !selected.externalId
                                }
                              >
                                <Send className="h-4 w-4 mr-2" />
                                {replyMutation.isPending ? 'Sending...' : 'Send Reply'}
                              </Button>
                            </span>
                          </TooltipTrigger>
                          {!selected.externalId && (
                            <TooltipContent>
                              <p>Cannot reply - no email thread ID available</p>
                            </TooltipContent>
                          )}
                        </Tooltip>
                      </TooltipProvider>
                      {replyMutation.isSuccess && (
                        <p className="text-xs text-emerald-600">Reply sent</p>
                      )}
                    </div>
                  </>
                ) : (
                  <div className="flex items-center gap-3">
                    {selected.fromLinkedinUrl && (
                      <Button asChild variant="outline">
                        <a
                          href={selected.fromLinkedinUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <Linkedin className="h-4 w-4 mr-2" />
                          View on LinkedIn
                          <ExternalLink className="h-3 w-3 ml-2" />
                        </a>
                      </Button>
                    )}
                    <p className="text-xs text-muted-foreground">
                      Reply directly on LinkedIn to respond
                    </p>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center justify-center flex-1 text-center">
              <Inbox className="h-12 w-12 text-muted-foreground/30 mb-3" />
              <p className="text-sm text-muted-foreground">
                Select a message to view
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Formats a date string to a short relative or absolute time. */
function formatTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60_000);
  const diffHours = Math.floor(diffMs / 3_600_000);

  if (diffMins < 60) return `${diffMins}m`;
  if (diffHours < 24) return `${diffHours}h`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
