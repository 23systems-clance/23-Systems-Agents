/**
 * Send Copy To action listener (T034).
 *
 * Handles the "Send Copy To" button on enrichment result messages.
 * Opens a modal with Email/Slack Channel choice, collects delivery
 * info, and triggers the appropriate sender service.
 */

import type { App } from '@slack/bolt';
import { sendResultByEmail } from '../../services/sendCopyTo/emailSender.js';
import { sendResultToChannel } from '../../services/sendCopyTo/slackChannelSender.js';
import logger from '../../lib/logger.js';

/**
 * Registers Send Copy To action handlers.
 *
 * @param app - Slack Bolt app instance.
 */
export function registerSendCopyToHandlers(app: App): void {
  // Open Send Copy To modal
  app.action('send_copy_to_open', async ({ ack, body, client }) => {
    await ack();

    const actionBody = body as unknown as Record<string, unknown>;
    const triggerId = (actionBody as Record<string, string>).trigger_id;
    const actions = (actionBody.actions as Array<Record<string, string>>) ?? [];
    const jobId = actions[0]?.value ?? '';

    await client.views.open({
      trigger_id: triggerId,
      view: {
        type: 'modal',
        callback_id: 'send_copy_to_submit',
        private_metadata: JSON.stringify({ jobId }),
        title: { type: 'plain_text', text: 'Send Copy To' },
        submit: { type: 'plain_text', text: 'Send' },
        close: { type: 'plain_text', text: 'Cancel' },
        blocks: [
          {
            type: 'input',
            block_id: 'delivery_method_block',
            element: {
              type: 'static_select',
              action_id: 'delivery_method',
              placeholder: { type: 'plain_text', text: 'Choose delivery method' },
              options: [
                { text: { type: 'plain_text', text: 'Email' }, value: 'email' },
                { text: { type: 'plain_text', text: 'Slack Channel' }, value: 'slack_channel' },
              ],
            },
            label: { type: 'plain_text', text: 'Delivery Method' },
          },
          {
            type: 'input',
            block_id: 'recipient_block',
            element: {
              type: 'plain_text_input',
              action_id: 'recipient_input',
              placeholder: { type: 'plain_text', text: 'email@example.com or #channel-name' },
            },
            label: { type: 'plain_text', text: 'Recipient' },
            hint: { type: 'plain_text', text: 'For email: enter email address(es) separated by commas. For Slack: enter channel ID.' },
          },
        ],
      },
    });
  });

  // Handle modal submission
  app.view('send_copy_to_submit', async ({ ack, view, body, client }) => {
    await ack();

    const { jobId } = JSON.parse(view.private_metadata || '{}');
    const teamId = view.team_id;
    const userId = body.user.id;
    const method = view.state.values.delivery_method_block.delivery_method.selected_option?.value;
    const recipient = view.state.values.recipient_block.recipient_input.value ?? '';

    if (!jobId || !method || !recipient) {
      logger.warn('Send Copy To: missing required fields', { jobId, method, recipient });
      return;
    }

    try {
      if (method === 'email') {
        const emails = recipient.split(',').map((e: string) => e.trim()).filter(Boolean);
        const success = await sendResultByEmail(jobId, emails, teamId);

        await client.chat.postMessage({
          channel: userId,
          text: success
            ? `Results sent to ${emails.join(', ')}`
            : 'Failed to send results via email. Please try again.',
        });
      } else if (method === 'slack_channel') {
        const channelId = recipient.replace(/^#/, '').trim();
        const success = await sendResultToChannel(jobId, channelId, teamId, client);

        await client.chat.postMessage({
          channel: userId,
          text: success
            ? `Results sent to <#${channelId}>`
            : 'Failed to send results to the channel. Make sure the bot is a member.',
        });
      }
    } catch (error) {
      logger.error('Send Copy To failed', {
        jobId,
        method,
        error: error instanceof Error ? error.message : String(error),
      });

      await client.chat.postMessage({
        channel: userId,
        text: 'An error occurred while sending the results. Please try again.',
      });
    }
  });
}
