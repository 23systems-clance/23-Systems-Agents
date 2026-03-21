/**
 * Autonomous Agents API service (Feature 31).
 *
 * All endpoints live under /autonomous/ within the admin API.
 */

import { api } from '@/lib/api-client';

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export interface AutonomousAgent {
  id: string;
  name: string;
  description?: string;
  model: string;
  status: 'active' | 'paused' | 'error';
  suggestOnlyMode: boolean;
  lastExecutionAt?: string;
  pendingActionsCount: number;
  successRate: number;
  totalExecutions: number;
  createdAt: string;
  updatedAt: string;
}

export interface AutonomousAgentDetail extends AutonomousAgent {
  executionStats: {
    total: number;
    successRate: number;
    avgDurationMs: number;
    last24h: number;
  };
  recentExecutions: Array<{
    id: string;
    status: string;
    durationMs: number;
    createdAt: string;
  }>;
  pendingActions: Array<AuditAction>;
}

export interface AuditAction {
  id: string;
  agentId: string;
  agentName: string;
  action: string;
  confidence: number;
  severity: string;
  outcome: string;
  reason?: string;
  createdAt: string;
}

export interface AuditEntry {
  id: string;
  agentName: string;
  action: string;
  confidence: number;
  severity: string;
  outcome: string;
  createdAt: string;
}

export interface SystemEvent {
  id: string;
  type: string;
  severity: string;
  message: string;
  agentName?: string;
  acknowledged: boolean;
  createdAt: string;
}

export interface AutonomousTeam {
  id: string;
  name: string;
  description?: string;
  agentCount: number;
  activeAgents: number;
  pendingActions: number;
  agents?: Array<{
    id: string;
    name: string;
    status: string;
    suggestOnlyMode: boolean;
  }>;
  createdAt: string;
  updatedAt: string;
}

export interface DashboardData {
  totalAgents: number;
  activeAgents: number;
  pendingActions: number;
  actionsLast24h: number;
  agents: Array<{
    id: string;
    name: string;
    status: string;
    suggestOnlyMode: boolean;
    pendingActionsCount: number;
  }>;
  recentActions: AuditEntry[];
  unacknowledgedEvents: SystemEvent[];
  teams: Array<{
    id: string;
    name: string;
    agentCount: number;
    activeAgents: number;
  }>;
}

/* ------------------------------------------------------------------ */
/* Dashboard                                                           */
/* ------------------------------------------------------------------ */

/** Fetch aggregated dashboard data. */
export async function fetchDashboard(): Promise<DashboardData> {
  const { data } = await api.get<DashboardData>('/autonomous/dashboard');
  return data;
}

/* ------------------------------------------------------------------ */
/* Agents                                                              */
/* ------------------------------------------------------------------ */

/** List agents with optional filters. */
export async function fetchAgents(params?: Record<string, string>): Promise<AutonomousAgent[]> {
  const { data } = await api.get<AutonomousAgent[]>('/autonomous/agents', { params });
  return data;
}

/** Get agent detail including execution stats and pending actions. */
export async function fetchAgentDetail(agentId: string): Promise<AutonomousAgentDetail> {
  const { data } = await api.get<AutonomousAgentDetail>(`/autonomous/agents/${agentId}`);
  return data;
}

/** Toggle suggest-only mode for an agent. */
export async function updateAgentMode(agentId: string, suggestOnlyMode: boolean): Promise<void> {
  await api.put(`/autonomous/agents/${agentId}/mode`, { suggestOnlyMode });
}

/** Approve a pending audit action. */
export async function approveAction(agentId: string, auditActionId: string): Promise<void> {
  await api.post(`/autonomous/agents/${agentId}/approve/${auditActionId}`);
}

/** Reject a pending audit action with a reason. */
export async function rejectAction(agentId: string, auditActionId: string, reason: string): Promise<void> {
  await api.post(`/autonomous/agents/${agentId}/reject/${auditActionId}`, { reason });
}

/* ------------------------------------------------------------------ */
/* Audit Trail                                                         */
/* ------------------------------------------------------------------ */

export interface AuditResponse {
  entries: AuditEntry[];
  total: number;
}

/** Fetch paginated audit trail. */
export async function fetchAudit(params?: Record<string, string>): Promise<AuditResponse> {
  const { data } = await api.get<AuditResponse>('/autonomous/audit', { params });
  return data;
}

/* ------------------------------------------------------------------ */
/* System Events                                                       */
/* ------------------------------------------------------------------ */

export interface EventsResponse {
  events: SystemEvent[];
  total: number;
}

/** Fetch paginated system events. */
export async function fetchEvents(params?: Record<string, string>): Promise<EventsResponse> {
  const { data } = await api.get<EventsResponse>('/autonomous/events', { params });
  return data;
}

/** Acknowledge a system event. */
export async function acknowledgeEvent(eventId: string): Promise<void> {
  await api.post(`/autonomous/events/${eventId}/acknowledge`);
}

/* ------------------------------------------------------------------ */
/* Teams                                                               */
/* ------------------------------------------------------------------ */

/** List all teams. */
export async function fetchTeams(params?: Record<string, string>): Promise<AutonomousTeam[]> {
  const { data } = await api.get<AutonomousTeam[]>('/autonomous/teams', { params });
  return data;
}

/** Get team detail. */
export async function fetchTeamDetail(teamId: string): Promise<AutonomousTeam> {
  const { data } = await api.get<AutonomousTeam>(`/autonomous/teams/${teamId}`);
  return data;
}

/** Create a new team. */
export async function createTeam(input: { name: string; description?: string; agentIds?: string[] }): Promise<AutonomousTeam> {
  const { data } = await api.post<AutonomousTeam>('/autonomous/teams', input);
  return data;
}

/** Update a team. */
export async function updateTeam(teamId: string, input: { name?: string; description?: string; agentIds?: string[] }): Promise<AutonomousTeam> {
  const { data } = await api.put<AutonomousTeam>(`/autonomous/teams/${teamId}`, input);
  return data;
}
