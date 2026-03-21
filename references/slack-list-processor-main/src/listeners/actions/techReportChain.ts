/**
 * Bolt action handler for enrichment chain after tech report delivery.
 *
 * After a tech report job delivers its domain list, the bot asks what
 * enrichment the user wants. Four options:
 *   - "Get Technographics" (action_id: tr_chain_techno)
 *   - "Get Contacts"       (action_id: tr_chain_contact)
 *   - "Both"               (action_id: tr_chain_combined)
 *   - "Cancel"             (action_id: tr_chain_cancel)
 *
 * The first three set up conversation state with sourceJobId and
 * enrichIntent, then proceed into the enrichment flow.
 */

import type { App } from '@slack/bolt';
import type { KnownBlock } from '@slack/types';
import { v4 as uuidv4 } from 'uuid';
import {
  getConversation,
  setConversation,
} from '../../services/state/conversationStore.js';
import { buildEnrichmentDataBlocks } from './enrichmentDataSelection.js';
import { checkBillingGate } from '../../services/billing/billingGate.js';
import { estimateJobCredits } from '../../services/billing/creditRateCalculator.js';
import type { OperationType } from '../../services/billing/creditRateCalculator.js';
import { resolveClientId } from '../../lib/clientLookup.js';
import { prisma } from '../../models/index.js';
import { enrichmentQueue } from '../../services/queue/queues.js';
import { downloadFile } from '../../lib/storage.js';
import { parse } from 'csv-parse/sync';
import { startStream, type StreamConfig } from '../../services/agent/streamingHelper.js';
import { buildInitialPlan, subscribeToProgress } from '../../services/agent/taskVisualizer.js';
import logger from '../../lib/logger.js';

// ---------------------------------------------------------------------------
// Block Kit builder
// ---------------------------------------------------------------------------

/**
 * Builds Block Kit blocks for the enrichment chain prompt after tech report.
 *
 * @param jobId - The completed tech report job ID.
 * @returns Block Kit blocks array.
 */
export function buildTechReportChainBlocks(jobId: string): KnownBlock[] {
  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: 'Would you like to enrich this list further?',
      },
    },
    {
      type: 'actions',
      block_id: 'tech_report_chain',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Get Technographics' },
          action_id: 'tr_chain_techno',
          value: jobId,
          style: 'primary',
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Get Contacts' },
          action_id: 'tr_chain_contact',
          value: jobId,
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Both' },
          action_id: 'tr_chain_combined',
          value: jobId,
        },
        {
          type: 'button',
          text: { type: 'plain_text', text: 'Cancel' },
          action_id: 'tr_chain_cancel',
          value: jobId,
        },
      ],
    },
  ];
}

// ---------------------------------------------------------------------------
// Action handlers
// ---------------------------------------------------------------------------

/**
 * Registers Bolt action handlers for tech report enrichment chain buttons.
 *
 * @param app - The Slack Bolt application instance.
 */
