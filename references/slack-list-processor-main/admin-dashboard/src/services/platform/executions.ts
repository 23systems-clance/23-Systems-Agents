/**
 * Execution Logs & Analytics API service (Feature 39).
 */

import { api } from '@/lib/api-client';

export interface ExecutionSummary {
  id: string;
  skillName: string;
  slackTeamId: string;
  status: string;
  triggerType: string;
  creditsCost: number;
  durationMs: number | null;
  createdAt: string;
}

export interface AgentInvocationTrace {
  id: string;
  agentName: string;
  agentVersion: number;
  input: unknown;
  output: unknown;
  tokensInput: number;
  tokensOutput: number;
  costUsd: number;
  durationMs: number;
  toolCallsMade: unknown[];
}

export interface ExecutionTrace {
  id: string;
  skillName: string;
  skillId: string;
  status: string;
  triggerType: string;
  triggerSource: string | null;
  input: unknown;
  output: unknown;
  creditsCost: number;
  packSubscriptionId: string | null;
  errorMessage: string | null;
  retryCount: number;
  startedAt: string | null;
  completedAt: string | null;
  agentInvocations: AgentInvocationTrace[];
}

export interface SkillAnalytics {
  skillId: string;
  skillName: string;
  totalExecutions: number;
  successRate: number;
  avgDurationMs: number;
  totalCreditsConsumed: number;
  totalCostUsd: number;
}

export interface PackAnalytics {
  packId: string;
  packName: string;
  subscriberCount: number;
  activeUsers: number;
  totalCreditsUsed: number;
  totalCreditsIncluded: number;
  overageRevenue: number;
  churnRate: number;
  monthlyRecurringRevenue: number;
}

export interface WorkspaceAnalytics {
  slackTeamId: string;
  teamName: string;
  activePacks: number;
  totalExecutions: number;
  totalCreditsUsed: number;
  dailySpendUsedUsd: number;
  dailySpendLimitUsd: number;
}

export async function listExecutions(params?: {
  skillId?: string;
  slackTeamId?: string;
  status?: string;
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
}) {
  const { data } = await api.get<{ executions: ExecutionSummary[]; total: number }>(
    '/executions',
    { params },
  );
  return data;
}

export async function getExecutionTrace(executionId: string) {
  const { data } = await api.get<ExecutionTrace>(`/executions/${executionId}`);
  return data;
}

export async function getSkillAnalytics(params?: { from?: string; to?: string }) {
  const { data } = await api.get<{ skills: SkillAnalytics[] }>('/analytics/skills', { params });
  return data;
}

export async function getPackAnalytics(params?: { from?: string; to?: string }) {
  const { data } = await api.get<{ packs: PackAnalytics[] }>('/analytics/packs', { params });
  return data;
}

export async function getWorkspaceAnalytics() {
  const { data } = await api.get<{ workspaces: WorkspaceAnalytics[] }>('/analytics/workspaces');
  return data;
}
