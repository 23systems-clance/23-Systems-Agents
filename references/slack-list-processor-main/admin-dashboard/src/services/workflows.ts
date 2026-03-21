import { api } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type {
  WorkflowListResponse,
  WorkflowDetail,
  WorkflowVersionDetail,
  WorkflowGraph,
  WorkflowTemplateListResponse,
  WorkflowExecutionListResponse,
  WorkflowExecutionDetail,
  ValidationResultResponse,
  WorkflowAnalyticsResponse,
  WorkflowFunnelResponse,
  NodeAnalyticsResponse,
} from '@/types/api';

/**
 * Default team ID used across all workflow API calls.
 * Will be replaced by auth-context-derived value in the future.
 */
const DEFAULT_TEAM_ID = 'T_DEFAULT';

// ---------------------------------------------------------------------------
// Raw API functions
// ---------------------------------------------------------------------------

/** List workflows with optional filters. */
export async function fetchWorkflows(
  params?: Record<string, string>,
): Promise<WorkflowListResponse> {
  const { data } = await api.get<WorkflowListResponse>('/workflows', { params });
  return data;
}

/** Get a single workflow with all version summaries. */
export async function fetchWorkflow(
  id: string,
  teamId: string = DEFAULT_TEAM_ID,
): Promise<WorkflowDetail> {
  const { data } = await api.get<{ workflow: WorkflowDetail }>(`/workflows/${id}`, {
    params: { teamId },
  });
  return data.workflow;
}

/** Get a specific workflow version with its full graph. */
export async function fetchWorkflowVersion(
  workflowId: string,
  versionId: string,
): Promise<WorkflowVersionDetail> {
  const { data } = await api.get<{ version: WorkflowVersionDetail }>(
    `/workflows/${workflowId}/versions/${versionId}`,
  );
  return data.version;
}

/** Create a new workflow. Backend returns flat WorkflowDetail. */
export async function createWorkflow(input: {
  name: string;
  description?: string;
  trigger_type: string;
  slack_team_id: string;
  created_by_user_id: string;
  template_id?: string;
}): Promise<WorkflowDetail> {
  const { data } = await api.post<WorkflowDetail>('/workflows', input);
  return data;
}

/** Update a draft version's graph. */
export async function updateDraftVersion(
  workflowId: string,
  versionId: string,
  graph: WorkflowGraph,
  teamId: string = DEFAULT_TEAM_ID,
): Promise<WorkflowVersionDetail> {
  const { data } = await api.put<{ version: WorkflowVersionDetail }>(
    `/workflows/${workflowId}/versions/${versionId}`,
    { graph },
    { params: { teamId } },
  );
  return data.version;
}

/** Update a workflow's name and/or description. */
export async function updateWorkflowName(
  workflowId: string,
  name: string,
  description?: string,
  teamId: string = DEFAULT_TEAM_ID,
): Promise<WorkflowDetail> {
  const { data } = await api.put<{ workflow: WorkflowDetail }>(
    `/workflows/${workflowId}/name`,
    { name, description },
    { params: { teamId } },
  );
  return data.workflow;
}

/** Validate a workflow's current draft graph. */
export async function validateWorkflow(
  workflowId: string,
  teamId: string = DEFAULT_TEAM_ID,
): Promise<ValidationResultResponse> {
  const { data } = await api.post<ValidationResultResponse>(
    `/workflows/${workflowId}/validate`,
    {},
    { params: { teamId } },
  );
  return data;
}

/** Publish the current draft version. */
export async function publishWorkflow(
  workflowId: string,
  publishedByUserId: string,
  teamId: string = DEFAULT_TEAM_ID,
): Promise<WorkflowDetail> {
  const { data } = await api.post<WorkflowDetail>(
    `/workflows/${workflowId}/publish`,
    { published_by_user_id: publishedByUserId },
    { params: { teamId } },
  );
  return data;
}

