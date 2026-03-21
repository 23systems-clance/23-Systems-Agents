import { api } from '@/lib/api-client';
import type { JobsResponse, JobDetail } from '@/types/api';

export async function fetchJobs(params?: Record<string, string>): Promise<JobsResponse> {
  const { data } = await api.get<JobsResponse>('/jobs', { params });
  return data;
}

export async function fetchJobDetail(id: string): Promise<JobDetail> {
  const { data } = await api.get<JobDetail>(`/jobs/${id}`);
  return data;
}
