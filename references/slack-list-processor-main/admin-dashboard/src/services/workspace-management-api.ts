/**
 * Workspace management API client (T048).
 *
 * Frontend service for workspace management admin endpoints.
 */

import { api } from '@/lib/api-client';
import type { FeatureFlags } from './licensing-api';

export interface WorkspaceOverview {
  slackTeamId: string;
  slackTeamName: string;
  workspaceType: 'PLATFORM_OWNER' | 'CLIENT';
  onboardingStatus: string;
  featureFlags: FeatureFlags;
  creditBalance: number;
  subscriptionTier: string | null;
  licenseKey: string | null;
  installedAt: string;
  billingExempt: boolean;
}

/** Lists all workspaces with status and feature flags. */
export async function listWorkspaces(params?: {
  onboardingStatus?: string;
  page?: number;
  limit?: number;
}) {
  const { data } = await api.get<{ workspaces: WorkspaceOverview[]; total: number; page: number }>(
    '/workspace-management',
    { params },
  );
  return data;
}

/** Gets feature flags for a workspace. */
export async function getWorkspaceFeatures(slackTeamId: string) {
  const { data } = await api.get<FeatureFlags>(
    `/workspace-management/${slackTeamId}/features`,
  );
  return data;
}

/** Updates feature flags for a workspace (partial update). */
export async function updateWorkspaceFeatures(
  slackTeamId: string,
  flags: Partial<FeatureFlags>,
) {
  const { data } = await api.patch<{ featureFlags: FeatureFlags; updatedAt: string }>(
    `/workspace-management/${slackTeamId}/features`,
    flags,
  );
  return data;
}

/** Manual credit adjustment. */
export async function adjustCredits(
  slackTeamId: string,
  amount: number,
  reason: string,
) {
  const { data } = await api.post<{ newBalance: number }>(
    `/workspace-management/${slackTeamId}/credits`,
    { amount, reason },
  );
  return data;
}
