import { api } from '@/lib/api-client';
import type {
  BdrsResponse,
  BdrDetail,
  BdrEntry,
  BdrCreateInput,
  BdrUpdateInput,
} from '@/types/api';

export async function fetchBdrs(params?: Record<string, string>): Promise<BdrsResponse> {
  const { data } = await api.get<BdrsResponse>('/bdrs', { params });
  return data;
}

export async function fetchBdrDetail(id: string): Promise<BdrDetail> {
  const { data } = await api.get<BdrDetail>(`/bdrs/${id}`);
  return data;
}

export async function createBdr(input: BdrCreateInput): Promise<BdrEntry> {
  const { data } = await api.post<BdrEntry>('/bdrs', input);
  return data;
}

export async function updateBdr(id: string, input: BdrUpdateInput): Promise<BdrEntry> {
  const { data } = await api.put<BdrEntry>(`/bdrs/${id}`, input);
  return data;
}

export async function deactivateBdr(id: string): Promise<void> {
  await api.delete(`/bdrs/${id}`);
}

export async function associateClientToBdr(bdrId: string, clientId: string): Promise<void> {
  await api.post(`/bdrs/${bdrId}/clients`, { clientId });
}

export async function disassociateClientFromBdr(
  bdrId: string,
  clientId: string,
): Promise<void> {
  await api.delete(`/bdrs/${bdrId}/clients/${clientId}`);
}
