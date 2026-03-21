import { api } from '@/lib/api-client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Filter parameters shared across all analytics endpoints. */
export interface AnalyticsFilters {
  clientId: string;
  startDate: string;
  endDate: string;
  bdrIds?: string[];
  campaignIds?: string[];
  companyNames?: string[];
  callTypes?: string[];
}

/** Aggregate KPI summary for the selected date range and filters. */
export interface KPISummary {
  totalDials: number;
  totalCallbacks: number;
  totalConnects: number;
  totalConversations: number;
  totalMeetings: number;
  dialToConnectPct: number;
  callbackToConnectPct: number;
  connectToConversationPct: number;
  conversationToMeetingPct: number;
}

/** Per-rep performance row. */
export interface RepPerformanceRow {
  bdrId: string;
  bdrName: string;
  dials: number;
  connects: number;
  conversations: number;
  meetings: number;
  callbacks: number;
  callbackConnects: number;
  voicemails: number;
  noAnswers: number;
  dialToConnectPct: number;
  callbackToConnectPct: number;
  connectToConversationPct: number;
  conversationToMeetingPct: number;
  totalTalkTimeSeconds: number;
  totalSessionTimeSeconds: number;
}

/** Per-campaign/list performance row. */
export interface ListPerformanceRow {
  campaignId: string;
  campaignName: string;
  dials: number;
  connects: number;
  conversations: number;
  meetings: number;
  dialToConnectPct: number;
  connectToConversationPct: number;
  conversationToMeetingPct: number;
  dispositionBreakdown: Record<string, number>;
}

/** Per-account (company) performance row. */
export interface AccountPerformanceRow {
  companyName: string;
  dials: number;
  connects: number;
  conversations: number;
  meetings: number;
  lastCalledAt: string | null;
}

/** Individual call history row. */
export interface CallHistoryRow {
  id: string;
  bdrName: string;
  contactName: string;
  contactPhone: string;
  companyName: string | null;
  campaignName: string | null;
  disposition: string | null;
  durationSeconds: number | null;
  dialedAt: string;
  amdResult: string | null;
}

/** Objection type aggregation row. */
export interface ObjectionRow {
  type: string;
  count: number;
  percentage: number;
  byBdr: Array<{ bdrId: string; bdrName: string; count: number }>;
}

/** Single cell in the "when to call" heatmap grid. */
export interface WhenToCallCell {
  dayOfWeek: number;
  hour: number;
  dials: number;
  connects: number;
  connectRate: number;
}

/** Persisted saved view configuration. */
export interface SavedView {
  id: string;
  name: string;
  tab: string;
  filters: Record<string, unknown>;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build flat query params from structured filters. */
function buildParams(filters: AnalyticsFilters): Record<string, string> {
  const params: Record<string, string> = {
    clientId: filters.clientId,
    startDate: filters.startDate,
    endDate: filters.endDate,
  };
  if (filters.bdrIds?.length) params.bdrIds = filters.bdrIds.join(',');
  if (filters.campaignIds?.length) params.campaignIds = filters.campaignIds.join(',');
  if (filters.companyNames?.length) params.companyNames = filters.companyNames.join(',');
  if (filters.callTypes?.length) params.callTypes = filters.callTypes.join(',');
  return params;
}

// ---------------------------------------------------------------------------
// Analytics Endpoints
// ---------------------------------------------------------------------------

/** Fetch aggregate KPI summary. */
export async function getKPISummary(filters: AnalyticsFilters): Promise<KPISummary> {
  const { data } = await api.get('/analytics/kpi', { params: buildParams(filters) });
  return data;
}

/** Fetch per-rep performance rows. */
export async function getRepPerformance(filters: AnalyticsFilters): Promise<RepPerformanceRow[]> {
  const { data } = await api.get('/analytics/rep-performance', { params: buildParams(filters) });
  return data;
}

/** Fetch per-campaign/list performance rows. */
export async function getListPerformance(filters: AnalyticsFilters): Promise<ListPerformanceRow[]> {
  const { data } = await api.get('/analytics/list-performance', { params: buildParams(filters) });
  return data;
}

/** Fetch per-account (company) performance rows. */
export async function getAccountPerformance(filters: AnalyticsFilters): Promise<AccountPerformanceRow[]> {
  const { data } = await api.get('/analytics/account-performance', { params: buildParams(filters) });
  return data;
}

/** Fetch paginated call history. */
export async function getCallHistory(
  filters: AnalyticsFilters,
  page = 1,
  pageSize = 50,
): Promise<{ rows: CallHistoryRow[]; total: number }> {
  const { data } = await api.get('/analytics/call-history', {
    params: { ...buildParams(filters), page: String(page), pageSize: String(pageSize) },
  });
  return data;
}

/** Fetch objection type breakdown. */
export async function getObjections(filters: AnalyticsFilters): Promise<ObjectionRow[]> {
  const { data } = await api.get('/analytics/objections', { params: buildParams(filters) });
  return data;
}

/** Fetch "when to call" heatmap data. */
export async function getWhenToCall(filters: AnalyticsFilters): Promise<WhenToCallCell[]> {
  const { data } = await api.get('/analytics/when-to-call', { params: buildParams(filters) });
  return data;
}

// ---------------------------------------------------------------------------
// Saved Views
// ---------------------------------------------------------------------------

/** List all saved analytics views. */
export async function listSavedViews(): Promise<SavedView[]> {
  const { data } = await api.get('/saved-views');
  return data;
}

/** Create a new saved view. */
export async function createSavedView(
  name: string,
  tab: string,
  filters: Record<string, unknown>,
): Promise<SavedView> {
  const { data } = await api.post('/saved-views', { name, tab, filters });
  return data;
}

/** Update an existing saved view. */
export async function updateSavedView(
  id: string,
  updates: Partial<{ name: string; filters: Record<string, unknown> }>,
): Promise<SavedView> {
  const { data } = await api.put(`/saved-views/${id}`, updates);
  return data;
}

/** Delete a saved view. */
export async function deleteSavedView(id: string): Promise<void> {
  await api.delete(`/saved-views/${id}`);
}
