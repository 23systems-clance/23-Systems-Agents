/**
 * Pack Manager Service (Feature 39 - Vertical Pack Platform)
 *
 * CRUD for vertical packs (curated skill bundles), skill assignment,
 * and subscription lifecycle management (FR-016, FR-020).
 */

import { prisma } from '../../models/index.js';
import logger from '../../lib/logger.js';
import type { PackStatus, PackCategory, PackTier } from '@prisma/client';

const log = logger.withContext({ service: 'packManager' });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CreatePackInput {
  name: string;
  slug: string;
  description?: string;
  category: PackCategory;
  tier: PackTier;
  monthlyPriceUsd?: number;
  creditsIncluded: number;
  overageRateUsd?: number;
  skillIds?: string[];
}

export interface UpdatePackInput {
  name?: string;
  description?: string;
  tier?: PackTier;
  monthlyPriceUsd?: number;
  creditsIncluded?: number;
  overageRateUsd?: number;
}

// ---------------------------------------------------------------------------
// Pack CRUD (T041)
// ---------------------------------------------------------------------------

/**
 * Create a new vertical pack.
 */
export async function createPack(input: CreatePackInput) {
  const pack = await prisma.verticalPack.create({
    data: {
      name: input.name,
      slug: input.slug,
      description: input.description,
      category: input.category,
      tier: input.tier,
      monthlyPriceUsd: input.monthlyPriceUsd ?? 0,
      creditsIncluded: input.creditsIncluded,
      overageRateUsd: input.overageRateUsd ?? 0,
    },
  });

  // Assign initial skills if provided
  if (input.skillIds && input.skillIds.length > 0) {
    await assignSkills(pack.id, input.skillIds);
  }

  log.info('Pack created', { packId: pack.id, slug: pack.slug });
  return pack;
}

/**
 * Get pack by ID with skills and analytics.
 */
export async function getPack(packId: string) {
  const pack = await prisma.verticalPack.findUnique({
    where: { id: packId },
    include: {
      packSkills: {
        include: {
          skill: { select: { id: true, name: true, slug: true, creditCost: true, status: true } },
        },
        orderBy: { sortOrder: 'asc' },
      },
      _count: { select: { subscriptions: true } },
    },
  });

  if (!pack) return null;

  // Analytics
  const activeSubscribers = await prisma.packSubscription.count({
    where: { packId, status: 'ACTIVE' },
  });

  const totalCreditsUsed = await prisma.packSubscription.aggregate({
    where: { packId },
    _sum: { creditsUsed: true },
  });

  const totalRevenue = activeSubscribers * Number(pack.monthlyPriceUsd);

  return {
    ...pack,
    skills: pack.packSkills.map((ps) => ({
      id: ps.skill.id,
      name: ps.skill.name,
      slug: ps.skill.slug,
      creditCost: Number(ps.skill.creditCost),
      status: ps.skill.status,
      sortOrder: ps.sortOrder,
    })),
    analytics: {
      subscriberCount: pack._count.subscriptions,
      activeUsers: activeSubscribers,
      totalCreditsUsed: totalCreditsUsed._sum.creditsUsed ?? 0,
      totalRevenue,
      churnRate: 0, // Would require period-over-period calculation
    },
  };
}

/**
 * List packs with optional status and category filters.
 */
export async function listPacks(options?: { status?: PackStatus; category?: PackCategory }) {
  const where: Record<string, unknown> = {};
  if (options?.status) where.status = options.status;
  if (options?.category) where.category = options.category;

  const packs = await prisma.verticalPack.findMany({
    where,
    orderBy: { name: 'asc' },
    include: {
      _count: {
        select: { packSkills: true, subscriptions: true },
      },
    },
  });

  return packs.map((p) => ({
    id: p.id,
    name: p.name,
    slug: p.slug,
    category: p.category,
    status: p.status,
    tier: p.tier,
    monthlyPriceUsd: Number(p.monthlyPriceUsd),
    skillCount: p._count.packSkills,
    subscriberCount: p._count.subscriptions,
    createdAt: p.createdAt,
  }));
}

/**
 * Update a pack.
 */
export async function updatePack(packId: string, input: UpdatePackInput) {
  const pack = await prisma.verticalPack.update({
    where: { id: packId },
    data: {
      ...(input.name && { name: input.name }),
      ...(input.description !== undefined && { description: input.description }),
      ...(input.tier && { tier: input.tier }),
      ...(input.monthlyPriceUsd !== undefined && { monthlyPriceUsd: input.monthlyPriceUsd }),
      ...(input.creditsIncluded !== undefined && { creditsIncluded: input.creditsIncluded }),
      ...(input.overageRateUsd !== undefined && { overageRateUsd: input.overageRateUsd }),
    },
  });

  log.info('Pack updated', { packId });
  return pack;
}

/**
 * Publish a pack. Only PUBLISHED skills can be in a published pack (FR-016).
 */
