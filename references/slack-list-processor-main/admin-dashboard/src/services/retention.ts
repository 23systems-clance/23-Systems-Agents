import { api } from '@/lib/api-client';
import type { RetentionResponse, RetentionConfig } from '@/types/api';

export async function fetchRetention(): Promise<RetentionResponse> {
  const { data } = await api.get<RetentionResponse>('/retention');
  return data;
}

export async function updateRetention(dataType: string, retentionDays: number): Promise<RetentionConfig> {
  const { data } = await api.put<RetentionConfig>(`/retention/${dataType}`, {
    retention_days: retentionDays,
  });
  return data;
}
