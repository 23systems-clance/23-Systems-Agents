import { api } from '@/lib/api-client';
import type { SlackChannelsResponse } from '@/types/api';

/** Fetches all Slack channels the bot has access to in the given workspace. */
export async function fetchSlackChannels(teamId?: string): Promise<SlackChannelsResponse> {
  const { data } = await api.get<SlackChannelsResponse>('/slack/channels', {
    params: teamId ? { teamId } : undefined,
  });
  return data;
}
