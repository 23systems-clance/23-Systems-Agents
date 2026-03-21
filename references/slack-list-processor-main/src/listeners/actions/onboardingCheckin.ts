/**
 * Bolt action and view handlers for onboarding check-in responses.
 *
 * Handles:
 * - `onboarding_open_checkin` — Opens a modal with text input for the BDR
 *   to respond to a check-in prompt.
 * - `onboarding_checkin_submit` (view submission) — Saves the CheckinResponse
 *   to the database and updates the original message to confirm recording.
 */

import type { App } from '@slack/bolt';
import { prisma } from '../../models/index.js';
import logger from '../../lib/logger.js';

/**
 * Registers check-in action and view submission handlers on the Bolt app.
 *
 * @param app - The Slack Bolt application instance.
 */
export function registerOnboardingCheckinHandlers(app: App): void {
  // -----------------------------------------------------------------------
  // Action: open check-in response modal
  // -----------------------------------------------------------------------
  app.action('onboarding_open_checkin', async ({ action, ack, client, body }) => {
    await ack();

    if (!('value' in action) || !action.value) {
      logger.warn('onboarding_open_checkin: missing action value');
      return;
    }

    const { enrollmentId, automationId, dayNumber } = JSON.parse(action.value) as {
      enrollmentId: string;
      automationId: string;
      dayNumber: number;
    };

    const triggerId = (body as { trigger_id?: string }).trigger_id;
    if (!triggerId) {
      logger.warn('onboarding_open_checkin: no trigger_id in body');
      return;
    }

    await client.views.open({
      trigger_id: triggerId,
      view: {
        type: 'modal',
        callback_id: 'onboarding_checkin_submit',
        private_metadata: JSON.stringify({ enrollmentId, automationId, dayNumber }),
        title: { type: 'plain_text', text: 'Check-In Response' },
        submit: { type: 'plain_text', text: 'Submit' },
        close: { type: 'plain_text', text: 'Cancel' },
        blocks: [
          {
            type: 'input',
            block_id: 'checkin_response_block',
            element: {
              type: 'plain_text_input',
              action_id: 'checkin_response_input',
              multiline: true,
              placeholder: {
                type: 'plain_text',
                text: 'Share how things are going...',
              },
            },
            label: {
              type: 'plain_text',
              text: 'Your Response',
            },
          },
        ],
      },
    });

    logger.info('Opened check-in response modal', {
      enrollmentId,
      automationId,
      dayNumber,
    });
  });

  // -----------------------------------------------------------------------
  // View submission: save check-in response
  // -----------------------------------------------------------------------
  app.view('onboarding_checkin_submit', async ({ ack, view, body }) => {
    await ack();

    const { enrollmentId, automationId, dayNumber } = JSON.parse(
      view.private_metadata,
    ) as {
      enrollmentId: string;
      automationId: string;
      dayNumber: number;
    };

    const responseText =
      view.state.values.checkin_response_block?.checkin_response_input?.value ?? '';

    const slackUserId = body.user.id;

    // Save the check-in response to the database
    await prisma.checkinResponse.create({
      data: {
        enrollmentId,
        automationId,
        dayNumber,
        response: responseText,
        respondedAt: new Date(),
      },
    });

    logger.info('Check-in response recorded', {
      enrollmentId,
      automationId,
      dayNumber,
      slackUserId,
    });
  });
}
