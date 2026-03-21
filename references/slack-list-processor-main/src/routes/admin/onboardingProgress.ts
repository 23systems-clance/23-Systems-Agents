/**
 * Onboarding progress dashboard admin endpoints (Feature 7).
 *
 * GET  /api/v1/admin/onboarding-progress/dashboard          — Dashboard overview with stats, alerts, and recent graduates
 * GET  /api/v1/admin/onboarding-progress/:enrollmentId/checkins — Check-in responses for an enrollment
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { prisma } from '../../models/index.js';
import { logError } from '../../services/admin/errorLogger.js';
import logger from '../../lib/logger.js';

export const onboardingProgressRouter = Router();

/** Default quiz pass threshold (percentage). */
const QUIZ_PASS_THRESHOLD = 70;

/** Number of consecutive delivered-but-not-completed modules that triggers a behind_schedule alert. */
const BEHIND_SCHEDULE_THRESHOLD = 2;

// ---------------------------------------------------------------------------
// GET /dashboard — Dashboard overview with stats, alerts, and recent graduates
// ---------------------------------------------------------------------------

onboardingProgressRouter.get('/dashboard', async (req: Request, res: Response) => {
  try {
    const teamId = req.query.teamId as string;
    if (!teamId) {
      return res.status(400).json({ error: 'missing_param', message: 'teamId is required' });
    }

    // Run parallel queries for dashboard data.
    const [
      statusCounts,
      activeEnrollments,
      graduatedEnrollments,
      recentGraduates,
      deliveredModules,
      completedModules,
      quizFailedProgress,
    ] = await Promise.all([
      // 1. Count enrollments grouped by status
      prisma.onboardingEnrollment.groupBy({
        by: ['status'],
        where: { slackTeamId: teamId },
        _count: { id: true },
      }),

      // 2. ACTIVE + SUPERVISED enrollments with plan and module progress
      prisma.onboardingEnrollment.findMany({
        where: {
          slackTeamId: teamId,
          status: { in: ['ACTIVE', 'SUPERVISED'] },
        },
        include: {
          plan: { select: { durationDays: true, name: true } },
          moduleProgress: {
            select: { moduleId: true, dayNumber: true, status: true },
            orderBy: { dayNumber: 'asc' },
          },
        },
      }),

      // 3. GRADUATED enrollments for average graduation days
      prisma.onboardingEnrollment.findMany({
        where: {
          slackTeamId: teamId,
          status: 'GRADUATED',
          graduatedAt: { not: null },
        },
        select: { startDate: true, graduatedAt: true },
      }),

      // 4. Recent graduates (last 5)
      prisma.onboardingEnrollment.findMany({
        where: {
          slackTeamId: teamId,
          status: 'GRADUATED',
        },
        include: { plan: { select: { name: true } } },
        orderBy: { graduatedAt: 'desc' },
        take: 5,
      }),

      // 5a. Delivered (not completed) module progress for struggle modules — ACTIVE/SUPERVISED only
      prisma.moduleProgress.findMany({
        where: {
          status: 'DELIVERED',
          enrollment: {
            slackTeamId: teamId,
            status: { in: ['ACTIVE', 'SUPERVISED'] },
          },
        },
        select: {
          moduleId: true,
          module: { select: { title: true, dayNumber: true } },
        },
      }),

      // 5b. Completed module progress for struggle module rate calculation
      prisma.moduleProgress.findMany({
        where: {
          status: 'COMPLETED',
          enrollment: {
            slackTeamId: teamId,
            status: { in: ['ACTIVE', 'SUPERVISED'] },
          },
        },
        select: { moduleId: true },
      }),

      // 6. Quiz failed: recent modules where quizScore < threshold
      prisma.moduleProgress.findMany({
        where: {
          quizScore: { not: null, lt: QUIZ_PASS_THRESHOLD },
          enrollment: {
            slackTeamId: teamId,
            status: { in: ['ACTIVE', 'SUPERVISED'] },
          },
        },
        include: {
          module: { select: { title: true, dayNumber: true } },
          enrollment: { select: { bdrName: true } },
        },
        orderBy: { updatedAt: 'desc' },
        take: 10,
      }),
    ]);

    // --- Compute status totals ---
    const countByStatus = (status: string): number => {
      const entry = statusCounts.find((s) => s.status === status);
      return entry?._count.id ?? 0;
    };

    const totalActive = countByStatus('ACTIVE');
    const totalSupervised = countByStatus('SUPERVISED');
    const totalPendingGraduation = countByStatus('PENDING_GRADUATION');
    const totalGraduated = countByStatus('GRADUATED');

    // --- Average progress percentage ---
    let averageProgressPercentage = 0;
    if (activeEnrollments.length > 0) {
      const progressValues = activeEnrollments.map((enrollment) => {
        const totalPlanModules = enrollment.plan.durationDays;
        const completedCount = enrollment.moduleProgress.filter(
          (mp) => mp.status === 'COMPLETED',
        ).length;
        return totalPlanModules > 0 ? (completedCount / totalPlanModules) * 100 : 0;
      });
      averageProgressPercentage = Math.round(
        progressValues.reduce((sum, v) => sum + v, 0) / progressValues.length,
      );
    }

    // --- Average graduation days ---
    let averageGraduationDays = 0;
    if (graduatedEnrollments.length > 0) {
      const daysValues = graduatedEnrollments.map((e) => {
        const start = new Date(e.startDate).getTime();
        const end = new Date(e.graduatedAt!).getTime();
        return Math.ceil((end - start) / (1000 * 60 * 60 * 24));
      });
      averageGraduationDays = Math.round(
        daysValues.reduce((sum, v) => sum + v, 0) / daysValues.length,
      );
    }

    // --- Common struggle modules ---
    // Build counts per moduleId: delivered (incomplete) vs completed
    const deliveredCountByModule = new Map<string, { count: number; title: string; dayNumber: number }>();
    for (const mp of deliveredModules) {
      const existing = deliveredCountByModule.get(mp.moduleId);
      if (existing) {
        existing.count += 1;
      } else {
        deliveredCountByModule.set(mp.moduleId, {
          count: 1,
          title: mp.module.title,
          dayNumber: mp.module.dayNumber,
        });
      }
    }

    const completedCountByModule = new Map<string, number>();
    for (const mp of completedModules) {
      completedCountByModule.set(mp.moduleId, (completedCountByModule.get(mp.moduleId) ?? 0) + 1);
    }

    const struggleModules = Array.from(deliveredCountByModule.entries())
      .map(([moduleId, data]) => {
        const delivered = data.count;
        const completed = completedCountByModule.get(moduleId) ?? 0;
        const total = delivered + completed;
        const incompleteRate = total > 0 ? delivered / total : 0;
        return {
          module_id: moduleId,
          module_title: data.title,
          day_number: data.dayNumber,
          incomplete_count: delivered,
          total_count: total,
          incomplete_rate: Math.round(incompleteRate * 100) / 100,
        };
      })
      .sort((a, b) => b.incomplete_rate - a.incomplete_rate)
      .slice(0, 5);

    // --- Alerts ---

    // behind_schedule: enrollments with 2+ consecutive delivered (not completed) modules at the tail end
    const behindSchedule: Array<{
      type: 'behind_schedule';
      enrollment_id: string;
      bdr_name: string;
      days_behind: number;
      current_module: string;
    }> = [];

    for (const enrollment of activeEnrollments) {
      const sortedProgress = enrollment.moduleProgress;
      // Count consecutive DELIVERED modules from the tail (highest dayNumber)
      let consecutiveDelivered = 0;
      let lastDeliveredTitle = '';
      for (let i = sortedProgress.length - 1; i >= 0; i--) {
        if (sortedProgress[i].status === 'DELIVERED') {
          consecutiveDelivered += 1;
          if (!lastDeliveredTitle) {
            lastDeliveredTitle = `Day ${sortedProgress[i].dayNumber}`;
          }
        } else {
          break;
        }
      }

      if (consecutiveDelivered >= BEHIND_SCHEDULE_THRESHOLD) {
        behindSchedule.push({
          type: 'behind_schedule' as const,
          enrollment_id: enrollment.id,
          bdr_name: enrollment.bdrName,
          days_behind: consecutiveDelivered,
          current_module: lastDeliveredTitle,
        });
      }
    }

    // overdue: currentDay exceeds plan duration + extended days
    const overdueAlerts = activeEnrollments
      .filter((e) => e.currentDay > e.plan.durationDays + e.extendedDays)
      .map((e) => ({
        type: 'overdue' as const,
        enrollment_id: e.id,
        bdr_name: e.bdrName,
        days_past_expected: e.currentDay - (e.plan.durationDays + e.extendedDays),
      }));

    // quiz_failed: already queried above
    const quizFailedAlerts = quizFailedProgress.map((mp) => ({
      type: 'quiz_failed' as const,
      enrollment_id: mp.enrollmentId,
      bdr_name: mp.enrollment.bdrName,
      quiz_topic: mp.module.title,
      score: mp.quizScore,
    }));

    // --- Recent graduates ---
    const recentGraduatesList = recentGraduates.map((e) => {
      const completionDays = e.graduatedAt
        ? Math.ceil(
            (new Date(e.graduatedAt).getTime() - new Date(e.startDate).getTime()) /
              (1000 * 60 * 60 * 24),
          )
        : null;

      return {
        enrollment_id: e.id,
        bdr_name: e.bdrName,
        plan_name: e.plan.name,
        graduated_at: e.graduatedAt,
        completion_days: completionDays,
      };
    });

    res.json({
      dashboard: {
        total_active_enrollments: totalActive,
        total_supervised: totalSupervised,
        total_pending_graduation: totalPendingGraduation,
        total_graduated_all_time: totalGraduated,
        average_progress_percentage: averageProgressPercentage,
        average_graduation_days: averageGraduationDays,
        common_struggle_modules: struggleModules,
        alerts: [...behindSchedule, ...overdueAlerts, ...quizFailedAlerts],
        recent_graduates: recentGraduatesList,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('Failed to load onboarding progress dashboard', { error: message });
    logError({
      category: 'SYSTEM_ERROR',
      service: 'admin:onboarding-progress',
      message: `Dashboard query failed: ${message}`,
      stackTrace: error instanceof Error ? error.stack : undefined,
    });
    res.status(500).json({ error: 'internal_error', message: 'An unexpected error occurred' });
  }
});

// ---------------------------------------------------------------------------
// GET /:enrollmentId/checkins — Check-in responses for an enrollment
// ---------------------------------------------------------------------------

onboardingProgressRouter.get('/:enrollmentId/checkins', async (req: Request, res: Response) => {
  try {
    const enrollmentId = req.params.enrollmentId as string;

    // Verify the enrollment exists.
    const enrollment = await prisma.onboardingEnrollment.findUnique({
      where: { id: enrollmentId },
      select: { id: true },
    });

    if (!enrollment) {
      return res.status(404).json({ error: 'not_found', message: 'Enrollment not found' });
    }

    // Load check-in responses for this enrollment with their automation details.
    const checkinResponses = await prisma.checkinResponse.findMany({
      where: { enrollmentId },
      orderBy: { dayNumber: 'asc' },
      include: {
        automation: {
          select: { type: true, content: true },
        },
      },
    });

    const checkins = checkinResponses.map((cr: typeof checkinResponses[number]) => ({
      id: cr.id,
      day_number: cr.dayNumber,
      automation_type: cr.automation.type,
      prompt: cr.automation.content,
      response: cr.response,
      responded_at: cr.respondedAt,
    }));

    res.json({ checkins });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('Failed to load check-in responses', {
      enrollmentId: req.params.enrollmentId,
      error: message,
    });
    logError({
      category: 'SYSTEM_ERROR',
      service: 'admin:onboarding-progress',
      message: `Checkins query failed: ${message}`,
      stackTrace: error instanceof Error ? error.stack : undefined,
    });
    res.status(500).json({ error: 'internal_error', message: 'An unexpected error occurred' });
  }
});
