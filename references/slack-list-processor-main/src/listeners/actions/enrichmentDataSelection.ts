/**
 * Bolt action handler for enrichment data type selection buttons.
 *
 * After the user selects "Get Contacts" or "Get Both", the bot posts
 * four buttons asking what contact data to enrich:
 *   - "Contact Data" (basic match — names, titles, persona)
 *   - "Email" (email enrichment)
 *   - "Mobile Number" (phone enrichment)
 *   - "All" (email + phone + contact data)
 *
 * All options currently use the same Apollo API. Email and Mobile Number
 * will be routed to separate providers in a future update.
 */

import type { App } from '@slack/bolt';
import type { KnownBlock } from '@slack/types';
import {
  updateConversation,
} from '../../services/state/conversationStore.js';
import { buildContactFilterSelectionBlocks } from './enrichmentPresetBlocks.js';
import { DEFAULT_APOLLO_FILTERS } from '../../types/enrichmentFilters.js';
import { prisma } from '../../models/index.js';
import logger from '../../lib/logger.js';

/** Maps action_id suffixes to enrichment data type values. */
const DATA_TYPE_MAP: Record<string, 'contact_data' | 'email' | 'mobile' | 'all'> = {
  select_enrich_contact_data: 'contact_data',
  select_enrich_email: 'email',
  select_enrich_mobile: 'mobile',
  select_enrich_all: 'all',
};

/** Human-readable labels for enrichment data types. */
const DATA_TYPE_LABELS: Record<string, string> = {
  contact_data: 'Contact Data',
  email: 'Email',
  mobile: 'Mobile Number',
  all: 'All',
};

/**
 * Builds Block Kit blocks for the enrichment data type selection prompt.
 *
 * @returns Block Kit blocks array for the "What would you like to enrich?" message.
 */
export function buildEnrichmentDataBlocks(): KnownBlock[] {
  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: 'What would you like to enrich?',
      },
    },
    {
      type: 'actions',
      block_id: 'enrichment_data_selection',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Contact Data', emoji: true },
          action_id: 'select_enrich_contact_data',
          value: 'contact_data',
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Email', emoji: true },
          action_id: 'select_enrich_email',
          value: 'email',
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Mobile Number', emoji: true },
          action_id: 'select_enrich_mobile',
          value: 'mobile',
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: 'All', emoji: true },
          action_id: 'select_enrich_all',
          value: 'all',
          style: 'primary',
        },
      ],
    },
  ];
}

/**
 * Registers action handlers for all enrichment data type selection buttons.
 *
 * On click:
 * 1. Acknowledge the action.
 * 2. Update the original message to show the selection.
 * 3. Store enrichDataType in conversation state.
 * 4. Post purpose selection buttons.
 *
 * @param app - The Slack Bolt application instance.
 */
export function registerEnrichmentDataSelectionHandlers(app: App): void {
  for (const actionId of Object.keys(DATA_TYPE_MAP)) {
    app.action(actionId, async ({ ack, body, client }) => {
      await ack();

      const action = body as {
        channel?: { id: string };
        message?: { ts: string; thread_ts?: string };
        user?: { id: string };
      };

      const channelId = action.channel?.id;
      const messageTs = action.message?.ts;
      const threadTs = action.message?.thread_ts ?? messageTs;
      const userId = action.user?.id;
      const dataType = DATA_TYPE_MAP[actionId];

      if (!channelId || !threadTs || !dataType) {
        logger.warn('Enrichment data selection: missing context', {
          actionId,
          channelId,
          threadTs,
        });
        return;
      }

      logger.info('Enrichment data type selected', {
        channelId,
        threadTs,
        userId,
        dataType,
      });

      // Update the original message to show the selection.
      if (messageTs) {
        try {
          await client.chat.update({
            channel: channelId,
            ts: messageTs,
            text: `Enrich: *${DATA_TYPE_LABELS[dataType] ?? dataType}*`,
            blocks: [
              {
                type: 'section',
                text: {
                  type: 'mrkdwn',
                  text: `Enrich: *${DATA_TYPE_LABELS[dataType] ?? dataType}*`,
                },
              },
            ],
          });
        } catch (err) {
          logger.warn('Failed to update enrichment data selection message', {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      // Store enrichment data type in conversation state.
      await updateConversation(channelId, threadTs, {
        enrichDataType: dataType,
      });

      // Map enrichDataType directly to purpose and skip redundant purpose selection
      const purposeMapping: Record<string, 'JUST_A_LIST' | 'EMAILING' | 'COLD_CALLING' | 'ALL'> = {
        contact_data: 'JUST_A_LIST',
        email: 'EMAILING',
        mobile: 'COLD_CALLING',
        all: 'ALL',
      };

      const mappedPurpose = purposeMapping[dataType];

      logger.info('Mapping enrichDataType to purpose', {
        enrichDataType: dataType,
        mappedPurpose,
        channelId,
        threadTs,
      });

      // Store the mapped purpose
      await updateConversation(channelId, threadTs, {
        purpose: mappedPurpose,
      });

      // Go directly to contact filter selection
      const defaultPreset = await prisma.enrichmentPreset.findFirst({
        where: { isDefault: true },
      });
      const defaultFilters = defaultPreset
        ? {
            personSeniorities: defaultPreset.personSeniorities,
            personTitles: defaultPreset.personTitles,
            personDepartments: defaultPreset.personDepartments,
            personFunctions: defaultPreset.personFunctions,
            perPage: defaultPreset.perPage,
          }
        : DEFAULT_APOLLO_FILTERS;

      await client.chat.postMessage({
        channel: channelId,
        thread_ts: threadTs,
        blocks: buildContactFilterSelectionBlocks(defaultFilters),
        text: 'Contact filters - use defaults or customize?',
      });
    });
  }
}
