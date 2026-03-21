import { api } from '@/lib/api-client';

export interface OnboardingDashboard {
  total_active_enrollments: number;
  total_supervised: number;
  total_pending_graduation: number;
  total_graduated_all_time: number;
  average_progress_percentage: number;
  average_graduation_days: number | null;
  common_struggle_modules: Array<{
    module_title: string;
    day_number: number;
    incomplete_rate: number;
  }>;
  alerts: Array<{
    type: 'behind_schedule' | 'overdue' | 'quiz_failed';
    enrollment_id: string;
    bdr_name: string;
    days_behind?: number;
    current_module?: string;
    days_past_expected?: number;
    quiz_topic?: string;
    score?: number;
  }>;
  recent_graduates: Array<{
    bdr_name: string;
    plan_name: string;
    graduated_at: string;
    completion_days: number;
  }>;
}

export interface CheckinEntry {
  id: string;
  day_number: number;
  automation_type: string;
  prompt: string;
  response: string;
  responded_at: string;
}

const TEAM_ID = 'T_DEFAULT';

export async function fetchOnboardingDashboard(): Promise<OnboardingDashboard> {
  const { data } = await api.get<{ dashboard: OnboardingDashboard }>(
    '/admin/onboarding-progress/dashboard',
    { params: { teamId: TEAM_ID } },
  );
  return data.dashboard;
}

export async function fetchEnrollmentCheckins(enrollmentId: string): Promise<CheckinEntry[]> {
  const { data } = await api.get<{ checkins: CheckinEntry[] }>(
    `/admin/onboarding-progress/${enrollmentId}/checkins`,
  );
  return data.checkins;
}
