/**
 * Bolt action handler for co-sell check buttons (T053).
 *
 * After the AI orchestrator classifies intent, the bot asks whether the
 * list is a co-sell list. This module provides:
 *   1. `buildCosellCheckBlocks` -- Block Kit builder for the "Is this a co-sell list?" prompt.
 *   2. `registerCosellCheckHandlers` -- Bolt action registrations for cosell_yes / cosell_no.
 *
 * - cosell_yes: presents cloud provider selection buttons (AWS, Azure, GCP, Other).
 * - cosell_no: sets isCosell=false in conversation state and asks for list owner / context.
 */

import type { App } from '@slack/bolt';
import type { KnownBlock } from '@slack/types';
import {
  getConversation,
  updateConversation,
} from '../../services/state/conversationStore.js';
import { buildCloudProviderBlocks } from './cloudProvider.js';
import logger from '../../lib/logger.js';

// ---------------------------------------------------------------------------
// Block Kit builder
// ---------------------------------------------------------------------------

/**
 * Builds Block Kit blocks for the co-sell check prompt.
 *
 * Presents the user with a question "Is this a co-sell list?" and two
 * action buttons: "Yes" (action_id: cosell_yes) and "No" (action_id: cosell_no).
 *
 * @returns Block Kit blocks array for the co-sell check message.
 */
export function buildCosellCheckBlocks(): KnownBlock[] {
  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: 'Is this a co-sell list?',
      },
    },
    {
      type: 'actions',
      block_id: 'cosell_check',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Yes' },
          action_id: 'cosell_yes',
          value: 'yes',
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: 'No' },
          action_id: 'cosell_no',
          value: 'no',
        },
      ],
    },
  ];
}

// ---------------------------------------------------------------------------
// Action handlers
// ---------------------------------------------------------------------------

/**
 * Registers Bolt action handlers for `cosell_yes` and `cosell_no` buttons.
 *
 * - `cosell_yes`: Sets isCosell=true in conversation state, updates the
 *   original message to reflect the selection, and posts cloud provider
 *   selection blocks.
 * - `cosell_no`: Sets isCosell=false in conversation state, updates the
 *   original message, and posts a message asking the user for list owner
 *   and additional context.
 *
 * @param app - The Slack Bolt application instance.
 */
export function registerCosellCheckHandlers(app: App): void {
  // -------------------------------------------------------------------------
  // cosell_yes -- present cloud provider selection
  // -------------------------------------------------------------------------
  app.action('cosell_yes', async ({ ack, body, client }) => {
    await ack();

    const action = body as {
      type: string;
      channel?: { id: string };
      message?: { ts: string; thread_ts?: string };
      user?: { id: string; team_id?: string };
      team?: { id: string };
      actions?: Array<{ action_id: string; value: string }>;
    };

    const channelId = action.channel?.id;
    const messageTs = action.message?.ts;
    const threadTs = action.message?.thread_ts ?? messageTs;
    const userId = action.user?.id;

    if (!channelId || !threadTs) {
      logger.warn('cosell_yes: missing context', { channelId, threadTs });
      return;
    }

    logger.info('Co-sell selected: Yes', { channelId, threadTs, userId });

    // 1. Update the original message to show the selection
    if (messageTs) {
      try {
        await client.chat.update({
          channel: channelId,
          ts: messageTs,
          text: 'Co-sell list: *Yes*',
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: 'Co-sell list: *Yes*',
              },
            },
          ],
        });
      } catch (err) {
        logger.warn('cosell_yes: failed to update co-sell check message', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // 2. Update conversation state
    await updateConversation(channelId, threadTs, {
      isCosell: true,
    });

    // 3. Post cloud provider selection blocks
    const conversation = await getConversation(channelId, threadTs);
    if (!conversation) {
      logger.warn('cosell_yes: conversation state not found', {
        channelId,
        threadTs,
      });
      return;
    }

    await client.chat.postMessage({
      channel: channelId,
      thread_ts: threadTs,
      text: 'Which cloud provider is this co-sell for?',
      blocks: buildCloudProviderBlocks(),
    });
  });

  // -------------------------------------------------------------------------
  // cosell_no -- ask for list owner and additional context
  // -------------------------------------------------------------------------
  app.action('cosell_no', async ({ ack, body, client }) => {
    await ack();

    const action = body as {
      type: string;
      channel?: { id: string };
      message?: { ts: string; thread_ts?: string };
      user?: { id: string; team_id?: string };
      team?: { id: string };
      actions?: Array<{ action_id: string; value: string }>;
    };

    const channelId = action.channel?.id;
    const messageTs = action.message?.ts;
    const threadTs = action.message?.thread_ts ?? messageTs;
    const userId = action.user?.id;

    if (!channelId || !threadTs) {
      logger.warn('cosell_no: missing context', { channelId, threadTs });
      return;
    }

    logger.info('Co-sell selected: No', { channelId, threadTs, userId });

    // 1. Update the original message to show the selection
    if (messageTs) {
      try {
        await client.chat.update({
          channel: channelId,
          ts: messageTs,
          text: 'Co-sell list: *No*',
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: 'Co-sell list: *No*',
              },
            },
          ],
        });
      } catch (err) {
        logger.warn('cosell_no: failed to update co-sell check message', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // 2. Update conversation state
    await updateConversation(channelId, threadTs, {
      isCosell: false,
    });

    // 3. Post message asking for list owner and additional context
    await client.chat.postMessage({
      channel: channelId,
      thread_ts: threadTs,
      text: 'Who is the owner of this list and is there any additional context? (Reply in this thread)',
    });
  });
}
