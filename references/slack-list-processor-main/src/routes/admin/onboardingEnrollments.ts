/**
 * Onboarding enrollment admin endpoints (Feature 7).
 *
 * GET    /api/v1/admin/onboarding-enrollments                          — List enrollments with progress summary
 * GET    /api/v1/admin/onboarding-enrollments/:enrollmentId            — Get detailed enrollment with module progress
 * POST   /api/v1/admin/onboarding-enrollments                          — Enroll a BDR in a plan
 * PUT    /api/v1/admin/onboarding-enrollments/:enrollmentId            — Update enrollment settings
 * POST   /api/v1/admin/onboarding-enrollments/:enrollmentId/cancel     — Cancel enrollment
 * POST   /api/v1/admin/onboarding-enrollments/:enrollmentId/graduate   — Approve graduation
 * POST   /api/v1/admin/onboarding-enrollments/:enrollmentId/extend     — Extend onboarding
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { OnboardingEnrollmentStatus } from '@prisma/client';
import {
  enrollBdr,
  getEnrollment,
  listEnrollments,
  updateEnrollment,
  cancelEnrollment,
} from '../../services/onboarding/enrollmentService.js';
import { getProgressSummary } from '../../services/onboarding/progressService.js';
import { buildWelcomeDm } from '../../services/onboarding/slackBlocks.js';
import { logAudit } from '../../lib/auditLogger.js';
import logger from '../../lib/logger.js';
import { prisma } from '../../models/index.js';
import { onboardingQueue } from '../../services/queue/queues.js';

export const onboardingEnrollmentsRouter = Router();

// ---------------------------------------------------------------------------
// GET / — List enrollments with progress summary
// ---------------------------------------------------------------------------

onboardingEnrollmentsRouter.get('/', async (req: Request, res: Response) => {
  try {
    const teamId = req.query.teamId as string;
    if (!teamId) {
      return res.status(400).json({ error: 'missing_param', message: 'teamId is required' });
    }

    const statusParam = req.query.status as string | undefined;
    const status = statusParam
      ? (statusParam as OnboardingEnrollmentStatus)
      : undefined;

    const result = await listEnrollments(teamId, status);

    res.json({
      enrollments: result.enrollments.map((e) => {
        const totalModules = e.moduleProgress.length;
        const completedModules = e.moduleProgress.filter(
          (mp) => mp.status === 'COMPLETED',
        ).length;
        const progressPercentage =
          totalModules > 0
            ? Math.round((completedModules / totalModules) * 100)
            : 0;

        return {
          id: e.id,
          slack_team_id: e.slackTeamId,
          slack_user_id: e.slackUserId,
          bdr_name: e.bdrName,
          plan_id: e.planId,
          plan_name: e.plan.name,
          manager_id: e.managerId,
          start_date: e.startDate,
          delivery_hour: e.deliveryHour,
          timezone: e.timezone,
          status: e.status,
          current_day: e.currentDay,
          supervised_campaign_id: e.supervisedCampaignId,
          graduated_at: e.graduatedAt,
          cancelled_at: e.cancelledAt,
          extended_days: e.extendedDays,
          progress_percentage: progressPercentage,
          modules_completed: completedModules,
          modules_total: totalModules,
          created_at: e.createdAt,
          updated_at: e.updatedAt,
        };
      }),
      summary: {
        total_active: result.summary.totalActive,
        total_supervised: result.summary.totalSupervised,
        total_pending_graduation: result.summary.totalPendingGraduation,
        average_progress: result.summary.averageProgress,
      },
    });
  } catch (error) {
    logger.error('Failed to list onboarding enrollments', { error });
    res.status(500).json({ error: 'internal_error', message: 'An unexpected error occurred' });
  }
});

// ---------------------------------------------------------------------------
// GET /:enrollmentId — Get detailed enrollment with module progress
// ---------------------------------------------------------------------------

onboardingEnrollmentsRouter.get('/:enrollmentId', async (req: Request, res: Response) => {
  try {
    const enrollmentId = req.params.enrollmentId as string;
    const enrollment = await getEnrollment(enrollmentId);
    if (!enrollment) {
      return res.status(404).json({ error: 'not_found', message: 'Enrollment not found' });
    }

    // Load check-in responses for this enrollment
    const checkinResponses = await prisma.checkinResponse.findMany({
      where: { enrollmentId: enrollment.id },
      orderBy: { dayNumber: 'asc' },
    });

    // Index check-in responses by day number for efficient lookup
    const checkinsByDay = new Map<number, typeof checkinResponses>();
    for (const cr of checkinResponses) {
      const existing = checkinsByDay.get(cr.dayNumber) ?? [];
      existing.push(cr);
      checkinsByDay.set(cr.dayNumber, existing);
    }

    const progress = await getProgressSummary(enrollment.id);

    res.json({
      enrollment: {
        id: enrollment.id,
        slack_team_id: enrollment.slackTeamId,
        slack_user_id: enrollment.slackUserId,
        bdr_name: enrollment.bdrName,
        plan_id: enrollment.planId,
        plan_name: enrollment.plan.name,
        manager_id: enrollment.managerId,
        start_date: enrollment.startDate,
        delivery_hour: enrollment.deliveryHour,
        timezone: enrollment.timezone,
        status: enrollment.status,
        current_day: enrollment.currentDay,
        supervised_campaign_id: enrollment.supervisedCampaignId,
        graduated_at: enrollment.graduatedAt,
        cancelled_at: enrollment.cancelledAt,
        extended_days: enrollment.extendedDays,
        progress_percentage: progress.percentage,
        modules_completed: progress.completed,
        modules_total: progress.total,
        created_at: enrollment.createdAt,
        updated_at: enrollment.updatedAt,
        module_progress: enrollment.moduleProgress.map((mp) => {
          const dayCheckins = checkinsByDay.get(mp.dayNumber) ?? [];
          return {
            id: mp.id,
            day_number: mp.dayNumber,
            module_title: mp.module.title,
            status: mp.status,
            delivered_at: mp.deliveredAt,
            completed_at: mp.completedAt,
            quiz_score: mp.quizScore,
            manager_review_status: mp.managerReviewStatus,
            checkin_responses: dayCheckins.map((cr) => ({
              id: cr.id,
              automation_id: cr.automationId,
              response: cr.response,
              responded_at: cr.respondedAt,
            })),
          };
        }),
      },
    });
  } catch (error) {
    logger.error('Failed to get onboarding enrollment', {
      enrollmentId: req.params.enrollmentId as string,
      error,
    });
    res.status(500).json({ error: 'internal_error', message: 'An unexpected error occurred' });
  }
});

// ---------------------------------------------------------------------------
// POST / — Enroll a BDR in a plan
// ---------------------------------------------------------------------------

onboardingEnrollmentsRouter.post('/', async (req: Request, res: Response) => {
  try {
    const body = req.body;
    if (!body.slack_team_id || !body.slack_user_id || !body.plan_id) {
      return res.status(400).json({
        error: 'missing_param',
        message: 'slack_team_id, slack_user_id, and plan_id are required',
      });
    }

    // Check for duplicate active enrollment
    const existingEnrollment = await prisma.onboardingEnrollment.findFirst({
      where: {
        slackUserId: body.slack_user_id,
        status: {
          in: [
            OnboardingEnrollmentStatus.ACTIVE,
            OnboardingEnrollmentStatus.SUPERVISED,
          ],
        },
      },
    });

    if (existingEnrollment) {
      return res.status(409).json({
        error: 'duplicate_enrollment',
        message: 'BDR already has an active onboarding enrollment',
        existing_enrollment_id: existingEnrollment.id,
      });
    }

    const enrollment = await enrollBdr({
      slackTeamId: body.slack_team_id,
      slackUserId: body.slack_user_id,
      bdrName: body.bdr_name ?? body.slack_user_id,
      planId: body.plan_id,
      managerId: body.manager_id ?? 'system',
      startDate: body.start_date ? new Date(body.start_date) : new Date(),
      deliveryHour: body.delivery_hour ?? 9,
      timezone: body.timezone ?? 'America/New_York',
    });

    // Attempt to send welcome DM
    let welcomeDmSent = false;
    try {
      const plan = await prisma.onboardingPlan.findUnique({
        where: { id: body.plan_id },
        include: {
          modules: {
            orderBy: { dayNumber: 'asc' },
            take: 1,
          },
        },
      });

      if (plan) {
        const firstModuleTitle = plan.modules[0]?.title ?? 'Day 1';
        const welcomeMessage = buildWelcomeDm({
          planName: plan.name,
          durationDays: plan.durationDays,
          managerName: body.manager_id ?? 'your manager',
          deliveryHour: body.delivery_hour ?? 9,
          timezone: body.timezone ?? 'America/New_York',
          firstModuleTitle,
        });

        // TODO: Wire up Slack client injection. For now, attempt to use
        // req-level slackClient if available, otherwise skip the DM.
        const slackClient = (req as unknown as Record<string, unknown>).slackClient as
          | { chat: { postMessage: (opts: Record<string, unknown>) => Promise<unknown> } }
          | undefined;

        if (slackClient) {
          await slackClient.chat.postMessage({
            channel: body.slack_user_id,
            text: welcomeMessage.text,
            blocks: welcomeMessage.blocks,
          });
          welcomeDmSent = true;
        } else {
          logger.warn('Slack client not available for welcome DM', {
            enrollmentId: enrollment.id,
          });
        }
      }
    } catch (dmError) {
      logger.error('Failed to send welcome DM', {
        enrollmentId: enrollment.id,
        error: dmError,
      });
    }

    logAudit({
      action: 'onboarding_enrollment_created',
      targetType: 'OnboardingEnrollment',
      targetId: enrollment.id,
      actorUserId: body.manager_id ?? 'system',
      actorTeamId: body.slack_team_id,
      metadata: {
        bdrName: body.bdr_name,
        planId: body.plan_id,
        slackUserId: body.slack_user_id,
      },
    });

    res.status(201).json({
      enrollment: {
        id: enrollment.id,
        slack_team_id: enrollment.slackTeamId,
        slack_user_id: enrollment.slackUserId,
        bdr_name: enrollment.bdrName,
        plan_id: enrollment.planId,
        manager_id: enrollment.managerId,
        start_date: enrollment.startDate,
        delivery_hour: enrollment.deliveryHour,
        timezone: enrollment.timezone,
        status: enrollment.status,
        created_at: enrollment.createdAt,
      },
      welcome_dm_sent: welcomeDmSent,
      scheduler_created: true,
    });
  } catch (error) {
    logger.error('Failed to create onboarding enrollment', { error });
    res.status(500).json({ error: 'internal_error', message: 'An unexpected error occurred' });
  }
});

// ---------------------------------------------------------------------------
// PUT /:enrollmentId — Update enrollment settings
// ---------------------------------------------------------------------------

onboardingEnrollmentsRouter.put('/:enrollmentId', async (req: Request, res: Response) => {
  try {
    const enrollmentId = req.params.enrollmentId as string;
    const body = req.body;
    const updated = await updateEnrollment(enrollmentId, {
      deliveryHour: body.delivery_hour,
      timezone: body.timezone,
      supervisedCampaignId: body.supervised_campaign_id,
    });

    logAudit({
      action: 'onboarding_enrollment_updated',
      targetType: 'OnboardingEnrollment',
      targetId: enrollmentId,
      actorUserId: 'system',
      actorTeamId: updated.slackTeamId,
      metadata: {
        deliveryHour: body.delivery_hour,
        timezone: body.timezone,
        supervisedCampaignId: body.supervised_campaign_id,
      },
    });

    res.json({
      enrollment: {
        id: updated.id,
        slack_team_id: updated.slackTeamId,
        slack_user_id: updated.slackUserId,
        bdr_name: updated.bdrName,
        plan_id: updated.planId,
        manager_id: updated.managerId,
        start_date: updated.startDate,
        delivery_hour: updated.deliveryHour,
        timezone: updated.timezone,
        status: updated.status,
        current_day: updated.currentDay,
        supervised_campaign_id: updated.supervisedCampaignId,
        graduated_at: updated.graduatedAt,
        cancelled_at: updated.cancelledAt,
        extended_days: updated.extendedDays,
        created_at: updated.createdAt,
        updated_at: updated.updatedAt,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'An unexpected error occurred';
    if (message.includes('not found') || message.includes('Record to update not found')) {
      return res.status(404).json({ error: 'not_found', message: 'Enrollment not found' });
    }
    logger.error('Failed to update onboarding enrollment', {
      enrollmentId: req.params.enrollmentId as string,
      error,
    });
    res.status(500).json({ error: 'internal_error', message: 'An unexpected error occurred' });
  }
});

// ---------------------------------------------------------------------------
// POST /:enrollmentId/cancel — Cancel enrollment
// ---------------------------------------------------------------------------

onboardingEnrollmentsRouter.post('/:enrollmentId/cancel', async (req: Request, res: Response) => {
  try {
    const enrollmentId = req.params.enrollmentId as string;
    const reason = req.body.reason as string | undefined;
    const updated = await cancelEnrollment(enrollmentId, reason);

    logAudit({
      action: 'onboarding_enrollment_cancelled',
      targetType: 'OnboardingEnrollment',
      targetId: enrollmentId,
      actorUserId: 'system',
      actorTeamId: updated.slackTeamId,
      metadata: { reason: reason ?? 'no reason provided' },
    });

    res.json({
      enrollment: {
        id: updated.id,
        slack_team_id: updated.slackTeamId,
        slack_user_id: updated.slackUserId,
        bdr_name: updated.bdrName,
        status: updated.status,
        cancelled_at: updated.cancelledAt,
      },
      status: updated.status,
      scheduler_removed: true,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'An unexpected error occurred';
    if (message.includes('not found') || message.includes('Record to update not found')) {
      return res.status(404).json({ error: 'not_found', message: 'Enrollment not found' });
    }
    logger.error('Failed to cancel onboarding enrollment', {
      enrollmentId: req.params.enrollmentId as string,
      error,
    });
    res.status(500).json({ error: 'internal_error', message: 'An unexpected error occurred' });
  }
});

// ---------------------------------------------------------------------------
// POST /:enrollmentId/graduate — Approve graduation
// ---------------------------------------------------------------------------

onboardingEnrollmentsRouter.post('/:enrollmentId/graduate', async (req: Request, res: Response) => {
  try {
    const enrollmentId = req.params.enrollmentId as string;

    const updated = await prisma.onboardingEnrollment.update({
      where: { id: enrollmentId },
      data: {
        status: OnboardingEnrollmentStatus.GRADUATED,
        graduatedAt: new Date(),
      },
    });

    // Remove the BullMQ job scheduler
    await onboardingQueue.removeJobScheduler(`onboarding-dm-${enrollmentId}`);

    // Note: Graduation DM will be sent via graduationService (Phase 9).
    // For now, just mark as graduated.

    logAudit({
      action: 'onboarding_enrollment_graduated',
      targetType: 'OnboardingEnrollment',
      targetId: enrollmentId,
      actorUserId: 'system',
      actorTeamId: updated.slackTeamId,
      metadata: { bdrName: updated.bdrName },
    });

    res.json({
      enrollment: {
        id: updated.id,
        slack_team_id: updated.slackTeamId,
        slack_user_id: updated.slackUserId,
        bdr_name: updated.bdrName,
        status: updated.status,
        graduated_at: updated.graduatedAt,
      },
      status: updated.status,
      graduated_at: updated.graduatedAt,
      scheduler_removed: true,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'An unexpected error occurred';
    if (message.includes('not found') || message.includes('Record to update not found')) {
      return res.status(404).json({ error: 'not_found', message: 'Enrollment not found' });
    }
    logger.error('Failed to graduate onboarding enrollment', {
      enrollmentId: req.params.enrollmentId as string,
      error,
    });
    res.status(500).json({ error: 'internal_error', message: 'An unexpected error occurred' });
  }
});

// ---------------------------------------------------------------------------
// POST /:enrollmentId/extend — Extend onboarding
// ---------------------------------------------------------------------------

onboardingEnrollmentsRouter.post('/:enrollmentId/extend', async (req: Request, res: Response) => {
  try {
    const enrollmentId = req.params.enrollmentId as string;
    const body = req.body;

    if (!body.additional_days || typeof body.additional_days !== 'number' || body.additional_days < 1) {
      return res.status(400).json({
        error: 'missing_param',
        message: 'additional_days is required and must be a positive number',
      });
    }

    // Note: Full extend logic (creating new ModuleProgress records for added days)
    // will be implemented in graduationService (Phase 9). For now, update enrollment
    // with extended_days and set status to EXTENDED.
    const enrollment = await prisma.onboardingEnrollment.findUnique({
      where: { id: enrollmentId },
    });

    if (!enrollment) {
      return res.status(404).json({ error: 'not_found', message: 'Enrollment not found' });
    }

    const updated = await prisma.onboardingEnrollment.update({
      where: { id: enrollmentId },
      data: {
        extendedDays: enrollment.extendedDays + body.additional_days,
        status: OnboardingEnrollmentStatus.EXTENDED,
      },
    });

    logAudit({
      action: 'onboarding_enrollment_extended',
      targetType: 'OnboardingEnrollment',
      targetId: enrollmentId,
      actorUserId: 'system',
      actorTeamId: updated.slackTeamId,
      metadata: {
        additionalDays: body.additional_days,
        totalExtendedDays: updated.extendedDays,
        reason: body.reason ?? 'no reason provided',
      },
    });

    res.json({
      enrollment: {
        id: updated.id,
        slack_team_id: updated.slackTeamId,
        slack_user_id: updated.slackUserId,
        bdr_name: updated.bdrName,
        status: updated.status,
        extended_days: updated.extendedDays,
      },
      additional_days: body.additional_days,
      total_extended_days: updated.extendedDays,
      reason: body.reason ?? null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'An unexpected error occurred';
    if (message.includes('not found') || message.includes('Record to update not found')) {
      return res.status(404).json({ error: 'not_found', message: 'Enrollment not found' });
    }
    logger.error('Failed to extend onboarding enrollment', {
      enrollmentId: req.params.enrollmentId as string,
      error,
    });
    res.status(500).json({ error: 'internal_error', message: 'An unexpected error occurred' });
  }
});
