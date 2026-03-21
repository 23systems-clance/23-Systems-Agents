/**
 * Bolt action handlers for tech report filter inputs (T047).
 *
 * When the AI orchestrator classifies intent as `tech_report`, the bot posts
 * Block Kit interactive elements so the user can specify filtering criteria
 * (country, state/region, company size, traffic level). This module provides:
 *
 * 1. `buildReportFilterBlocks` - constructs the Block Kit blocks for the filter UI
 * 2. `registerReportFilterHandlers` - registers Bolt action handlers that
 *    incrementally store filter selections and, on submit, create a Job
 *    record and enqueue a `tech-report` BullMQ job.
 */

import type { App } from '@slack/bolt';
import type { KnownBlock } from '@slack/types';
import { v4 as uuidv4 } from 'uuid';
import {
  getConversation,
  updateConversation,
} from '../../services/state/conversationStore.js';
import { prisma } from '../../models/index.js';
import { enrichmentQueue } from '../../services/queue/queues.js';
import type { TechReportJobData } from '../../services/queue/queues.js';
import logger from '../../lib/logger.js';
import { trackUsage } from '../../services/metering/usageTracker.js';
import { checkBillingGate } from '../../services/billing/billingGate.js';
import { estimateJobCredits } from '../../services/billing/creditRateCalculator.js';
import { resolveClientId } from '../../lib/clientLookup.js';

// ---------------------------------------------------------------------------
// Block Kit Builder
// ---------------------------------------------------------------------------

/**
 * Builds Block Kit blocks for the tech report filter selection UI.
 *
 * Presents interactive elements for country, state/region, company size,
 * and traffic level, plus a submit button to kick off the report job.
 *
 * @param technology - The technology name the report targets (e.g. "Salesforce").
 * @returns An array of Block Kit blocks ready to post via `chat.postMessage`.
 */
export function buildReportFilterBlocks(technology: string): KnownBlock[] {
  return [
    // Header
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `Let me gather some filters for your *${technology}* report`,
      },
    },

    // Country selection
    {
      type: 'section',
      block_id: 'report_filter_country_block',
      text: {
        type: 'mrkdwn',
        text: '*Country*',
      },
      accessory: {
        type: 'static_select',
        action_id: 'report_filter_country',
        placeholder: {
          type: 'plain_text',
          text: 'Select a country',
        },
        options: [
          { text: { type: 'plain_text', text: 'Any' }, value: '' },
          { text: { type: 'plain_text', text: 'US' }, value: 'US' },
          { text: { type: 'plain_text', text: 'GB' }, value: 'GB' },
          { text: { type: 'plain_text', text: 'DE' }, value: 'DE' },
          { text: { type: 'plain_text', text: 'FR' }, value: 'FR' },
          { text: { type: 'plain_text', text: 'CA' }, value: 'CA' },
          { text: { type: 'plain_text', text: 'AU' }, value: 'AU' },
          { text: { type: 'plain_text', text: 'JP' }, value: 'JP' },
          { text: { type: 'plain_text', text: 'IN' }, value: 'IN' },
          { text: { type: 'plain_text', text: 'BR' }, value: 'BR' },
        ],
      },
    },

    // State/Region free-text input
    {
      type: 'input',
      block_id: 'report_filter_state_region_block',
      dispatch_action: true,
      optional: true,
      element: {
        type: 'plain_text_input',
        action_id: 'report_filter_state_region',
        placeholder: {
          type: 'plain_text',
          text: 'e.g. California, Ontario (optional)',
        },
        dispatch_action_config: {
          trigger_actions_on: ['on_enter_pressed'],
        },
      },
      label: {
        type: 'plain_text',
        text: 'State / Region',
      },
    },

    // Company Size selection
    {
      type: 'section',
      block_id: 'report_filter_company_size_block',
      text: {
        type: 'mrkdwn',
        text: '*Company Size*',
      },
      accessory: {
        type: 'static_select',
        action_id: 'report_filter_company_size',
        placeholder: {
          type: 'plain_text',
          text: 'Select company size',
        },
        options: [
          { text: { type: 'plain_text', text: 'Any' }, value: '' },
          { text: { type: 'plain_text', text: '1-50' }, value: '1-50' },
          { text: { type: 'plain_text', text: '51-200' }, value: '51-200' },
          { text: { type: 'plain_text', text: '201-1000' }, value: '201-1000' },
          { text: { type: 'plain_text', text: '1001-10000' }, value: '1001-10000' },
          { text: { type: 'plain_text', text: '10000+' }, value: '10000+' },
        ],
      },
    },

    // Traffic Level selection
    {
      type: 'section',
      block_id: 'report_filter_traffic_block',
      text: {
        type: 'mrkdwn',
        text: '*Traffic Level*',
      },
      accessory: {
        type: 'static_select',
        action_id: 'report_filter_traffic',
        placeholder: {
          type: 'plain_text',
          text: 'Select traffic level',
        },
        options: [
          { text: { type: 'plain_text', text: 'Any' }, value: '' },
          { text: { type: 'plain_text', text: 'Top 10K' }, value: 'Top 10K' },
          { text: { type: 'plain_text', text: 'Top 100K' }, value: 'Top 100K' },
          { text: { type: 'plain_text', text: 'Top 500K' }, value: 'Top 500K' },
          { text: { type: 'plain_text', text: 'All' }, value: 'All' },
        ],
      },
    },

    // Submit button
    {
      type: 'actions',
      block_id: 'report_filter_submit_block',
      elements: [
        {
          type: 'button',
          text: {
            type: 'plain_text',
            text: 'Generate Report',
          },
          action_id: 'report_filter_submit',
          style: 'primary',
          value: 'submit',
        },
      ],
    },
  ];
}

