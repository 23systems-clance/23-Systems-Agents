/**
 * Client dashboard API service (T064).
 *
 * Separate API client for client-facing endpoints at /api/v1/client.
 * Uses cookie-based session auth (not admin API key).
 */

import axios from 'axios';

const CLIENT_API_BASE = '/api/v1/client';

export const clientApi = axios.create({
  baseURL: CLIENT_API_BASE,
  headers: { 'Content-Type': 'application/json' },
  withCredentials: true,
});

/** On 401, redirect to client login. */
clientApi.interceptors.response.use(
  (response) => response,
  (error) => {
    if (
      axios.isAxiosError(error) &&
      error.response?.status === 401 &&
      !error.config?.url?.includes('/auth/')
    ) {
      window.location.href = '/client/login';
    }
    return Promise.reject(error);
  },
);

/* ---- Types ---- */

export interface ClientUser {
  slackUserId: string;
  slackTeamId: string;
  displayName: string;
  email: string;
  isAdmin: boolean;
  role: 'admin' | 'user';
}

export interface ClientOverview {
  workspaceName: string;
  creditBalance: number;
  monthlyAllowance: number;
  creditsUsedThisMonth: number;
  subscriptionTier: string;
  enrichmentJobsThisMonth: number;
  totalRowsEnrichedThisMonth: number;
  enabledFeatures: string[];
}

export interface ClientBilling {
  creditBalance: number;
  monthlyAllowance: number;
  creditsUsedThisMonth: number;
  nextResetDate: string | null;
  subscriptionTier: string;
  transactions: CreditTransaction[];
}

export interface CreditTransaction {
  id: string;
  type: string;
  amount: number;
  description: string;
  createdAt: string;
}

export interface CreditPack {
  id: string;
  name: string;
  creditAmount: number;
  priceUsd: number;
}

export interface EnrichmentJob {
  id: string;
  jobType: string;
  status: string;
  rowCount: number;
  creditsUsed: number;
  slackUserId: string;
  slackUserName: string;
  slackChannelName: string;
  downloadUrl: string | null;
  createdAt: string;
}

export interface EnrichmentChannel {
  id: string;
  slackChannelId: string;
  slackChannelName: string;
  assignedUserId: string;
  assignedUserName: string;
  status: 'ACTIVE' | 'INACTIVE';
  registeredAt: string;
}

export interface ClientSettings {
  defaultEnrichmentType: string | null;
  enabledFeatures: string[];
  notificationPreferences: {
    jobComplete: boolean;
    lowBalance: boolean;
    weeklyReport: boolean;
  };
}

/* ---- API Functions ---- */

/** Get current authenticated user. */
export async function getClientMe() {
  const { data } = await clientApi.get<ClientUser>('/auth/me');
  return data;
}

/** Get workspace overview. */
export async function getClientOverview() {
  const { data } = await clientApi.get<ClientOverview>('/overview');
  return data;
}

/** Get billing details. */
export async function getClientBilling() {
  const { data } = await clientApi.get<ClientBilling>('/billing');
  return data;
}

/** List available credit packs. */
export async function listCreditPacks() {
  const { data } = await clientApi.get<{ packs: CreditPack[] }>('/billing/credit-packs');
  return data.packs;
}

/** Create Stripe Checkout for a credit pack. */
export async function purchaseCreditPack(packId: string) {
  const { data } = await clientApi.post<{ checkoutUrl: string }>(
    `/billing/credit-packs/${packId}/checkout`,
  );
  return data.checkoutUrl;
}

/** Create Stripe Billing Portal session. */
export async function openBillingPortal() {
  const { data } = await clientApi.post<{ portalUrl: string }>('/billing/manage');
  return data.portalUrl;
}

/** Get enrichment history. */
export async function getEnrichmentHistory(params?: {
  page?: number;
  limit?: number;
  userId?: string;
}) {
  const { data } = await clientApi.get<{ jobs: EnrichmentJob[]; total: number }>(
    '/enrichments',
    { params },
  );
  return data;
}

export interface AnalysisChannelInfo {
  slackChannelId: string;
  slackChannelName: string;
  documents: {
    icp: boolean;
    useCases: boolean;
    caseStudies: boolean;
    testimonials: boolean;
  };
  lastDocumentUploadAt: string | null;
}

/** List enrichment channels and analysis channel. */
export async function listClientChannels() {
  const { data } = await clientApi.get<{
    channels: EnrichmentChannel[];
    analysisChannel: AnalysisChannelInfo | null;
  }>('/channels');
  return data;
}

/** @deprecated Use listClientChannels instead. */
export async function listEnrichmentChannels() {
  const data = await listClientChannels();
  return data.channels;
}

/** Deactivate an enrichment channel. */
export async function deactivateEnrichmentChannel(channelId: string) {
  const { data } = await clientApi.post<{ success: boolean }>(
    `/channels/${channelId}/deactivate`,
  );
  return data.success;
}

/** Get workspace settings. */
export async function getClientSettings() {
  const { data } = await clientApi.get<ClientSettings>('/settings');
  return data;
}

/** Update workspace settings. */
export async function updateClientSettings(updates: {
  defaultEnrichmentType?: string;
  notificationPreferences?: Partial<ClientSettings['notificationPreferences']>;
}) {
  const { data } = await clientApi.patch<{ success: boolean }>('/settings', updates);
  return data.success;
}

/* ---- Pack Catalog (Feature 39) ---- */

export interface CatalogPack {
  id: string;
  name: string;
  description: string | null;
  category: string;
  tier: string;
  monthlyPriceUsd: number;
  creditsIncluded: number;
  skills: Array<{ name: string; description: string | null }>;
  isSubscribed: boolean;
}

export interface PackSubscription {
  id: string;
  packId: string;
  status: string;
  creditsIncluded: number;
  creditsUsed: number;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  pack: {
    id: string;
    name: string;
    slug: string;
    category: string;
    tier: string;
  };
}

/** Browse published pack catalog. */
export async function browsePackCatalog() {
  const { data } = await clientApi.get<CatalogPack[]>('/packs');
  return data;
}

/** Subscribe to a pack. */
export async function subscribeToPack(packId: string) {
  const { data } = await clientApi.post(`/packs/${packId}/subscribe`);
  return data;
}

/** List active subscriptions. */
export async function listPackSubscriptions() {
  const { data } = await clientApi.get<PackSubscription[]>('/packs/subscriptions');
  return data;
}

/** Cancel a subscription. */
export async function cancelPackSubscription(subscriptionId: string) {
  const { data } = await clientApi.post(`/packs/subscriptions/${subscriptionId}/cancel`);
  return data;
}
