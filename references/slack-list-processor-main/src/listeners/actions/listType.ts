/**
 * Bolt action handler for list type selection buttons.
 *
 * When a user uploads a CSV/XLSX file, the bot first asks:
 *   "What type of list is this?"
 *   - "Company List" → shows enrichment type buttons (Get Technographics, Get Contacts, Get Both)
 *   - "Contact List" → shows enrichment data buttons (Contact Data, Email, Mobile Number, All)
 */

import type { App } from '@slack/bolt';
import type { KnownBlock } from '@slack/types';
import {
  getConversation,
  updateConversation,
} from '../../services/state/conversationStore.js';
import { buildEnrichmentDataBlocks } from './enrichmentDataSelection.js';
import logger from '../../lib/logger.js';

/**
 * Builds the Block Kit buttons for enrichment type selection (company list flow).
 *
 * @returns Block Kit blocks for Get Technographics / Get Contacts / Get Both.
 */
function buildCompanyEnrichmentBlocks(): KnownBlock[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const blocks: any[] = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: 'What would you like me to do with this list?',
      },
    },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Get Technographics', emoji: true },
          action_id: 'enrich_technographics',
          style: 'primary',
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Get Contacts', emoji: true },
          action_id: 'enrich_contacts',
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Get Both', emoji: true },
          action_id: 'enrich_combined',
        },
      ],
    },
    {
      type: 'actions',
      block_id: 'cache_toggle',
      elements: [
        {
          type: 'checkboxes',
          action_id: 'toggle_cache_usage',
          initial_options: [
            {
              text: { type: 'plain_text', text: 'Use cached data (saves API credits)' },
              value: 'use_cache',
            },
          ],
          options: [
            {
              text: { type: 'plain_text', text: 'Use cached data (saves API credits)' },
              value: 'use_cache',
            },
          ],
        },
      ],
    },
  ];
  return blocks as KnownBlock[];
}

/**
 * Registers action handlers for the list type selection buttons.
 *
 * - list_type_company: stores listType='company', shows enrichment type buttons
 * - list_type_contact: stores listType='contact', shows enrichment data buttons
 *
 * @param app - The Slack Bolt application instance.
 */
export function registerListTypeHandlers(app: App): void {
  // -------------------------------------------------------------------------
  // "Company List" button
  // -------------------------------------------------------------------------
  app.action('list_type_company', async ({ ack, body, client }) => {
    await ack();

    const action = body as {
      channel?: { id: string };
      message?: { ts: string; thread_ts?: string };
      user?: { id: string };
    };

    const channelId = action.channel?.id;
    const messageTs = action.message?.ts;
    const threadTs = action.message?.thread_ts ?? messageTs;

    logger.info('list_type_company action received', {
      channelId,
      messageTs,
      threadTs,
      rawThreadTs: action.message?.thread_ts,
      userId: action.user?.id,
    });

    if (!channelId || !threadTs) {
      logger.warn('list_type_company: missing channel or thread context');
      return;
    }

    // Update the original message to show the selection.
    if (messageTs) {
      try {
        await client.chat.update({
          channel: channelId,
          ts: messageTs,
          text: 'List type: *Company List*',
          blocks: [
            {
              type: 'section',
              text: { type: 'mrkdwn', text: 'List type: *Company List*' },
            },
          ],
        });
      } catch (err) {
        logger.warn('Failed to update list type message', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const conversation = await getConversation(channelId, threadTs);
    logger.info('list_type_company: Redis lookup result', {
      channelId,
      threadTs,
      messageTs,
      rawThreadTs: action.message?.thread_ts,
      conversationExists: !!conversation,
      hasFileId: !!conversation?.fileId,
      fileId: conversation?.fileId,
    });
    if (!conversation?.fileId) {
      logger.warn('list_type_company: no conversation found in Redis', {
        channelId,
        threadTs,
        conversationExists: !!conversation,
        conversationKeys: conversation ? Object.keys(conversation) : [],
      });
      await client.chat.postMessage({
        channel: channelId,
        thread_ts: threadTs,
        text: 'No file found. Please upload a CSV or XLSX file and try again.',
      });
      return;
    }

    // Store list type and show enrichment type buttons.
    await updateConversation(channelId, threadTs, { listType: 'company' });
    await client.chat.postMessage({
      channel: channelId,
      thread_ts: threadTs,
      blocks: buildCompanyEnrichmentBlocks(),
      text: 'What would you like me to do with this list?',
    });
  });

  // -------------------------------------------------------------------------
  // "Contact List" button
  // -------------------------------------------------------------------------
  app.action('list_type_contact', async ({ ack, body, client }) => {
    await ack();

    const action = body as {
      channel?: { id: string };
      message?: { ts: string; thread_ts?: string };
      user?: { id: string };
    };

    const channelId = action.channel?.id;
    const messageTs = action.message?.ts;
    const threadTs = action.message?.thread_ts ?? messageTs;

    logger.info('list_type_contact action received', {
      channelId,
      messageTs,
      threadTs,
      rawThreadTs: action.message?.thread_ts,
      userId: action.user?.id,
    });

    if (!channelId || !threadTs) {
      logger.warn('list_type_contact: missing channel or thread context');
      return;
    }

    // Update the original message to show the selection.
    if (messageTs) {
      try {
        await client.chat.update({
          channel: channelId,
          ts: messageTs,
          text: 'List type: *Contact List*',
          blocks: [
            {
              type: 'section',
              text: { type: 'mrkdwn', text: 'List type: *Contact List*' },
            },
          ],
        });
      } catch (err) {
        logger.warn('Failed to update list type message', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const conversation = await getConversation(channelId, threadTs);
    if (!conversation?.fileId) {
      logger.warn('list_type_contact: no conversation found in Redis', {
        channelId,
        threadTs,
        conversationExists: !!conversation,
        conversationKeys: conversation ? Object.keys(conversation) : [],
      });
      await client.chat.postMessage({
        channel: channelId,
        thread_ts: threadTs,
        text: 'No file found. Please upload a CSV or XLSX file and try again.',
      });
      return;
    }

    // Store list type and intent, then show enrichment data selection.
    await updateConversation(channelId, threadTs, {
      listType: 'contact',
      enrichIntent: 'contact',
    });
    await client.chat.postMessage({
      channel: channelId,
      thread_ts: threadTs,
      blocks: buildEnrichmentDataBlocks(),
      text: 'What would you like to enrich?',
    });
  });
}
