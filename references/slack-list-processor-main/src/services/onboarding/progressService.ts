/**
 * Onboarding progress tracking service (Feature 7).
 *
 * Manages module completion, quiz scoring, practice task review,
 * and overall progress calculations for BDR onboarding enrollments.
 */

import { OnboardingModuleStatus } from '@prisma/client';
import { prisma } from '../../models/index.js';
import logger from '../../lib/logger.js';
import { logAudit } from '../../lib/auditLogger.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single quiz answer submitted by the BDR. */
interface QuizAnswer {
  questionIndex: number;
  answer: string;
}

/** Per-question feedback indicating correctness. */
interface QuizFeedback {
  questionIndex: number;
  correct: boolean;
  submittedAnswer: string;
  correctAnswer: string;
}

/** Result returned after quiz scoring. */
interface QuizResult {
  score: number;
  passed: boolean;
  passingThreshold: number;
  feedback: QuizFeedback[];
}

/** Overall progress summary across all modules. */
interface OverallProgress {
  completed: number;
  total: number;
  percentage: number;
}

// ---------------------------------------------------------------------------
// markModuleComplete
// ---------------------------------------------------------------------------

/**
 * Marks a specific module as COMPLETED and recalculates overall progress.
 *
 * Updates the ModuleProgress record for the given enrollment and day to
 * COMPLETED status with the current timestamp. Then counts all modules
 * for the enrollment to compute overall percentage.
 *
 * @param enrollmentId - The onboarding enrollment ID.
 * @param dayNumber - The day/module number to mark complete.
 * @returns The updated module progress, overall progress stats, and
 *          an `allComplete` flag when every module is finished.
 */
export async function markModuleComplete(
  enrollmentId: string,
  dayNumber: number,
): Promise<{
  moduleProgress: Awaited<ReturnType<typeof prisma.moduleProgress.update>>;
  overallProgress: OverallProgress;
  allComplete?: boolean;
}> {
  const moduleProgress = await prisma.moduleProgress.update({
    where: { enrollmentId_dayNumber: { enrollmentId, dayNumber } },
    data: {
      status: OnboardingModuleStatus.COMPLETED,
      completedAt: new Date(),
    },
  });

  const allModules = await prisma.moduleProgress.findMany({
    where: { enrollmentId },
    select: { status: true },
  });

  const total = allModules.length;
  const completed = allModules.filter(
    (m) => m.status === OnboardingModuleStatus.COMPLETED,
  ).length;
  const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;

  const overallProgress: OverallProgress = { completed, total, percentage };
  const allComplete = completed === total;

  logger.info('Module marked complete', {
    enrollmentId,
    dayNumber,
    completed,
    total,
    percentage,
    allComplete,
  });
  logAudit({ action: 'onboarding_module_completed', actorUserId: 'bdr', targetType: 'module_progress', targetId: enrollmentId, metadata: { dayNumber } });

  return {
    moduleProgress,
    overallProgress,
    ...(allComplete ? { allComplete: true } : {}),
  };
}

// ---------------------------------------------------------------------------
// submitQuizAnswers
// ---------------------------------------------------------------------------

/**
 * Scores quiz answers against the correct answers stored in training item metadata.
 *
 * Loads the ModuleProgress and its module's training items, finds the QUIZ item,
 * and scores each answer against `metadata.questions[].correctAnswer`. If the
 * score meets or exceeds the passing threshold (default 70%), the module is
 * marked COMPLETED. Returns per-question feedback and an `alertManager` flag
 * when the score falls below threshold (FR-032).
 *
 * @param enrollmentId - The onboarding enrollment ID.
 * @param dayNumber - The day/module number containing the quiz.
 * @param answers - Array of quiz answers submitted by the BDR.
 * @returns Quiz result with score, feedback, module status, and optional manager alert.
 */
