/**
 * Agent Registry Service (Feature 39 - Vertical Pack Platform)
 *
 * CRUD operations for AI agents with versioning lifecycle:
 * DRAFT -> TESTING -> PUBLISHED -> DEPRECATED
 *
 * Published agent versions are immutable (FR-002).
 * Updating a PUBLISHED agent creates a new DRAFT version.
 */

import { prisma } from '../../models/index.js';
import logger from '../../lib/logger.js';
import type { AgentStatus } from '@prisma/client';

const log = logger.withContext({ service: 'agentRegistry' });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CreateAgentInput {
  name: string;
  slug: string;
  description?: string;
  modelId: string;
  systemPrompt: string;
  maxTokens: number;
  creditCost: number;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  toolIds?: string[];
}

export interface UpdateAgentInput {
  name?: string;
  description?: string;
  modelId?: string;
  systemPrompt?: string;
  maxTokens?: number;
  creditCost?: number;
  inputSchema?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  toolIds?: string[];
  changeNote?: string;
}

export interface ListAgentsOptions {
  status?: AgentStatus;
  page?: number;
  limit?: number;
}

// ---------------------------------------------------------------------------
// CRUD Operations (T010)
// ---------------------------------------------------------------------------

/**
 * Create a new agent with an initial DRAFT version (v1).
 */
export async function createAgent(input: CreateAgentInput) {
  const agent = await prisma.$transaction(async (tx) => {
    const newAgent = await tx.agent.create({
      data: {
        name: input.name,
        slug: input.slug,
        description: input.description,
        modelId: input.modelId,
        maxTokens: input.maxTokens,
        creditCost: input.creditCost,
        inputSchema: (input.inputSchema ?? undefined) as any,
        outputSchema: (input.outputSchema ?? undefined) as any,
        toolIds: input.toolIds ?? [],
      },
    });

    await tx.agentVersion.create({
      data: {
        agentId: newAgent.id,
        version: 1,
        status: 'DRAFT',
        systemPrompt: input.systemPrompt,
        modelId: input.modelId,
        maxTokens: input.maxTokens,
        toolIds: input.toolIds ?? [],
        inputSchema: (input.inputSchema ?? undefined) as any,
        outputSchema: (input.outputSchema ?? undefined) as any,
        changeNote: 'Initial version',
      },
    });

    return newAgent;
  });

  log.info('Agent created', { agentId: agent.id, slug: agent.slug });
  return getAgent(agent.id);
}

/**
 * Get a single agent with its version history.
 */
export async function getAgent(agentId: string) {
  return prisma.agent.findUnique({
    where: { id: agentId },
    include: {
      versions: {
        orderBy: { version: 'desc' },
      },
    },
  });
}

/**
 * List agents with optional status filter and pagination.
 */
export async function listAgents(options: ListAgentsOptions = {}) {
  const { status, page = 1, limit = 20 } = options;
  const skip = (page - 1) * limit;

  const where = status ? { status } : {};

  const [agents, total] = await prisma.$transaction([
    prisma.agent.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      skip,
      take: limit,
      include: {
        versions: {
          orderBy: { version: 'desc' },
          take: 1,
          select: { version: true },
        },
        _count: {
          select: { skills: true },
        },
      },
    }),
    prisma.agent.count({ where }),
  ]);

  return {
    agents: agents.map((a) => ({
      id: a.id,
      name: a.name,
      slug: a.slug,
      status: a.status,
      modelId: a.modelId,
      currentVersion: a.versions[0]?.version ?? 0,
      creditCost: a.creditCost,
      skillCount: a._count.skills,
      createdAt: a.createdAt,
      updatedAt: a.updatedAt,
    })),
    total,
    page,
  };
}

/**
 * Update an agent. If PUBLISHED, creates a new DRAFT version rather than
 * mutating the published version (immutability rule FR-002).
 */
