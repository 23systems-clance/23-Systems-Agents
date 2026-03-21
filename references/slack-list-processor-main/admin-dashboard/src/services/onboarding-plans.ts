import { api } from '@/lib/api-client';
import type {
  OnboardingPlansResponse,
  OnboardingPlanResponse,
  OnboardingPlanCreateInput,
  OnboardingPlanDetail,
  PlanPreviewResponse,
} from '@/types/api';

/** List onboarding plans for a workspace. */
export async function fetchOnboardingPlans(
  teamId: string,
  latestOnly = true,
): Promise<OnboardingPlansResponse> {
  const { data } = await api.get<OnboardingPlansResponse>('/onboarding-plans', {
    params: { teamId, latestOnly },
  });
  return data;
}

/** Get a single onboarding plan with all modules and items. */
export async function fetchOnboardingPlan(planId: string): Promise<OnboardingPlanResponse> {
  const { data } = await api.get<OnboardingPlanResponse>(`/onboarding-plans/${planId}`);
  return data;
}

/** Create a new onboarding plan. */
export async function createOnboardingPlan(
  input: OnboardingPlanCreateInput,
): Promise<{ plan: OnboardingPlanDetail }> {
  const { data } = await api.post<{ plan: OnboardingPlanDetail }>('/onboarding-plans', input);
  return data;
}

/** Update an existing onboarding plan. */
export async function updateOnboardingPlan(
  planId: string,
  input: Partial<OnboardingPlanCreateInput>,
): Promise<{ plan: OnboardingPlanDetail; new_version_created?: boolean; message?: string }> {
  const { data } = await api.put<{
    plan: OnboardingPlanDetail;
    new_version_created?: boolean;
    message?: string;
  }>(`/onboarding-plans/${planId}`, input);
  return data;
}

/** Delete (archive) an onboarding plan. */
export async function deleteOnboardingPlan(
  planId: string,
): Promise<{ message: string; plan_id: string }> {
  const { data } = await api.delete<{ message: string; plan_id: string }>(
    `/onboarding-plans/${planId}`,
  );
  return data;
}

/** Duplicate a plan as a new template. */
export async function duplicateOnboardingPlan(
  planId: string,
  name: string,
): Promise<{ plan: OnboardingPlanDetail }> {
  const { data } = await api.post<{ plan: OnboardingPlanDetail }>(
    `/onboarding-plans/${planId}/duplicate`,
    { name },
  );
  return data;
}

/** Preview the drip sequence for a plan. */
export async function fetchOnboardingPlanPreview(planId: string): Promise<PlanPreviewResponse> {
  const { data } = await api.get<PlanPreviewResponse>(`/onboarding-plans/${planId}/preview`);
  return data;
}