export async function submitQuizAnswers(
  enrollmentId: string,
  dayNumber: number,
  answers: QuizAnswer[],
): Promise<{
  quizResult: QuizResult;
  moduleStatus: OnboardingModuleStatus;
  alertManager?: { alertManager: true; quizTopic: string; score: number };
}> {
  const DEFAULT_PASSING_THRESHOLD = 70;

  // Load the module progress with its module and training items
  const progress = await prisma.moduleProgress.findUniqueOrThrow({
    where: { enrollmentId_dayNumber: { enrollmentId, dayNumber } },
    include: {
      module: {
        include: {
          trainingItems: {
            where: { type: 'QUIZ' },
            take: 1,
          },
        },
      },
    },
  });

  const quizItem = progress.module.trainingItems[0];
  if (!quizItem) {
    throw new Error(
      `No QUIZ training item found for enrollment ${enrollmentId}, day ${dayNumber}`,
    );
  }

  // Extract questions from metadata
  const metadata = quizItem.metadata as {
    questions?: Array<{ correctAnswer: string }>;
    passingThreshold?: number;
  } | null;

  const questions = metadata?.questions ?? [];
  if (questions.length === 0) {
    throw new Error(
      `Quiz metadata has no questions for training item ${quizItem.id}`,
    );
  }

  const passingThreshold =
    metadata?.passingThreshold ?? DEFAULT_PASSING_THRESHOLD;

  // Score each answer
  const feedback: QuizFeedback[] = answers.map((a) => {
    const question = questions[a.questionIndex];
    const correctAnswer = question?.correctAnswer ?? '';
    return {
      questionIndex: a.questionIndex,
      correct:
        a.answer.trim().toLowerCase() === correctAnswer.trim().toLowerCase(),
      submittedAnswer: a.answer,
      correctAnswer,
    };
  });

  const correctCount = feedback.filter((f) => f.correct).length;
  const score =
    questions.length > 0
      ? Math.round((correctCount / questions.length) * 100)
      : 0;
  const passed = score >= passingThreshold;

  // Determine new module status
  const newStatus = passed
    ? OnboardingModuleStatus.COMPLETED
    : OnboardingModuleStatus.IN_PROGRESS;

  // Update module progress with quiz data
  const updateData: Record<string, unknown> = {
    quizResponses: answers,
    quizScore: score,
    status: newStatus,
  };
  if (passed) {
    updateData.completedAt = new Date();
  }

  await prisma.moduleProgress.update({
    where: { enrollmentId_dayNumber: { enrollmentId, dayNumber } },
    data: updateData,
  });

  const quizResult: QuizResult = {
    score,
    passed,
    passingThreshold,
    feedback,
  };

  logger.info('Quiz submitted', {
    enrollmentId,
    dayNumber,
    score,
    passed,
    passingThreshold,
    quizTopic: progress.module.title,
  });
  logAudit({ action: 'onboarding_quiz_submitted', actorUserId: 'bdr', targetType: 'module_progress', targetId: enrollmentId, metadata: { dayNumber, score, passed, quizTopic: progress.module.title } });

  const result: {
    quizResult: QuizResult;
    moduleStatus: OnboardingModuleStatus;
    alertManager?: { alertManager: true; quizTopic: string; score: number };
  } = {
    quizResult,
    moduleStatus: newStatus,
  };

  // Flag for manager alert when score is below threshold (FR-032)
  if (!passed) {
    result.alertManager = {
      alertManager: true,
      quizTopic: progress.module.title,
      score,
    };
  }

  return result;
}

// ---------------------------------------------------------------------------
// submitPracticeTask
// ---------------------------------------------------------------------------

/**
 * Records a BDR's practice task submission and sets it for manager review.
 *
 * Updates the ModuleProgress with the submission text, sets review status
 * to PENDING_REVIEW, and keeps the module in IN_PROGRESS status until
 * the manager approves or rejects.
 *
 * @param enrollmentId - The onboarding enrollment ID.
 * @param dayNumber - The day/module number for the practice task.
 * @param submission - The BDR's practice task submission text.
 * @returns The updated module progress record.
 */
export async function submitPracticeTask(
  enrollmentId: string,
  dayNumber: number,
  submission: string,
): Promise<Awaited<ReturnType<typeof prisma.moduleProgress.update>>> {
  const moduleProgress = await prisma.moduleProgress.update({
    where: { enrollmentId_dayNumber: { enrollmentId, dayNumber } },
    data: {
      practiceSubmission: submission,
      managerReviewStatus: 'PENDING_REVIEW',
      status: OnboardingModuleStatus.IN_PROGRESS,
    },
  });

  logger.info('Practice task submitted', { enrollmentId, dayNumber });

  return moduleProgress;
}

// ---------------------------------------------------------------------------
// approvePracticeTask
// ---------------------------------------------------------------------------

/**
 * Approves a BDR's practice task submission and marks the module complete.
 *
 * Sets the manager review status to APPROVED, records the review timestamp,
 * and transitions the module to COMPLETED. Returns updated progress with
 * overall percentage.
 *
 * @param enrollmentId - The onboarding enrollment ID.
 * @param dayNumber - The day/module number to approve.
 * @returns The updated module progress and overall progress percentage.
 */
