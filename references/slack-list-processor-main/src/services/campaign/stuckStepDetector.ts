/**
 * Stuck step detector for campaign contacts.
 *
 * Finds contacts that have been at WAITING_WEBHOOK status
 * for longer than the configured timeout period and flags
 * them for manual review.
 */

import { StepExecutionStatus } from '@prisma/client';
import { prisma } from '../../models/index.js';
import { config } from '../../config/index.js';
import logger from '../../lib/logger.js';


/**
 * Scans for contacts stuck at WAITING_WEBHOOK status and flags them.
 *
 * A step execution is considered "stuck" if its firedAt timestamp
 * is older than `bdrManager.stuckStepTimeoutHours` ago.
 *
 * Stuck steps are marked as FAILED with a descriptive result.
 *
 * @returns Number of stuck steps found and flagged
 */
export async function detectAndFlagStuckSteps(): Promise<number> {
  const timeoutMs = config.bdrManager.stuckStepTimeoutHours * 60 * 60 * 1000;
  const cutoff = new Date(Date.now() - timeoutMs);

  const stuckExecutions = await prisma.campaignContactStepExecution.findMany({
    where: {
      status: StepExecutionStatus.WAITING_WEBHOOK,
      firedAt: {
        lt: cutoff,
      },
    },
    include: {
      campaignContact: {
        select: {
          id: true,
          campaignId: true,
          firstName: true,
          lastName: true,
          email: true,
        },
      },
    },
  });

  if (stuckExecutions.length === 0) {
    logger.debug('No stuck step executions found');
    return 0;
  }

  logger.warn('Found stuck step executions', { count: stuckExecutions.length });

  for (const execution of stuckExecutions) {
    await prisma.campaignContactStepExecution.update({
      where: { id: execution.id },
      data: {
        status: StepExecutionStatus.FAILED,
        result: `Stuck: no webhook received within ${config.bdrManager.stuckStepTimeoutHours}h`,
        completedAt: new Date(),
      },
    });

    logger.warn('Flagged stuck step execution', {
      executionId: execution.id,
      contactId: execution.campaignContact.id,
      campaignId: execution.campaignContact.campaignId,
      stepIndex: execution.stepIndex,
      stepType: execution.stepType,
      firedAt: execution.firedAt,
    });
  }

  return stuckExecutions.length;
}
