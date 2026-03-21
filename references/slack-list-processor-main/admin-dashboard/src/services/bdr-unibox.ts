import { bdrApi } from '@/lib/bdr-api-client';

export type SmartReplyDraftStatus = 'GENERATING' | 'READY' | 'SENT' | 'REJECTED' | 'FAILED';

export interface UniboxReply {
  id: string;
  campaignId: string;
  campaignName: string;
  channel: 'EMAIL' | 'LINKEDIN';
  fromName: string | null;
  fromEmail: string | null;
  fromLinkedinUrl: string | null;
  subject: string | null;
  body: string;
  externalId: string | null;
  isRead: boolean;
  receivedAt: string;
  draftBody: string | null;
  draftStatus: SmartReplyDraftStatus | null;
  draftIntent: string | null;
  draftGeneratedAt: string | null;
  draftError: string | null;
  contact: {
    id: string;
    firstName: string;
    lastName: string;
    companyName: string | null;
  } | null;
}

export interface UniboxListResponse {
  data: UniboxReply[];
  total: number;
}

export async function fetchUniboxReplies(params?: {
  campaignId?: string;
  channel?: string;
  isRead?: string;
  page?: number;
  limit?: number;
}): Promise<UniboxListResponse> {
  const { data } = await bdrApi.get<UniboxListResponse>('/unibox', { params });
  return data;
}

export async function respondToEmail(replyId: string, body: string, files?: File[]): Promise<void> {
  if (files && files.length > 0) {
    const form = new FormData();
    form.append('body', body);
    files.forEach((f) => form.append('attachments', f));
    await bdrApi.post(`/unibox/${replyId}/respond`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  } else {
    await bdrApi.post(`/unibox/${replyId}/respond`, { body });
  }
}

export async function markAsRead(replyId: string): Promise<void> {
  await bdrApi.patch(`/unibox/${replyId}/read`);
}

export async function acceptDraft(replyId: string, body?: string, files?: File[]): Promise<void> {
  if (files && files.length > 0) {
    const form = new FormData();
    if (body) form.append('body', body);
    files.forEach((f) => form.append('attachments', f));
    await bdrApi.patch(`/unibox/${replyId}/draft/accept`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  } else {
    await bdrApi.patch(`/unibox/${replyId}/draft/accept`, body ? { body } : undefined);
  }
}

export async function dismissDraft(replyId: string): Promise<void> {
  await bdrApi.patch(`/unibox/${replyId}/draft/dismiss`);
}

export type DraftTone = 'professional' | 'casual' | 'assertive' | 'empathetic';

export async function regenerateDraft(replyId: string, tone: DraftTone): Promise<{ success: boolean; jobId: string }> {
  const { data } = await bdrApi.post<{ success: boolean; jobId: string }>(`/unibox/${replyId}/draft/regenerate`, { tone });
  return data;
}
