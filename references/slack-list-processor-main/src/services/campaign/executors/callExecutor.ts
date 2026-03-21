/**
 * Phone call step executor.
 *
 * Phone steps are manual — no external API call is made.
 * The step is marked as PENDING and surfaces as a BDR task
 * in the web UI. The BDR manually marks the call as complete.
 */

import { StepExecutionStatus } from '@prisma/client';
import { prisma } from '../../../models/index.js';
import logger from '../../../lib/logger.js';


/**
 * Executes a phone call step by marking it as PENDING (BDR task).
 *
 * No external API call is made. The step will appear in the BDR's
 * call list in the web task UI.
 *
 * @param executionId - The CampaignContactStepExecution ID
 * @param contactId - The CampaignContact ID (for logging)
 */
export async function executeCallStep(
  executionId: string,
  contactId: string,
): Promise<void> {
  logger.info('Executing call step (pending BDR action)', { executionId, contactId });

  await prisma.campaignContactStepExecution.update({
    where: { id: executionId },
    data: {
      status: StepExecutionStatus.PENDING,
      firedAt: new Date(),
    },
  });

  logger.info('Call step surfaced as BDR task', { executionId, contactId });
}
