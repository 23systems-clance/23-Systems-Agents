import { api } from '@/lib/api-client';
import type { UsageTrendsResponse, UsageLogsResponse } from '@/types/api';

export async function fetchUsageTrends(params?: Record<string, string>): Promise<UsageTrendsResponse> {
  const { data } = await api.get<UsageTrendsResponse>('/usage/trends', { params });
  return data;
}

export async function fetchUsageLogs(params?: Record<string, string>): Promise<UsageLogsResponse> {
  const { data } = await api.get<UsageLogsResponse>('/usage/logs', { params });
  return data;
}
