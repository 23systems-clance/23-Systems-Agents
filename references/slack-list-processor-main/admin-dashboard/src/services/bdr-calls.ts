import { bdrApi } from '@/lib/bdr-api-client';

export interface BdrCallItem {
  executionId: string;
  contactId: string;
  firstName: string;
  lastName: string;
  companyName: string | null;
  jobTitle: string | null;
  phone: string | null;
  email: string | null;
  linkedinUrl: string | null;
  hubspotLink: string | null;
}

export interface BdrCallListResponse {
  data: BdrCallItem[];
  callScript: string | null;
  meetingLink: string | null;
}

export const CALL_OUTCOMES = [
  'Connected',
  'Left Voicemail',
  'No Answer',
  'Wrong Number',
  'Not Interested',
  'Meeting Booked',
] as const;

export type CallOutcome = (typeof CALL_OUTCOMES)[number];

export async function fetchBdrCalls(campaignId: string): Promise<BdrCallListResponse> {
  const { data } = await bdrApi.get<BdrCallListResponse>(`/calls/${campaignId}`);
  return data;
}

export async function completeCall(
  contactId: string,
  outcome: string,
  notes?: string,
): Promise<void> {
  await bdrApi.post(`/calls/${contactId}/complete`, { result: outcome, notes });
}
