/**
 * Skill Composer Service (Feature 39 - Vertical Pack Platform)
 *
 * CRUD for skills (agent + MCP tools + trigger + delivery).
 * Validates agent is PUBLISHED, pins agentVersionId, and manages
 * skill lifecycle (DRAFT -> TESTING -> PUBLISHED -> DEPRECATED).
 */

import { prisma } from '../../models/index.js';
import { skillExecutionQueue } from '../queue/queues.js';
import logger from '../../lib/logger.js';
import type { SkillStatus, SkillTriggerType, SkillDeliveryChannel } from '@prisma/client';

const log = logger.withContext({ service: 'skillComposer' });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CreateSkillInput {
  name: string;
  slug: string;
  description?: string;
  agentId: string;
  agentVersionId: string;
  triggerType: SkillTriggerType;
  triggerConfig?: Record<string, unknown>;
  deliveryChannels?: string[];
  deliveryConfig?: Record<string, unknown>;
  mcpToolIds?: string[];
  inputMapping?: Record<string, unknown>;
  outputMapping?: Record<string, unknown>;
  creditCost: number;
  retryPolicy?: { maxRetries?: number; backoffMs?: number };
  chainEventName?: string;
}

export interface UpdateSkillInput {
  name?: string;
  description?: string;
  agentVersionId?: string;
  triggerConfig?: Record<string, unknown>;
  deliveryChannels?: string[];
  deliveryConfig?: Record<string, unknown>;
  mcpToolIds?: string[];
  inputMapping?: Record<string, unknown>;
  outputMapping?: Record<string, unknown>;
  creditCost?: number;
  retryPolicy?: { maxRetries?: number; backoffMs?: number };
  chainEventName?: string;
}

// ---------------------------------------------------------------------------
// CRUD (T030)
// ---------------------------------------------------------------------------

/**
 * Create a new skill.
 * Validates that the agent exists and the specified version is PUBLISHED.
 * Validates all MCP tool IDs reference registered tools (edge case 6).
 */
export async function createSkill(input: CreateSkillInput) {
  // Validate agent version is PUBLISHED
  const agentVersion = await prisma.agentVersion.findUnique({
    where: { id: input.agentVersionId },
    include: { agent: true },
  });

  if (!agentVersion) {
    throw new Error(`Agent version ${input.agentVersionId} not found`);
  }

  if (agentVersion.status !== 'PUBLISHED') {
    throw new Error(`Agent version must be PUBLISHED, currently ${agentVersion.status}`);
  }

  if (agentVersion.agentId !== input.agentId) {
    throw new Error('Agent version does not belong to the specified agent');
  }

  // Validate MCP tools exist
  if (input.mcpToolIds && input.mcpToolIds.length > 0) {
    const tools = await prisma.mcpTool.findMany({
      where: { id: { in: input.mcpToolIds } },
      include: { server: true },
    });

    if (tools.length !== input.mcpToolIds.length) {
      const found = new Set(tools.map((t) => t.id));
      const missing = input.mcpToolIds.filter((id) => !found.has(id));
      throw new Error(`MCP tools not found: ${missing.join(', ')}`);
    }
  }

  const skill = await prisma.skill.create({
    data: {
      name: input.name,
      slug: input.slug,
      description: input.description,
      agentId: input.agentId,
      agentVersionId: input.agentVersionId,
      triggerType: input.triggerType,
      triggerConfig: (input.triggerConfig ?? undefined) as any,
      deliveryChannels: (input.deliveryChannels ?? ['SLACK_THREAD']) as SkillDeliveryChannel[],
      deliveryConfig: (input.deliveryConfig ?? undefined) as any,
      mcpToolIds: input.mcpToolIds ?? [],
      inputMapping: (input.inputMapping ?? undefined) as any,
      outputMapping: (input.outputMapping ?? undefined) as any,
      creditCost: input.creditCost,
      retryPolicy: input.retryPolicy ?? undefined,
      chainEventName: input.chainEventName,
    },
  });

  log.info('Skill created', { skillId: skill.id, slug: skill.slug });
  return skill;
}

