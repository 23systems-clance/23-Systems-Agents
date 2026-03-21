/**
 * MCP Server Registry API service (Feature 39 - Vertical Pack Platform).
 */

import { api } from '@/lib/api-client';

export interface McpServerSummary {
  id: string;
  name: string;
  slug: string;
  provider: string;
  status: 'HEALTHY' | 'ERROR' | 'UNKNOWN';
  byokEnabled: boolean;
  toolCount: number;
  lastHealthCheck: string | null;
  createdAt: string;
}

export interface McpServer {
  id: string;
  name: string;
  slug: string;
  provider: string;
  baseUrl: string;
  authType: 'API_KEY' | 'OAUTH2' | 'BEARER_TOKEN' | 'BASIC_AUTH' | 'NONE';
  status: 'HEALTHY' | 'ERROR' | 'UNKNOWN';
  byokEnabled: boolean;
  rateLimitRpm: number | null;
  lastHealthCheck: string | null;
  createdAt: string;
  updatedAt: string;
  tools?: McpTool[];
}

export interface McpTool {
  id: string;
  serverId: string;
  name: string;
  description: string | null;
  inputSchema: Record<string, unknown> | null;
  outputSchema: Record<string, unknown> | null;
  creditCost: number;
  createdAt: string;
}

export interface HealthCheckResult {
  status: 'HEALTHY' | 'ERROR';
  latencyMs: number;
  error?: string;
}

export async function listMcpServers(status?: string) {
  const params = status ? { status } : {};
  const { data } = await api.get<{ servers: McpServerSummary[] }>('/mcp-servers', { params });
  return data;
}

export async function getMcpServer(serverId: string) {
  const { data } = await api.get<McpServer>(`/mcp-servers/${serverId}`);
  return data;
}

export async function createMcpServer(input: {
  name: string;
  slug: string;
  provider: string;
  baseUrl: string;
  authType: string;
  credentials?: string;
  byokEnabled?: boolean;
  rateLimitRpm?: number;
}) {
  const { data } = await api.post<McpServer>('/mcp-servers', input);
  return data;
}

export async function updateMcpServer(serverId: string, input: Record<string, unknown>) {
  const { data } = await api.put<McpServer>(`/mcp-servers/${serverId}`, input);
  return data;
}

export async function deleteMcpServer(serverId: string) {
  await api.delete(`/mcp-servers/${serverId}`);
}

export async function runHealthCheck(serverId: string) {
  const { data } = await api.post<HealthCheckResult>(`/mcp-servers/${serverId}/health`);
  return data;
}

export async function listMcpTools(serverId: string) {
  const { data } = await api.get<{ tools: McpTool[] }>(`/mcp-servers/${serverId}/tools`);
  return data;
}

export async function addMcpTool(serverId: string, input: {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  creditCost?: number;
}) {
  const { data } = await api.post<McpTool>(`/mcp-servers/${serverId}/tools`, input);
  return data;
}

export async function updateMcpTool(serverId: string, toolId: string, input: Record<string, unknown>) {
  const { data } = await api.put<McpTool>(`/mcp-servers/${serverId}/tools/${toolId}`, input);
  return data;
}

export async function deleteMcpTool(serverId: string, toolId: string) {
  await api.delete(`/mcp-servers/${serverId}/tools/${toolId}`);
}
