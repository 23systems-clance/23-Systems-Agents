/**
 * Agent Registry admin API routes (Feature 39 - Vertical Pack Platform).
 *
 * CRUD for AI agents with versioning, sandbox testing, publish, and deprecate.
 * Per contracts/agents-api.yaml.
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import {
  createAgent,
  getAgent,
  listAgents,
  updateAgent,
  deleteAgent,
  publishAgent,
  deprecateAgent,
} from '../../services/platform/agentRegistry.js';
import { testAgent } from '../../services/platform/agentInvoker.js';
import {
  createAgentSchema,
  updateAgentSchema,
  listAgentsQuerySchema,
  testAgentSchema,
  validateBody,
  validateQuery,
} from '../../lib/platformValidation.js';
import logger from '../../lib/logger.js';

export const agentAdminRouter = Router();

/**
 * GET /api/v1/admin/agents
 * List all agents with optional status filter and pagination.
 */
agentAdminRouter.get('/', async (req: Request, res: Response) => {
  try {
    const query = validateQuery(listAgentsQuerySchema, req.query, res);
    if (!query) return;

    const result = await listAgents({
      status: query.status as any,
      page: query.page,
      limit: query.limit,
    });
    res.json(result);
  } catch (error) {
    logger.error('Failed to list agents', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ error: 'Failed to list agents' });
  }
});

/**
 * POST /api/v1/admin/agents
 * Create a new agent.
 */
agentAdminRouter.post('/', async (req: Request, res: Response) => {
  const data = validateBody(createAgentSchema, req.body, res);
  if (!data) return;

  try {
    const agent = await createAgent({
      name: data.name,
      slug: data.slug,
      description: data.description,
      modelId: data.modelId,
      systemPrompt: data.systemPrompt,
      maxTokens: data.maxTokens,
      creditCost: data.creditCost,
      inputSchema: data.inputSchema,
      outputSchema: data.outputSchema,
      toolIds: data.toolIds,
    });
    res.status(201).json(agent);
  } catch (error) {
    logger.error('Failed to create agent', { error: error instanceof Error ? error.message : String(error) });
    if (error instanceof Error && error.message.includes('Unique constraint')) {
      res.status(409).json({ error: `Agent with slug "${data.slug}" already exists` });
      return;
    }
    res.status(400).json({ error: error instanceof Error ? error.message : 'Failed to create agent' });
  }
});

/**
 * GET /api/v1/admin/agents/:agentId
 * Get agent details with version history.
 */
agentAdminRouter.get('/:agentId', async (req: Request, res: Response) => {
  try {
    const agent = await getAgent(req.params.agentId as string);
    if (!agent) {
      res.status(404).json({ error: 'Agent not found' });
      return;
    }
    res.json(agent);
  } catch (error) {
    logger.error('Failed to get agent', { agentId: req.params.agentId as string, error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ error: 'Failed to get agent' });
  }
});

/**
 * PUT /api/v1/admin/agents/:agentId
 * Update agent (creates new version if published).
 */
agentAdminRouter.put('/:agentId', async (req: Request, res: Response) => {
  const data = validateBody(updateAgentSchema, req.body, res);
  if (!data) return;

  try {
    const agent = await updateAgent(req.params.agentId as string, data);
    res.json(agent);
  } catch (error) {
    logger.error('Failed to update agent', { agentId: req.params.agentId as string, error: error instanceof Error ? error.message : String(error) });
    if (error instanceof Error && error.message.includes('not found')) {
      res.status(404).json({ error: error.message });
      return;
    }
    res.status(400).json({ error: error instanceof Error ? error.message : 'Failed to update agent' });
  }
});

/**
 * DELETE /api/v1/admin/agents/:agentId
 * Delete an agent (only if no skills reference it).
 */
agentAdminRouter.delete('/:agentId', async (req: Request, res: Response) => {
  try {
    await deleteAgent(req.params.agentId as string);
    res.json({ success: true });
  } catch (error) {
    logger.error('Failed to delete agent', { agentId: req.params.agentId as string, error: error instanceof Error ? error.message : String(error) });
    if (error instanceof Error && error.message.includes('not found')) {
      res.status(404).json({ error: error.message });
      return;
    }
    res.status(400).json({ error: error instanceof Error ? error.message : 'Failed to delete agent' });
  }
});

/**
 * POST /api/v1/admin/agents/:agentId/test
 * Test agent in sandbox with sample input.
 */
agentAdminRouter.post('/:agentId/test', async (req: Request, res: Response) => {
  const data = validateBody(testAgentSchema, req.body, res);
  if (!data) return;

  try {
    const result = await testAgent(req.params.agentId as string, data.input, data.versionId);
    res.json(result);
  } catch (error) {
    logger.error('Agent test failed', { agentId: req.params.agentId as string, error: error instanceof Error ? error.message : String(error) });
    res.status(400).json({ error: error instanceof Error ? error.message : 'Agent test failed' });
  }
});

/**
 * POST /api/v1/admin/agents/:agentId/publish
 * Publish agent (set current version to PUBLISHED).
 */
agentAdminRouter.post('/:agentId/publish', async (req: Request, res: Response) => {
  try {
    const agent = await publishAgent(req.params.agentId as string);
    res.json(agent);
  } catch (error) {
    logger.error('Failed to publish agent', { agentId: req.params.agentId as string, error: error instanceof Error ? error.message : String(error) });
    if (error instanceof Error && error.message.includes('not found')) {
      res.status(404).json({ error: error.message });
      return;
    }
    res.status(400).json({ error: error instanceof Error ? error.message : 'Failed to publish agent' });
  }
});

/**
 * POST /api/v1/admin/agents/:agentId/deprecate
 * Deprecate agent.
 */
agentAdminRouter.post('/:agentId/deprecate', async (req: Request, res: Response) => {
  try {
    const result = await deprecateAgent(req.params.agentId as string);
    res.json(result);
  } catch (error) {
    logger.error('Failed to deprecate agent', { agentId: req.params.agentId as string, error: error instanceof Error ? error.message : String(error) });
    if (error instanceof Error && error.message.includes('not found')) {
      res.status(404).json({ error: error.message });
      return;
    }
    res.status(400).json({ error: error instanceof Error ? error.message : 'Failed to deprecate agent' });
  }
});
