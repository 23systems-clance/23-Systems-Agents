import { api } from '@/lib/api-client';
import type { ClientsResponse, ClientDetail } from '@/types/api';

export async function fetchClients(params?: Record<string, string>): Promise<ClientsResponse> {
  const { data } = await api.get<ClientsResponse>('/workspaces', { params });
  return data;
}

export async function fetchClientDetail(slackTeamId: string): Promise<ClientDetail> {
  const { data } = await api.get<ClientDetail>(`/workspaces/${slackTeamId}`);
  return data;
}
