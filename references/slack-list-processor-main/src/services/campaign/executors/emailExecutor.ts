/**
 * Email step executor.
 *
 * Adds a lead to the linked Instantly campaign. The step remains
 * at WAITING_WEBHOOK status until an Instantly webhook confirms
 * the email was sent.
 */

import { StepExecutionStatus } from '@prisma/client';
import { prisma } from '../../../models/index.js';
import { addLeadsToCampaign } from '../../instantly/instantlyClient.js';
import logger from '../../../lib/logger.js';


/**
 * Executes an email step by adding the contact as a lead to Instantly.
 *
 * @param executionId - The CampaignContactStepExecution ID
 * @param instantlyCampaignId - The Instantly campaign to add the lead to
 * @param contact - Contact data for the lead
 */
export async function executeEmailStep(
  executionId: string,
  instantlyCampaignId: string,
  contact: {
    email: string;
    firstName: string;
    lastName: string;
    companyName?: string | null;
  },
): Promise<void> {
  logger.info('Executing email step', { executionId, instantlyCampaignId, email: contact.email });

  await addLeadsToCampaign(instantlyCampaignId, [
    {
      email: contact.email,
      first_name: contact.firstName,
      last_name: contact.lastName,
      company_name: contact.companyName ?? undefined,
    },
  ]);

  // Mark step as WAITING_WEBHOOK — Instantly will fire email_sent webhook
  await prisma.campaignContactStepExecution.update({
    where: { id: executionId },
    data: {
      status: StepExecutionStatus.WAITING_WEBHOOK,
      firedAt: new Date(),
    },
  });

  logger.info('Email step fired, waiting for webhook', { executionId });
}
