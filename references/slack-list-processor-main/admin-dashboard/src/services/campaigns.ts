import { api } from '@/lib/api-client';

export interface CampaignListItem {
  id: string;
  slackTeamId: string;
  name: string;
  description: string | null;
  campaignType: string;
  status: string;
  totalContacts: number;
  activeContacts: number;
  completedContacts: number;
  createdAt: string;
  updatedAt: string;
  sequenceSteps: Array<{ id: string; stepOrder: number; stepType: string }>;
  bdrs: Array<{ id: string; slackUserId: string; displayName: string; isActive: boolean }>;
  client: { id: string; name: string; slug: string; isActive: boolean } | null;
}

export interface CampaignDetail extends CampaignListItem {
  client: { id: string; name: string; slug: string; isActive: boolean } | null;
  contactQuality: ContactQualityStats;
  stats: {
    totalContacts: number;
    activeContacts: number;
    completedContacts: number;
    respondedContacts: number;
    skippedContacts: number;
    responseRate: number;
    completionRate: number;
  };
  funnel: Array<{
    stepIndex: number;
    stepType: string;
    total: number;
    completed: number;
    skipped: number;
    failed: number;
    waiting: number;
    pending: number;
  }>;
}

export interface CampaignContact {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  companyName: string | null;
  jobTitle: string | null;
  status: string;
  currentStepIndex: number;
  canEmail: boolean;
  canCall: boolean;
  canLinkedin: boolean;
  startedAt: string | null;
  completedAt: string | null;
  lastActivityAt: string | null;
}

export interface BdrActivityItem {
  slackUserId: string;
  displayName: string;
  totalEmailsSent: number;
  totalLinkedinActions: number;
  totalCallsCompleted: number;
  totalEmailReplies: number;
  totalLinkedinReplies: number;
  totalActions: number;
  activeCampaigns: number;
}

export async function fetchCampaigns(
  slackTeamId: string,
  params?: Record<string, string | number>,
): Promise<{ data: CampaignListItem[]; total: number; page: number; totalPages: number }> {
  const { data } = await api.get('/campaigns', { params: { slackTeamId, ...params } });
  return data;
}

export async function fetchCampaignDetail(id: string): Promise<CampaignDetail> {
  const { data } = await api.get(`/campaigns/${id}`);
  return data.data;
}

export async function fetchCampaignContacts(
  id: string,
  params?: Record<string, string | number>,
): Promise<{ data: CampaignContact[]; total: number; page: number; totalPages: number }> {
  const { data } = await api.get(`/campaigns/${id}/contacts`, { params });
  return data;
}

export async function fetchBdrActivity(
  slackTeamId: string,
  days?: number,
): Promise<BdrActivityItem[]> {
  const { data } = await api.get('/bdr-activity', { params: { slackTeamId, days } });
  return data.data;
}

// ---------------------------------------------------------------------------
// Campaign CRUD & Lifecycle
// ---------------------------------------------------------------------------

export interface CreateCampaignInput {
  slackTeamId: string;
  name: string;
  campaignType: 'EMAIL' | 'PHONE' | 'LINKEDIN' | 'MULTI_CHANNEL';
  description?: string;
  icpDefinition?: string;
  meetingLink?: string;
  callScript?: string;
  emailSequenceCopy?: string;
  linkedinSequenceCopy?: string;
  hubspotListId?: string;
  externalListId?: string;
  instantlyCampaignId?: string;
  heyreachCampaignId?: string;
  sequenceSteps?: Array<{ stepOrder: number; stepType: 'EMAIL' | 'PHONE' | 'LINKEDIN' }>;
  bdrs?: Array<{ slackUserId: string; slackTeamId: string; displayName: string }>;
  clientId?: string;
}

export async function createCampaign(input: CreateCampaignInput): Promise<CampaignListItem> {
  const { data } = await api.post('/campaigns', input);
  return data.data;
}

export async function updateCampaign(
  id: string,
  input: Partial<Omit<CreateCampaignInput, 'slackTeamId' | 'campaignType'>>,
): Promise<CampaignListItem> {
  const { data } = await api.patch(`/campaigns/${id}`, input);
  return data.data;
}

export async function activateCampaign(id: string): Promise<CampaignListItem> {
  const { data } = await api.post(`/campaigns/${id}/activate`);
  return data.data;
}

export async function pauseCampaign(id: string): Promise<CampaignListItem> {
  const { data } = await api.post(`/campaigns/${id}/pause`);
  return data.data;
}

export async function resumeCampaign(id: string): Promise<CampaignListItem> {
  const { data } = await api.post(`/campaigns/${id}/resume`);
  return data.data;
}

// ---------------------------------------------------------------------------
// Delete / Archive / Quality / External Campaigns
// ---------------------------------------------------------------------------

export async function deleteCampaign(id: string): Promise<void> {
  await api.delete(`/campaigns/${id}`);
}

export async function archiveCampaign(id: string): Promise<void> {
  await api.delete(`/campaigns/${id}`, { params: { action: 'archive' } });
}

export interface PersonalitySyncSummary {
  total: number;
  synced: number;
  skipped: number;
  failed: number;
  errors: string[];
}

export async function pushPersonalityToCrm(id: string): Promise<PersonalitySyncSummary> {
  const { data } = await api.post(`/campaigns/${id}/personality/push-crm`);
  return data;
}

export function getPersonalityCsvUrl(id: string): string {
  return `/api/v1/admin/campaigns/${id}/personality/export-csv`;
}

export interface ContactQualityStats {
  totalContacts: number;
  emailVerified: number;
  phoneCallable: number;
  linkedinAvailable: number;
  multiChannel: number;
}

export async function fetchContactQuality(id: string): Promise<ContactQualityStats> {
  const { data } = await api.get(`/campaigns/${id}/quality`);
  return data.data;
}

export interface ExternalCampaignItem {
  id: string;
  name: string;
  status?: string;
}

export async function fetchExternalCampaigns(
  clientId: string,
  platform: 'instantly' | 'heyreach',
): Promise<ExternalCampaignItem[]> {
  const { data } = await api.get(`/clients/${clientId}/external-campaigns`, {
    params: { platform },
  });
  return data.data.campaigns;
}

// ---------------------------------------------------------------------------
// Smart Reply Metrics
// ---------------------------------------------------------------------------

export interface SmartReplyMetrics {
  sent: number;
  rejected: number;
  ready: number;
  generating: number;
  failed: number;
  total: number;
  acceptanceRate: number;
}

export async function fetchSmartReplyMetrics(id: string): Promise<SmartReplyMetrics> {
  const { data } = await api.get(`/campaigns/${id}/smart-reply-metrics`);
  return data.data;
}

// ---------------------------------------------------------------------------
// EOD Reports
// ---------------------------------------------------------------------------

export interface EodReportItem {
  id: string;
  campaignId: string | null;
  slackUserId: string;
  slackTeamId: string;
  date: string;
  stats: Record<string, number>;
  bdrNotes: string | null;
  createdAt: string;
}

export async function fetchEodReports(
  slackTeamId: string,
  params?: Record<string, string | number>,
): Promise<{ data: EodReportItem[]; total: number; page: number; totalPages: number }> {
  const { data } = await api.get('/eod-reports', { params: { slackTeamId, ...params } });
  return data;
}
