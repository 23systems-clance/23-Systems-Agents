/**
 * Client BYOK credential routes (Feature 39 - Vertical Pack Platform).
 *
 * Allows workspace clients to set their own API keys for MCP servers.
 * Per contracts/mcp-servers-api.yaml.
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { setByokCredentials } from '../../services/platform/mcpServerRegistry.js';
import { byokCredentialsSchema, validateBody } from '../../lib/platformValidation.js';
import logger from '../../lib/logger.js';

export const clientMcpServerRouter = Router();

/**
 * PUT /api/v1/client/mcp-servers/:serverId/byok
 * Set BYOK credentials for the authenticated workspace.
 */
clientMcpServerRouter.put('/:serverId/byok', async (req: Request, res: Response) => {
  const slackTeamId = (req as any).slackTeamId;

  if (!slackTeamId) {
    res.status(401).json({ error: 'Workspace not authenticated' });
    return;
  }

  const data = validateBody(byokCredentialsSchema, req.body, res);
  if (!data) return;

  try {
    await setByokCredentials(req.params.serverId as string, slackTeamId, data.credentials);
    res.json({ success: true });
  } catch (error) {
    logger.error('Failed to set BYOK credentials', {
      serverId: req.params.serverId as string,
      slackTeamId,
      error: error instanceof Error ? error.message : String(error),
    });
    if (error instanceof Error && error.message.includes('not found')) {
      res.status(404).json({ error: error.message });
      return;
    }
    if (error instanceof Error && error.message.includes('BYOK is not enabled')) {
      res.status(400).json({ error: error.message });
      return;
    }
    res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to set BYOK credentials' });
  }
});
