import { api } from '@/lib/api-client';
import type { OverviewResponse } from '@/types/api';

export async function fetchOverview(params?: { start_date?: string; end_date?: string }): Promise<OverviewResponse> {
  const { data } = await api.get<OverviewResponse>('/overview', { params });
  return data;
}
