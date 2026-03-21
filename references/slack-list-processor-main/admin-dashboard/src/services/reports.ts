import { api } from '@/lib/api-client';
import type { ScheduledReportsResponse, ScheduledReport, ScheduledReportInput } from '@/types/api';

export async function exportReport(params: {
  report_type: string;
  start_date: string;
  end_date: string;
  filters?: Record<string, string>;
}): Promise<Blob> {
  const { data } = await api.post('/reports/export', params, {
    responseType: 'blob',
  });
  return data;
}

export async function fetchScheduledReports(): Promise<ScheduledReportsResponse> {
  const { data } = await api.get<ScheduledReportsResponse>('/reports/scheduled');
  return data;
}

export async function createScheduledReport(input: ScheduledReportInput): Promise<ScheduledReport> {
  const { data } = await api.post<ScheduledReport>('/reports/scheduled', input);
  return data;
}

export async function updateScheduledReport(id: string, input: Partial<ScheduledReportInput>): Promise<ScheduledReport> {
  const { data } = await api.put<ScheduledReport>(`/reports/scheduled/${id}`, input);
  return data;
}

export async function deleteScheduledReport(id: string): Promise<void> {
  await api.delete(`/reports/scheduled/${id}`);
}