export async function publishPack(packId: string) {
  const pack = await prisma.verticalPack.findUnique({
    where: { id: packId },
    include: {
      packSkills: {
        include: { skill: { select: { id: true, name: true, status: true } } },
      },
    },
  });

  if (!pack) throw new Error(`Pack ${packId} not found`);

  const unpublishedSkills = pack.packSkills.filter((ps) => ps.skill.status !== 'PUBLISHED');
  if (unpublishedSkills.length > 0) {
    const names = unpublishedSkills.map((ps) => ps.skill.name).join(', ');
    throw new Error(`Cannot publish pack: skills not PUBLISHED: ${names}`);
  }

  const updated = await prisma.verticalPack.update({
    where: { id: packId },
    data: { status: 'PUBLISHED' },
  });

  log.info('Pack published', { packId });
  return updated;
}

/**
 * Deprecate a pack.
 */
export async function deprecatePack(packId: string) {
  const pack = await prisma.verticalPack.findUnique({ where: { id: packId } });
  if (!pack) throw new Error(`Pack ${packId} not found`);

  const updated = await prisma.verticalPack.update({
    where: { id: packId },
    data: { status: 'DEPRECATED' },
  });

  log.info('Pack deprecated', { packId });
  return updated;
}

/**
 * Assign skills to a pack (replaces all). Only PUBLISHED skills allowed (FR-016).
 */
export async function assignSkills(packId: string, skillIds: string[]) {
  // Validate all skills are PUBLISHED
  const skills = await prisma.skill.findMany({
    where: { id: { in: skillIds } },
    select: { id: true, name: true, status: true },
  });

  const notPublished = skills.filter((s) => s.status !== 'PUBLISHED');
  if (notPublished.length > 0) {
    const names = notPublished.map((s) => s.name).join(', ');
    throw new Error(`Skills must be PUBLISHED: ${names}`);
  }

  // Replace all pack skills
  await prisma.$transaction([
    prisma.packSkill.deleteMany({ where: { packId } }),
    ...skillIds.map((skillId, index) =>
      prisma.packSkill.create({
        data: { packId, skillId, sortOrder: index },
      }),
    ),
  ]);

  log.info('Pack skills assigned', { packId, count: skillIds.length });
}

// ---------------------------------------------------------------------------
// Subscription Management (T042)
// ---------------------------------------------------------------------------

/**
 * Subscribe a workspace to a pack.
 * Creates PackSubscription with initial credit allocation.
 */
export async function subscribeToPack(packId: string, slackTeamId: string) {
  const pack = await prisma.verticalPack.findUnique({ where: { id: packId } });
  if (!pack) throw new Error(`Pack ${packId} not found`);
  if (pack.status !== 'PUBLISHED') throw new Error('Pack is not published');

  // Check for existing active subscription
  const existing = await prisma.packSubscription.findFirst({
    where: { packId, slackTeamId, status: 'ACTIVE' },
  });
  if (existing) throw new Error('Workspace already subscribed to this pack');

  const now = new Date();
  const periodEnd = new Date(now);
  periodEnd.setMonth(periodEnd.getMonth() + 1);

  const subscription = await prisma.packSubscription.create({
    data: {
      packId,
      slackTeamId,
      status: 'ACTIVE',
      creditsIncluded: pack.creditsIncluded,
      creditsUsed: 0,
      currentPeriodStart: now,
      currentPeriodEnd: periodEnd,
    },
  });

  log.info('Pack subscription created', { packId, slackTeamId, subscriptionId: subscription.id });
  return subscription;
}

/**
 * Cancel a pack subscription.
 */
export async function cancelSubscription(subscriptionId: string) {
  const subscription = await prisma.packSubscription.update({
    where: { id: subscriptionId },
    data: { status: 'CANCELLED' },
  });

  log.info('Pack subscription cancelled', { subscriptionId });
  return subscription;
}

/**
 * List active subscriptions for a workspace.
 */
export async function listSubscriptions(slackTeamId: string) {
  return prisma.packSubscription.findMany({
    where: { slackTeamId, status: 'ACTIVE' },
    include: {
      pack: { select: { id: true, name: true, slug: true, category: true, tier: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
}

/**
 * Browse pack catalog. Returns published packs with subscription status.
 */
export async function browseCatalog(slackTeamId: string) {
  const packs = await prisma.verticalPack.findMany({
    where: { status: 'PUBLISHED' },
    include: {
      packSkills: {
        include: {
          skill: { select: { name: true, description: true } },
        },
        orderBy: { sortOrder: 'asc' },
      },
    },
    orderBy: { name: 'asc' },
  });

  // Check subscription status
  const subscriptions = await prisma.packSubscription.findMany({
    where: { slackTeamId, status: 'ACTIVE' },
    select: { packId: true },
  });
  const subscribedSet = new Set(subscriptions.map((s) => s.packId));

  return packs.map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description,
    category: p.category,
    tier: p.tier,
    monthlyPriceUsd: Number(p.monthlyPriceUsd),
    creditsIncluded: p.creditsIncluded,
    skills: p.packSkills.map((ps) => ({
      name: ps.skill.name,
      description: ps.skill.description,
    })),
    isSubscribed: subscribedSet.has(p.id),
  }));
}
