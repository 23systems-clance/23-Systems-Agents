/**
 * Licensing API client (T048).
 *
 * Frontend service for license key management admin endpoints.
 */

import { api } from '@/lib/api-client';

export interface FeatureFlags {
  enrichment: boolean;
  campaigns: boolean;
  workflows: boolean;
  onboarding: boolean;
  dialer: boolean;
  analytics: boolean;
  icpAnalysis: boolean;
  personalityAnalysis: boolean;
  aiAgent: boolean;
}

export interface LicenseKey {
  id: string;
  key: string;
  featureFlags: FeatureFlags;
  initialCredits: number;
  subscriptionTier: string;
  singleUse: boolean;
  expiresAt: string | null;
  activatedWorkspaceId: string | null;
  activatedAt: string | null;
  revokedAt: string | null;
  notes: string | null;
  createdByAdminId: string;
  createdByAdmin?: { email: string; displayName: string };
  activatedWorkspace?: { slackTeamId: string; slackTeamName: string };
  createdAt: string;
}

export interface CreateLicenseKeyInput {
  featureFlags: FeatureFlags;
  initialCredits: number;
  subscriptionTier: string;
  expiresAt?: string | null;
  notes?: string | null;
}

/** Lists license keys with optional status filter. */
export async function listLicenseKeys(params?: {
  status?: string;
  page?: number;
  limit?: number;
}) {
  const { data } = await api.get<{ keys: LicenseKey[]; total: number; page: number }>(
    '/licenses',
    { params },
  );
  return data;
}

/** Creates a new license key. */
export async function createLicenseKey(input: CreateLicenseKeyInput) {
  const { data } = await api.post<LicenseKey>('/licenses', input);
  return data;
}

/** Gets a single license key by ID. */
export async function getLicenseKey(id: string) {
  const { data } = await api.get<LicenseKey>(`/licenses/${id}`);
  return data;
}

/** Revokes a license key. */
export async function revokeLicenseKey(id: string) {
  const { data } = await api.post<{ success: boolean; revokedAt: string }>(
    `/licenses/${id}/revoke`,
  );
  return data;
}
