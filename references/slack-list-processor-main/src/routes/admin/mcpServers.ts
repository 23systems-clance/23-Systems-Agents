/**
 * MCP Server Registry admin API routes (Feature 39 - Vertical Pack Platform).
 *
 * CRUD for MCP servers, tool management, and health checks.
 * Per contracts/mcp-servers-api.yaml.
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import {
  createServer,
  getServer,
  listServers,
  updateServer,
  deleteServer,
  addTool,
  updateTool,
  removeTool,
  listToolsForServer,
  runHealthCheck,
} from '../../services/platform/mcpServerRegistry.js';
import {
  createMcpServerSchema,
  updateMcpServerSchema,
  addMcpToolSchema,
  updateMcpToolSchema,
  validateBody,
} from '../../lib/platformValidation.js';
import logger from '../../lib/logger.js';

export const mcpServerAdminRouter = Router();

/**
 * GET /api/v1/admin/mcp-servers
 * List all MCP servers with optional status filter.
 */
mcpServerAdminRouter.get('/', async (req: Request, res: Response) => {
  try {
    const servers = await listServers(req.query.status as any);
    res.json({ servers });
  } catch (error) {
    logger.error('Failed to list MCP servers', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ error: 'Failed to list MCP servers' });
  }
});

/**
 * POST /api/v1/admin/mcp-servers
 * Register a new MCP server.
 */
mcpServerAdminRouter.post('/', async (req: Request, res: Response) => {
  const data = validateBody(createMcpServerSchema, req.body, res);
  if (!data) return;

  try {
    const server = await createServer({
      name: data.name,
      slug: data.slug,
      provider: data.provider,
      baseUrl: data.baseUrl,
      authType: data.authType,
      credentials: data.credentials,
      byokEnabled: data.byokEnabled,
      rateLimitRpm: data.rateLimitRpm,
    });
    res.status(201).json(server);
  } catch (error) {
    logger.error('Failed to create MCP server', { error: error instanceof Error ? error.message : String(error) });
    if (error instanceof Error && error.message.includes('Unique constraint')) {
      res.status(409).json({ error: `MCP server with slug "${data.slug}" already exists` });
      return;
    }
    res.status(400).json({ error: error instanceof Error ? error.message : 'Failed to create MCP server' });
  }
});

/**
 * GET /api/v1/admin/mcp-servers/:serverId
 * Get MCP server details with tools.
 */
mcpServerAdminRouter.get('/:serverId', async (req: Request, res: Response) => {
  try {
    const server = await getServer(req.params.serverId as string);
    if (!server) {
      res.status(404).json({ error: 'MCP server not found' });
      return;
    }
    res.json(server);
  } catch (error) {
    logger.error('Failed to get MCP server', { serverId: req.params.serverId as string, error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ error: 'Failed to get MCP server' });
  }
});

/**
 * PUT /api/v1/admin/mcp-servers/:serverId
 * Update MCP server.
 */
mcpServerAdminRouter.put('/:serverId', async (req: Request, res: Response) => {
  const data = validateBody(updateMcpServerSchema, req.body, res);
  if (!data) return;

  try {
    const server = await updateServer(req.params.serverId as string, data);
    res.json(server);
  } catch (error) {
    logger.error('Failed to update MCP server', { serverId: req.params.serverId as string, error: error instanceof Error ? error.message : String(error) });
    if (error instanceof Error && error.message.includes('not found')) {
      res.status(404).json({ error: error.message });
      return;
    }
    res.status(400).json({ error: error instanceof Error ? error.message : 'Failed to update MCP server' });
  }
});

/**
 * DELETE /api/v1/admin/mcp-servers/:serverId
 * Delete an MCP server.
 */
mcpServerAdminRouter.delete('/:serverId', async (req: Request, res: Response) => {
  try {
    await deleteServer(req.params.serverId as string);
    res.json({ success: true });
  } catch (error) {
    logger.error('Failed to delete MCP server', { serverId: req.params.serverId as string, error: error instanceof Error ? error.message : String(error) });
    if (error instanceof Error && error.message.includes('not found')) {
      res.status(404).json({ error: error.message });
      return;
    }
    res.status(400).json({ error: error instanceof Error ? error.message : 'Failed to delete MCP server' });
  }
});

/**
 * POST /api/v1/admin/mcp-servers/:serverId/health
 * Run health check on MCP server.
 */
mcpServerAdminRouter.post('/:serverId/health', async (req: Request, res: Response) => {
  try {
    const result = await runHealthCheck(req.params.serverId as string);
    res.json(result);
  } catch (error) {
    logger.error('Health check failed', { serverId: req.params.serverId as string, error: error instanceof Error ? error.message : String(error) });
    if (error instanceof Error && error.message.includes('not found')) {
      res.status(404).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: error instanceof Error ? error.message : 'Health check failed' });
  }
});

/**
 * GET /api/v1/admin/mcp-servers/:serverId/tools
 * List tools for an MCP server.
 */
mcpServerAdminRouter.get('/:serverId/tools', async (req: Request, res: Response) => {
  try {
    const tools = await listToolsForServer(req.params.serverId as string);
    res.json({ tools });
  } catch (error) {
    logger.error('Failed to list MCP tools', { serverId: req.params.serverId as string, error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({ error: 'Failed to list MCP tools' });
  }
});

/**
 * POST /api/v1/admin/mcp-servers/:serverId/tools
 * Add a tool to an MCP server.
 */
mcpServerAdminRouter.post('/:serverId/tools', async (req: Request, res: Response) => {
  const data = validateBody(addMcpToolSchema, req.body, res);
  if (!data) return;

  try {
    const tool = await addTool(req.params.serverId as string, {
      name: data.name,
      description: data.description,
      inputSchema: data.inputSchema,
      outputSchema: data.outputSchema,
      creditCost: data.creditCost,
    });
    res.status(201).json(tool);
  } catch (error) {
    logger.error('Failed to add MCP tool', { serverId: req.params.serverId as string, error: error instanceof Error ? error.message : String(error) });
    res.status(400).json({ error: error instanceof Error ? error.message : 'Failed to add MCP tool' });
  }
});

/**
 * PUT /api/v1/admin/mcp-servers/:serverId/tools/:toolId
 * Update an MCP tool.
 */
mcpServerAdminRouter.put('/:serverId/tools/:toolId', async (req: Request, res: Response) => {
  const data = validateBody(updateMcpToolSchema, req.body, res);
  if (!data) return;

  try {
    const tool = await updateTool(req.params.toolId as string, data);
    res.json(tool);
  } catch (error) {
    logger.error('Failed to update MCP tool', { toolId: req.params.toolId as string, error: error instanceof Error ? error.message : String(error) });
    res.status(400).json({ error: error instanceof Error ? error.message : 'Failed to update MCP tool' });
  }
});

/**
 * DELETE /api/v1/admin/mcp-servers/:serverId/tools/:toolId
 * Remove an MCP tool.
 */
mcpServerAdminRouter.delete('/:serverId/tools/:toolId', async (req: Request, res: Response) => {
  try {
    await removeTool(req.params.toolId as string);
    res.json({ success: true });
  } catch (error) {
    logger.error('Failed to remove MCP tool', { toolId: req.params.toolId as string, error: error instanceof Error ? error.message : String(error) });
    res.status(400).json({ error: error instanceof Error ? error.message : 'Failed to remove MCP tool' });
  }
});
