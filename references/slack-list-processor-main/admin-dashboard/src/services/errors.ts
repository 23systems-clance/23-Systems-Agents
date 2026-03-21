import { api } from '@/lib/api-client';
import type { ErrorsResponse, ErrorDetail, ErrorTrendsResponse } from '@/types/api';

export async function fetchErrors(params?: Record<string, string>): Promise<ErrorsResponse> {
  const { data } = await api.get<ErrorsResponse>('/errors', { params });
  return data;
}

export async function fetchErrorDetail(id: string): Promise<ErrorDetail> {
  const { data } = await api.get<ErrorDetail>(`/errors/${id}`);
  return data;
}

export async function updateErrorState(id: string, lifecycle_state: string): Promise<ErrorDetail> {
  const { data } = await api.patch<ErrorDetail>(`/errors/${id}`, { lifecycle_state });
  return data;
}

export async function fetchErrorTrends(params?: Record<string, string>): Promise<ErrorTrendsResponse> {
  const { data } = await api.get<ErrorTrendsResponse>('/errors/trends', { params });
  return data;
}
