/**
 * Bolt action handler for cloud provider selection buttons (T054).
 *
 * When the AI orchestrator classifies intent as a co-sell flow, the bot
 * posts cloud provider selection buttons. This handler responds to those
 * button clicks by acknowledging, updating the message, storing the
 * selected provider in the conversation state, and prompting for the
 * list owner.
 */

import type { App } from '@slack/bolt';
import type { KnownBlock } from '@slack/types';
import { updateConversation } from '../../services/state/conversationStore.js';
import logger from '../../lib/logger.js';

/** Maps action_id values to canonical cloud provider names. */
const PROVIDER_MAP: Record<string, string> = {
  select_cloud_provider_aws: 'AWS',
  select_cloud_provider_azure: 'Azure',
  select_cloud_provider_gcp: 'GCP',
  select_cloud_provider_other: 'Other',
};

/**
 * Builds the Block Kit message for cloud provider selection.
 *
 * Call this when posting the cloud provider prompt to the user during
 * a co-sell enrichment flow.
 *
 * @returns Block Kit blocks array for the cloud provider selection message.
 */
export function buildCloudProviderBlocks(): KnownBlock[] {
  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: 'Which cloud provider?',
      },
    },
    {
      type: 'actions',
      block_id: 'cloud_provider_selection',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: 'AWS' },
          action_id: 'select_cloud_provider_aws',
          value: 'AWS',
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Azure' },
          action_id: 'select_cloud_provider_azure',
          value: 'Azure',
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: 'GCP' },
          action_id: 'select_cloud_provider_gcp',
          value: 'GCP',
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Other' },
          action_id: 'select_cloud_provider_other',
          value: 'Other',
        },
      ],
    },
  ];
}

/**
 * Registers action handlers for all cloud provider selection buttons.
 *
 * Listens for action_id matching 'select_cloud_provider_*' buttons from the
 * cloud provider selection Block Kit message.
 *
 * On click:
 * 1. Acknowledge the action (required within 3 seconds).
 * 2. Update the original message to show the selection.
 * 3. Store the provider in conversation state (Redis).
 * 4. Post list owner question in thread.
 *
 * @param app - The Slack Bolt application instance.
 */
export function registerCloudProviderHandlers(app: App): void {
  for (const actionId of Object.keys(PROVIDER_MAP)) {
    app.action(actionId, async ({ ack, body, client }) => {
      // 1. Acknowledge immediately
      await ack();

      const action = body as {
        type: string;
        channel?: { id: string };
        message?: { ts: string; thread_ts?: string };
        user?: { id: string };
        actions?: Array<{ action_id: string; value: string }>;
      };

      const channelId = action.channel?.id;
      const messageTs = action.message?.ts;
      const threadTs = action.message?.thread_ts ?? messageTs;
      const userId = action.user?.id;
      const provider = PROVIDER_MAP[actionId];

      if (!channelId || !threadTs || !provider) {
        logger.warn('Cloud provider selection: missing context', {
          actionId,
          channelId,
          threadTs,
        });
        return;
      }

      logger.info('Cloud provider selected', {
        channelId,
        threadTs,
        userId,
        provider,
      });

      // 2. Update the original message to show the selection
      if (messageTs) {
        try {
          await client.chat.update({
            channel: channelId,
            ts: messageTs,
            text: `Cloud Provider: *${provider}*`,
            blocks: [
              {
                type: 'section',
                text: {
                  type: 'mrkdwn',
                  text: `Cloud Provider: *${provider}*`,
                },
              },
            ],
          });
        } catch (err) {
          logger.warn('Failed to update cloud provider selection message', {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      // 3. Store provider in conversation state
      await updateConversation(channelId, threadTs, {
        cosellProvider: provider,
      });

      // 4. Post list owner question in thread
      await client.chat.postMessage({
        channel: channelId,
        thread_ts: threadTs,
        text: 'Who is the owner of this list and is there any additional context? (Reply in this thread)',
      });
    });
  }
}
