/**
 * Team CRUD REST API routes (Feature 31 — Autonomous Agents).
 *
 * Manages agent teams (clusters) for collaborative agent grouping.
 *
 * GET    /                - List all teams
 * POST   /                - Create a new team
 * GET    /:teamId         - Get team detail with member agents
 * PUT    /:teamId         - Update team and membership
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { prisma } from '../../models/index.js';
import logger from '../../lib/logger.js';

const log = logger.withContext({ service: 'teamsApi' });

export const teamsRouter = Router();

/**
 * Generate a URL-safe slug from a name.
 * Lowercases, replaces non-alphanumeric chars with hyphens, and collapses runs.
 */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// ---------------------------------------------------------------------------
// GET / — List all teams
// ---------------------------------------------------------------------------

teamsRouter.get('/', async (_req: Request, res: Response) => {
  try {
    const teams = await prisma.team.findMany({
      include: {
        _count: { select: { teamAgents: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Aggregate pending actions count per team.
    const teamsWithPending = await Promise.all(
      teams.map(async (team) => {
        // Find agent names belonging to this team.
        const teamAgents = await prisma.teamAgent.findMany({
          where: { teamId: team.id },
          include: { agent: { select: { name: true } } },
        });

        const agentNames = teamAgents.map((ta) => ta.agent.name);

        let pendingActions = 0;
        if (agentNames.length > 0) {
          pendingActions = await prisma.auditAction.count({
            where: {
              agentName: { in: agentNames },
              outcome: 'SUGGESTED',
            },
          });
        }

        return {
          id: team.id,
          name: team.name,
          slug: team.slug,
          description: team.description,
          status: team.status,
          agentCount: team._count.teamAgents,
          pendingActions,
          createdAt: team.createdAt,
          updatedAt: team.updatedAt,
        };
      }),
    );

    res.json({
      teams: teamsWithPending,
      totalTeams: teamsWithPending.length,
    });
  } catch (err) {
    log.error('Failed to list teams', { error: err });
    res.status(500).json({ error: 'internal_error', message: 'Failed to list teams' });
  }
});

// ---------------------------------------------------------------------------
// POST / — Create a new team
// ---------------------------------------------------------------------------

teamsRouter.post('/', async (req: Request, res: Response) => {
  try {
    const { name, description, agentIds } = req.body as {
      name?: string;
      description?: string;
      agentIds?: string[];
    };

    if (!name || !name.trim()) {
      res.status(400).json({ error: 'validation_error', message: 'name is required' });
      return;
    }

    const slug = slugify(name);

    // Check for slug uniqueness.
    const existing = await prisma.team.findUnique({ where: { slug } });
    if (existing) {
      res.status(409).json({ error: 'conflict', message: `Team with slug "${slug}" already exists` });
      return;
    }

    const team = await prisma.team.create({
      data: {
        name: name.trim(),
        slug,
        description: description?.trim() || null,
        teamAgents: agentIds && agentIds.length > 0
          ? {
              create: agentIds.map((agentId, idx) => ({
                agentId,
                sortOrder: idx,
              })),
            }
          : undefined,
      },
      include: {
        teamAgents: {
          include: {
            agent: {
              select: {
                id: true,
                name: true,
                slug: true,
                status: true,
                suggestOnlyMode: true,
              },
            },
          },
        },
      },
    });

    log.info('Team created', { teamId: team.id, slug });

    res.status(201).json({
      id: team.id,
      name: team.name,
      slug: team.slug,
      description: team.description,
      status: team.status,
      agents: team.teamAgents.map((ta) => ({
        id: ta.agent.id,
        name: ta.agent.name,
        slug: ta.agent.slug,
        status: ta.agent.status,
        mode: ta.agent.suggestOnlyMode ? 'suggest_only' : 'auto_execute',
        sortOrder: ta.sortOrder,
      })),
      createdAt: team.createdAt,
      updatedAt: team.updatedAt,
    });
  } catch (err) {
    log.error('Failed to create team', { error: err });
    res.status(500).json({ error: 'internal_error', message: 'Failed to create team' });
  }
});

// ---------------------------------------------------------------------------
// GET /:teamId — Get team detail with member agents
// ---------------------------------------------------------------------------

teamsRouter.get('/:teamId', async (req: Request, res: Response) => {
  try {
    const teamId = req.params.teamId as string;

    const team = await prisma.team.findUnique({
      where: { id: teamId },
      include: {
        teamAgents: {
          orderBy: { sortOrder: 'asc' },
          include: {
            agent: {
              select: {
                id: true,
                name: true,
                slug: true,
                description: true,
                status: true,
                suggestOnlyMode: true,
                lastRunAt: true,
                actionsToday: true,
              },
            },
          },
        },
      },
    });

    if (!team) {
      res.status(404).json({ error: 'not_found', message: 'Team not found' });
      return;
    }

    // Include each agent's pending actions count.
    const agentsWithPending = await Promise.all(
      team.teamAgents.map(async (ta) => {
        const pendingActions = await prisma.auditAction.count({
          where: { agentName: ta.agent.name, outcome: 'SUGGESTED' },
        });

        return {
          id: ta.agent.id,
          name: ta.agent.name,
          slug: ta.agent.slug,
          description: ta.agent.description,
          status: ta.agent.status,
          mode: ta.agent.suggestOnlyMode ? 'suggest_only' : 'auto_execute',
          pendingActions,
          lastRunAt: ta.agent.lastRunAt,
          actionsToday: ta.agent.actionsToday,
          sortOrder: ta.sortOrder,
        };
      }),
    );

    res.json({
      id: team.id,
      name: team.name,
      slug: team.slug,
      description: team.description,
      status: team.status,
      agents: agentsWithPending,
      createdAt: team.createdAt,
      updatedAt: team.updatedAt,
    });
  } catch (err) {
    log.error('Failed to get team detail', { error: err, teamId: req.params.teamId });
    res.status(500).json({ error: 'internal_error', message: 'Failed to get team detail' });
  }
});

// ---------------------------------------------------------------------------
// PUT /:teamId — Update team and membership
// ---------------------------------------------------------------------------

teamsRouter.put('/:teamId', async (req: Request, res: Response) => {
  try {
    const teamId = req.params.teamId as string;
    const { name, description, agentIds } = req.body as {
      name?: string;
      description?: string;
      agentIds?: string[];
    };

    const existing = await prisma.team.findUnique({ where: { id: teamId } });
    if (!existing) {
      res.status(404).json({ error: 'not_found', message: 'Team not found' });
      return;
    }

    // Build update data.
    const updateData: Record<string, unknown> = {};
    if (name !== undefined) {
      updateData.name = name.trim();
      updateData.slug = slugify(name);
    }
    if (description !== undefined) {
      updateData.description = description?.trim() || null;
    }

    // Use a transaction when agentIds are provided (delete + recreate).
    if (agentIds !== undefined) {
      await prisma.$transaction(async (tx) => {
        // Update team fields.
        await tx.team.update({
          where: { id: teamId },
          data: updateData,
        });

        // Delete existing TeamAgent records.
        await tx.teamAgent.deleteMany({ where: { teamId } });

        // Create new ones.
        if (agentIds.length > 0) {
          await tx.teamAgent.createMany({
            data: agentIds.map((agentId, idx) => ({
              teamId,
              agentId,
              sortOrder: idx,
            })),
          });
        }
      });
    } else {
      await prisma.team.update({
        where: { id: teamId },
        data: updateData,
      });
    }

    // Fetch updated team for response.
    const updated = await prisma.team.findUnique({
      where: { id: teamId },
      include: {
        teamAgents: {
          orderBy: { sortOrder: 'asc' },
          include: {
            agent: {
              select: {
                id: true,
                name: true,
                slug: true,
                status: true,
                suggestOnlyMode: true,
              },
            },
          },
        },
      },
    });

    if (!updated) {
      res.status(404).json({ error: 'not_found', message: 'Team not found' });
      return;
    }

    log.info('Team updated', { teamId });

    res.json({
      id: updated.id,
      name: updated.name,
      slug: updated.slug,
      description: updated.description,
      status: updated.status,
      agents: updated.teamAgents.map((ta) => ({
        id: ta.agent.id,
        name: ta.agent.name,
        slug: ta.agent.slug,
        status: ta.agent.status,
        mode: ta.agent.suggestOnlyMode ? 'suggest_only' : 'auto_execute',
        sortOrder: ta.sortOrder,
      })),
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
    });
  } catch (err) {
    log.error('Failed to update team', { error: err, teamId: req.params.teamId });
    res.status(500).json({ error: 'internal_error', message: 'Failed to update team' });
  }
});
