/**
 * Onboarding plan CRUD endpoints (Feature 7).
 *
 * GET    /api/v1/admin/onboarding-plans                    — List plans
 * GET    /api/v1/admin/onboarding-plans/:planId            — Get plan detail
 * POST   /api/v1/admin/onboarding-plans                    — Create plan
 * PUT    /api/v1/admin/onboarding-plans/:planId            — Update plan
 * DELETE /api/v1/admin/onboarding-plans/:planId            — Delete plan
 * POST   /api/v1/admin/onboarding-plans/:planId/duplicate  — Duplicate plan
 * GET    /api/v1/admin/onboarding-plans/:planId/preview    — Preview drip sequence
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import {
  createPlan,
  getPlan,
  listPlans,
  updatePlan,
  deletePlan,
  duplicatePlan,
} from '../../services/onboarding/planService.js';
import { buildDailyModuleDm } from '../../services/onboarding/slackBlocks.js';
import { logAudit } from '../../lib/auditLogger.js';
import logger from '../../lib/logger.js';

export const onboardingPlansRouter = Router();

// ---------------------------------------------------------------------------
// GET / — List plans
// ---------------------------------------------------------------------------

onboardingPlansRouter.get('/', async (req: Request, res: Response) => {
  try {
    const teamId = req.query.teamId as string;
    if (!teamId) {
      return res.status(400).json({ error: 'missing_param', message: 'teamId is required' });
    }

    const latestOnly = req.query.latestOnly !== 'false';
    const plans = await listPlans(teamId, latestOnly);

    res.json({
      plans: plans.map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        duration_days: p.durationDays,
        supervised_start_day: p.supervisedStartDay,
        version: p.version,
        is_latest: p.isLatest,
        weekdays_only: p.weekdaysOnly,
        module_count: 0, // Calculated from modules relation if needed
        active_enrollments: p._count.enrollments,
        created_by_user_id: p.createdByUserId,
        created_at: p.createdAt,
        updated_at: p.updatedAt,
      })),
    });
  } catch (error) {
    logger.error('Failed to list onboarding plans', { error });
    res.status(500).json({ error: 'internal_error', message: 'An unexpected error occurred' });
  }
});

// ---------------------------------------------------------------------------
// GET /:planId — Get plan detail
// ---------------------------------------------------------------------------

onboardingPlansRouter.get('/:planId', async (req: Request, res: Response) => {
  try {
    const planId = req.params.planId as string;
    const plan = await getPlan(planId);
    if (!plan) {
      return res.status(404).json({ error: 'not_found', message: 'Plan not found' });
    }

    res.json({
      plan: {
        id: plan.id,
        name: plan.name,
        description: plan.description,
        duration_days: plan.durationDays,
        supervised_start_day: plan.supervisedStartDay,
        version: plan.version,
        is_latest: plan.isLatest,
        weekdays_only: plan.weekdaysOnly,
        created_by_user_id: plan.createdByUserId,
        created_at: plan.createdAt,
        modules: plan.modules.map((mod) => ({
          id: mod.id,
          day_number: mod.dayNumber,
          week_number: mod.weekNumber,
          title: mod.title,
          description: mod.description,
          estimated_minutes: mod.estimatedMinutes,
          training_items: mod.trainingItems.map((item) => ({
            id: item.id,
            type: item.type,
            title: item.title,
            content: item.content,
            metadata: item.metadata,
            estimated_minutes: item.estimatedMinutes,
            sort_order: item.sortOrder,
            library_item_id: item.libraryItemId,
          })),
          automations: mod.automations.map((auto) => ({
            id: auto.id,
            type: auto.type,
            trigger_time: auto.triggerTime,
            content: auto.content,
            conditions: auto.conditions,
          })),
        })),
      },
    });
  } catch (error) {
    logger.error('Failed to get onboarding plan', { planId: req.params.planId as string, error });
    res.status(500).json({ error: 'internal_error', message: 'An unexpected error occurred' });
  }
});

// ---------------------------------------------------------------------------
// POST / — Create plan
// ---------------------------------------------------------------------------

onboardingPlansRouter.post('/', async (req: Request, res: Response) => {
  try {
    const body = req.body;
    if (!body.slack_team_id || !body.name || !body.duration_days) {
      return res.status(400).json({
        error: 'missing_param',
        message: 'slack_team_id, name, and duration_days are required',
      });
    }

    const plan = await createPlan({
      slackTeamId: body.slack_team_id,
      name: body.name,
      description: body.description,
      durationDays: body.duration_days,
      supervisedStartDay: body.supervised_start_day,
      weekdaysOnly: body.weekdays_only ?? true,
      createdByUserId: body.created_by_user_id ?? 'system',
      modules: (body.modules ?? []).map((mod: Record<string, unknown>) => ({
        dayNumber: mod.day_number as number,
        title: mod.title as string,
        description: mod.description as string | undefined,
        estimatedMinutes: mod.estimated_minutes as number | undefined,
        trainingItems: ((mod.training_items as Array<Record<string, unknown>>) ?? []).map(
          (item) => ({
            type: item.type as string,
            title: item.title as string,
            content: item.content as string | undefined,
            metadata: item.metadata,
            estimatedMinutes: item.estimated_minutes as number | undefined,
            libraryItemId: item.library_item_id as string | undefined,
          }),
        ),
        automations: ((mod.automations as Array<Record<string, unknown>>) ?? []).map((auto) => ({
          type: auto.type as string,
          triggerTime: auto.trigger_time as string,
          content: auto.content as string | undefined,
          conditions: auto.conditions,
        })),
      })),
    });

    logAudit({
      action: 'onboarding_plan_created',
      targetType: 'OnboardingPlan',
      targetId: plan.id,
      actorUserId: body.created_by_user_id ?? 'system',
      actorTeamId: body.slack_team_id,
      metadata: { planName: body.name },
    });

    res.status(201).json({ plan });
  } catch (error) {
    logger.error('Failed to create onboarding plan', { error });
    res.status(500).json({ error: 'internal_error', message: 'An unexpected error occurred' });
  }
});

// ---------------------------------------------------------------------------
// PUT /:planId — Update plan
// ---------------------------------------------------------------------------

onboardingPlansRouter.put('/:planId', async (req: Request, res: Response) => {
  try {
    const planId = req.params.planId as string;
    const body = req.body;
    const result = await updatePlan(planId, body);

    logAudit({
      action: 'onboarding_plan_updated',
      targetType: 'OnboardingPlan',
      targetId: planId,
      actorUserId: body.created_by_user_id ?? 'system',
      actorTeamId: body.slack_team_id,
      metadata: { planId },
    });

    res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'An unexpected error occurred';
    if (message.includes('not found')) {
      return res.status(404).json({ error: 'not_found', message });
    }
    logger.error('Failed to update onboarding plan', { planId: req.params.planId as string, error });
    res.status(500).json({ error: 'internal_error', message: 'An unexpected error occurred' });
  }
});

// ---------------------------------------------------------------------------
// DELETE /:planId — Delete plan
// ---------------------------------------------------------------------------

onboardingPlansRouter.delete('/:planId', async (req: Request, res: Response) => {
  try {
    const planId = req.params.planId as string;
    await deletePlan(planId);

    logAudit({
      action: 'onboarding_plan_deleted',
      targetType: 'OnboardingPlan',
      targetId: planId,
      actorUserId: 'system',
      metadata: { planId },
    });

    res.json({ message: 'Plan archived successfully', plan_id: planId });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'An unexpected error occurred';
    if (message.includes('active enrollments')) {
      return res.status(409).json({ error: 'plan_in_use', message });
    }
    if (message.includes('not found')) {
      return res.status(404).json({ error: 'not_found', message });
    }
    logger.error('Failed to delete onboarding plan', { planId: req.params.planId as string, error });
    res.status(500).json({ error: 'internal_error', message: 'An unexpected error occurred' });
  }
});

// ---------------------------------------------------------------------------
// POST /:planId/duplicate — Duplicate plan
// ---------------------------------------------------------------------------

onboardingPlansRouter.post('/:planId/duplicate', async (req: Request, res: Response) => {
  try {
    const planId = req.params.planId as string;
    const newName = req.body.name;
    if (!newName) {
      return res.status(400).json({ error: 'missing_param', message: 'name is required' });
    }

    const plan = await duplicatePlan(planId, newName);

    logAudit({
      action: 'onboarding_plan_duplicated',
      targetType: 'OnboardingPlan',
      targetId: plan.id,
      actorUserId: 'system',
      metadata: { sourcePlanId: planId, newName },
    });

    res.status(201).json({ plan });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'An unexpected error occurred';
    if (message.includes('not found')) {
      return res.status(404).json({ error: 'not_found', message });
    }
    logger.error('Failed to duplicate onboarding plan', { planId: req.params.planId as string, error });
    res.status(500).json({ error: 'internal_error', message: 'An unexpected error occurred' });
  }
});

// ---------------------------------------------------------------------------
// GET /:planId/preview — Preview drip sequence
// ---------------------------------------------------------------------------

onboardingPlansRouter.get('/:planId/preview', async (req: Request, res: Response) => {
  try {
    const planId = req.params.planId as string;
    const plan = await getPlan(planId);
    if (!plan) {
      return res.status(404).json({ error: 'not_found', message: 'Plan not found' });
    }

    const preview = plan.modules.map((mod) => {
      const dm = buildDailyModuleDm({
        enrollmentId: 'preview',
        dayNumber: mod.dayNumber,
        weekNumber: mod.weekNumber,
        moduleTitle: mod.title,
        moduleDescription: mod.description ?? undefined,
        trainingItems: mod.trainingItems.map((item) => ({
          type: item.type,
          title: item.title,
          content: item.content ?? undefined,
        })),
        progressCompleted: mod.dayNumber - 1,
        progressTotal: plan.durationDays,
        hasPreviousIncomplete: false,
      });

      return {
        day_number: mod.dayNumber,
        week_number: mod.weekNumber,
        module_title: mod.title,
        dm_blocks: dm.blocks,
        automations: mod.automations.map((auto) => ({
          type: auto.type,
          trigger_time: auto.triggerTime,
          content: auto.content,
        })),
      };
    });

    res.json({ preview });
  } catch (error) {
    logger.error('Failed to preview onboarding plan', { planId: req.params.planId as string, error });
    res.status(500).json({ error: 'internal_error', message: 'An unexpected error occurred' });
  }
});
