/**
 * Prompt library API client (Feature 19).
 */

import { api } from '@/lib/api-client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PromptSummary {
  id: string;
  slug: string;
  displayName: string;
  description: string | null;
  category: 'CLASSIFIER' | 'PARSER' | 'GENERATOR';
  isActive: boolean;
  modelConfig: { model: string; maxTokens: number; temperature?: number };
  publishedVersion: { version: number; status: string; publishedAt: string } | null;
  usageCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface PromptDetail extends PromptSummary {
  toolDefinitions: Record<string, unknown>[] | null;
  versions: PromptVersionSummary[];
  variables: PromptVariable[];
}

export interface PromptVersionSummary {
  id: string;
  version: number;
  status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
  publishedBy: string | null;
  publishedAt: string | null;
  changeNote: string | null;
  createdAt: string;
}

export interface PromptVersion extends PromptVersionSummary {
  content: string;
  promptId: string;
}

export interface PromptVariable {
  id: string;
  name: string;
  description: string | null;
  defaultValue: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PromptDiffResult {
  from: { id: string; version: number; status: string; content: string };
  to: { id: string; version: number; status: string; content: string };
  diff: string;
}

export interface PromptTestRun {
  id: string;
  promptVersionId: string;
  inputText: string;
  outputResult: Record<string, unknown>;
  tokensUsed: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: string;
  durationMs: number;
  testedBy: string;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Prompt CRUD
// ---------------------------------------------------------------------------

export async function fetchPrompts(
  params?: Record<string, string>,
): Promise<{ prompts: PromptSummary[]; total: number }> {
  const { data } = await api.get<{ prompts: PromptSummary[]; total: number }>(
    '/prompts',
    { params },
  );
  return data;
}

export async function fetchPromptBySlug(
  slug: string,
): Promise<{ prompt: PromptDetail }> {
  const { data } = await api.get<{ prompt: PromptDetail }>(`/prompts/${slug}`);
  return data;
}

export async function createPrompt(input: {
  slug: string;
  displayName: string;
  description?: string;
  category: string;
  modelConfig: Record<string, unknown>;
  toolDefinitions?: Record<string, unknown>[];
  initialContent?: string;
}): Promise<{ prompt: PromptSummary }> {
  const { data } = await api.post<{ prompt: PromptSummary }>('/prompts', input);
  return data;
}

export async function updatePrompt(
  slug: string,
  input: Partial<{
    displayName: string;
    description: string;
    category: string;
    modelConfig: Record<string, unknown>;
    toolDefinitions: Record<string, unknown>[];
  }>,
): Promise<{ prompt: PromptSummary }> {
  const { data } = await api.patch<{ prompt: PromptSummary }>(
    `/prompts/${slug}`,
    input,
  );
  return data;
}

// ---------------------------------------------------------------------------
// Version Management
// ---------------------------------------------------------------------------

export async function fetchVersions(
  slug: string,
  status?: string,
): Promise<{ versions: PromptVersion[]; total: number }> {
  const { data } = await api.get<{ versions: PromptVersion[]; total: number }>(
    `/prompts/${slug}/versions`,
    { params: status ? { status } : undefined },
  );
  return data;
}

export async function createVersion(
  slug: string,
  input: { content?: string; copyFromVersionId?: string; changeNote?: string },
): Promise<{ version: PromptVersion }> {
  const { data } = await api.post<{ version: PromptVersion }>(
    `/prompts/${slug}/versions`,
    input,
  );
  return data;
}

export async function fetchVersion(
  slug: string,
  versionId: string,
): Promise<{ version: PromptVersion }> {
  const { data } = await api.get<{ version: PromptVersion }>(
    `/prompts/${slug}/versions/${versionId}`,
  );
  return data;
}

export async function updateVersion(
  slug: string,
  versionId: string,
  input: { content?: string; changeNote?: string; updatedAt?: string },
): Promise<{ version: PromptVersion }> {
  const { data } = await api.patch<{ version: PromptVersion }>(
    `/prompts/${slug}/versions/${versionId}`,
    input,
  );
  return data;
}

export async function publishVersion(
  slug: string,
  versionId: string,
): Promise<{ success: boolean; message: string }> {
  const { data } = await api.post<{ success: boolean; message: string }>(
    `/prompts/${slug}/versions/${versionId}/publish`,
  );
  return data;
}

// ---------------------------------------------------------------------------
// Diff
// ---------------------------------------------------------------------------

export async function fetchDiff(
  slug: string,
  fromId: string,
  toId: string,
): Promise<PromptDiffResult> {
  const { data } = await api.get<PromptDiffResult>(`/prompts/${slug}/diff`, {
    params: { from: fromId, to: toId },
  });
  return data;
}

// ---------------------------------------------------------------------------
// Test Runs (Phase 4 / US2)
// ---------------------------------------------------------------------------

export async function runPromptTest(
  slug: string,
  versionId: string,
  input: { inputText: string; workspaceId?: string },
): Promise<{ testRun: PromptTestRun }> {
  const { data } = await api.post<{ testRun: PromptTestRun }>(
    `/prompts/${slug}/versions/${versionId}/test`,
    input,
  );
  return data;
}

export async function fetchTestRuns(
  slug: string,
  versionId: string,
): Promise<{ testRuns: PromptTestRun[]; total: number }> {
  const { data } = await api.get<{ testRuns: PromptTestRun[]; total: number }>(
    `/prompts/${slug}/versions/${versionId}/test-runs`,
  );
  return data;
}

// ---------------------------------------------------------------------------
// Variables (Phase 5 / US3)
// ---------------------------------------------------------------------------

export interface PromptVariableWithCount extends PromptVariable {
  promptCount: number;
}

export interface WorkspaceOverride {
  id: string;
  workspaceId: string;
  variableId: string;
  variableName: string;
  overrideValue: string;
  createdAt: string;
  updatedAt: string;
}

export async function fetchVariables(): Promise<{
  variables: PromptVariableWithCount[];
  total: number;
}> {
  const { data } = await api.get<{
    variables: PromptVariableWithCount[];
    total: number;
  }>('/prompts/variables');
  return data;
}

export async function createVariable(input: {
  name: string;
  description?: string;
  defaultValue?: string;
}): Promise<{ variable: PromptVariable }> {
  const { data } = await api.post<{ variable: PromptVariable }>(
    '/prompts/variables',
    input,
  );
  return data;
}

export async function updateVariable(
  variableId: string,
  input: Partial<{ description: string; defaultValue: string }>,
): Promise<{ variable: PromptVariable }> {
  const { data } = await api.patch<{ variable: PromptVariable }>(
    `/prompts/variables/${variableId}`,
    input,
  );
  return data;
}

export async function fetchOverrides(
  workspaceId?: string,
): Promise<{ overrides: WorkspaceOverride[]; total: number }> {
  const { data } = await api.get<{
    overrides: WorkspaceOverride[];
    total: number;
  }>('/prompts/variables/overrides', {
    params: workspaceId ? { workspaceId } : undefined,
  });
  return data;
}

export async function setOverride(input: {
  workspaceId: string;
  variableId: string;
  overrideValue: string;
}): Promise<{ override: WorkspaceOverride }> {
  const { data } = await api.put<{ override: WorkspaceOverride }>(
    '/prompts/variables/overrides',
    input,
  );
  return data;
}

export async function deleteOverride(
  workspaceId: string,
  variableId: string,
): Promise<{ success: boolean }> {
  const { data } = await api.delete<{ success: boolean }>(
    '/prompts/variables/overrides',
    { params: { workspaceId, variableId } },
  );
  return data;
}
