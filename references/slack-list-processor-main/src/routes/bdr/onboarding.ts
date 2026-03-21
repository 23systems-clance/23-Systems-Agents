/**
 * BDR-facing onboarding routes.
 *
 * Allows authenticated BDRs to mark modules complete,
 * submit quiz answers, and submit practice tasks for review.
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { getBdrIdentity } from '../../lib/bdrAuth.js';
import {
  markModuleComplete,
  submitQuizAnswers,
  submitPracticeTask,
} from '../../services/onboarding/progressService.js';
import logger from '../../lib/logger.js';

const router = Router();

/**
 * POST /api/v1/bdr/onboarding/complete
 * Marks a module as complete for the authenticated BDR.
 *
 * Body: { enrollment_id: string, day_number: number }
 */
router.post('/complete', async (req: Request, res: Response) => {
  try {
    const identity = getBdrIdentity(req);
    if (!identity) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const { enrollment_id, day_number } = req.body as {
      enrollment_id?: string;
      day_number?: number;
    };

    if (!enrollment_id || day_number == null) {
      res
        .status(400)
        .json({ error: 'enrollment_id and day_number are required' });
      return;
    }

    const result = await markModuleComplete(enrollment_id, day_number);

    res.json({ success: true, progress: result });
  } catch (err) {
    const error = err as Error;
    logger.error('Failed to mark module complete', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/v1/bdr/onboarding/quiz
 * Submits quiz answers for scoring.
 *
 * Body: { enrollment_id: string, day_number: number, answers: Record<string, string> }
 *
 * The answers map is keyed by question index (string) with the answer value.
 * It is transformed to the QuizAnswer[] format expected by the service.
 */
router.post('/quiz', async (req: Request, res: Response) => {
  try {
    const identity = getBdrIdentity(req);
    if (!identity) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const { enrollment_id, day_number, answers } = req.body as {
      enrollment_id?: string;
      day_number?: number;
      answers?: Record<string, string>;
    };

    if (!enrollment_id || day_number == null || !answers) {
      res
        .status(400)
        .json({ error: 'enrollment_id, day_number, and answers are required' });
      return;
    }

    // Transform Record<string, string> to QuizAnswer[] format
    const quizAnswers = Object.entries(answers).map(([key, value]) => ({
      questionIndex: parseInt(key, 10),
      answer: value,
    }));

    const result = await submitQuizAnswers(
      enrollment_id,
      day_number,
      quizAnswers,
    );

    res.json({
      success: true,
      score: result.quizResult.score,
      passed: result.quizResult.passed,
    });
  } catch (err) {
    const error = err as Error;
    logger.error('Failed to submit quiz answers', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/v1/bdr/onboarding/practice-submit
 * Submits a practice task for manager review.
 *
 * Body: { enrollment_id: string, day_number: number, submission: string }
 */
router.post('/practice-submit', async (req: Request, res: Response) => {
  try {
    const identity = getBdrIdentity(req);
    if (!identity) {
      res.status(401).json({ error: 'Not authenticated' });
      return;
    }

    const { enrollment_id, day_number, submission } = req.body as {
      enrollment_id?: string;
      day_number?: number;
      submission?: string;
    };

    if (!enrollment_id || day_number == null || !submission) {
      res
        .status(400)
        .json({
          error: 'enrollment_id, day_number, and submission are required',
        });
      return;
    }

    await submitPracticeTask(enrollment_id, day_number, submission);

    res.json({ success: true });
  } catch (err) {
    const error = err as Error;
    logger.error('Failed to submit practice task', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

export { router as onboardingBdrRouter };