/** Clone a workflow for a given team. */
export async function cloneWorkflow(
  workflowId: string,
  teamId: string,
  userId: string,
): Promise<WorkflowDetail> {
  const { data } = await api.post<WorkflowDetail>(
    `/workflows/${workflowId}/clone`,
    { created_by_user_id: userId },
    { params: { teamId } },
  );
  return data;
}

/** Archive a workflow. */
export async function archiveWorkflow(
  workflowId: string,
  teamId: string = DEFAULT_TEAM_ID,
): Promise<{ message: string }> {
  const { data } = await api.post<{ message: string }>(
    `/workflows/${workflowId}/archive`,
    {},
    { params: { teamId } },
  );
  return data;
}

/** Create a new draft version from the published version. */
export async function createDraftFromPublished(
  workflowId: string,
  teamId: string = DEFAULT_TEAM_ID,
): Promise<WorkflowVersionDetail> {
  const { data } = await api.post<{ version: WorkflowVersionDetail }>(
    `/workflows/${workflowId}/edit`,
    {},
    { params: { teamId } },
  );
  return data.version;
}

/** Delete a workflow. */
export async function deleteWorkflow(
  workflowId: string,
  teamId: string = DEFAULT_TEAM_ID,
): Promise<{ message: string }> {
  const { data } = await api.delete<{ message: string }>(`/workflows/${workflowId}`, {
    params: { teamId },
  });
  return data;
}

/** List available workflow templates. */
export async function fetchTemplates(
  teamId: string = DEFAULT_TEAM_ID,
): Promise<WorkflowTemplateListResponse> {
  const { data } = await api.get<WorkflowTemplateListResponse>('/workflows/templates', {
    params: { teamId },
  });
  return data;
}

/** List executions for a workflow. */
export async function fetchExecutions(
  workflowId: string,
  params?: Record<string, string>,
): Promise<WorkflowExecutionListResponse> {
  const merged = { teamId: DEFAULT_TEAM_ID, ...params };
  const { data } = await api.get<WorkflowExecutionListResponse>(
    `/workflows/${workflowId}/executions`,
    { params: merged },
  );
  return data;
}

/** Get a single execution detail. */
export async function fetchExecution(
  executionId: string,
): Promise<WorkflowExecutionDetail> {
  const { data } = await api.get<{ execution: WorkflowExecutionDetail }>(
    `/workflows/executions/${executionId}`,
  );
  return data.execution;
}

/** Cancel a running execution. */
export async function cancelExecution(
  executionId: string,
): Promise<{ message: string }> {
  const { data } = await api.post<{ message: string }>(
    `/workflows/executions/${executionId}/cancel`,
  );
  return data;
}

// ---------------------------------------------------------------------------
// TanStack Query hooks
// ---------------------------------------------------------------------------

/** Fetch all workflows with optional filter params. */
export function useWorkflows(params?: Record<string, string>) {
  return useQuery({
    queryKey: queryKeys.workflows.list(params),
    queryFn: () => fetchWorkflows(params),
  });
}

/** Fetch a single workflow by ID. */
export function useWorkflow(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.workflows.detail(id!),
    queryFn: () => fetchWorkflow(id!),
    enabled: !!id,
  });
}

/** Fetch a specific workflow version with its full graph. */
export function useWorkflowVersion(
  workflowId: string | undefined,
  versionId: string | undefined,
) {
  return useQuery({
    queryKey: queryKeys.workflows.version(workflowId!, versionId!),
    queryFn: () => fetchWorkflowVersion(workflowId!, versionId!),
    enabled: !!workflowId && !!versionId,
  });
}

/** Fetch available workflow templates. */
export function useTemplates() {
  return useQuery({
    queryKey: queryKeys.workflows.templates(),
    queryFn: () => fetchTemplates(),
  });
}

/** Create a new workflow. */
export function useCreateWorkflow() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createWorkflow,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflows', 'list'] });
    },
  });
}

