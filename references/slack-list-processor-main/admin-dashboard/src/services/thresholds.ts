import { api } from '@/lib/api-client';
import type { ThresholdsResponse, Threshold, ThresholdCreateInput } from '@/types/api';

export async function fetchThresholds(): Promise<ThresholdsResponse> {
  const { data } = await api.get<ThresholdsResponse>('/thresholds');
  return data;
}

export async function createThreshold(input: ThresholdCreateInput): Promise<Threshold> {
  const { data } = await api.post<Threshold>('/thresholds', input);
  return data;
}

export async function updateThreshold(id: string, input: Partial<ThresholdCreateInput>): Promise<Threshold> {
  const { data } = await api.put<Threshold>(`/thresholds/${id}`, input);
  return data;
}

export async function deleteThreshold(id: string): Promise<void> {
  await api.delete(`/thresholds/${id}`);
}