// ---------------------------------------------------------------------------
// Action Handlers
// ---------------------------------------------------------------------------

/**
 * Extracts the channel ID and thread timestamp from a Bolt action body.
 *
 * @param body - The raw action body from Slack.
 * @returns An object with channelId and threadTs, or null values if missing.
 */
function extractThreadContext(body: Record<string, unknown>): {
  channelId: string | undefined;
  threadTs: string | undefined;
  userId: string | undefined;
  teamId: string;
} {
  const channel = body.channel as { id?: string } | undefined;
  const message = body.message as { ts?: string; thread_ts?: string } | undefined;
  const container = body.container as { thread_ts?: string } | undefined;
  const user = body.user as { id?: string; team_id?: string } | undefined;
  const team = body.team as { id?: string } | undefined;

  return {
    channelId: channel?.id,
    threadTs: message?.thread_ts ?? container?.thread_ts ?? message?.ts,
    userId: user?.id,
    teamId: user?.team_id ?? team?.id ?? 'unknown',
  };
}

/**
 * Registers Bolt action handlers for all tech report filter inputs.
 *
 * Handles the following action_ids:
 * - `report_filter_country`      - stores country in conversation state
 * - `report_filter_state_region` - stores state/region in conversation state
 * - `report_filter_company_size` - stores company size in conversation state
 * - `report_filter_traffic`      - stores traffic level in conversation state
 * - `report_filter_submit`       - collects filters, creates Job, enqueues tech-report job
 *
 * @param app - The Slack Bolt application instance.
 */
