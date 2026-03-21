/**
 * Action executor: Assign contacts to an Instantly campaign.
 *
 * Reads contacts from the execution context, formats them for the
 * Instantly API, and queues a campaign import job.
 */

import { campaignQueue } from '../../../queue/queues.js';
import logger from '../../../../lib/logger.js';

/**
 * Assigns contacts from the workflow context to an Instantly campaign.
 *
 * @param params - Action parameters including campaignId and sourceVariable.
 * @param context - Workflow execution context.
 */
export async function executeAssignToCampaign(
  params: Record<string, unknown>,
  context: Record<string, unknown>,
): Promise<void> {
  const campaignId = String(params.campaignId || '');
  const sourceVariable = String(params.sourceVariable || 'contacts');

  if (!campaignId) {
    throw new Error('assignToCampaign: campaignId is required');
  }

  const contacts = context[sourceVariable];
  if (!Array.isArray(contacts) || contacts.length === 0) {
    logger.warn('assignToCampaign: no contacts found in context variable', { sourceVariable });
    context._assignToCampaignResult = { campaignId, contactCount: 0, status: 'skipped' };
    return;
  }

  await campaignQueue.add('campaign-import', { campaignId });

  context._assignToCampaignResult = {
    campaignId,
    contactCount: contacts.length,
    status: 'queued',
  };

  logger.info('Contacts assigned to campaign', {
    campaignId,
    contactCount: contacts.length,
  });
}