export async function updateAgent(agentId: string, input: UpdateAgentInput) {
  const agent = await prisma.agent.findUnique({
    where: { id: agentId },
    include: {
      versions: {
        orderBy: { version: 'desc' },
        take: 1,
      },
    },
  });

  if (!agent) throw new Error(`Agent ${agentId} not found`);

  const latestVersion = agent.versions[0];
  if (!latestVersion) throw new Error(`Agent ${agentId} has no versions`);

  return prisma.$transaction(async (tx) => {
    // Update agent-level fields
    await tx.agent.update({
      where: { id: agentId },
      data: {
        ...(input.name && { name: input.name }),
        ...(input.description !== undefined && { description: input.description }),
        ...(input.modelId && { modelId: input.modelId }),
        ...(input.maxTokens && { maxTokens: input.maxTokens }),
        ...(input.creditCost !== undefined && { creditCost: input.creditCost }),
        ...(input.inputSchema !== undefined && { inputSchema: input.inputSchema as any }),
        ...(input.outputSchema !== undefined && { outputSchema: input.outputSchema as any }),
        ...(input.toolIds && { toolIds: input.toolIds }),
      } as any,
    });

    // If latest version is PUBLISHED, create new DRAFT version
    if (latestVersion.status === 'PUBLISHED') {
      await tx.agentVersion.create({
        data: {
          agentId,
          version: latestVersion.version + 1,
          status: 'DRAFT',
          systemPrompt: input.systemPrompt ?? latestVersion.systemPrompt,
          modelId: input.modelId ?? latestVersion.modelId,
          maxTokens: input.maxTokens ?? latestVersion.maxTokens,
          toolIds: input.toolIds ?? latestVersion.toolIds,
          inputSchema: (input.inputSchema ?? latestVersion.inputSchema ?? undefined) as any,
          outputSchema: (input.outputSchema ?? latestVersion.outputSchema ?? undefined) as any,
          changeNote: input.changeNote ?? 'Updated from published version',
        },
      });

      log.info('New agent version created from published', {
        agentId,
        newVersion: latestVersion.version + 1,
      });
    } else {
      // Update existing DRAFT/TESTING version in place
      await tx.agentVersion.update({
        where: { id: latestVersion.id },
        data: {
          ...(input.systemPrompt && { systemPrompt: input.systemPrompt }),
          ...(input.modelId && { modelId: input.modelId }),
          ...(input.maxTokens && { maxTokens: input.maxTokens }),
          ...(input.toolIds && { toolIds: input.toolIds }),
          ...(input.inputSchema !== undefined && { inputSchema: input.inputSchema as any }),
          ...(input.outputSchema !== undefined && { outputSchema: input.outputSchema as any }),
          ...(input.changeNote && { changeNote: input.changeNote }),
        } as any,
      });
    }

    return getAgentTx(tx, agentId);
  });
}

/**
 * Delete an agent and all its versions (cascade).
 */
export async function deleteAgent(agentId: string) {
  const agent = await prisma.agent.findUnique({
    where: { id: agentId },
    include: { _count: { select: { skills: true } } },
  });

  if (!agent) throw new Error(`Agent ${agentId} not found`);
  if (agent._count.skills > 0) {
    throw new Error(`Cannot delete agent with ${agent._count.skills} active skill(s). Remove skill references first.`);
  }

  await prisma.agent.delete({ where: { id: agentId } });
  log.info('Agent deleted', { agentId, slug: agent.slug });
}

// ---------------------------------------------------------------------------
// Versioning & Lifecycle (T011)
// ---------------------------------------------------------------------------

/**
 * Publish the latest version of an agent.
 * Sets the version status to PUBLISHED and the agent status to PUBLISHED.
 */
export async function publishAgent(agentId: string) {
  const agent = await prisma.agent.findUnique({
    where: { id: agentId },
    include: {
      versions: {
        orderBy: { version: 'desc' },
        take: 1,
      },
    },
  });

  if (!agent) throw new Error(`Agent ${agentId} not found`);

  const latestVersion = agent.versions[0];
  if (!latestVersion) throw new Error(`Agent ${agentId} has no versions`);

  if (latestVersion.status === 'PUBLISHED') {
    throw new Error('Latest version is already published');
  }

  return prisma.$transaction(async (tx) => {
    await tx.agentVersion.update({
      where: { id: latestVersion.id },
      data: {
        status: 'PUBLISHED',
        publishedAt: new Date(),
      },
    });

    await tx.agent.update({
      where: { id: agentId },
      data: { status: 'PUBLISHED' },
    });

    log.info('Agent published', {
      agentId,
      version: latestVersion.version,
    });

    return getAgentTx(tx, agentId);
  });
}

/**
 * Deprecate an agent. Warns if active skills reference it.
 */
export async function deprecateAgent(agentId: string) {
  const agent = await prisma.agent.findUnique({
    where: { id: agentId },
    include: {
      _count: { select: { skills: true } },
    },
  });

  if (!agent) throw new Error(`Agent ${agentId} not found`);

  const result = await prisma.agent.update({
    where: { id: agentId },
    data: { status: 'DEPRECATED' },
    include: { versions: { orderBy: { version: 'desc' } } },
  });

  const warning = agent._count.skills > 0
    ? `Warning: ${agent._count.skills} skill(s) still reference this agent`
    : undefined;

  log.info('Agent deprecated', { agentId, warning });

  return { ...result, warning };
}

/**
 * Get the full version history for an agent.
 */
export async function getVersionHistory(agentId: string) {
  return prisma.agentVersion.findMany({
    where: { agentId },
    orderBy: { version: 'desc' },
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getAgentTx(tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0], agentId: string) {
  return tx.agent.findUnique({
    where: { id: agentId },
    include: {
      versions: {
        orderBy: { version: 'desc' },
      },
    },
  });
}
