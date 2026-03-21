import { api } from '@/lib/api-client';
import type {
  ManagedClientsResponse,
  ManagedClientDetail,
  ManagedClientEntry,
  ManagedClientCreateInput,
  ManagedClientUpdateInput,
  HubSpotClientResponse,
} from '@/types/api';

export async function fetchManagedClients(
  params?: Record<string, string>,
): Promise<ManagedClientsResponse> {
  const { data } = await api.get<ManagedClientsResponse>('/clients', { params });
  return data;
}

export async function fetchManagedClientDetail(id: string): Promise<ManagedClientDetail> {
  const { data } = await api.get<ManagedClientDetail>(`/clients/${id}`);
  return data;
}

export async function createManagedClient(
  input: ManagedClientCreateInput,
): Promise<ManagedClientEntry> {
  const { data } = await api.post<ManagedClientEntry>('/clients', input);
  return data;
}

export async function updateManagedClient(
  id: string,
  input: ManagedClientUpdateInput,
): Promise<ManagedClientEntry> {
  const { data } = await api.put<ManagedClientEntry>(`/clients/${id}`, input);
  return data;
}

export async function deactivateManagedClient(id: string): Promise<void> {
  await api.delete(`/clients/${id}`);
}

export async function associateBdrToClient(clientId: string, bdrId: string): Promise<void> {
  await api.post(`/clients/${clientId}/bdrs`, { bdrId });
}

export async function disassociateBdrFromClient(
  clientId: string,
  bdrId: string,
): Promise<void> {
  await api.delete(`/clients/${clientId}/bdrs/${bdrId}`);
}

export async function fetchClientHubspot(clientId: string): Promise<HubSpotClientResponse> {
  const { data } = await api.get<HubSpotClientResponse>(`/clients/${clientId}/hubspot`);
  return data;
}

export async function disconnectClientHubspot(clientId: string): Promise<void> {
  await api.delete(`/clients/${clientId}/hubspot`);
}
