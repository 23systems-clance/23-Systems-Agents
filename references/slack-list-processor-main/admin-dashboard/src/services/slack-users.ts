import { api } from '@/lib/api-client';
import type { SlackUsersResponse } from '@/types/api';

/** Fetches all non-bot Slack workspace members. */
export async function fetchSlackUsers(): Promise<SlackUsersResponse> {
  const { data } = await api.get<SlackUsersResponse>('/slack/users');
  return data;
}
