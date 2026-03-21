/**
 * Admin billing profile routes.
 *
 * CRUD operations for workspace billing profiles, manual credit
 * adjustments, and status transitions. All routes require admin auth.
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { prisma } from '../../models/index.js';
import { logAudit } from '../../lib/auditLogger.js';
import { generateAndSendMagicLink } from '../../services/billing/magicLinkService.js';
import logger from '../../lib/logger.js';

export const billingRouter = Router();

/**
 * GET /api/v1/admin/billing/profiles
 * List all billing profiles with pagination and optional status filter.
 */
billingRouter.get('/profiles', async (req: Request, res: Response) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 20));
    const status = req.query.status as string | undefined;

    const where = status ? { status: status as any } : {};

    const [profiles, total] = await Promise.all([
      prisma.billingProfile.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.billingProfile.count({ where }),
    ]);

    // Fetch workspace names for each profile
    const teamIds = profiles.map((p) => p.slackTeamId);
    const workspaces = await prisma.workspaceInstallation.findMany({
      where: { slackTeamId: { in: teamIds } },
      select: { slackTeamId: true, slackTeamName: true },
    });
    const nameMap = new Map(workspaces.map((w) => [w.slackTeamId, w.slackTeamName]));

    const enriched = profiles.map((p) => ({
      ...p,
      overageRateUsd: p.overageRateUsd.toString(),
      workspaceName: nameMap.get(p.slackTeamId) ?? p.slackTeamId,
    }));

    res.json({
      profiles: enriched,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    logger.error('Failed to list billing profiles', { error });
    res.status(500).json({ error: 'internal_error', message: 'An unexpected error occurred' });
  }
});

/**
 * GET /api/v1/admin/billing/profiles/:profileId
 * Get a single billing profile with recent transactions.
 */
billingRouter.get('/profiles/:profileId', async (req: Request, res: Response) => {
  try {
    const profileId = req.params.profileId as string;
    const profile = await prisma.billingProfile.findUnique({
      where: { id: profileId },
      include: {
        transactions: {
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
      },
    });

    if (!profile) {
      res.status(404).json({ error: 'not_found', message: 'Billing profile not found' });
      return;
    }

    // Fetch workspace name
    const workspace = await prisma.workspaceInstallation.findFirst({
      where: { slackTeamId: profile.slackTeamId },
      select: { slackTeamName: true },
    });

    const { transactions: recentTransactions, ...profileData } = profile;
    res.json({
      ...profileData,
      overageRateUsd: profileData.overageRateUsd.toString(),
      workspaceName: workspace?.slackTeamName ?? profileData.slackTeamId,
      recentTransactions,
    });
  } catch (error) {
    logger.error('Failed to get billing profile', { error });
    res.status(500).json({ error: 'internal_error', message: 'An unexpected error occurred' });
  }
});

/**
 * POST /api/v1/admin/billing/profiles
 * Create a new billing profile for a workspace.
 */
billingRouter.post('/profiles', async (req: Request, res: Response) => {
  try {
    const {
      slackTeamId,
      monthlyAllowance,
      maxRolloverCredits,
      overageRateUsd,
      billingCycleDay,
      billingEmail,
      billingContactUserId,
      billingExempt,
    } = req.body;

    if (!slackTeamId || monthlyAllowance == null || maxRolloverCredits == null || overageRateUsd == null || billingCycleDay == null) {
      res.status(400).json({ error: 'validation_error', message: 'Missing required fields: slackTeamId, monthlyAllowance, maxRolloverCredits, overageRateUsd, billingCycleDay' });
      return;
    }

    // Check for existing profile
    const existing = await prisma.billingProfile.findUnique({
      where: { slackTeamId },
    });
    if (existing) {
      res.status(409).json({ error: 'conflict', message: 'Billing profile already exists for this workspace' });
      return;
    }

    const profile = await prisma.billingProfile.create({
      data: {
        slackTeamId,
        monthlyAllowance,
        maxRolloverCredits,
        overageRateUsd,
        billingCycleDay,
        billingEmail: billingEmail ?? null,
        billingContactUserId: billingContactUserId ?? null,
        billingExempt: billingExempt ?? false,
      },
    });

    logAudit({
      action: 'billing_profile_created',
      actorUserId: req.admin!.id,
      targetType: 'billing_profile',
      targetId: profile.id,
      metadata: { slackTeamId, monthlyAllowance },
    });

    // Fetch workspace name for response
    const workspace = await prisma.workspaceInstallation.findFirst({
      where: { slackTeamId },
      select: { slackTeamName: true },
    });

    res.status(201).json({
      ...profile,
      overageRateUsd: profile.overageRateUsd.toString(),
      workspaceName: workspace?.slackTeamName ?? slackTeamId,
    });
  } catch (error) {
    logger.error('Failed to create billing profile', { error });
    res.status(500).json({ error: 'internal_error', message: 'An unexpected error occurred' });
  }
});

/**
 * PUT /api/v1/admin/billing/profiles/:profileId
 * Partial update of billing profile fields.
 */
billingRouter.put('/profiles/:profileId', async (req: Request, res: Response) => {
  try {
    const profileId = req.params.profileId as string;
    const allowedFields = [
      'monthlyAllowance', 'maxRolloverCredits', 'overageRateUsd',
      'billingCycleDay', 'billingEmail', 'billingContactUserId', 'billingExempt',
    ];

    const data: Record<string, any> = {};
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) {
        data[field] = req.body[field];
      }
    }

    if (Object.keys(data).length === 0) {
      res.status(400).json({ error: 'validation_error', message: 'No valid fields to update' });
      return;
    }

    const profile = await prisma.billingProfile.update({
      where: { id: profileId },
      data,
    });

    logAudit({
      action: 'billing_profile_updated',
      actorUserId: req.admin!.id,
      targetType: 'billing_profile',
      targetId: profileId,
      metadata: { updatedFields: Object.keys(data) },
    });

    const workspace = await prisma.workspaceInstallation.findFirst({
      where: { slackTeamId: profile.slackTeamId },
      select: { slackTeamName: true },
    });

    res.json({
      ...profile,
      overageRateUsd: profile.overageRateUsd.toString(),
      workspaceName: workspace?.slackTeamName ?? profile.slackTeamId,
    });
  } catch (error: any) {
    if (error?.code === 'P2025') {
      res.status(404).json({ error: 'not_found', message: 'Billing profile not found' });
      return;
    }
    logger.error('Failed to update billing profile', { error });
    res.status(500).json({ error: 'internal_error', message: 'An unexpected error occurred' });
  }
});

