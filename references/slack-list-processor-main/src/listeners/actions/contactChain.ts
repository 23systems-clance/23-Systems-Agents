/**
 * Bolt action handler for "Get Contacts?" chain prompt.
 *
 * After a technographic enrichment job completes and delivers its result
 * file, the bot asks "Would you like me to get contacts for this list?"
 * This handler processes the Yes/No button clicks:
 *
 * - Yes: Sets up conversation state with the source job ID and presents
 *   purpose selection buttons so the contact enrichment can chain from
 *   the existing technographic job (no file re-upload needed).
 * - No: Updates the message to dismiss the prompt.
 */

import type { App } from '@slack/bolt';
import {
  setConversation,
} from '../../services/state/conversationStore.js';
import { buildEnrichmentDataBlocks } from './enrichmentDataSelection.js';
import { checkBillingGate } from '../../services/billing/billingGate.js';
import { estimateJobCredits } from '../../services/billing/creditRateCalculator.js';
import logger from '../../lib/logger.js';

/**
 * Builds Block Kit blocks for the "Get Contacts?" follow-up prompt.
 *
 * @param jobId - The completed technographic job ID (passed via button value).
 * @returns Block Kit blocks array for the contact chain prompt.
 */
export function buildContactChainBlocks(jobId: string): import('@slack/types').KnownBlock[] {
  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: 'Would you like me to get contacts for this list?',
      },
    },
    {
      type: 'actions',
      block_id: 'contact_chain',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Yes, Get Contacts' },
          action_id: 'chain_contacts_yes',
          value: jobId,
          style: 'primary',
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: 'No Thanks' },
          action_id: 'chain_contacts_no',
          value: jobId,
        },
      ],
    },
  ];
}

/**
 * Registers Bolt action handlers for `chain_contacts_yes` and
 * `chain_contacts_no` buttons.
 *
 * @param app - The Slack Bolt application instance.
 */
export function registerContactChainHandlers(app: App): void {
  // -------------------------------------------------------------------------
  // chain_contacts_yes -- set up conversation state and show purpose selection
  // -------------------------------------------------------------------------
  app.action('chain_contacts_yes', async ({ ack, body, client }) => {
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
    const sourceJobId = action.actions?.[0]?.value;

    if (!channelId || !threadTs || !sourceJobId) {
      logger.warn('chain_contacts_yes: missing context', {
        channelId,
        threadTs,
        sourceJobId,
      });
      return;
    }

    logger.info('Contact chain accepted', {
      channelId,
      threadTs,
      userId,
      sourceJobId,
    });

    // Update the original message to show the selection.
    if (messageTs) {
      try {
        await client.chat.update({
          channel: channelId,
          ts: messageTs,
          text: 'Getting contacts for this list...',
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: 'Getting contacts for this list...',
              },
            },
          ],
        });
      } catch (err) {
        logger.warn('chain_contacts_yes: failed to update message', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Billing gate check for contact chain
    const teamId = action.user?.team_id ?? action.team?.id ?? 'unknown';
    const estCredits = await estimateJobCredits(100, ['APOLLO_PEOPLE_SEARCH', 'APOLLO_BULK_ENRICH']);
    const billingCheck = await checkBillingGate(teamId, estCredits, channelId);
    if (!billingCheck.allowed) {
      await client.chat.postMessage({
        channel: channelId,
        thread_ts: threadTs,
        text: billingCheck.reason ?? 'Billing is not active for this workspace.',
      });
      return;
    }

    // Set up conversation state with sourceJobId so the purpose selection
    // handler can detect this is a chain flow and skip file download.
    await setConversation(channelId, threadTs, {
      fileId: '',
      fileName: '',
      fileType: 'csv',
      userId: userId ?? 'unknown',
      channelId,
      threadTs,
      status: 'pending',
      enrichIntent: 'contact',
      sourceJobId,
      ...(billingCheck.rateSnapshot
        ? { creditRateSnapshot: billingCheck.rateSnapshot as unknown as Record<string, unknown> }
        : {}),
    });

    // Post enrichment data selection buttons.
    await client.chat.postMessage({
      channel: channelId,
      thread_ts: threadTs,
      blocks: buildEnrichmentDataBlocks(),
      text: 'What would you like to enrich?',
    });
  });

  // -------------------------------------------------------------------------
  // chain_contacts_no -- dismiss the prompt
  // -------------------------------------------------------------------------
  app.action('chain_contacts_no', async ({ ack, body, client }) => {
    await ack();

    const action = body as {
      type: string;
      channel?: { id: string };
      message?: { ts: string; thread_ts?: string };
    };

    const channelId = action.channel?.id;
    const messageTs = action.message?.ts;

    if (!channelId || !messageTs) {
      return;
    }

    // Update the original message to dismiss.
    try {
      await client.chat.update({
        channel: channelId,
        ts: messageTs,
        text: 'No contacts requested.',
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: 'No contacts requested. You can always come back and say *ENRICH get contacts* in this thread.',
            },
          },
        ],
      });
    } catch (err) {
      logger.warn('chain_contacts_no: failed to update message', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });
}
