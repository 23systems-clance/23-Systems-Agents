/**
 * Vertical Packs API service (Feature 39 - Vertical Pack Platform).
 */

import { api } from '@/lib/api-client';

export interface PackSummary {
  id: string;
  name: string;
  slug: string;
  category: string;
  status: 'DRAFT' | 'PUBLISHED' | 'DEPRECATED';
  tier: string;
  monthlyPriceUsd: number;
  skillCount: number;
  subscriberCount: number;
  createdAt: string;
}

export interface Pack {
  id: string;
  name: string;
  slug: string;
  description?: string;
  category: string;
  status: string;
  tier: string;
  monthlyPriceUsd: number;
  creditsIncluded: number;
  overageRateUsd: number;
  createdAt: string;
  updatedAt: string;
  skills?: Array<{
    id: string;
    name: string;
    slug: string;
    creditCost: number;
    status: string;
    sortOrder: number;
  }>;
  analytics?: {
    subscriberCount: number;
    activeUsers: number;
    totalCreditsUsed: number;
    totalRevenue: number;
    churnRate: number;
  };
}

export async function listPacks(params?: { status?: string; category?: string }) {
  const { data } = await api.get<{ packs: PackSummary[] }>('/packs', { params });
  return data;
}

export async function getPack(packId: string) {
  const { data } = await api.get<Pack>(`/packs/${packId}`);
  return data;
}

export async function createPack(input: {
  name: string;
  slug: string;
  description?: string;
  category: string;
  tier: string;
  monthlyPriceUsd?: number;
  creditsIncluded: number;
  overageRateUsd?: number;
  skillIds?: string[];
}) {
  const { data } = await api.post<Pack>('/packs', input);
  return data;
}

export async function updatePack(packId: string, input: Record<string, unknown>) {
  const { data } = await api.put<Pack>(`/packs/${packId}`, input);
  return data;
}

export async function publishPack(packId: string) {
  const { data } = await api.post<Pack>(`/packs/${packId}/publish`);
  return data;
}

export async function deprecatePack(packId: string) {
  const { data } = await api.post<Pack>(`/packs/${packId}/deprecate`);
  return data;
}

export async function assignPackSkills(packId: string, skillIds: string[]) {
  const { data } = await api.put(`/packs/${packId}/skills`, { skillIds });
  return data;
}