export async function approvePracticeTask(
  enrollmentId: string,
  dayNumber: number,
): Promise<{
  moduleProgress: Awaited<ReturnType<typeof prisma.moduleProgress.update>>;
  overallProgress: OverallProgress;
}> {
  const moduleProgress = await prisma.moduleProgress.update({
    where: { enrollmentId_dayNumber: { enrollmentId, dayNumber } },
    data: {
      managerReviewStatus: 'APPROVED',
      managerReviewedAt: new Date(),
      status: OnboardingModuleStatus.COMPLETED,
      completedAt: new Date(),
    },
  });

  const allModules = await prisma.moduleProgress.findMany({
    where: { enrollmentId },
    select: { status: true },
  });

  const total = allModules.length;
  const completed = allModules.filter(
    (m) => m.status === OnboardingModuleStatus.COMPLETED,
  ).length;
  const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;

  logger.info('Practice task approved', {
    enrollmentId,
    dayNumber,
    completed,
    total,
    percentage,
  });
  logAudit({ action: 'onboarding_practice_reviewed', actorUserId: 'manager', targetType: 'module_progress', targetId: enrollmentId, metadata: { dayNumber, result: 'approved' } });

  return {
    moduleProgress,
    overallProgress: { completed, total, percentage },
  };
}

// ---------------------------------------------------------------------------
// rejectPracticeTask
// ---------------------------------------------------------------------------

/**
 * Rejects a BDR's practice task submission while keeping the module in progress.
 *
 * Sets the manager review status to REJECTED and records the review timestamp.
 * The module stays IN_PROGRESS so the BDR can resubmit.
 *
 * @param enrollmentId - The onboarding enrollment ID.
 * @param dayNumber - The day/module number to reject.
 * @returns The updated module progress record.
 */
export async function rejectPracticeTask(
  enrollmentId: string,
  dayNumber: number,
): Promise<Awaited<ReturnType<typeof prisma.moduleProgress.update>>> {
  const moduleProgress = await prisma.moduleProgress.update({
    where: { enrollmentId_dayNumber: { enrollmentId, dayNumber } },
    data: {
      managerReviewStatus: 'REJECTED',
      managerReviewedAt: new Date(),
    },
  });

  logger.info('Practice task rejected', { enrollmentId, dayNumber });
  logAudit({ action: 'onboarding_practice_reviewed', actorUserId: 'manager', targetType: 'module_progress', targetId: enrollmentId, metadata: { dayNumber, result: 'rejected' } });

  return moduleProgress;
}

// ---------------------------------------------------------------------------
// getProgressSummary
// ---------------------------------------------------------------------------

/**
 * Calculates the overall progress summary for an enrollment.
 *
 * Counts completed modules vs total modules and returns a percentage.
 *
 * @param enrollmentId - The onboarding enrollment ID.
 * @returns Progress summary with completed count, total count, and percentage.
 */
export async function getProgressSummary(
  enrollmentId: string,
): Promise<OverallProgress> {
  const allModules = await prisma.moduleProgress.findMany({
    where: { enrollmentId },
    select: { status: true },
  });

  const total = allModules.length;
  const completed = allModules.filter(
    (m) => m.status === OnboardingModuleStatus.COMPLETED,
  ).length;
  const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;

  return { completed, total, percentage };
}

// ---------------------------------------------------------------------------
// checkConsecutiveIncomplete
// ---------------------------------------------------------------------------

/**
 * Checks whether the BDR has fallen behind on consecutive modules.
 *
 * Looks at the most recent N delivered modules (by dayNumber descending,
 * with status DELIVERED). If the count meets or exceeds the threshold,
 * returns a `behind: true` flag with the count and current module title.
 *
 * @param enrollmentId - The onboarding enrollment ID.
 * @param threshold - Number of consecutive incomplete modules to trigger alert (default 2).
 * @returns Whether the BDR is behind and details about the incomplete modules.
 */
export async function checkConsecutiveIncomplete(
  enrollmentId: string,
  threshold: number = 2,
): Promise<
  | { behind: true; consecutiveIncomplete: number; currentModule: string }
  | { behind: false }
> {
  // Get the most recent modules that were delivered but not completed,
  // ordered by dayNumber descending to check consecutive trailing incomplete
  const deliveredModules = await prisma.moduleProgress.findMany({
    where: {
      enrollmentId,
      status: OnboardingModuleStatus.DELIVERED,
    },
    orderBy: { dayNumber: 'desc' },
    take: threshold,
    include: {
      module: { select: { title: true } },
    },
  });

  if (deliveredModules.length >= threshold) {
    logger.warn('BDR falling behind on onboarding', {
      enrollmentId,
      consecutiveIncomplete: deliveredModules.length,
      currentModule: deliveredModules[0].module.title,
    });

    return {
      behind: true,
      consecutiveIncomplete: deliveredModules.length,
      currentModule: deliveredModules[0].module.title,
    };
  }

  return { behind: false };
}