/**
 * Get a skill by ID with execution stats.
 */
export async function getSkill(skillId: string) {
  const skill = await prisma.skill.findUnique({
    where: { id: skillId },
    include: {
      agent: { select: { id: true, name: true } },
      agentVersion: { select: { id: true, version: true, status: true } },
    },
  });

  if (!skill) return null;

  // Get execution stats
  const totalExecs = await prisma.skillExecution.count({
    where: { skillId },
  });

  const successCount = await prisma.skillExecution.count({
    where: { skillId, status: 'COMPLETED' },
  });

  const last7Days = await prisma.skillExecution.count({
    where: {
      skillId,
      startedAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
    },
  });

  const totalCredits = await prisma.skillExecution.aggregate({
    where: { skillId, status: 'COMPLETED' },
    _sum: { creditsCost: true },
  });

  const successRate = totalExecs > 0 ? (successCount / totalExecs) * 100 : 0;

  // Check for agent version upgrade
  const versionCheck = await checkAgentVersionUpgrade(skillId);

  return {
    ...skill,
    stats: {
      totalExecutions: totalExecs,
      successRate: Math.round(successRate * 100) / 100,
      avgDurationMs: 0, // Duration computed from startedAt/completedAt if needed
      totalCreditsConsumed: Number(totalCredits._sum.creditsCost ?? 0),
      last7DaysExecutions: last7Days,
    },
    versionCheck,
  };
}

/**
 * List skills with optional status and trigger type filters.
 */
export async function listSkills(options?: {
  status?: SkillStatus;
  triggerType?: SkillTriggerType;
}) {
  const where: Record<string, unknown> = {};
  if (options?.status) where.status = options.status;
  if (options?.triggerType) where.triggerType = options.triggerType;

  const skills = await prisma.skill.findMany({
    where,
    orderBy: { name: 'asc' },
    include: {
      agent: { select: { id: true, name: true } },
      agentVersion: { select: { id: true, version: true } },
      _count: { select: { executions: true } },
    },
  });

  return skills.map((s) => ({
    id: s.id,
    name: s.name,
    slug: s.slug,
    status: s.status,
    triggerType: s.triggerType,
    agentName: s.agent.name,
    agentVersion: s.agentVersion.version,
    creditCost: Number(s.creditCost),
    totalExecutions: s._count.executions,
    createdAt: s.createdAt,
  }));
}

/**
 * Update a skill. Only allowed on DRAFT/TESTING skills.
 */
export async function updateSkill(skillId: string, input: UpdateSkillInput) {
  const existing = await prisma.skill.findUnique({ where: { id: skillId } });
  if (!existing) throw new Error(`Skill ${skillId} not found`);

  if (existing.status === 'PUBLISHED' || existing.status === 'DEPRECATED') {
    throw new Error(`Cannot update a ${existing.status} skill. Create a new skill or deprecate first.`);
  }

  // Validate new agent version if changing
  if (input.agentVersionId) {
    const av = await prisma.agentVersion.findUnique({ where: { id: input.agentVersionId } });
    if (!av) throw new Error(`Agent version ${input.agentVersionId} not found`);
    if (av.status !== 'PUBLISHED') {
      throw new Error('Agent version must be PUBLISHED');
    }
  }

  const skill = await prisma.skill.update({
    where: { id: skillId },
    data: {
      ...(input.name && { name: input.name }),
      ...(input.description !== undefined && { description: input.description }),
      ...(input.agentVersionId && { agentVersionId: input.agentVersionId }),
      ...(input.triggerConfig !== undefined && { triggerConfig: input.triggerConfig as any }),
      ...(input.deliveryChannels && { deliveryChannels: input.deliveryChannels as SkillDeliveryChannel[] }),
      ...(input.deliveryConfig !== undefined && { deliveryConfig: input.deliveryConfig as any }),
      ...(input.mcpToolIds && { mcpToolIds: input.mcpToolIds }),
      ...(input.inputMapping !== undefined && { inputMapping: input.inputMapping as any }),
      ...(input.outputMapping !== undefined && { outputMapping: input.outputMapping as any }),
      ...(input.creditCost !== undefined && { creditCost: input.creditCost }),
      ...(input.retryPolicy !== undefined && { retryPolicy: input.retryPolicy as any }),
      ...(input.chainEventName !== undefined && { chainEventName: input.chainEventName }),
    } as any,
  });

  log.info('Skill updated', { skillId });
  return skill;
}

