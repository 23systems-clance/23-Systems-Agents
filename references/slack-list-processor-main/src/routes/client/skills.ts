/**
 * Client skill invocation route (Feature 39 - Vertical Pack Platform).
 *
 * POST /api/v1/client/skills/:skillId/invoke
 * Validates workspace pack subscription, runs spend limit check,
 * enqueues skill execution, returns 202 with executionId.
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { prisma } from '../../models/index.js';
import { skillExecutionQueue } from '../../services/queue/queues.js';
import { checkDailySpendLimit } from '../../services/platform/spendLimiter.js';
import { invokeSkillSchema, validateBody } from '../../lib/platformValidation.js';
import logger from '../../lib/logger.js';

export const clientSkillRouter = Router();

/**
 * POST /api/v1/client/skills/:skillId/invoke
 * Invoke a skill asynchronously. Returns 202 with executionId.
 */
clientSkillRouter.post('/:skillId/invoke', async (req: Request, res: Response) => {
  const slackTeamId = (req as any).slackTeamId;
  const slackUserId = (req as any).slackUserId;

  if (!slackTeamId) {
    res.status(401).json({ error: 'Workspace not authenticated' });
    return;
  }

  const data = validateBody(invokeSkillSchema, req.body, res);
  if (!data) return;

  try {
    // Load skill
    const skill = await prisma.skill.findUnique({
      where: { id: req.params.skillId as string },
    });

    if (!skill || skill.status !== 'PUBLISHED') {
      res.status(404).json({ error: 'Skill not found or not published' });
      return;
    }

    // Check workspace has a pack subscription containing this skill
    const subscription = await prisma.packSubscription.findFirst({
      where: {
        slackTeamId,
        status: 'ACTIVE',
        pack: {
          packSkills: {
            some: { skillId: skill.id },
          },
        },
      },
      include: { pack: true },
    });

    if (!subscription) {
      res.status(403).json({ error: 'No active pack subscription includes this skill' });
      return;
    }

    // Check spend limit (FR-025)
    const estimatedCost = Number(skill.creditCost);
    const spendCheck = await checkDailySpendLimit(slackTeamId, estimatedCost);
    if (!spendCheck.allowed) {
      res.status(429).json({ error: spendCheck.reason ?? 'Daily spend limit reached' });
      return;
    }

    // Create execution record
    const execution = await prisma.skillExecution.create({
      data: {
        skillId: skill.id,
        slackTeamId,
        slackUserId,
        triggerType: 'API_CALL',
        triggerSource: 'client-invoke',
        packSubscriptionId: subscription.id,
        input: data.input as any,
        status: 'QUEUED',
      },
    });

    // Enqueue job
    await skillExecutionQueue.add('skill-execution', {
      executionId: execution.id,
      skillId: skill.id,
      slackTeamId,
      slackUserId,
      input: data.input,
      packSubscriptionId: subscription.id,
    });

    res.status(202).json({
      executionId: execution.id,
      status: 'QUEUED',
    });
  } catch (error) {
    logger.error('Skill invocation failed', {
      skillId: req.params.skillId as string,
      slackTeamId,
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ error: error instanceof Error ? error.message : 'Skill invocation failed' });
  }
});
