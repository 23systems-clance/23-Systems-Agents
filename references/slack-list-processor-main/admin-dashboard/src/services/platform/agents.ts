/**
 * Agent Registry API service (Feature 39 - Vertical Pack Platform).
 */

import { api } from '@/lib/api-client';

export interface Agent {
  id: string;
  name: string;
  slug: string;
  description?: string;
  status: 'DRAFT' | 'TESTING' | 'PUBLISHED' | 'DEPRECATED';
  modelId: string;
  maxTokens: number;
  creditCost: number;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  toolIds: string[];
  createdAt: string;
  updatedAt: string;
  versions?: AgentVersion[];
}

export interface AgentVersion {
  id: string;
  agentId: string;
  version: number;
  status: string;
  systemPrompt: string;
  modelId: string;
  maxTokens: number;
  toolIds: string[];
  changeNote?: string;
  publishedAt?: string;
  createdAt: string;
}

export interface AgentSummary {
  id: string;
  name: string;
  slug: string;
  status: string;
  modelId: string;
  currentVersion: number;
  creditCost: number;
  skillCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface AgentTestResult {
  output: unknown;
  tokensInput: number;
  tokensOutput: number;
  costUsd: number;
  durationMs: number;
  modelId: string;
  toolCallsMade: Array<{ toolName: string; input: unknown; output: unknown }>;
  agentId: string;
  versionId: string;
  versionNumber: number;
}

export async function listAgents(params?: { status?: string; page?: number; limit?: number }) {
  const { data } = await api.get<{ agents: AgentSummary[]; total: number; page: number }>('/agents', { params });
  return data;
}

export async function getAgent(agentId: string) {
  const { data } = await api.get<Agent & { versions: AgentVersion[] }>(`/agents/${agentId}`);
  return data;
}

export async function createAgent(input: {
  name: string;
  slug: string;
  description?: string;
  modelId: string;
  systemPrompt: string;
  maxTokens: number;
  creditCost: number;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  toolIds?: string[];
}) {
  const { data } = await api.post<Agent>('/agents', input);
  return data;
}

export async function updateAgent(agentId: string, input: Record<string, unknown>) {
  const { data } = await api.put<Agent>(`/agents/${agentId}`, input);
  return data;
}

export async function deleteAgent(agentId: string) {
  await api.delete(`/agents/${agentId}`);
}

export async function testAgent(agentId: string, input: Record<string, unknown>, versionId?: string) {
  const { data } = await api.post<AgentTestResult>(`/agents/${agentId}/test`, { input, versionId });
  return data;
}

export async function publishAgent(agentId: string) {
  const { data } = await api.post<Agent>(`/agents/${agentId}/publish`);
  return data;
}

export async function deprecateAgent(agentId: string) {
  const { data } = await api.post<Agent>(`/agents/${agentId}/deprecate`);
  return data;
}