export function registerReportFilterHandlers(app: App): void {
  // -------------------------------------------------------------------------
  // Country selection handler
  // -------------------------------------------------------------------------
  app.action('report_filter_country', async ({ ack, body }) => {
    await ack();

    const { channelId, threadTs } = extractThreadContext(body as unknown as Record<string, unknown>);
    if (!channelId || !threadTs) {
      logger.warn('report_filter_country: missing thread context', { channelId, threadTs });
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const actions = (body as any).actions as
      | Array<{ selected_option?: { value: string } }>
      | undefined;
    const selectedValue = actions?.[0]?.selected_option?.value ?? '';

    const conversation = await getConversation(channelId, threadTs);
    const existingFilters = conversation?.filters ?? {};

    await updateConversation(channelId, threadTs, {
      filters: { ...existingFilters, country: selectedValue },
    });

    logger.info('Report filter updated: country', {
      channelId,
      threadTs,
      country: selectedValue,
    });
  });

  // -------------------------------------------------------------------------
  // State/Region text input handler
  // -------------------------------------------------------------------------
  app.action('report_filter_state_region', async ({ ack, body }) => {
    await ack();

    const { channelId, threadTs } = extractThreadContext(body as unknown as Record<string, unknown>);
    if (!channelId || !threadTs) {
      logger.warn('report_filter_state_region: missing thread context', { channelId, threadTs });
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const actions = (body as any).actions as
      | Array<{ value?: string }>
      | undefined;
    const inputValue = actions?.[0]?.value ?? '';

    const conversation = await getConversation(channelId, threadTs);
    const existingFilters = conversation?.filters ?? {};

    await updateConversation(channelId, threadTs, {
      filters: { ...existingFilters, stateRegion: inputValue },
    });

    logger.info('Report filter updated: stateRegion', {
      channelId,
      threadTs,
      stateRegion: inputValue,
    });
  });

  // -------------------------------------------------------------------------
  // Company Size selection handler
  // -------------------------------------------------------------------------
  app.action('report_filter_company_size', async ({ ack, body }) => {
    await ack();

    const { channelId, threadTs } = extractThreadContext(body as unknown as Record<string, unknown>);
    if (!channelId || !threadTs) {
      logger.warn('report_filter_company_size: missing thread context', { channelId, threadTs });
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const actions = (body as any).actions as
      | Array<{ selected_option?: { value: string } }>
      | undefined;
    const selectedValue = actions?.[0]?.selected_option?.value ?? '';

    const conversation = await getConversation(channelId, threadTs);
    const existingFilters = conversation?.filters ?? {};

    await updateConversation(channelId, threadTs, {
      filters: { ...existingFilters, companySize: selectedValue },
    });

    logger.info('Report filter updated: companySize', {
      channelId,
      threadTs,
      companySize: selectedValue,
    });
  });

  // -------------------------------------------------------------------------
  // Traffic Level selection handler
  // -------------------------------------------------------------------------
  app.action('report_filter_traffic', async ({ ack, body }) => {
    await ack();

    const { channelId, threadTs } = extractThreadContext(body as unknown as Record<string, unknown>);
    if (!channelId || !threadTs) {
      logger.warn('report_filter_traffic: missing thread context', { channelId, threadTs });
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const actions = (body as any).actions as
      | Array<{ selected_option?: { value: string } }>
      | undefined;
    const selectedValue = actions?.[0]?.selected_option?.value ?? '';

    const conversation = await getConversation(channelId, threadTs);
    const existingFilters = conversation?.filters ?? {};

    await updateConversation(channelId, threadTs, {
      filters: { ...existingFilters, trafficLevel: selectedValue },
    });

    logger.info('Report filter updated: trafficLevel', {
      channelId,
      threadTs,
      trafficLevel: selectedValue,
    });
  });

  // -------------------------------------------------------------------------
  // Submit handler - creates Job and enqueues tech-report
  // -------------------------------------------------------------------------
  app.action('report_filter_submit', async ({ ack, body, client }) => {
    await ack();

    const { channelId, threadTs, userId, teamId } = extractThreadContext(
      body as unknown as Record<string, unknown>,
    );
    if (!channelId || !threadTs) {
      logger.warn('report_filter_submit: missing thread context', { channelId, threadTs });
      return;
    }

    // Retrieve conversation state with stored filters
    const conversation = await getConversation(channelId, threadTs);
    if (!conversation) {
      logger.warn('report_filter_submit: conversation state not found', {
        channelId,
        threadTs,
      });
      await client.chat.postMessage({
        channel: channelId,
        thread_ts: threadTs,
        text: 'Session expired. Please start a new tech report request.',
      });
      return;
    }

    const technology = conversation.technology ?? 'Unknown';
    const filters = conversation.filters ?? {};

    // Billing gate check for tech report
    const estCredits = await estimateJobCredits(100, ['BUILTWITH_CTU_LOOKUP']);
    const billingCheck = await checkBillingGate(teamId, estCredits, channelId);
    if (!billingCheck.allowed) {
      await client.chat.postMessage({
        channel: channelId,
        thread_ts: threadTs,
        text: billingCheck.reason ?? 'Billing is not active for this workspace.',
      });
      return;
    }

    // Create a Job record with type TECH_REPORT
    let channelName: string | null = null;
    try {
      const chInfo = await client.conversations.info({ channel: channelId });
      channelName = chInfo.channel?.name ?? null;
    } catch { /* ignore */ }
    const reportClientId = await resolveClientId(teamId, channelId);
    const jobId = uuidv4();
    try {
      await prisma.job.create({
        data: {
          id: jobId,
          jobType: 'TECH_REPORT',
          status: 'PENDING',
          slackChannelId: channelId,
          slackChannelName: channelName,
          slackThreadTs: threadTs,
          slackUserId: userId ?? 'unknown',
          slackTeamId: teamId,
          clientId: reportClientId,
          additionalContext: JSON.stringify({ technology, filters }),
          creditRateSnapshot: billingCheck.rateSnapshot
            ? JSON.parse(JSON.stringify(billingCheck.rateSnapshot))
            : undefined,
        },
      });

      // Log AI intent classification usage now that we have a jobId.
      if (conversation.intentUsage) {
        await trackUsage({
          jobId,
          slackTeamId: teamId,
          service: 'ANTHROPIC',
          endpoint: 'classifyIntent',
          tokensInput: conversation.intentUsage.inputTokens,
          tokensOutput: conversation.intentUsage.outputTokens,
          estimatedCostUsd: conversation.intentUsage.estimatedCostUsd,
          durationMs: conversation.intentUsage.durationMs,
        });
      }

      // Enqueue a tech-report job on the enrichment queue
      const jobData: TechReportJobData = {
        jobId,
        technology,
        filters: {
          country: filters.country || undefined,
          stateRegion: filters.stateRegion || undefined,
          companySize: filters.companySize || undefined,
          trafficLevel: filters.trafficLevel || undefined,
        },
      };

      await enrichmentQueue.add('tech-report', jobData);

      logger.info('Tech report job created and enqueued', {
        jobId,
        technology,
        filters,
        channelId,
        threadTs,
      });

      // Post acknowledgment message
      const filterSummaryParts: string[] = [];
      if (filters.country) filterSummaryParts.push(`Country: *${filters.country}*`);
      if (filters.stateRegion) filterSummaryParts.push(`State/Region: *${filters.stateRegion}*`);
      if (filters.companySize) filterSummaryParts.push(`Company Size: *${filters.companySize}*`);
      if (filters.trafficLevel) filterSummaryParts.push(`Traffic Level: *${filters.trafficLevel}*`);

      const filterSummary =
        filterSummaryParts.length > 0
          ? `\n${filterSummaryParts.join('\n')}`
          : '\nNo specific filters applied.';

      await client.chat.postMessage({
        channel: channelId,
        thread_ts: threadTs,
        text:
          `Got it! Generating your *${technology}* technology report.` +
          filterSummary +
          '\n\nI\'ll notify you when the report is ready.',
      });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error('Failed to create tech report job', {
        channelId,
        threadTs,
        error: errorMsg,
      });
      await client.chat.postMessage({
        channel: channelId,
        thread_ts: threadTs,
        text: 'Sorry, something went wrong starting the tech report. Please try again.',
      });
    }
  });
}
