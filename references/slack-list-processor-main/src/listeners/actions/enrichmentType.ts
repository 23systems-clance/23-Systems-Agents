/**
 * Bolt action handlers for enrichment type selection buttons.
 *
 * When a user uploads a CSV/XLSX file, the bot posts three buttons:
 *   - "Get Technographics" (enrich_technographics)
 *   - "Get Contacts" (enrich_contacts)
 *   - "Get Both" (enrich_combined)
 *
 * Clicking a button routes directly to the appropriate enrichment flow,
 * bypassing the need to type "ENRICH" with an intent.
 */

import type { App } from '@slack/bolt';
import {
  getConversation,
  updateConversation,
} from '../../services/state/conversationStore.js';
import { handleTechnographicFlow } from '../events/message.js';
import { buildEnrichmentDataBlocks } from './enrichmentDataSelection.js';
import { checkBillingGate } from '../../services/billing/billingGate.js';
import { estimateJobCredits } from '../../services/billing/creditRateCalculator.js';
import logger from '../../lib/logger.js';

/**
 * Registers action handlers for the enrichment type selection buttons
 * shown after file upload.
 *
 * @param app - The Slack Bolt application instance.
 */
export function registerEnrichmentTypeHandlers(app: App): void {
  // -----------------------------------------------------------------------
  // "Get Technographics" button
  // -----------------------------------------------------------------------
  app.action('enrich_technographics', async ({ ack, body, client }) => {
    await ack();

    const action = body as {
      channel?: { id: string };
      message?: { ts: string; thread_ts?: string };
      user?: { id: string; team_id?: string };
      team?: { id: string };
    };

    const channelId = action.channel?.id;
    const messageTs = action.message?.ts;
    const threadTs = action.message?.thread_ts ?? messageTs;
    const userId = action.user?.id ?? 'unknown';
    const teamId = action.user?.team_id ?? action.team?.id ?? 'unknown';

    if (!channelId || !threadTs) {
      logger.warn('enrich_technographics: missing channel or thread context');
      return;
    }

    // Update the original message to show the selection.
    if (messageTs) {
      try {
        await client.chat.update({
          channel: channelId,
          ts: messageTs,
          text: 'Enrichment type: *Get Technographics*',
          blocks: [
            {
              type: 'section',
              text: { type: 'mrkdwn', text: 'Enrichment type: *Get Technographics*' },
            },
          ],
        });
      } catch (err) {
        logger.warn('Failed to update enrichment type message', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const conversation = await getConversation(channelId, threadTs);
    logger.info('enrich_technographics: Redis lookup result', {
      channelId,
      threadTs,
      messageTs,
      rawThreadTs: action.message?.thread_ts,
      conversationExists: !!conversation,
      hasFileId: !!conversation?.fileId,
    });
    if (!conversation?.fileId) {
      await client.chat.postMessage({
        channel: channelId,
        thread_ts: threadTs,
        text: 'No file found. Please upload a CSV or XLSX file and try again.',
      });
      return;
    }

    // Billing gate check
    const estCredits = await estimateJobCredits(
      conversation.totalRows ?? 100,
      ['BUILTWITH_CTU_LOOKUP'],
    );
    const billingCheck = await checkBillingGate(teamId, estCredits, channelId);
    if (!billingCheck.allowed) {
      await client.chat.postMessage({
        channel: channelId,
        thread_ts: threadTs,
        text: billingCheck.reason ?? 'Billing is not active for this workspace.',
      });
      return;
    }

    // Store rate snapshot in conversation state for downstream job creation
    if (billingCheck.rateSnapshot) {
      await updateConversation(channelId, threadTs, {
        creditRateSnapshot: billingCheck.rateSnapshot as unknown as Record<string, unknown>,
      });
    }

    await client.chat.postMessage({
      channel: channelId,
      thread_ts: threadTs,
      text: 'Starting technographic enrichment...',
    });

    try {
      await handleTechnographicFlow(
        client,
        channelId,
        threadTs,
        conversation,
        'Get Technographics',
        userId,
        teamId,
      );
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      const errorStack = err instanceof Error ? err.stack : undefined;
      logger.error('Technographic enrichment failed from button', {
        channelId,
        threadTs,
        error: errorMsg,
        stack: errorStack,
      });
      await client.chat.postMessage({
        channel: channelId,
        thread_ts: threadTs,
        text: 'Sorry, something went wrong starting the enrichment. Please try again.',
      });
    }
  });

  // -----------------------------------------------------------------------
  // "Get Contacts" button
  // -----------------------------------------------------------------------
  app.action('enrich_contacts', async ({ ack, body, client }) => {
    await ack();

    const action = body as {
      channel?: { id: string };
      message?: { ts: string; thread_ts?: string };
      user?: { id: string; team_id?: string };
      team?: { id: string };
    };

    const channelId = action.channel?.id;
    const messageTs = action.message?.ts;
    const threadTs = action.message?.thread_ts ?? messageTs;
    const teamId = action.user?.team_id ?? action.team?.id ?? 'unknown';

    if (!channelId || !threadTs) {
      logger.warn('enrich_contacts: missing channel or thread context');
      return;
    }

    // Update the original message to show the selection.
    if (messageTs) {
      try {
        await client.chat.update({
          channel: channelId,
          ts: messageTs,
          text: 'Enrichment type: *Get Contacts*',
          blocks: [
            {
              type: 'section',
              text: { type: 'mrkdwn', text: 'Enrichment type: *Get Contacts*' },
            },
          ],
        });
      } catch (err) {
        logger.warn('Failed to update enrichment type message', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const conversation = await getConversation(channelId, threadTs);
    if (!conversation?.fileId) {
      await client.chat.postMessage({
        channel: channelId,
        thread_ts: threadTs,
        text: 'No file found. Please upload a CSV or XLSX file and try again.',
      });
      return;
    }

    // Billing gate check
    const estCredits = await estimateJobCredits(
      conversation.totalRows ?? 100,
      ['APOLLO_PEOPLE_SEARCH', 'APOLLO_BULK_ENRICH'],
    );
    const billingCheck = await checkBillingGate(teamId, estCredits, channelId);
    if (!billingCheck.allowed) {
      await client.chat.postMessage({
        channel: channelId,
        thread_ts: threadTs,
        text: billingCheck.reason ?? 'Billing is not active for this workspace.',
      });
      return;
    }

    // Store intent and rate snapshot, then show enrichment data selection.
    await updateConversation(channelId, threadTs, {
      enrichIntent: 'contact',
      ...(billingCheck.rateSnapshot
        ? { creditRateSnapshot: billingCheck.rateSnapshot as unknown as Record<string, unknown> }
        : {}),
    });
    await client.chat.postMessage({
      channel: channelId,
      thread_ts: threadTs,
      blocks: buildEnrichmentDataBlocks(),
      text: 'What would you like to enrich?',
    });
  });

  // -----------------------------------------------------------------------
  // "Get Both" button
  // -----------------------------------------------------------------------
  app.action('enrich_combined', async ({ ack, body, client }) => {
    await ack();

    const action = body as {
      channel?: { id: string };
      message?: { ts: string; thread_ts?: string };
      user?: { id: string; team_id?: string };
      team?: { id: string };
    };

    const channelId = action.channel?.id;
    const messageTs = action.message?.ts;
    const threadTs = action.message?.thread_ts ?? messageTs;
    const teamId = action.user?.team_id ?? action.team?.id ?? 'unknown';

    if (!channelId || !threadTs) {
      logger.warn('enrich_combined: missing channel or thread context');
      return;
    }

    // Update the original message to show the selection.
    if (messageTs) {
      try {
        await client.chat.update({
          channel: channelId,
          ts: messageTs,
          text: 'Enrichment type: *Get Both (Technographics + Contacts)*',
          blocks: [
            {
              type: 'section',
              text: { type: 'mrkdwn', text: 'Enrichment type: *Get Both (Technographics + Contacts)*' },
            },
          ],
        });
      } catch (err) {
        logger.warn('Failed to update enrichment type message', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const conversation = await getConversation(channelId, threadTs);
    if (!conversation?.fileId) {
      await client.chat.postMessage({
        channel: channelId,
        thread_ts: threadTs,
        text: 'No file found. Please upload a CSV or XLSX file and try again.',
      });
      return;
    }

    // Billing gate check
    const estCredits = await estimateJobCredits(
      conversation.totalRows ?? 100,
      ['BUILTWITH_CTU_LOOKUP', 'APOLLO_PEOPLE_SEARCH', 'APOLLO_BULK_ENRICH'],
    );
    const billingCheck = await checkBillingGate(teamId, estCredits, channelId);
    if (!billingCheck.allowed) {
      await client.chat.postMessage({
        channel: channelId,
        thread_ts: threadTs,
        text: billingCheck.reason ?? 'Billing is not active for this workspace.',
      });
      return;
    }

    // Store intent and rate snapshot, then start technographic enrichment first.
    // Purpose selection will be shown after technographic completes.
    await updateConversation(channelId, threadTs, {
      enrichIntent: 'combined',
      enrichInstruction: 'Get Both',
      ...(billingCheck.rateSnapshot
        ? { creditRateSnapshot: billingCheck.rateSnapshot as unknown as Record<string, unknown> }
        : {}),
    });

    const userId = action.user?.id ?? 'unknown';

    try {
      await handleTechnographicFlow(
        client,
        channelId,
        threadTs,
        conversation,
        'Get Both',
        userId,
        teamId,
      );
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      const errorStack = err instanceof Error ? err.stack : undefined;
      logger.error('Technographic enrichment failed from Get Both button', {
        channelId,
        threadTs,
        error: errorMsg,
        stack: errorStack,
      });
      await client.chat.postMessage({
        channel: channelId,
        thread_ts: threadTs,
        text: 'Sorry, something went wrong starting the enrichment. Please try again.',
      });
    }
  });

  // -----------------------------------------------------------------------
  // "Use cached data" checkbox toggle (Feature 17 — force refresh)
  // -----------------------------------------------------------------------
  app.action('toggle_cache_usage', async ({ ack, body }) => {
    await ack();

    const action = body as {
      channel?: { id: string };
      message?: { ts: string; thread_ts?: string };
      actions?: Array<{ selected_options?: Array<{ value: string }> }>;
    };

    const channelId = action.channel?.id;
    const threadTs = action.message?.thread_ts ?? action.message?.ts;

    if (!channelId || !threadTs) {
      logger.warn('toggle_cache_usage: missing channel or thread context');
      return;
    }

    const selectedOptions = action.actions?.[0]?.selected_options ?? [];
    const useCache = selectedOptions.some((opt) => opt.value === 'use_cache');

    logger.info('toggle_cache_usage: cache toggle changed', {
      channelId,
      threadTs,
      useCache,
      forceRefresh: !useCache,
    });

    await updateConversation(channelId, threadTs, { forceRefresh: !useCache });
  });
}
