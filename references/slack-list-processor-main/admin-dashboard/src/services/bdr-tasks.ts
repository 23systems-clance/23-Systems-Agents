import { bdrApi } from '@/lib/bdr-api-client';

export interface BdrTaskSummary {
  campaignId: string;
  campaignName: string;
  campaignType: string;
  totalContacts: number;
  activeContacts: number;
  completedContacts: number;
  pendingCalls: number;
  unreadReplies: number;
  activeSequences: number;
}

export async function fetchBdrTasks(): Promise<BdrTaskSummary[]> {
  const { data } = await bdrApi.get<{ data: BdrTaskSummary[] }>('/tasks');
  return data.data;
}