/**
 * Publish a skill. Validates it has a PUBLISHED agent version.
 * If triggerType is SCHEDULE, registers a BullMQ repeatable job (T071).
 */
export async function publishSkill(skillId: string) {
  const skill = await prisma.skill.findUnique({
    where: { id: skillId },
    include: { agentVersion: true },
  });

  if (!skill) throw new Error(`Skill ${skillId} not found`);

  if (skill.agentVersion.status !== 'PUBLISHED') {
    throw new Error('Cannot publish skill: agent version is not PUBLISHED');
  }

  const updated = await prisma.skill.update({
    where: { id: skillId },
    data: { status: 'PUBLISHED' },
  });

  // Register scheduled job if applicable (T071)
  if (skill.triggerType === 'SCHEDULED' && skill.triggerConfig) {
    const config = skill.triggerConfig as Record<string, unknown>;
    const cron = config.cron as string;
    if (cron) {
      await skillExecutionQueue.upsertJobScheduler(
        `scheduled-skill-${skillId}`,
        { pattern: cron },
        {
          name: 'scheduled-skill-execution',
          data: {
            executionId: '', // Will be created by worker
            skillId,
            slackTeamId: (config.slackTeamId as string) ?? '',
          },
        },
      );
      log.info('Scheduled skill job registered', { skillId, cron });
    }
  }

  log.info('Skill published', { skillId });
  return updated;
}

/**
 * Deprecate a skill. Removes any scheduled jobs.
 */
export async function deprecateSkill(skillId: string) {
  const skill = await prisma.skill.findUnique({ where: { id: skillId } });
  if (!skill) throw new Error(`Skill ${skillId} not found`);

  const updated = await prisma.skill.update({
    where: { id: skillId },
    data: { status: 'DEPRECATED' },
  });

  // Remove scheduled job if applicable (T071)
  if (skill.triggerType === 'SCHEDULED') {
    try {
      await skillExecutionQueue.removeJobScheduler(`scheduled-skill-${skillId}`);
      log.info('Scheduled skill job removed', { skillId });
    } catch {
      // Scheduler may not exist if it was never published
    }
  }

  log.info('Skill deprecated', { skillId });
  return updated;
}

// ---------------------------------------------------------------------------
// Agent Version Check (T031)
// ---------------------------------------------------------------------------

/**
 * Check if a skill's pinned agent version is outdated compared
 * to the latest PUBLISHED version of the same agent (FR-011a).
 */
export async function checkAgentVersionUpgrade(skillId: string) {
  const skill = await prisma.skill.findUnique({
    where: { id: skillId },
    include: { agentVersion: true },
  });

  if (!skill) throw new Error(`Skill ${skillId} not found`);

  const latestPublished = await prisma.agentVersion.findFirst({
    where: {
      agentId: skill.agentId,
      status: 'PUBLISHED',
    },
    orderBy: { version: 'desc' },
  });

  const currentVersion = skill.agentVersion.version;
  const latestVersion = latestPublished?.version ?? currentVersion;

  return {
    currentVersion,
    latestPublishedVersion: latestVersion,
    updateAvailable: latestVersion > currentVersion,
  };
}