/** Update a draft version's graph. */
export function useUpdateDraftVersion(workflowId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { versionId: string; graph: WorkflowGraph }) =>
      updateDraftVersion(workflowId, input.versionId, input.graph),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.workflows.detail(workflowId),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.workflows.version(workflowId, variables.versionId),
      });
    },
  });
}

/** Update a workflow's name and/or description. */
export function useUpdateWorkflowName(workflowId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; description?: string }) =>
      updateWorkflowName(workflowId, input.name, input.description),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.workflows.detail(workflowId),
      });
      queryClient.invalidateQueries({ queryKey: ['workflows', 'list'] });
    },
  });
}

/** Publish the current draft version. */
export function usePublishWorkflow(workflowId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (publishedByUserId: string) =>
      publishWorkflow(workflowId, publishedByUserId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.workflows.detail(workflowId),
      });
      queryClient.invalidateQueries({ queryKey: ['workflows', 'list'] });
    },
  });
}

/** Clone a workflow for a given team. */
export function useCloneWorkflow() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { workflowId: string; teamId: string; userId: string }) =>
      cloneWorkflow(input.workflowId, input.teamId, input.userId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflows', 'list'] });
    },
  });
}

/** Archive a workflow. */
export function useArchiveWorkflow() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (workflowId: string) => archiveWorkflow(workflowId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflows', 'list'] });
    },
  });
}

/** Create a new draft version from the published version. */
export function useCreateDraftFromPublished(workflowId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => createDraftFromPublished(workflowId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.workflows.detail(workflowId),
      });
    },
  });
}

/** Delete a workflow. */
export function useDeleteWorkflow() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (workflowId: string) => deleteWorkflow(workflowId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflows', 'list'] });
    },
  });
}

/** Validate a workflow's current draft graph. */
export function useValidateWorkflow(workflowId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => validateWorkflow(workflowId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.workflows.detail(workflowId),
      });
    },
  });
}

/** List executions for a workflow. */
export function useExecutions(
  workflowId: string | undefined,
  params?: Record<string, string>,
) {
  return useQuery({
    queryKey: queryKeys.workflows.executions(workflowId!, params),
    queryFn: () => fetchExecutions(workflowId!, params),
    enabled: !!workflowId,
  });
}

/** Fetch a single execution detail. */
export function useExecution(executionId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.workflows.execution(executionId!),
    queryFn: () => fetchExecution(executionId!),
    enabled: !!executionId,
  });
}

/** Cancel a running execution. */
export function useCancelExecution() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (executionId: string) => cancelExecution(executionId),
    onSuccess: (_data, executionId) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.workflows.execution(executionId),
      });
    },
  });
}

/** Save a published workflow as a reusable template. */
export async function saveAsTemplate(
  workflowId: string,
  teamId: string,
): Promise<{ template: { id: string; name: string; description: string; node_count: number; is_custom: boolean } }> {
  const { data } = await api.post<{ template: { id: string; name: string; description: string; node_count: number; is_custom: boolean } }>(
    '/workflows/templates',
    { workflow_id: workflowId, slack_team_id: teamId },
  );
  return data;
}

/** Save a published workflow as a template. */
export function useSaveAsTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { workflowId: string; teamId: string }) =>
      saveAsTemplate(input.workflowId, input.teamId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workflows', 'templates'] });
    },
  });
}

// ---------------------------------------------------------------------------
// Analytics API functions
// ---------------------------------------------------------------------------

/** Fetch aggregate analytics for a workflow. */
export async function fetchWorkflowAnalytics(
  workflowId: string,
  params?: Record<string, string>,
): Promise<WorkflowAnalyticsResponse> {
  const merged = { teamId: DEFAULT_TEAM_ID, ...params };
  const { data } = await api.get<WorkflowAnalyticsResponse>(
    `/workflows/${workflowId}/analytics`,
    { params: merged },
  );
  return data;
}

