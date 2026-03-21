/**
 * Credit preview action listeners (T024).
 *
 * Handles confirm/cancel/go-back actions from the credit cost
 * preview card shown before enrichment execution.
 */

import type { App } from '@slack/bolt';
import { cancelJob } from '../../services/enrichment/cancellation.js';
import logger from '../../lib/logger.js';

/**
 * Registers credit preview action handlers.
 *
 * @param app - Slack Bolt app instance.
 */
export function registerCreditPreviewHandlers(app: App): void {
  // Confirm enrichment — proceed with job creation
  app.action('enrichment_confirm', async ({ ack, body, respond }) => {
    await ack();

    const actionBody = body as unknown as Record<string, unknown>;
    const userId = (actionBody.user as Record<string, string>)?.id ?? '';
    const teamId = (actionBody.team as Record<string, string>)?.id ?? '';

    logger.info('Credit preview: enrichment confirmed', { userId, teamId });

    // The actual enrichment creation is handled by the existing enrichment flow
    // which will be called after this confirmation. The action value carries
    // the job parameters needed to proceed.
    if (respond) {
      await respond({
        text: 'Enrichment confirmed. Processing your file...',
        replace_original: false,
      });
    }
  });

  // Cancel enrichment — abort with zero credit deduction
  app.action('enrichment_cancel', async ({ ack, body, respond }) => {
    await ack();

    const actionBody = body as unknown as Record<string, unknown>;
    const userId = (actionBody.user as Record<string, string>)?.id ?? '';
    const teamId = (actionBody.team as Record<string, string>)?.id ?? '';

    logger.info('Credit preview: enrichment cancelled', { userId, teamId });

    if (respond) {
      await respond({
        text: 'Enrichment cancelled. No credits were deducted.',
        replace_original: true,
      });
    }
  });

  // Go back — return to type/purpose selection
  app.action('enrichment_go_back', async ({ ack, respond }) => {
    await ack();

    if (respond) {
      await respond({
        text: 'Going back to enrichment options...',
        replace_original: true,
      });
    }
  });

  // Cancel an in-progress job
  app.action('enrichment_cancel_job', async ({ ack, body, respond }) => {
    await ack();

    const actionBody = body as unknown as Record<string, unknown>;
    const teamId = (actionBody.team as Record<string, string>)?.id ?? '';
    const actions = (actionBody.actions as Array<Record<string, string>>) ?? [];
    const jobId = actions[0]?.value ?? '';

    if (!jobId) {
      if (respond) {
        await respond({ text: 'Unable to cancel: job ID not found.', replace_original: false });
      }
      return;
    }

    const result = await cancelJob(jobId, teamId);

    if (respond) {
      if (result.success) {
        const refundMsg = result.creditsRefunded > 0
          ? ` ${result.creditsRefunded} credits have been refunded.`
          : '';
        await respond({
          text: `Job cancelled. ${result.rowsCompleted}/${result.totalRows} rows were completed.${refundMsg}`,
          replace_original: false,
        });
      } else {
        await respond({
          text: `Unable to cancel: ${result.error}`,
          replace_original: false,
        });
      }
    }
  });
}
