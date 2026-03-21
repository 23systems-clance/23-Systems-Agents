import { api } from '@/lib/api-client';

export interface ProviderCostRecord {
  id: string;
  provider: 'APOLLO' | 'WIZA' | 'AI_ARK' | 'FINDYMAIL';
  dataType: 'EMAIL' | 'PHONE';
  costPerUnit: number;
  creditsPerUnit: number | null;
  effectiveDate: string;
  expiresAt: string | null;
  notes: string | null;
  createdAt: string;
}

export interface ProviderCostsResponse {
  costs: ProviderCostRecord[];
  total: number;
}

export interface CreateProviderCostBody {
  provider: string;
  dataType: string;
  costPerUnit: number;
  creditsPerUnit?: number | null;
  notes?: string;
}

export async function fetchProviderCosts(
  params?: Record<string, string>,
): Promise<ProviderCostsResponse> {
  const { data } = await api.get<ProviderCostsResponse>('/provider-costs', { params });
  return data;
}

export async function createProviderCost(
  body: CreateProviderCostBody,
): Promise<ProviderCostRecord> {
  const { data } = await api.post<ProviderCostRecord>('/provider-costs', body);
  return data;
}

export async function updateProviderCost(
  id: string,
  body: Partial<CreateProviderCostBody>,
): Promise<ProviderCostRecord> {
  const { data } = await api.put<ProviderCostRecord>(`/provider-costs/${id}`, body);
  return data;
}

export async function deleteProviderCost(id: string): Promise<void> {
  await api.delete(`/provider-costs/${id}`);
}