/** Fetch funnel data for a workflow. */
export async function fetchWorkflowFunnel(
  workflowId: string,
  params?: Record<string, string>,
): Promise<WorkflowFunnelResponse> {
  const merged = { teamId: DEFAULT_TEAM_ID, ...params };
  const { data } = await api.get<WorkflowFunnelResponse>(
    `/workflows/${workflowId}/analytics/funnel`,
    { params: merged },
  );
  return data;
}

/** Fetch per-node analytics. */
export async function fetchNodeAnalytics(
  workflowId: string,
  nodeId: string,
  params?: Record<string, string>,
): Promise<NodeAnalyticsResponse> {
  const merged = { teamId: DEFAULT_TEAM_ID, ...params };
  const { data } = await api.get<NodeAnalyticsResponse>(
    `/workflows/${workflowId}/analytics/nodes/${nodeId}`,
    { params: merged },
  );
  return data;
}

// ---------------------------------------------------------------------------
// Analytics TanStack Query hooks
// ---------------------------------------------------------------------------

/** Fetch aggregate workflow analytics. */
export function useWorkflowAnalytics(
  workflowId: string | undefined,
  params?: Record<string, string>,
) {
  return useQuery({
    queryKey: queryKeys.workflows.analytics(workflowId!, params),
    queryFn: () => fetchWorkflowAnalytics(workflowId!, params),
    enabled: !!workflowId,
  });
}

/** Fetch workflow funnel data. */
export function useWorkflowFunnel(
  workflowId: string | undefined,
  params?: Record<string, string>,
) {
  return useQuery({
    queryKey: queryKeys.workflows.funnel(workflowId!, params),
    queryFn: () => fetchWorkflowFunnel(workflowId!, params),
    enabled: !!workflowId,
  });
}

/** Fetch per-node analytics. */
export function useNodeAnalytics(
  workflowId: string | undefined,
  nodeId: string | undefined,
  params?: Record<string, string>,
) {
  return useQuery({
    queryKey: queryKeys.workflows.nodeAnalytics(workflowId!, nodeId!, params),
    queryFn: () => fetchNodeAnalytics(workflowId!, nodeId!, params),
    enabled: !!workflowId && !!nodeId,
  });
}

// ---------------------------------------------------------------------------
// Workflow Scoping API functions (Feature 21)
// ---------------------------------------------------------------------------

/** Assign or remove a client from a workflow. */
export async function updateWorkflowClient(
  workflowId: string,
  clientId: string | null,
  teamId: string = DEFAULT_TEAM_ID,
) {
  const { data } = await api.put<{ workflow: { id: string; client_id: string | null; client_name: string | null } }>(
    `/workflows/${workflowId}/client`,
    { client_id: clientId },
    { params: { teamId } },
  );
  return data.workflow;
}

/** List channel mappings for a workflow. */
export async function fetchWorkflowChannels(
  workflowId: string,
  teamId: string = DEFAULT_TEAM_ID,
) {
  const { data } = await api.get<{ mappings: Array<{ id: string; slack_channel_id: string; slack_team_id: string; trigger_type: string; created_by_user_id: string; created_at: string }> }>(
    `/workflows/${workflowId}/channels`,
    { params: { teamId } },
  );
  return data.mappings;
}

/** Add a channel mapping to a workflow. */
export async function addWorkflowChannel(
  workflowId: string,
  slackChannelId: string,
  slackTeamId: string,
  teamId: string = DEFAULT_TEAM_ID,
) {
  const { data } = await api.post<{ mapping: { id: string; slack_channel_id: string; slack_team_id: string; trigger_type: string } }>(
    `/workflows/${workflowId}/channels`,
    { slack_channel_id: slackChannelId, slack_team_id: slackTeamId },
    { params: { teamId } },
  );
  return data.mapping;
}

/** Remove a channel mapping from a workflow. */
export async function removeWorkflowChannel(
  workflowId: string,
  mappingId: string,
  teamId: string = DEFAULT_TEAM_ID,
) {
  await api.delete(`/workflows/${workflowId}/channels/${mappingId}`, {
    params: { teamId },
  });
}