/**
 * PUT /api/v1/admin/billing/profiles/:profileId/status
 * Status transitions with validation.
 */
const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  ACTIVE: ['SUSPENDED'],
  SUSPENDED: ['ACTIVE'],
  DELINQUENT: ['ACTIVE'],
};

billingRouter.put('/profiles/:profileId/status', async (req: Request, res: Response) => {
  try {
    const profileId = req.params.profileId as string;
    const { status, reason } = req.body;

    if (!status) {
      res.status(400).json({ error: 'validation_error', message: 'Missing required field: status' });
      return;
    }

    const profile = await prisma.billingProfile.findUnique({
      where: { id: profileId },
    });

    if (!profile) {
      res.status(404).json({ error: 'not_found', message: 'Billing profile not found' });
      return;
    }

    const allowed = ALLOWED_TRANSITIONS[profile.status] ?? [];
    if (!allowed.includes(status)) {
      res.status(400).json({
        error: 'invalid_transition',
        message: `Cannot transition from ${profile.status} to ${status}. Allowed: ${allowed.join(', ') || 'none'}`,
      });
      return;
    }

    const updated = await prisma.billingProfile.update({
      where: { id: profileId },
      data: { status },
    });

    logAudit({
      action: 'billing_status_changed',
      actorUserId: req.admin!.id,
      targetType: 'billing_profile',
      targetId: profileId,
      metadata: { from: profile.status, to: status, reason },
    });

    const workspace = await prisma.workspaceInstallation.findFirst({
      where: { slackTeamId: updated.slackTeamId },
      select: { slackTeamName: true },
    });

    res.json({
      ...updated,
      overageRateUsd: updated.overageRateUsd.toString(),
      workspaceName: workspace?.slackTeamName ?? updated.slackTeamId,
    });
  } catch (error) {
    logger.error('Failed to update billing status', { error });
    res.status(500).json({ error: 'internal_error', message: 'An unexpected error occurred' });
  }
});

/**
 * POST /api/v1/admin/billing/profiles/:profileId/adjust
 * Manual credit adjustment with required reason.
 */
billingRouter.post('/profiles/:profileId/adjust', async (req: Request, res: Response) => {
  try {
    const profileId = req.params.profileId as string;
    const { amount, reason } = req.body;

    if (amount == null || !reason) {
      res.status(400).json({ error: 'validation_error', message: 'Missing required fields: amount, reason' });
      return;
    }

    if (typeof amount !== 'number' || amount === 0) {
      res.status(400).json({ error: 'validation_error', message: 'Amount must be a non-zero number' });
      return;
    }

    const result = await prisma.$transaction(async (tx) => {
      const profile = await tx.billingProfile.findUnique({
        where: { id: profileId },
      });

      if (!profile) return null;

      const newBalance = profile.creditBalance + amount;

      const transaction = await tx.creditTransaction.create({
        data: {
          billingProfileId: profileId,
          type: 'MANUAL_ADJUSTMENT',
          amount,
          balanceAfter: newBalance,
          description: `Manual adjustment by ${req.admin!.email}: ${amount > 0 ? '+' : ''}${amount} credits (${reason})`,
        },
      });

      const updated = await tx.billingProfile.update({
        where: { id: profileId },
        data: { creditBalance: newBalance },
      });

      return { transaction, profile: updated };
    });

    if (!result) {
      res.status(404).json({ error: 'not_found', message: 'Billing profile not found' });
      return;
    }

    logAudit({
      action: 'billing_credit_adjusted',
      actorUserId: req.admin!.id,
      targetType: 'billing_profile',
      targetId: profileId,
      metadata: { amount, reason, newBalance: result.profile.creditBalance },
    });

    res.json({
      transaction: result.transaction,
      newBalance: result.profile.creditBalance,
    });
  } catch (error) {
    logger.error('Failed to adjust credits', { error });
    res.status(500).json({ error: 'internal_error', message: 'An unexpected error occurred' });
  }
});

