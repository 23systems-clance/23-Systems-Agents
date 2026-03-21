/**
 * LinkedIn step executor.
 *
 * Adds a lead to the linked HeyReach campaign. The step remains
 * at WAITING_WEBHOOK status until a HeyReach webhook confirms
 * the action was taken.
 */

import { StepExecutionStatus } from '@prisma/client';
import { prisma } from '../../../models/index.js';
import { addLeadsToCampaign } from '../../heyreach/heyreachClient.js';
import logger from '../../../lib/logger.js';


/**
 * Executes a LinkedIn step by adding the contact to HeyReach.
 *
 * @param executionId - The CampaignContactStepExecution ID
 * @param heyreachCampaignId - The HeyReach campaign to add the lead to
 * @param contact - Contact data with LinkedIn URL
 */
export async function executeLinkedinStep(
  executionId: string,
  heyreachCampaignId: string,
  contact: {
    linkedinUrl: string;
    firstName: string;
    lastName: string;
    companyName?: string | null;
  },
): Promise<void> {
  logger.info('Executing LinkedIn step', { executionId, heyreachCampaignId, linkedinUrl: contact.linkedinUrl });

  await addLeadsToCampaign(heyreachCampaignId, [
    {
      linkedInUrl: contact.linkedinUrl,
      firstName: contact.firstName,
      lastName: contact.lastName,
      companyName: contact.companyName ?? undefined,
    },
  ]);

  // Mark step as WAITING_WEBHOOK — HeyReach will fire webhook on action
  await prisma.campaignContactStepExecution.update({
    where: { id: executionId },
    data: {
      status: StepExecutionStatus.WAITING_WEBHOOK,
      firedAt: new Date(),
    },
  });

  logger.info('LinkedIn step fired, waiting for webhook', { executionId });
}
