/**
 * Team / Cluster manager service (T020).
 *
 * Manages named groups of collaborating autonomous agents. Each Team
 * (also referred to as a "Cluster" in the spec) has a unique slug,
 * optional description, and a set of agent memberships via TeamAgent
 * junction records.
 */

import type { Team, TeamStatus } from '@prisma/client';
import { prisma } from '../../models/index.js';
import logger from '../../lib/logger.js';

const log = logger.withContext({ service: 'teamManager' });

// -------------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------------

/**
 * Generates a URL-safe slug from a human-readable name.
 *
 * Converts to lowercase, replaces non-alphanumeric characters with hyphens,
 * collapses consecutive hyphens, and trims leading/trailing hyphens.
 *
 * @param name - The human-readable name to slugify.
 * @returns A URL-safe slug string.
 */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

// -------------------------------------------------------------------------
// Create
// -------------------------------------------------------------------------

/** Parameters for creating a new team. */
export interface CreateTeamParams {
  /** Human-readable team name. */
  name: string;
  /** URL-safe slug (auto-generated from name if omitted). */
  slug?: string;
  /** Optional team description. */
  description?: string;
  /** Optional list of agent UUIDs to add as initial members. */
  agentIds?: string[];
}

/**
 * Creates a new Team and optionally associates agents via TeamAgent records.
 *
 * The slug is auto-generated from the name if not explicitly provided.
 * Agent membership records are created inside a transaction to ensure
 * atomicity.
 *
 * @param params - Team creation parameters.
 * @returns The created Team record (with teamAgents included).
 */
export async function createTeam(params: CreateTeamParams): Promise<Team> {
  try {
    const slug = params.slug || slugify(params.name);
    const agentIds = params.agentIds ?? [];

    const team = await prisma.$transaction(async (tx) => {
      const created = await tx.team.create({
        data: {
          name: params.name,
          slug,
          description: params.description ?? null,
        },
      });

      if (agentIds.length > 0) {
        await tx.teamAgent.createMany({
          data: agentIds.map((agentId, index) => ({
            teamId: created.id,
            agentId,
            sortOrder: index,
          })),
        });
      }

      // Re-fetch with relations for the return value.
      return tx.team.findUniqueOrThrow({
        where: { id: created.id },
        include: {
          teamAgents: { include: { agent: true }, orderBy: { sortOrder: 'asc' } },
        },
      });
    });

    log.info('Team created', {
      id: team.id,
      name: params.name,
      slug,
      agentCount: agentIds.length,
    });

    return team;
  } catch (error) {
    log.error('Failed to create team', {
      name: params.name,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

// -------------------------------------------------------------------------
// Update
// -------------------------------------------------------------------------

/** Parameters for updating an existing team. */
export interface UpdateTeamParams {
  /** New team name. */
  name?: string;
  /** New team description. */
  description?: string;
  /** New team status. */
  status?: TeamStatus;
  /** Replacement set of agent UUIDs (full replace, not a diff). */
  agentIds?: string[];
}

/**
 * Updates a Team record and optionally replaces its agent membership.
 *
 * When agentIds is provided, all existing TeamAgent records for the team
 * are deleted and replaced with the new set inside a transaction.
 *
 * @param teamId - UUID of the Team to update.
 * @param data - Fields to update and optional new agent membership list.
 * @returns The updated Team record (with teamAgents included).
 */
export async function updateTeam(
  teamId: string,
  data: UpdateTeamParams,
): Promise<Team> {
  try {
    const team = await prisma.$transaction(async (tx) => {
      await tx.team.update({
        where: { id: teamId },
        data: {
          ...(data.name !== undefined ? { name: data.name } : {}),
          ...(data.description !== undefined ? { description: data.description } : {}),
          ...(data.status !== undefined ? { status: data.status } : {}),
        },
      });

      // Replace agent membership if a new list was provided.
      if (data.agentIds !== undefined) {
        await tx.teamAgent.deleteMany({ where: { teamId } });

        if (data.agentIds.length > 0) {
          await tx.teamAgent.createMany({
            data: data.agentIds.map((agentId, index) => ({
              teamId,
              agentId,
              sortOrder: index,
            })),
          });
        }
      }

      return tx.team.findUniqueOrThrow({
        where: { id: teamId },
        include: {
          teamAgents: { include: { agent: true }, orderBy: { sortOrder: 'asc' } },
        },
      });
    });

    log.info('Team updated', {
      id: teamId,
      fields: Object.keys(data),
      agentCount: data.agentIds?.length,
    });

    return team;
  } catch (error) {
    log.error('Failed to update team', {
      teamId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

// -------------------------------------------------------------------------
// Get / List
// -------------------------------------------------------------------------

/**
 * Retrieves a single team by ID, including its agent memberships.
 *
 * @param teamId - UUID of the Team to retrieve.
 * @returns The Team record with agent relations, or null if not found.
 */
export async function getTeam(teamId: string): Promise<Team | null> {
  try {
    const team = await prisma.team.findUnique({
      where: { id: teamId },
      include: {
        teamAgents: { include: { agent: true }, orderBy: { sortOrder: 'asc' } },
      },
    });

    log.debug('Team retrieved', {
      teamId,
      found: team !== null,
    });

    return team;
  } catch (error) {
    log.error('Failed to retrieve team', {
      teamId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/** Filters for listing teams. */
export interface ListTeamsFilters {
  /** Filter by team status. */
  status?: TeamStatus;
}

/**
 * Lists all teams with optional status filter.
 *
 * Returns teams with an _count of associated agents for summary display.
 *
 * @param filters - Optional status filter.
 * @returns Array of Team records with agent counts.
 */
export async function listTeams(filters?: ListTeamsFilters): Promise<Team[]> {
  try {
    const where = filters?.status ? { status: filters.status } : {};

    const teams = await prisma.team.findMany({
      where,
      include: {
        _count: { select: { teamAgents: true } },
      },
      orderBy: { name: 'asc' },
    });

    log.debug('Teams listed', {
      count: teams.length,
      status: filters?.status ?? 'all',
    });

    return teams;
  } catch (error) {
    log.error('Failed to list teams', {
      filters,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

// -------------------------------------------------------------------------
// Delete
// -------------------------------------------------------------------------

/**
 * Deletes a team and its associated TeamAgent records.
 *
 * TeamAgent records are cascade-deleted by the database foreign key
 * constraint, so only the parent Team record needs to be deleted.
 *
 * @param teamId - UUID of the Team to delete.
 */
export async function deleteTeam(teamId: string): Promise<void> {
  try {
    await prisma.team.delete({ where: { id: teamId } });

    log.info('Team deleted', { teamId });
  } catch (error) {
    log.error('Failed to delete team', {
      teamId,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
