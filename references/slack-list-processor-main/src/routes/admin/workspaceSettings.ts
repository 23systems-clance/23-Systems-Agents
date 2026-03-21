/**
 * Workspace settings management endpoints.
 *
 * GET /admin/api/workspaces/:teamId/settings  — Retrieve workspace settings
 * PUT /admin/api/workspaces/:teamId/settings  — Update workspace settings
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../../models/index.js';
import logger from '../../lib/logger.js';

export const workspaceSettingsRouter = Router();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Formats a WorkspaceInstallation record into the settings response shape.
 */
function formatSettings(workspace: {
  slackTeamId: string;
  slackTeamName: string;
  monthlySpendCapUsd: Prisma.Decimal | null;
  maxBuiltwithLookups: number | null;
  maxApolloCredits: number | null;
  maxAiTokens: number | null;
}) {
  return {
    slack_team_id: workspace.slackTeamId,
    slack_team_name: workspace.slackTeamName,
    monthly_spend_cap_usd: workspace.monthlySpendCapUsd?.toString() ?? null,
    max_builtwith_lookups: workspace.maxBuiltwithLookups,
    max_apollo_credits: workspace.maxApolloCredits,
    max_ai_tokens: workspace.maxAiTokens,
  };
}

// ---------------------------------------------------------------------------
// GET /:teamId/settings — Retrieve workspace settings
// ---------------------------------------------------------------------------

workspaceSettingsRouter.get('/:teamId/settings', async (req: Request, res: Response) => {
  try {
    const teamId = req.params['teamId'] as string;

    const workspace = await prisma.workspaceInstallation.findUnique({
      where: { slackTeamId: teamId },
      select: {
        slackTeamId: true,
        slackTeamName: true,
        monthlySpendCapUsd: true,
        maxBuiltwithLookups: true,
        maxApolloCredits: true,
        maxAiTokens: true,
      },
    });

    if (!workspace) {
      res.status(404).json({
        error: 'not_found',
        message: `Workspace ${teamId} not found`,
      });
      return;
    }

    res.json({ settings: formatSettings(workspace) });
  } catch (error) {
    logger.error('Failed to retrieve workspace settings', { error });
    res.status(500).json({
      error: 'internal_error',
      message: 'An unexpected error occurred',
    });
  }
});

// ---------------------------------------------------------------------------
// PUT /:teamId/settings — Update workspace settings
// ---------------------------------------------------------------------------

workspaceSettingsRouter.put('/:teamId/settings', async (req: Request, res: Response) => {
  try {
    const teamId = req.params['teamId'] as string;

    const existing = await prisma.workspaceInstallation.findUnique({
      where: { slackTeamId: teamId },
    });

    if (!existing) {
      res.status(404).json({
        error: 'not_found',
        message: `Workspace ${teamId} not found`,
      });
      return;
    }

    const {
      monthly_spend_cap_usd,
      max_builtwith_lookups,
      max_apollo_credits,
      max_ai_tokens,
    } = req.body;

    const data: Record<string, unknown> = {};

    if (monthly_spend_cap_usd !== undefined) {
      data.monthlySpendCapUsd = monthly_spend_cap_usd === null
        ? null
        : new Prisma.Decimal(monthly_spend_cap_usd);
    }
    if (max_builtwith_lookups !== undefined) {
      data.maxBuiltwithLookups = max_builtwith_lookups === null
        ? null
        : Number(max_builtwith_lookups);
    }
    if (max_apollo_credits !== undefined) {
      data.maxApolloCredits = max_apollo_credits === null
        ? null
        : Number(max_apollo_credits);
    }
    if (max_ai_tokens !== undefined) {
      data.maxAiTokens = max_ai_tokens === null
        ? null
        : Number(max_ai_tokens);
    }

    const updated = await prisma.workspaceInstallation.update({
      where: { slackTeamId: teamId },
      data,
      select: {
        slackTeamId: true,
        slackTeamName: true,
        monthlySpendCapUsd: true,
        maxBuiltwithLookups: true,
        maxApolloCredits: true,
        maxAiTokens: true,
      },
    });

    logger.info('Workspace settings updated', {
      teamId,
      changes: req.body,
    });

    res.json({ settings: formatSettings(updated) });
  } catch (error) {
    logger.error('Failed to update workspace settings', { error });
    res.status(500).json({
      error: 'internal_error',
      message: 'An unexpected error occurred',
    });
  }
});
