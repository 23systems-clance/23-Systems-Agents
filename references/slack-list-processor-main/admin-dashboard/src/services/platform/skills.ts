/**
 * Skills API service (Feature 39 - Vertical Pack Platform).
 */

import { api } from '@/lib/api-client';

export interface SkillSummary {
  id: string;
  name: string;
  slug: string;
  status: 'DRAFT' | 'TESTING' | 'PUBLISHED' | 'DEPRECATED';
  triggerType: string;
  agentName: string;
  agentVersion: number;
  creditCost: number;
  totalExecutions: number;
  createdAt: string;
}

export interface Skill {
  id: string;
  name: string;
  slug: string;
  description?: string;
  status: 'DRAFT' | 'TESTING' | 'PUBLISHED' | 'DEPRECATED';
  agentId: string;
  agentVersionId: string;
  triggerType: string;
  triggerConfig?: Record<string, unknown>;
  deliveryChannels: string[];
  deliveryConfig?: Record<string, unknown>;
  mcpToolIds: string[];
  inputMapping?: Record<string, unknown>;
  outputMapping?: Record<string, unknown>;
  creditCost: number;
  retryPolicy?: { maxRetries?: number; backoffMs?: number };
  chainEventName?: string;
  createdAt: string;
  updatedAt: string;
  agent?: { id: string; name: string };
  agentVersion?: { id: string; version: number; status: string };
  stats?: {
    totalExecutions: number;
    successRate: number;
    avgDurationMs: number;
    totalCreditsConsumed: number;
    last7DaysExecutions: number;
  };
  versionCheck?: {
    currentVersion: number;
    latestPublishedVersion: number;
    updateAvailable: boolean;
  };
}

export interface SkillExecutionResult {
  executionId: string;
  status: 'COMPLETED' | 'FAILED';
  output: unknown;
  creditsCost: number;
  durationMs: number;
  trace: {
    agentInvocations: Array<{
      versionId: string;
      tokensInput: number;
      tokensOutput: number;
      costUsd: number;
      durationMs: number;
    }>;
    toolCalls: Array<{
      toolId: string;
      toolName: string;
      durationMs: number;
      statusCode: number;
      error?: string;
    }>;
  };
}

export async function listSkills(params?: { status?: string; triggerType?: string }) {
  const { data } = await api.get<{ skills: SkillSummary[]; total: number }>('/skills', { params });
  return data;
}

export async function getSkill(skillId: string) {
  const { data } = await api.get<Skill>(`/skills/${skillId}`);
  return data;
}

export async function createSkill(input: {
  name: string;
  slug: string;
  description?: string;
  agentId: string;
  agentVersionId: string;
  triggerType: string;
  triggerConfig?: Record<string, unknown>;
  deliveryChannels?: string[];
  mcpToolIds?: string[];
  creditCost: number;
  retryPolicy?: { maxRetries?: number; backoffMs?: number };
  chainEventName?: string;
}) {
  const { data } = await api.post<Skill>('/skills', input);
  return data;
}

export async function updateSkill(skillId: string, input: Record<string, unknown>) {
  const { data } = await api.put<Skill>(`/skills/${skillId}`, input);
  return data;
}

export async function testSkill(skillId: string, input: Record<string, unknown>) {
  const { data } = await api.post<SkillExecutionResult>(`/skills/${skillId}/test`, { input });
  return data;
}

export async function publishSkill(skillId: string) {
  const { data } = await api.post<Skill>(`/skills/${skillId}/publish`);
  return data;
}

export async function deprecateSkill(skillId: string) {
  const { data } = await api.post<Skill>(`/skills/${skillId}/deprecate`);
  return data;
}

export async function checkSkillVersion(skillId: string) {
  const { data } = await api.get<{ currentVersion: number; latestPublishedVersion: number; updateAvailable: boolean }>(`/skills/${skillId}/version-check`);
  return data;
}
