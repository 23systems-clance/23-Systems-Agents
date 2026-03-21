/**
 * BDR (Business Development Rep) API router.
 *
 * Protected by BDR magic link authentication.
 * Provides endpoints for tasks, calls, unibox, and stats.
 */

import { Router } from 'express';
import { bdrAuth } from '../../lib/bdrAuth.js';
import { tasksRouter } from './tasks.js';
import { callsRouter } from './calls.js';
import { uniboxRouter } from './unibox.js';
import { statsRouter } from './stats.js';
import { onboardingBdrRouter } from './onboarding.js';
import { personalityRouter } from './personality.js';

const router = Router();

// All BDR routes require authentication
router.use(bdrAuth);

router.use('/tasks', tasksRouter);
router.use('/calls', callsRouter);
router.use('/unibox', uniboxRouter);
router.use('/stats', statsRouter);
router.use('/onboarding', onboardingBdrRouter);
router.use('/personality', personalityRouter);

export { router as bdrRouter };