export function registerTechReportChainHandlers(app: App): void {
  // Shared handler for the three enrichment options
  async function handleEnrichmentChoice(
    enrichIntent: 'technographic' | 'contact' | 'combined',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    body: any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    client: any,
  ): Promise<void> {
    const channelId = body.channel?.id;
    const messageTs = body.message?.ts;
    const threadTs = body.message?.thread_ts ?? messageTs;
    const userId = body.user?.id;
    const teamId = body.user?.team_id ?? body.team?.id ?? 'unknown';
    const sourceJobId = body.actions?.[0]?.value;

    if (!channelId || !threadTs || !sourceJobId) {
      logger.warn('tr_chain: missing context', { channelId, threadTs, sourceJobId });
      return;
    }

    logger.info('Tech report enrichment chain accepted', {
      channelId,
      threadTs,
      userId,
      sourceJobId,
      enrichIntent,
    });

    // Update original message to show selection
    if (messageTs) {
      const label = enrichIntent === 'technographic'
        ? 'technographics'
        : enrichIntent === 'contact'
          ? 'contacts'
          : 'technographics and contacts';
      try {
        await client.chat.update({
          channel: channelId,
          ts: messageTs,
          text: `Getting ${label} for this list...`,
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: `Getting ${label} for this list...`,
              },
            },
          ],
        });
      } catch (err) {
        logger.warn('tr_chain: failed to update message', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Billing gate check
    const ops: OperationType[] = enrichIntent === 'technographic'
      ? ['BUILTWITH_CTU_LOOKUP']
      : enrichIntent === 'contact'
        ? ['APOLLO_PEOPLE_SEARCH', 'APOLLO_BULK_ENRICH']
        : ['BUILTWITH_CTU_LOOKUP', 'APOLLO_PEOPLE_SEARCH', 'APOLLO_BULK_ENRICH'];
    const estCredits = await estimateJobCredits(100, ops);
    const billingCheck = await checkBillingGate(teamId, estCredits, channelId);
    if (!billingCheck.allowed) {
      await client.chat.postMessage({
        channel: channelId,
        thread_ts: threadTs,
        text: billingCheck.reason ?? 'Billing is not active for this workspace.',
      });
      return;
    }

    // Set up conversation state with sourceJobId
    await setConversation(channelId, threadTs, {
      fileId: '',
      fileName: '',
      fileType: 'csv',
      userId: userId ?? 'unknown',
      teamId,
      channelId,
      threadTs,
      status: 'pending',
      enrichIntent,
      sourceJobId,
      ...(billingCheck.rateSnapshot
        ? { creditRateSnapshot: billingCheck.rateSnapshot as unknown as Record<string, unknown> }
        : {}),
    });

    // For contact-only, show enrichment data selection first
    // For combined (BOTH), start technographic first, then prompt for enrichment after it completes
    // For technographic-only, start technographic directly
    if (enrichIntent === 'contact') {
      await client.chat.postMessage({
        channel: channelId,
        thread_ts: threadTs,
        blocks: buildEnrichmentDataBlocks(),
        text: 'What would you like to enrich?',
      });
    } else {
      // Technographic or BOTH: start technographic enrichment from tech report domains
      await startEnrichmentFromTechReport(
        client, channelId, threadTs, userId ?? 'unknown', teamId,
        sourceJobId, 'TECHNOGRAPHIC',
      );
    }
  }

  app.action('tr_chain_techno', async ({ ack, body, client }) => {
    await ack();
    await handleEnrichmentChoice('technographic', body, client);
  });

  app.action('tr_chain_contact', async ({ ack, body, client }) => {
    await ack();
    await handleEnrichmentChoice('contact', body, client);
  });

  app.action('tr_chain_combined', async ({ ack, body, client }) => {
    await ack();
    await handleEnrichmentChoice('combined', body, client);
  });

  // -----------------------------------------------------------------------
  // Shared: create enrichment job from tech report domains
  // -----------------------------------------------------------------------
  async function startEnrichmentFromTechReport(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    client: any,
    channelId: string,
    threadTs: string,
    userId: string,
    teamId: string,
    sourceJobId: string,
    jobType: 'TECHNOGRAPHIC' | 'CONTACT' | 'COMBINED',
  ): Promise<void> {
    // Load source tech report job to get the result CSV
    const sourceJob = await prisma.job.findUniqueOrThrow({
      where: { id: sourceJobId },
      select: { resultFileUrl: true, sourceFileName: true, slackChannelName: true },
    });

    if (!sourceJob.resultFileUrl) {
      await client.chat.postMessage({
        channel: channelId,
        thread_ts: threadTs,
        text: 'Could not find the tech report file. Please try generating a new report.',
      });
      return;
    }

    // Download and parse the CSV to extract domains
    const csvBuffer = await downloadFile(sourceJob.resultFileUrl);
    const records = parse(csvBuffer, { columns: true, skip_empty_lines: true }) as Array<Record<string, string>>;

    const domains = records
      .map((r) => r['Domain'] ?? r['domain'] ?? '')
      .filter((d) => d.length > 0);

    if (domains.length === 0) {
      await client.chat.postMessage({
        channel: channelId,
        thread_ts: threadTs,
        text: 'No domains found in the tech report. Please try generating a new report.',
      });
      return;
    }

    // Resolve channel name
    let channelName = sourceJob.slackChannelName;
    if (!channelName) {
      try {
        const chInfo = await client.conversations.info({ channel: channelId });
        channelName = chInfo.channel?.name ?? null;
      } catch { /* ignore */ }
    }

    // Retrieve credit rate snapshot from conversation state
    const conversation = await getConversation(channelId, threadTs);
    const chainClientId = await resolveClientId(teamId, channelId);

    // Create Job record
    const jobId = uuidv4();
    const job = await prisma.job.create({
      data: {
        id: jobId,
        jobType,
        status: 'PENDING',
        slackChannelId: channelId,
        slackChannelName: channelName,
        slackThreadTs: threadTs,
        slackUserId: userId,
        slackTeamId: teamId,
        clientId: chainClientId,
        sourceFileName: sourceJob.sourceFileName ?? 'tech-report',
        sourceFileType: 'CSV',
        sourceRowCount: domains.length,
        creditRateSnapshot: conversation?.creditRateSnapshot
          ? JSON.parse(JSON.stringify(conversation.creditRateSnapshot))
          : undefined,
      },
    });

    // Create JobCompany records
    const companyData = domains.map((domain, index) => ({
      id: uuidv4(),
      jobId: job.id,
      rowIndex: index,
      domain,
      companyName: records[index]?.['Company Name'] ?? null,
      enrichmentStatus: 'PENDING' as const,
    }));

    await prisma.jobCompany.createMany({ data: companyData });

    // Enqueue the enrichment job
    const enrichJobName = jobType === 'TECHNOGRAPHIC'
      ? 'technographic-enrichment'
      : jobType === 'CONTACT'
        ? 'contact-enrichment'
        : 'combined-enrichment';

    // Start streaming with task card visualization
    const enrichType = jobType === 'TECHNOGRAPHIC' ? 'technographic'
      : jobType === 'CONTACT' ? 'contact'
      : 'combined';

    const streamConfig: StreamConfig = {
      client,
      channel: channelId,
      threadTs,
      userId,
      teamId,
    };

    const initialChunks = buildInitialPlan(enrichType, `${jobType} Enrichment`);
    const session = await startStream(streamConfig, {
      taskDisplayMode: 'plan',
      initialChunks,
    });

    // Note: task-mode streams only accept chunks, not markdown_text
    await subscribeToProgress(jobId, enrichType, session);

    // Enqueue the enrichment job
    await enrichmentQueue.add(enrichJobName, {
      jobId: job.id,
      companies: companyData.map((c) => ({
        jobCompanyId: c.id,
        rowIndex: c.rowIndex,
        domain: c.domain,
        companyName: c.companyName ?? undefined,
      })),
    });

    logger.info('Tech report chain enrichment job created', {
      jobId: job.id,
      sourceJobId,
      jobType,
      companyCount: domains.length,
    });
  }

  app.action('tr_chain_cancel', async ({ ack, body, client }) => {
    await ack();

    const channelId = (body as { channel?: { id: string } }).channel?.id;
    const messageTs = (body as { message?: { ts: string } }).message?.ts;

    if (!channelId || !messageTs) return;

    try {
      await client.chat.update({
        channel: channelId,
        ts: messageTs,
        text: 'No further enrichment requested.',
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: 'No further enrichment requested.',
            },
          },
        ],
      });
    } catch (err) {
      logger.warn('tr_chain_cancel: failed to update message', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });
}