/**
 * POST /api/v1/admin/billing/profiles/:profileId/magic-link
 * Generate and send a magic link for payment onboarding.
 */
billingRouter.post('/profiles/:profileId/magic-link', async (req: Request, res: Response) => {
  try {
    const profileId = req.params.profileId as string;
    const { expiresInHours } = req.body;

    const profile = await prisma.billingProfile.findUnique({
      where: { id: profileId },
    });

    if (!profile) {
      res.status(404).json({ error: 'not_found', message: 'Billing profile not found' });
      return;
    }

    if (!profile.billingContactUserId && !profile.billingEmail) {
      res.status(400).json({ error: 'validation_error', message: 'No billing contact or email configured on this profile' });
      return;
    }

    const result = await generateAndSendMagicLink(profileId, {
      expiresInHours: expiresInHours ?? 24,
    });

    logAudit({
      action: 'billing_profile_updated',
      actorUserId: req.admin!.id,
      targetType: 'magic_link',
      targetId: result.magicLink.id,
      metadata: { billingProfileId: profileId, delivery: result.delivery },
    });

    res.status(201).json({
      magicLink: {
        id: result.magicLink.id,
        token: result.magicLink.token,
        expiresAt: result.magicLink.expiresAt,
        url: result.url,
      },
      delivery: result.delivery,
    });
  } catch (error) {
    logger.error('Failed to send magic link', { error });
    res.status(500).json({ error: 'internal_error', message: 'An unexpected error occurred' });
  }
});

/**
 * GET /api/v1/admin/billing/profiles/:profileId/transactions
 * Paginated, filterable transaction history for a billing profile.
 */
billingRouter.get('/profiles/:profileId/transactions', async (req: Request, res: Response) => {
  try {
    const profileId = req.params.profileId as string;
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 100);
    const skip = (page - 1) * limit;
    const typeFilter = req.query.type as string | undefined;
    const from = req.query.from as string | undefined;
    const to = req.query.to as string | undefined;

    const where: Record<string, unknown> = { billingProfileId: profileId };

    if (typeFilter) {
      const types = typeFilter.split(',').map((t) => t.trim());
      where.type = { in: types };
    }

    if (from || to) {
      const dateFilter: Record<string, Date> = {};
      if (from) dateFilter.gte = new Date(from);
      if (to) dateFilter.lte = new Date(to);
      where.createdAt = dateFilter;
    }

    const [transactions, total] = await Promise.all([
      prisma.creditTransaction.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.creditTransaction.count({ where }),
    ]);

    res.json({
      transactions,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (error) {
    logger.error('Failed to get transactions', { error });
    res.status(500).json({ error: 'internal_error', message: 'An unexpected error occurred' });
  }
});

/**
 * GET /api/v1/admin/billing/kpis
 * Platform-wide billing KPIs for the admin dashboard.
 */
billingRouter.get('/kpis', async (_req: Request, res: Response) => {
  try {
    const [
      activeCount,
      delinquentCount,
      totalProfiles,
      overageRevenue,
      totalCreditsConsumed,
      allProfiles,
    ] = await Promise.all([
      prisma.billingProfile.count({ where: { status: 'ACTIVE' } }),
      prisma.billingProfile.count({ where: { status: 'DELINQUENT' } }),
      prisma.billingProfile.count(),
      prisma.creditTransaction.aggregate({
        where: { type: 'OVERAGE_CHARGE' },
        _sum: { amount: true },
      }),
      prisma.creditTransaction.aggregate({
        where: { type: 'ENRICHMENT_DEDUCTION' },
        _sum: { amount: true },
      }),
      prisma.billingProfile.findMany({
        where: { status: 'ACTIVE' },
        select: { creditBalance: true, monthlyAllowance: true },
      }),
    ]);

    // Count low-balance clients (balance < 20% of monthlyAllowance)
    const lowBalanceCount = allProfiles.filter(
      (p) => p.monthlyAllowance > 0 && p.creditBalance < p.monthlyAllowance * 0.2,
    ).length;

    res.json({
      activeProfiles: activeCount,
      delinquentProfiles: delinquentCount,
      totalProfiles,
      totalOverageRevenue: Math.abs(overageRevenue._sum.amount ?? 0),
      totalCreditsConsumed: Math.abs(totalCreditsConsumed._sum.amount ?? 0),
      lowBalanceClients: lowBalanceCount,
    });
  } catch (error) {
    logger.error('Failed to get billing KPIs', { error });
    res.status(500).json({ error: 'internal_error', message: 'An unexpected error occurred' });
  }
});
