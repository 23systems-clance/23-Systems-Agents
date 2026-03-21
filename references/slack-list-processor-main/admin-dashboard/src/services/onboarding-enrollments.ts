import { api } from '@/lib/api-client';
import type {
  OnboardingEnrollmentsResponse,
  OnboardingEnrollmentDetailResponse,
  OnboardingEnrollBdrInput,
  OnboardingEnrollmentUpdateInput,
  OnboardingEnrollmentDetail,
  OnboardingEnrollmentStatus,
} from '@/types/api';

/** List onboarding enrollments for a workspace, optionally filtered by status. */
export async function fetchOnboardingEnrollments(
  teamId: string,
  status?: OnboardingEnrollmentStatus,
): Promise<OnboardingEnrollmentsResponse> {
  const params: Record<string, string> = { teamId };
  if (status) params.status = status;
  const { data } = await api.get<OnboardingEnrollmentsResponse>('/onboarding-enrollments', {
    params,
  });
  return data;
}

/** Get a single onboarding enrollment with module progress. */
export async function fetchOnboardingEnrollment(
  enrollmentId: string,
): Promise<OnboardingEnrollmentDetailResponse> {
  const { data } = await api.get<OnboardingEnrollmentDetailResponse>(
    `/onboarding-enrollments/${enrollmentId}`,
  );
  return data;
}

/** Enroll a BDR in an onboarding plan. */
export async function enrollBdr(
  input: OnboardingEnrollBdrInput,
): Promise<{ enrollment: OnboardingEnrollmentDetail }> {
  const { data } = await api.post<{ enrollment: OnboardingEnrollmentDetail }>(
    '/onboarding-enrollments',
    input,
  );
  return data;
}

/** Update an existing enrollment (delivery settings). */
export async function updateEnrollment(
  enrollmentId: string,
  input: OnboardingEnrollmentUpdateInput,
): Promise<{ enrollment: OnboardingEnrollmentDetail }> {
  const { data } = await api.put<{ enrollment: OnboardingEnrollmentDetail }>(
    `/onboarding-enrollments/${enrollmentId}`,
    input,
  );
  return data;
}

/** Cancel an active enrollment with an optional reason. */
export async function cancelEnrollment(
  enrollmentId: string,
  reason?: string,
): Promise<{ message: string; enrollment_id: string }> {
  const { data } = await api.post<{ message: string; enrollment_id: string }>(
    `/onboarding-enrollments/${enrollmentId}/cancel`,
    reason ? { reason } : undefined,
  );
  return data;
}

/** Graduate an enrollment that has completed all modules. */
export async function graduateEnrollment(
  enrollmentId: string,
): Promise<{ message: string; enrollment_id: string }> {
  const { data } = await api.post<{ message: string; enrollment_id: string }>(
    `/onboarding-enrollments/${enrollmentId}/graduate`,
  );
  return data;
}

/** Extend an enrollment by additional days with a reason. */
export async function extendEnrollment(
  enrollmentId: string,
  additionalDays: number,
  reason: string,
): Promise<{ message: string; enrollment_id: string; new_end_date: string }> {
  const { data } = await api.post<{
    message: string;
    enrollment_id: string;
    new_end_date: string;
  }>(`/onboarding-enrollments/${enrollmentId}/extend`, {
    additional_days: additionalDays,
    reason,
  });
  return data;
}
