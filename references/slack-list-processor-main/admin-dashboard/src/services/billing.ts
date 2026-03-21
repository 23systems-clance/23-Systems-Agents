import { api } from '@/lib/api-client';

export interface BillingProfile {
  id: string;
  slackTeamId: string;
  workspaceName: string;
  status: 'PENDING' | 'ACTIVE' | 'SUSPENDED' | 'DELINQUENT';
  billingExempt: boolean;
  monthlyAllowance: number;
  creditBalance: number;
  maxRolloverCredits: number;
  overageRateUsd: string;
  billingCycleDay: number;
  lastResetAt: string | null;
  billingEmail: string | null;
  billingContactUserId: string | null;
  stripeCustomerId: string | null;
  stripePaymentMethodId: string | null;
  createdAt: string;
  updatedAt: string;
  recentTransactions?: CreditTransaction[];
}

export interface CreditTransaction {
  id: string;
  type: string;
  amount: number;
  balanceAfter: number;
  referenceId: string | null;
  description: string;
  metadata: any;
  createdAt: string;
}

export interface CreditRateConfig {
  id: string;
  builtWithCtuLookupCost: number;
  builtWithDomainLookupCost: number;
  apolloPeopleSearchCost: number;
  apolloBulkEnrichCost: number;
  markupPercent: number;
  effectiveCosts: {
    builtWithCtuLookup: number;
    builtWithDomainLookup: number;
    apolloPeopleSearch: number;
    apolloBulkEnrich: number;
  };
  isActive: boolean;
  updatedByAdminId: string | null;
  updatedAt: string;
}

export interface CreditRatePreview {
  current: Record<string, number>;
  preview: Record<string, number>;
}

export interface PaginatedProfiles {
  profiles: BillingProfile[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

export async function fetchBillingProfiles(params?: Record<string, string>): Promise<PaginatedProfiles> {
  const { data } = await api.get<PaginatedProfiles>('/billing/profiles', { params });
  return data;
}

export async function fetchBillingProfile(profileId: string): Promise<BillingProfile> {
  const { data } = await api.get<BillingProfile>(`/billing/profiles/${profileId}`);
  return data;
}

export async function createBillingProfile(body: Record<string, any>): Promise<BillingProfile> {
  const { data } = await api.post<BillingProfile>('/billing/profiles', body);
  return data;
}

export async function updateBillingProfile(profileId: string, body: Record<string, any>): Promise<BillingProfile> {
  const { data } = await api.put<BillingProfile>(`/billing/profiles/${profileId}`, body);
  return data;
}

export async function updateBillingStatus(profileId: string, status: string, reason?: string): Promise<BillingProfile> {
  const { data } = await api.put<BillingProfile>(`/billing/profiles/${profileId}/status`, { status, reason });
  return data;
}

export async function adjustCredits(profileId: string, amount: number, reason: string): Promise<{ transaction: CreditTransaction; newBalance: number }> {
  const { data } = await api.post<{ transaction: CreditTransaction; newBalance: number }>(`/billing/profiles/${profileId}/adjust`, { amount, reason });
  return data;
}

export async function sendMagicLink(profileId: string, expiresInHours?: number): Promise<{ magicLink: { id: string; token: string; expiresAt: string; url: string }; delivery: { slackDm: string; email: string; channelNotification: string } }> {
  const { data } = await api.post(`/billing/profiles/${profileId}/magic-link`, { expiresInHours });
  return data;
}

export async function fetchCreditRates(): Promise<CreditRateConfig> {
  const { data } = await api.get<CreditRateConfig>('/credit-rates');
  return data;
}

export async function updateCreditRates(body: Record<string, number>): Promise<CreditRateConfig> {
  const { data } = await api.put<CreditRateConfig>('/credit-rates', body);
  return data;
}

export async function previewCreditRates(params: Record<string, string>): Promise<CreditRatePreview> {
  const { data } = await api.get<CreditRatePreview>('/credit-rates/preview', { params });
  return data;
}

export interface PaginatedTransactions {
  transactions: CreditTransaction[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

export async function fetchTransactions(profileId: string, params?: Record<string, string>): Promise<PaginatedTransactions> {
  const { data } = await api.get<PaginatedTransactions>(`/billing/profiles/${profileId}/transactions`, { params });
  return data;
}

export interface BillingKpis {
  activeProfiles: number;
  delinquentProfiles: number;
  totalProfiles: number;
  totalOverageRevenue: number;
  totalCreditsConsumed: number;
  lowBalanceClients: number;
}

export async function fetchBillingKpis(): Promise<BillingKpis> {
  const { data } = await api.get<BillingKpis>('/billing/kpis');
  return data;
}
