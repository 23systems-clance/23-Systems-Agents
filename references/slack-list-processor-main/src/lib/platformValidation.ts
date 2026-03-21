/**
 * Zod validation schemas for platform API request bodies (T066 - Feature 39).
 *
 * Provides type-safe input validation for agent, MCP server, skill, and pack routes.
 */

import { z } from 'zod';

// --- Shared ---

const slugSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug must be lowercase alphanumeric with hyphens');

const uuidSchema = z.string().uuid();

const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

// --- Agent Schemas ---

export const createAgentSchema = z.object({
  name: z.string().min(1).max(200),
  slug: slugSchema,
  description: z.string().max(2000).optional(),
  modelId: z.string().min(1).max(200),
  systemPrompt: z.string().min(1).max(100_000),
  maxTokens: z.coerce.number().int().min(1).max(200_000),
  creditCost: z.coerce.number().min(0),
  inputSchema: z.any().optional(),
  outputSchema: z.any().optional(),
  toolIds: z.array(z.string().uuid()).optional(),
});

export const updateAgentSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  modelId: z.string().min(1).max(200).optional(),
  systemPrompt: z.string().min(1).max(100_000).optional(),
  maxTokens: z.coerce.number().int().min(1).max(200_000).optional(),
  creditCost: z.coerce.number().min(0).optional(),
  inputSchema: z.any().optional(),
  outputSchema: z.any().optional(),
  toolIds: z.array(z.string().uuid()).optional(),
});

export const listAgentsQuerySchema = paginationSchema.extend({
  status: z.enum(['DRAFT', 'TESTING', 'PUBLISHED', 'DEPRECATED']).optional(),
});

export const testAgentSchema = z.object({
  input: z.any().refine((v) => v !== undefined && v !== null, 'input is required'),
  versionId: z.string().uuid().optional(),
});

// --- MCP Server Schemas ---

export const createMcpServerSchema = z.object({
  name: z.string().min(1).max(200),
  slug: slugSchema,
  provider: z.string().min(1).max(200),
  baseUrl: z.string().url(),
  authType: z.enum(['API_KEY', 'OAUTH2', 'BEARER_TOKEN', 'BASIC_AUTH', 'NONE']),
  credentials: z.any().optional(),
  byokEnabled: z.boolean().optional(),
  rateLimitRpm: z.coerce.number().int().min(0).optional(),
});

export const updateMcpServerSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  provider: z.string().min(1).max(200).optional(),
  baseUrl: z.string().url().optional(),
  authType: z.enum(['API_KEY', 'OAUTH2', 'BEARER_TOKEN', 'BASIC_AUTH', 'NONE']).optional(),
  credentials: z.any().optional(),
  byokEnabled: z.boolean().optional(),
  rateLimitRpm: z.coerce.number().int().min(0).optional(),
});

export const addMcpToolSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  inputSchema: z.any().optional(),
  outputSchema: z.any().optional(),
  creditCost: z.coerce.number().min(0).optional(),
});

export const updateMcpToolSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  inputSchema: z.any().optional(),
  outputSchema: z.any().optional(),
  creditCost: z.coerce.number().min(0).optional(),
});

// --- Skill Schemas ---

export const createSkillSchema = z.object({
  name: z.string().min(1).max(200),
  slug: slugSchema,
  agentId: uuidSchema,
  agentVersionId: uuidSchema,
  triggerType: z.enum(['SLACK_COMMAND', 'API_CALL', 'SCHEDULED', 'EVENT', 'MANUAL']),
  creditCost: z.coerce.number().min(0),
  description: z.string().max(2000).optional(),
  inputSchema: z.any().optional(),
  outputSchema: z.any().optional(),
  mcpToolIds: z.array(z.string().uuid()).optional(),
});

export const updateSkillSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  agentVersionId: uuidSchema.optional(),
  triggerType: z.enum(['SLACK_COMMAND', 'API_CALL', 'SCHEDULED', 'EVENT', 'MANUAL']).optional(),
  creditCost: z.coerce.number().min(0).optional(),
  inputSchema: z.any().optional(),
  outputSchema: z.any().optional(),
  mcpToolIds: z.array(z.string().uuid()).optional(),
});

export const listSkillsQuerySchema = z.object({
  status: z.enum(['DRAFT', 'TESTING', 'PUBLISHED', 'DEPRECATED']).optional(),
  triggerType: z.enum(['SLACK_COMMAND', 'API_CALL', 'SCHEDULED', 'EVENT', 'MANUAL']).optional(),
});

export const testSkillSchema = z.object({
  input: z.any().refine((v) => v !== undefined && v !== null, 'input is required'),
});

// --- Pack Schemas ---

export const createPackSchema = z.object({
  name: z.string().min(1).max(200),
  slug: slugSchema,
  description: z.string().max(2000).optional(),
  category: z.enum(['SALES', 'OPERATIONS', 'RESEARCH', 'EXECUTIVE', 'CUSTOM']),
  tier: z.enum(['FREE', 'STARTER', 'GROWTH', 'AGENCY']),
  monthlyPriceUsd: z.coerce.number().min(0).optional(),
  creditsIncluded: z.coerce.number().int().min(0),
  overageRateUsd: z.coerce.number().min(0).optional(),
  skillIds: z.array(z.string().uuid()).optional(),
});

export const updatePackSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  category: z.enum(['SALES', 'OPERATIONS', 'RESEARCH', 'EXECUTIVE', 'CUSTOM']).optional(),
  tier: z.enum(['FREE', 'STARTER', 'GROWTH', 'AGENCY']).optional(),
  monthlyPriceUsd: z.coerce.number().min(0).optional(),
  creditsIncluded: z.coerce.number().int().min(0).optional(),
  overageRateUsd: z.coerce.number().min(0).optional(),
});

export const listPacksQuerySchema = z.object({
  status: z.enum(['DRAFT', 'PUBLISHED', 'DEPRECATED']).optional(),
  category: z.enum(['SALES', 'OPERATIONS', 'RESEARCH', 'EXECUTIVE', 'CUSTOM']).optional(),
});

export const assignSkillsSchema = z.object({
  skillIds: z.array(z.string().uuid()),
});

// --- Client Schemas ---

export const invokeSkillSchema = z.object({
  input: z.any().refine((v) => v !== undefined && v !== null, 'input is required'),
});

export const byokCredentialsSchema = z.object({
  credentials: z.record(z.string(), z.string()).refine(
    (v) => Object.keys(v).length > 0,
    'credentials must have at least one key',
  ),
});

// --- Validation Helper ---

/**
 * Validates request body against a Zod schema. Returns parsed data or sends 400.
 */
export function validateBody<T>(schema: z.ZodSchema<T>, body: unknown, res: import('express').Response): T | null {
  const result = schema.safeParse(body);
  if (!result.success) {
    const errors = result.error.issues.map((e: z.ZodIssue) => `${e.path.join('.')}: ${e.message}`);
    res.status(400).json({ error: 'Validation failed', details: errors });
    return null;
  }
  return result.data;
}

/**
 * Validates query parameters against a Zod schema. Returns parsed data or sends 400.
 */
export function validateQuery<T>(schema: z.ZodSchema<T>, query: unknown, res: import('express').Response): T | null {
  const result = schema.safeParse(query);
  if (!result.success) {
    const errors = result.error.issues.map((e: z.ZodIssue) => `${e.path.join('.')}: ${e.message}`);
    res.status(400).json({ error: 'Invalid query parameters', details: errors });
    return null;
  }
  return result.data;
}
