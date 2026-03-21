/**
 * Bolt action and view handlers for onboarding graduation review (T049).
 *
 * Handles:
 * - `onboarding_graduation_approve` — Manager approves graduation; calls
 *   graduationService.approveGraduation and updates the original message.
 * - `onboarding_graduation_extend` — Opens a modal asking for additional
 *   days and reason, then calls graduationService.extendOnboarding (FR-028).
 * - `onboarding_graduation_extend_modal` (view submission) — Processes the
 *   extend modal and calls graduationService.extendOnboarding.
 * - `onboarding_graduation_reject` — Opens a modal asking for a reason,
 *   then calls graduationService.rejectGraduation (FR-028).
 * - `onboarding_graduation_reject_modal` (view submission) — Processes the
 *   reject modal and calls graduationService.rejectGraduation.
 */

import type { App } from '@slack/bolt';
import * as graduationService from '../../services/onboarding/graduationService.js';
import logger from '../../lib/logger.js';

/**
 * Registers graduation review action and view submission handlers on the
 * Bolt app. These handlers allow managers to approve, extend, or reject
 * a BDR's onboarding graduation directly from Slack messages.
 *
 * @param app - The Slack Bolt application instance.
 */
export function registerGraduationReviewHandlers(app: App): void {
  // -----------------------------------------------------------------------
  // Action: approve graduation
  // -----------------------------------------------------------------------
  app.action('onboarding_graduation_approve', async ({ action, ack, client, body }) => {
    await ack();

    try {
      if (!('value' in action) || !action.value) {
        logger.warn('onboarding_graduation_approve: missing action value');
        return;
      }

      const enrollmentId = action.value;

      await graduationService.approveGraduation(enrollmentId, client);

      const channelId = (body as { channel?: { id: string } }).channel?.id;
      const messageTs = (body as { message?: { ts: string } }).message?.ts;

      if (channelId && messageTs) {
        await client.chat.update({
          channel: channelId,
          ts: messageTs,
          text: 'Graduation approved',
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: '✅ *Graduation approved* — BDR has been promoted to active status.',
              },
            },
          ],
        });
      }

      logger.info('Graduation approved', { enrollmentId });
    } catch (err) {
      logger.error('onboarding_graduation_approve failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  // -----------------------------------------------------------------------
  // Action: open extend onboarding modal
  // -----------------------------------------------------------------------
  app.action('onboarding_graduation_extend', async ({ action, ack, client, body }) => {
    await ack();

    try {
      if (!('value' in action) || !action.value) {
        logger.warn('onboarding_graduation_extend: missing action value');
        return;
      }

      const enrollmentId = action.value;

      const triggerId = (body as { trigger_id?: string }).trigger_id;
      if (!triggerId) {
        logger.warn('onboarding_graduation_extend: no trigger_id in body');
        return;
      }

      const channelId = (body as { channel?: { id: string } }).channel?.id;
      const messageTs = (body as { message?: { ts: string } }).message?.ts;

      await client.views.open({
        trigger_id: triggerId,
        view: {
          type: 'modal',
          callback_id: 'onboarding_graduation_extend_modal',
          private_metadata: JSON.stringify({
            enrollmentId,
            channel: channelId,
            message_ts: messageTs,
          }),
          title: { type: 'plain_text', text: 'Extend Onboarding' },
          submit: { type: 'plain_text', text: 'Extend' },
          close: { type: 'plain_text', text: 'Cancel' },
          blocks: [
            {
              type: 'input',
              block_id: 'additional_days_block',
              element: {
                type: 'number_input',
                action_id: 'additional_days_input',
                is_decimal_allowed: false,
                min_value: '1',
                max_value: '20',
                placeholder: {
                  type: 'plain_text',
                  text: 'Number of additional days',
                },
              },
              label: {
                type: 'plain_text',
                text: 'Additional Days',
              },
            },
            {
              type: 'input',
              block_id: 'extend_reason_block',
              element: {
                type: 'plain_text_input',
                action_id: 'extend_reason_input',
                multiline: true,
                placeholder: {
                  type: 'plain_text',
                  text: 'Reason for extending onboarding...',
                },
              },
              label: {
                type: 'plain_text',
                text: 'Reason',
              },
            },
          ],
        },
      });

      logger.info('Opened graduation extend modal', { enrollmentId });
    } catch (err) {
      logger.error('onboarding_graduation_extend failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  // -----------------------------------------------------------------------
  // View submission: extend onboarding
  // -----------------------------------------------------------------------
  app.view('onboarding_graduation_extend_modal', async ({ ack, view, client }) => {
    await ack();

    try {
      const { enrollmentId, channel, message_ts } = JSON.parse(
        view.private_metadata,
      ) as {
        enrollmentId: string;
        channel: string | undefined;
        message_ts: string | undefined;
      };

      const additionalDaysRaw =
        view.state.values.additional_days_block?.additional_days_input?.value;
      const additionalDays = parseInt(additionalDaysRaw ?? '0', 10);

      const reason =
        view.state.values.extend_reason_block?.extend_reason_input?.value ?? '';

      await graduationService.extendOnboarding(enrollmentId, additionalDays, reason, client);

      if (channel && message_ts) {
        await client.chat.update({
          channel,
          ts: message_ts,
          text: `Onboarding extended by ${additionalDays} days`,
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `⏳ *Onboarding extended by ${additionalDays} days*\n\n_Reason:_ ${reason}`,
              },
            },
          ],
        });
      }

      logger.info('Onboarding extended', { enrollmentId, additionalDays, reason });
    } catch (err) {
      logger.error('onboarding_graduation_extend_modal submission failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  // -----------------------------------------------------------------------
  // Action: open reject graduation modal
  // -----------------------------------------------------------------------
  app.action('onboarding_graduation_reject', async ({ action, ack, client, body }) => {
    await ack();

    try {
      if (!('value' in action) || !action.value) {
        logger.warn('onboarding_graduation_reject: missing action value');
        return;
      }

      const enrollmentId = action.value;

      const triggerId = (body as { trigger_id?: string }).trigger_id;
      if (!triggerId) {
        logger.warn('onboarding_graduation_reject: no trigger_id in body');
        return;
      }

      const channelId = (body as { channel?: { id: string } }).channel?.id;
      const messageTs = (body as { message?: { ts: string } }).message?.ts;

      await client.views.open({
        trigger_id: triggerId,
        view: {
          type: 'modal',
          callback_id: 'onboarding_graduation_reject_modal',
          private_metadata: JSON.stringify({
            enrollmentId,
            channel: channelId,
            message_ts: messageTs,
          }),
          title: { type: 'plain_text', text: 'Reject Graduation' },
          submit: { type: 'plain_text', text: 'Reject' },
          close: { type: 'plain_text', text: 'Cancel' },
          blocks: [
            {
              type: 'input',
              block_id: 'reject_reason_block',
              element: {
                type: 'plain_text_input',
                action_id: 'reject_reason_input',
                multiline: true,
                placeholder: {
                  type: 'plain_text',
                  text: 'Reason for rejecting graduation...',
                },
              },
              label: {
                type: 'plain_text',
                text: 'Reason',
              },
            },
          ],
        },
      });

      logger.info('Opened graduation reject modal', { enrollmentId });
    } catch (err) {
      logger.error('onboarding_graduation_reject failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  // -----------------------------------------------------------------------
  // View submission: reject graduation
  // -----------------------------------------------------------------------
  app.view('onboarding_graduation_reject_modal', async ({ ack, view, client }) => {
    await ack();

    try {
      const { enrollmentId, channel, message_ts } = JSON.parse(
        view.private_metadata,
      ) as {
        enrollmentId: string;
        channel: string | undefined;
        message_ts: string | undefined;
      };

      const reason =
        view.state.values.reject_reason_block?.reject_reason_input?.value ?? '';

      await graduationService.rejectGraduation(enrollmentId, reason, client);

      if (channel && message_ts) {
        await client.chat.update({
          channel,
          ts: message_ts,
          text: 'Graduation rejected — BDR returned to active training',
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `❌ *Graduation rejected* — BDR returned to active training.\n\n_Reason:_ ${reason}`,
              },
            },
          ],
        });
      }

      logger.info('Graduation rejected', { enrollmentId, reason });
    } catch (err) {
      logger.error('onboarding_graduation_reject_modal submission failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });
}
