/**
 * Reusable Slack channel picker component.
 *
 * Displays a searchable list of Slack channels for the given workspace.
 * Similar UX pattern to the Slack user picker in managed-bdrs.tsx.
 */

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Hash, Lock, Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { queryKeys } from '@/lib/query-keys';
import { fetchSlackChannels } from '@/services/slack-channels';
import type { SlackChannel } from '@/types/api';

interface SlackChannelPickerProps {
  /** Slack workspace team ID to load channels for. */
  teamId: string;
  /** Callback when a channel is selected. */
  onSelect: (channel: SlackChannel) => void;
  /** Channel IDs to show as disabled (already mapped). */
  excludeChannelIds?: Set<string>;
  /** Whether the picker should be active. */
  enabled?: boolean;
}

export function SlackChannelPicker({
  teamId,
  onSelect,
  excludeChannelIds,
  enabled = true,
}: SlackChannelPickerProps) {
  const [search, setSearch] = useState('');

  const channelsQuery = useQuery({
    queryKey: queryKeys.slackChannels.list(teamId || 'default'),
    queryFn: () => fetchSlackChannels(teamId),
    enabled,
    staleTime: 5 * 60 * 1000,
  });

  const filteredChannels = useMemo(() => {
    const channels = channelsQuery.data?.channels ?? [];
    if (!search.trim()) return channels;
    const q = search.toLowerCase();
    return channels.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.topic?.toLowerCase().includes(q),
    );
  }, [channelsQuery.data, search]);

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search channels..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
          autoFocus
        />
      </div>

      <div className="max-h-72 overflow-y-auto rounded-md border">
        {channelsQuery.isLoading ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Loading channels...
          </p>
        ) : channelsQuery.isError ? (
          <p className="py-6 text-center text-sm text-destructive">
            Failed to load channels
          </p>
        ) : filteredChannels.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            {search ? 'No channels match your search' : 'No channels found'}
          </p>
        ) : (
          filteredChannels.map((channel) => {
            const excluded = excludeChannelIds?.has(channel.id) ?? false;
            return (
              <button
                key={channel.id}
                className={`flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm transition-colors ${
                  excluded
                    ? 'cursor-not-allowed opacity-50'
                    : 'hover:bg-muted'
                }`}
                onClick={() => !excluded && onSelect(channel)}
                disabled={excluded}
              >
                {channel.isPrivate ? (
                  <Lock className="h-4 w-4 shrink-0 text-muted-foreground" />
                ) : (
                  <Hash className="h-4 w-4 shrink-0 text-muted-foreground" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium">{channel.name}</span>
                    {excluded && (
                      <Badge variant="secondary" className="shrink-0 text-[10px]">
                        Already mapped
                      </Badge>
                    )}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {channel.topic
                      ? channel.topic
                      : `${channel.memberCount} members`}
                  </div>
                </div>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {channel.memberCount}
                </span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
