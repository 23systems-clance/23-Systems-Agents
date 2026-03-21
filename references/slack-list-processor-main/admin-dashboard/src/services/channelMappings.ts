/**
 * API client for admin channel-client mapping management.
 */

import { api } from '@/lib/api-client';

export interface ChannelMapping {
  id: string;
  slackTeamId: string;
  slackChannelId: string;
  channelName: string | null;
  clientId: string;
  clientName: string;
  createdByUserId: string;
  createdAt: string;
}

/** Fetch all channel-client mappings. */
export async function fetchMappings(teamId?: string): Promise<ChannelMapping[]> {
  const params = teamId ? { teamId } : {};
  const { data } = await api.get<{ mappings: ChannelMapping[] }>('/channel-mappings', { params });
  return data.mappings;
}

/** Create a new channel-client mapping. */
export async function createMapping(
  slackTeamId: string,
  slackChannelId: string,
  clientId: string,
): Promise<ChannelMapping> {
  const body: Record<string, string> = { slackChannelId, clientId };
  if (slackTeamId) body.slackTeamId = slackTeamId;
  const { data } = await api.post<ChannelMapping>('/channel-mappings', body);
  return data;
}

/** Delete a channel-client mapping. */
export async function deleteMapping(id: string): Promise<void> {
  await api.delete(`/channel-mappings/${id}`);
}
